import express from 'express';
import { db } from './db';
import { userPlaylists, userPlaylistTracks, tracks } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

const router = express.Router();

// Get user playlists for a source playlist
router.get('/user-playlists/:sourcePlaylistId', async (req, res) => {
  try {
    const { sourcePlaylistId } = req.params;
    
    const playlists = await db
      .select()
      .from(userPlaylists)
      .where(eq(userPlaylists.sourcePlaylistId, sourcePlaylistId))
      .orderBy(userPlaylists.createdAt);
    
    res.json(playlists);
  } catch (error) {
    console.error('[Playlists API] Error fetching user playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Create a new user playlist
router.post('/create-playlist', async (req, res) => {
  try {
    const { name, sourcePlaylistId, trackIds } = req.body;
    
    if (!name || !sourcePlaylistId || !trackIds || !Array.isArray(trackIds)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (trackIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 tracks allowed per playlist' });
    }
    
    // Get the tracks to create YouTube playlist URL
    const selectedTracks = await db
      .select()
      .from(tracks)
      .where(and(
        eq(tracks.playlistId, sourcePlaylistId),
        inArray(tracks.id, trackIds)
      ));
    
    const foundTracks = selectedTracks.filter(track => track.youtubeVideoId);
    
    if (foundTracks.length === 0) {
      return res.status(400).json({ error: 'No valid YouTube videos found for selected tracks' });
    }
    
    // Create YouTube playlist URL
    const videoIds = foundTracks.map(track => track.youtubeVideoId).filter(Boolean);
    const youtubePlaylistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
    
    // Create user playlist
    const [newPlaylist] = await db
      .insert(userPlaylists)
      .values({
        name,
        sourcePlaylistId,
        youtubePlaylistUrl,
        trackCount: foundTracks.length
      })
      .returning();
    
    // Add tracks to playlist
    const playlistTracks = foundTracks.map((track, index) => ({
      userPlaylistId: newPlaylist.id,
      trackId: track.id,
      position: index + 1
    }));
    
    await db.insert(userPlaylistTracks).values(playlistTracks);
    
    console.log(`[Playlists API] Created playlist "${name}" with ${foundTracks.length} tracks`);
    
    res.json({
      success: true,
      playlist: newPlaylist,
      trackCount: foundTracks.length,
      youtubePlaylistUrl
    });
    
  } catch (error) {
    console.error('[Playlists API] Error creating playlist:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Get tracks in user playlists (for showing which tracks are already in playlists)
router.get('/track-playlists/:sourcePlaylistId', async (req, res) => {
  try {
    const { sourcePlaylistId } = req.params;
    
    // Get all user playlists for this source
    const playlists = await db
      .select()
      .from(userPlaylists)
      .where(eq(userPlaylists.sourcePlaylistId, sourcePlaylistId));
    
    // Get all track assignments
    const trackAssignments = await db
      .select({
        trackId: userPlaylistTracks.trackId,
        playlistId: userPlaylistTracks.userPlaylistId,
        playlistName: userPlaylists.name
      })
      .from(userPlaylistTracks)
      .innerJoin(userPlaylists, eq(userPlaylistTracks.userPlaylistId, userPlaylists.id))
      .where(eq(userPlaylists.sourcePlaylistId, sourcePlaylistId));
    
    // Group by track ID
    const trackPlaylistMap = trackAssignments.reduce((acc, assignment) => {
      if (!acc[assignment.trackId]) {
        acc[assignment.trackId] = [];
      }
      acc[assignment.trackId].push({
        id: assignment.playlistId,
        name: assignment.playlistName
      });
      return acc;
    }, {} as Record<string, Array<{id: number, name: string}>>);
    
    res.json(trackPlaylistMap);
    
  } catch (error) {
    console.error('[Playlists API] Error fetching track playlists:', error);
    res.status(500).json({ error: 'Failed to fetch track playlist assignments' });
  }
});

// Delete a user playlist
router.delete('/user-playlists/:playlistId', async (req, res) => {
  try {
    const { playlistId } = req.params;
    const id = parseInt(playlistId);
    
    // Delete playlist tracks first
    await db.delete(userPlaylistTracks).where(eq(userPlaylistTracks.userPlaylistId, id));
    
    // Delete playlist
    await db.delete(userPlaylists).where(eq(userPlaylists.id, id));
    
    console.log(`[Playlists API] Deleted playlist ID ${id}`);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[Playlists API] Error deleting playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

export default router;