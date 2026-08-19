import React, { useEffect, useState } from 'react';
import { BookOpen, Download, Play, X } from 'lucide-react';
import { api, type LibraryUnit, type LibraryWork } from '../api/client';

interface WorkDetailProps {
  workId: number;
  onClose: () => void;
  onPlayVideo: (spec: {
    category: string;
    id: number;
    epIdx: number;
    title: string;
    thumb: string;
  }) => void;
  onPlayLocal: (spec: { fileUrl: string; title: string }) => void;
  onReadComic: (unitId: number) => void;
}

function parseTvwikiUnit(externalId: string): { category: string; id: number; epIdx: number } | null {
  const match = /^([a-z_]+)\/(\d+)\/(\d+)$/.exec(externalId);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return { category: match[1], id: Number(match[2]), epIdx: Number(match[3]) };
}

export const WorkDetail: React.FC<WorkDetailProps> = ({
  workId,
  onClose,
  onPlayVideo,
  onPlayLocal,
  onReadComic,
}) => {
  const [work, setWork] = useState<LibraryWork | null>(null);
  const [units, setUnits] = useState<LibraryUnit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api.getLibraryWork(workId)
      .then((detail) => {
        if (!current) return;
        setWork(detail.work);
        setUnits(detail.units);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : '작품을 열 수 없습니다.');
      });
    return () => {
      current = false;
    };
  }, [workId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-detail-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
              {work?.kind ?? 'work'}
            </p>
            <h2 id="work-detail-title" className="text-2xl font-black text-zinc-100">
              {work?.title ?? '불러오는 중'}
            </h2>
            {work?.overview && <p className="mt-2 text-sm text-zinc-400">{work.overview}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}

        <ul className="space-y-2">
          {units.map((unit) => (
            <li
              key={unit.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2"
            >
              <span className="truncate text-sm font-semibold text-zinc-200">{unit.title}</span>
              <div className="flex shrink-0 gap-1">
                {unit.kind === 'chapter' ? (
                  <button
                    type="button"
                    onClick={() => onReadComic(unit.id)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-amber-400 hover:bg-zinc-800"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    읽기
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void api.getUnitBinding(unit.id).then((binding) => {
                          const spec = parseTvwikiUnit(binding.externalId);
                          if (spec) {
                            onPlayVideo({ ...spec, title: unit.title, thumb: unit.thumb ?? '' });
                            return;
                          }
                          return api.createUnitStream(unit.id).then((stream) => {
                            onPlayLocal({ fileUrl: stream.fileUrl, title: stream.title || unit.title });
                          });
                        }).catch(() => {
                          void api.createUnitStream(unit.id).then((stream) => {
                            onPlayLocal({ fileUrl: stream.fileUrl, title: stream.title || unit.title });
                          });
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-amber-400 hover:bg-zinc-800"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      재생
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void api.enqueueDownloadByUnit(unit.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      받기
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
