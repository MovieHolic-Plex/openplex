import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ComicReader } from '../components/ComicReader';
import { api, type LibraryUnit, type LibraryWork } from '../api/client';

export const ComicsPage: React.FC = () => {
  const [works, setWorks] = useState<LibraryWork[]>([]);
  const [selected, setSelected] = useState<{ work: LibraryWork; units: LibraryUnit[] } | null>(null);
  const [readerUnitId, setReaderUnitId] = useState<number | null>(null);
  const [root, setRoot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = async () => {
    const items = await api.getLibrary('comic');
    setWorks(items);
  };

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '보관함을 불러오지 못했습니다.');
    });
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400/90">보관함</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-100">만화</h1>
          <p className="mt-2 text-sm text-zinc-500">폴더나 CBZ를 이 컴퓨터에서 가져옵니다.</p>
        </div>
        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!root.trim()) return;
            setImporting(true);
            setError(null);
            void api.importLibrary(root.trim())
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : '가져오기에 실패했습니다.');
              })
              .finally(() => setImporting(false));
          }}
        >
          <input
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            placeholder="C:\\Comics"
            aria-label="가져올 폴더 경로"
            className="min-h-11 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          />
          <button
            type="submit"
            disabled={importing}
            className="rounded-xl bg-amber-500 px-4 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {importing ? '가져오는 중' : '가져오기'}
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {works.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <BookOpen className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-400">가져온 만화가 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {works.map((work) => (
            <button
              key={work.id}
              type="button"
              onClick={() => {
                void api.getLibraryWork(work.id).then(setSelected);
              }}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 text-left hover:border-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <div className="mb-3 flex aspect-[2/3] items-center justify-center rounded-xl bg-zinc-950 text-zinc-600">
                <BookOpen className="h-8 w-8" />
              </div>
              <p className="truncate text-sm font-bold text-zinc-100">{work.title}</p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-zinc-100">{selected.work.title}</h2>
          <ul className="space-y-2">
            {selected.units.map((unit) => (
              <li key={unit.id}>
                <button
                  type="button"
                  onClick={() => setReaderUnitId(unit.id)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left text-sm font-semibold text-zinc-200 hover:border-amber-500/40"
                >
                  {unit.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {readerUnitId !== null && (
        <ComicReader unitId={readerUnitId} onClose={() => setReaderUnitId(null)} />
      )}
    </div>
  );
};
