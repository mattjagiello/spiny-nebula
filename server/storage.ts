import { type Playlist, type Track, type ProcessingJob, type InsertPlaylist, type InsertTrack, type InsertProcessingJob } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Playlists
  getPlaylist(id: string): Promise<Playlist | undefined>;
  getPlaylistBySpotifyId(spotifyId: string): Promise<Playlist | undefined>;
  createPlaylist(playlist: InsertPlaylist): Promise<Playlist>;
  
  // Tracks
  getTracksByPlaylistId(playlistId: string): Promise<Track[]>;
  createTrack(track: InsertTrack): Promise<Track>;
  updateTrack(id: string, updates: Partial<Track>): Promise<Track | undefined>;
  
  // Processing Jobs
  getProcessingJob(id: string): Promise<ProcessingJob | undefined>;
  createProcessingJob(job: InsertProcessingJob): Promise<ProcessingJob>;
  updateProcessingJob(id: string, updates: Partial<ProcessingJob>): Promise<ProcessingJob | undefined>;
}

export class MemStorage implements IStorage {
  private playlists: Map<string, Playlist>;
  private tracks: Map<string, Track>;
  private processingJobs: Map<string, ProcessingJob>;

  constructor() {
    this.playlists = new Map();
    this.tracks = new Map();
    this.processingJobs = new Map();
  }

  async getPlaylist(id: string): Promise<Playlist | undefined> {
    return this.playlists.get(id);
  }

  async getPlaylistBySpotifyId(spotifyId: string): Promise<Playlist | undefined> {
    return Array.from(this.playlists.values()).find(
      (playlist) => playlist.spotifyId === spotifyId
    );
  }

  async createPlaylist(insertPlaylist: InsertPlaylist): Promise<Playlist> {
    const id = randomUUID();
    const playlist: Playlist = { 
      id,
      spotifyId: insertPlaylist.spotifyId,
      name: insertPlaylist.name,
      description: insertPlaylist.description || null,
      imageUrl: insertPlaylist.imageUrl || null,
      totalTracks: insertPlaylist.totalTracks,
      createdAt: new Date()
    };
    this.playlists.set(id, playlist);
    return playlist;
  }

  async getTracksByPlaylistId(playlistId: string): Promise<Track[]> {
    return Array.from(this.tracks.values()).filter(
      (track) => track.playlistId === playlistId
    );
  }

  async createTrack(insertTrack: InsertTrack): Promise<Track> {
    const id = randomUUID();
    const track: Track = { 
      id,
      playlistId: insertTrack.playlistId,
      spotifyId: insertTrack.spotifyId,
      name: insertTrack.name,
      artist: insertTrack.artist,
      album: insertTrack.album || null,
      imageUrl: insertTrack.imageUrl || null,
      duration: insertTrack.duration || null,
      youtubeVideoId: insertTrack.youtubeVideoId || null,
      youtubeVideoTitle: insertTrack.youtubeVideoTitle || null,
      youtubeChannelName: insertTrack.youtubeChannelName || null,
      isOfficial: insertTrack.isOfficial || false,
      found: insertTrack.found || false,
      createdAt: new Date()
    };
    this.tracks.set(id, track);
    return track;
  }

  async updateTrack(id: string, updates: Partial<Track>): Promise<Track | undefined> {
    const track = this.tracks.get(id);
    if (!track) return undefined;
    
    const updatedTrack = { ...track, ...updates };
    this.tracks.set(id, updatedTrack);
    return updatedTrack;
  }

  async getProcessingJob(id: string): Promise<ProcessingJob | undefined> {
    return this.processingJobs.get(id);
  }

  async createProcessingJob(insertJob: InsertProcessingJob): Promise<ProcessingJob> {
    const id = randomUUID();
    const job: ProcessingJob = { 
      id,
      playlistId: insertJob.playlistId,
      status: insertJob.status,
      currentStep: insertJob.currentStep || null,
      currentTrack: insertJob.currentTrack || 0,
      totalTracks: insertJob.totalTracks || 0,
      foundVideos: insertJob.foundVideos || 0,
      youtubePlaylistId: insertJob.youtubePlaylistId || null,
      errorMessage: insertJob.errorMessage || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.processingJobs.set(id, job);
    return job;
  }

  async updateProcessingJob(id: string, updates: Partial<ProcessingJob>): Promise<ProcessingJob | undefined> {
    const job = this.processingJobs.get(id);
    if (!job) return undefined;
    
    const updatedJob = { ...job, ...updates, updatedAt: new Date() };
    this.processingJobs.set(id, updatedJob);
    return updatedJob;
  }
}

export const storage = new MemStorage();
