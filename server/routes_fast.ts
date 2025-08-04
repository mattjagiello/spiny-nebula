import express from 'express';
import { FastProcessor } from './fast-processor.js';

const router = express.Router();
const fastProcessor = FastProcessor.getInstance();

// Start fast background processing
router.post('/api/start-fast-processing', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'Playlist URL is required' });
    }

    // Extract playlist ID
    const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!playlistIdMatch) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    const playlistId = playlistIdMatch[1];
    console.log(`[Fast API] Starting fast processing for playlist ${playlistId}`);
    
    const jobId = await fastProcessor.startFastProcessing(playlistId);
    
    res.json({
      success: true,
      jobId,
      message: 'Fast processing started'
    });

  } catch (error) {
    console.error('[Fast API] Error starting processing:', error);
    res.status(500).json({ 
      error: 'Failed to start processing',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get fast job status
router.get('/api/fast-job-status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = fastProcessor.getJobStatus(jobId);
    res.json(status);
  } catch (error) {
    console.error('[Fast API] Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Get completed fast job results
router.get('/api/fast-job-results/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const results = fastProcessor.getCompletedJob(jobId);
    
    if (!results) {
      return res.status(404).json({ error: 'Job not found or not completed' });
    }
    
    res.json({ playlist: results });
  } catch (error) {
    console.error('[Fast API] Error getting job results:', error);
    res.status(500).json({ error: 'Failed to get job results' });
  }
});

export default router;