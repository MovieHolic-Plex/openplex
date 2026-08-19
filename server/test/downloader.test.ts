import { createCipheriv } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DownloadQueue } from '../src/downloader/queue.js';
import { REMUX_STATUS } from '../src/downloader/remux.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';
import type { EpisodeApiLike, EpisodeStreamData } from '../src/routes/index.js';

const openStores: SQLiteStore[] = [];
const tempDirectories: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-dl-'));
  tempDirectories.push(directory);
  return directory;
}

function openQueue(options: {
  fetchImpl: typeof fetch;
  episodeApi?: EpisodeApiLike;
  maxCacheBytes?: number;
  now?: () => number;
  segmentConcurrency?: number;
}): { queue: DownloadQueue; store: LocalMediaStore; mediaRoot: string } {
  const root = tempDir();
  const sqlite = new SQLiteStore(path.join(root, 'db.sqlite'));
  openStores.push(sqlite);
  const store = new LocalMediaStore(sqlite.db);
  if (options.maxCacheBytes) store.setMaxCacheBytes(options.maxCacheBytes);
  const episodeApi = options.episodeApi ?? {
    getEpisode: async ({ category, wrId, epIdx }) => stream({
      category,
      wrId,
      idx: epIdx,
    }),
  };
  const queue = new DownloadQueue({
    store,
    episodeApi,
    fetchImpl: options.fetchImpl,
    mediaRoot: path.join(root, 'media'),
    now: options.now ?? (() => 1_000),
    playlistPollIntervalMs: 1,
    segmentConcurrency: options.segmentConcurrency ?? 4,
    remux: async () => REMUX_STATUS.missing,
  });
  return { queue, store, mediaRoot: path.join(root, 'media') };
}

function stream(overrides: Partial<EpisodeStreamData> = {}): EpisodeStreamData {
  return {
    idx: 1,
    category: 'drama',
    wrId: 41,
    title: 'Episode 1',
    thumb: '/1.jpg',
    hlsUrl: 'https://cdn.example/vod.m3u8',
    srt: null,
    vtt: 'https://cdn.example/sub.vtt',
    pageUrl: '/drama/41/1',
    sessionData1: null,
    sessionData2: null,
    nextEpisode: null,
    ...overrides,
  };
}

function mapFetch(routes: Record<string, string | Buffer>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    const body = routes[url.toString()] ?? routes[url.pathname];
    if (body === undefined) return new Response('missing', { status: 404 });
    const type = url.pathname.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : url.pathname.endsWith('.vtt')
        ? 'text/vtt'
        : url.pathname.endsWith('.srt')
          ? 'application/x-subrip'
          : 'video/mp2t';
    return new Response(body, { headers: { 'Content-Type': type } });
  }) as typeof fetch;
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('DownloadQueue', () => {
  it('assembles a clear VOD bundle from a media playlist, segments, and VTT', async () => {
    const { queue, store, mediaRoot } = openQueue({
      fetchImpl: mapFetch({
        'https://cdn.example/vod.m3u8': `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
seg-a.ts
#EXTINF:3.0,
https://cdn.example/seg-b.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/seg-a.ts': Buffer.from('AAAA'),
        'https://cdn.example/seg-b.ts': Buffer.from('BBBB'),
        'https://cdn.example/sub.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n',
      }),
    });

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });

    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'completed download',
    );

    const item = store.get('drama', 41, 1);
    expect(item).toMatchObject({
      download_status: 'completed',
      file_path: 'drama/41/1/playlist.m3u8',
      done_segments: 2,
      total_segments: 2,
    });
    expect(item && item.size_bytes).toBeGreaterThan(0);

    const playlist = fs.readFileSync(path.join(mediaRoot, 'drama/41/1/playlist.m3u8'), 'utf8');
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('segments/seg00000.ts');
    expect(playlist).toContain('segments/seg00001.ts');
    expect(playlist).toContain('#EXT-X-ENDLIST');
    expect(playlist).not.toContain('cdn.example');
    expect(fs.readFileSync(path.join(mediaRoot, 'drama/41/1/segments/seg00000.ts'))).toEqual(Buffer.from('AAAA'));
    expect(fs.readFileSync(path.join(mediaRoot, 'drama/41/1/segments/seg00001.ts'))).toEqual(Buffer.from('BBBB'));
    expect(fs.readFileSync(path.join(mediaRoot, 'drama/41/1/subtitles.vtt'), 'utf8')).toContain('WEBVTT');
  });

  it('picks the highest-bandwidth variant and decrypts AES-128 segments', async () => {
    const key = Buffer.alloc(16, 7);
    const iv = Buffer.alloc(16, 0);
    const plain = Buffer.from('clear-transport-stream-bytes');
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);

    const { queue, store, mediaRoot } = openQueue({
      fetchImpl: mapFetch({
        'https://cdn.example/master.m3u8': `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000
high.m3u8
`,
        'https://cdn.example/high.m3u8': `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000000
#EXTINF:4.0,
enc.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/low.m3u8': '#EXTM3U\n#EXTINF:4.0,\nskip.ts\n#EXT-X-ENDLIST\n',
        'https://cdn.example/key.bin': key,
        'https://cdn.example/enc.ts': encrypted,
        'https://cdn.example/sub.vtt': 'WEBVTT\n',
      }),
      episodeApi: {
        getEpisode: async () => stream({ hlsUrl: 'https://cdn.example/master.m3u8' }),
      },
    });

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'decrypted download',
    );

    expect(fs.readFileSync(path.join(mediaRoot, 'drama/41/1/segments/seg00000.ts'))).toEqual(plain);
    const playlist = fs.readFileSync(path.join(mediaRoot, 'drama/41/1/playlist.m3u8'), 'utf8');
    expect(playlist).not.toContain('EXT-X-KEY');
    expect(fs.existsSync(path.join(mediaRoot, 'drama/41/1/key.bin'))).toBe(false);
  });

  it('evicts the oldest unaccessed completed title when the cache budget is exceeded', async () => {
    let clock = 100;
    const { queue, store, mediaRoot } = openQueue({
      fetchImpl: mapFetch({
        'https://cdn.example/vod.m3u8': `#EXTM3U
#EXTINF:1.0,
seg.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/seg.ts': Buffer.alloc(80, 1),
        'https://cdn.example/sub.vtt': 'WEBVTT\n',
      }),
      maxCacheBytes: 120,
      now: () => clock,
    });

    queue.enqueue({
      category: 'drama',
      id: 1,
      epIdx: 1,
      title: 'Old',
      thumb: '',
    });
    await waitUntil(
      () => store.get('drama', 1, 1)?.download_status === 'completed',
      'first completed',
    );

    clock = 200;
    queue.enqueue({
      category: 'drama',
      id: 1,
      epIdx: 2,
      title: 'New',
      thumb: '',
    });
    await waitUntil(
      () => store.get('drama', 1, 2)?.download_status === 'completed',
      'second completed',
    );

    expect(store.get('drama', 1, 1)).toBeNull();
    expect(fs.existsSync(path.join(mediaRoot, 'drama/1/1'))).toBe(false);
    expect(store.get('drama', 1, 2)?.download_status).toBe('completed');
    expect(fs.existsSync(path.join(mediaRoot, 'drama/1/2/playlist.m3u8'))).toBe(true);
  });

  it('sends the player CDN headers when fetching the playlist', async () => {
    const seen: Array<HeadersInit | undefined> = [];
    const { queue, store } = openQueue({
      fetchImpl: (async (input, init) => {
        seen.push(init?.headers);
        return mapFetch({
          'https://cdn.example/vod.m3u8': '#EXTM3U\n#EXTINF:1.0,\nseg.ts\n#EXT-X-ENDLIST\n',
          'https://cdn.example/seg.ts': Buffer.from('x'),
          'https://cdn.example/sub.vtt': 'WEBVTT\n',
        })(input);
      }) as typeof fetch,
    });

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'headered download',
    );

    expect(seen[0]).toMatchObject({
      'User-Agent': expect.stringContaining('Chrome/126'),
      Referer: 'https://player.bunny-frame.online/',
      Origin: 'https://player.bunny-frame.online',
    });
  });

  it('records a failed status when the playlist cannot be fetched', async () => {
    const { queue, store } = openQueue({
      fetchImpl: mapFetch({}),
    });
    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'failed',
      'failed download',
    );
    expect(store.get('drama', 41, 1)?.error).toMatch(/playlist/i);
  });

  it('refreshes the playlist and retries after a 403 token expiry', async () => {
    let episodeCalls = 0;
    let oldAccepted = 0;
    const { queue, store, mediaRoot } = openQueue({
      segmentConcurrency: 1,
      episodeApi: {
        getEpisode: async () => {
          episodeCalls += 1;
          return stream({
            hlsUrl: episodeCalls === 1
              ? 'https://cdn.example/vod-old.m3u8'
              : 'https://cdn.example/vod-new.m3u8',
          });
        },
      },
      fetchImpl: (async (input) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
        if (url.pathname === '/vod-old.m3u8') {
          return new Response(`#EXTM3U
#EXTINF:1.0,
seg.ts?token=old
#EXTINF:1.0,
seg.ts?token=old
#EXTINF:1.0,
seg.ts?token=old
#EXT-X-ENDLIST
`);
        }
        if (url.pathname === '/vod-new.m3u8') {
          return new Response(`#EXTM3U
#EXTINF:1.0,
seg.ts?token=new
#EXTINF:1.0,
seg.ts?token=new
#EXTINF:1.0,
seg.ts?token=new
#EXT-X-ENDLIST
`);
        }
        if (url.pathname === '/seg.ts') {
          if (url.searchParams.get('token') === 'old') {
            oldAccepted += 1;
            if (oldAccepted > 1) return new Response('expired', { status: 403 });
          }
          if (url.searchParams.get('token') === 'old' || url.searchParams.get('token') === 'new') {
            return new Response(Buffer.from('TS'));
          }
        }
        if (url.pathname === '/sub.vtt') return new Response('WEBVTT\n');
        return new Response('missing', { status: 404 });
      }) as typeof fetch,
    });

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'token-refreshed download',
    );

    expect(episodeCalls).toBeGreaterThan(1);
    expect(fs.readdirSync(path.join(mediaRoot, 'drama/41/1/segments'))).toHaveLength(3);
  });

  it('skips already written segments when a download is retried', async () => {
    const { queue, store, mediaRoot } = openQueue({
      fetchImpl: mapFetch({
        'https://cdn.example/vod.m3u8': `#EXTM3U
#EXTINF:1.0,
seg-a.ts
#EXTINF:1.0,
seg-b.ts
#EXT-X-ENDLIST
`,
        'https://cdn.example/seg-a.ts': Buffer.from('NEW-A'),
        'https://cdn.example/seg-b.ts': Buffer.from('NEW-B'),
        'https://cdn.example/sub.vtt': 'WEBVTT\n',
      }),
    });
    const dir = path.join(mediaRoot, 'drama/41/1/segments');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'seg00000.ts'), Buffer.from('KEEP-A'));

    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'resumed download',
    );

    expect(fs.readFileSync(path.join(dir, 'seg00000.ts'))).toEqual(Buffer.from('KEEP-A'));
    expect(fs.readFileSync(path.join(dir, 'seg00001.ts'))).toEqual(Buffer.from('NEW-B'));
  });

  it('does not start another download for a completed episode', async () => {
    let fetches = 0;
    const { queue, store } = openQueue({
      fetchImpl: (async (input) => {
        fetches += 1;
        return mapFetch({
          'https://cdn.example/vod.m3u8': '#EXTM3U\n#EXTINF:1.0,\nseg.ts\n#EXT-X-ENDLIST\n',
          'https://cdn.example/seg.ts': Buffer.from('x'),
          'https://cdn.example/sub.vtt': 'WEBVTT\n',
        })(input);
      }) as typeof fetch,
    });
    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await waitUntil(
      () => store.get('drama', 41, 1)?.download_status === 'completed',
      'first complete',
    );
    const afterFirst = fetches;
    queue.enqueue({
      category: 'drama',
      id: 41,
      epIdx: 1,
      title: 'Episode 1',
      thumb: '/1.jpg',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetches).toBe(afterFirst);
  });
});
