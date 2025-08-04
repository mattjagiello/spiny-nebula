import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Play, Link, Info, Shield, Search, Music } from "lucide-react";

const urlSchema = z.object({
  url: z.string().url("Please enter a valid URL").refine(
    (url) => url.includes("spotify.com/playlist/"),
    "Please enter a valid Spotify playlist URL"
  ),
});

interface UrlInputProps {
  onPlaylistLoaded: (data: any) => void;
  onUseNewLoader?: () => void;
}

export default function UrlInput({ onPlaylistLoaded, onUseNewLoader }: UrlInputProps) {
  const { toast } = useToast();
  const [previewData, setPreviewData] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      url: "",
    },
  });

  const previewPlaylistMutation = useMutation({
    mutationFn: async (data: { url: string }) => {
      const response = await apiRequest("POST", "/api/preview-playlist", data);
      return response.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setShowPreview(true);
      toast({
        title: "Playlist Found!",
        description: `Found ${data.totalTracks} tracks in "${data.playlistName}"`,
      });
    },
    onError: async (error: any) => {
      // Check if it's an authentication error
      try {
        const errorResponse = await error.response?.json();
        if (errorResponse?.errorType === "AUTHENTICATION_REQUIRED") {
          toast({
            title: "Authentication Required",
            description: "This playlist requires user login. Most Spotify playlists need OAuth authentication.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: error.message || "Failed to load playlist",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Error",
          description: error.message || "Failed to load playlist",
          variant: "destructive",
        });
      }
    },
  });

  const onPreview = (data: z.infer<typeof urlSchema>) => {
    previewPlaylistMutation.mutate(data);
  };

  const [isConverting, setIsConverting] = useState(false);
  const [processingFull, setProcessingFull] = useState(false);

  const onProceed = async (processFullPlaylist: boolean = false) => {
    if (previewData) {
      if (processFullPlaylist) {
        setProcessingFull(true);
      } else {
        setIsConverting(true);
      }
      
      console.log('[URL Input] Starting conversion with URL:', form.getValues().url);
      
      const tracksToProcess = processFullPlaylist ? previewData.totalTracks : 50;
      const estimatedTime = Math.ceil(tracksToProcess / 50) * 0.3; // ~0.3 minutes per 50 tracks
      
      toast({
        title: processFullPlaylist ? "Processing Full Playlist" : "Starting Conversion",
        description: processFullPlaylist 
          ? `Processing all ${tracksToProcess} tracks (estimated ${estimatedTime} minutes)...`
          : "Processing first 50 tracks for quick results...",
      });

      try {
        const response = await fetch('/api/simple-convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: form.getValues().url,
            maxTracks: processFullPlaylist ? undefined : 50
          })
        });

        console.log('[URL Input] Response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json();
          console.error('[URL Input] Error response:', errorData);
          throw new Error(errorData.error || 'Failed to convert playlist');
        }

        const data = await response.json();
        console.log('[URL Input] Conversion complete:', data);
        onPlaylistLoaded(data.playlist);
        
        toast({
          title: "Conversion Complete!",
          description: `Found ${data.playlist.stats.found} YouTube videos out of ${data.playlist.stats.total} tracks (${data.playlist.stats.successRate}% success rate)`,
        });
      } catch (err) {
        console.error('[URL Input] Conversion error:', err);
        toast({
          title: "Conversion Failed",
          description: err instanceof Error ? err.message : 'Failed to convert playlist',
          variant: "destructive",
        });
      } finally {
        setIsConverting(false);
        setProcessingFull(false);
      }
    }
  };

  return (
    <Card className="bg-spotify-dark rounded-xl p-8 mb-8 border-spotify-gray">
      <div className="text-center mb-6">
        <h2 className="text-3xl font-bold mb-2 text-white">Convert Your Spotify Playlist</h2>
        <p className="text-spotify-light-gray text-lg">Convert any public Spotify playlist to YouTube with 98%+ success rate. Finds official music videos automatically.</p>
        

      </div>
      
      <div className="max-w-2xl mx-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onPreview)} className="space-y-6">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type="url"
                        placeholder="https://open.spotify.com/playlist/..."
                        className="w-full bg-spotify-gray border-spotify-gray text-white placeholder-spotify-light-gray focus:border-spotify-green focus:ring-spotify-green pr-12"
                        disabled={previewPlaylistMutation.isPending}
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                        <Link className="text-spotify-light-gray w-4 h-4" />
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2 text-sm text-spotify-light-gray">
                <Info className="w-4 h-4" />
                <span>Limited playlist access with API keys</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-spotify-light-gray">
                <Shield className="w-4 h-4" />
                <span>No login required</span>
              </div>
            </div>

            {!showPreview ? (
              <Button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4"
                disabled={previewPlaylistMutation.isPending}
              >
                {previewPlaylistMutation.isPending ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Loading Tracks...
                  </div>
                ) : (
                  <>
                    <Search className="mr-2 w-4 h-4" />
                    Preview Tracks
                  </>
                )}
              </Button>
            ) : null}
          </form>
        </Form>

        {showPreview && previewData && (
          <div className="mt-8 p-6 bg-spotify-gray rounded-lg border border-spotify-light-gray">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">{previewData.playlistName}</h3>
              <span className="text-spotify-light-gray">{previewData.totalTracks} tracks</span>
            </div>
            
            <div className="space-y-3 mb-6">
              {previewData.tracks.map((track: any, index: number) => (
                <div key={index} className="flex items-center space-x-3 p-3 bg-spotify-dark rounded">
                  <Music className="w-4 h-4 text-spotify-green flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{track.name}</p>
                    <p className="text-spotify-light-gray text-sm truncate">{track.artist}</p>
                  </div>
                </div>
              ))}
              {previewData.totalTracks > 10 && (
                <p className="text-center text-spotify-light-gray text-sm">
                  ...and {previewData.totalTracks - 10} more tracks
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex space-x-3">
                <Button 
                  onClick={() => onProceed(false)}
                  disabled={isConverting || processingFull}
                  className="flex-1 bg-spotify-green hover:bg-green-600 text-white font-semibold py-4"
                >
                  {isConverting ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Converting First 50...
                    </div>
                  ) : (
                    <>
                      <Play className="mr-2 w-4 h-4" />
                      Quick Convert (50 tracks)
                    </>
                  )}
                </Button>
                
                <Button 
                  onClick={() => onProceed(true)}
                  disabled={isConverting || processingFull}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4"
                >
                  {processingFull ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing All {previewData.totalTracks}...
                    </div>
                  ) : (
                    <>
                      <Music className="mr-2 w-4 h-4" />
                      Full Playlist ({previewData.totalTracks})
                    </>
                  )}
                </Button>
              </div>
              
              <Button 
                onClick={() => {
                  setShowPreview(false);
                  setPreviewData(null);
                  form.reset();
                }}
                variant="outline"
                className="w-full border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark"
              >
                Try Another Playlist
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
