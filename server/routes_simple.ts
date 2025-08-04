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
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing Spotify credentials - SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required');
  }
  
  console.log('[Spotify Auth] Requesting access token...');
  
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
    console.error('[Spotify Auth] Failed:', response.status, errorText);
    throw new Error(`Spotify auth failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('[Spotify Auth] Token obtained successfully');
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
    
    // Caching disabled - always fetch fresh data for reliable results
    // (This ensures we always get complete playlists without partial cache issues)

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
    
    // 3. Slice tracks for the requested page range
    const startIndex = startFromTrack - 1;
    const endIndex = maxTracks ? startIndex + maxTracks : playlistData.tracks.length;
    const tracksToConvert = playlistData.tracks.slice(startIndex, endIndex);
    
    console.log(`[Simple API] Converting tracks ${startFromTrack}-${startIndex + tracksToConvert.length} (${tracksToConvert.length} total)...`);
    const conversionResult = await simpleConverter.convertPlaylist(
      tracksToConvert, 
      tracksToConvert.length, 
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