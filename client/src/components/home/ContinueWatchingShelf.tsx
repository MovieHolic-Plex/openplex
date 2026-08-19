import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { WatchHistoryItem } from '@openplex/shared';

interface ContinueWatchingShelfProps {
  items: WatchHistoryItem[];
  onPlay: (item: WatchHistoryItem) => void;
  onSelect: (item: WatchHistoryItem) => void;
}

export const ContinueWatchingShelf: React.FC<ContinueWatchingShelfProps> = ({
  items,
  onPlay,
  onSelect,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -400 : 400;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <section className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 group/shelf">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 bg-amber-500 rounded-full" />
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
            Continue Watching
          </h2>
        </div>
      </div>

      {/* Navigation Buttons */}
      <button
        onClick={() => handleScroll('left')}
        aria-label="Scroll left"
        className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-700/80 backdrop-blur-md opacity-0 group-hover/shelf:opacity-100 transition-all shadow-xl"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <button
        onClick={() => handleScroll('right')}
        aria-label="Scroll right"
        className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-700/80 backdrop-blur-md opacity-0 group-hover/shelf:opacity-100 transition-all shadow-xl"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Horizontal Carousel List */}
      <div
        ref={scrollRef}
        className="flex items-center gap-4 overflow-x-auto scrollbar-none py-2 px-1 scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((entry) => {
          const progressPercent = Math.min(
            100,
            Math.round((entry.progressSeconds / Math.max(1, entry.durationSeconds)) * 100)
          );

          const media = entry.mediaItem;
          const thumbnail = media.backdropPath || media.posterPath;

          return (
            <div
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="group relative flex-none w-[240px] sm:w-[280px] aspect-[16/9] cursor-pointer rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/80 transition-all duration-300 hover:scale-105 hover:z-10 hover:border-amber-500/50 hover:shadow-2xl hover:shadow-black/80 select-none"
            >
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={media.title}
                  loading="lazy"
                  className="w-full h-full object-cover object-center transition duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600 font-bold">
                  {media.title}
                </div>
              )}

              {/* Dark Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />

              {/* Play Badge Icon */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(entry);
                  }}
                  aria-label={`Play ${media.title}`}
                  className="w-12 h-12 rounded-full bg-amber-500/90 text-zinc-950 flex items-center justify-center shadow-lg shadow-black/50 transform group-hover:scale-110 transition"
                >
                  <Play className="w-5 h-5 fill-zinc-950 translate-x-0.5" />
                </button>
              </div>

              {/* Text Info */}
              <div className="absolute bottom-3 left-3 right-3 space-y-1">
                <h3 className="font-bold text-sm text-zinc-100 line-clamp-1 group-hover:text-amber-400 transition-colors">
                  {media.title}
                </h3>
                {entry.episodeTitle && (
                  <p className="text-xs text-zinc-400 line-clamp-1">{entry.episodeTitle}</p>
                )}
              </div>

              {/* Progress Bar Container */}
              <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800/90">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
