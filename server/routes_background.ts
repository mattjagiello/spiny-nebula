import express from 'express';
import { BackgroundProcessor } from './background-processor.js';
import { fetchSpotifyPlaylist } from './routes_new.js';

const router = express.Router();
const processor = BackgroundProcessor.getInstance();

// Start background processing for a playlist
router.post('/start-background-processing', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || !url.includes('spotify.com/playlist/')) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    const playlistId = url.split('/playlist/')[1].split('?')[0];
    console.log(`[Background API] Starting background processing for playlist ${playlistId}`);

    // Fetch playlist data
    const playlist = await fetchSpotifyPlaylist(playlistId);
    
    // Start background processing
    const jobId = await processor.startProcessing(playlistId, playlist.tracks);
    
    res.json({
      success: true,
      jobId,
      message: 'Background processing started',
      playlist: {
        id: playlistId,
        name: playlist.name,
        description: playlist.description,
        imageUrl: playlist.imageUrl,
        totalTracks: playlist.tracks.length
      }
    });
    
  } catch (error) {
    console.error('[Background API] Error starting processing:', error);
    res.status(500).json({ 
      error: 'Failed to start background processing',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get status of a background job
router.get('/job-status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = processor.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Calculate progress percentage
    const progressPercent = job.stats.total > 0 ? 
      Math.round((job.stats.processed / job.stats.total) * 100) : 0;
    
    // Calculate success rate
    const successRate = job.stats.processed > 0 ? 
      Math.round((job.stats.found / job.stats.processed) * 100) : 0;
    
    // Calculate ETA if still processing
    let estimatedTimeRemaining = null;
    if (job.status === 'processing' && job.stats.processed > 0) {
      const elapsed = Date.now() - job.startTime;
      const avgTimePerTrack = elapsed / job.stats.processed;
      const remaining = job.stats.total - job.stats.processed;
      estimatedTimeRemaining = Math.round((remaining * avgTimePerTrack) / 1000); // seconds
    }
    
    res.json({
      jobId: job.id,
      playlistId: job.playlistId,
      status: job.status,
      progress: {
        current: job.stats.processed,
        total: job.stats.total,
        percentage: progressPercent,
        found: job.stats.found,
        failed: job.stats.failed,
        successRate
      },
      timing: {
        startTime: job.startTime,
        lastUpdate: job.lastUpdate,
        estimatedTimeRemaining
      }
    });
    
  } catch (error) {
    console.error('[Background API] Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Get results of a completed job
router.get('/job-results/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = processor.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const foundTracks = job.processedTracks.filter(track => track.youtubeVideoId);
    const failedTracks = job.processedTracks.filter(track => !track.youtubeVideoId);
    
    // Generate YouTube playlist URL
    const videoIds = foundTracks.map(track => track.youtubeVideoId).join(',');
    const youtubePlaylistUrl = foundTracks.length > 0 ? 
      `https://www.youtube.com/watch_videos?video_ids=${videoIds}` : null;
    
    res.json({
      jobId: job.id,
      status: job.status,
      playlist: {
        name: `Converted Playlist (${job.stats.found} videos)`,
        totalTracks: job.stats.total,
        foundVideos: job.stats.found,
        successRate: job.stats.processed > 0 ? 
          Math.round((job.stats.found / job.stats.processed) * 100) : 0,
        youtubePlaylistUrl,
        tracks: job.processedTracks
      },
      stats: job.stats,
      timing: {
        startTime: job.startTime,
        completedTime: job.status === 'completed' ? job.lastUpdate : null,
        duration: job.lastUpdate - job.startTime
      },
      foundTracks: foundTracks.slice(0, 10), // First 10 for preview
      failedTracks: failedTracks.slice(0, 5)  // First 5 for debugging
    });
    
  } catch (error) {
    console.error('[Background API] Error getting job results:', error);
    res.status(500).json({ error: 'Failed to get job results' });
  }
});

// List all jobs
router.get('/jobs', (req, res) => {
  try {
    const jobs = processor.getAllJobs().map(job => ({
      jobId: job.id,
      playlistId: job.playlistId,
      status: job.status,
      progress: {
        current: job.stats.processed,
        total: job.stats.total,
        percentage: job.stats.total > 0 ? 
          Math.round((job.stats.processed / job.stats.total) * 100) : 0,
        successRate: job.stats.processed > 0 ? 
          Math.round((job.stats.found / job.stats.processed) * 100) : 0
      },
      startTime: job.startTime,
      lastUpdate: job.lastUpdate
    }));
    
    res.json({ jobs });
    
  } catch (error) {
    console.error('[Background API] Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// Control job (pause/resume/delete)
router.post('/job-control/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const { action } = req.body; // 'pause', 'resume', 'delete'
    
    let success = false;
    let message = '';
    
    switch (action) {
      case 'pause':
        success = processor.pauseJob(jobId);
        message = success ? 'Job paused' : 'Could not pause job';
        break;
      case 'resume':
        success = processor.resumeJob(jobId);
        message = success ? 'Job resumed' : 'Could not resume job';
        break;
      case 'delete':
        success = processor.deleteJob(jobId);
        message = success ? 'Job deleted' : 'Could not delete job';
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    res.json({ success, message });
    
  } catch (error) {
    console.error('[Background API] Error controlling job:', error);
    res.status(500).json({ error: 'Failed to control job' });
  }
});

// Cleanup old jobs (maintenance endpoint)
router.post('/cleanup', (req, res) => {
  try {
    processor.cleanupOldJobs();
    res.json({ success: true, message: 'Cleanup completed' });
  } catch (error) {
    console.error('[Background API] Error during cleanup:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

export default router;