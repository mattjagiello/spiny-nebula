import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, StopCircle, CheckCircle, AlertCircle, Clock } from "lucide-react";

interface BackgroundProgressProps {
  jobId: string;
  onComplete: (results: any) => void;
  onCancel: () => void;
}

export default function BackgroundProgress({ jobId, onComplete, onCancel }: BackgroundProgressProps) {
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        // Try fast job status first, fallback to regular job status
        let response = await fetch(`/api/fast-job-status/${jobId}`);
        if (!response.ok) {
          response = await fetch(`/api/job-status/${jobId}`);
        }
        
        if (!response.ok) {
          throw new Error('Failed to get job status');
        }
        
        const data = await response.json();
        setStatus(data);
        setIsLoading(false);
        
        // If job is completed, get results
        if (data.status === 'completed') {
          let resultsResponse = await fetch(`/api/fast-job-results/${jobId}`);
          if (!resultsResponse.ok) {
            resultsResponse = await fetch(`/api/job-results/${jobId}`);
          }
          if (resultsResponse.ok) {
            const results = await resultsResponse.json();
            onComplete(results);
          }
        }
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsLoading(false);
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(pollStatus, 2000);
    pollStatus(); // Initial call

    return () => clearInterval(interval);
  }, [jobId, onComplete]);

  const handleJobControl = async (action: 'pause' | 'resume' | 'delete') => {
    try {
      const response = await fetch(`/api/job-control/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to ${action} job`);
      }
      
      if (action === 'delete') {
        onCancel();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control action failed');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6 bg-spotify-dark border-spotify-gray">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-spotify-green mx-auto mb-4"></div>
          <p className="text-spotify-light-gray">Loading job status...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6 bg-spotify-dark border-red-500">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h3 className="text-xl font-semibold text-white">Error</h3>
          <p className="text-red-400">{error}</p>
          <Button onClick={onCancel} variant="outline" className="border-red-500 text-red-500">
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <Card className="w-full max-w-2xl mx-auto p-6 bg-spotify-dark border-spotify-gray">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Background Processing
          </h2>
          <p className="text-spotify-light-gray">
            Converting playlist to YouTube videos...
          </p>
        </div>

        {/* Status Badge */}
        <div className="flex justify-center">
          <div className={`px-4 py-2 rounded-full flex items-center space-x-2 ${
            status.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
            status.status === 'completed' ? 'bg-green-500/20 text-green-400' :
            status.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {status.status === 'processing' && <Clock className="w-4 h-4" />}
            {status.status === 'completed' && <CheckCircle className="w-4 h-4" />}
            {status.status === 'paused' && <Pause className="w-4 h-4" />}
            {status.status === 'failed' && <AlertCircle className="w-4 h-4" />}
            <span className="capitalize font-medium">{status.status}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-spotify-light-gray">
            <span>Progress</span>
            <span>{status.progress.current} / {status.progress.total}</span>
          </div>
          <Progress 
            value={status.progress.percentage} 
            className="w-full h-3 bg-spotify-gray"
          />
          <div className="text-center text-sm text-spotify-light-gray">
            {status.progress.percentage}% complete
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-spotify-gray p-3 rounded-lg">
            <div className="text-xl font-bold text-spotify-green">{status.progress.found}</div>
            <div className="text-sm text-spotify-light-gray">Found</div>
          </div>
          <div className="bg-spotify-gray p-3 rounded-lg">
            <div className="text-xl font-bold text-red-400">{status.progress.failed}</div>
            <div className="text-sm text-spotify-light-gray">Failed</div>
          </div>
          <div className="bg-spotify-gray p-3 rounded-lg">
            <div className="text-xl font-bold text-white">{status.progress.successRate}%</div>
            <div className="text-sm text-spotify-light-gray">Success Rate</div>
          </div>
        </div>

        {/* Timing Info */}
        {status.timing.estimatedTimeRemaining && (
          <div className="text-center p-3 bg-spotify-gray rounded-lg">
            <div className="text-sm text-spotify-light-gray">Estimated time remaining</div>
            <div className="text-lg font-semibold text-white">
              {formatTime(status.timing.estimatedTimeRemaining)}
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex justify-center space-x-4">
          {status.status === 'processing' && (
            <Button
              onClick={() => handleJobControl('pause')}
              variant="outline"
              className="border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black"
            >
              <Pause className="w-4 h-4 mr-2" />
              Pause
            </Button>
          )}
          
          {status.status === 'paused' && (
            <Button
              onClick={() => handleJobControl('resume')}
              variant="outline"
              className="border-green-500 text-green-500 hover:bg-green-500 hover:text-black"
            >
              <Play className="w-4 h-4 mr-2" />
              Resume
            </Button>
          )}
          
          <Button
            onClick={() => handleJobControl('delete')}
            variant="outline"
            className="border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
          >
            <StopCircle className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>

        {/* Running in Background Note */}
        <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <p className="text-sm text-blue-400">
            This process runs in the background. You can close this page and check back later.
          </p>
        </div>
      </div>
    </Card>
  );
}