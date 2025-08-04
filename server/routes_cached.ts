import express from 'express';
import { authenticateSpotify, fetchSpotifyPlaylist } from './routes.js';
import { simpleConverter } from './simple-converter-fixed.js';

const router = express.Router();

// Cached conversion endpoint
router.post('/api/simple-convert', async (req, res) => {
  try {
    const { url, maxTracks } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`[Simple API] Converting playlist: ${url}`);
    
    // Extract playlist ID
    const playlistId = url.match(/playlist\/([a-zA-Z0-9]+)/)?.[1];
    if (!playlistId) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }

    // Check cache first
    console.log(`[Cache] Checking cache for playlist ${playlistId}...`);
    const cached = await simpleConverter.getCachedPlaylist(playlistId);
    
    if (cached && (!maxTracks || cached.tracks.length >= maxTracks)) {
      console.log(`[Cache] Found cached results: ${cached.tracks.length} tracks`);
      
      // Convert cached tracks to our response format
      const cachedResults = cached.tracks.slice(0, maxTracks || cached.tracks.length).map(track => ({
        name: track.name,
        artist: track.artist,
        youtubeVideoId: track.youtubeVideoId,
        youtubeUrl: track.youtubeVideoId ? `https://www.youtube.com/watch?v=${track.youtubeVideoId}` : null,
        youtubeTitle: track.youtubeVideoTitle,
        status: track.found ? 'found' : 'failed'
      }));
      
      const foundTracks = cachedResults.filter(track => track.youtubeVideoId);
      const youtubePlaylistUrl = simpleConverter.createYouTubePlaylistUrl(
        foundTracks.map(t => t.youtubeVideoId).filter(Boolean)
      );
      
      const successRate = Math.round((foundTracks.length / cachedResults.length) * 100);
      
      return res.json({
        success: true,
        fromCache: true,
        playlist: {
          id: playlistId,
          name: cached.playlist.name,
          description: cached.playlist.description,
          totalTracks: cached.playlist.totalTracks,
          convertedTracks: foundTracks.length,
          successRate,
          youtubePlaylistUrl,
          tracks: cachedResults,
          originalUrl: url,
          stats: {
            total: cachedResults.length,
            found: foundTracks.length,
            failed: cachedResults.length - foundTracks.length,
            successRate,
            target: Math.ceil(cachedResults.length * 0.9),
            targetMet: foundTracks.length >= Math.ceil(cachedResults.length * 0.9)
          }
        }
      });
    }

    // Fetch fresh data from Spotify
    console.log(`[Cache] No cache found, fetching from Spotify...`);
    const spotifyAuth = await authenticateSpotify();
    if (!spotifyAuth.success) {
      return res.status(500).json({ error: 'Failed to authenticate with Spotify' });
    }

    const playlistData = await fetchSpotifyPlaylist(playlistId, spotifyAuth.token);
    if (!playlistData.success) {
      return res.status(500).json({ error: playlistData.error });
    }

    const playlist = playlistData.data;
    
    // Convert tracks using simple converter with caching
    const conversion = await simpleConverter.convertPlaylist(
      playlist.tracks, 
      maxTracks, 
      playlistId, 
      playlist
    );
    
    // Generate YouTube playlist URL
    const foundTracks = conversion.results.filter(track => track.youtubeVideoId);
    const youtubePlaylistUrl = simpleConverter.createYouTubePlaylistUrl(
      foundTracks.map(track => track.youtubeVideoId).filter(Boolean)
    );

    console.log(`[Simple API] Conversion complete: ${conversion.stats.found}/${conversion.stats.total} (${conversion.stats.successRate}%)`);

    res.json({
      success: true,
      fromCache: false,
      playlist: {
        id: playlistId,
        name: playlist.name,
        description: playlist.description,
        totalTracks: playlist.totalTracks,
        convertedTracks: conversion.stats.found,
        successRate: conversion.stats.successRate,
        youtubePlaylistUrl,
        tracks: conversion.results,
        originalUrl: url,
        stats: conversion.stats
      }
    });

  } catch (error) {
    console.error('[Simple API] Error:', error);
    res.status(500).json({ 
      error: 'Failed to convert playlist',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;