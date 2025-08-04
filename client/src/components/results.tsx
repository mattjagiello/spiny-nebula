import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Youtube, Download, Check, X, Search, ExternalLink } from "lucide-react";

interface ResultsProps {
  playlistId: string;
  jobId: string;
}

export default function Results({ playlistId, jobId }: ResultsProps) {
  const [showAllTracks, setShowAllTracks] = useState(false);
  const { toast } = useToast();

  const { data: playlist } = useQuery({
    queryKey: ["/api/playlists", playlistId],
  });

  const { data: job } = useQuery({
    queryKey: ["/api/jobs", jobId],
  });

  // Type guard to ensure playlist and job have the expected structure
  const typedPlaylist = playlist as any;
  const typedJob = job as any;

  const createYouTubePlaylistMutation = useMutation({
    mutationFn: async () => {
      const accessToken = localStorage.getItem("youtube_access_token");
      if (!accessToken) {
        throw new Error("Please sign in with YouTube first");
      }
      
      const response = await apiRequest("POST", "/api/create-youtube-playlist", {
        jobId,
        accessToken,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "YouTube Playlist Created!",
        description: "Your playlist has been successfully created on YouTube.",
      });
      // Open the playlist in a new tab
      window.open(data.playlistUrl, "_blank");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!typedPlaylist || !typedJob) {
    return <div>Loading...</div>;
  }

  const foundTracks = typedPlaylist.tracks?.filter((track: any) => track.found) || [];
  const notFoundTracks = typedPlaylist.tracks?.filter((track: any) => !track.found) || [];
  const successRate = typedPlaylist.tracks?.length ? (foundTracks.length / typedPlaylist.tracks.length) * 100 : 0;

  const displayedTracks = showAllTracks ? typedPlaylist.tracks : typedPlaylist.tracks?.slice(0, 6);

  const handleExportResults = () => {
    const exportData = {
      playlist: typedPlaylist.name,
      total: typedPlaylist.tracks?.length || 0,
      found: foundTracks.length,
      notFound: notFoundTracks.length,
      tracks: typedPlaylist.tracks?.map((track: any) => ({
        name: track.name,
        artist: track.artist,
        album: track.album,
        found: track.found,
        youtubeUrl: track.youtubeVideoId ? `https://www.youtube.com/watch?v=${track.youtubeVideoId}` : null,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${typedPlaylist.name}-conversion-results.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="bg-spotify-dark rounded-xl p-8 border-spotify-gray">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold mb-2 text-white">Conversion Results</h3>
          <p className="text-spotify-light-gray">
            Found official videos for {foundTracks.length} out of {typedPlaylist.tracks?.length || 0} tracks ({Math.round(successRate)}% success rate)
          </p>
        </div>
        <div className="flex space-x-3">
          <Button
            onClick={() => createYouTubePlaylistMutation.mutate()}
            disabled={createYouTubePlaylistMutation.isPending || foundTracks.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <Youtube className="mr-2 w-4 h-4" />
            {createYouTubePlaylistMutation.isPending ? "Creating..." : "Create YouTube Playlist"}
          </Button>
          <Button
            onClick={handleExportResults}
            variant="secondary"
            className="bg-spotify-gray hover:bg-gray-600 text-white"
          >
            <Download className="mr-2 w-4 h-4" />
            Export Results
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-spotify-gray p-4 text-center border-none">
          <div className="text-2xl font-bold text-spotify-green">{foundTracks.length}</div>
          <div className="text-sm text-spotify-light-gray">Videos Found</div>
        </Card>
        <Card className="bg-spotify-gray p-4 text-center border-none">
          <div className="text-2xl font-bold text-red-400">{notFoundTracks.length}</div>
          <div className="text-sm text-spotify-light-gray">Not Found</div>
        </Card>
        <Card className="bg-spotify-gray p-4 text-center border-none">
          <div className="text-2xl font-bold text-blue-400">{typedPlaylist.tracks?.length || 0}</div>
          <div className="text-sm text-spotify-light-gray">Total Tracks</div>
        </Card>
      </div>

      {/* Track List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-spotify-light-gray pb-2 border-b border-spotify-gray">
          <div className="flex-1">Track</div>
          <div className="w-32 text-center">Status</div>
          <div className="w-20 text-center">Action</div>
        </div>

        {displayedTracks?.map((track: any) => (
          <div key={track.id} className="flex items-center justify-between p-3 hover:bg-spotify-gray rounded-lg transition-colors">
            <div className="flex items-center space-x-3 flex-1">
              {track.imageUrl ? (
                <img 
                  src={track.imageUrl} 
                  alt="Album artwork" 
                  className="w-12 h-12 rounded object-cover" 
                />
              ) : (
                <div className="w-12 h-12 rounded bg-spotify-gray flex items-center justify-center">
                  <span className="text-xs text-spotify-light-gray">♪</span>
                </div>
              )}
              <div>
                <div className="font-medium text-white">{track.name}</div>
                <div className="text-sm text-spotify-light-gray">{track.artist}</div>
              </div>
            </div>
            <div className="w-32 text-center">
              {track.found ? (
                <Badge variant="secondary" className="bg-green-900 text-green-300 hover:bg-green-900">
                  <Check className="mr-1 w-3 h-3" />
                  Found
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-red-900 text-red-300 hover:bg-red-900">
                  <X className="mr-1 w-3 h-3" />
                  Not Found
                </Badge>
              )}
            </div>
            <div className="w-20 text-center">
              {track.found && track.youtubeVideoId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-400 p-2"
                  onClick={() => window.open(`https://www.youtube.com/watch?v=${track.youtubeVideoId}`, "_blank")}
                >
                  <Youtube className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-spotify-light-gray cursor-not-allowed p-2"
                  disabled
                >
                  <Search className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        ))}

        {typedPlaylist.tracks && typedPlaylist.tracks.length > 6 && (
          <div className="text-center pt-4">
            <Button
              variant="ghost"
              onClick={() => setShowAllTracks(!showAllTracks)}
              className="text-spotify-light-gray hover:text-white text-sm"
            >
              {showAllTracks ? "Show less" : `Show all ${typedPlaylist.tracks.length} tracks`}
              <div className={`ml-1 transition-transform ${showAllTracks ? "rotate-180" : ""}`}>
                ↓
              </div>
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
