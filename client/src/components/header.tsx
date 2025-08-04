import { Music, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

export default function Header() {
  // No YouTube authentication needed - app works without login

  return (
    <header className="bg-spotify-dark border-b border-spotify-gray">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-600 rounded-full flex items-center justify-center">
              <Music className="text-white text-lg" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Spiny Nebula</h1>
              <p className="text-sm text-spotify-light-gray">Playlist Translation Service</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-spotify-light-gray hover:text-white hover:bg-spotify-gray"
              onClick={() => window.open('https://github.com/mattjagiello/spiny-nebula', '_blank')}
            >
              <Github className="w-4 h-4 mr-2" />
              Source Code
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
