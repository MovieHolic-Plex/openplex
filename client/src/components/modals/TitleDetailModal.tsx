import React, { useState, useEffect } from 'react';
import { X, Play, Bookmark, Star, Calendar, Check, Film, Tv, Download } from 'lucide-react';
import type { MediaItem, Episode } from '@openplex/shared';
import type { TitleDetailResponse } from '../../types';
import { api, downloadKey, type LocalDownloadItem } from '../../api/client';

interface TitleDetailModalProps {
  item: MediaItem | null;
  isOpen: boolean;
  onClose: () => void;
  onPlayEpisode: (episode: Episode, item: MediaItem) => void;
}

export const TitleDetailModal: React.FC<TitleDetailModalProps> = ({
  item,
  isOpen,
  onClose,
  onPlayEpisode,
}) => {
  const [detail, setDetail] = useState<TitleDetailResponse | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [downloads, setDownloads] = useState<Map<string, LocalDownloadItem>>(new Map());

  useEffect(() => {
    if (!item || !isOpen) return;

    let isMounted = true;
    async function fetchDetail() {
      try {
        const cat = item?.category || (item?.mediaType === 'movie' ? 'movie' : item?.mediaType === 'anime' ? 'animation' : 'drama');
        const data = await api.getTitleDetail(item!.id, cat);
        if (isMounted) {
          setDetail(data);
          setIsBookmarked(!!data.isBookmarked);
        }
      } catch (err) {
        console.error('Failed to fetch detail', err);
      }
    }

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [item, isOpen]);

  useEffect(() => {
    if (!item || !isOpen) return;
    let current = true;
    const refresh = async () => {
      try {
        const response = await api.getDownloads();
        if (!current) return;
        setDownloads(new Map(
          response.items.map((row) => [downloadKey(row.category, row.id, row.epIdx), row]),
        ));
      } catch (cause: unknown) {
        console.warn('Failed to load download statuses', cause);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [item, isOpen]);

  // Keyboard escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const backdrop = detail?.backdropPath || item.backdropPath || item.posterPath;
  const episodes = detail?.episodes || [];
  const category = item.category || (item.mediaType === 'movie' ? 'movie' : item.mediaType === 'anime' ? 'animation' : 'drama');
  const numericId = Number(item.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Main Dialog Container */}
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="title-detail-modal-title"
        className="relative pointer-events-auto w-full max-w-4xl bg-zinc-950/95 border border-zinc-800 text-zinc-100 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden z-10 my-auto flex flex-col max-h-[90vh] ring-1 ring-white/5 focus:outline-none"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-30 p-2.5 rounded-full bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 border border-zinc-800/80 backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Hero Banner Header inside Modal */}
        <div className="relative w-full h-[250px] sm:h-[320px] md:h-[360px] flex-none overflow-hidden bg-zinc-950">
          {backdrop ? (
            <>
              {/* Blurred Background effect */}
              <div
                className="absolute inset-0 bg-cover bg-center filter blur-2xl opacity-30 scale-110"
                style={{ backgroundImage: `url(${backdrop})` }}
              />
              {/* Clean Main Image */}
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${backdrop})` }}
              />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950">
              <Film className="w-16 h-16 text-zinc-800" />
            </div>
          )}

          {/* OLED Restrained Gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/40 to-transparent" />

          {/* Modal Header Content */}
          <div className="absolute bottom-5 left-5 right-5 sm:bottom-6 sm:left-6 sm:right-6 flex flex-col justify-end space-y-3 z-20">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="px-2.5 py-0.5 rounded-md bg-amber-500 text-zinc-950 font-black uppercase tracking-wider text-[10px] shadow-sm">
                {item.mediaType}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-zinc-900/90 text-zinc-300 border border-zinc-700/60 font-medium text-[10px] backdrop-blur-sm">
                {detail?.qualityBadge || '4K ULTRA HD'}
              </span>
              {item.voteAverage && (
                <span className="flex items-center gap-1 text-amber-300 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded-md font-bold text-[11px] backdrop-blur-sm">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  {item.voteAverage.toFixed(1)}
                </span>
              )}
              {item.releaseDate && (
                <span className="text-zinc-400 text-xs flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 px-2 py-0.5 rounded-md">
                  <Calendar className="w-3 h-3 text-zinc-400" />
                  {item.releaseDate}
                </span>
              )}
            </div>

            {/* Title */}
            <h2
              id="title-detail-modal-title"
              className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-100 tracking-tight leading-tight"
            >
              {item.title}
            </h2>

            {item.originalTitle && (
              <p className="text-xs sm:text-sm font-medium text-amber-400/90 tracking-wide">
                {item.originalTitle}
              </p>
            )}

            {/* Quick Actions */}
            <div className="flex items-center gap-3 pt-1.5">
              <button
                type="button"
                onClick={() => {
                  const targetEp = episodes[0] || {
                    id: `${item.id}-1`,
                    mediaId: item.id,
                    seasonNumber: 1,
                    episodeNumber: 1,
                    title: 'Episode 1',
                  };
                  onPlayEpisode(targetEp, item);
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-500 text-zinc-950 font-bold text-sm transition shadow-lg shadow-amber-500/20 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <Play className="w-4 h-4 fill-zinc-950" />
                <span>Play Ep 1</span>
              </button>

              <button
                type="button"
                onClick={() => setIsBookmarked(!isBookmarked)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border backdrop-blur-md transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  isBookmarked
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                    : 'bg-zinc-900/80 hover:bg-zinc-800/90 border-zinc-700/70 text-zinc-200 hover:text-white'
                }`}
              >
                {isBookmarked ? (
                  <>
                    <Check className="w-4 h-4 text-amber-400" />
                    <span>In My List</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="w-4 h-4" />
                    <span>Add to List</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Modal Body (Synopsis & Episodes) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Overview / Synopsis */}
          <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/60 p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400/90 mb-2">
              Synopsis
            </h3>
            <p className="text-sm sm:text-base text-zinc-300 leading-relaxed font-normal">
              {detail?.overview || item.overview || 'No synopsis provided for this title.'}
            </p>
          </div>

          {/* Episode List Section */}
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-4 bg-amber-500 rounded-full" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                  Episodes ({episodes.length})
                </h3>
              </div>
              <span className="text-xs font-medium text-zinc-500">Season 1</span>
            </div>

            {episodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30">
                <Tv className="w-8 h-8 text-zinc-600 mb-2" />
                <p className="text-sm font-medium text-zinc-400">Single feature film / Standalone stream</p>
                <p className="text-xs text-zinc-600 mt-0.5">Click &apos;Play Ep 1&apos; to start playback immediately.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {episodes.map((ep) => {
                  const thumb = ep.stillPath || backdrop;
                  const status = Number.isInteger(numericId)
                    ? downloads.get(downloadKey(category, numericId, ep.episodeNumber))
                    : undefined;
                  return (
                    <div
                      key={ep.id}
                      className="group flex text-left gap-3 p-3 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-zinc-800 hover:border-amber-500/40 transition select-none"
                    >
                      <button
                        type="button"
                        onClick={() => onPlayEpisode(ep, item)}
                        className="relative w-28 sm:w-32 aspect-video rounded-lg overflow-hidden bg-zinc-950 flex-none border border-zinc-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={ep.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
                            <Film className="w-5 h-5" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
                          <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-zinc-950 shadow-md">
                            <Play className="w-3.5 h-3.5 fill-zinc-950 translate-x-0.5" />
                          </div>
                        </div>
                      </button>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <button
                            type="button"
                            onClick={() => onPlayEpisode(ep, item)}
                            className="text-xs font-bold text-zinc-200 hover:text-amber-400 transition truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
                          >
                            {ep.title}
                          </button>
                          <span className="text-[10px] text-zinc-500 font-mono flex-none bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                            EP {ep.episodeNumber}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed font-normal">
                          {ep.overview || '별도의 에피소드 설명이 없습니다.'}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`${ep.title} 다운로드`}
                            disabled={status?.download_status === 'pending' || status?.download_status === 'downloading'}
                            onClick={() => {
                              if (!Number.isInteger(numericId)) return;
                              void api.enqueueDownload({
                                category,
                                id: numericId,
                                epIdx: ep.episodeNumber,
                                title: ep.title,
                                thumb: thumb || '',
                              }).then((itemStatus) => {
                                setDownloads((current) => {
                                  const next = new Map(current);
                                  next.set(downloadKey(category, numericId, ep.episodeNumber), itemStatus);
                                  return next;
                                });
                              }).catch((cause: unknown) => {
                                console.warn('Failed to queue download', cause);
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                          >
                            <Download className="h-3 w-3" />
                            {status?.download_status === 'completed'
                              ? '저장됨'
                              : status?.download_status === 'downloading'
                                ? '받는 중'
                                : status?.download_status === 'pending'
                                  ? '대기'
                                  : status?.download_status === 'failed'
                                    ? '다시 받기'
                                    : '다운로드'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
