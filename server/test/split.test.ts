import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCrawlServer } from '../src/crawl/server.js';
import { notifyMediaIngest } from '../src/crawl/notify.js';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const apps: FastifyInstance[] = [];
const stores: SQLiteStore[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of stores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of dirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function openStore(): { store: SQLiteStore; mediaRoot: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-split-'));
  dirs.push(directory);
  const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
  stores.push(store);
  return { store, mediaRoot: path.join(directory, 'media') };
}

describe('media / crawl split', () => {
  it('serves a library home without constructing an upstream catalog client', async () => {
    const { store, mediaRoot } = openStore();
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'video_series', title: '보관함 드라마' }, 1);
    library.bindSource({
      workId: work.id,
      adapter: 'tvwiki',
      externalId: 'drama/41',
    });

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot },
    });
    apps.push(app);
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json().role).toBe('media');

    const home = await app.inject({ method: 'GET', url: '/api/home' });
    expect(home.statusCode).toBe(200);
    expect(home.json().sections[0].title).toBe('보관함');
    expect(home.json().sections[0].items[0].title).toBe('보관함 드라마');
    expect(home.json().sections[0].items[0].wrId).toBe(41);
  });

  it('accepts crawl ingest and then plays the local file from the media server', async () => {
    const { store, mediaRoot } = openStore();
    const dir = path.join(mediaRoot, 'drama', '41', '1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'playlist.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot },
    });
    apps.push(app);
    await app.ready();

    const work = await app.inject({
      method: 'POST',
      url: '/api/ingest/work',
      payload: {
        adapter: 'tvwiki',
        externalId: 'drama/41',
        title: '이끼',
        kind: 'video_series',
        units: [{
          externalId: 'drama/41/1',
          title: '1화',
          ordinal: 0,
          thumb: '/1.jpg',
        }],
      },
    });
    expect(work.statusCode).toBe(200);
    expect(work.json().work.title).toBe('이끼');

    const asset = await app.inject({
      method: 'POST',
      url: '/api/ingest/asset',
      payload: {
        adapter: 'tvwiki',
        category: 'drama',
        id: 41,
        epIdx: 1,
        title: '1화',
        thumb: '/1.jpg',
        filePath: 'drama/41/1/playlist.m3u8',
        sizeBytes: 20,
      },
    });
    expect(asset.statusCode).toBe(200);

    const stream = await app.inject({ method: 'POST', url: '/api/stream/drama/41/1' });
    expect(stream.statusCode).toBe(200);
    expect(stream.json().source).toBe('local');
    expect(stream.json().playlistUrl).toBe('/media/drama/41/1/playlist.m3u8');
  });

  it('proxies catalog home to the crawl process when OPENPLEX_CRAWL_URL is set', async () => {
    const { store, mediaRoot } = openStore();
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        mediaRoot,
        crawlUrl: 'http://crawl.test',
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          expect(url).toContain('http://crawl.test/api/home');
          return new Response(JSON.stringify({
            sections: [{ title: '크롤', viewAllPath: '/drama', items: [] }],
            continueWatching: [],
            nextUp: [],
          }), { headers: { 'content-type': 'application/json' } });
        }) as typeof fetch,
      },
    });
    apps.push(app);
    await app.ready();

    const home = await app.inject({ method: 'GET', url: '/api/home' });
    expect(home.statusCode).toBe(200);
    expect(home.json().sections[0].title).toBe('크롤');
  });

  it('notifies the media ingest endpoint after a crawl download completes', async () => {
    const { store, mediaRoot } = openStore();
    const media = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot },
    });
    apps.push(media);
    await media.ready();

    const calls: string[] = [];
    await notifyMediaIngest({
      mediaUrl: 'http://media.test',
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      asset: {
        adapter: 'tvwiki',
        category: 'drama',
        id: 41,
        epIdx: 1,
        title: '1화',
        thumb: '/1.jpg',
        filePath: 'drama/41/1/playlist.m3u8',
        sizeBytes: 8,
      },
    });

    expect(calls).toEqual(['POST http://media.test/api/ingest/asset']);
  });

  it('labels the crawl process separately from the media process', async () => {
    const { store, mediaRoot } = openStore();
    const crawl = await buildCrawlServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        mediaRoot,
        client: {
          baseUrl: 'https://example.test',
          getText: async () => '<html></html>',
          getJson: async () => ({}),
        },
        homeParser: { parse: () => [] },
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      },
    });
    apps.push(crawl);
    await crawl.ready();
    const health = await crawl.inject({ method: 'GET', url: '/health' });
    expect(health.json().role).toBe('crawl');
  });
});
