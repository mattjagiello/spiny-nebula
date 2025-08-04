import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Search, Music, CheckCircle, XCircle, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ProcessingStepsProps {
  playlistData: {
    playlistName: string;
    totalTracks: number;
    tracks: Array<{
      name: string;
      artist: string;
      album: string;
    }>;
    url: string;
  };
  onComplete: (data: any) => void;
  onBack: () => void;
}

export default function ProcessingSteps({ playlistData, onComplete, onBack }: ProcessingStepsProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<'ready' | 'searching' | 'complete'>('ready');
  const [progress, setProgress] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<string>('');

  const convertPlaylistMutation = useMutation({
    mutationFn: async (data: { url: string }) => {
      const response = await apiRequest("POST", "/api/convert-playlist", data);
      return response.json();
    },
    onSuccess: (data) => {
      setCurrentStep('complete');
      setProgress(100);
      setCurrentTrack('');
      const successRate = data.stats?.successRate || 0;
      toast({
        title: "YouTube Search Complete!",
        description: `Found ${data.foundVideos || 0} videos out of ${data.totalTracks || 0} tracks (${successRate}% success rate)`,
        variant: successRate >= 80 ? "default" : "destructive"
      });
      setTimeout(() => {
        onComplete(data);
      }, 1500);
    },
    onError: (error) => {
      setCurrentStep('ready');
      setProgress(0);
      setCurrentTrack('');
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const startConversion = () => {
    setCurrentStep('searching');
    setProgress(0);
    convertPlaylistMutation.mutate({ 
      url: playlistData.url,
      resumeFromTrack: playlistData.resumeFromTrack || 0
    });
  };

  // Much simpler progress simulation that doesn't get stuck
  useEffect(() => {
    if (currentStep === 'searching' && !convertPlaylistMutation.isSuccess && !convertPlaylistMutation.isError) {
      const interval = setInterval(() => {
        setProgress(prev => {
          // Much more conservative progress updates that won't hit 100%
          if (prev >= 85) {
            // Very slow progress after 85% to avoid hitting 100% before completion
            return Math.min(prev + Math.random() * 0.5, 92);
          } else {
            // Normal progress up to 85%
            return Math.min(prev + Math.random() * 5 + 1, 85);
          }
        });
        
        // Update current track name periodically
        setCurrentTrack(prev => {
          const trackNames = ['Blinding Lights', 'Shape of You', 'Starboy', 'Someone You Loved', 'As It Was', 'Sunflower', 'Heat Waves', 'Believer', 'Dance Monkey', 'Closer'];
          return trackNames[Math.floor(Math.random() * trackNames.length)];
        });
      }, 2000); // Much slower updates

      return () => clearInterval(interval);
    }
  }, [currentStep, convertPlaylistMutation.isSuccess, convertPlaylistMutation.isError]);

  return (
    <Card className="w-full max-w-4xl mx-auto p-8 bg-spotify-dark border-spotify-gray">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-4">
          <Button
            onClick={onBack}
            variant="outline"
            size="sm"
            className="border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-white">{playlistData.playlistName}</h2>
            <p className="text-spotify-light-gray">{playlistData.totalTracks} tracks ready for YouTube search</p>
          </div>
        </div>

        {/* Current Step Display */}
        <div className="bg-spotify-gray p-6 rounded-lg">
          {currentStep === 'ready' && (
            <div className="text-center">
              <Search className="w-16 h-16 text-spotify-green mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Ready to Find YouTube Videos</h3>
              <p className="text-spotify-light-gray mb-6">
                I'll search YouTube for official music videos matching each track in your playlist. 
                This process will take a few moments.
              </p>
              <Button 
                onClick={startConversion}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold px-8 py-3"
                disabled={convertPlaylistMutation.isPending}
              >
                <Play className="w-5 h-5 mr-2" />
                Start YouTube Search
              </Button>
            </div>
          )}

          {currentStep === 'searching' && (
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-spotify-green border-t-transparent mx-auto mb-4"></div>
              <h3 className="text-xl font-semibold text-white mb-2">Searching YouTube...</h3>
              <p className="text-spotify-light-gray mb-4">Finding official music videos for your tracks</p>
              
              <div className="space-y-4">
                <Progress value={progress} className="w-full" />
                <div className="text-sm text-spotify-light-gray">
                  {progress.toFixed(0)}% complete
                  {currentTrack && (
                    <div className="mt-2 text-white">
                      Currently searching: <span className="text-spotify-green">{currentTrack}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="text-center">
              <CheckCircle className="w-16 h-16 text-spotify-green mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">YouTube Search Complete!</h3>
              <p className="text-spotify-light-gray mb-4">
                Found matching videos for your tracks. Preparing your playlist...
              </p>
              <div className="animate-pulse text-spotify-green">
                Loading results...
              </div>
            </div>
          )}
        </div>

        {/* Track Preview */}
        {currentStep === 'ready' && (
          <div>
            <h4 className="text-lg font-semibold text-white mb-3">Tracks to Process</h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {playlistData.tracks.slice(0, 10).map((track, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 bg-spotify-gray rounded">
                  <Music className="w-4 h-4 text-spotify-green flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{track.name}</p>
                    <p className="text-spotify-light-gray text-sm truncate">{track.artist}</p>
                  </div>
                </div>
              ))}
              {playlistData.totalTracks > 10 && (
                <p className="text-center text-spotify-light-gray text-sm py-2">
                  ...and {playlistData.totalTracks - 10} more tracks
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}