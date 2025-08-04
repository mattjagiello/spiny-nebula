import { searchTrackOnYouTube } from './routes_new.js';

interface ProcessingJob {
  id: string;
  playlistId: string;
  tracks: any[];
  processedTracks: any[];
  currentIndex: number;
  status: 'processing' | 'completed' | 'paused' | 'failed';
  startTime: number;
  lastUpdate: number;
  stats: {
    total: number;
    processed: number;
    found: number;
    failed: number;
  };
}

// In-memory job storage (could be replaced with database)
const processingJobs = new Map<string, ProcessingJob>();

export class BackgroundProcessor {
  private static instance: BackgroundProcessor;
  private isRunning = false;
  private currentJobId: string | null = null;

  static getInstance(): BackgroundProcessor {
    if (!BackgroundProcessor.instance) {
      BackgroundProcessor.instance = new BackgroundProcessor();
    }
    return BackgroundProcessor.instance;
  }

  async startProcessing(playlistId: string, tracks: any[]): Promise<string> {
    const jobId = `${playlistId}_${Date.now()}`;
    
    const job: ProcessingJob = {
      id: jobId,
      playlistId,
      tracks,
      processedTracks: [],
      currentIndex: 0,
      status: 'processing',
      startTime: Date.now(),
      lastUpdate: Date.now(),
      stats: {
        total: tracks.length,
        processed: 0,
        found: 0,
        failed: 0
      }
    };

    processingJobs.set(jobId, job);
    
    // Start background processing without blocking
    this.processJobInBackground(jobId);
    
    return jobId;
  }

  private async processJobInBackground(jobId: string) {
    const job = processingJobs.get(jobId);
    if (!job) return;

    console.log(`[Background Processor] Starting job ${jobId} - ${job.stats.total} tracks`);
    
    while (job.currentIndex < job.tracks.length && job.status === 'processing') {
      const track = job.tracks[job.currentIndex];
      
      try {
        console.log(`[${job.currentIndex + 1}/${job.stats.total}] Processing: ${track.artist} - ${track.name}`);
        
        // Process track with multiple attempts and strategies
        const result = await this.processTrackWithRetries(track);
        
        if (result.success) {
          job.processedTracks.push({
            ...track,
            youtubeVideoId: result.videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${result.videoId}`,
            youtubeTitle: result.title,
            youtubeChannel: result.channel,
            isOfficial: result.isOfficial,
            viewCount: result.viewCount,
            status: "Found"
          });
          job.stats.found++;
          console.log(`  ✓ Found: ${result.title} (${result.viewCount?.toLocaleString()} views)`);
        } else {
          job.processedTracks.push({
            ...track,
            youtubeVideoId: null,
            youtubeUrl: null,
            youtubeTitle: null,
            youtubeChannel: null,
            isOfficial: false,
            status: "Not found",
            error: result.error
          });
          job.stats.failed++;
          console.log(`  ✗ Failed: ${result.error}`);
        }
        
        job.stats.processed++;
        job.currentIndex++;
        job.lastUpdate = Date.now();
        
        // Brief pause to prevent overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.log(`  ✗ Error processing ${track.artist} - ${track.name}: ${error}`);
        job.processedTracks.push({
          ...track,
          youtubeVideoId: null,
          youtubeUrl: null,
          youtubeTitle: null,
          youtubeChannel: null,
          isOfficial: false,
          status: "Error",
          error: error instanceof Error ? error.message : 'Processing error'
        });
        job.stats.failed++;
        job.stats.processed++;
        job.currentIndex++;
        job.lastUpdate = Date.now();
      }
    }
    
    job.status = 'completed';
    job.lastUpdate = Date.now();
    
    const successRate = ((job.stats.found / job.stats.total) * 100).toFixed(1);
    console.log(`[Background Processor] Job ${jobId} completed: ${job.stats.found}/${job.stats.total} (${successRate}%)`);
  }

  private async processTrackWithRetries(track: any): Promise<{
    success: boolean;
    videoId?: string;
    title?: string;
    channel?: string;
    isOfficial?: boolean;
    viewCount?: number;
    error?: string;
  }> {
    const maxAttempts = 3;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const searchResult = await Promise.race([
          searchTrackOnYouTube(track.artist, track.name),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout')), 15000)
          )
        ]) as any;
        
        if (searchResult?.bestVideo) {
          return {
            success: true,
            videoId: searchResult.bestVideo.videoId,
            title: searchResult.bestVideo.title,
            channel: searchResult.bestVideo.channelTitle,
            isOfficial: searchResult.bestVideo.isOfficial,
            viewCount: searchResult.bestVideo.viewCount
          };
        }
        
        // If no result, wait before retry
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
        
      } catch (error) {
        console.log(`    Attempt ${attempt} failed: ${error}`);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    
    return {
      success: false,
      error: `No results found after ${maxAttempts} attempts`
    };
  }

  getJobStatus(jobId: string): ProcessingJob | null {
    return processingJobs.get(jobId) || null;
  }

  getAllJobs(): ProcessingJob[] {
    return Array.from(processingJobs.values());
  }

  pauseJob(jobId: string): boolean {
    const job = processingJobs.get(jobId);
    if (job && job.status === 'processing') {
      job.status = 'paused';
      return true;
    }
    return false;
  }

  resumeJob(jobId: string): boolean {
    const job = processingJobs.get(jobId);
    if (job && job.status === 'paused') {
      job.status = 'processing';
      this.processJobInBackground(jobId);
      return true;
    }
    return false;
  }

  deleteJob(jobId: string): boolean {
    return processingJobs.delete(jobId);
  }

  // Clean up old completed jobs
  cleanupOldJobs() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [jobId, job] of processingJobs.entries()) {
      if (job.status === 'completed' && (now - job.lastUpdate) > maxAge) {
        processingJobs.delete(jobId);
        console.log(`[Background Processor] Cleaned up old job: ${jobId}`);
      }
    }
  }
}