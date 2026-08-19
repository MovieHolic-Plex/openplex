import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function openApp(): Promise<{
  app: FastifyInstance;
  library: LibraryStore;
  mediaRoot: string;
  store: SQLiteStore;
}> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-jf-'));
  tempDirectories.push(directory);
  const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
  openStores.push(store);
  const mediaRoot = path.join(directory, 'media');
  const app = await buildServer({
    logger: false,
    serveStatic: false,
    dependencies: { store, mediaRoot },
  });
  apps.push(app);
  await app.ready();
  return { app, library: new LibraryStore(store.db), mediaRoot, store };
}

describe('Jellyfin/Emby subset', () => {
  it('authenticates, lists the library view, and includes an imported work', async () => {
    const { app, library } = await openApp();
    const work = library.upsertWork({ kind: 'video_series', title: '이끼' }, 1);

    const auth = await app.inject({
      method: 'POST',
      url: '/jellyfin/Users/AuthenticateByName',
      payload: { Username: 'owner', Pw: 'unused' },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.json().AccessToken).toEqual(expect.any(String));
    expect(auth.json().User.Name).toBe('owner');

    const views = await app.inject({ method: 'GET', url: '/jellyfin/Users/1/Views' });
    expect(views.statusCode).toBe(200);
    expect(views.json().Items).toEqual([
      expect.objectContaining({ Id: 'view:library', Name: '보관함' }),
    ]);

    const items = await app.inject({ method: 'GET', url: '/jellyfin/Users/1/Items' });
    expect(items.statusCode).toBe(200);
    expect(items.json().Items).toEqual([
      expect.objectContaining({
        Id: `work:${work.id}`,
        Name: '이끼',
        Type: 'Series',
      }),
    ]);

    const detail = await app.inject({
      method: 'GET',
      url: `/jellyfin/Users/1/Items/work:${work.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().Name).toBe('이끼');

    const emby = await app.inject({ method: 'GET', url: '/emby/Users/1/Items' });
    expect(emby.statusCode).toBe(200);
    expect(emby.json().Items[0].Id).toBe(`work:${work.id}`);
  });

  it('streams remuxed mp4 for a completed unit and redirects to HLS when only a playlist exists', async () => {
    const { app, library, mediaRoot, store } = await openApp();
    const work = library.upsertWork({ kind: 'video_series', title: 'Show' }, 1);
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 0,
      title: 'E1',
    }, 2);
    library.bindSource({
      workId: work.id,
      unitId: unit.id,
      adapter: 'tvwiki',
      externalId: 'drama/41/1',
    });

    const dir = path.join(mediaRoot, 'drama', '41', '1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'playlist.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
    const media = new LocalMediaStore(store.db);
    media.upsertPending({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'E1',
      thumb: '',
    }, 3);
    media.markCompleted({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'E1',
      thumb: '',
      file_path: 'drama/41/1/playlist.m3u8',
      size_bytes: 12,
    }, 4);

    const hls = await app.inject({
      method: 'GET',
      url: `/jellyfin/Videos/unit:${unit.id}/stream`,
    });
    expect(hls.statusCode).toBe(302);
    expect(hls.headers.location).toBe('/media/drama/41/1/playlist.m3u8');

    fs.writeFileSync(path.join(dir, 'media.mp4'), Buffer.from('unit-mp4'));
    const file = await app.inject({
      method: 'GET',
      url: `/jellyfin/Videos/unit:${unit.id}/stream`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toMatch(/mp4/);
    expect(file.rawPayload).toEqual(Buffer.from('unit-mp4'));
  });

  it('rejects AuthenticateByName when a server token is set and the password does not match', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-jf-auth-'));
    tempDirectories.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    openStores.push(store);
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      authToken: 'server-token',
      dependencies: { store, mediaRoot: path.join(directory, 'media') },
    });
    apps.push(app);
    await app.ready();

    const denied = await app.inject({
      method: 'POST',
      url: '/jellyfin/Users/AuthenticateByName',
      payload: { Username: 'owner', Pw: 'wrong' },
    });
    expect(denied.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/jellyfin/Users/AuthenticateByName',
      payload: { Username: 'owner', Pw: 'server-token' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().AccessToken).toBe('server-token');

    const items = await app.inject({
      method: 'GET',
      url: '/jellyfin/Users/1/Items',
      headers: { 'x-emby-token': 'server-token' },
    });
    expect(items.statusCode).toBe(200);
  });
});
