import { searchTrackOnYouTube, fetchSpotifyPlaylist } from './routes_new.js';

interface FastJob {
  id: string;
  playlistId: string;
  tracks: any[];
  results: any[];
  status: 'processing' | 'completed' | 'failed';
  startTime: number;
  stats: {
    total: number;
    processed: number;
    found: number;
    failed: number;
    successRate: number;
  };
}

// In-memory fast job storage
const fastJobs = new Map<string, FastJob>();

export class FastProcessor {
  private static instance: FastProcessor;

  static getInstance(): FastProcessor {
    if (!FastProcessor.instance) {
      FastProcessor.instance = new FastProcessor();
    }
    return FastProcessor.instance;
  }

  async startFastProcessing(playlistId: string): Promise<string> {
    const jobId = `fast_${playlistId}_${Date.now()}`;
    
    console.log(`[Fast Processor] Starting job ${jobId}`);
    
    // Create job
    const job: FastJob = {
      id: jobId,
      playlistId,
      tracks: [],
      results: [],
      status: 'processing',
      startTime: Date.now(),
      stats: {
        total: 0,
        processed: 0,
        found: 0,
        failed: 0,
        successRate: 0
      }
    };

    fastJobs.set(jobId, job);
    
    // Start processing without blocking
    this.processFast(jobId);
    
    return jobId;
  }

  private async processFast(jobId: string) {
    const job = fastJobs.get(jobId);
    if (!job) return;

    try {
      // 1. Fetch Spotify playlist data
      console.log(`[Fast] Fetching Spotify playlist ${job.playlistId}`);
      const playlistData = await fetchSpotifyPlaylist(job.playlistId);
      
      job.tracks = playlistData.tracks;
      job.stats.total = job.tracks.length;
      
      console.log(`[Fast] Processing ${job.tracks.length} tracks with maximum concurrency`);
      
      // 2. Process ALL tracks in parallel with aggressive batching
      const CONCURRENT_BATCH_SIZE = 50; // Process 50 tracks simultaneously
      const results: any[] = [];
      
      for (let i = 0; i < job.tracks.length; i += CONCURRENT_BATCH_SIZE) {
        const batch = job.tracks.slice(i, i + CONCURRENT_BATCH_SIZE);
        console.log(`[Fast] Processing batch ${Math.floor(i/CONCURRENT_BATCH_SIZE) + 1} (tracks ${i+1}-${Math.min(i + CONCURRENT_BATCH_SIZE, job.tracks.length)})`);
        
        // Process entire batch in parallel
        const batchPromises = batch.map(async (track, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            // Single fast search attempt
            const searchResult = await this.fastSearch(track.artist, track.name);
            
            if (searchResult) {
              job.stats.found++;
              return {
                name: track.name,
                artist: track.artist,
                youtubeVideoId: searchResult.videoId,
                youtubeUrl: `https://www.youtube.com/watch?v=${searchResult.videoId}`,
                youtubeTitle: searchResult.title,
                youtubeChannel: searchResult.channel,
                isOfficial: searchResult.isOfficial,
                status: "Found"
              };
            } else {
              job.stats.failed++;
              return {
                name: track.name,
                artist: track.artist,
                youtubeVideoId: null,
                youtubeUrl: null,
                youtubeTitle: null,
                youtubeChannel: null,
                isOfficial: false,
                status: "Not found"
              };
            }
          } catch (error) {
            job.stats.failed++;
            return {
              name: track.name,
              artist: track.artist,
              youtubeVideoId: null,
              youtubeUrl: null,
              youtubeTitle: null,
              youtubeChannel: null,
              isOfficial: false,
              status: "Error",
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        });
        
        // Wait for batch completion
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Update stats
        job.stats.processed = results.length;
        job.stats.successRate = job.stats.found > 0 ? Math.round((job.stats.found / job.stats.processed) * 100) : 0;
        
        console.log(`[Fast] Batch complete: ${job.stats.processed}/${job.stats.total} (${job.stats.successRate}% success)`);
      }
      
      // 3. Complete job
      job.results = results;
      job.status = 'completed';
      
      const duration = (Date.now() - job.startTime) / 1000;
      console.log(`[Fast] Job ${jobId} completed in ${duration}s - ${job.stats.found}/${job.stats.total} found (${job.stats.successRate}%)`);
      
    } catch (error) {
      console.error(`[Fast] Job ${jobId} failed:`, error);
      job.status = 'failed';
    }
  }

  private async fastSearch(artist: string, song: string): Promise<{
    videoId: string;
    title: string;
    channel: string;
    isOfficial: boolean;
  } | null> {
    try {
      // Single optimized search with timeout
      const searchResult = await Promise.race([
        searchTrackOnYouTube(artist, song),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)) // 3s timeout
      ]) as any;
      
      if (searchResult?.bestVideo) {
        return {
          videoId: searchResult.bestVideo.videoId,
          title: searchResult.bestVideo.title,
          channel: searchResult.bestVideo.channelTitle,
          isOfficial: searchResult.bestVideo.isOfficial || false
        };
      }
      
      return null;
    } catch (error) {
      // Fail fast on any error
      return null;
    }
  }

  getJobStatus(jobId: string) {
    const job = fastJobs.get(jobId);
    if (!job) {
      return { error: 'Job not found' };
    }

    const duration = (Date.now() - job.startTime) / 1000;
    const estimatedTotal = job.stats.processed > 0 ? 
      (duration / job.stats.processed) * job.stats.total : 0;
    const estimatedRemaining = Math.max(0, estimatedTotal - duration);

    return {
      jobId: job.id,
      playlistId: job.playlistId,
      status: job.status,
      progress: {
        current: job.stats.processed,
        total: job.stats.total,
        percentage: job.stats.total > 0 ? Math.round((job.stats.processed / job.stats.total) * 100) : 0,
        found: job.stats.found,
        failed: job.stats.failed,
        successRate: job.stats.successRate
      },
      timing: {
        startTime: job.startTime,
        lastUpdate: Date.now(),
        estimatedTimeRemaining: Math.round(estimatedRemaining)
      },
      results: job.status === 'completed' ? job.results : undefined
    };
  }

  getCompletedJob(jobId: string) {
    const job = fastJobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return null;
    }

    // Create playlist format
    const foundTracks = job.results.filter(track => track.status === 'Found');
    const youtubePlaylistUrl = foundTracks.length > 0 ? 
      `https://www.youtube.com/watch_videos?video_ids=${foundTracks.map(t => t.youtubeVideoId).join(',')}` : null;

    return {
      name: `Converted from Spotify`,
      totalTracks: job.stats.total,
      convertedTracks: job.stats.found,
      successRate: job.stats.successRate,
      youtubePlaylistUrl,
      tracks: job.results,
      originalUrl: `https://open.spotify.com/playlist/${job.playlistId}`,
      processingTime: (Date.now() - job.startTime) / 1000
    };
  }
}