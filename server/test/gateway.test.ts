import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HlsGateway,
  type HlsGatewayOptions,
} from '../src/gateway/hls-gateway.js';

const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subs/en.srt"
#EXT-X-STREAM-INF:BANDWIDTH=1280000,SUBTITLES="subs"
media/index.m3u8
`;

const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-KEY:METHOD=AES-128,URI="keys/level7.json"
#EXTINF:10,
segments/one.ts?token=upstream
#EXT-X-ENDLIST
`;

function createFetchMock() {
  const segmentRequests = { count: 0 };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/master.m3u8') {
      return new Response(masterPlaylist, {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    }
    if (url.pathname === '/media/index.m3u8') {
      return new Response(mediaPlaylist, {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    }
    if (url.pathname === '/media/segments/one.ts') {
      segmentRequests.count += 1;
      return new Response(Buffer.from('transport-stream'), {
        headers: { 'Content-Type': 'video/mp2t' },
      });
    }
    if (url.pathname === '/media/keys/level7.json') {
      return new Response('{"level7":"fixture"}', {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/subs/en.srt') {
      return new Response(
        '1\r\n00:00:01,250 --> 00:00:03,500\r\nHello from upstream\r\n',
        { headers: { 'Content-Type': 'application/x-subrip' } },
      );
    }
    return new Response('not found', { status: 404 });
  });
  return { fetch, segmentRequests };
}

function proxyPaths(playlist: string, prefix: string): string[] {
  return [...playlist.matchAll(new RegExp(`${prefix}[^"'\\s,]+`, 'g'))]
    .map((match) => match[0]);
}

describe('secure HLS gateway', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  async function install(options: HlsGatewayOptions = {}) {
    const gateway = new HlsGateway(options);
    await gateway.register(app);
    await app.ready();
    return gateway;
  }

  it('allocates UUID sessions and rewrites master and media playlists', async () => {
    const upstream = createFetchMock();
    const gateway = await install({ fetch: upstream.fetch as typeof fetch });
    const session = gateway.createSession('https://media.example/master.m3u8');

    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(session.expiresAt).toBeGreaterThan(session.createdAt);

    const master = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/playlist.m3u8`,
    });

    expect(master.statusCode).toBe(200);
    expect(master.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    expect(master.body).not.toContain('https://media.example');
    expect(master.body).toContain(`/hls/${session.sessionId}/subtitle/`);

    const playlistPaths = proxyPaths(
      master.body,
      `/hls/${session.sessionId}/resource/`,
    );
    expect(playlistPaths).toHaveLength(1);

    const media = await app.inject({ method: 'GET', url: playlistPaths[0] });
    expect(media.statusCode).toBe(200);
    expect(media.body).toContain('#EXT-X-KEY:METHOD=AES-128');
    expect(media.body).toMatch(
      new RegExp(`URI="/hls/${session.sessionId}/resource/[A-Za-z0-9_-]+"`),
    );
    expect(media.body).toMatch(
      new RegExp(`/hls/${session.sessionId}/resource/[A-Za-z0-9_-]+`),
    );
    expect(media.body).not.toContain('token=upstream');
  });

  it('resolves rewritten Level7 AES key endpoints to 16 raw bytes', async () => {
    const upstream = createFetchMock();
    const decode = vi.fn(() => Buffer.alloc(16, 0x5a));
    const gateway = await install({
      fetch: upstream.fetch as typeof fetch,
      keyDecoder: { decode },
    });
    const session = gateway.createSession('https://media.example/media/index.m3u8');

    const playlist = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/playlist.m3u8`,
    });
    const resourcePaths = proxyPaths(
      playlist.body,
      `/hls/${session.sessionId}/resource/`,
    );
    expect(resourcePaths).toHaveLength(2);

    const keyPath = resourcePaths.find((path) => {
      const id = path.split('/').pop()!;
      return session.resources.get(id)?.kind === 'key';
    });
    expect(keyPath).toBeDefined();

    const key = await app.inject({ method: 'GET', url: keyPath! });
    expect(key.statusCode).toBe(200);
    expect(key.headers['content-type']).toContain('application/octet-stream');
    expect(key.rawPayload).toEqual(Buffer.alloc(16, 0x5a));
    expect(decode).toHaveBeenCalledWith('{"level7":"fixture"}');
  });

  it('proxies SRT subtitles as valid WebVTT with dot timestamps', async () => {
    const upstream = createFetchMock();
    const gateway = await install({ fetch: upstream.fetch as typeof fetch });
    const session = gateway.createSession({
      playlistUrl: 'https://media.example/master.m3u8',
      subtitles: [{ id: 'english', url: 'https://media.example/subs/en.srt' }],
    });

    const subtitle = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/subtitle/english`,
    });

    expect(subtitle.statusCode).toBe(200);
    expect(subtitle.headers['content-type']).toContain('text/vtt');
    expect(subtitle.body).toMatch(/^WEBVTT\n\n/);
    expect(subtitle.body).toContain('00:00:01.250 --> 00:00:03.500');
    expect(subtitle.body).not.toContain('00:00:01,250');
    expect(subtitle.body).toContain('Hello from upstream');
  });

  it('serves repeated TS segment requests from the bounded memory cache', async () => {
    const upstream = createFetchMock();
    const gateway = await install({ fetch: upstream.fetch as typeof fetch });
    const session = gateway.createSession('https://media.example/media/index.m3u8');
    const playlist = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/playlist.m3u8`,
    });
    const segmentPath = proxyPaths(
      playlist.body,
      `/hls/${session.sessionId}/resource/`,
    ).find((path) => {
      const id = path.split('/').pop()!;
      return session.resources.get(id)?.kind === 'segment';
    });
    expect(segmentPath).toBeDefined();

    const first = await app.inject({ method: 'GET', url: segmentPath! });
    const second = await app.inject({ method: 'GET', url: segmentPath! });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.rawPayload.toString()).toBe('transport-stream');
    expect(second.rawPayload).toEqual(first.rawPayload);
    expect(upstream.segmentRequests.count).toBe(1);
  });

  it('rejects unregistered resource and subtitle IDs without upstream requests', async () => {
    const upstream = createFetchMock();
    const gateway = await install({ fetch: upstream.fetch as typeof fetch });
    const session = gateway.createSession('https://media.example/master.m3u8');
    const callsBefore = upstream.fetch.mock.calls.length;

    const resource = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/resource/https%3A%2F%2Finternal.invalid%2Fsecret`,
    });
    const subtitle = await app.inject({
      method: 'GET',
      url: `/hls/${session.sessionId}/subtitle/unknown`,
    });

    expect([403, 404]).toContain(resource.statusCode);
    expect([403, 404]).toContain(subtitle.statusCode);
    expect(upstream.fetch).toHaveBeenCalledTimes(callsBefore);
  });

  it('refreshes expiring upstream tokens once after the 45 second interval', async () => {
    const upstream = createFetchMock();
    let now = 1_000;
    const refreshSession = vi.fn(async () => ({
      playlistUrl: 'https://media.example/master.m3u8?token=fresh',
    }));
    const gateway = await install({
      fetch: upstream.fetch as typeof fetch,
      now: () => now,
      refreshSession,
    });
    const session = gateway.createSession('https://media.example/master.m3u8?token=old');

    await app.inject({ method: 'GET', url: `/hls/${session.sessionId}/playlist.m3u8` });
    expect(refreshSession).not.toHaveBeenCalled();

    now += 45_001;
    await app.inject({ method: 'GET', url: `/hls/${session.sessionId}/playlist.m3u8` });
    await app.inject({ method: 'GET', url: `/hls/${session.sessionId}/playlist.m3u8` });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(session.playlistUrl.searchParams.get('token')).toBe('fresh');
  });

  it('preserves profileId in session options as metadata', async () => {
    const gateway = await install();
    const session = gateway.createSession({
      playlistUrl: 'https://media.example/master.m3u8',
      profileId: 2,
    });
    expect(session.profileId).toBe(2);
  });
});
