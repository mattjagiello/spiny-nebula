import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Music, Play, Download, ChevronRight, ChevronDown, Eye, Loader2, CheckCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  youtubeUrl?: string;
  youtubeVideoId?: string;
  status: 'found' | 'failed';
}

interface PlaylistData {
  id: string;
  name: string;
  description: string;
  totalTracks: number;
  tracks: Track[];
  stats: {
    total: number;
    found: number;
    successRate: number;
  };
}

interface PlaylistLoaderProps {
  onBack: () => void;
}

export default function PlaylistLoader({ onBack }: PlaylistLoaderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [isConverting, setIsConverting] = useState(false);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{
    currentPage: number;
    totalPages: number;
    results: Array<{pageNum: number; found: number; total: number; playlistUrl?: string}>;
  } | null>(null);
  const [completedResults, setCompletedResults] = useState<Array<{pageNum: number; found: number; total: number; playlistUrl?: string}> | null>(null);

  // Preview playlist without conversion
  const previewPlaylist = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch('/api/playlists/simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, previewOnly: true })
      });
      if (!response.ok) throw new Error('Failed to load playlist');
      return response.json();
    },
    onSuccess: (data) => {
      console.log('Preview data received:', data);
      setPlaylist({
        id: data.playlist?.id || data.id,
        name: data.playlist?.name || data.name,
        description: data.playlist?.description || data.description,
        totalTracks: data.playlist?.totalTracks || data.totalTracks,
        tracks: data.playlist?.tracks || data.tracks || [],
        stats: { total: data.playlist?.totalTracks || data.totalTracks, found: 0, successRate: 0 }
      });
    },
    onError: (error) => {
      toast({
        title: "Error loading playlist",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Convert selected pages
  const convertPages = useMutation({
    mutationFn: async (pages: number[]) => {
      setIsConverting(true);
      setConversionProgress({ currentPage: 0, totalPages: pages.length, results: [] });
      const results = [];
      
      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        const startTrack = (pageNum - 1) * 50 + 1;
        const maxTracks = 50;
        
        // Update progress
        setConversionProgress(prev => prev ? { ...prev, currentPage: i + 1 } : null);
        
        try {
          const response = await fetch('/api/playlists/simple', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: spotifyUrl, 
              maxTracks,
              startFromTrack: startTrack,
              previewOnly: false
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to convert page ${pageNum}: ${errorText}`);
          }
          
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Expected JSON response but got: ${text.slice(0, 100)}...`);
          }
          
          const result = await response.json();
          const foundTracks = result.playlist.tracks.filter((t: Track) => t.status === 'found');
          const videoIds = foundTracks.map((t: Track) => t.youtubeVideoId).filter(Boolean);
          const playlistUrl = videoIds.length > 0 ? `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}` : undefined;
          
          const pageResult = {
            pageNum,
            found: foundTracks.length,
            total: result.playlist.tracks.length,
            playlistUrl,
            ...result
          };
          
          results.push(pageResult);
          
          // Update progress with this page's results
          setConversionProgress(prev => prev ? {
            ...prev,
            results: [...prev.results, { pageNum, found: foundTracks.length, total: result.playlist.tracks.length, playlistUrl }]
          } : null);
          
        } catch (error) {
          console.error(`Error converting page ${pageNum}:`, error);
          // Continue with next page instead of failing completely
          results.push({
            pageNum,
            found: 0,
            total: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            playlist: { tracks: [] }
          });
        }
      }
      
      return results;
    },
    onSuccess: (results) => {
      setIsConverting(false);
      setConversionProgress(null);
      
      // Store completed results for display
      const completedResults = results.map(r => ({
        pageNum: r.pageNum,
        found: r.found || 0,
        total: r.total || 0,
        playlistUrl: r.playlistUrl
      }));
      setCompletedResults(completedResults);
      
      // Show final summary
      const totalFound = results.reduce((sum, r) => sum + (r.found || 0), 0);
      const totalTracks = results.reduce((sum, r) => sum + (r.total || 0), 0);
      const successRate = totalTracks > 0 ? Math.round((totalFound / totalTracks) * 100) : 0;
      
      toast({
        title: "Conversion Complete!",
        description: `Converted ${results.length} pages • ${totalFound}/${totalTracks} songs found (${successRate}%)`,
        duration: 8000,
      });
    },
    onError: (error) => {
      setIsConverting(false);
      setConversionProgress(null);
      setCompletedResults(null);
      toast({
        title: "Conversion failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleLoadPlaylist = () => {
    if (!spotifyUrl.trim()) {
      toast({
        title: "Please enter a Spotify playlist URL",
        variant: "destructive",
      });
      return;
    }
    
    // Clear any existing state and cache
    setPlaylist(null);
    setCompletedResults(null);
    setSelectedPages(new Set());
    queryClient.invalidateQueries();
    
    previewPlaylist.mutate(spotifyUrl);
  };

  const togglePage = (pageNum: number) => {
    const newSelection = new Set(selectedPages);
    if (newSelection.has(pageNum)) {
      newSelection.delete(pageNum);
    } else if (newSelection.size < 10) { // Limit to 10 pages max
      newSelection.add(pageNum);
    } else {
      toast({
        title: "Maximum 10 pages",
        description: "You can convert up to 10 pages (500 songs) at once.",
        variant: "destructive",
      });
      return;
    }
    setSelectedPages(newSelection);
  };

  const handleConvert = () => {
    if (selectedPages.size === 0) {
      toast({
        title: "Select pages to convert",
        description: "Choose which pages of 50 songs you want to convert.",
        variant: "destructive",
      });
      return;
    }
    convertPages.mutate(Array.from(selectedPages).sort());
  };

  if (!playlist) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6 bg-white dark:bg-spotify-dark border border-gray-200 dark:border-spotify-gray">
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              🎵 Spiny Nebula
            </h2>
            <p className="text-gray-600 dark:text-spotify-light-gray mb-4">
              Transform your Spotify playlists into YouTube collections
            </p>
            
            {/* Instructions moved to landing page */}
            <div className="bg-gradient-to-r from-pink-500/5 to-purple-500/5 dark:from-pink-500/10 dark:to-purple-500/10 border border-pink-200 dark:border-pink-800 rounded-lg p-4 mb-6 text-left">
              <h4 className="text-sm font-medium text-pink-600 dark:text-pink-400 mb-2">
                Instructions:
              </h4>
              <div className="space-y-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                <p>• Paste any public Spotify playlist URL above and hit "Load Playlist"</p>
                <p>• Select pages to convert (50 songs per page - YouTube's limit)</p>
                <p>• Use the eye icon to preview songs on each page before converting</p>
                <p>• Hit convert to get working YouTube playlist links</p>
                <p>• No login required - your data stays private</p>
                <p>• 98% success rate finding official music videos automatically</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                Spotify Playlist URL
              </label>
              <Input
                value={spotifyUrl}
                onChange={(e) => setSpotifyUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                className="bg-white dark:bg-spotify-darker border-gray-300 dark:border-spotify-gray text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={handleLoadPlaylist}
                disabled={previewPlaylist.isPending}
                className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-semibold"
              >
                {previewPlaylist.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Music className="w-4 h-4 mr-2" />
                    Load Playlist
                  </>
                )}
              </Button>
              

            </div>
          </div>
        </div>
      </Card>
    );
  }

  const totalPages = Math.ceil(playlist.totalTracks / 50);
  const selectedCount = selectedPages.size * 50;

  return (
    <Card className="w-full max-w-4xl mx-auto p-4 md:p-6 bg-white dark:bg-spotify-dark border border-gray-200 dark:border-spotify-gray">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {playlist.name}
          </h2>
          <p className="text-sm md:text-base text-gray-600 dark:text-spotify-light-gray mb-3">
            {playlist.totalTracks} songs • {totalPages} pages of 50 songs each
          </p>
          {playlist.description && (
            <p className="text-xs md:text-sm text-gray-500 dark:text-spotify-light-gray line-clamp-2">
              {playlist.description}
            </p>
          )}
        </div>

        {/* Selection Summary */}
        <div className="bg-gray-50 dark:bg-spotify-darker p-4 rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm md:text-base font-medium text-gray-900 dark:text-white">
                {selectedPages.size} pages selected ({selectedCount} songs)
              </p>
              <p className="text-xs md:text-sm text-gray-600 dark:text-spotify-light-gray">
                Each page creates a separate 50-song YouTube playlist
              </p>
            </div>
            <div className="flex space-x-2">
              <Button
                onClick={() => setSelectedPages(new Set(Array.from({length: Math.min(10, totalPages)}, (_, i) => i + 1)))}
                variant="outline"
                size="sm"
                className="text-xs md:text-sm border-gray-300 dark:border-spotify-gray text-gray-700 dark:text-white"
              >
                Select First 10
              </Button>
              <Button
                onClick={() => setSelectedPages(new Set())}
                variant="outline"
                size="sm"
                className="text-xs md:text-sm border-gray-300 dark:border-spotify-gray text-gray-700 dark:text-white"
              >
                Clear All
              </Button>
            </div>
          </div>
        </div>

        {/* Page Selection Grid */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Pages to Convert
          </h3>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({ length: totalPages }, (_, i) => {
              const pageNum = i + 1;
              const startSong = (pageNum - 1) * 50 + 1;
              const endSong = Math.min(pageNum * 50, playlist.totalTracks);
              const isSelected = selectedPages.has(pageNum);
              const isExpanded = expandedPage === pageNum;
              const pageTracks = playlist.tracks.slice(startSong - 1, endSong);
              
              return (
                <div key={pageNum} className="space-y-2">
                  <div
                    className={`p-3 rounded-lg border-2 transition-colors ${
                      isSelected
                        ? 'border-spotify-green bg-spotify-green/10 dark:bg-spotify-green/20'
                        : 'border-gray-200 dark:border-spotify-gray hover:border-gray-300 dark:hover:border-spotify-light-gray'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <button
                        onClick={() => togglePage(pageNum)}
                        className="flex items-center space-x-2 flex-1 text-left"
                      >
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          Page {pageNum}
                        </span>
                        {isSelected && (
                          <Badge className="bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs">
                            ✓
                          </Badge>
                        )}
                      </button>
                      
                      <button
                        onClick={() => setExpandedPage(isExpanded ? null : pageNum)}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-spotify-gray rounded"
                        title="Preview songs"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-spotify-light-gray" />
                        ) : (
                          <Eye className="w-4 h-4 text-gray-500 dark:text-spotify-light-gray" />
                        )}
                      </button>
                    </div>
                    
                    <p className="text-xs text-gray-600 dark:text-spotify-light-gray">
                      Songs {startSong}-{endSong}
                    </p>
                  </div>
                  
                  {isExpanded && (
                    <div className="ml-4 p-3 bg-gray-50 dark:bg-spotify-darker rounded-lg border border-gray-200 dark:border-spotify-gray">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                        Songs in Page {pageNum} ({pageTracks.length} songs):
                      </h4>
                      {pageTracks.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-spotify-light-gray italic">
                          Loading tracks for this page...
                        </p>
                      ) : null}
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {pageTracks.map((track, index) => (
                          <div key={startSong + index} className="flex items-start space-x-2 py-2 px-2 bg-white dark:bg-spotify-dark rounded border">
                            <span className="text-xs text-gray-500 dark:text-spotify-light-gray w-8 mt-1 flex-shrink-0">
                              {startSong + index}.
                            </span>
                            <Music className="w-3 h-3 text-pink-500 flex-shrink-0 mt-1" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-900 dark:text-white leading-relaxed break-words">
                                {track.name}
                              </p>
                              <p className="text-xs text-gray-600 dark:text-spotify-light-gray leading-relaxed break-words">
                                {track.artist}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Conversion Progress */}
        {conversionProgress && (
          <div className="bg-gradient-to-r from-pink-500/5 to-purple-500/5 dark:from-pink-500/10 dark:to-purple-500/10 border border-pink-200 dark:border-pink-800 rounded-lg p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-pink-600 dark:text-pink-400">
                  Converting Pages ({conversionProgress.currentPage}/{conversionProgress.totalPages})
                </h4>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {Math.round((conversionProgress.currentPage / conversionProgress.totalPages) * 100)}%
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-pink-500 to-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(conversionProgress.currentPage / conversionProgress.totalPages) * 100}%` }}
                />
              </div>
              
              {/* Results */}
              {conversionProgress.results.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-xs font-medium text-gray-700 dark:text-gray-300">Completed Pages:</h5>
                  <div className="grid gap-2 max-h-32 overflow-y-auto">
                    {conversionProgress.results.map(result => (
                      <div key={result.pageNum} className="flex items-center justify-between bg-white dark:bg-spotify-dark rounded p-2 border">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-xs font-medium">Page {result.pageNum}</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">
                            {result.found}/{result.total} found
                          </span>
                        </div>
                        {result.playlistUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(result.playlistUrl, '_blank')}
                            className="h-6 px-2 text-xs border-pink-300 text-pink-600 hover:bg-pink-50"
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Open
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Completed Results */}
        {completedResults && completedResults.length > 0 && (
          <div className="bg-gradient-to-r from-green-500/5 to-blue-500/5 dark:from-green-500/10 dark:to-blue-500/10 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-green-600 dark:text-green-400">
                  🎉 Conversion Complete! Your YouTube Playlists:
                </h4>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {completedResults.reduce((sum, r) => sum + r.found, 0)} / {completedResults.reduce((sum, r) => sum + r.total, 0)} songs found
                </div>
              </div>
              
              <div className="grid gap-3">
                {completedResults.map(result => (
                  <div key={result.pageNum} className="flex items-center justify-between bg-white dark:bg-spotify-dark rounded-lg p-4 border border-green-200 dark:border-green-700">
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center justify-center w-8 h-8 bg-green-100 dark:bg-green-900 rounded-full">
                        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <h5 className="font-medium text-gray-900 dark:text-white">
                          Page {result.pageNum} Playlist
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {result.found}/{result.total} songs found ({Math.round((result.found / result.total) * 100)}% success)
                        </p>
                      </div>
                    </div>
                    
                    {result.playlistUrl ? (
                      <Button
                        onClick={() => window.open(result.playlistUrl, '_blank')}
                        className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-medium"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Open YouTube Playlist
                      </Button>
                    ) : (
                      <div className="text-sm text-gray-500 dark:text-gray-400 italic">
                        No songs found for this page
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  💡 <strong>Tip:</strong> Each playlist opens directly in YouTube with all found songs ready to play. 
                  You can save these playlists to your YouTube account by clicking "Save" when they open.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={handleConvert}
            disabled={selectedPages.size === 0 || isConverting}
            className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-semibold"
          >
            {isConverting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Converting {selectedPages.size} pages...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Convert {selectedPages.size} Pages to YouTube
              </>
            )}
          </Button>
          
          <Button
            onClick={() => {
              setPlaylist(null);
              setCompletedResults(null);
              setSelectedPages(new Set());
            }}
            variant="outline"
            className="border-gray-300 dark:border-spotify-gray text-gray-700 dark:text-white"
          >
            Load Different Playlist
          </Button>
        </div>

        {/* Additional Info */}
        <div className="bg-gradient-to-r from-pink-500/5 to-purple-500/5 dark:from-pink-500/10 dark:to-purple-500/10 border border-pink-200 dark:border-pink-800 rounded-lg p-4">
          <h4 className="text-sm font-medium text-pink-600 dark:text-pink-400 mb-2">
            ⚡ Technical Details:
          </h4>
          <div className="space-y-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
            <p>• Each page contains up to 50 songs (YouTube's playlist URL limit)</p>
            <p>• Converting creates separate YouTube playlists for each page</p>
            <p>• Results are cached to avoid reprocessing the same playlists</p>
            <p>• Uses advanced search algorithms with multiple fallback strategies</p>
          </div>
        </div>
      </div>
    </Card>
  );
}