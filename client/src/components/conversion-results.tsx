import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExternalLink, Copy, Download, Play, CheckCircle, XCircle, ChevronLeft, ChevronRight, Music } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SongSelector from "./song-selector";

interface Track {
  name: string;
  artist: string;
  album: string;
  youtubeUrl?: string;
  youtubeTitle?: string;
  youtubeChannel?: string;
  status?: string;
  searchQuery?: string;
}

interface ConversionResultsProps {
  playlist: {
    id?: string;
    name: string;
    tracks: Track[];
    foundVideos: number;
    totalTracks: number;
    youtubePlaylistUrl?: string;
    youtubeLinks: string;
    playlistText: string;
    instructions: string;
    originalUrl?: string;
    stats: {
      total: number;
      found: number;
      missing: number;
      successRate: number;
    };
    resumeInfo?: {
      canResume: boolean;
      failedCount: number;
      nextResumePoint: number;
      remainingTracks?: number;
      isPartialConversion?: boolean;
      failedTracks: Array<{
        name: string;
        artist: string;
        status: string;
        error?: string;
      }>;
    };
  };
  onStartOver: () => void;
  onContinueProcessing?: (resumeFromTrack: number) => void;
}

export default function ConversionResults({ playlist, onStartOver, onContinueProcessing }: ConversionResultsProps) {
  const { toast } = useToast();
  const [currentPage, setCurrentPage] = useState(1);
  const [showSongSelector, setShowSongSelector] = useState(false);
  const tracksPerPage = 50;
  
  // Calculate pagination
  const totalPages = Math.ceil(playlist.tracks.length / tracksPerPage);
  const startIndex = (currentPage - 1) * tracksPerPage;
  const endIndex = startIndex + tracksPerPage;
  const currentTracks = playlist.tracks.slice(startIndex, endIndex);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: `${label} copied successfully`,
    });
  };

  const downloadAsFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="w-full max-w-4xl mx-auto p-6 bg-spotify-dark border-spotify-gray">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            {playlist.name}
            {(playlist as any).fromCache && (
              <span className="ml-2 text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded-full">
                ⚡ Cached Results
              </span>
            )}
          </h2>
          <div className="flex items-center justify-center space-x-4 text-spotify-light-gray">
            <span>{playlist.totalTracks} total tracks</span>
            <span>•</span>
            <span className="text-spotify-green">{playlist.stats.found} YouTube videos found</span>
            <span>•</span>
            <span className={playlist.stats.successRate >= 80 ? "text-spotify-green" : playlist.stats.successRate >= 60 ? "text-yellow-400" : "text-red-400"}>
              {playlist.stats.successRate}% success rate
            </span>
          </div>
        </div>

        {/* Create YouTube Playlist Button */}
        {playlist.youtubePlaylistUrl && (
          <div className="text-center bg-spotify-darker p-4 rounded-lg border border-spotify-gray mb-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              {playlist.stats.found <= 50 ? '🎵 Your YouTube Playlist is Ready!' : '📋 YouTube Playlist Creation'}
            </h3>
            <p className="text-spotify-light-gray text-sm mb-3">
              {(playlist as any).playlistInstructions || `Click below to open a YouTube playlist with ${Math.min(playlist.stats.found, 50)} songs`}
            </p>
            <Button 
              onClick={() => window.open(playlist.youtubePlaylistUrl, '_blank')}
              className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 text-lg"
            >
              <Play className="w-5 h-5 mr-2" />
              {playlist.stats.found <= 50 
                ? `Open YouTube Playlist (${playlist.stats.found} videos)` 
                : `Start with First Video (${playlist.stats.found} total)`}
            </Button>
            {playlist.stats.found > 50 && (
              <div className="space-y-2 mt-3">
                <p className="text-sm text-yellow-400">
                  ⚠️ YouTube URL limit: Only first 50 videos can be loaded automatically. All {playlist.stats.found} video links are listed below for manual playlist creation.
                </p>
                <Button
                  onClick={() => setShowSongSelector(true)}
                  className="bg-spotify-green hover:bg-spotify-green-dark text-black text-sm py-2 px-4"
                >
                  <Music className="w-4 h-4 mr-2" />
                  Create Custom 50-Song Playlists
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Resume Option for Remaining Tracks */}
        {playlist.resumeInfo && playlist.resumeInfo.canResume && (
          <div className="bg-spotify-dark-gray p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              {playlist.resumeInfo.isPartialConversion ? "Continue Processing Remaining Tracks" : "Resume Failed Tracks"}
            </h3>
            <p className="text-spotify-light-gray mb-3">
              {playlist.resumeInfo.isPartialConversion ? (
                <>
                  Processed {playlist.stats.total} tracks out of {playlist.totalTracks}. 
                  {playlist.resumeInfo.remainingTracks > 0 && (
                    <> {playlist.resumeInfo.remainingTracks} tracks remaining to process.</>
                  )}
                </>
              ) : (
                <>
                  {playlist.resumeInfo.failedCount} tracks failed to process. You can retry processing these tracks.
                </>
              )}
            </p>
            {playlist.resumeInfo.failedTracks.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-spotify-light-gray">
                  {playlist.resumeInfo.isPartialConversion ? "Some failed tracks:" : "Failed tracks include:"}
                </p>
                {playlist.resumeInfo.failedTracks.slice(0, 3).map((track, index) => (
                  <div key={index} className="text-sm text-red-400">
                    • {track.artist} - {track.name} ({track.status})
                  </div>
                ))}
                {playlist.resumeInfo.failedTracks.length > 3 && (
                  <div className="text-sm text-spotify-light-gray">
                    ... and {playlist.resumeInfo.failedTracks.length - 3} more failed
                  </div>
                )}
              </div>
            )}
            <Button 
              variant="outline" 
              className="border-spotify-green text-spotify-green hover:bg-spotify-green hover:text-black"
              onClick={() => {
                if (onContinueProcessing && playlist.resumeInfo?.nextResumePoint !== undefined) {
                  onContinueProcessing(playlist.resumeInfo.nextResumePoint);
                } else {
                  toast({
                    title: "Resume not available",
                    description: "Cannot continue processing at this time",
                    variant: "destructive"
                  });
                }
              }}
            >
              {playlist.resumeInfo.isPartialConversion ? "Continue Processing" : "Retry Failed Tracks"}
            </Button>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-spotify-gray p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-spotify-green">{playlist.tracks.filter(track => track.youtubeUrl).length}</div>
            <div className="text-sm text-spotify-light-gray">Videos Found</div>
          </div>
          <div className="bg-spotify-gray p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-white">{playlist.tracks.filter(track => !track.youtubeUrl).length}</div>
            <div className="text-sm text-spotify-light-gray">Not Found</div>
          </div>
        </div>

        {/* Export Options */}
        {playlist.exportFormats && (
          <div className="bg-spotify-gray p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-3">Create Your YouTube Playlist</h3>
            <p className="text-spotify-light-gray text-sm mb-4">{playlist.exportFormats.instructions}</p>
            
            {/* YouTube Playlist Creation Buttons */}
            {playlist.exportFormats?.youtubeLinks ? (
              <div className="mb-4">
                <div className="flex flex-wrap gap-3 mb-3">
                  <Button
                    onClick={() => window.open(playlist.exportFormats?.youtubeLinks, '_blank')}
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Create YouTube Playlist
                  </Button>
                </div>
                <p className="text-xs text-spotify-light-gray">
                  Click the button above to open YouTube with your playlist ready to save.
                </p>
              </div>
            ) : (
              <div className="mb-4 p-4 bg-green-900/20 border border-green-500 rounded-lg">
                <h4 className="text-green-400 font-medium mb-2">Automatic Video Search</h4>
                <p className="text-green-300 text-sm mb-3">
                  The app automatically searched for official YouTube videos for each track. Found videos are marked with a green check and can be watched or added to playlists.
                </p>
                <p className="text-green-300 text-sm">
                  For tracks not found automatically, use the search buttons to find them manually on YouTube.
                </p>
              </div>
            )}
            
            {/* Alternative Export Options */}
            <div className="border-t border-spotify-light-gray pt-4">
              <h4 className="text-sm font-medium text-white mb-2">Alternative Export Options</h4>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => copyToClipboard(playlist.exportFormats!.youtubeLinks, "YouTube links")}
                  variant="outline"
                  size="sm"
                  className="border-spotify-green text-spotify-green hover:bg-spotify-green hover:text-white"
                >
                  <Copy className="w-3 h-3 mr-2" />
                  Copy Links
                </Button>
                
                <Button
                  onClick={() => copyToClipboard(playlist.exportFormats!.playlistText, "full playlist")}
                  variant="outline"
                  size="sm"
                  className="border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark"
                >
                  <Copy className="w-3 h-3 mr-2" />
                  Copy All
                </Button>
                
                <Button
                  onClick={() => downloadAsFile(playlist.exportFormats!.playlistText, `${playlist.name}.txt`)}
                  variant="outline"
                  size="sm"
                  className="border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white"
                >
                  <Download className="w-3 h-3 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Track List */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Track Results</h3>
            {totalPages > 1 && (
              <div className="flex items-center space-x-2 text-sm text-spotify-light-gray">
                <span>Page {currentPage} of {totalPages}</span>
                <span>•</span>
                <span>Showing {startIndex + 1}-{Math.min(endIndex, playlist.tracks.length)} of {playlist.tracks.length}</span>
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            {currentTracks.map((track, index) => (
              <div key={startIndex + index} className="flex items-center space-x-3 p-3 bg-spotify-gray rounded hover:bg-spotify-light-gray transition-colors">
                <div className="flex-shrink-0">
                  {track.youtubeUrl ? (
                    <CheckCircle className="w-5 h-5 text-spotify-green" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{track.name}</p>
                  <p className="text-spotify-light-gray text-sm truncate">{track.artist}</p>
                  {track.youtubeTitle && (
                    <p className="text-blue-400 text-xs truncate">{track.youtubeTitle}</p>
                  )}
                  {!track.youtubeUrl && (
                    <p className="text-blue-400 text-xs">Ready for manual search</p>
                  )}
                </div>
                
                <div className="flex space-x-2">
                  {track.youtubeUrl ? (
                    <>
                      <Button
                        onClick={() => window.open(track.youtubeUrl, '_blank')}
                        size="sm"
                        variant="outline"
                        className="border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white"
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Watch
                      </Button>
                      <Button
                        onClick={() => copyToClipboard(track.youtubeUrl!, "YouTube link")}
                        size="sm"
                        variant="outline"
                        className="border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => {
                        const searchQuery = `${track.artist} ${track.name} official video`;
                        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
                        window.open(searchUrl, '_blank');
                      }}
                      size="sm"
                      variant="outline"
                      className="border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Search
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center space-x-4 mt-6">
              <Button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                variant="outline"
                size="sm"
                className="border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              
              <div className="flex items-center space-x-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <Button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      className={currentPage === pageNum 
                        ? "bg-spotify-green text-white" 
                        : "border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark"
                      }
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              
              <Button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                variant="outline"
                size="sm"
                className="border-spotify-light-gray text-spotify-light-gray hover:bg-spotify-light-gray hover:text-spotify-dark disabled:opacity-50"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>

        {/* Song Selection Interface */}
        {showSongSelector && playlist.id && (
          <div className="mt-8">
            <SongSelector
              tracks={playlist.tracks.map(track => ({
                id: track.name + '-' + track.artist, // Temporary ID until we have proper track IDs
                name: track.name,
                artist: track.artist,
                album: track.album || '',
                youtubeUrl: track.youtubeUrl,
                youtubeTitle: track.youtubeTitle,
                youtubeChannel: track.youtubeChannel,
                youtubeVideoId: track.youtubeUrl?.split('v=')[1]?.split('&')[0],
                status: track.status
              }))}
              playlistName={playlist.name}
              sourcePlaylistId={playlist.id}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-center">
          <Button
            onClick={onStartOver}
            className="bg-spotify-green hover:bg-green-600 text-white font-semibold"
          >
            Convert Another Playlist
          </Button>
        </div>
      </div>
    </Card>
  );
}