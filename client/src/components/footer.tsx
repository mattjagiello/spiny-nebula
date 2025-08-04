export default function Footer() {
  return (
    <footer className="bg-spotify-dark border-t border-spotify-gray mt-16">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h4 className="font-semibold text-lg mb-4 text-white">About</h4>
            <p className="text-spotify-light-gray text-sm leading-relaxed">
              Open source playlist converter that transforms Spotify playlists into YouTube collections. 
              Built for privacy and transparency - no tracking, no data collection.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-lg mb-4 text-white">How it Works</h4>
            <ul className="text-spotify-light-gray text-sm space-y-2">
              <li>• Paste your public Spotify playlist URL</li>
              <li>• System searches for official videos on YouTube</li>
              <li>• Creates working YouTube playlist links instantly</li>
              <li>• No login required - completely private</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-lg mb-4 text-white">Safety & Open Source</h4>
            <ul className="text-spotify-light-gray text-sm space-y-2">
              <li>• Built with TypeScript, React, and Node.js</li>
              <li>• No personal data stored or transmitted</li>
              <li>• <a href="https://github.com/mattjagiello/spiny-nebula" target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-300 underline">Source code available on GitHub</a> for transparency</li>
              <li>• Uses only public APIs - designed for privacy</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-spotify-gray mt-8 pt-8 text-center text-spotify-light-gray text-sm">
          <p>&copy; 2025 <span 
            className="cursor-pointer hover:text-pink-400 transition-colors duration-200" 
            onClick={() => window.open('https://www.youtube.com/shorts/iHy2nya_L6M', '_blank')}
            title="🎵"
          >Spiny Nebula</span>. Open source software - not affiliated with Spotify or YouTube.</p>
        </div>
      </div>
    </footer>
  );
}
