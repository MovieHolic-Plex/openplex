import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFilenameHint, buildProviderChain, scanWork, tmdbProvider } from '../src/metadata/scan.js';
import type { MetaHit } from '../src/metadata/providers/types.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

describe('metadata scanner', () => {
  it('parses show name, season, episode, and year from a release filename', () => {
    expect(parseFilenameHint('Show.Name.S01E02.1080p.mkv')).toEqual({
      title: 'Show Name',
      year: null,
      season: 1,
      episode: 2,
    });
    expect(parseFilenameHint('이끼.2013.mp4')).toEqual({
      title: '이끼',
      year: 2013,
      season: null,
      episode: null,
    });
  });

  it('scanWork stores title year from the filename without a TMDB client', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-scan-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이.2003.1080p.mkv' }, 1);
    const meta = await scanWork(library, work);
    expect(meta.year).toBe(2003);
    expect(library.getWork(work.id)?.title).toBe('올드보이');
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('fills year from the title and applies a mocked TMDB hit', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '이끼.2013.mp4' }, 1);
    const meta = await scanWork(library, work, {
      providers: [{
        name: 'tmdb',
        async search() {
          return {
            status: 'hit' as const,
            hit: {
              provider: 'tmdb',
              title: '이끼',
              originalTitle: 'Moss',
              year: 2013,
              overview: '스릴러',
              poster: null,
              genres: [],
              externalId: '99',
            },
          };
        },
      }],
    });
    expect(meta.matched).toBe(true);
    expect(meta.year).toBe(2013);
    expect(meta.tmdb_id).toBe(99);
    expect(library.getWork(work.id)?.overview).toBe('스릴러');
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it('falls back to the next provider when tmdb has no match', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-chain-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '이끼.2013.mp4' }, 1);
    const result = await scanWork(library, work, {
      providers: [
        {
          name: 'tmdb',
          async search() {
            return { status: 'no_match' } as const;
          },
        },
        {
          name: 'daum',
          async search() {
            return {
              status: 'hit' as const,
              hit: {
                provider: 'daum',
                title: '이끼',
                originalTitle: 'Moss',
                year: 2013,
                overview: '늪 위의 미스터리',
                poster: 'https://img.example/iris.jpg',
                genres: ['스릴러'],
                externalId: 'https://movie.daum.net/moviedb/main?movieId=48951',
              },
            };
          },
        },
      ],
    });
    expect(result.matched).toBe(true);
    expect(result.provider).toBe('daum');
    expect(library.getWork(work.id)?.title).toBe('이끼');
    expect(library.getWork(work.id)?.overview).toBe('늪 위의 미스터리');
    expect(library.getWork(work.id)?.poster).toBe('https://img.example/iris.jpg');
    const meta = library.taxonomy.getMeta(work.id);
    expect(meta?.year).toBe(2013);
    expect(meta?.original_title).toBe('Moss');
    // Only tmdb with a numeric externalId may set tmdb_id.
    expect(meta?.tmdb_id).toBeNull();
    expect(library.taxonomy.listGenres(work.id)).toEqual(['스릴러']);
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps the filename hint and reports NO_MATCH when every provider misses', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-nomatch-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이.2003.1080p.mkv' }, 1);
    const noMatch = {
      async search() {
        return { status: 'no_match' } as const;
      },
    };
    const result = await scanWork(library, work, {
      providers: [
        { name: 'tmdb', ...noMatch },
        { name: 'daum', ...noMatch },
      ],
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('NO_MATCH');
    expect(library.getWork(work.id)?.title).toBe('올드보이');
    expect(library.taxonomy.getMeta(work.id)?.year).toBe(2003);
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('records a blocked provider and reports PROVIDER_BLOCKED, still using a later hit', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-blocked-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '이끼.2013.mp4' }, 1);
    const hit: MetaHit = {
      provider: 'naver',
      title: '이끼',
      originalTitle: null,
      year: 2013,
      overview: null,
      poster: null,
      genres: [],
      externalId: null,
    };
    const result = await scanWork(library, work, {
      providers: [
        {
          name: 'tmdb',
          async search() {
            return { status: 'blocked', httpStatus: 429 } as const;
          },
        },
        {
          name: 'naver',
          async search() {
            return { status: 'hit', hit };
          },
        },
      ],
    });
    expect(result.matched).toBe(true);
    expect(result.provider).toBe('naver');
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reports PROVIDER_BLOCKED when all providers are blocked without a hit', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-blocked2-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '이끼.2013.mp4' }, 1);
    const blocked = {
      async search() {
        return { status: 'blocked', httpStatus: 403 } as const;
      },
    };
    const result = await scanWork(library, work, {
      providers: [
        { name: 'tmdb', ...blocked },
        { name: 'daum', ...blocked },
      ],
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('PROVIDER_BLOCKED');
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('sets tmdb_id only for a numeric tmdb externalId', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-id-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이.2003.mp4' }, 1);
    const result = await scanWork(library, work, {
      providers: [{
        name: 'tmdb',
        async search() {
          return {
            status: 'hit' as const,
            hit: {
              provider: 'tmdb',
              title: '올드보이',
              originalTitle: 'Oldboy',
              year: 2003,
              overview: null,
              poster: null,
              genres: [],
              externalId: '670',
            },
          };
        },
      }],
    });
    expect(result.matched).toBe(true);
    expect(library.taxonomy.getMeta(work.id)?.tmdb_id).toBe(670);
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('reports TMDB_KEY_MISSING when no providers are available', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-meta-key-'));
    const sqlite = new SQLiteStore(path.join(directory, 'db.sqlite'));
    const library = new LibraryStore(sqlite.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이.2003.mp4' }, 1);
    const result = await scanWork(library, work, { providers: [] });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('TMDB_KEY_MISSING');
    expect(library.getWork(work.id)?.title).toBe('올드보이');
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('buildProviderChain role boundary', () => {
  const okJson = async () => new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  it('media role without crawlUrl constructs no daum/naver/watcha providers', async () => {
    const chain = buildProviderChain({
      role: 'media',
      settings: ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'],
      env: { TMDB_API_KEY: 'k', KMDB_API_KEY: 'm' },
      fetchImpl: okJson as unknown as typeof fetch,
    });
    const names = chain.map((provider) => provider.name);
    expect(names).toContain('tmdb');
    expect(names).toContain('kmdb');
    expect(names).not.toContain('daum');
    expect(names).not.toContain('naver');
    expect(names).not.toContain('watcha');
  });

  it('media role with crawlUrl proxies the crawlers and never leaves the crawl URL', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      expect(body.kind).toBe('movie');
      expect(Array.isArray(body.providers)).toBe(true);
      return new Response(
        JSON.stringify({
          status: 'hit',
          hit: {
            provider: 'daum',
            title: '이끼',
            originalTitle: null,
            year: 2013,
            overview: null,
            poster: null,
            genres: [],
            externalId: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    const chain = buildProviderChain({
      role: 'media',
      settings: ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'],
      env: {},
      crawlUrl: 'http://127.0.0.1:33889',
      fetchImpl,
    });
    expect(chain.map((provider) => provider.name)).toEqual(['daum', 'naver', 'watcha']);
    const lookup = await chain[0].search('이끼', 'movie');
    expect(lookup.status).toBe('hit');
    expect(seen).toEqual(['http://127.0.0.1:33889/api/metadata/lookup']);
    expect(seen.every((url) => !/daum\.net|naver\.com|watcha/.test(url))).toBe(true);
  });

  it('crawl role constructs daum/naver/watcha directly', () => {
    const chain = buildProviderChain({
      role: 'crawl',
      settings: ['daum', 'naver', 'watcha'],
      env: {},
      fetchImpl: (async () => {
        throw new Error('not called during construction');
      }) as unknown as typeof fetch,
    });
    expect(chain.map((provider) => provider.name)).toEqual(['daum', 'naver', 'watcha']);
  });

  it('skips kmdb entirely when KMDB_API_KEY is absent', () => {
    const chain = buildProviderChain({
      role: 'crawl',
      settings: ['tmdb', 'kmdb', 'daum'],
      env: { TMDB_API_KEY: 'k' },
      fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    });
    expect(chain.map((provider) => provider.name)).toEqual(['tmdb', 'daum']);
  });

  it('orders the chain by the settings order and drops unknown names', () => {
    const chain = buildProviderChain({
      role: 'crawl',
      settings: ['watcha', 'bogus', 'tmdb'],
      env: { TMDB_API_KEY: 'k' },
      fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    });
    expect(chain.map((provider) => provider.name)).toEqual(['watcha', 'tmdb']);
  });

  it('proxy transport failure (connection refused) becomes blocked without throwing', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const chain = buildProviderChain({
      role: 'media',
      settings: ['daum'],
      env: {},
      crawlUrl: 'http://127.0.0.1:33889',
      fetchImpl,
    });
    await expect(chain[0].search('이끼', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 0,
    });
  });

  it('proxy non-2xx becomes blocked with the upstream status', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    const chain = buildProviderChain({
      role: 'media',
      settings: ['daum'],
      env: {},
      crawlUrl: 'http://127.0.0.1:33889',
      fetchImpl,
    });
    await expect(chain[0].search('이끼', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 502,
    });
  });

  it('proxy garbage JSON becomes blocked instead of throwing', async () => {
    const fetchImpl = (async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;
    const chain = buildProviderChain({
      role: 'media',
      settings: ['daum'],
      env: {},
      crawlUrl: 'http://127.0.0.1:33889',
      fetchImpl,
    });
    const lookup = await chain[0].search('이끼', 'movie');
    expect(lookup.status).toBe('blocked');
  });
});

describe('tmdbProvider (MetaProvider contract)', () => {
  const koreanMovieJson = {
    results: [
      {
        id: 670,
        title: '올드보이',
        original_title: 'Oldboy',
        overview: '15년 감금',
        poster_path: '/abc.jpg',
        release_date: '2003-11-21',
        genre_ids: [18, 53],
      },
    ],
  };

  function mockFetch(status: number, body: unknown) {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('sends language=ko-KR in the request URL', async () => {
    const { calls, fetchImpl } = mockFetch(200, koreanMovieJson);
    const provider = tmdbProvider('fake-key', fetchImpl);
    await provider.search('올드보이', 'movie');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('language=ko-KR');
  });

  it('returns a hit with Korean title and original title', async () => {
    const { fetchImpl } = mockFetch(200, koreanMovieJson);
    const provider = tmdbProvider('fake-key', fetchImpl);
    const lookup = await provider.search('올드보이', 'movie');
    expect(lookup.status).toBe('hit');
    if (lookup.status !== 'hit') throw new Error('expected hit');
    expect(lookup.hit.provider).toBe('tmdb');
    expect(lookup.hit.title).toBe('올드보이');
    expect(lookup.hit.originalTitle).toBe('Oldboy');
    expect(lookup.hit.year).toBe(2003);
    expect(lookup.hit.poster).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(lookup.hit.genres).toEqual([]);
    expect(lookup.hit.externalId).toBe('670');
  });

  it('returns no_match when the search has 0 results', async () => {
    const { fetchImpl } = mockFetch(200, { results: [] });
    const provider = tmdbProvider('fake-key', fetchImpl);
    await expect(provider.search('없는작품', 'movie')).resolves.toEqual({ status: 'no_match' });
  });

  it('returns blocked with httpStatus on 500', async () => {
    const { fetchImpl } = mockFetch(500, { status_message: 'boom' });
    const provider = tmdbProvider('fake-key', fetchImpl);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 500,
    });
  });

  it('returns blocked with httpStatus on 403', async () => {
    const { fetchImpl } = mockFetch(403, { status_message: 'forbidden' });
    const provider = tmdbProvider('fake-key', fetchImpl);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 403,
    });
  });

  it('never throws on malformed payloads', async () => {
    const { fetchImpl } = mockFetch(200, { results: [{ title: 42, id: 'not-a-number' }] });
    const provider = tmdbProvider('fake-key', fetchImpl);
    const lookup = await provider.search('올드보이', 'movie');
    expect(['hit', 'no_match', 'blocked']).toContain(lookup.status);
  });
});
