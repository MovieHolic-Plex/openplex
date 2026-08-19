import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const dirs: string[] = [];
const stores: SQLiteStore[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of stores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of dirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('transcode sessions', () => {
  it('writes a playlist through a fake ffmpeg runner and exposes transcodeUrl', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-xc-'));
    dirs.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    stores.push(store);
    const mediaRoot = path.join(directory, 'media');
    const ep = path.join(mediaRoot, 'drama', '41', '1');
    fs.mkdirSync(ep, { recursive: true });
    fs.writeFileSync(path.join(ep, 'media.mp4'), Buffer.from('mp4'));
    const localMedia = new LocalMediaStore(store.db);
    localMedia.upsertPending({
      category: 'drama', id: 41, epIdx: 1, title: 'E1', thumb: '',
    }, 1);
    localMedia.markCompleted({
      category: 'drama', id: 41, epIdx: 1, file_path: 'drama/41/1/media.mp4', size_bytes: 3,
    }, 2);
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'video_series', title: 'Show' }, 3);
    const unit = library.upsertUnit({
      workId: work.id, kind: 'episode', ordinal: 0, title: 'E1',
    }, 4);
    library.bindSource({
      workId: work.id, unitId: unit.id, adapter: 'tvwiki', externalId: 'drama/41/1',
    });

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        localMedia,
        mediaRoot,
        transcodeRun: async (_command, args) => {
          const dest = args[args.length - 1];
          if (typeof dest === 'string') {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, '#EXTM3U\n#EXT-X-ENDLIST\n');
          }
          return { code: 0 };
        },
      },
    });
    apps.push(app);
    await app.ready();

    const started = await app.inject({
      method: 'POST',
      url: '/api/transcode',
      payload: { unitId: unit.id, profile: '720p' },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().transcodeUrl).toMatch(/^\/transcode\/.+\/index\.m3u8$/);

    const playlist = await app.inject({ method: 'GET', url: started.json().transcodeUrl });
    expect(playlist.statusCode).toBe(200);
    expect(playlist.body).toContain('#EXTM3U');

    const stream = await app.inject({
      method: 'POST',
      url: '/api/stream/drama/41/1?profile=720p',
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.json().transcodeUrl).toMatch(/^\/transcode\/.+\/index\.m3u8$/);
  });

  it('returns 503 when ffmpeg is missing', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-xc-miss-'));
    dirs.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    stores.push(store);
    const mediaRoot = path.join(directory, 'media');
    fs.mkdirSync(path.join(mediaRoot, 'drama', '41', '1'), { recursive: true });
    fs.writeFileSync(path.join(mediaRoot, 'drama', '41', '1', 'playlist.m3u8'), '#EXTM3U\n');
    const localMedia = new LocalMediaStore(store.db);
    localMedia.upsertPending({
      category: 'drama', id: 41, epIdx: 1, title: 'E1', thumb: '',
    }, 1);
    localMedia.markCompleted({
      category: 'drama', id: 41, epIdx: 1, file_path: 'drama/41/1/playlist.m3u8', size_bytes: 8,
    }, 2);
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'video_series', title: 'Show' }, 3);
    const unit = library.upsertUnit({
      workId: work.id, kind: 'episode', ordinal: 0, title: 'E1',
    }, 4);
    library.bindSource({
      workId: work.id, unitId: unit.id, adapter: 'tvwiki', externalId: 'drama/41/1',
    });

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        localMedia,
        mediaRoot,
        transcodeRun: async () => ({ code: 127, missing: true }),
      },
    });
    apps.push(app);
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/api/transcode',
      payload: { unitId: unit.id, profile: '480p' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('TRANSCODE_UNAVAILABLE');
  });
});
