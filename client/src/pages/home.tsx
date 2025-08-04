import { useState } from "react";
import Header from "../components/header";
import Footer from "../components/footer";
import UrlInput from "../components/url-input";
import ConversionResults from "../components/conversion-results";
import ProcessingSteps from "../components/processing-steps";
import BackgroundProgress from "../components/background-progress";
import PlaylistLoader from "../components/playlist-loader";

type AppStep = 'input' | 'loader' | 'processing' | 'background' | 'results';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<AppStep>('loader'); // Default to new converter
  const [playlistData, setPlaylistData] = useState<any>(null);
  const [conversionData, setConversionData] = useState<any>(null);
  const [originalPlaylistData, setOriginalPlaylistData] = useState<any>(null);
  const [backgroundJobId, setBackgroundJobId] = useState<string | null>(null);

  // Removed classic converter option

  const handlePlaylistLoaded = async (data: any) => {
    // For the new simple system, data already contains the converted results
    setConversionData(data);
    setCurrentStep('results');
  };

  const handleProcessingComplete = (data: any) => {
    setConversionData(data);
    setCurrentStep('results');
  };

  const handleStartOver = () => {
    setCurrentStep('input');
    setPlaylistData(null);
    setOriginalPlaylistData(null);
    setConversionData(null);
    setBackgroundJobId(null);
  };

  const handleBackgroundComplete = (results: any) => {
    setConversionData(results.playlist);
    setCurrentStep('results');
  };

  const handleBackgroundCancel = () => {
    setCurrentStep('input');
    setBackgroundJobId(null);
  };

  const handleContinueProcessing = (resumeFromTrack: number) => {
    console.log('[Home] Continuing processing from track', resumeFromTrack);
    if (playlistData) {
      // Update the playlist data with resume point and go back to processing
      const updatedPlaylistData = { 
        ...playlistData, 
        resumeFromTrack,
        url: conversionData?.originalUrl || playlistData.url 
      };
      setPlaylistData(updatedPlaylistData);
      setCurrentStep('processing');
    }
  };

  return (
    <div className="min-h-screen bg-spotify-black text-white">
      <Header />
      
      <main className="max-w-6xl mx-auto px-6 py-8">
        {currentStep === 'loader' && (
          <PlaylistLoader 
            onBack={handleStartOver}
          />
        )}
        
        {currentStep === 'processing' && playlistData && (
          <ProcessingSteps 
            playlistData={playlistData}
            onComplete={handleProcessingComplete}
            onBack={() => {
              // Restore original playlist data and go back to results or input
              if (conversionData) {
                setPlaylistData(originalPlaylistData);
                setCurrentStep('results');
              } else {
                setCurrentStep('input');
              }
            }}
          />
        )}
        
        {currentStep === 'background' && backgroundJobId && (
          <BackgroundProgress 
            jobId={backgroundJobId}
            onComplete={handleBackgroundComplete}
            onCancel={handleBackgroundCancel}
          />
        )}
        
        {currentStep === 'results' && conversionData && (
          <ConversionResults 
            playlist={conversionData}
            onStartOver={handleStartOver}
            onContinueProcessing={handleContinueProcessing}
          />
        )}
      </main>
      
      <Footer />
    </div>
  );
}
