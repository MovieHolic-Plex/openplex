import React from 'react';
import { Play } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', className = '', onClick }) => {
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <div
      className={`inline-flex items-center gap-2.5 cursor-pointer select-none group transition ${className}`}
      onClick={onClick}
    >
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 bg-amber-500/20 blur-md rounded-full group-hover:bg-amber-500/40 transition duration-300" />
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-105 transition duration-300">
          <Play className="w-4 h-4 fill-zinc-950 text-zinc-950 translate-x-0.5" />
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1">
          <span className={`font-black tracking-tight ${textSize} bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-400 bg-clip-text text-transparent`}>
            OPEN<span className="text-amber-400">PLEX</span>
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            WEB
          </span>
        </div>
      </div>
    </div>
  );
};
