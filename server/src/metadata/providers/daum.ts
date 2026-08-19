import * as cheerio from 'cheerio';
import { cleanText, preferredImageUrl, htmlUnescape } from '../../parsers/html-utils.js';
import { createPoliteFetch, type FetchLike, type PoliteClock } from '../http.js';
import type { MetaHit, MetaLookup, MetaProvider } from './types.js';

const baseUrl = 'https://search.daum.net/search';

/**
 * Parse a Daum movie/tv search results page. Returns null when the markup
 * does not look like a Daum result list (zero results or changed structure).
 */
export function parseDaumSearch(html: string): MetaHit | null {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const first = $('#mArticle ol.list_movie li').first();
  if (first.length === 0) return null;

  const titleEl = first.find('strong.tit_item').first();
  const title = titleEl.length ? cleanText(titleEl) : '';
  if (!title) return null;

  const detailHref = first.find('a.link_story').first().attr('href') ?? null;
  const posterImg = first.find('img').first();
  const yearText = cleanText(first.find('em.txt_info').first());
  const yearMatch = /(\d{4})/.exec(yearText);
  const originalTitle = cleanText(first.find('span.txt_origin').first());
  const genresText = cleanText(first.find('span.info_txt').first());
  const overview = cleanText(first.find('p.desc_txt').first());

  return {
    provider: 'daum',
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

export function daumProvider(
  fetchImpl: FetchLike,
  clock: Partial<PoliteClock> = {},
): MetaProvider {
  const politeGet = createPoliteFetch(fetchImpl, clock);
  return {
    name: 'daum',
    async search(query: string, kind: 'movie' | 'tv'): Promise<MetaLookup> {
      const url = `${baseUrl}?nil_profile=vtop&w=${kind === 'tv' ? 'tvp' : 'movie'}&q=${encodeURIComponent(query)}`;
      const response = await politeGet('daum', url);
      if (!response.ok) {
        return { status: 'blocked', httpStatus: response.status };
      }
      const hit = parseDaumSearch(response.body);
      if (!hit || !hit.title) return { status: 'no_match' };
      return { status: 'hit', hit };
    },
  };
}
