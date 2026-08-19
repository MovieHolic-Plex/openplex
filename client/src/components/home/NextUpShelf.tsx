import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { NextUpItem } from '../../api/client';

interface NextUpShelfProps {
  items: NextUpItem[];
  onPlay: (item: NextUpItem) => void;
}

export const NextUpShelf: React.FC<NextUpShelfProps> = ({ items, onPlay }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const handleScroll = (direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -400 : 400,
      behavior: 'smooth',
    });
  };

  return (
    <section className="group/shelf relative mx-auto w-full max-w-[1536px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-1 rounded-full bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.35)]" />
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
          이어서 보세요
        </h2>
      </div>

      <button
        type="button"
        onClick={() => handleScroll('left')}
        aria-label="Scroll next up left"
        className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-700/80 backdrop-blur-md opacity-0 group-hover/shelf:opacity-100 transition-all shadow-xl"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={() => handleScroll('right')}
        aria-label="Scroll next up right"
        className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-700/80 backdrop-blur-md opacity-0 group-hover/shelf:opacity-100 transition-all shadow-xl"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory items-center gap-4 overflow-x-auto px-1 py-4 scrollbar-none scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => {
          const image = item.thumb || item.seriesThumb;
          const episodeLabel = `${item.nextOrdinal + 1}화`;

          return (
            <article
              key={`${item.category}-${item.id}-${item.epIdx}`}
              className="group relative aspect-[16/9] w-[260px] flex-none snap-start select-none overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900 shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/30 hover:shadow-[0_20px_46px_rgba(0,0,0,0.42)] sm:w-[310px]"
            >
              {image ? (
                <img
                  src={image}
                  alt={item.seriesTitle}
                  loading="lazy"
                  className="w-full h-full object-cover object-center transition duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-500 font-bold">
                  {item.seriesTitle}
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />

              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-zinc-100 line-clamp-1 group-hover:text-amber-400 transition-colors">
                    {item.seriesTitle}
                  </h3>
                  <p className="text-xs text-zinc-400 line-clamp-1">
                    {episodeLabel}{item.title ? ` · ${item.title}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPlay(item)}
                  aria-label={`${item.seriesTitle} ${episodeLabel} 재생`}
                  className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 shadow-lg shadow-black/40 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                >
                  <Play className="w-3.5 h-3.5 fill-zinc-950" />
                  재생
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
