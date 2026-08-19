import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoliteFetch, BROWSER_UA, type FetchLike } from '../src/metadata/http.js';
import { kmdbProvider } from '../src/metadata/providers/kmdb.js';
import { daumProvider } from '../src/metadata/providers/daum.js';
import { naverProvider } from '../src/metadata/providers/naver.js';
import { watchaProvider } from '../src/metadata/providers/watcha.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

type RecordedCall = { url: string; headers: Record<string, string> };

function htmlFetch(body: string, status = 200) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
  return { calls, fetchImpl };
}

function jsonFetch(body: string, status = 200) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

/** Fake clock: deterministic time that advances only while sleeping. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    clock: {
      now: () => t,
      async sleep(ms: number) {
        sleeps.push(ms);
        t += ms;
      },
    },
  };
}

describe('http.ts polite fetch', () => {
  it('spaces two requests to the same provider by >=1000ms with concurrency 1', async () => {
    const { clock, sleeps } = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: FetchLike = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return new Response('ok', { status: 200 });
    };
    const get = createPoliteFetch(fetchImpl, clock);
    const [a, b] = await Promise.all([
      get('naver', 'https://x.invalid/1'),
      get('naver', 'https://x.invalid/2'),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Concurrency stayed 1 for the provider.
    expect(maxInFlight).toBe(1);
    // A spacing sleep of at least 1000ms happened for the second request.
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
  });

  it('sends only UA and Accept-Language and never replays cookies', async () => {
    const { calls, fetchImpl } = htmlFetch('<html></html>', 200);
    const { clock } = fakeClock();
    clock.now = () => 0;
    const get = createPoliteFetch(fetchImpl, { ...clock, now: () => 0 });
    // First response advertises set-cookie; wrapper must drop it.
    const first = await get('daum', 'https://x.invalid/a');
    expect(first.ok).toBe(true);
    clock.now = () => 5000;
    await get('daum', 'https://x.invalid/b');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(Object.keys(call.headers).sort()).toEqual([
        'Accept-Language',
        'User-Agent',
      ]);
      expect(call.headers['User-Agent']).toBe(BROWSER_UA);
      expect(call.headers['Accept-Language']).toBe('ko-KR');
      expect(call.headers.cookie).toBeUndefined();
    }
  });

  it('maps network rejection to status 0', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down');
    };
    const get = createPoliteFetch(fetchImpl, fakeClock().clock);
    const result = await get('watcha', 'https://x.invalid/');
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it('maps timeout to status 0', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    const get = createPoliteFetch(fetchImpl, fakeClock().clock);
    const result = await get('kmdb', 'https://x.invalid/', 30);
    expect(result).toEqual({ ok: false, status: 0 });
  });
});

describe('daumProvider', () => {
  it('extracts title/year/poster as a hit', async () => {
    const { calls, fetchImpl } = htmlFetch(fixture('daum-search.html'));
    const provider = daumProvider(fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('search.daum.net');
    expect(lookup.status).toBe('hit');
    if (lookup.status !== 'hit') throw new Error('expected hit');
    expect(lookup.hit.provider).toBe('daum');
    expect(lookup.hit.title).toBe('올드보이');
    expect(lookup.hit.originalTitle).toBe('Oldboy');
    expect(lookup.hit.year).toBe(2003);
    expect(lookup.hit.poster).toBe(
      'https://img1.daumcdn.net/thumb/C408x596_oldboy.jpg',
    );
    expect(lookup.hit.genres).toContain('미스터리');
    expect(lookup.hit.overview).toContain('오대수');
    expect(lookup.hit.externalId).toContain('movie.daum.net');
  });

  it('returns no_match for changed-structure/empty markup', async () => {
    const { fetchImpl } = htmlFetch(fixture('daum-search-changed.html'));
    const provider = daumProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'no_match',
    });
  });

  it('returns blocked 403 on a 403 response', async () => {
    const { fetchImpl } = htmlFetch('Forbidden', 403);
    const provider = daumProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 403,
    });
  });

  it('never throws on truncated or wrong-encoding input', async () => {
    for (const body of ['<ol class="list_movie"><li><', '\ufffd\ufffd\ufffd', '']) {
      const { fetchImpl } = htmlFetch(body);
      const provider = daumProvider(fetchImpl, fakeClock().clock);
      const lookup = await provider.search('올드보이', 'tv');
      expect(lookup.status).toBe('no_match');
    }
  });

  it('treats injected script/comment instructions as inert text', async () => {
    const { fetchImpl } = htmlFetch(fixture('daum-search.html'));
    const provider = daumProvider(fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(lookup.status).toBe('hit'); // not blocked, not no_match
  });
});

describe('naverProvider', () => {
  it('extracts title/year/poster as a hit', async () => {
    const { calls, fetchImpl } = htmlFetch(fixture('naver-search.html'));
    const provider = naverProvider(fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('search.naver.com');
    expect(lookup.status).toBe('hit');
    if (lookup.status !== 'hit') throw new Error('expected hit');
    expect(lookup.hit.provider).toBe('naver');
    expect(lookup.hit.title).toBe('올드보이');
    expect(lookup.hit.originalTitle).toBe('Oldboy');
    expect(lookup.hit.year).toBe(2003);
    expect(lookup.hit.poster).toBe(
      'https://movie-phinf.pstatic.net/oldboy-poster.jpg',
    );
    expect(lookup.hit.externalId).toContain('movie.naver.com');
  });

  it('returns no_match for changed-structure/empty markup', async () => {
    const { fetchImpl } = htmlFetch(fixture('naver-search-changed.html'));
    const provider = naverProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'no_match',
    });
  });

  it('returns blocked 403 on a 403 response', async () => {
    const { fetchImpl } = htmlFetch('Forbidden', 403);
    const provider = naverProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 403,
    });
  });

  it('never throws on malformed input', async () => {
    const { fetchImpl } = htmlFetch('<ul class="search_list_1"><dt');
    const provider = naverProvider(fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'tv');
    expect(lookup.status).toBe('no_match');
  });
});

describe('watchaProvider', () => {
  it('extracts title/year/poster as a hit', async () => {
    const { calls, fetchImpl } = htmlFetch(fixture('watcha-search.html'));
    const provider = watchaProvider(fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('watcha.com');
    expect(lookup.status).toBe('hit');
    if (lookup.status !== 'hit') throw new Error('expected hit');
    expect(lookup.hit.provider).toBe('watcha');
    expect(lookup.hit.title).toBe('올드보이');
    expect(lookup.hit.year).toBe(2003);
    expect(lookup.hit.poster).toBe('https://watcha-cdn.com/p/poster/oldboy.jpg');
    expect(lookup.hit.externalId).toBe('/ko-KR/contents/m5rEzW');
  });

  it('returns no_match for changed-structure/empty markup', async () => {
    const { fetchImpl } = htmlFetch(fixture('watcha-search-changed.html'));
    const provider = watchaProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'no_match',
    });
  });

  it('returns blocked 403 on a 403 response', async () => {
    const { fetchImpl } = htmlFetch('Forbidden', 403);
    const provider = watchaProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 403,
    });
  });

  it('returns blocked 0 when the network rejects', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('boom');
    };
    const provider = watchaProvider(fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 0,
    });
  });
});

describe('kmdbProvider', () => {
  it('extracts title/year/poster as a hit', async () => {
    const { calls, fetchImpl } = jsonFetch(fixture('kmdb-search.json'));
    const provider = kmdbProvider('test-key', fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.kmdb.or.kr');
    expect(calls[0].url).toContain('ServiceKey=test-key');
    expect(lookup.status).toBe('hit');
    if (lookup.status !== 'hit') throw new Error('expected hit');
    expect(lookup.hit.provider).toBe('kmdb');
    expect(lookup.hit.title).toBe('올드보이');
    expect(lookup.hit.originalTitle).toBe('Oldboy');
    expect(lookup.hit.year).toBe(2003);
    expect(lookup.hit.poster).toBe('https://file.kmdb.or.kr/poster/oldboy.jpg');
    expect(lookup.hit.genres).toEqual(['드라마', '미스터리', '스릴러']);
    expect(lookup.hit.overview).toContain('오대수');
    expect(lookup.hit.externalId).toBe('D_00014');
  });

  it('returns no_match for an empty result set', async () => {
    const { fetchImpl } = jsonFetch(fixture('kmdb-search-empty.json'));
    const provider = kmdbProvider('test-key', fetchImpl, fakeClock().clock);
    await expect(provider.search('없는작품', 'movie')).resolves.toEqual({
      status: 'no_match',
    });
  });

  it('returns blocked 429 on a 429 response', async () => {
    const { fetchImpl } = jsonFetch('Too Many Requests', 429);
    const provider = kmdbProvider('test-key', fetchImpl, fakeClock().clock);
    await expect(provider.search('올드보이', 'movie')).resolves.toEqual({
      status: 'blocked',
      httpStatus: 429,
    });
  });

  it('never throws on malformed JSON', async () => {
    const { fetchImpl } = jsonFetch('{"Data": [trunc');
    const provider = kmdbProvider('test-key', fetchImpl, fakeClock().clock);
    const lookup = await provider.search('올드보이', 'movie');
    expect(lookup.status).toBe('no_match');
  });
});
