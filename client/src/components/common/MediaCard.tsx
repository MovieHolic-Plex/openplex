import React from 'react';
import { Play, Star, Check } from 'lucide-react';
import type { MediaItem } from '@openplex/shared';

interface MediaCardProps {
  item: MediaItem;
  onSelect: (item: MediaItem) => void;
  onPlay?: (item: MediaItem) => void;
  aspect?: 'poster' | 'backdrop';
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  onSelect,
  onPlay,
  aspect = 'poster',
}) => {
  const isPoster = aspect === 'poster';
  const imageSrc = isPoster
    ? item.posterPath || item.backdropPath
    : item.backdropPath || item.posterPath;

  const watchState = item.watchState;
  const isWatched = !!watchState?.watched;
  const rawProgress = typeof watchState?.progress === 'number' ? watchState.progress : 0;
  const hasProgress =
    !isWatched &&
    Number.isFinite(rawProgress) &&
    rawProgress > 0 &&
    rawProgress < 0.9;
  const progressPercent = hasProgress
    ? Math.max(0, Math.min(100, Math.round(rawProgress * 100)))
    : 0;

  const unwatchedCount =
    typeof watchState?.unwatchedCount === 'number' && Number.isFinite(watchState.unwatchedCount)
      ? watchState.unwatchedCount
      : null;
  const showUnwatchedChip =
    item.mediaType !== 'movie' &&
    unwatchedCount !== null &&
    unwatchedCount > 0;

  return (
    <article
      tabIndex={0}
      role="button"
      aria-label={`${item.title} 상세 보기`}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={`group relative flex-none snap-start cursor-pointer select-none overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900 shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/30 hover:shadow-[0_20px_46px_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
        isPoster
          ? 'w-[160px] sm:w-[190px] md:w-[210px] aspect-[2/3]'
          : 'w-[240px] sm:w-[280px] md:w-[320px] aspect-[16/9]'
      }`}
    >
      {/* Thumbnail Image */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={item.title}
          loading="lazy"
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-110"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 p-4 text-center">
          <span className="text-zinc-600 font-bold text-sm">NO POSTER</span>
          <span className="text-zinc-400 text-xs mt-1 line-clamp-2">{item.title}</span>
        </div>
      )}

      {/* Top Badges / Chips */}
      <div className="absolute top-2 left-2 right-2 flex items-start justify-between pointer-events-none z-10 gap-1.5">
        {/* Unwatched Count Chip for series */}
        {showUnwatchedChip ? (
          <span
            data-testid="unwatched-chip"
            className="px-2 py-0.5 rounded-full bg-zinc-950/85 backdrop-blur-md text-amber-400 text-[10px] font-bold border border-amber-500/40 shadow-md"
          >
            {unwatchedCount}화 남음
          </span>
        ) : (
          <div />
        )}

        {/* Watched Circular Check Badge */}
        {isWatched && (
          <span
            data-testid="watched-badge"
            aria-label="Watched"
            className="w-6 h-6 rounded-full bg-amber-500 text-zinc-950 flex items-center justify-center shadow-lg shadow-black/60 border border-amber-400 ml-auto"
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </span>
        )}
      </div>

      {/* Subtle overlay gradient always present */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-80 group-hover:opacity-95 transition-opacity" />

      {/* Hover Card Details Overlay */}
      <div className="absolute inset-0 p-3.5 flex flex-col justify-end opacity-90 group-hover:opacity-100 transition-opacity duration-300">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400">
            <span className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 uppercase tracking-wider text-[9px] border border-zinc-700/50">
              {item.mediaType.toUpperCase()}
            </span>
            {item.voteAverage && (
              <span className="flex items-center gap-0.5 text-amber-400">
                <Star className="w-3 h-3 fill-amber-400" />
                {item.voteAverage.toFixed(1)}
              </span>
            )}
            {item.releaseDate && <span>{item.releaseDate.split('-')[0]}</span>}
          </div>

          <h3 className="font-bold text-sm text-zinc-100 line-clamp-1 group-hover:text-amber-400 transition-colors">
            {item.title}
          </h3>

          {item.originalTitle && (
            <p className="text-[11px] text-zinc-400 line-clamp-1 font-medium">
              {item.originalTitle}
            </p>
          )}
        </div>

        {/* Quick Play Trigger on Card Hover */}
        <div className="mt-2.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-2 group-hover:translate-y-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onPlay) onPlay(item);
              else onSelect(item);
            }}
            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 shadow-md transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            <Play className="w-3.5 h-3.5 fill-zinc-950" />
            <span>Play</span>
          </button>
        </div>
      </div>

      {/* In-progress bar at bottom */}
      {hasProgress && (
        <div
          data-testid="progress-bar-container"
          className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/90 z-10 overflow-hidden"
        >
          <div
            data-testid="progress-bar"
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </article>
  );
};
