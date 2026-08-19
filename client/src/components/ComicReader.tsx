import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api, type ComicMeta } from '../api/client';

interface ComicReaderProps {
  unitId: number;
  onClose: () => void;
}

export const ComicReader: React.FC<ComicReaderProps> = ({ unitId, onClose }) => {
  const [meta, setMeta] = useState<ComicMeta | null>(null);
  const [page, setPage] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api.getComic(unitId)
      .then((loaded) => {
        if (current) setMeta(loaded);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : '만화를 열 수 없습니다.');
      });
    return () => {
      current = false;
    };
  }, [unitId]);

  useEffect(() => {
    if (!meta) return;
    let current = true;
    let objectUrl: string | null = null;
    void api.fetchComicPage(unitId, page)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        void api.saveComicProgress(unitId, page, meta.pageCount);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : '페이지를 불러오지 못했습니다.');
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [unitId, page, meta]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && meta && page < meta.pageCount - 1) setPage((current) => current + 1);
      if (event.key === 'ArrowLeft' && page > 0) setPage((current) => current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta, page, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      data-testid="comic-reader"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <p className="truncate text-sm font-semibold text-zinc-100">
          {meta ? `${meta.work.title} · ${meta.unit.title}` : '불러오는 중'}
        </p>
        <div className="flex items-center gap-2">
          {meta && (
            <span className="font-mono text-xs text-zinc-400">
              {page + 1} / {meta.pageCount}
            </span>
          )}
          <button
            type="button"
            aria-label="Close reader"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={`${meta?.unit.title ?? 'comic'} ${page + 1}`}
            className="max-h-full max-w-full object-contain"
          />
        )}
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          className="absolute left-3 rounded-full bg-zinc-900/80 p-2 text-zinc-200 disabled:opacity-30"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={!meta || page >= meta.pageCount - 1}
          onClick={() => setPage((current) => current + 1)}
          className="absolute right-3 rounded-full bg-zinc-900/80 p-2 text-zinc-200 disabled:opacity-30"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
};
