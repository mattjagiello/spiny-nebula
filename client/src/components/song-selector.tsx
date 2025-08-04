import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Play, Music, CheckCircle, ArrowRight, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  youtubeUrl?: string;
  youtubeTitle?: string;
  youtubeChannel?: string;
  youtubeVideoId?: string;
  status?: string;
  inPlaylists?: Array<{
    id: number;
    name: string;
  }>;
}

interface SongSelectorProps {
  tracks: Track[];
  playlistName: string;
  sourcePlaylistId: string;
}

interface UserPlaylist {
  id: number;
  name: string;
  youtubePlaylistUrl: string;
  trackCount: number;
  createdAt: string;
}

export default function SongSelector({ tracks, playlistName, sourcePlaylistId }: SongSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(Math.min(50, tracks.length));
  const [customPlaylistName, setCustomPlaylistName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Filter to only found tracks
  const availableTracks = tracks.filter(track => track.status === 'found' && track.youtubeVideoId);

  // Get user playlists to check which songs are already in playlists
  const { data: userPlaylists = [] } = useQuery<UserPlaylist[]>({
    queryKey: ['/api/user-playlists', sourcePlaylistId],
  });

  // Create playlist mutation
  const createPlaylistMutation = useMutation({
    mutationFn: async (data: { name: string; tracks: string[] }) => {
      const response = await fetch('/api/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          sourcePlaylistId,
          trackIds: data.tracks
        })
      });
      if (!response.ok) throw new Error('Failed to create playlist');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-playlists'] });
      toast({
        title: "Playlist created!",
        description: `Your YouTube playlist "${customPlaylistName}" has been created.`,
      });
      setIsDialogOpen(false);
      setSelectedSongs(new Set());
      setCustomPlaylistName("");
    },
    onError: (error) => {
      toast({
        title: "Error creating playlist",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Update range selection
  const updateRange = (start: number, end: number) => {
    setRangeStart(start);
    setRangeEnd(end);
    // Auto-select songs in the range
    const rangeTrackIds = new Set(
      availableTracks.slice(start - 1, end).map(track => track.id)
    );
    setSelectedSongs(rangeTrackIds);
  };

  // Handle individual song selection
  const toggleSong = (trackId: string) => {
    const newSelection = new Set(selectedSongs);
    if (newSelection.has(trackId)) {
      newSelection.delete(trackId);
    } else if (newSelection.size < 50) {
      newSelection.add(trackId);
    } else {
      toast({
        title: "Maximum 50 songs",
        description: "YouTube playlists are limited to 50 songs maximum.",
        variant: "destructive",
      });
      return;
    }
    setSelectedSongs(newSelection);
  };

  // Check if track is in any user playlist
  const getTrackPlaylistInfo = (trackId: string) => {
    // This would be populated from the backend query
    return [];
  };

  const createQuickPlaylist = (startIndex: number) => {
    const endIndex = Math.min(startIndex + 49, availableTracks.length - 1);
    const playlistTracks = availableTracks.slice(startIndex, endIndex + 1);
    const trackIds = playlistTracks.map(t => t.id);
    
    const playlistName = `${playlistName} (Songs ${startIndex + 1}-${endIndex + 1})`;
    
    createPlaylistMutation.mutate({
      name: playlistName,
      tracks: trackIds
    });
  };

  return (
    <Card className="w-full max-w-4xl mx-auto p-6 bg-spotify-dark border-spotify-gray">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h3 className="text-2xl font-bold text-white mb-2">Create YouTube Playlists</h3>
          <p className="text-spotify-light-gray">
            Select up to 50 songs to create a YouTube playlist from your {availableTracks.length} found tracks
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            onClick={() => createQuickPlaylist(0)}
            className="bg-spotify-green hover:bg-spotify-green-dark text-black"
            disabled={createPlaylistMutation.isPending}
          >
            <Music className="w-4 h-4 mr-2" />
            First 50 Songs
          </Button>
          
          {availableTracks.length > 50 && (
            <Button
              onClick={() => createQuickPlaylist(50)}
              className="bg-spotify-green hover:bg-spotify-green-dark text-black"
              disabled={createPlaylistMutation.isPending || availableTracks.length <= 50}
            >
              <Music className="w-4 h-4 mr-2" />
              Songs 51-100
            </Button>
          )}

          {availableTracks.length > 100 && (
            <Button
              onClick={() => createQuickPlaylist(100)}
              className="bg-spotify-green hover:bg-spotify-green-dark text-black"
              disabled={createPlaylistMutation.isPending || availableTracks.length <= 100}
            >
              <Music className="w-4 h-4 mr-2" />
              Songs 101-150
            </Button>
          )}
        </div>

        {/* Range Slider */}
        <div className="bg-spotify-darker p-4 rounded-lg">
          <h4 className="text-lg font-semibold text-white mb-4">Select Song Range</h4>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <span className="text-spotify-light-gray min-w-[60px]">Range:</span>
              <div className="flex-1">
                <Slider
                  value={[rangeStart, rangeEnd]}
                  onValueChange={([start, end]) => updateRange(start, end)}
                  max={availableTracks.length}
                  min={1}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm text-spotify-light-gray">
              <span>Songs {rangeStart} - {rangeEnd}</span>
              <span>{rangeEnd - rangeStart + 1} songs selected</span>
            </div>
          </div>
        </div>

        {/* Selected Songs Count */}
        <div className="flex items-center justify-between bg-spotify-darker p-3 rounded-lg">
          <span className="text-white">
            {selectedSongs.size} of 50 songs selected
          </span>
          <div className="space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedSongs(new Set())}
              className="border-spotify-gray text-white"
            >
              Clear All
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  disabled={selectedSongs.size === 0 || selectedSongs.size > 50}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Create Playlist ({selectedSongs.size})
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-spotify-dark border-spotify-gray">
                <DialogHeader>
                  <DialogTitle className="text-white">Create YouTube Playlist</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-white">Playlist Name</label>
                    <Input
                      value={customPlaylistName}
                      onChange={(e) => setCustomPlaylistName(e.target.value)}
                      placeholder={`${playlistName} (Custom Selection)`}
                      className="bg-spotify-darker border-spotify-gray text-white"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      className="border-spotify-gray text-white"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => createPlaylistMutation.mutate({
                        name: customPlaylistName || `${playlistName} (Custom Selection)`,
                        tracks: Array.from(selectedSongs)
                      })}
                      disabled={createPlaylistMutation.isPending}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      {createPlaylistMutation.isPending ? "Creating..." : "Create Playlist"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Song List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {availableTracks.slice(rangeStart - 1, rangeEnd).map((track, index) => {
            const actualIndex = rangeStart - 1 + index;
            const playlistInfo = getTrackPlaylistInfo(track.id);
            
            return (
              <div
                key={track.id}
                className="flex items-center space-x-3 p-3 bg-spotify-darker rounded-lg hover:bg-spotify-dark-gray transition-colors"
              >
                <Checkbox
                  checked={selectedSongs.has(track.id)}
                  onCheckedChange={() => toggleSong(track.id)}
                  className="border-spotify-gray"
                />
                
                <div className="text-sm text-spotify-light-gray min-w-[40px]">
                  {actualIndex + 1}.
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">{track.name}</div>
                  <div className="text-spotify-light-gray text-sm truncate">{track.artist}</div>
                </div>

                {/* Playlist indicators */}
                {playlistInfo.length > 0 && (
                  <div className="flex items-center space-x-1">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-green-400">
                      In {playlistInfo.length} playlist{playlistInfo.length > 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {track.youtubeUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(track.youtubeUrl, '_blank')}
                    className="text-spotify-light-gray hover:text-white"
                  >
                    <Play className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Existing User Playlists */}
        {userPlaylists.length > 0 && (
          <div className="border-t border-spotify-gray pt-6">
            <h4 className="text-lg font-semibold text-white mb-4">Your Created Playlists</h4>
            <div className="grid gap-3">
              {userPlaylists.map((playlist) => (
                <div
                  key={playlist.id}
                  className="flex items-center justify-between p-3 bg-spotify-darker rounded-lg"
                >
                  <div>
                    <div className="text-white font-medium">{playlist.name}</div>
                    <div className="text-spotify-light-gray text-sm">
                      {playlist.trackCount} songs • Created {new Date(playlist.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => window.open(playlist.youtubePlaylistUrl, '_blank')}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Open
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}