import * as ytSearchModule from 'youtube-search-without-api-key';

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
  private async searchSingleTrack(artist: string, song: string, timeoutMs: number = 5000): Promise<ConversionResult> {
    // Clean up artist and song names for better search
    const cleanArtist = artist.replace(/\s*,\s*/g, ' ').replace(/\s*feat\.?\s*/gi, ' ').replace(/\s+/g, ' ').trim();
    const cleanSong = song.replace(/\s*\([^)]*\)\s*/g, '').replace(/\s*-\s*[^-]*$/, '').replace(/\s+/g, ' ').trim();
    
    // Try multiple search strategies for better success rate
    const queries = [
      `${cleanArtist} ${cleanSong} official video`,
      `${cleanArtist} ${cleanSong} official`,
      `${cleanArtist} ${cleanSong} music video`,
      `${cleanArtist} ${cleanSong}`,
      `${cleanSong} ${cleanArtist}`,
      `${cleanSong} official video`
    ];
    
    for (const query of queries) {
      try {
        console.log(`[YouTube Search] "${query}"`);
        
        const results = await Promise.race([
          (ytSearchModule as any).search(query, { maxResults: 8 }),
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
        
        // If first query fails, try next one
        console.log(`  No results for: ${query}, trying next search...`);
        
      } catch (error) {
        console.log(`  Search failed for "${query}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        continue; // Try next query
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

  async convertPlaylist(tracks: Track[], maxTracks?: number): Promise<{
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
    const tracksToProcess = maxTracks || tracks.length;
    const actualTracks = tracks.slice(0, tracksToProcess);
    
    console.log(`[Simple Converter] Starting conversion`);
    console.log(`Processing: ${tracksToProcess} out of ${tracks.length} tracks`);
    console.log(`Target: Find at least ${Math.ceil(tracksToProcess * 0.9)} tracks (90% success rate)`);
    
    const results: ConversionResult[] = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < tracksToProcess; i += BATCH_SIZE) {
      const batch = actualTracks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tracksToProcess / BATCH_SIZE);
      
      console.log(`[Batch ${batchNum}/${totalBatches}] Processing tracks ${i + 1}-${Math.min(i + BATCH_SIZE, tracksToProcess)}`);
      
      // Process batch in parallel with 2-second timeout per track
      const batchPromises = batch.map(track => 
        this.searchSingleTrack(track.artist, track.name, 2000)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      const found = results.filter(r => r.status === 'found').length;
      const processed = results.length;
      const successRate = Math.round((found / processed) * 100);
      
      console.log(`[Batch ${batchNum}] Complete: ${found}/${processed} found (${successRate}%)`);
      
      // Report progress every 5 batches
      if (batchNum % 5 === 0) {
        const overallSuccessRate = Math.round((found / processed) * 100);
        const target = Math.ceil(tracks.length * 0.9);
        console.log(`=== PROGRESS UPDATE: Batch ${batchNum}/${totalBatches} ===`);
        console.log(`Overall: ${found}/${processed} tracks found (${overallSuccessRate}%)`);
        console.log(`Target (90%): ${target} tracks needed | Current pace: ${overallSuccessRate >= 90 ? '✅ ON TARGET' : '⚠️ BELOW TARGET'}`);
        console.log(`Estimated remaining: ${Math.round((totalBatches - batchNum) * 0.3)} minutes`);
      }
      
      // Small delay between batches to prevent overwhelming
      if (i + BATCH_SIZE < tracksToProcess) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const found = results.filter(r => r.status === 'found').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const successRate = Math.round((found / tracksToProcess) * 100);
    const target = Math.ceil(tracksToProcess * 0.9); // 90% target
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Total tracks processed: ${tracksToProcess}`);
    console.log(`Successfully found: ${found}`);
    console.log(`Failed to find: ${failed}`);
    console.log(`Success rate: ${successRate}%`);
    console.log(`Target (90%): ${target} tracks`);
    console.log(`Status: ${found >= target ? '✅ TARGET ACHIEVED' : '❌ TARGET NOT MET'}`);
    
    return {
      results,
      stats: {
        total: tracksToProcess,
        found,
        failed,
        successRate,
        target,
        targetMet: found >= target
      }
    };
  }
}

export const simpleConverter = new SimpleConverter();