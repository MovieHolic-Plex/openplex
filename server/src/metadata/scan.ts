import type { LibraryStore, Work } from '../store/library-store.js';
import type { WorkMeta } from '../store/taxonomy.js';
import { daumProvider } from './providers/daum.js';
import { kmdbProvider } from './providers/kmdb.js';
import { naverProvider } from './providers/naver.js';
import type { MetaHit, MetaLookup, MetaProvider } from './providers/types.js';
import { watchaProvider } from './providers/watcha.js';

export type FilenameHint = {
  readonly title: string;
  readonly year: number | null;
  readonly season: number | null;
  readonly episode: number | null;
};

const YEAR = /\b((?:19|20)\d{2})\b/;
const SE = /[Ss](\d{1,2})[Ee](\d{1,3})/;

export function parseFilenameHint(raw: string): FilenameHint {
  const base = raw.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/[._]+/g, ' ').trim();
  const se = SE.exec(base);
  const yearMatch = YEAR.exec(base);
  let title = base;
  if (se) title = title.slice(0, se.index);
  else if (yearMatch) title = title.slice(0, yearMatch.index);
  title = title.replace(/\b(1080p|720p|480p|2160p|4K|WEB[- ]?DL|BluRay|x264|x265|HDTV)\b/ig, '');
  title = title.replace(/\s+/g, ' ').trim();
  return {
    title: title.length > 0 ? title : base,
    year: yearMatch ? Number(yearMatch[1]) : null,
    season: se ? Number(se[1]) : null,
    episode: se ? Number(se[2]) : null,
  };
}

export type TmdbHit = {
  readonly id: number;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly overview: string | null;
  readonly poster: string | null;
  readonly year: number | null;
};

export type TmdbClient = {
  search(query: string, kind: 'movie' | 'tv'): Promise<TmdbHit | null>;
};

export type ScanWorkOptions = {
  readonly providers?: readonly MetaProvider[];
  readonly force?: boolean;
};

export type ScanWorkResult = WorkMeta & {
  readonly matched: boolean;
  readonly provider?: string;
  readonly reason?: 'TMDB_KEY_MISSING' | 'NO_MATCH' | 'PROVIDER_BLOCKED';
};

export async function scanWork(
  library: LibraryStore,
  work: Work,
  options: ScanWorkOptions = {},
): Promise<ScanWorkResult> {
  const hint = parseFilenameHint(work.title);
  const current = library.taxonomy.getMeta(work.id);
  if (hint.title.length > 0 && hint.title !== work.title) {
    library.upsertWorkTitle(work.id, hint.title);
  }
  let patch: Partial<Omit<WorkMeta, 'work_id'>> = {
    year: hint.year ?? current?.year ?? null,
    original_title: hint.title,
  };
  const providers = options.providers ?? [];
  const kind = work.kind === 'movie' ? 'movie' as const
    : work.kind === 'video_series' ? 'tv' as const
      : null;
  let matched: MetaHit | null = null;
  const blockedProviders: string[] = [];
  if (kind && providers.length > 0) {
    for (const provider of providers) {
      const lookup: MetaLookup = await provider.search(hint.title, kind);
      if (lookup.status === 'hit') {
        matched = lookup.hit;
        break;
      }
      if (lookup.status === 'blocked') {
        blockedProviders.push(provider.name);
      }
    }
  }
  if (matched) {
    const tmdbId = matched.provider === 'tmdb' && matched.externalId !== null && /^\d+$/.test(matched.externalId)
      ? Number(matched.externalId)
      : undefined;
    if (matched.title) {
      library.upsertWorkTitle(work.id, matched.title);
    }
    if (matched.overview) {
      library.upsertWorkOverview(work.id, matched.overview);
    }
    if (matched.poster) {
      library.upsertWorkPoster(work.id, matched.poster);
    }
    patch = {
      ...patch,
      year: matched.year ?? patch.year ?? null,
      original_title: matched.originalTitle ?? matched.title,
      ...(tmdbId !== undefined ? { tmdb_id: tmdbId } : {}),
    };
    if (matched.genres.length > 0) {
      library.taxonomy.setGenres(work.id, matched.genres);
    }
    const meta = library.taxonomy.upsertMeta(work.id, patch);
    return { ...meta, matched: true, provider: matched.provider };
  }
  const reason = providers.length === 0
    ? 'TMDB_KEY_MISSING'
    : blockedProviders.length > 0 ? 'PROVIDER_BLOCKED' : 'NO_MATCH';
  const meta = library.taxonomy.upsertMeta(work.id, patch);
  return { ...meta, matched: false, reason };
}

type BuildProviderChainOptions = {
  readonly role: 'media' | 'crawl';
  readonly settings: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly crawlUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: {
    readonly sleep: (ms: number) => Promise<void>;
    readonly now: () => number;
  };
};

function asMetaLookup(value: unknown): MetaLookup | null {
  if (value === null || typeof value !== 'object') return null;
  const lookup = value as Record<string, unknown>;
  if (lookup.status === 'no_match') return { status: 'no_match' };
  if (lookup.status === 'blocked' && typeof lookup.httpStatus === 'number') {
    return { status: 'blocked', httpStatus: lookup.httpStatus };
  }
  if (lookup.status !== 'hit' || lookup.hit === null || typeof lookup.hit !== 'object') {
    return null;
  }
  const hit = lookup.hit as Record<string, unknown>;
  if (typeof hit.title !== 'string' && hit.title !== null) return null;
  if (typeof hit.originalTitle !== 'string' && hit.originalTitle !== null) return null;
  if (typeof hit.provider !== 'string') return null;
  if (hit.year !== null && typeof hit.year !== 'number') return null;
  if (hit.overview !== null && typeof hit.overview !== 'string') return null;
  if (hit.poster !== null && typeof hit.poster !== 'string') return null;
  if (!Array.isArray(hit.genres) || hit.genres.some((g) => typeof g !== 'string')) return null;
  if (hit.externalId !== null && typeof hit.externalId !== 'string') return null;
  return {
    status: 'hit',
    hit: {
      provider: hit.provider as MetaHit['provider'],
      title: hit.title as string | null,
      originalTitle: hit.originalTitle as string | null,
      year: hit.year as number | null,
      overview: hit.overview as string | null,
      poster: hit.poster as string | null,
      genres: hit.genres as string[],
      externalId: hit.externalId as string | null,
    },
  };
}

/**
 * Media-role proxy for crawler providers. All requests go to the loopback
 * crawl process (`POST {crawlUrl}/api/metadata/lookup`); the media process
 * never fetches daum/naver/watcha hosts directly. Transport failure and
 * non-2xx responses surface as { status: 'blocked', httpStatus } — the
 * upstream blocked.httpStatus is never swallowed.
 */
function proxyProvider(
  name: 'daum' | 'naver' | 'watcha',
  crawlUrl: string,
  fetchImpl: typeof fetch,
): MetaProvider {
  const endpoint = `${crawlUrl.replace(/\/$/, '')}/api/metadata/lookup`;
  return {
    name,
    async search(query: string, kind: 'movie' | 'tv'): Promise<MetaLookup> {
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: query, kind, providers: [name] }),
        });
        if (!response.ok) {
          return { status: 'blocked', httpStatus: response.status };
        }
        const payload: unknown = await response.json();
        const lookup = asMetaLookup(payload);
        if (!lookup) return { status: 'blocked', httpStatus: 502 };
        return lookup;
      } catch {
        return { status: 'blocked', httpStatus: 0 };
      }
    },
  };
}

const CRAWLER_NAMES = ['daum', 'naver', 'watcha'] as const;

/**
 * The single source of truth for the provider chain. `role === 'crawl'`
 * constructs every enabled provider directly. `role === 'media'` constructs
 * only tmdb/kmdb directly — the three crawlers exist only as loopback proxies
 * when `crawlUrl` is set, and are absent otherwise.
 */
export function buildProviderChain(options: BuildProviderChainOptions): MetaProvider[] {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const clock = options.clock;
  const chain: MetaProvider[] = [];
  for (const raw of options.settings) {
    if (raw === 'tmdb' && options.env.TMDB_API_KEY) {
      chain.push(tmdbProvider(options.env.TMDB_API_KEY, fetchImpl));
    } else if (raw === 'kmdb' && options.env.KMDB_API_KEY) {
      chain.push(kmdbProvider(options.env.KMDB_API_KEY, fetchImpl, clock));
    } else if (
      (CRAWLER_NAMES as readonly string[]).includes(raw)
      && (options.role === 'crawl' || options.crawlUrl)
    ) {
      const name = raw as (typeof CRAWLER_NAMES)[number];
      if (options.role === 'crawl') {
        if (name === 'daum') chain.push(daumProvider(fetchImpl, clock));
        else if (name === 'naver') chain.push(naverProvider(fetchImpl, clock));
        else chain.push(watchaProvider(fetchImpl, clock));
      } else {
        chain.push(proxyProvider(name, options.crawlUrl as string, fetchImpl));
      }
    }
  }
  return chain;
}

type TmdbFirstResult =
  | { readonly ok: true; readonly hit: TmdbHit | null }
  | { readonly ok: false; readonly httpStatus: number };

async function fetchTmdbFirst(
  apiKey: string,
  fetchImpl: typeof fetch,
  query: string,
  kind: 'movie' | 'tv',
): Promise<TmdbFirstResult> {
  const path = kind === 'movie' ? 'search/movie' : 'search/tv';
  const url = `https://api.themoviedb.org/3/${path}?query=${encodeURIComponent(query)}&language=ko-KR`;
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!response.ok) return { ok: false, httpStatus: response.status };
    const json = await response.json() as { results?: Array<Record<string, unknown>> };
    const first = json.results?.[0];
    if (!first || typeof first.id !== 'number') return { ok: true, hit: null };
    const title = typeof first.title === 'string'
      ? first.title
      : typeof first.name === 'string' ? first.name : query;
    const originalTitle = typeof first.original_title === 'string'
      ? first.original_title
      : typeof first.original_name === 'string' ? first.original_name : null;
    const date = typeof first.release_date === 'string'
      ? first.release_date
      : typeof first.first_air_date === 'string' ? first.first_air_date : '';
    const year = /^(\d{4})/.exec(date);
    const posterPath = typeof first.poster_path === 'string' ? first.poster_path : null;
    return {
      ok: true,
      hit: {
        id: first.id,
        title,
        originalTitle,
        overview: typeof first.overview === 'string' ? first.overview : null,
        poster: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null,
        year: year ? Number(year[1]) : null,
      },
    };
  } catch {
    return { ok: false, httpStatus: 0 };
  }
}

export function createTmdbClient(options: {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): TmdbClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return {
    async search(query, kind) {
      const result = await fetchTmdbFirst(options.apiKey, fetchImpl, query, kind);
      return result.ok ? result.hit : null;
    },
  };
}

export function tmdbProvider(apiKey: string, fetchImpl: typeof fetch): MetaProvider {
  return {
    name: 'tmdb',
    async search(query, kind): Promise<MetaLookup> {
      const result = await fetchTmdbFirst(apiKey, fetchImpl, query, kind);
      if (!result.ok) return { status: 'blocked', httpStatus: result.httpStatus };
      if (!result.hit) return { status: 'no_match' };
      const hit: MetaHit = {
        provider: 'tmdb',
        title: result.hit.title,
        originalTitle: result.hit.originalTitle,
        year: result.hit.year,
        overview: result.hit.overview,
        poster: result.hit.poster,
        genres: [],
        externalId: String(result.hit.id),
      };
      return { status: 'hit', hit };
    },
  };
}
