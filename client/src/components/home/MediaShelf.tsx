import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as ArrowRight } from 'lucide-react';
import type { MediaItem } from '@openplex/shared';
import { MediaCard } from '../common/MediaCard';

interface MediaShelfProps {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  onPlay?: (item: MediaItem) => void;
  onViewAll?: () => void;
  aspect?: 'poster' | 'backdrop';
}

export const MediaShelf: React.FC<MediaShelfProps> = ({
  title,
  items,
  onSelect,
  onPlay,
  onViewAll,
  aspect = 'poster',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -480 : 480;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <section className="group/shelf relative mx-auto w-full max-w-[1536px] px-4 py-6 sm:px-6 lg:px-8">
      {/* Shelf Header */}
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-1 rounded-full bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.35)]" />
          <h2 className="text-lg font-bold tracking-[-0.02em] text-white sm:text-xl">
            {title}
          </h2>
        </div>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className="group/btn flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-zinc-400 transition hover:bg-white/[0.04] hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
          >
            <span>Explore All</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Navigation Buttons */}
      <button
        onClick={() => handleScroll('left')}
        aria-label="Scroll left"
        className="absolute left-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-950/85 text-zinc-300 opacity-0 shadow-xl backdrop-blur-xl transition-all hover:bg-zinc-800 hover:text-white focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 group-hover/shelf:opacity-100 sm:left-3"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <button
        onClick={() => handleScroll('right')}
        aria-label="Scroll right"
        className="absolute right-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-950/85 text-zinc-300 opacity-0 shadow-xl backdrop-blur-xl transition-all hover:bg-zinc-800 hover:text-white focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 group-hover/shelf:opacity-100 sm:right-3"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Media Carousel */}
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory items-center gap-4 overflow-x-auto px-1 py-4 scrollbar-none scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            onSelect={onSelect}
            onPlay={onPlay}
            aspect={aspect}
          />
        ))}
      </div>
    </section>
  );
};
