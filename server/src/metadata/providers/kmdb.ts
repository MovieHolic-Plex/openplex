import { createPoliteFetch, type FetchLike, type PoliteClock } from '../http.js';
import type { MetaLookup, MetaProvider } from './types.js';

const baseUrl = 'https://api.kmdb.or.kr/open-api/data/movieSearch.json';

type KmdbResult = {
  DOCID?: string;
  movieId?: string;
  title?: string;
  titleEng?: string;
  titleOrg?: string;
  prodYear?: string;
  genre?: string;
  plots?: { plot?: Array<{ plotText?: string }> };
  posters?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function firstResult(payload: unknown): KmdbResult | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.Data)) return null;
  const first = asRecord(root.Data[0]);
  if (!first || !Array.isArray(first.Result)) return null;
  const candidate = asRecord(first.Result[0]);
  return candidate ? (candidate as KmdbResult) : null;
}

function parseYear(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /(\d{4})/.exec(String(value));
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * KMDb Open API provider. The API key is an explicit argument — reading
 * `process.env.KMDB_API_KEY` happens in buildProviderChain (todo 4), never
 * here. If no key exists, the chain simply does not construct this provider.
 */
export function kmdbProvider(
  apiKey: string,
  fetchImpl: FetchLike,
  clock: Partial<PoliteClock> = {},
): MetaProvider {
  const politeGet = createPoliteFetch(fetchImpl, clock);
  return {
    name: 'kmdb',
    async search(query: string, _kind: 'movie' | 'tv'): Promise<MetaLookup> {
      void _kind;
      const url = `${baseUrl}?collection=kmdb_new&ServiceKey=${encodeURIComponent(
        apiKey,
      )}&detail=Y&title=${encodeURIComponent(query)}`;
      const response = await politeGet('kmdb', url);
      if (!response.ok) {
        return { status: 'blocked', httpStatus: response.status };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.body);
      } catch {
        return { status: 'no_match' };
      }
      const result = firstResult(payload);
      if (!result) return { status: 'no_match' };

      const title =
        typeof result.title === 'string' ? result.title.trim() : null;
      if (!title) return { status: 'no_match' };
      if (!/^[\s\S]*[\uac00-\ud7a3]/.test(title)) {
        // KMDb always returns a Korean title; anything else is unrecognizable.
        return { status: 'no_match' };
      }

      const plots = Array.isArray(result.plots?.plot)
        ? result.plots.plot
        : [];
      const plotText = plots
        .map((p) => (typeof p?.plotText === 'string' ? p.plotText.trim() : ''))
        .find((t) => t.length > 0);
      const posters = (result.posters ?? '').split('|').filter(Boolean);
      const genres = (result.genre ?? '')
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);

      return {
        status: 'hit',
        hit: {
          provider: 'kmdb',
          title,
          originalTitle:
            typeof result.titleOrg === 'string' && result.titleOrg.trim()
              ? result.titleOrg.trim()
              : typeof result.titleEng === 'string' && result.titleEng.trim()
                ? result.titleEng.trim()
                : null,
          year: parseYear(result.prodYear),
          overview: plotText ?? null,
          poster: posters[0] ?? null,
          genres,
          externalId:
            typeof result.DOCID === 'string' && result.DOCID
              ? result.DOCID
              : typeof result.movieId === 'string' && result.movieId
                ? result.movieId
                : null,
        },
      };
    },
  };
}
