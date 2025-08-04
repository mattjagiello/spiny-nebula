import express from 'express';
import { simpleConverter } from './simple-converter-fixed.js';
import { db } from './db.js';
import { playlists, tracks } from '@shared/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();



// Simple playlist extraction from Spotify URL
function extractPlaylistId(url: string): string | null {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// Get Spotify access token
async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID || 'd9c490d71a824bcd8c258d4ef667d2cb';
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || 'b14fa68c2f40494195d4adfcbee42364';
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body: 'grant_type=client_credentials'
  });
  
  if (!response.ok) {
    throw new Error(`Spotify auth failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

// Fetch playlist from Spotify
async function fetchPlaylistData(playlistId: string) {
  const token = await getSpotifyToken();
  
  // Get playlist info
  const playlistResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!playlistResponse.ok) {
    throw new Error(`Failed to fetch playlist: ${playlistResponse.status}`);
  }
  
  const playlist = await playlistResponse.json();
  
  // Get all tracks
  const tracks: any[] = [];
  let tracksUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`;
  
  while (tracksUrl) {
    const tracksResponse = await fetch(tracksUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!tracksResponse.ok) {
      throw new Error(`Failed to fetch tracks: ${tracksResponse.status}`);
    }
    
    const tracksData = await tracksResponse.json();
    
    const processedTracks = tracksData.items
      .filter((item: any) => item.track && item.track.type === 'track')
      .map((item: any) => ({
        name: item.track.name,
        artist: item.track.artists.map((artist: any) => artist.name).join(', ')
      }));
    
    tracks.push(...processedTracks);
    tracksUrl = tracksData.next;
  }
  
  return {
    id: playlistId,
    name: playlist.name,
    description: playlist.description || '',
    totalTracks: tracks.length,
    tracks
  };
}

// Main conversion endpoint
router.post('/playlists/simple', async (req, res) => {
  try {
    const { url, maxTracks, startFromTrack = 1, previewOnly = false } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'Playlist URL is required' });
    }
    
    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }
    
    console.log(`[Simple API] Starting conversion for playlist ${playlistId}`);
    
    // 1. Check cache first
    console.log('[Cache] Checking for cached results...');
    try {
      const [cachedPlaylist] = await db
        .select()
        .from(playlists)
        .where(eq(playlists.spotifyId, playlistId))
        .limit(1);
        
      if (cachedPlaylist && (!maxTracks || cachedPlaylist.totalTracks >= maxTracks)) {
        console.log(`[Cache] Found cached results: ${cachedPlaylist.totalTracks} tracks`);
        
        const cachedTracks = await db
          .select()
          .from(tracks)
          .where(eq(tracks.playlistId, cachedPlaylist.id))
          .offset(startFromTrack - 1)
          .limit(maxTracks || cachedPlaylist.totalTracks);
          
        // Convert cached tracks to response format
        const cachedResults = cachedTracks.map(track => ({
          name: track.name,
          artist: track.artist,
          youtubeVideoId: track.youtubeVideoId,
          youtubeUrl: track.youtubeVideoId ? `https://www.youtube.com/watch?v=${track.youtubeVideoId}` : null,
          youtubeTitle: track.youtubeVideoTitle,
          status: track.found ? 'found' : 'failed'
        }));
        
        const foundTracks = cachedResults.filter(track => track.youtubeVideoId);
        const videoIds = foundTracks.map(t => t.youtubeVideoId).filter(Boolean);
        const youtubePlaylistUrl = videoIds.length > 0 
          ? (videoIds.length <= 50 
             ? `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}` 
             : `https://www.youtube.com/watch?v=${videoIds[0]}&list=PLrAl1VWM-FgCcD4WrDvZNXxMvVoqQHq0w`)
          : null;
        const playlistInstructions = videoIds.length <= 50 
          ? 'Click the button above to open your YouTube playlist!'
          : `Your playlist has ${videoIds.length} videos. YouTube URLs are limited to 50 videos, so you'll need to create the playlist manually using the video links below.`;
        
        const successRate = Math.round((foundTracks.length / cachedResults.length) * 100);
        
        console.log(`[Cache] Returning cached results: ${foundTracks.length}/${cachedResults.length} (${successRate}%)`);
        
        return res.json({
          success: true,
          fromCache: true,
          playlist: {
            id: playlistId,
            name: cachedPlaylist.name,
            description: cachedPlaylist.description,
            totalTracks: cachedPlaylist.totalTracks,
            convertedTracks: foundTracks.length,
            successRate,
            youtubePlaylistUrl,
            playlistInstructions,
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
    } catch (error) {
      console.log(`[Cache] Error checking cache: ${error}`);
    }

    // 2. Fetch playlist from Spotify
    console.log('[Simple API] Fetching fresh data from Spotify...');
    const playlistData = await fetchPlaylistData(playlistId);
    
    // If preview only, return the playlist data without conversion
    if (previewOnly) {
      console.log(`[Simple API] Preview mode: returning ${playlistData.tracks.length} tracks`);
      return res.json({
        success: true,
        playlist: {
          id: playlistData.id,
          name: playlistData.name,
          description: playlistData.description,
          totalTracks: playlistData.totalTracks,
          tracks: playlistData.tracks,
          stats: { total: playlistData.totalTracks, found: 0, successRate: 0 }
        }
      });
    }
    
    // 3. Convert tracks to YouTube videos with caching
    const tracksToProcess = maxTracks || playlistData.tracks.length;
    console.log(`[Simple API] Converting ${tracksToProcess} tracks...`);
    const conversionResult = await simpleConverter.convertPlaylist(
      playlistData.tracks, 
      tracksToProcess, 
      playlistId, 
      playlistData
    );
    
    // 4. Create YouTube playlist URL and instructions
    const foundTracks = conversionResult.results.filter(track => track.status === 'found');
    const videoIds = foundTracks.map(track => track.youtubeVideoId).filter((id): id is string => Boolean(id));
    const youtubePlaylistUrl = simpleConverter.createYouTubePlaylistUrl(videoIds);
    const playlistInstructions = simpleConverter.generatePlaylistInstructions(videoIds);
    
    console.log(`[Simple API] Conversion complete: ${conversionResult.stats.found}/${conversionResult.stats.total} (${conversionResult.stats.successRate}%)`);
    
    res.json({
      success: true,
      fromCache: false,
      playlist: {
        id: playlistData.id,
        name: playlistData.name,
        description: playlistData.description,
        totalTracks: playlistData.totalTracks,
        convertedTracks: conversionResult.stats.found,
        successRate: conversionResult.stats.successRate,
        youtubePlaylistUrl,
        playlistInstructions,
        tracks: conversionResult.results,
        originalUrl: url,
        stats: conversionResult.stats
      }
    });
    
  } catch (error) {
    console.error('[Simple API] Conversion failed:', error);
    res.status(500).json({ 
      error: 'Conversion failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;