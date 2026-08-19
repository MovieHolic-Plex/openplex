import * as cheerio from 'cheerio';
import { cleanText, preferredImageUrl, htmlUnescape } from '../../parsers/html-utils.js';
import { createPoliteFetch, type FetchLike, type PoliteClock } from '../http.js';
import type { MetaHit, MetaLookup, MetaProvider } from './types.js';

const baseUrl = 'https://watcha.com/ko-KR/search';

/**
 * Parse a Watcha search results page. Returns null when the markup does not
 * look like a Watcha result list (zero results or changed structure).
 */
export function parseWatchaSearch(html: string): MetaHit | null {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const first = $('ul.list-easy-search > li').first();
  if (first.length === 0) return null;

  const titleEl = first.find('a.title').first();
  const title = titleEl.length ? cleanText(titleEl) : '';
  if (!title) return null;

  const detailHref = titleEl.attr('href') ?? null;
  const posterImg = first.find('img.poster').first();
  const yearText = cleanText(first.find('.entity-year').first());
  const yearMatch = /(\d{4})/.exec(yearText);
  const originalTitle = cleanText(first.find('.entity-origin-name').first());
  const genresText = cleanText(first.find('.genre').first());
  const overview = cleanText(first.find('p.overview').first());

  return {
    provider: 'watcha',
    title,
    originalTitle: originalTitle || null,
    year: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
    overview: overview || null,
    poster: preferredImageUrl(posterImg),
    genres: genresText
      ? genresText.split('·')
      .map((g) => htmlUnescape(g).trim())
      .filter(Boolean)
      : [],
    externalId: detailHref ?? null,
  };
}

export function watchaProvider(
  fetchImpl: FetchLike,
  clock: Partial<PoliteClock> = {},
): MetaProvider {
  const politeGet = createPoliteFetch(fetchImpl, clock);
  return {
    name: 'watcha',
    async search(query: string, _kind: 'movie' | 'tv'): Promise<MetaLookup> {
      void _kind;
      const url = `${baseUrl}?query=${encodeURIComponent(query)}`;
      const response = await politeGet('watcha', url);
      if (!response.ok) {
        return { status: 'blocked', httpStatus: response.status };
      }
      const hit = parseWatchaSearch(response.body);
      if (!hit || !hit.title) return { status: 'no_match' };
      return { status: 'hit', hit };
    },
  };
}
