import React, { useEffect, useState } from 'react';
import { Download, Play, Trash2, X } from 'lucide-react';
import {
  api,
  type LocalDownloadItem,
} from '../../api/client';

interface DownloadManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlay: (item: LocalDownloadItem) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function statusLabel(item: LocalDownloadItem): string {
  switch (item.download_status) {
    case 'completed':
      return '저장됨';
    case 'downloading': {
      const total = item.total_segments;
      if (total > 0) {
        return `받는 중 ${Math.round((item.done_segments / total) * 100)}%`;
      }
      return '받는 중';
    }
    case 'pending':
      return '대기';
    case 'failed':
      return item.error ? `실패 · ${item.error}` : '실패';
    default: {
      const unexpected: never = item.download_status;
      return unexpected;
    }
  }
}

export const DownloadManagerModal: React.FC<DownloadManagerModalProps> = ({
  isOpen,
  onClose,
  onPlay,
}) => {
  const [items, setItems] = useState<LocalDownloadItem[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [maxBytes, setMaxBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let current = true;

    const refresh = async () => {
      try {
        const response = await api.getDownloads();
        if (!current) return;
        setItems(response.items);
        setUsedBytes(response.usedBytes);
        setMaxBytes(response.maxBytes);
        setError(null);
      } catch (cause: unknown) {
        if (current) {
          setError(cause instanceof Error ? cause.message : '다운로드 목록을 불러오지 못했습니다.');
        }
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
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const usedRatio = maxBytes > 0 ? Math.min(1, usedBytes / maxBytes) : 0;

  return (
    <div
      data-testid="download-manager-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-md animate-in fade-in duration-200 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-manager-title"
        className="my-auto flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/80 ring-1 ring-white/5"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/15 p-2 text-amber-400">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 id="download-manager-title" className="text-lg font-bold text-zinc-100">받은 영상</h2>
              <p className="text-xs font-normal text-zinc-400">로컬에 저장한 에피소드와 받는 중인 작업</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close downloads"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-zinc-800/80 px-5 py-3 sm:px-6">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-zinc-400">
            <span>디스크 사용</span>
            <span className="font-mono text-zinc-300">
              {formatBytes(usedBytes)} / {formatBytes(maxBytes)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
              style={{ width: `${usedRatio * 100}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {error && (
            <p role="alert" className="mb-3 rounded-xl border border-red-500/30 bg-red-950/40 p-2.5 text-xs font-medium text-red-400">
              {error}
            </p>
          )}

          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-12 text-center">
              <Download className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
              <p className="text-sm font-medium text-zinc-400">아직 받은 영상이 없습니다</p>
              <p className="mt-0.5 text-xs text-zinc-600">재생하면 뒤에서 받고, 상세에서 바로 받을 수도 있습니다.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {items.map((item) => (
                <li
                  key={`${item.category}:${item.id}:${item.epIdx}`}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {item.category} · {item.id} · EP {item.epIdx}
                      {item.size_bytes > 0 ? ` · ${formatBytes(item.size_bytes)}` : ''}
                    </p>
                    <p
                      className={`mt-1 text-[11px] font-semibold ${
                        item.download_status === 'failed' ? 'text-red-400' : 'text-amber-400/90'
                      }`}
                    >
                      {statusLabel(item)}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    {item.download_status === 'completed' && (
                      <button
                        type="button"
                        aria-label={`${item.title} 재생`}
                        onClick={() => onPlay(item)}
                        className="rounded-lg p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${item.title} 삭제`}
                      onClick={() => {
                        void api.deleteDownload(item.category, item.id, item.epIdx)
                          .then(() => setItems((current) => current.filter((row) => (
                            row.category !== item.category || row.id !== item.id || row.epIdx !== item.epIdx
                          ))))
                          .catch((cause: unknown) => {
                            setError(cause instanceof Error ? cause.message : '삭제하지 못했습니다.');
                          });
                      }}
                      className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};
