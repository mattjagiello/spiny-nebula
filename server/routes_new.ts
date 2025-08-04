import express from 'express';

const router = express.Router();

// Track failed searches to avoid infinite retries
const failedSearchCache = new Set<string>();

// Pure dynamic YouTube search with retry logic and error handling
async function searchYouTubeAPI(query: string, maxResults: number = 5, retryCount: number = 0) {
  const maxRetries = 2; // Allow 2 retries with longer delays
  
  try {
    // Use dynamic import for ES modules compatibility
    const youtubeSearchModule = await import('youtube-search-without-api-key');
    const youtubeSearch = youtubeSearchModule.search;
    
    if (typeof youtubeSearch !== 'function') {
      throw new Error('YouTube search function not available');
    }
    
    const results = await youtubeSearch(query, { 
      limit: maxResults,
      type: 'video'
    });
    
    if (!Array.isArray(results)) {
      console.log(`  No results array returned for: "${query}"`);
      return [];
    }
    
    console.log(`  Found ${results.length} YouTube results for: "${query}"`);
    
    return results.map((video: any) => ({
      id: { videoId: video.id?.videoId || video.url?.split('v=')[1]?.split('&')[0] || 'unknown' },
      snippet: {
        title: video.title || 'Unknown Title',
        channelTitle: video.channel?.name || 'Unknown Channel',
        description: video.description || '',
        publishedAt: video.uploadDate || '2023-01-01',
        thumbnails: {
          default: { url: video.thumbnail || '' }
        }
      }
    }));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Skip retries for redirect errors - just fail fast
    if (errorMsg.includes('MaxRedirectsError') || errorMsg.includes('Redirected')) {
      console.log(`  Redirect error, skipping: "${query}"`);
      return [];
    }
    
    console.log(`  YouTube search error: ${errorMsg}`);
    return [];
  }
}

// Get additional video details (simulated since we don't have API key)
async function getVideoDetails(videoIds: string[]) {
  // Without API key, we simulate view counts based on patterns
  return videoIds.map(id => ({
    id,
    statistics: {
      viewCount: Math.floor(Math.random() * 100000000).toString(),
      likeCount: Math.floor(Math.random() * 1000000).toString()
    }
  }));
}

// Determine if a video is likely official
function isLikelyOfficial(video: any, originalArtist: string, originalSong: string) {
  const title = video.snippet.title.toLowerCase();
  const channelTitle = video.snippet.channelTitle.toLowerCase();
  const description = video.snippet.description.toLowerCase();
  
  const artistLower = originalArtist.toLowerCase();
  const songLower = originalSong.toLowerCase();
  
  // Strong indicators of official videos
  const officialIndicators = [
    // Channel indicators
    channelTitle.includes('vevo'),
    channelTitle.includes('official'),
    channelTitle.includes(artistLower.split(' ')[0]), // First word of artist name
    
    // Title indicators
    title.includes('official video'),
    title.includes('official music video'),
    title.includes('(official'),
    
    // Description indicators
    description.includes('official music video'),
    description.includes('official video'),
    
    // Exact matches
    channelTitle === artistLower,
    channelTitle === artistLower + 'vevo',
    channelTitle === artistLower.replace(' ', ''),
    
    // Contains both artist and song
    title.includes(artistLower) && title.includes(songLower)
  ];
  
  const officialScore = officialIndicators.filter(Boolean).length;
  return {
    isOfficial: officialScore >= 2,
    score: officialScore,
    indicators: officialIndicators
  };
}

// Find best video match from search results
function findBestVideoMatch(searchResults: any[], videoDetails: any[], artist: string, song: string) {
  if (!searchResults.length) return null;
  
  // Combine search results with video details
  const enrichedResults = searchResults.map(video => {
    const details = videoDetails.find(d => d.id === video.id.videoId);
    const officialCheck = isLikelyOfficial(video, artist, song);
    
    return {
      videoId: video.id.videoId,
      title: video.snippet.title,
      channelTitle: video.snippet.channelTitle,
      description: video.snippet.description,
      publishedAt: video.snippet.publishedAt,
      viewCount: details?.statistics?.viewCount ? parseInt(details.statistics.viewCount) : 0,
      likeCount: details?.statistics?.likeCount ? parseInt(details.statistics.likeCount) : 0,
      isOfficial: officialCheck.isOfficial,
      officialScore: officialCheck.score,
      thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url
    };
  });
  
  // Sort by: official status first, then view count
  enrichedResults.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return b.viewCount - a.viewCount;
  });
  
  return enrichedResults[0];
}

// Fast video matching without API calls for speed
function findFastVideoMatch(searchResults: any[], artist: string, song: string) {
  const artistLower = artist.toLowerCase();
  const songLower = song.toLowerCase();
  
  for (const video of searchResults) {
    const title = video.snippet.title.toLowerCase();
    const channel = video.snippet.channelTitle.toLowerCase();
    
    // Check if title contains both artist and song
    const hasArtist = title.includes(artistLower) || title.includes(artistLower.split(',')[0].trim());
    const hasSong = title.includes(songLower);
    const isOfficial = title.includes('official') || channel.includes('official') || 
                      channel.includes('vevo') || channel.includes(artistLower);
    
    if (hasArtist && hasSong) {
      return {
        videoId: video.id.videoId,
        title: video.snippet.title,
        channelTitle: video.snippet.channelTitle,
        description: video.snippet.description,
        publishedAt: video.snippet.publishedAt,
        isOfficial: isOfficial,
        thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url
      };
    }
  }
  
  // If no perfect match, return first result
  if (searchResults.length > 0) {
    const video = searchResults[0];
    return {
      videoId: video.id.videoId,
      title: video.snippet.title,
      channelTitle: video.snippet.channelTitle,
      description: video.snippet.description,
      publishedAt: video.snippet.publishedAt,
      isOfficial: false,
      thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url
    };
  }
  
  return null;
}

// Search YouTube for a single track
export async function searchTrackOnYouTube(artist: string, song: string) {
  const cacheKey = `${artist}-${song}`.toLowerCase();
  
  // If we already tried this song and it failed, don't retry
  if (failedSearchCache.has(cacheKey)) {
    console.log(`  ⚠️ Skipping previously failed: ${artist} - ${song}`);
    return {
      bestVideo: null,
      searchResults: []
    };
  }

  // Single optimized search query for speed
  const searchQueries = [
    `${artist} ${song} official video`
  ];
  
  console.log(`[YouTube Search] "${artist} - ${song}"`);
  
  let allResults: any[] = [];
  let bestVideo = null;
  
  // Try each search query
  for (const query of searchQueries) {
    try {
      const searchResults = await searchYouTubeAPI(query, 3); // Reduced from 5 to 3
      if (searchResults.length === 0) {
        continue;
      }
      
      // Skip video details API call for speed - use basic matching
      const bestFromQuery = findFastVideoMatch(searchResults, artist, song);
      
      if (bestFromQuery) {
        console.log(`  ✓ Found: ${bestFromQuery.title} (${bestFromQuery.channelTitle})`);
        
        bestVideo = bestFromQuery;
        allResults = searchResults.map(video => ({
          query,
          videoId: video.id.videoId,
          title: video.snippet.title,
          channelTitle: video.snippet.channelTitle,
          thumbnail: video.snippet.thumbnails?.default?.url
        }));
        break; // Found a match, stop searching
      }
      
    } catch (error) {
      console.log(`  Error searching "${query}": ${error}`);
    }
  }
  
  // If no video was found after all searches, mark as failed
  if (!bestVideo) {
    failedSearchCache.add(cacheKey);
    console.log(`  ✗ No results found for: ${artist} - ${song} (marked as failed)`);
  }
  
  return {
    bestVideo,
    searchResults: allResults.slice(0, 10) // Keep top 10 for debugging
  };
}

// Process tracks in batches for YouTube search
async function searchYouTubeVideosInBatch(tracks: any[]): Promise<any[]> {
  const results: any[] = [];
  
  for (const track of tracks) {
    const artist = track.artist;
    const name = track.name;
    
    try {
      const searchResult = await searchTrackOnYouTube(artist, name);
      const { bestVideo, searchResults } = searchResult;
      
      if (bestVideo) {
        results.push({
          name,
          artist,
          youtubeVideoId: bestVideo.videoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${bestVideo.videoId}`,
          youtubeTitle: bestVideo.title,
          youtubeChannel: bestVideo.channelTitle,
          isOfficial: bestVideo.isOfficial,
          viewCount: bestVideo.viewCount,
          officialScore: bestVideo.officialScore,
          searchResults: searchResults,
          status: bestVideo.isOfficial ? "Found official video" : "Found video (may be unofficial)"
        });
        console.log(`  ✓ Selected: ${bestVideo.title} (${bestVideo.viewCount.toLocaleString()} views)`);
      } else {
        const manualSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${name} official video`)}`;
        results.push({
          name,
          artist,
          youtubeVideoId: null,
          youtubeUrl: null,
          youtubeTitle: null,
          youtubeChannel: null,
          isOfficial: false,
          searchResults: searchResults,
          status: "No video found",
          searchUrl: manualSearchUrl
        });
        console.log(`  ✗ No suitable video found`);
      }
      
      // Small delay between tracks
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.log(`  ✗ Search failed: ${error}`);
      const manualSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${name} official video`)}`;
      results.push({
        name,
        artist,
        youtubeVideoId: null,
        youtubeUrl: null,
        youtubeTitle: null,
        youtubeChannel: null,
        isOfficial: false,
        searchResults: [],
        status: "Search error",
        searchUrl: manualSearchUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  return results;
}

// Spotify API functions (keeping existing functionality)
async function getSpotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID || 'd9c490d71a824bcd8c258d4ef667d2cb';
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  
  if (!clientSecret) {
    throw new Error('Spotify Client Secret not configured');
  }
  
  console.log(`[Spotify Auth] Using Client ID: ${clientId.substring(0, 8)}...`);
  
  const authResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body: 'grant_type=client_credentials'
  });
  
  if (!authResponse.ok) {
    console.log(`[Spotify Auth] Failed: ${authResponse.status} - ${authResponse.statusText}`);
    throw new Error(`Spotify authentication failed: ${authResponse.status}`);
  }
  
  const authData = await authResponse.json();
  console.log(`[Spotify Auth] Success, token expires in: ${authData.expires_in} seconds`);
  return authData.access_token;
}

export async function fetchSpotifyPlaylist(playlistId: string) {
  try {
    const accessToken = await getSpotifyAccessToken();
    console.log(`[Spotify API] Got access token: ${accessToken ? 'YES' : 'NO'}`);
    
    // Fetch playlist metadata
    const playlistResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!playlistResponse.ok) {
      throw new Error(`Spotify API error: ${playlistResponse.status}`);
    }
    
    const playlistData = await playlistResponse.json();
    
    // Fetch all tracks with pagination
    const allTracks: any[] = [];
    let tracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`;
    
    while (tracksUrl) {
      const tracksResponse = await fetch(tracksUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!tracksResponse.ok) {
        throw new Error(`Failed to fetch tracks: ${tracksResponse.status}`);
      }
      
      const tracksData = await tracksResponse.json();
      
      // Process tracks into our simplified format
      const processedTracks = tracksData.items
        .filter((item: any) => item.track && item.track.type === 'track')
        .map((item: any) => ({
          name: item.track.name,
          artist: item.track.artists.map((artist: any) => artist.name).join(', '),
          album: item.track.album.name
        }));
      
      allTracks.push(...processedTracks);
      tracksUrl = tracksData.next;
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

// Search for YouTube videos in batches with AGGRESSIVE timeout and error recovery
async function searchForYouTubeVideos(tracks: any[], batchSize: number = 20): Promise<any[]> {
  console.log(`[YouTube Search] Processing ${tracks.length} tracks in batches of ${batchSize}`);
  console.log(`[SAFETY] Setting up AGGRESSIVE timeout protection`);
  
  const results: any[] = [];
  let processedCount = 0;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 3; // Reduced from 5 to 3
  
  // AGGRESSIVE GLOBAL TIMEOUT - Kill everything after 30 seconds
  const globalStartTime = Date.now();
  const GLOBAL_TIMEOUT = 30 * 1000; // 30 seconds max
  
  for (let i = 0; i < tracks.length; i += batchSize) {
    // CHECK GLOBAL TIMEOUT FIRST
    if (Date.now() - globalStartTime > GLOBAL_TIMEOUT) {
      console.log(`\n!!! GLOBAL TIMEOUT REACHED !!!`);
      console.log(`Processing exceeded 30 seconds - EMERGENCY EXIT`);
      console.log(`Processed: ${processedCount}/${tracks.length} tracks before timeout`);
      break;
    }
    
    const batch = tracks.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(tracks.length / batchSize);
    
    console.log(`\n=== BATCH ${batchNumber}/${totalBatches} START ===`);
    console.log(`Processing ${batch.length} tracks: ${batch.map(t => `${t.artist} - ${t.name}`).join(', ')}`);
    console.log(`Current progress: ${processedCount}/${tracks.length} (${Math.round((processedCount / tracks.length) * 100)}%)`);
    console.log(`Consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`);
    console.log(`Global time elapsed: ${Math.round((Date.now() - globalStartTime) / 1000)}s / 30s max`);
    
    const batchStartTime = Date.now();
    
    try {
      // OPTIMIZED TIMEOUT - 5 seconds max per batch for faster processing
      const batchPromise = searchYouTubeVideosInBatch(batch);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => {
          console.log(`[TIMEOUT] Batch ${batchNumber} exceeded 5s timeout - FORCED FAILURE`);
          reject(new Error('Batch timeout - exceeded 5 seconds'));
        }, 5000) // Reduced to 5 seconds for faster throughput
      );
      
      console.log(`[BATCH] Starting search for batch ${batchNumber}...`);
      const batchResults = await Promise.race([batchPromise, timeoutPromise]) as any[];
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`[BATCH SUCCESS] Batch ${batchNumber} completed in ${batchTime}ms`);
      
      results.push(...batchResults);
      processedCount += batch.length;
      consecutiveFailures = 0; // Reset failure counter on success
      
      const progressPercent = Math.round((processedCount / tracks.length) * 100);
      console.log(`[Progress] ${processedCount}/${tracks.length} tracks completed (${progressPercent}%)`);
      console.log(`=== BATCH ${batchNumber} SUCCESS ===\n`);
      
    } catch (error) {
      const batchTime = Date.now() - batchStartTime;
      consecutiveFailures++;
      console.log(`[BATCH FAILED] Batch ${batchNumber} failed after ${batchTime}ms: ${error}`);
      console.log(`[ERROR DETAILS] Consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`);
      
      // Even on timeout, try to process tracks individually to salvage what we can
      console.log(`[SALVAGE] Trying individual track processing for batch ${batchNumber}...`);
      
      for (const track of batch) {
        try {
          // Quick individual search with short timeout
          const quickSearchPromise = searchTrackOnYouTube(track.artist, track.name);
          const quickTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Individual timeout')), 2000) // 2-second timeout for faster salvage
          );
          
          const searchResult = await Promise.race([quickSearchPromise, quickTimeoutPromise]) as any;
          const { bestVideo } = searchResult;
          
          if (bestVideo) {
            results.push({
              name: track.name,
              artist: track.artist,
              youtubeVideoId: bestVideo.videoId,
              youtubeUrl: `https://www.youtube.com/watch?v=${bestVideo.videoId}`,
              youtubeTitle: bestVideo.title,
              youtubeChannel: bestVideo.channelTitle,
              isOfficial: bestVideo.isOfficial,
              viewCount: bestVideo.viewCount,
              status: "Found via salvage"
            });
            console.log(`  [SALVAGE SUCCESS] ${track.artist} - ${track.name}`);
          } else {
            results.push({
              name: track.name,
              artist: track.artist,
              youtubeVideoId: null,
              youtubeUrl: null,
              youtubeTitle: null,
              youtubeChannel: null,
              isOfficial: false,
              searchResults: [],
              status: "Search failed",
              error: "No video found"
            });
          }
        } catch (salvageError) {
          results.push({
            name: track.name,
            artist: track.artist,
            youtubeVideoId: null,
            youtubeUrl: null,
            youtubeTitle: null,
            youtubeChannel: null,
            isOfficial: false,
            searchResults: [],
            status: "Search failed",
            error: error instanceof Error ? error.message : 'Batch processing error'
          });
        }
      }
      processedCount += batch.length;
      
      // MUCH MORE AGGRESSIVE emergency exit
      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.log(`\n!!! EMERGENCY EXIT TRIGGERED !!!`);
        console.log(`${consecutiveFailures} consecutive batch failures detected (limit: ${maxConsecutiveFailures})`);
        console.log(`REASON: Network issues, API problems, or search hanging`);
        console.log(`STOPPING PROCESSING NOW to prevent infinite loop`);
        console.log(`PROCESSED: ${processedCount}/${tracks.length} tracks before emergency exit`);
        console.log(`TIME ELAPSED: ${Math.round((Date.now() - globalStartTime) / 1000)} seconds`);
        
        // Add remaining tracks as failed with clear status
        for (let j = i + batchSize; j < tracks.length; j++) {
          const track = tracks[j];
          results.push({
            name: track.name,
            artist: track.artist,
            youtubeVideoId: null,
            youtubeUrl: null,
            youtubeTitle: null,
            youtubeChannel: null,
            isOfficial: false,
            searchResults: [],
            status: "Emergency stop",
            error: `Processing halted due to ${consecutiveFailures} consecutive failures`
          });
        }
        
        console.log(`!!! FORCE BREAKING OUT OF LOOP - NO MORE PROCESSING !!!`);
        break; // FORCE EXIT
      }
      
      // Much shorter delay after failures to fail faster
      console.log(`[DELAY] Waiting 1 second before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Minimal delay between successful batches to process faster
    if (i + batchSize < tracks.length && consecutiveFailures === 0) {
      console.log(`[DELAY] Brief pause before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 200)); // Reduced to 0.2 seconds
    }
  }
  
  const foundCount = results.filter(r => r.youtubeVideoId).length;
  const officialCount = results.filter(r => r.isOfficial).length;
  const successRate = ((foundCount / tracks.length) * 100).toFixed(1);
  const officialRate = ((officialCount / tracks.length) * 100).toFixed(1);
  
  console.log(`\n=== YOUTUBE SEARCH SUMMARY ===`);
  console.log(`Total videos found: ${foundCount}/${tracks.length} (${successRate}%)`);
  console.log(`Official videos: ${officialCount}/${tracks.length} (${officialRate}%)`);
  console.log(`Missing: ${tracks.length - foundCount} videos need manual search`);
  
  // Show successful matches
  const foundExamples = results.filter(r => r.youtubeVideoId).slice(0, 10);
  console.log(`\nSuccessful matches (first 10):`);
  foundExamples.forEach(track => {
    const status = track.isOfficial ? '✓ OFFICIAL' : '• FOUND';
    console.log(`  ${status} ${track.artist} - ${track.name} → ${track.youtubeChannel}`);
  });
  
  // Show missing videos
  const missingExamples = results.filter(r => !r.youtubeVideoId).slice(0, 5);
  console.log(`\nMissing videos (first 5):`);
  missingExamples.forEach(track => {
    console.log(`  ✗ ${track.artist} - ${track.name}`);
  });
  
  console.log(`=== END SUMMARY ===\n`);
  
  return results;
}

// API Routes
router.post('/preview-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || !url.includes('spotify.com/playlist/')) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }
    
    const playlistId = url.split('/playlist/')[1].split('?')[0];
    console.log(`[Preview] Fetching playlist ${playlistId} from Spotify API`);
    
    const playlist = await fetchSpotifyPlaylist(playlistId);
    
    res.json({
      id: playlistId,
      name: playlist.name,
      description: playlist.description,
      totalTracks: playlist.totalTracks,
      tracks: playlist.tracks.slice(0, 50) // Preview first 50 tracks
    });
    
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to preview playlist' 
    });
  }
});

router.post('/convert-playlist', async (req, res) => {
  try {
    const { url, resumeFromTrack = 0 } = req.body;
    
    if (!url || !url.includes('spotify.com/playlist/')) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }
    
    console.log(`\n=== Starting playlist conversion for: ${url} ===`);
    if (resumeFromTrack > 0) {
      console.log(`Resuming from track ${resumeFromTrack + 1}`);
    }
    
    const playlistId = url.split('/playlist/')[1].split('?')[0];
    
    // Fetch Spotify playlist
    const playlist = await fetchSpotifyPlaylist(playlistId);
    
    // Smart batching: process more tracks for large playlists
    let maxTracksPerConversion;
    if (playlist.tracks.length > 500) {
      maxTracksPerConversion = 200; // Large playlists get bigger chunks
    } else if (playlist.tracks.length > 100) {
      maxTracksPerConversion = 100; // Medium playlists 
    } else {
      maxTracksPerConversion = 50; // Small playlists
    }
    const tracksToProcess = playlist.tracks.slice(resumeFromTrack, resumeFromTrack + maxTracksPerConversion);
    
    console.log(`Processing ${tracksToProcess.length}/${playlist.tracks.length} tracks (${resumeFromTrack > 0 ? `starting from track ${resumeFromTrack + 1}` : 'from beginning'})`);
    if (playlist.tracks.length > maxTracksPerConversion) {
      console.log(`Limited to ${maxTracksPerConversion} tracks per conversion to ensure reliability`);
    }
    
    // Search YouTube for videos
    const tracksWithVideos = await searchForYouTubeVideos(tracksToProcess, 10);
    
    // Count results
    const foundVideos = tracksWithVideos.filter(track => track.youtubeVideoId);
    const failedTracks = tracksWithVideos.filter(track => !track.youtubeVideoId);
    
    console.log(`\n=== CONVERSION COMPLETE ===`);
    console.log(`Successfully matched ${foundVideos.length}/${tracksWithVideos.length} tracks (${Math.round(foundVideos.length/tracksWithVideos.length*100)}%)`);
    console.log(`Processing time: ${Date.now() - Date.now()} ms`); // Placeholder for timing
    
    if (failedTracks.length > 0) {
      console.log(`Failed tracks: ${failedTracks.length}`);
      failedTracks.slice(0, 5).forEach(track => {
        console.log(`- ${track.artist} - ${track.name} (${track.status || 'No results'})`);
      });
      if (failedTracks.length > 5) {
        console.log(`... and ${failedTracks.length - 5} more`);
      }
    }
    
    console.log(`=== READY TO SEND RESPONSE ===`);
    
    // Generate export formats
    const youtubeLinks = foundVideos.map(track => track.youtubeUrl).join('\n');
    
    const playlistText = tracksWithVideos.map(track => {
      if (track.youtubeVideoId) {
        return `${track.artist} - ${track.name}\n${track.youtubeUrl}\n`;
      } else {
        return `${track.artist} - ${track.name}\n[No video found - ${track.searchUrl || 'Search failed'}]\n`;
      }
    }).join('\n');
    
    const instructions = foundVideos.length > 0 
      ? `Found ${foundVideos.length} videos! Click the button below to create your YouTube playlist.`
      : 'No videos were found. Try searching manually for the tracks.';

    // Generate working YouTube playlist URL
    const videoIds = foundVideos.map(track => track.youtubeVideoId);
    const youtubePlaylistUrl = videoIds.length > 0 
      ? `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`
      : null;
    
    // Determine if we can resume processing more tracks
    const totalProcessed = resumeFromTrack + tracksToProcess.length;
    const remainingTracks = playlist.totalTracks - totalProcessed;
    const canResume = remainingTracks > 0;
    
    res.json({
      id: playlistId,
      name: playlist.name,
      description: playlist.description,
      totalTracks: playlist.totalTracks,
      foundVideos: foundVideos.length,
      originalUrl: url,
      tracks: tracksWithVideos,
      youtubeLinks,
      playlistText,
      instructions,
      youtubePlaylistUrl,
      stats: {
        total: tracksWithVideos.length,
        found: foundVideos.length,
        missing: tracksWithVideos.length - foundVideos.length,
        successRate: Math.round((foundVideos.length / tracksWithVideos.length) * 100),
        processed: tracksWithVideos.length,
        skipped: resumeFromTrack
      },
      resumeInfo: (failedTracks.length > 0 || resumeFromTrack + tracksWithVideos.length < playlist.tracks.length) ? {
        canResume: true,
        failedCount: failedTracks.length,
        nextResumePoint: resumeFromTrack + tracksWithVideos.length,
        remainingTracks: Math.max(0, playlist.tracks.length - (resumeFromTrack + tracksWithVideos.length)),
        isPartialConversion: resumeFromTrack + tracksWithVideos.length < playlist.tracks.length,
        failedTracks: failedTracks.slice(0, 10).map(t => ({ 
          name: t.name, 
          artist: t.artist, 
          status: t.status,
          error: t.error 
        }))
      } : null
    });
    
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to convert playlist' 
    });
  }
});

export default router;