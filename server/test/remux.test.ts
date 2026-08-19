import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DownloadQueue } from '../src/downloader/queue.js';
import { remuxPlaylistToMp4, REMUX_STATUS } from '../src/downloader/remux.js';
import { buildServer } from '../src/index.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';
import type { EpisodeStreamData } from '../src/routes/index.js';

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

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-remux-'));
  tempDirectories.push(directory);
  return directory;
}

function mapFetch(routes: Record<string, string | Buffer>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    const body = routes[url.toString()] ?? routes[url.pathname];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(body, { headers: { 'Content-Type': 'video/mp2t' } });
  }) as typeof fetch;
}

function stream(): EpisodeStreamData {
  return {
    idx: 1,
    category: 'drama',
    wrId: 41,
    title: 'Episode 1',
    thumb: '/1.jpg',
    hlsUrl: 'https://cdn.example/vod.m3u8',
    srt: null,
    vtt: null,
    pageUrl: '/drama/41/1',
    sessionData1: null,
    sessionData2: null,
    nextEpisode: null,
  };
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('ffmpeg remux', () => {
  it('writes the output file when the runner exits 0', async () => {
    const root = tempDir();
    const playlistPath = path.join(root, 'playlist.m3u8');
    const outputPath = path.join(root, 'media.mp4');
    fs.writeFileSync(playlistPath, '#EXTM3U\n');

    const status = await remuxPlaylistToMp4({
      playlistPath,
      outputPath,
      ffmpegPath: 'ffmpeg',
      run: async (_command, args) => {
        const dest = args[args.length - 1];
        if (typeof dest === 'string') fs.writeFileSync(dest, Buffer.from('fake-mp4'));
        return { code: 0 };
      },
    });

    expect(status).toBe(REMUX_STATUS.ok);
    expect(fs.readFileSync(outputPath)).toEqual(Buffer.from('fake-mp4'));
  });

  it('reports missing when the runner is absent', async () => {
    const root = tempDir();
    const status = await remuxPlaylistToMp4({
      playlistPath: path.join(root, 'playlist.m3u8'),
      outputPath: path.join(root, 'media.mp4'),
      run: async () => ({ code: 127, missing: true }),
    });
    expect(status).toBe(REMUX_STATUS.missing);
    expect(fs.existsSync(path.join(root, 'media.mp4'))).toBe(false);
  });

  it('exposes fileUrl after a completed download remux and serves media.mp4', async () => {
    const root = tempDir();
    const sqlite = new SQLiteStore(path.join(root, 'db.sqlite'));
    openStores.push(sqlite);
    const mediaRoot = path.join(root, 'media');
    const localMedia = new LocalMediaStore(sqlite.db);
    const queue = new DownloadQueue({
      store: localMedia,
      episodeApi: { getEpisode: async () => stream() },
      mediaRoot,
      fetchImpl: mapFetch({
        'https://cdn.example/vod.m3u8': `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
https://cdn.example/seg.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/seg.ts': Buffer.from('TS'),
      }),
      remux: async (dir) => {
        fs.writeFileSync(path.join(dir, 'media.mp4'), Buffer.from('remuxed'));
        return REMUX_STATUS.ok;
      },
    });

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store: sqlite,
        localMedia,
        downloader: queue,
        mediaRoot,
        fetchImpl: mapFetch({}),
        episodeApi: { getEpisode: async () => stream() },
      },
    });
    apps.push(app);
    await app.ready();

    const enqueued = await app.inject({
      method: 'POST',
      url: '/api/downloads',
      payload: { category: 'drama', id: 41, epIdx: 1, title: 'Episode 1', thumb: '/1.jpg' },
    });
    expect([200, 202]).toContain(enqueued.statusCode);

    await waitUntil(
      () => localMedia.get('drama', 41, 1)?.download_status === 'completed',
      'download complete',
    );

    const local = await app.inject({ method: 'POST', url: '/api/stream/drama/41/1' });
    expect(local.statusCode).toBe(200);
    expect(local.json()).toMatchObject({
      source: 'local',
      playlistUrl: '/media/drama/41/1/playlist.m3u8',
      fileUrl: '/media/drama/41/1/media.mp4',
    });

    const mp4 = await app.inject({ method: 'GET', url: '/media/drama/41/1/media.mp4' });
    expect(mp4.statusCode).toBe(200);
    expect(mp4.headers['content-type']).toMatch(/mp4/);
    expect(mp4.rawPayload).toEqual(Buffer.from('remuxed'));
  });

  it('keeps a completed HLS download when remux is missing', async () => {
    const root = tempDir();
    const sqlite = new SQLiteStore(path.join(root, 'db.sqlite'));
    openStores.push(sqlite);
    const mediaRoot = path.join(root, 'media');
    const localMedia = new LocalMediaStore(sqlite.db);
    const queue = new DownloadQueue({
      store: localMedia,
      episodeApi: { getEpisode: async () => stream() },
      mediaRoot,
      fetchImpl: mapFetch({
        'https://cdn.example/vod.m3u8': `#EXTM3U
#EXTINF:4.0,
https://cdn.example/seg.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/seg.ts': Buffer.from('TS'),
      }),
      remux: async () => REMUX_STATUS.missing,
    });

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => localMedia.get('drama', 41, 1)?.download_status === 'completed',
      'hls complete',
    );

    expect(fs.existsSync(path.join(mediaRoot, 'drama/41/1/media.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(mediaRoot, 'drama/41/1/playlist.m3u8'))).toBe(true);
    expect(localMedia.get('drama', 41, 1)?.file_path).toBe('drama/41/1/playlist.m3u8');
  });
});
