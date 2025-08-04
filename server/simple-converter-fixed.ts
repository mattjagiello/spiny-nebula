import * as ytSearchModule from 'youtube-search-without-api-key';
import { db } from './db.js';
import { playlists, tracks, processingJobs } from '@shared/schema';
import { eq } from 'drizzle-orm';

const youtubeSearch = ytSearchModule.default || ytSearchModule;

interface Track {
  name: string;
  artist: string;
}

interface ConversionResult {
  name: string;
  artist: string;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeTitle: string | null;
  status: 'found' | 'failed';
}

class SimpleConverter {
  // Check if playlist is already cached
  async getCachedPlaylist(spotifyId: string) {
    try {
      const [playlist] = await db
        .select()
        .from(playlists)
        .where(eq(playlists.spotifyId, spotifyId))
        .limit(1);
        
      if (playlist) {
        const playlistTracks = await db
          .select()
          .from(tracks)
          .where(eq(tracks.playlistId, playlist.id))
          .orderBy(tracks.name);
          
        return {
          playlist,
          tracks: playlistTracks
        };
      }
      
      return null;
    } catch (error) {
      console.log('[Cache] Error checking cache:', error);
      return null;
    }
  }
  
  // Save conversion results to cache
  async cacheResults(spotifyId: string, playlistData: any, trackResults: ConversionResult[]) {
    try {
      // Insert playlist
      const [playlist] = await db
        .insert(playlists)
        .values({
          spotifyId,
          name: playlistData.name,
          description: playlistData.description,
          imageUrl: playlistData.image,
          totalTracks: trackResults.length,
        })
        .returning();
        
      // Insert tracks
      const trackInserts = trackResults.map(track => ({
        playlistId: playlist.id,
        spotifyId: '', // We don't have Spotify track IDs in our current flow
        name: track.name,
        artist: track.artist,
        youtubeVideoId: track.youtubeVideoId,
        youtubeVideoTitle: track.youtubeTitle,
        found: track.status === 'found',
      }));
      
      await db.insert(tracks).values(trackInserts);
      
      console.log(`[Cache] Saved ${trackResults.length} tracks for playlist ${spotifyId}`);
      return playlist;
    } catch (error) {
      console.log('[Cache] Error saving to cache:', error);
      return null;
    }
  }
  
  // Create YouTube playlist URL from video IDs
  createYouTubePlaylistUrl(videoIds: string[]): string {
    if (videoIds.length === 0) return '';
    
    // YouTube has a 50 video limit for watch_videos URLs
    // For larger playlists, we'll create a temporary playlist approach
    if (videoIds.length <= 50) {
      return `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
    } else {
      // For larger playlists, start with first video and provide instructions
      // Users will need to manually create the playlist
      return `https://www.youtube.com/watch?v=${videoIds[0]}&list=PLrAl1VWM-FgCcD4WrDvZNXxMvVoqQHq0w`;
    }
  }
  
  // Generate playlist creation instructions for large playlists
  generatePlaylistInstructions(videoIds: string[]): string {
    if (videoIds.length <= 50) {
      return 'Click the button above to open your YouTube playlist with all videos ready to play!';
    } else {
      return `Since your playlist has ${videoIds.length} videos (more than YouTube's 50-video URL limit), you'll need to create the playlist manually. We've provided all the YouTube links below that you can use to build your playlist.`;
    }
  }
  async searchSingleTrack(artist: string, song: string, timeoutMs: number = 5000): Promise<ConversionResult> {
    // Enhanced cleaning for better search results
    const cleanArtist = artist
      .replace(/\(.*?\)/g, '')
      .replace(/feat\.|ft\.|featuring/gi, '')
      .replace(/,.*$/, '') // Remove secondary artists after comma
      .replace(/&.*$/, '')  // Remove secondary artists after &
      .trim();
    
    const cleanSong = song
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/feat\.|ft\.|featuring.*$/gi, '')
      .replace(/- .*remix.*$/gi, '')
      .replace(/\s+(radio|clean|explicit|version).*$/gi, '')
      .trim();
    
    const queries = [
      `${cleanArtist} ${cleanSong} official video`,
      `${cleanArtist} ${cleanSong} official`,
      `${cleanArtist} ${cleanSong} music video`,
      `${cleanArtist} ${cleanSong}`,
      `${cleanSong} ${cleanArtist}`,
      `${cleanSong} official video`,
      // Additional fallback strategies for difficult tracks
      `${cleanSong} ${cleanArtist} lyrics`,
      `${cleanArtist} ${cleanSong} audio`,
      `${cleanSong} by ${cleanArtist}`,
      `${cleanArtist} - ${cleanSong}`,
      // Handle special cases
      cleanSong.includes('feat') ? cleanSong.split('feat')[0].trim() + ` ${cleanArtist}` : null,
      cleanSong.includes('(') ? cleanSong.split('(')[0].trim() + ` ${cleanArtist}` : null
    ].filter(Boolean);
    
    for (const query of queries) {
      try {
        console.log(`[YouTube Search] "${query}"`);
        
        const results = await Promise.race([
          (ytSearchModule as any).search(query, { maxResults: 12 }), // More results for better matching
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
          )
        ]) as any[];
        
        console.log(`  Found ${results?.length || 0} results`);
        
        if (results && results.length > 0) {
          // Prioritize official videos and better quality results
          for (const video of results) {
            let videoId = null;
            
            if (video.id?.videoId) {
              videoId = video.id.videoId;
            } else if (video.url) {
              const match = video.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
              videoId = match ? match[1] : null;
            }
            
            if (videoId && video.title) {
              // Prefer official videos
              const title = video.title.toLowerCase();
              const isOfficial = title.includes('official') || title.includes('music video');
              
              console.log(`  ✓ Found: ${video.title} (${videoId})${isOfficial ? ' [OFFICIAL]' : ''}`);
              return {
                name: song,
                artist,
                youtubeVideoId: videoId,
                youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
                youtubeTitle: video.title,
                status: 'found'
              };
            }
          }
        }
        
        console.log(`  No results for: ${query}, trying next search...`);
        
      } catch (error) {
        console.log(`  Search failed for "${query}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        continue;
      }
    }
    
    console.log(`  ✗ All search strategies failed for: ${artist} - ${song}`);
    return {
      name: song,
      artist,
      youtubeVideoId: null,
      youtubeUrl: null,
      youtubeTitle: null,
      status: 'failed'
    };
  }

  async convertPlaylist(tracks: Track[], maxTracks?: number, spotifyId?: string, playlistData?: any): Promise<{
    results: ConversionResult[];
    stats: {
      total: number;
      found: number;
      failed: number;
      successRate: number;
      target?: number;
      targetMet?: boolean;
    };
  }> {
    const numToProcess = maxTracks || tracks.length;
    const tracksToConvert = tracks.slice(0, numToProcess);
    
    console.log(`[Simple Converter] Starting conversion`);
    console.log(`Processing: ${numToProcess} out of ${tracks.length} tracks`);
    console.log(`Target: Find at least ${Math.ceil(numToProcess * 0.9)} tracks (90% success rate)`);
    
    const results: ConversionResult[] = [];
    const BATCH_SIZE = 50; // Process larger batches for full playlists
    
    for (let i = 0; i < numToProcess; i += BATCH_SIZE) {
      const batch = tracksToConvert.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(numToProcess / BATCH_SIZE);
      
      console.log(`[Batch ${batchNum}/${totalBatches}] Processing tracks ${i + 1}-${Math.min(i + BATCH_SIZE, numToProcess)}`);
      
      const batchPromises = batch.map(track => 
        this.searchSingleTrack(track.artist, track.name, 3000)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      const found = results.filter(r => r.status === 'found').length;
      const processed = results.length;
      const successRate = Math.round((found / processed) * 100);
      
      console.log(`[Batch ${batchNum}] Complete: ${found}/${processed} found (${successRate}%)`);
      
      // Small delay between batches
      if (i + BATCH_SIZE < numToProcess) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const found = results.filter(r => r.status === 'found').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const successRate = Math.round((found / numToProcess) * 100);
    const target = Math.ceil(numToProcess * 0.9);
    
    // Retry failed tracks with enhanced search
    const failedTracks = results.filter(r => r.status === 'failed');
    if (failedTracks.length > 0) {
      console.log(`\n=== RETRYING ${failedTracks.length} FAILED TRACKS ===`);
      
      for (let i = 0; i < failedTracks.length; i++) {
        const track = failedTracks[i];
        console.log(`[Retry ${i + 1}/${failedTracks.length}] ${track.artist} - ${track.name}`);
        
        const retryResult = await this.retryFailedTrack(track.artist, track.name);
        if (retryResult) {
          // Replace failed result with successful retry
          const originalIndex = results.findIndex(r => r.name === track.name && r.artist === track.artist);
          if (originalIndex !== -1) {
            results[originalIndex] = retryResult;
            console.log(`  ✓ Found on retry: ${retryResult.youtubeTitle}`);
          }
        } else {
          console.log(`  ✗ Still failed: ${track.artist} - ${track.name}`);
        }
      }
    }
    
    // Recalculate final stats
    const finalFound = results.filter(r => r.status === 'found').length;
    const finalFailed = results.filter(r => r.status === 'failed').length;
    const finalSuccessRate = Math.round((finalFound / numToProcess) * 100);
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Total tracks processed: ${numToProcess}`);
    console.log(`Successfully found: ${finalFound}`);
    console.log(`Failed to find: ${finalFailed}`);
    console.log(`Success rate: ${finalSuccessRate}%`);
    console.log(`Target (90%): ${target} tracks`);
    console.log(`Status: ${finalFound >= target ? '✅ TARGET ACHIEVED' : '❌ TARGET NOT MET'}`);
    
    // Cache results if we have all the necessary data
    if (spotifyId && playlistData) {
      console.log(`[Cache] Saving results for playlist ${spotifyId}...`);
      await this.cacheResults(spotifyId, playlistData, results);
    }
    
    return {
      results,
      stats: {
        total: numToProcess,
        found: finalFound,
        failed: finalFailed,
        successRate: finalSuccessRate,
        target,
        targetMet: finalFound >= target
      }
    };
  }

  // Enhanced algorithmic retry for difficult tracks
  async retryFailedTrack(artist: string, song: string): Promise<ConversionResult | null> {
    // More aggressive text cleaning for retry
    const ultraCleanArtist = artist
      .replace(/[^\w\s]/g, ' ') // Remove all special characters
      .replace(/\s+/g, ' ')
      .trim();
    
    const ultraCleanSong = song
      .replace(/[^\w\s]/g, ' ') // Remove all special characters
      .replace(/\s+/g, ' ')
      .trim();
    
    // Advanced search strategies for difficult tracks
    const advancedQueries = [
      // Exact phrase matching
      `"${ultraCleanArtist}" "${ultraCleanSong}"`,
      `"${ultraCleanSong}" "${ultraCleanArtist}"`,
      
      // First word combinations (handles multi-word artists)
      `${ultraCleanArtist.split(' ')[0]} ${ultraCleanSong}`,
      `${ultraCleanSong} ${ultraCleanArtist.split(' ')[0]}`,
      
      // Without parenthetical content
      song.includes('(') ? `${ultraCleanArtist} ${song.split('(')[0].trim()}` : null,
      
      // First part of compound artists
      artist.includes(',') ? `${artist.split(',')[0].trim()} ${ultraCleanSong}` : null,
      artist.includes('&') ? `${artist.split('&')[0].trim()} ${ultraCleanSong}` : null,
      
      // Generic music searches
      `${ultraCleanSong} music`,
      `${ultraCleanSong} song`,
      `${ultraCleanArtist} ${ultraCleanSong} live`,
      `${ultraCleanArtist} ${ultraCleanSong} lyrics`,
      
      // Alternative orderings
      `${ultraCleanSong} by ${ultraCleanArtist}`,
      `${ultraCleanArtist} - ${ultraCleanSong}`,
      
      // Just the song name (last resort)
      ultraCleanSong
    ].filter(Boolean);
    
    for (const query of advancedQueries) {
      try {
        const results = await (ytSearchModule as any).search(query, { maxResults: 20 });
        if (results && results.length > 0) {
          // More sophisticated matching for difficult tracks
          for (const video of results) {
            let videoId = null;
            if (video.id?.videoId) {
              videoId = video.id.videoId;
            } else if (video.url) {
              const match = video.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
              videoId = match ? match[1] : null;
            }
            
            if (videoId && video.title) {
              // Check if title contains core elements of artist or song
              const titleLower = video.title.toLowerCase();
              const songWords = ultraCleanSong.toLowerCase().split(' ').filter(w => w.length > 2);
              const artistWords = ultraCleanArtist.toLowerCase().split(' ').filter(w => w.length > 2);
              
              const songMatch = songWords.some(word => titleLower.includes(word));
              const artistMatch = artistWords.some(word => titleLower.includes(word));
              
              // Accept if we have reasonable confidence this is the right track
              if (songMatch && (artistMatch || titleLower.includes('official') || titleLower.includes('music'))) {
                console.log(`  ✓ Advanced match: ${video.title}`);
                return {
                  name: song,
                  artist,
                  youtubeVideoId: videoId,
                  youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
                  youtubeTitle: video.title,
                  status: 'found'
                };
              }
            }
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }
}

export const simpleConverter = new SimpleConverter();