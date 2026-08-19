import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlsGateway } from '../src/gateway/hls-gateway.js';
import { buildCrawlServer } from '../src/crawl/server.js';
import type { EpisodeApiLike, EpisodeStreamData, RouteDependencies } from '../src/routes/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

function stream(overrides: Partial<EpisodeStreamData> = {}): EpisodeStreamData {
  return {
    idx: 1,
    category: 'drama',
    wrId: 41,
    title: 'Episode 1 stream',
    thumb: '/episode.jpg',
    hlsUrl: 'https://cdn.example/vod.m3u8',
    srt: null,
    vtt: 'https://cdn.example/sub.vtt',
    pageUrl: '/drama/41/1',
    sessionData1: null,
    sessionData2: null,
    nextEpisode: { idx: 2, title: 'Episode 2' },
    ...overrides,
  };
}

const vodPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
seg.ts
#EXT-X-ENDLIST
`;

function createFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith('.m3u8')) {
      return new Response(vodPlaylist, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    }
    if (url.pathname.endsWith('.ts')) {
      return new Response(Buffer.from('TS'), { headers: { 'Content-Type': 'video/mp2t' } });
    }
    if (url.pathname.endsWith('.vtt')) {
      return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');
    }
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 4_000) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('download and local playback routes', () => {
  let app: FastifyInstance;
  let store: SQLiteStore;
  let tempDirectory: string;
  let episodeApi: EpisodeApiLike;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-dl-routes-'));
    store = new SQLiteStore(path.join(tempDirectory, 'routes.db'));
    episodeApi = { getEpisode: vi.fn(async ({ epIdx }) => stream({
      idx: epIdx,
      title: `Episode ${epIdx} stream`,
      hlsUrl: 'https://cdn.example/vod.m3u8',
    })) };
    const dependencies: RouteDependencies = {
      store,
      episodeApi,
      mediaRoot: path.join(tempDirectory, 'media'),
      fetchImpl: createFetch(),
      client: {
        baseUrl: 'https://tv.example',
        getText: vi.fn(async () => '<html></html>'),
        getJson: vi.fn(async () => ({})),
      },
      episodeParser: {
        parse: vi.fn((_html: string, options: { category: string; wrId: number }) => ({
          ...options,
          epIdx: 1,
          title: 'Episode page',
          sessionData1: null,
          sessionData2: null,
          prevEpisodePath: null,
          nextEpisodePath: null,
        })),
      },
    };
    app = await buildCrawlServer({
      logger: false,
      gateway: new HlsGateway(),
      dependencies,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('queues a download, serves the local VOD bundle, then prefers it on stream', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/downloads' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ items: [], usedBytes: 0 });
    expect(empty.json().maxBytes).toBeGreaterThan(0);

    const queued = await app.inject({
      method: 'POST',
      url: '/api/downloads',
      payload: {
        category: 'drama',
        id: 41,
        epIdx: 1,
        title: 'Episode 1',
        thumb: '/1.jpg',
      },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().item.download_status).toMatch(/pending|downloading|completed/);

    await waitUntil(async () => {
      const list = await app.inject({ method: 'GET', url: '/api/downloads' });
      return list.json().items[0]?.download_status === 'completed';
    }, 'download complete');

    const playlist = await app.inject({ method: 'GET', url: '/media/drama/41/1/playlist.m3u8' });
    expect(playlist.statusCode).toBe(200);
    expect(playlist.body).toContain('segments/seg00000.ts');

    const segment = await app.inject({ method: 'GET', url: '/media/drama/41/1/segments/seg00000.ts' });
    expect(segment.statusCode).toBe(200);
    expect(segment.rawPayload).toEqual(Buffer.from('TS'));

    const subtitle = await app.inject({ method: 'GET', url: '/media/drama/41/1/subtitles.vtt' });
    expect(subtitle.statusCode).toBe(200);
    expect(subtitle.body).toContain('WEBVTT');

    const local = await app.inject({ method: 'POST', url: '/api/stream/drama/41/1' });
    expect(local.statusCode).toBe(200);
    expect(local.json()).toMatchObject({
      source: 'local',
      playlistUrl: '/media/drama/41/1/playlist.m3u8',
      title: 'Episode 1',
    });
    expect(local.json().subtitles).toEqual([
      expect.objectContaining({ url: '/media/drama/41/1/subtitles.vtt', format: 'vtt' }),
    ]);
  });

  it('starts a live session and background download when no local file exists', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/stream/drama/41/1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: 'live',
      playlistUrl: expect.stringMatching(/^\/hls\/[0-9a-f-]+\/playlist\.m3u8$/),
    });

    await waitUntil(async () => {
      const list = await app.inject({ method: 'GET', url: '/api/downloads' });
      const item = list.json().items.find((row: { epIdx: number }) => row.epIdx === 1);
      return item?.download_status === 'completed';
    }, 'background download');
  });

  it('prefetches the next catalog episode once watch progress reaches 50%', async () => {
    store.upsertEpisodeCatalog([
      { category: 'drama', id: 41, epIdx: 1, ordinal: 0, title: 'Episode 1', thumb: '/1.jpg' },
      { category: 'drama', id: 41, epIdx: 2, ordinal: 1, title: 'Episode 2', thumb: '/2.jpg' },
    ]);

    const below = await app.inject({
      method: 'POST',
      url: '/api/history',
      payload: {
        category: 'drama',
        id: 41,
        epIdx: 1,
        title: 'Episode 1',
        thumb: '/1.jpg',
        position_sec: 49,
        duration_sec: 100,
      },
    });
    expect(below.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/downloads' })).json().items).toHaveLength(0);

    const crossed = await app.inject({
      method: 'POST',
      url: '/api/history',
      payload: {
        category: 'drama',
        id: 41,
        epIdx: 1,
        title: 'Episode 1',
        thumb: '/1.jpg',
        position_sec: 50,
        duration_sec: 100,
      },
    });
    expect(crossed.statusCode).toBe(200);

    await waitUntil(async () => {
      const list = await app.inject({ method: 'GET', url: '/api/downloads' });
      return list.json().items.some((row: { epIdx: number; download_status: string }) => (
        row.epIdx === 2 && row.download_status === 'completed'
      ));
    }, 'prefetch episode 2');
  });

  it('deletes a completed bundle and rejects path escape on media routes', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/downloads',
      payload: { category: 'drama', id: 41, epIdx: 1, title: 'Episode 1', thumb: '/1.jpg' },
    });
    await waitUntil(async () => {
      const list = await app.inject({ method: 'GET', url: '/api/downloads' });
      return list.json().items[0]?.download_status === 'completed';
    }, 'ready to delete');

    const removed = await app.inject({ method: 'DELETE', url: '/api/downloads/drama/41/1' });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/media/drama/41/1/playlist.m3u8' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/downloads' })).json().items).toEqual([]);

    const escaped = await app.inject({ method: 'GET', url: '/media/drama/41/1/segments/..%2F..%2F..%2Fsecret' });
    expect(escaped.statusCode).toBe(400);
    expect((await app.inject({
      method: 'GET',
      url: '/media/drama/41/1/segments/seg99999.ts',
    })).statusCode).toBe(404);

    const quota = await app.inject({
      method: 'PUT',
      url: '/api/downloads/quota',
      payload: { maxBytes: 1024 },
    });
    expect(quota.statusCode).toBe(200);
    expect(quota.json()).toEqual({ maxBytes: 1024 });
    expect((await app.inject({ method: 'GET', url: '/api/downloads' })).json().maxBytes).toBe(1024);
  });

  it('lists the library and rejects unknown unit downloads', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/library' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [] });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/downloads',
      payload: { unitId: 99 },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
