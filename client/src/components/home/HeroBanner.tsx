import React, { useState, useEffect } from 'react';
import { Play, Info, ChevronRight, ChevronLeft, Star, Calendar } from 'lucide-react';
import type { MediaItem } from '@openplex/shared';

interface HeroBannerProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  items,
  onPlay,
  onMoreInfo,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (items.length <= 1 || isHovered) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [items.length, isHovered]);

  if (!items || items.length === 0) return null;

  const current = items[currentIndex] || items[0];

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % items.length);
  };

  return (
    <div
      className="relative min-h-[540px] w-full select-none overflow-hidden sm:min-h-[620px] lg:min-h-[680px] lg:max-h-[820px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Dynamic CSS blurred backdrop */}
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-25 blur-3xl transition-all duration-1000"
        style={{
          backgroundImage: `url(${current.backdropPath || current.posterPath})`,
        }}
      />

      {/* Main Crisp Artwork with Layered Gradients */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-700 sm:bg-right"
        style={{
          backgroundImage: `url(${current.backdropPath || current.posterPath})`,
        }}
      >
        {/* Horizontal Gradient for text contrast */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(9,9,11,0.98)_0%,rgba(9,9,11,0.88)_28%,rgba(9,9,11,0.46)_58%,rgba(9,9,11,0.12)_100%)]" />
        {/* Bottom bleed into page content */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
        {/* Top vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/80 via-transparent to-transparent h-28" />
      </div>

      {/* Content Container */}
      <div className="relative z-10 mx-auto flex min-h-[540px] max-w-[1536px] flex-col justify-end px-4 pb-20 pt-28 sm:min-h-[620px] sm:px-6 sm:pb-24 lg:min-h-[680px] lg:px-8">
        <div className="max-w-2xl space-y-4 sm:space-y-5">
          {/* Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            <span className="px-2.5 py-0.5 rounded bg-amber-500 text-zinc-950 uppercase tracking-wider font-bold">
              {current.mediaType === 'tv' ? 'Series' : current.mediaType.toUpperCase()}
            </span>
            {current.voteAverage && (
              <span className="flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded">
                <Star className="w-3.5 h-3.5 fill-amber-400" />
                {current.voteAverage.toFixed(1)}
              </span>
            )}
            {current.releaseDate && (
              <span className="flex items-center gap-1 text-zinc-300 bg-zinc-900/80 border border-zinc-700/60 px-2 py-0.5 rounded">
                <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                {current.releaseDate}
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-700/60 text-zinc-300">
              4K Ultra HD
            </span>
          </div>

          {/* Title */}
          <h1 className="max-w-xl text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white drop-shadow-lg sm:text-6xl lg:text-7xl">
            {current.title}
          </h1>

          {/* Original Title / Tag */}
          {current.originalTitle && (
            <p className="text-sm sm:text-base font-medium text-amber-300/80 tracking-wide">
              {current.originalTitle}
            </p>
          )}

          {/* Overview */}
          <p className="max-w-xl text-sm leading-6 text-zinc-300 drop-shadow line-clamp-3 sm:text-base sm:leading-7">
            {current.overview}
          </p>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => onPlay(current)}
              className="group flex min-h-12 items-center gap-2.5 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 shadow-[0_14px_34px_rgba(245,158,11,0.22)] transition duration-300 hover:-translate-y-0.5 hover:bg-amber-400 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 sm:text-base"
            >
              <Play className="w-5 h-5 fill-zinc-950" />
              <span>Watch Now</span>
            </button>
            <button
              onClick={() => onMoreInfo(current)}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-white/[0.1] bg-black/35 px-5 py-3 text-sm font-semibold text-zinc-100 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:text-base"
            >
              <Info className="w-5 h-5 text-zinc-300" />
              <span>Details</span>
            </button>
          </div>
        </div>
      </div>

      {/* Carousel Controls */}
      {items.length > 1 && (
        <div className="absolute bottom-8 right-4 z-20 flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-black/35 p-1.5 shadow-xl backdrop-blur-xl sm:right-8">
          <button
            onClick={handlePrev}
            aria-label="Previous Slide"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div role="tablist" aria-label="추천 작품 슬라이드" className="flex items-center gap-1.5 px-1.5">
            {items.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Slide ${idx + 1}`}
                aria-selected={idx === currentIndex}
                role="tab"
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? 'w-6 bg-amber-500' : 'w-2 bg-zinc-700 hover:bg-zinc-500'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNext}
            aria-label="Next Slide"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};
