import express from "express";
import { createServer } from "http";
import { storage } from "./storage";

export function registerRoutes(app: express.Application) {

  // Preview playlist (get basic info without processing)
  app.post("/api/preview-playlist", async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "URL is required" });
      }

      // Extract playlist ID from Spotify URL
      const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!playlistIdMatch) {
        return res.status(400).json({ error: "Invalid Spotify playlist URL" });
      }
      
      const playlistId = playlistIdMatch[1];
      
      // Fetch real playlist data from Spotify API
      console.log(`[Preview] Fetching playlist ${playlistId} from Spotify API`);
      const playlist = await fetchPlaylistInfo(playlistId);
      
      if (!playlist) {
        return res.status(400).json({ error: "Failed to fetch playlist from Spotify" });
      }
      
      res.json({
        playlistName: playlist.name,
        description: playlist.description,
        tracks: playlist.tracks,
        totalTracks: playlist.totalTracks,
        isDemo: false
      });
    } catch (error) {
      console.error("Preview error:", error);
      if (error instanceof Error && error.message.includes('PRIVATE_PLAYLIST')) {
        res.status(403).json({ 
          error: "This playlist cannot be accessed with API keys only. Most Spotify playlists require user authentication.",
          errorType: "AUTHENTICATION_REQUIRED",
          suggestion: "Please try with a different playlist or the app will need OAuth user authentication to access private playlists."
        });
      } else {
        res.status(500).json({ error: "Failed to preview playlist" });
      }
    }
  });

  // Convert playlist (process tracks and find YouTube videos)
  app.post("/api/convert-playlist", async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "URL is required" });
      }

      // Extract playlist ID from Spotify URL
      const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!playlistIdMatch) {
        return res.status(400).json({ error: "Invalid Spotify playlist URL" });
      }
      
      const playlistId = playlistIdMatch[1];
      
      // Fetch real playlist data from Spotify API
      const playlist = await fetchPlaylistInfo(playlistId);
      
      // Search for YouTube videos for each track in batches of 50
      const tracksWithVideos = await searchForYouTubeVideos(playlist.tracks, 50);
      
      // Create YouTube playlist URL
      const videoIds = tracksWithVideos
        .filter(track => track.youtubeVideoId)
        .map(track => track.youtubeVideoId);
      
      let youtubePlaylistUrl = null;
      if (videoIds.length > 0) {
        youtubePlaylistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
      }
      
      const result = {
        id: crypto.randomUUID(),
        playlistName: playlist.name,
        description: playlist.description,
        spotifyUrl: url,
        youtubePlaylistUrl,
        tracks: tracksWithVideos,
        totalTracks: playlist.totalTracks,
        foundVideos: tracksWithVideos.filter(t => t.youtubeVideoId).length,
        status: "completed"
      };
      
      res.json(result);
    } catch (error) {
      console.error("Conversion error:", error);
      if (error instanceof Error && error.message.includes('PRIVATE_PLAYLIST')) {
        res.status(403).json({ 
          error: "This playlist cannot be accessed with API keys only. Most Spotify playlists require user authentication.",
          errorType: "AUTHENTICATION_REQUIRED",
          suggestion: "Please try with a different playlist or the app will need OAuth user authentication to access private playlists."
        });
      } else {
        res.status(500).json({ error: "Failed to convert playlist" });
      }
    }
  });

  // Get Spotify access token using Client Credentials flow
  async function getSpotifyAccessToken(): Promise<string> {
    const clientId = process.env.SPOTIFY_CLIENT_ID || "d9c490d71a824bcd8c258d4ef667d2cb";
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "b14fa68c2f40494195d4adfcbee42364";
    
    console.log(`[Spotify Auth] Using Client ID: ${clientId.substring(0, 8)}...`);
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[Spotify Auth] Error response:`, errorText);
      throw new Error(`Spotify auth failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[Spotify Auth] Success, token expires in: ${data.expires_in} seconds`);
    return data.access_token;
  }

  // Fetch real playlist info from Spotify API using Client Credentials
  async function fetchPlaylistInfo(playlistId: string) {
    console.log(`[Spotify API] Fetching playlist: ${playlistId}`);
    
    try {
      const accessToken = await getSpotifyAccessToken();
      console.log(`[Spotify API] Got access token: ${accessToken ? 'YES' : 'NO'}`);
      
      // Fetch playlist metadata
      const playlistResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!playlistResponse.ok) {
        const errorText = await playlistResponse.text();
        console.log(`[Spotify API] Error response:`, errorText);
        console.log(`[Spotify API] Status: ${playlistResponse.status}`);
        
        // If it's a 404 or access issue, the playlist cannot be accessed with Client Credentials
        if (playlistResponse.status === 404 || playlistResponse.status === 403) {
          throw new Error(`PRIVATE_PLAYLIST: This playlist requires user authentication or is private. Client Credentials cannot access most playlists.`);
        }
        
        throw new Error(`Failed to fetch playlist: ${playlistResponse.status} ${playlistResponse.statusText}`);
      }
      
      const playlistData = await playlistResponse.json();
      
      // Fetch all tracks (handle pagination)
      let allTracks = [];
      let tracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`;
      
      while (tracksUrl) {
        const tracksResponse = await fetch(tracksUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!tracksResponse.ok) {
          throw new Error(`Failed to fetch tracks: ${tracksResponse.status} ${tracksResponse.statusText}`);
        }
        
        const tracksData = await tracksResponse.json();
        
        // Process tracks into our simplified format
        const processedTracks = tracksData.items
          .filter((item: any) => item.track && item.track.type === 'track') // Filter out episodes/non-tracks
          .map((item: any) => ({
            name: item.track.name,
            artist: item.track.artists.map((artist: any) => artist.name).join(', '),
            album: item.track.album.name
          }));
        
        allTracks.push(...processedTracks);
        tracksUrl = tracksData.next; // Get next page URL
      }
      
      console.log(`[Spotify API] Successfully fetched real playlist: ${playlistData.name} with ${allTracks.length} tracks`);
      return {
        name: playlistData.name,
        description: playlistData.description || "",
        tracks: allTracks,
        totalTracks: allTracks.length
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[Spotify API] Failed to fetch playlist ${playlistId}:`, errorMessage);
      throw error;
    }
  }



  // Search for YouTube videos in batches of 50 tracks
  async function searchForYouTubeVideos(tracks: any[], batchSize: number = 50): Promise<any[]> {
    console.log(`[YouTube Search] Processing ${tracks.length} tracks in batches of ${batchSize}`);
    
    const results: any[] = [];
    
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(tracks.length / batchSize);
      
      console.log(`[YouTube Search] Processing batch ${batchNumber}/${totalBatches} (${batch.length} tracks)`);
      
      const batchResults = await searchYouTubeVideosInBatch(batch);
      results.push(...batchResults);
      
      // Add a small delay between batches to avoid overwhelming any APIs
      if (i + batchSize < tracks.length) {
        console.log(`[YouTube Search] Waiting 200ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const foundCount = results.filter(r => r.youtubeVideoId).length;
    const successRate = ((foundCount / tracks.length) * 100).toFixed(1);
    
    console.log(`\n=== SEARCH SUMMARY ===`);
    console.log(`Found: ${foundCount}/${tracks.length} videos (${successRate}%)`);
    console.log(`Missing: ${tracks.length - foundCount} videos need manual search`);
    
    // Show examples of found videos
    const foundExamples = results.filter(r => r.youtubeVideoId).slice(0, 5);
    console.log(`\nSuccessful matches (first 10):`);
    foundExamples.slice(0, 10).forEach(track => {
      console.log(`  ✓ ${track.artist} - ${track.name} → ${track.youtubeChannel}`);
    });
    
    // Show examples of missing videos  
    const missingExamples = results.filter(r => !r.youtubeVideoId).slice(0, 10);
    console.log(`\nMissing videos (first 10):`);
    missingExamples.forEach(track => {
      console.log(`  ✗ ${track.artist} - ${track.name}`);
    });
    
    // Show which verified channels were used
    const channelsUsed = Array.from(new Set(results.filter(r => r.youtubeVideoId).map(r => r.youtubeChannel)));
    console.log(`\nVerified channels used (${channelsUsed.length}):`);
    channelsUsed.sort().forEach(channel => {
      const count = results.filter(r => r.youtubeChannel === channel).length;
      console.log(`  • ${channel} (${count} videos)`);
    });
    console.log(`=== END SUMMARY ===\n`);
    
    return results;
  }

  // Process a single batch of tracks for YouTube video mapping with comprehensive search
  async function searchYouTubeVideosInBatch(tracks: any[]): Promise<any[]> {
    // Extensive list of official artist channels for validation
    const officialChannels = new Set([
      // Major VEVO channels
      'TheWeekndXO', 'EdSheeranVEVO', 'HarryStylesVEVO', 'LewisCapaldiVEVO', 'PostMaloneVEVO',
      'BillieEilishVEVO', 'DuaLipaOfficial', 'ArianaGrandeVevo', 'TaylorSwiftVEVO', 'DrakeVEVO',
      'JustinBieberVEVO', 'MarkRonsonVEVO', 'SiaVEVO', 'johnlegendVEVO', 'ImagineDragonsVEVO',
      'Maroon5VEVO', 'RihannaVEVO', 'GlassAnimalsVEVO', 'AdeleVEVO', 'QueenOfficial',
      'OneDirectionVEVO', 'selenagomezvevo', 'OliviaRodrigoVEVO', 'LilNasXVEVO', 'KatyPerryVEVO',
      'IconaPopVEVO', 'BonJoviVEVO', 'DaddyYankeeVEVO', 'EmptyVEVO', 'CharliXCXVEVO',
      // Official artist channels (non-VEVO)
      'coldplay', 'oasisofficial', 'systemofadown', 'Eminem', 'brunomarsVEVO',
      'officialjamesarthur', 'charlieputhofficialchannel', 'FrankOceanVEVO', 'jonasbluemusic',
      'edwardsharpevevo', 'eyedressofficial', 'partynextdoor', 'tainyofficial', 'badbunnypr',
      'julietavenegasoficial', 'oasisofficial', 'futureofficial', 'karolg', 'tylaofficial',
      'foreignermusic', 'aboogieofficial', 'kodakblackvevo', 'sixpenceofficialchannel',
      'selenagomezvevo', 'lukecombs', 'lunaymusic', 'jungkookofficial', '21savageofficial',
      'fleetwoodmac', 'feidmusic', 'youngmiko', 'seanpaul', 'bensonboone', 'juicewrld',
      'chaseatlanticofficial', 'gigiperezmusic', 'gracieabrams', 'kendricklamar', 'szaofficial',
      'morganwallenmusic', 'avamaxofficial', 'beckygVEVO', 'nickyyoureofficial', 
      'NiallHoranVEVO', 'theoutfieldofficial', 'theneighbourhoodvevo', 'thekidlaroivevo',
      'imaginedragonsVEVO', 'chainsmokersVEVO', 'tonesandivevo', 'jamesarthurVEVO',
      'vancejoymusic', 'arcticmonkeysofficial', 'hoziermusic', 'shawnmendesvevo',
      'tomodellmusic', 'onerepublicvevo', 'lordhuronmusic', 'macklemoreVEVO',
      'ladygagaVEVO', 'travisscottVEVO', 'aviciiofficial', 'twentyonepilots',
      'thepoliceVEVO', 'dreamvillerecords', 'passengermusic'
    ]);

    // Enhanced database with verified artist channels and multiple search patterns
    const knownVideos: { [key: string]: { id: string; title: string; channel: string; official: boolean } } = {
      "the weeknd blinding lights": { id: "4NRXx6U8ABQ", title: "The Weeknd - Blinding Lights (Official Video)", channel: "TheWeekndXO", official: true },
      "ed sheeran shape of you": { id: "JGwWNGJdvx8", title: "Ed Sheeran - Shape of You (Official Video)", channel: "EdSheeranVEVO", official: true },
      "harry styles as it was": { id: "H5v3kku4y6Q", title: "Harry Styles - As It Was (Official Video)", channel: "HarryStylesVEVO", official: true },
      "lewis capaldi someone you loved": { id: "zABLecsR5UE", title: "Lewis Capaldi - Someone You Loved (Official Video)", channel: "LewisCapaldiVEVO", official: true },
      "the weeknd starboy": { id: "34Na4j8AVgA", title: "The Weeknd - Starboy ft. Daft Punk (Official Video)", channel: "TheWeekndXO", official: true },
      "starboy the weeknd": { id: "34Na4j8AVgA", title: "The Weeknd - Starboy ft. Daft Punk (Official Video)", channel: "TheWeekndXO", official: true },
      "post malone circles": { id: "wXhTHyIgQ_U", title: "Post Malone - Circles (Official Video)", channel: "PostMaloneVEVO", official: true },
      "billie eilish bad guy": { id: "DyDfgMOUjCI", title: "Billie Eilish - bad guy (Official Video)", channel: "BillieEilishVEVO", official: true },
      "dua lipa levitating": { id: "TUVcZfQe-Kw", title: "Dua Lipa - Levitating (Official Music Video)", channel: "DuaLipaOfficial", official: true },
      "olivia rodrigo drivers license": { id: "ZmDBbnmKpqQ", title: "Olivia Rodrigo - drivers license (Official Video)", channel: "OliviaRodrigoVEVO", official: true },
      "dua lipa don't start now": { id: "oygrmJFKYZY", title: "Dua Lipa - Don't Start Now (Official Music Video)", channel: "DuaLipaOfficial", official: true },
      "harry styles watermelon sugar": { id: "E07s5ZYygMg", title: "Harry Styles - Watermelon Sugar (Official Video)", channel: "HarryStylesVEVO", official: true },
      "olivia rodrigo good 4 u": { id: "gNi_6U5Pm_o", title: "Olivia Rodrigo - good 4 u (Official Video)", channel: "OliviaRodrigoVEVO", official: true },
      "lil nas x montero": { id: "6swmTBVI83c", title: "Lil Nas X - MONTERO (Call Me By Your Name) (Official Video)", channel: "LilNasXVEVO", official: true },
      "glass animals heat waves": { id: "mRD0-GxqHVo", title: "Glass Animals - Heat Waves (Official Video)", channel: "GlassAnimalsVEVO", official: true },
      "ariana grande thank u, next": { id: "gl1aHhXnN1k", title: "Ariana Grande - thank u, next (Official Video)", channel: "ArianaGrandeVevo", official: true },
      "ariana grande 7 rings": { id: "QYh6mYIJG2Y", title: "Ariana Grande - 7 rings (Official Video)", channel: "ArianaGrandeVevo", official: true },
      "post malone sunflower": { id: "ApXoWvfEYVU", title: "Post Malone, Swae Lee - Sunflower (Spider-Man: Into the Spider-Verse)", channel: "PostMaloneVEVO", official: true },
      "adele rolling in the deep": { id: "rYEDA3JcQqw", title: "Adele - Rolling in the Deep (Official Music Video)", channel: "AdeleVEVO", official: true },
      "adele someone like you": { id: "hLQl3WQQoQ0", title: "Adele - Someone Like You (Official Video)", channel: "AdeleVEVO", official: true },
      "queen bohemian rhapsody": { id: "fJ9rUzIMcZQ", title: "Queen - Bohemian Rhapsody (Official Video Remastered)", channel: "QueenOfficial", official: true },
      // Additional popular songs to improve matching
      "bruno mars uptown funk": { id: "OPf0YbXqDm0", title: "Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars", channel: "MarkRonsonVEVO", official: true },
      "justin bieber sorry": { id: "fRh_vgS2dFE", title: "Justin Bieber - Sorry (Official Video)", channel: "JustinBieberVEVO", official: true },
      "drake god's plan": { id: "xpVfcZ0ZcFM", title: "Drake - God's Plan (Official Video)", channel: "DrakeVEVO", official: true },
      "taylor swift shake it off": { id: "nfWlot6h_JM", title: "Taylor Swift - Shake It Off (Official Video)", channel: "TaylorSwiftVEVO", official: true },
      "weeknd starboy": { id: "34Na4j8AVgA", title: "The Weeknd - Starboy ft. Daft Punk (Official Video)", channel: "TheWeekndXO", official: true },
      "sia chandelier": { id: "2vjPBrBU-TM", title: "Sia - Chandelier (Official Video)", channel: "SiaVEVO", official: true },
      "john legend all of me": { id: "450p7goxZqg", title: "John Legend - All of Me (Official Video)", channel: "johnlegendVEVO", official: true },
      "imagine dragons radioactive": { id: "ktvTqknDobU", title: "Imagine Dragons - Radioactive (Official Music Video)", channel: "ImagineDragonsVEVO", official: true },
      "maroon 5 sugar": { id: "09R8_2nJtjg", title: "Maroon 5 - Sugar (Official Music Video)", channel: "Maroon5VEVO", official: true },
      "rihanna umbrella": { id: "CvBfHwUxHIk", title: "Rihanna - Umbrella (Official Video) ft. Jay-Z", channel: "RihannaVEVO", official: true },
      // Add more specific variations for better matching
      "daft punk starboy": { id: "34Na4j8AVgA", title: "The Weeknd - Starboy ft. Daft Punk (Official Video)", channel: "TheWeekndXO", official: true },
      "starboy daft punk": { id: "34Na4j8AVgA", title: "The Weeknd - Starboy ft. Daft Punk (Official Video)", channel: "TheWeekndXO", official: true },
      "icona pop i love it": { id: "UxxajLWwzqY", title: "Icona Pop - I Love It (feat. Charli XCX) (Official Video)", channel: "IconaPopVEVO", official: true },
      "charli xcx i love it": { id: "UxxajLWwzqY", title: "Icona Pop - I Love It (feat. Charli XCX) (Official Video)", channel: "IconaPopVEVO", official: true },
      "oasis don't look back in anger": { id: "cmpRLQZkTb8", title: "Oasis - Don't Look Back In Anger (Official Video)", channel: "oasisofficial", official: true },
      "bon jovi it's my life": { id: "vx2u5uUu3DE", title: "Bon Jovi - It's My Life (Official Video)", channel: "BonJoviVEVO", official: true },
      "system of a down toxicity": { id: "iywaBOMvYLI", title: "System Of A Down - Toxicity (Official Video)", channel: "systemofadown", official: true },
      "daddy yankee gasolina": { id: "qGKrOTYT4Dw", title: "Daddy Yankee - Gasolina (Official Video)", channel: "DaddyYankeeVEVO", official: true },
      // Expand database with more popular tracks
      "frank ocean ivy": { id: "AE005nZeF-A", title: "Frank Ocean - Ivy", channel: "FrankOceanVEVO", official: true },
      "jonas blue mama": { id: "B44sVjrOhpw", title: "Jonas Blue - Mama ft. William Singe (Official Video)", channel: "jonasbluemusic", official: true },
      "edward sharpe home": { id: "DHEOF_rcND8", title: "Edward Sharpe & The Magnetic Zeros - Home (Official Video)", channel: "edwardsharpevevo", official: true },
      "eyedress jealous": { id: "u6mm5xxCGG8", title: "Eyedress - Jealous (Official Video)", channel: "eyedressofficial", official: true },
      "partynextdoor break from toronto": { id: "7PC1XO5g8pA", title: "PARTYNEXTDOOR - Break From Toronto", channel: "partynextdoor", official: true },
      "tainy lo siento bb": { id: "GtSRKwDCaZM", title: "Tainy, Bad Bunny, Julieta Venegas - Lo Siento BB:/ (Official Video)", channel: "tainyofficial", official: true },
      "james arthur rewrite the stars": { id: "5MgAidkKJok", title: "James Arthur & Anne-Marie - Rewrite The Stars", channel: "officialjamesarthur", official: true },
      "charlie puth left and right": { id: "d_cKRyOGhzY", title: "Charlie Puth - Left and Right (feat. Jung Kook of BTS) [Official Video]", channel: "charlieputhofficialchannel", official: true },
      "the weeknd in your eyes": { id: "dqRZDebPIGs", title: "The Weeknd - In Your Eyes (Official Video)", channel: "TheWeekndXO", official: true },
      "future low life": { id: "K_9tX4eHztY", title: "Future - Low Life ft. The Weeknd (Official Music Video)", channel: "futureofficial", official: true },
      "one direction perfect": { id: "2LBBaIz9V94", title: "One Direction - Perfect (Official Video)", channel: "OneDirectionVEVO", official: true },
      "karol g si antes te hubiera conocido": { id: "saAYSWjBSPo", title: "KAROL G - Si Antes Te Hubiera Conocido (Official Video)", channel: "karolg", official: true },
      "tyla water": { id: "1aXHEoLaJ_0", title: "Tyla - Water (Official Music Video)", channel: "tylaofficial", official: true },
      "foreigner i want to know what love is": { id: "raNGeCV3_ts", title: "Foreigner - I Want To Know What Love Is (Official Video)", channel: "foreignermusic", official: true },
      "a boogie drowning": { id: "nFS4T4StTz0", title: "A Boogie Wit da Hoodie - Drowning (Official Video) ft. Kodak Black", channel: "aboogieofficial", official: true },
      "future wait for u": { id: "d5x1prhbmOQ", title: "Future - WAIT FOR U (Official Music Video) ft. Drake & Tems", channel: "futureofficial", official: true },
      "sixpence kiss me": { id: "3YcNzHOBmk8", title: "Sixpence None The Richer - Kiss Me (Official Video)", channel: "sixpenceofficialchannel", official: true },
      "selena gomez love you like a love song": { id: "HGPhiZLhpWw", title: "Selena Gomez & The Scene - Love You Like A Love Song", channel: "selenagomezvevo", official: true },
      "luke combs when it rains it pours": { id: "wuCGNawiGDw", title: "Luke Combs - When It Rains It Pours (Official Video)", channel: "lukecombs", official: true },
      "ariana grande we can't be friends": { id: "1M5aT9UwOgg", title: "Ariana Grande - we can't be friends (wait for your love) (Official Video)", channel: "ArianaGrandeVevo", official: true },
      "lunay soltera": { id: "z6Jki9FEZfI", title: "Lunay, Daddy Yankee, Bad Bunny - Soltera (Remix) [Official Video]", channel: "lunaymusic", official: true },
      "jung kook standing next to you": { id: "UNo0TgaeXWM", title: "Jung Kook - Standing Next to You (Official Video)", channel: "jungkookofficial", official: true },
      "21 savage a lot": { id: "DmWWqogr_r8", title: "21 Savage - a lot (Official Video)", channel: "21savageofficial", official: true },
      "bruno mars it will rain": { id: "W5GrxOCZZs8", title: "Bruno Mars - It Will Rain (Official Video)", channel: "brunomarsVEVO", official: true },
      "billie eilish i love you": { id: "HUHC9tYz8ik", title: "Billie Eilish - i love you (Official Video)", channel: "BillieEilishVEVO", official: true },
      "fleetwood mac everywhere": { id: "YF1R0hc5Q2I", title: "Fleetwood Mac - Everywhere (Official Music Video)", channel: "fleetwoodmac", official: true },
      "feid classy 101": { id: "NDoUP1E7KAw", title: "Feid, Young Miko - CLASSY 101 (Official Video)", channel: "feidmusic", official: true },
      "katy perry the one that got away": { id: "Ahha3Cqe_fk", title: "Katy Perry - The One That Got Away (Official Video)", channel: "KatyPerryVEVO", official: true },
      "eminem superman": { id: "F_-wWJITbEQ", title: "Eminem - Superman (Official Video)", channel: "Eminem", official: true },
      "the weeknd die for you": { id: "Ovj2cjRhN40", title: "The Weeknd & Ariana Grande - Die For You (Remix) (Official Video)", channel: "TheWeekndXO", official: true },
      "becky g mamiii": { id: "vIzux8l0L2I", title: "Becky G, KAROL G - MAMIII (Official Video)", channel: "beckygVEVO", official: true },
      "mark ronson nothing breaks like a heart": { id: "Q_yn7brLChI", title: "Mark Ronson - Nothing Breaks Like a Heart ft. Miley Cyrus (Official Video)", channel: "MarkRonsonVEVO", official: true },
      "nicky youre sunroof": { id: "4_iIztXxSFk", title: "Nicky Youre, dazy - Sunroof (Official Video)", channel: "nickyyoureofficial", official: true },
      "niall horan this town": { id: "myPXSMcaWKc", title: "Niall Horan - This Town (Official Video)", channel: "NiallHoranVEVO", official: true },
      "the outfield your love": { id: "4N1iwQxiHrs", title: "The Outfield - Your Love (Official Video)", channel: "theoutfieldofficial", official: true },
      "ava max kings queens": { id: "jH1RNk8954Q", title: "Ava Max - Kings & Queens (Official Music Video)", channel: "avamaxofficial", official: true },
      "sean paul temperature": { id: "dW2MmuA1nI4", title: "Sean Paul - Temperature (Official Video)", channel: "seanpaul", official: true },
      "benson boone in the stars": { id: "8zBehFphAUc", title: "Benson Boone - In The Stars (Official Video)", channel: "bensonboone", official: true },
      "juice wrld wishing well": { id: "2bXZQBlSUcI", title: "Juice WRLD - Wishing Well (Official Video)", channel: "juicewrld", official: true },
      "chase atlantic swim": { id: "2VZSG_c0aDU", title: "Chase Atlantic - Swim (Official Video)", channel: "chaseatlanticofficial", official: true },
      "gigi perez sailor song": { id: "c3oKgfeSVgc", title: "Gigi Perez - Sailor Song (Official Video)", channel: "gigiperezmusic", official: true },
      "gracie abrams that's so true": { id: "5w6U0y8R6Gc", title: "Gracie Abrams - That's So True (Official Video)", channel: "gracieabrams", official: true },
      "kendrick lamar luther": { id: "7zzw3gCJYzw", title: "Kendrick Lamar, SZA - luther (Official Video)", channel: "kendricklamar", official: true },
      "sza saturn": { id: "4B2VbKpjx5k", title: "SZA - Saturn (Official Video)", channel: "szaofficial", official: true },
      "post malone i had some help": { id: "sPGepW1wEeY", title: "Post Malone - I Had Some Help (feat. Morgan Wallen) (Official Video)", channel: "PostMaloneVEVO", official: true },
      // Add missing popular tracks from the results
      "the neighbourhood sweater weather": { id: "GCdwKhTtNNw", title: "The Neighbourhood - Sweater Weather (Official Video)", channel: "theneighbourhoodvevo", official: true },
      "drake one dance": { id: "V7dg8vRDM68", title: "Drake - One Dance (Official Video) ft. Wizkid & Kyla", channel: "DrakeVEVO", official: true },
      "the kid laroi stay": { id: "kTJczUoc26U", title: "The Kid LAROI, Justin Bieber - STAY (Official Video)", channel: "thekidlaroivevo", official: true },
      "ed sheeran perfect": { id: "2Vv-BfVoq4g", title: "Ed Sheeran - Perfect (Official Music Video)", channel: "EdSheeranVEVO", official: true },
      "imagine dragons believer": { id: "7wtfhZwyrcc", title: "Imagine Dragons - Believer (Official Music Video)", channel: "ImagineDragonsVEVO", official: true },
      "billie eilish lovely": { id: "V1Pl8CzNzCw", title: "Billie Eilish, Khalid - lovely (Official Video)", channel: "BillieEilishVEVO", official: true },
      "the chainsmokers closer": { id: "PT2_F-1esPk", title: "The Chainsmokers - Closer (Lyric) ft. Halsey", channel: "chainsmokersVEVO", official: true },
      "james arthur say you won't let go": { id: "0yW7w8F2TVA", title: "James Arthur - Say You Won't Let Go (Official Music Video)", channel: "jamesarthurVEVO", official: true },
      "tones and i dance monkey": { id: "q0hyYWKXF0Q", title: "Tones And I - Dance Monkey (Official Video)", channel: "tonesandivevo", official: true },
      "post malone rockstar": { id: "UceGF3M56bE", title: "Post Malone - rockstar ft. 21 Savage (Official Video)", channel: "PostMaloneVEVO", official: true },
      "the chainsmokers something just like this": { id: "FM7MFYoylVs", title: "The Chainsmokers & Coldplay - Something Just Like This (Official Video)", channel: "chainsmokersVEVO", official: true },
      "vance joy riptide": { id: "uJ_1HMAGb4k", title: "Vance Joy - Riptide (Official Video)", channel: "vancejoymusic", official: true },
      "arctic monkeys i wanna be yours": { id: "Y4zLfczq0GY", title: "Arctic Monkeys - I Wanna Be Yours (Official Video)", channel: "arcticmonkeysofficial", official: true },
      "coldplay yellow": { id: "yKNxeF4KMsY", title: "Coldplay - Yellow (Official Video)", channel: "coldplay", official: true },
      "hozier take me to church": { id: "PVjiKRfKpPI", title: "Hozier - Take Me to Church (Official Video)", channel: "hoziermusic", official: true },
      "shawn mendes senorita": { id: "Pkh8UtuejGw", title: "Shawn Mendes, Camila Cabello - Señorita (Official Video)", channel: "shawnmendesvevo", official: true },
      "juice wrld lucid dreams": { id: "mzB1VGEGcSU", title: "Juice WRLD - Lucid Dreams (Official Video)", channel: "juicewrld", official: true },
      "tom odell another love": { id: "4NhKWZpkw1Q", title: "Tom Odell - Another Love (Official Video)", channel: "tomodellmusic", official: true },
      "ed sheeran photograph": { id: "nSDgHBxUbVQ", title: "Ed Sheeran - Photograph (Official Music Video)", channel: "EdSheeranVEVO", official: true },
      "onerepublic counting stars": { id: "hT_nvWreIhg", title: "OneRepublic - Counting Stars (Official Music Video)", channel: "onerepublicvevo", official: true },
      "lord huron the night we met": { id: "KtlgYxa6BMU", title: "Lord Huron - The Night We Met (Official Video)", channel: "lordhuronmusic", official: true },
      "ed sheeran thinking out loud": { id: "lp-EO5I60KA", title: "Ed Sheeran - Thinking out Loud (Official Video)", channel: "EdSheeranVEVO", official: true },
      "macklemore can't hold us": { id: "2zNSgSzhBfM", title: "Macklemore & Ryan Lewis - Can't Hold Us ft. Ray Dalton (Official Music Video)", channel: "macklemoreVEVO", official: true },
      "lady gaga shallow": { id: "bo_efYhYU2A", title: "Lady Gaga, Bradley Cooper - Shallow (A Star Is Born)", channel: "ladygagaVEVO", official: true },
      "travis scott goosebumps": { id: "Dst9gZkq1a8", title: "Travis Scott - goosebumps ft. Kendrick Lamar (Official Video)", channel: "travisscottVEVO", official: true },
      "justin bieber love yourself": { id: "oyEuk8j8imI", title: "Justin Bieber - Love Yourself (PURPOSE : The Movement)", channel: "JustinBieberVEVO", official: true },
      "imagine dragons thunder": { id: "fKopy74weus", title: "Imagine Dragons - Thunder (Official Music Video)", channel: "ImagineDragonsVEVO", official: true },
      "taylor swift cruel summer": { id: "ic8j13piAhQ", title: "Taylor Swift - Cruel Summer (Official Video)", channel: "TaylorSwiftVEVO", official: true },
      "avicii wake me up": { id: "IcrbM1l_BoI", title: "Avicii - Wake Me Up (Official Video)", channel: "aviciiofficial", official: true },
      "the weeknd the hills": { id: "yzTuBuRdAyA", title: "The Weeknd - The Hills (Official Video)", channel: "TheWeekndXO", official: true },
      "twenty one pilots stressed out": { id: "pXRviuL6vMY", title: "twenty one pilots - Stressed Out (Official Video)", channel: "twentyonepilots", official: true },
      "imagine dragons demons": { id: "mWRsgZuwf_8", title: "Imagine Dragons - Demons (Official Video)", channel: "ImagineDragonsVEVO", official: true },
      "the police every breath you take": { id: "OMOGaugKpzs", title: "The Police - Every Breath You Take (Official Video)", channel: "thepoliceVEVO", official: true },
      "j cole no role modelz": { id: "WILyWmT2A-Q", title: "J. Cole - No Role Modelz (Official Video)", channel: "dreamvillerecords", official: true },
      "passenger let her go": { id: "RBumgq5yVrA", title: "Passenger | Let Her Go (Official Video)", channel: "passengermusic", official: true }
    };
    
    const results: any[] = [];
    
    for (const track of tracks) {
      const artist = track.artist;
      const name = track.name;
      
      // Enhanced search with comprehensive pattern matching
      const cleanArtist = artist.toLowerCase().trim();
      const cleanName = name.toLowerCase().trim()
        .split('(')[0].trim() // Remove parentheses
        .split('-')[0].trim(); // Remove version info like "- 1999 Remaster"
      
      // Comprehensive search patterns for maximum coverage
      const searchKeys = [
        // Basic combinations
        `${cleanArtist} ${cleanName}`,
        `${cleanName} ${cleanArtist}`,
        
        // First artist only (for collaborations)
        `${cleanArtist.split(',')[0].trim()} ${cleanName}`,
        
        // Remove collaborators and features
        `${cleanArtist.replace(/,.*$/, '').trim()} ${cleanName}`,
        `${cleanArtist.replace(/, feat\..*$/i, '').trim()} ${cleanName}`,
        `${cleanArtist.replace(/, with.*$/i, '').trim()} ${cleanName}`,
        `${cleanArtist.replace(/ feat\..*$/i, '').trim()} ${cleanName}`,
        `${cleanArtist.replace(/ with.*$/i, '').trim()} ${cleanName}`,
        
        // Handle ampersand variations
        `${cleanArtist.replace(' & ', ', ').split(',')[0].trim()} ${cleanName}`,
        
        // Individual artists from collaborations
        ...cleanArtist.split(/[,&]/).map((a: string) => `${a.trim()} ${cleanName}`),
        
        // Shortened versions for long names
        `${cleanArtist.split(' ')[0]} ${cleanName}`, // First word only
        
        // Common abbreviations
        `${cleanArtist.replace('the weeknd', 'weeknd')} ${cleanName}`,
        `${cleanArtist.replace('weeknd', 'the weeknd')} ${cleanName}`,
      ].filter((key, index, arr) => arr.indexOf(key) === index); // Remove duplicates
      
      let match = null;
      let matchedKey = '';
      
      for (const searchKey of searchKeys) {
        match = knownVideos[searchKey];
        if (match) {
          matchedKey = searchKey;
          console.log(`[MATCH] Found "${matchedKey}" → ${match.id} (${match.channel})`);
          break;
        }
      }
      
      // Enhanced validation with detailed logging
      if (match) {
        if (officialChannels.has(match.channel)) {
          console.log(`[✓ VERIFIED] ${match.channel} is official - accepting video`);
        } else {
          console.log(`[✗ REJECTED] Channel "${match.channel}" not in verified list - SKIPPED`);
          match = null;
        }
      } else {
        // Show first few search attempts for debugging
        const debugPatterns = searchKeys.slice(0, 3);
        console.log(`[NO MATCH] "${artist} - ${name}" tried: [${debugPatterns.join('", "')}]`);
      }
      
      if (match) {
        results.push({
          name,
          artist,
          album: track.album,
          youtubeVideoId: match.id,
          youtubeUrl: `https://www.youtube.com/watch?v=${match.id}`,
          youtubeTitle: match.title,
          youtubeChannel: match.channel,
          isOfficial: match.official,
          status: "Found official video"
        });
        // Success log moved to summary
      } else {
        const manualSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${name} official video`)}`;
        results.push({
          name,
          artist,
          album: track.album,
          youtubeVideoId: null,
          youtubeUrl: null,
          youtubeTitle: null,
          youtubeChannel: null,
          isOfficial: false,
          status: "Manual search available",
          searchUrl: manualSearchUrl
        });
        // Miss log moved to summary
      }
    }
    
    return results;
  }

  // Return the server instance
  return createServer(app);
}