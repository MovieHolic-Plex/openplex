import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlsGateway } from '../src/gateway/hls-gateway.js';
import { buildCrawlServer } from '../src/crawl/server.js';
import type {
  EpisodeApiLike,
  EpisodeStreamData,
  RouteDependencies,
} from '../src/routes/index.js';
import {
  SQLiteStore,
  type BookmarkItem,
  type WatchHistoryItem,
} from '../src/store/sqlite-store.js';

function history(overrides: Partial<WatchHistoryItem> = {}): WatchHistoryItem {
  return {
    category: 'drama',
    id: 41,
    epIdx: 2,
    title: 'Episode 2',
    thumb: '/episode.jpg',
    position_sec: 120,
    duration_sec: 600,
    updated_at: 10,
    ...overrides,
  };
}

function stream(overrides: Partial<EpisodeStreamData> = {}): EpisodeStreamData {
  return {
    idx: 2,
    category: 'drama',
    wrId: 41,
    title: 'Episode 2 stream',
    thumb: '/episode.jpg',
    hlsUrl: 'https://media.example/master.m3u8',
    srt: '/subtitles/ko.srt',
    vtt: null,
    pageUrl: '/drama/41/2',
    sessionData1: '{"page":true}',
    sessionData2: '{"api":true}',
    nextEpisode: { idx: 3, title: 'Episode 3' },
    ...overrides,
  };
}

function createDependencies() {
  const now = 1_787_000_000_000;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-routes-'));
  const store = new SQLiteStore(path.join(tempDirectory, 'routes.db'));
  for (const item of [
    history(),
    history({ id: 42, position_sec: 95, duration_sec: 100 }),
    history({ id: 43, position_sec: 0, duration_sec: 0 }),
    history({ id: 44, position_sec: 10, duration_sec: 100 }),
    history({ id: 45, position_sec: 90, duration_sec: 100 }),
    history({ id: 46, position_sec: 100, duration_sec: 100 }),
  ]) {
    store.upsertHistory(1, item);
  }
  store.addBookmark(1, {
    category: 'movie',
    id: 9,
    title: 'Movie Nine',
    thumb: '/nine.jpg',
    created_at: 20,
  } satisfies BookmarkItem);
  vi.spyOn(store, 'getHistory');
  vi.spyOn(store, 'upsertHistory');
  vi.spyOn(store, 'getBookmarks');
  vi.spyOn(store, 'addBookmark');
  vi.spyOn(store, 'isBookmarked');
  vi.spyOn(store, 'deleteBookmark');
  vi.spyOn(store, 'getWatchStateMap');
  vi.spyOn(store, 'getNextUpCandidates');
  vi.spyOn(store, 'upsertEpisodeCatalog');
  vi.spyOn(store, 'getStats');

  const client = {
    baseUrl: 'https://tv.example',
    getText: vi.fn(async (path: string) => `<html data-path="${path}"></html>`),
    getJson: vi.fn(async () => ({})),
  };
  const homeParser = {
    parse: vi.fn(() => [{
      title: 'Popular',
      viewAllPath: '/drama',
      items: [{ category: 'drama', wrId: 41, title: 'Drama 41' }],
    }]),
  };
  const categoryParser = {
    parse: vi.fn((_html: string, options: { categoryPath: string; page?: number }) => ({
      items: [{ category: options.categoryPath, wrId: 41 }],
      page: options.page ?? 1,
      hasNext: false,
      nextPagePath: null,
    })),
  };
  const searchParser = {
    parse: vi.fn(() => ({
      items: [{ category: 'drama', wrId: 41, title: 'Result' }],
      categoryCounts: [{ table: 'drama', name: 'Drama', count: 1, isActive: true }],
    })),
  };
  const titleParser = {
    parse: vi.fn((_html: string, options: { category: string; wrId: number }) => ({
      ...options,
      title: 'Title detail',
      episodes: [{ ...options, epIdx: 2, title: 'Episode 2', thumbUrl: '/episode-2.jpg' }],
      registeredAt: null,
      prevEpisodePath: null,
      nextEpisodePath: null,
    })),
  };
  const episodeParser = {
    parse: vi.fn((_html: string, options: { category: string; wrId: number }) => ({
      ...options,
      epIdx: 2,
      title: 'Episode page',
      sessionData1: '{"page":true}',
      sessionData2: null,
      prevEpisodePath: null,
      nextEpisodePath: `/${options.category}/${options.wrId}/3`,
    })),
  };
  const episodeApi: EpisodeApiLike = { getEpisode: vi.fn(async () => stream()) };

  const dependencies: RouteDependencies = {
    client,
    store,
    homeParser,
    categoryParser,
    searchParser,
    titleParser,
    episodeParser,
    episodeApi,
    now: () => now,
    mediaRoot: path.join(tempDirectory, 'media'),
    fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
  };
  return {
    dependencies,
    client,
    store,
    homeParser,
    categoryParser,
    searchParser,
    titleParser,
    episodeParser,
    episodeApi,
    now,
    tempDirectory,
  };
}

describe('Fastify REST API routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createDependencies>;

  beforeEach(async () => {
    mocks = createDependencies();
    app = await buildCrawlServer({
      logger: false,
      gateway: new HlsGateway(),
      dependencies: mocks.dependencies,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    mocks.store.close();
    fs.rmSync(mocks.tempDirectory, { recursive: true, force: true });
  });

  it('joins next up from the local catalog without upstream calls beyond the home catalog fetch', async () => {
    mocks.store.upsertEpisodeCatalog([
      { category: 'drama', id: 41, epIdx: 2, ordinal: 0, title: 'Episode 2', thumb: '/episode-2.jpg' },
      { category: 'drama', id: 41, epIdx: 908_177, ordinal: 1, title: 'Episode 3', thumb: '/episode-3.jpg' },
    ]);
    const upstreamCallsBefore = mocks.client.getText.mock.calls.length + mocks.client.getJson.mock.calls.length;

    const response = await app.inject({ method: 'GET', url: '/api/home' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sections: [{
        title: 'Popular',
        items: [{ watchState: { watched: false, progress: 0.2, unwatchedCount: 2 } }],
      }],
      continueWatching: [{ id: 41, epIdx: 2 }],
      nextUp: [{
        category: 'drama',
        id: 41,
        epIdx: 908_177,
        title: 'Episode 3',
        thumb: '/episode-3.jpg',
        nextOrdinal: 1,
      }],
    });
    expect(mocks.client.getText).toHaveBeenCalledWith('/');
    expect(mocks.homeParser.parse).toHaveBeenCalledOnce();
    expect(response.json().continueWatching).toEqual([expect.objectContaining({ id: 41, epIdx: 2 })]);
    expect(mocks.store.getHistory).toHaveBeenCalledOnce();
    expect(mocks.store.getHistory).toHaveBeenCalledWith(1);
    const upstreamCallsAfter = mocks.client.getText.mock.calls.length + mocks.client.getJson.mock.calls.length;
    const existingHomeCatalogFetches = 1;
    expect(upstreamCallsAfter - upstreamCallsBefore - existingHomeCatalogFetches).toBe(0);
    expect(mocks.client.getText).toHaveBeenCalledTimes(existingHomeCatalogFetches);
    expect(mocks.client.getJson).not.toHaveBeenCalled();
  });

  it('loads category pages and passes the page to CategoryParser', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/category/drama?page=2' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: 2,
      hasNext: false,
      items: [{ watchState: { watched: false, progress: 0.2, unwatchedCount: null } }],
    });
    expect(mocks.client.getText).toHaveBeenCalledWith('/drama/p2');
    expect(mocks.categoryParser.parse).toHaveBeenCalledWith(expect.any(String), {
      categoryPath: 'drama',
      page: 2,
    });
  });

  it('searches with provider query parameters and returns a total', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/search?q=alpha%20show' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{
        title: 'Result',
        watchState: { watched: false, progress: 0.2, unwatchedCount: null },
      }],
    });
    expect(mocks.client.getText).toHaveBeenCalledWith('/bbs/search.php', {
      query: { sfl: 'wr_subject', sop: 'and', stx: 'alpha show' },
    });
    expect(mocks.searchParser.parse).toHaveBeenCalledOnce();
  });

  it('loads title details with numeric id coercion', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/title/drama/41' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      category: 'drama',
      wrId: 41,
      episodes: [{ epIdx: 2 }],
    });
    expect(mocks.client.getText).toHaveBeenCalledWith('/drama/41');
    expect(mocks.client.getText).toHaveBeenCalledTimes(1);
    expect(mocks.titleParser.parse).toHaveBeenCalledWith(expect.any(String), {
      category: 'drama',
      wrId: 41,
    });
    expect(mocks.store.upsertEpisodeCatalog).toHaveBeenCalledWith([{
      category: 'drama',
      id: 41,
      epIdx: 2,
      ordinal: 0,
      title: 'Episode 2',
      thumb: '/episode-2.jpg',
    }]);
    expect(mocks.store.db.prepare(`
      SELECT category, id, ep_idx, ordinal, title, thumb FROM episode_catalog
      WHERE category = 'drama' AND id = 41
    `).all()).toEqual([{
      category: 'drama',
      id: 41,
      ep_idx: 2,
      ordinal: 0,
      title: 'Episode 2',
      thumb: '/episode-2.jpg',
    }]);

  });

  it('lists registered source adapters', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { name: 'local', enabled: true, kind: 'comic', kinds: ['comic'] },
    ]);
  });

  it('parses the episode page, resolves its API stream, and creates an isolated HLS session', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/stream/drama/41/2' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      playlistUrl: expect.stringMatching(/^\/hls\/[0-9a-f-]+\/playlist\.m3u8$/),
      subtitles: [{ id: 'srt', url: expect.stringContaining('/subtitle/srt'), format: 'srt' }],
      title: 'Episode 2 stream',
      nextEpisode: { idx: 3, title: 'Episode 3' },
    });
    expect(mocks.client.getText).toHaveBeenCalledWith('/drama/41/2');
    expect(mocks.episodeParser.parse).toHaveBeenCalledOnce();
    expect(mocks.episodeApi.getEpisode).toHaveBeenCalledWith({
      category: 'drama',
      wrId: 41,
      epIdx: 2,
    });
  });

  it('uses the always-present default profile when the header is absent', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/home' });

    expect(response.statusCode).toBe(200);
    expect(mocks.store.getHistory).toHaveBeenLastCalledWith(1);
    expect(mocks.store.getWatchStateMap).toHaveBeenLastCalledWith(1, expect.any(Array));
    expect(mocks.store.getNextUpCandidates).toHaveBeenLastCalledWith(1, 20);
  });

  it.each(['', '0', '-1', 'abc', '1.5', ' 1', '01', '999']) (
    'rejects invalid supplied profile header %j without falling back',
    async (profileId) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/history',
        headers: { 'x-profile-id': profileId },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'PROFILE_INVALID' } });
      expect(mocks.store.getHistory).not.toHaveBeenCalled();
    },
  );

  it('keeps profile A history out of profile B home and history responses', async () => {
    const profileB = mocks.store.createProfile('Profile B', '#222');

    const home = await app.inject({
      method: 'GET',
      url: '/api/home',
      headers: { 'x-profile-id': String(profileB.id) },
    });
    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/history',
      headers: { 'x-profile-id': String(profileB.id) },
    });

    expect(home.statusCode).toBe(200);
    expect(home.json().continueWatching).toEqual([]);
    expect(home.json().sections[0].items[0].watchState).toEqual({
      watched: false,
      progress: 0,
      unwatchedCount: null,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().items).toEqual([]);
    expect(JSON.stringify(home.json())).not.toContain('Episode 2');
    expect(mocks.store.getHistory).toHaveBeenCalledWith(profileB.id);
  });

  it('reads and writes watch history through the resolved profile', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/history' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(6);

    const item = history({ id: 77, epIdx: 5, updated_at: undefined });
    const save = await app.inject({ method: 'POST', url: '/api/history', payload: item });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ success: true });
    expect(mocks.store.upsertHistory).toHaveBeenCalledWith(1, item);
  });

  it('reads, creates, and deletes bookmarks through the resolved profile', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/bookmarks' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([expect.objectContaining({ id: 9 })]);

    const bookmark = { category: 'drama', id: 41, title: 'Drama 41', thumb: '/41.jpg' };
    const create = await app.inject({ method: 'POST', url: '/api/bookmarks', payload: bookmark });
    expect(create.statusCode).toBe(200);
    expect(mocks.store.addBookmark).toHaveBeenCalledWith(1, bookmark);

    const remove = await app.inject({ method: 'DELETE', url: '/api/bookmarks/drama/41' });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toEqual({ success: true });
    expect(mocks.store.deleteBookmark).toHaveBeenCalledWith(1, 'drama', 41);
  });

  it('supports path-authoritative profile CRUD, subtitle style, and stats', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Guest', color: '#abc123' },
    });
    expect(create.statusCode).toBe(201);
    const profileId = create.json().profile.id as number;

    const list = await app.inject({ method: 'GET', url: '/api/profiles' });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: profileId, name: 'Guest', avatar_color: '#abc123' }),
    ]));

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profileId}`,
      headers: { 'x-profile-id': '1' },
      payload: { name: 'Guest Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect(rename.json().profile).toMatchObject({ id: profileId, name: 'Guest Renamed' });

    const putStyle = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profileId}/subtitle-style`,
      headers: { 'x-profile-id': '1' },
      payload: { style: { fontScale: 150, color: 'yellow' } },
    });
    expect(putStyle.statusCode).toBe(200);
    expect(putStyle.json()).toEqual({
      style: {
        fontScale: 150,
        color: 'yellow',
        backgroundOpacity: 70,
        edgeStyle: 'none',
      },
    });

    const getStyle = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profileId}/subtitle-style`,
      headers: { 'x-profile-id': '1' },
    });
    expect(getStyle.statusCode).toBe(200);
    expect(getStyle.json()).toEqual({
      style: {
        fontScale: 150,
        color: 'yellow',
        backgroundOpacity: 70,
        edgeStyle: 'none',
      },
    });

    const clampedStyle = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${profileId}/subtitle-style`,
      headers: { 'x-profile-id': '1' },
      payload: {
        style: {
          fontScale: 250,
          color: 'cyan',
          backgroundOpacity: -10,
          edgeStyle: 'outline',
        },
      },
    });
    expect(clampedStyle.statusCode).toBe(200);
    expect(clampedStyle.json()).toEqual({
      style: {
        fontScale: 200,
        color: 'cyan',
        backgroundOpacity: 0,
        edgeStyle: 'outline',
      },
    });

    const stats = await app.inject({
      method: 'GET',
      url: `/api/profiles/${profileId}/stats`,
      headers: { 'x-profile-id': '1' },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      totalWatchSeconds: 0,
      seriesCount: 0,
      movieCount: 0,
      daily: expect.arrayContaining([expect.objectContaining({ watchSeconds: 0 })]),
    });
    expect(mocks.store.getStats).toHaveBeenLastCalledWith(profileId, mocks.now);

    const deletion = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${profileId}`,
      headers: { 'x-profile-id': '1' },
    });
    expect(deletion.statusCode).toBe(200);
    expect(deletion.json()).toEqual({ success: true });
    expect(mocks.store.profileExists(profileId)).toBe(false);
  });

  it('always rejects deleting profile 1 and preserves headerless fallback', async () => {
    mocks.store.createProfile('Second profile');

    const deletion = await app.inject({ method: 'DELETE', url: '/api/profiles/1' });
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json()).toMatchObject({ error: { code: 'PROFILE_DELETE_CONFLICT' } });
    expect(mocks.store.profileExists(1)).toBe(true);

    const home = await app.inject({ method: 'GET', url: '/api/home' });
    expect(home.statusCode).toBe(200);
    expect(mocks.store.getHistory).toHaveBeenLastCalledWith(1);
  });

  it('returns 409 rather than deleting the last profile', async () => {
    mocks.store.db.prepare(`
      INSERT INTO profiles (id, name, avatar_color, subtitle_style, created_at)
      VALUES (2, 'only profile', NULL, NULL, 1)
    `).run();
    mocks.store.db.prepare('DELETE FROM profiles WHERE id = 1').run();

    const deletion = await app.inject({
      method: 'DELETE',
      url: '/api/profiles/2',
      headers: { 'x-profile-id': '2' },
    });
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json()).toMatchObject({ error: { code: 'PROFILE_DELETE_CONFLICT' } });
    expect(mocks.store.profileExists(2)).toBe(true);
  });

  it.each([
    ['GET', '/api/category/Drama?page=1', undefined],
    ['GET', '/api/category/drama?page=0', undefined],
    ['GET', '/api/search', undefined],
    ['GET', '/api/search?q=%20%20', undefined],
    ['GET', '/api/title/drama/not-a-number', undefined],
    ['POST', '/api/stream/drama/41/-1', undefined],
    ['POST', '/api/history', { category: 'drama', id: 1 }],
    ['POST', '/api/bookmarks', { category: 'drama', id: 1, title: '' }],
    ['POST', '/api/profiles', { name: '' }],
    ['PATCH', '/api/profiles/1', { name: '' }],
  ] as const)('returns the uniform 400 envelope for %s %s', async (method, url, payload) => {
    const response = await app.inject({ method, url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  it('returns uniform 404 envelopes for unknown routes and missing resources', async () => {
    const missingRoute = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(missingRoute.statusCode).toBe(404);
    expect(missingRoute.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });

    const bookmark = await app.inject({ method: 'DELETE', url: '/api/bookmarks/drama/999' });
    expect(bookmark.statusCode).toBe(404);
    expect(bookmark.json()).toEqual({
      error: { code: 'BOOKMARK_NOT_FOUND', message: 'Bookmark was not found' },
    });

    vi.mocked(mocks.episodeApi.getEpisode).mockResolvedValueOnce(stream({ hlsUrl: null }));
    const streamResponse = await app.inject({ method: 'POST', url: '/api/stream/drama/41/2' });
    expect(streamResponse.statusCode).toBe(404);
    expect(streamResponse.json()).toEqual({
      error: { code: 'STREAM_NOT_FOUND', message: 'Episode stream was not found' },
    });
  });

  it('attributes history writes to the live session profile even when header differs', async () => {
    const profile2 = mocks.store.createProfile('Profile Two');

    // Create stream under profile 1
    const streamResponse = await app.inject({
      method: 'POST',
      url: '/api/stream/drama/41/2',
      headers: { 'x-profile-id': '1' },
    });
    expect(streamResponse.statusCode).toBe(200);
    const { sessionId } = streamResponse.json() as { sessionId: string };

    // Post history with sessionId under header for profile 2 -> lands in profile 1
    const historyResponse = await app.inject({
      method: 'POST',
      url: '/api/history',
      headers: { 'x-profile-id': String(profile2.id) },
      payload: {
        category: 'drama',
        id: 41,
        epIdx: 2,
        title: 'Episode 2',
        thumb: '/episode.jpg',
        position_sec: 250,
        duration_sec: 600,
        sessionId,
      },
    });
    expect(historyResponse.statusCode).toBe(200);

    const historyProfile1 = mocks.store.getHistory(1);
    const historyProfile2 = mocks.store.getHistory(profile2.id);

    expect(historyProfile1.some((item) => item.id === 41 && item.position_sec === 250)).toBe(true);
    expect(historyProfile2.some((item) => item.id === 41)).toBe(false);
  });

  it('falls back to header profile if sessionId is absent, unknown, or expired', async () => {
    const profile2 = mocks.store.createProfile('Profile Two');

    // 1. Absent sessionId -> header profile (2) wins
    const resNoSession = await app.inject({
      method: 'POST',
      url: '/api/history',
      headers: { 'x-profile-id': String(profile2.id) },
      payload: {
        category: 'drama',
        id: 77,
        epIdx: 1,
        title: 'No Session',
        thumb: '/thumb.jpg',
        position_sec: 10,
        duration_sec: 100,
      },
    });
    expect(resNoSession.statusCode).toBe(200);
    expect(mocks.store.getHistory(profile2.id).some((i) => i.id === 77)).toBe(true);

    // 2. Unknown sessionId -> header profile (2) fallback
    const resUnknownSession = await app.inject({
      method: 'POST',
      url: '/api/history',
      headers: { 'x-profile-id': String(profile2.id) },
      payload: {
        category: 'drama',
        id: 88,
        epIdx: 1,
        title: 'Unknown Session',
        thumb: '/thumb.jpg',
        position_sec: 20,
        duration_sec: 100,
        sessionId: 'unknown-session-id-12345',
      },
    });
    expect(resUnknownSession.statusCode).toBe(200);
    expect(mocks.store.getHistory(profile2.id).some((i) => i.id === 88)).toBe(true);
  });
});
