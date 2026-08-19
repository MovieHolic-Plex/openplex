import * as cheerio from 'cheerio';
import { cleanText, preferredImageUrl, htmlUnescape } from '../../parsers/html-utils.js';
import { createPoliteFetch, type FetchLike, type PoliteClock } from '../http.js';
import type { MetaHit, MetaLookup, MetaProvider } from './types.js';

const baseUrl = 'https://search.naver.com/search.naver';

/**
 * Parse a Naver movie/tv search results page. Returns null when the markup
 * does not look like a Naver result list (zero results or changed structure).
 */
export function parseNaverSearch(html: string): MetaHit | null {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const first = $('#content ul.search_list_1 > li').first();
  if (first.length === 0) return null;

  const titleEl = first.find('dt.tit a').first();
  const title = titleEl.length ? cleanText(titleEl) : '';
  if (!title) return null;

  const detailHref = titleEl.attr('href') ?? null;
  const posterImg = first.find('.thumb img').first();
  const yearText = cleanText(first.find('dd.etc').first());
  const yearMatch = /(\d{4})/.exec(yearText);
  const originalTitle = cleanText(first.find('dt.tit em.sub_tit').first());
  const genresText = cleanText(first.find('dd.sub_tit').first());
  const overview = cleanText(first.find('dd.desc').first());

  return {
    provider: 'naver',
    title,
    originalTitle: originalTitle || null,
    year: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
    overview: overview || null,
    poster: preferredImageUrl(posterImg),
    genres: genresText
      ? genresText.split(',').flatMap((part) => part.split('/'))
      .map((g) => htmlUnescape(g).trim())
      .filter(Boolean)
      : [],
    externalId: detailHref ?? null,
  };
}

export function naverProvider(
  fetchImpl: FetchLike,
  clock: Partial<PoliteClock> = {},
): MetaProvider {
  const politeGet = createPoliteFetch(fetchImpl, clock);
  return {
    name: 'naver',
    async search(query: string, kind: 'movie' | 'tv'): Promise<MetaLookup> {
      const url = `${baseUrl}?where=${kind === 'tv' ? 'moviex' : 'movie'}&query=${encodeURIComponent(query)}`;
      const response = await politeGet('naver', url);
      if (!response.ok) {
        return { status: 'blocked', httpStatus: response.status };
      }
      const hit = parseNaverSearch(response.body);
      if (!hit || !hit.title) return { status: 'no_match' };
      return { status: 'hit', hit };
    },
  };
}
