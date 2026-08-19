import React, { useEffect, useState } from 'react';
import { BookOpen, Download } from 'lucide-react';
import { WorkDetail } from '../components/WorkDetail';
import { ComicReader } from '../components/ComicReader';
import { api, type LibraryWork, type LocalDownloadItem } from '../api/client';

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'video_series', label: '시리즈' },
  { id: 'movie', label: '영화' },
  { id: 'comic', label: '만화' },
  { id: 'downloads', label: '받은 영상' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

const SORTS = [
  { id: 'recent', label: '최신' },
  { id: 'added', label: '추가순' },
  { id: 'title', label: '제목' },
  { id: 'year', label: '연도' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

const KIND_LABELS: Record<string, string> = {
  video_series: '시리즈',
  movie: '영화',
  comic: '만화',
};

interface LibraryPageProps {
  visitor?: boolean;
  onPlayVideo: (spec: {
    category: string;
    id: number;
    epIdx: number;
    title: string;
    thumb: string;
  }) => void;
  onPlayLocal: (spec: { fileUrl: string; title: string }) => void;
  onOpenServerSettings?: () => void;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ visitor = false, onPlayVideo, onPlayLocal, onOpenServerSettings }) => {
  const [filter, setFilter] = useState<FilterId>('all');
  const [sort, setSort] = useState<SortId>('recent');
  const [works, setWorks] = useState<LibraryWork[]>([]);
  const [downloads, setDownloads] = useState<LocalDownloadItem[]>([]);
  const [libraries, setLibraries] = useState<Array<{ id: number; name: string; kind: string }>>([]);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [workId, setWorkId] = useState<number | null>(null);
  const [readerUnitId, setReaderUnitId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const load = async () => {
      if (filter === 'downloads') {
        const list = await api.getDownloads();
        if (current) setDownloads(list.items);
        return;
      }
      const items = await api.getLibrary(filter === 'all' ? undefined : filter, {
        libraryId: libraryId ?? undefined,
        sort,
      });
      if (current) setWorks(items);
    };
    void load().catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : '보관함을 불러오지 못했습니다.');
    });
    return () => {
      current = false;
    };
  }, [filter, libraryId, sort]);

  useEffect(() => {
    void api.getLibraries().then(setLibraries).catch(() => undefined);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-28 sm:px-6 lg:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400/90">보관함</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-100">내 라이브러리</h1>
      <p className="mt-2 text-sm text-zinc-500">가져온 만화와 카탈로그에서 연 작품이 여기 모입니다. Plex처럼 보관함·장르로 나눕니다.</p>

      {libraries.length > 0 && (
        <div role="group" aria-label="보관함" className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={libraryId === null}
            onClick={() => setLibraryId(null)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              libraryId === null ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            모든 보관함
          </button>
          {libraries.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={libraryId === item.id}
              onClick={() => setLibraryId(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                libraryId === item.id ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}

      {!visitor && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
          event.preventDefault();
          const next = importUrl.trim();
          if (!next) return;
          void api.ingestUrl(next).then((items) => {
            setWorks((current) => [...items, ...current]);
            setImportUrl('');
          }).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'URL을 가져오지 못했습니다.');
          });
        }}
      >
        <input
          value={importUrl}
          onChange={(event) => setImportUrl(event.target.value)}
          placeholder="로컬 경로 또는 직접 미디어 URL"
          className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black">
          URL 가져오기
        </button>
      </form>
      )}

      <div role="group" aria-label="종류" className="mt-6 flex flex-wrap gap-2">
        {FILTERS.filter((item) => !visitor || item.id !== 'downloads').map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              filter === item.id
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {filter !== 'downloads' && (
        <div role="group" aria-label="정렬" className="mt-2 flex flex-wrap gap-2" data-testid="library-sorts">
          {SORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={sort === item.id}
              onClick={() => setSort(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                sort === item.id
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}

      {filter === 'downloads' ? (
        <ul className="mt-8 space-y-2">
          {downloads.length === 0 && (
            <li className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              받은 영상이 없습니다
            </li>
          )}
          {downloads.map((item) => (
            <li
              key={`${item.category}:${item.id}:${item.epIdx}`}
              className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm"
            >
              <span className="font-semibold text-zinc-100">{item.title}</span>
              <span className="text-xs text-zinc-500">{item.download_status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {works.length === 0 && !visitor && (
            <div className="col-span-full rounded-2xl border border-dashed border-zinc-800 px-4 py-16 text-center">
              <p className="text-sm text-zinc-500">폴더를 지정하고 스캔하세요</p>
              {onOpenServerSettings && (
                <button
                  type="button"
                  onClick={onOpenServerSettings}
                  className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black"
                >
                  서버 설정 열기
                </button>
              )}
            </div>
          )}
          {works.length === 0 && visitor && (
            <p className="col-span-full rounded-2xl border border-dashed border-zinc-800 px-4 py-16 text-center text-sm text-zinc-500">
              공개된 작품이 없습니다
            </p>
          )}
          {works.map((work) => (
            <button
              key={work.id}
              type="button"
              onClick={() => setWorkId(work.id)}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 text-left hover:border-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <div className="mb-3 flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-zinc-950 text-zinc-600">
                {work.poster ? (
                  <img src={work.poster} alt={work.title} loading="lazy" className="h-full w-full object-cover object-center" />
                ) : work.kind === 'comic' ? <BookOpen className="h-8 w-8" /> : <Download className="h-8 w-8" />}
              </div>
              <p className="line-clamp-2 text-sm font-bold text-zinc-100">{work.title}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{KIND_LABELS[work.kind] ?? work.kind}</p>
            </button>
          ))}
        </div>
      )}

      {workId !== null && (
        <WorkDetail
          workId={workId}
          onClose={() => setWorkId(null)}
          onPlayVideo={(spec) => {
            setWorkId(null);
            onPlayVideo(spec);
          }}
          onPlayLocal={(spec) => {
            setWorkId(null);
            onPlayLocal(spec);
          }}
          onReadComic={(unitId) => {
            setWorkId(null);
            setReaderUnitId(unitId);
          }}
        />
      )}
      {readerUnitId !== null && (
        <ComicReader unitId={readerUnitId} onClose={() => setReaderUnitId(null)} />
      )}
    </div>
  );
};
