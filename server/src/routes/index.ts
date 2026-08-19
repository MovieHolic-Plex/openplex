import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LocalAdapter } from '../adapters/local-adapter.js';
import { FileGptOauthStore, GptOauthSession } from '../agent/gpt-oauth.js';
import { parseAgentProvider, resolveAgentChat } from '../agent/resolve.js';
import type { AgentProvider } from '../agent/resolve.js';
import { registerOauthRoutes } from './oauth.js';
import type { AgentChatClient } from '../agent/loop.js';
import { DownloadQueue } from '../downloader/queue.js';
import { HlsGateway, type HlsSession } from '../gateway/hls-gateway.js';
import {
  defaultStore,
  LibraryStore,
  LocalMediaStore,
  SQLiteStore,
  type BookmarkItem,
  type EpisodeCatalogItem,
  type NextUpCandidate,
  type Profile,
  type ProfileStats,
  type WatchHistoryItem,
  type WatchState,
  type WatchStateItem,
} from '../store/index.js';
import {
  localStreamPayload,
  prefetchNextEpisode,
  registerDownloadRoutes,
} from './downloads.js';
import { ApiError } from './errors.js';
import { registerAgentRoutes } from './agent.js';
import { registerIngestRoutes } from './ingest.js';
import { registerJellyfinRoutes } from './jellyfin.js';
import { registerLibraryRoutes, runLibraryScan } from './library.js';
import { registerSettingsRoutes } from './settings.js';
import { registerLibraryStreamRoutes } from './library-stream.js';
import { registerTranscodeRoutes, resolveInput } from './transcode.js';
import { libraryHomePayload } from './media-home.js';
import { TranscodeEngine } from '../transcode/engine.js';
import { isTranscodeProfile } from '../transcode/engine.js';
import { OPENPLEX_VISITOR } from '../auth/token.js';
import { ensureGuestProfile } from '../auth/guest-profile.js';
import { buildProviderChain, scanWork } from '../metadata/scan.js';
import { ingestFromUrl } from '../ingest/url.js';
import path from 'node:path';
import type { RemuxRunner, RemuxStatus } from '../downloader/remux.js';
import { REMUX_STATUS } from '../downloader/remux.js';
import { proxyToCrawl } from '../crawl/bridge.js';
import { proxyConfigured } from '../crawl/proxy.js';
import { notifyMediaIngest } from '../crawl/notify.js';

const CATEGORY_PATTERN = '^[a-z_]+$';
const positiveInteger = { type: 'integer', minimum: 1 } as const;
const episodeIndex = { type: 'integer', minimum: 0 } as const;
const category = { type: 'string', pattern: CATEGORY_PATTERN } as const;

const categoryParamsSchema = {
  type: 'object',
  required: ['cat'],
  additionalProperties: false,
  properties: { cat: category },
} as const;

const titleParamsSchema = {
  type: 'object',
  required: ['cat', 'id'],
  additionalProperties: false,
  properties: { cat: category, id: positiveInteger },
} as const;

const streamParamsSchema = {
  type: 'object',
  required: ['cat', 'id', 'epIdx'],
  additionalProperties: false,
  properties: { cat: category, id: positiveInteger, epIdx: episodeIndex },
} as const;

const historyBodySchema = {
  type: 'object',
  required: [
    'category',
    'id',
    'epIdx',
    'title',
    'thumb',
    'position_sec',
    'duration_sec',
  ],
  additionalProperties: false,
  properties: {
    category,
    id: positiveInteger,
    epIdx: episodeIndex,
    title: { type: 'string', minLength: 1 },
    thumb: { type: 'string' },
    position_sec: { type: 'number', minimum: 0 },
    duration_sec: { type: 'number', exclusiveMinimum: 0 },
    sessionId: { type: 'string' },
  },
} as const;

const bookmarkBodySchema = {
  type: 'object',
  required: ['category', 'id', 'title', 'thumb'],
  additionalProperties: false,
  properties: {
    category,
    id: positiveInteger,
    title: { type: 'string', minLength: 1 },
    thumb: { type: 'string' },
  },
} as const;

const profileParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: positiveInteger },
} as const;

const createProfileBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    color: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const renameProfileBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1 } },
} as const;

const subtitleStyleBodySchema = {
  type: 'object',
  required: ['style'],
  additionalProperties: false,
  properties: {
    style: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            fontScale: { type: 'number' },
            color: { type: 'string', enum: ['white', 'yellow', 'cyan'] },
            backgroundOpacity: { type: 'number' },
            edgeStyle: { type: 'string', enum: ['none', 'shadow', 'outline'] },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

type SubtitleStyle = {
  fontScale: number;
  color: 'white' | 'yellow' | 'cyan';
  backgroundOpacity: number;
  edgeStyle: 'none' | 'shadow' | 'outline';
};

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontScale: 100,
  color: 'white',
  backgroundOpacity: 70,
  edgeStyle: 'none',
};

function normalizedSubtitleStyle(value: unknown): SubtitleStyle {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    fontScale: clampNumber(input.fontScale, 50, 200, DEFAULT_SUBTITLE_STYLE.fontScale),
    color: input.color === 'yellow' || input.color === 'cyan' ? input.color : 'white',
    backgroundOpacity: clampNumber(
      input.backgroundOpacity,
      0,
      100,
      DEFAULT_SUBTITLE_STYLE.backgroundOpacity,
    ),
    edgeStyle: input.edgeStyle === 'shadow' || input.edgeStyle === 'outline'
      ? input.edgeStyle
      : 'none',
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export interface EpisodeStreamData {
  idx: number;
  category: string;
  wrId: number;
  title: string;
  thumb: string | null;
  hlsUrl: string | null;
  srt: string | null;
  vtt: string | null;
  pageUrl: string | null;
  sessionData1: string | null;
  sessionData2: string | null;
  nextEpisode: Record<string, unknown> | null;
}

export interface EpisodeApiLike {
  getEpisode(options: {
    category: string;
    wrId: number;
    epIdx: number;
  }): Promise<EpisodeStreamData>;
}

interface TextClient {
  readonly baseUrl: string;
  getText(path: string, options?: {
    referer?: string;
    query?: Record<string, string | number | boolean | null | undefined>;
  }): Promise<string>;
  getJson(path: string, options?: {
    referer?: string;
    query?: Record<string, string | number | boolean | null | undefined>;
  }): Promise<Record<string, unknown>>;
}

interface StoreLike {
  listProfiles(): Profile[];
  profileExists(id: number): boolean;
  createProfile(name: string, color?: string | null): Profile;
  renameProfile(id: number, name: string): Profile;
  deleteProfile(id: number): void;
  getSubtitleStyle(profileId: number): string | null;
  setSubtitleStyle(profileId: number, json: string | null): void;
  getStats(profileId: number, now?: number): ProfileStats;
  getHistory(profileId: number, limit?: number): WatchHistoryItem[];
  upsertHistory(profileId: number, item: WatchHistoryItem): void;
  getBookmarks(profileId: number, limit?: number): BookmarkItem[];
  addBookmark(profileId: number, item: BookmarkItem): void;
  isBookmarked(profileId: number, category: string, id: number): boolean;
  deleteBookmark(profileId: number, category: string, id: number): void;
  upsertEpisodeCatalog(items: readonly EpisodeCatalogItem[]): void;
  getNextUpCandidates(profileId: number, limit: number): NextUpCandidate[];
  getWatchStateMap(profileId: number, items: readonly WatchStateItem[]): Map<string, WatchState>;
}

export interface RouteDependencies {
  client?: TextClient;
  store?: StoreLike | SQLiteStore;
  gateway?: Pick<HlsGateway, 'createSession'> & Partial<Pick<HlsGateway, 'sessions' | 'setRefreshHandler'>>;
  homeParser?: { parse(html: string): readonly { items: WatchStateItem[] }[] };
  categoryParser?: { parse(html: string, ctx: { categoryPath: string; page: number }): { items: WatchStateItem[] } };
  searchParser?: { parse(html: string): { items: WatchStateItem[] } };
  titleParser?: { parse(html: string, ctx: { category: string; wrId: number }): { title: string; episodes: readonly { epIdx: number; title: string; thumbUrl?: string | null }[] } };
  episodeParser?: { parse(html: string, ctx: { category: string; wrId: number }): { epIdx: number | null; title?: string } };
  episodeApi?: EpisodeApiLike;
  tvwiki?: {
    enqueueSpec(unitId: number): { category: string; id: number; epIdx: number; title: string; thumb: string } | null;
    importParsed(work: {
      adapter: string;
      externalId: string;
      title: string;
      kind: 'movie' | 'video_series';
      overview: string | null;
      poster: string | null;
      units: readonly { externalId: string; title: string; ordinal: number; thumb: string | null }[];
    }): void;
  };
  now?: () => number;
  mediaRoot?: string;
  fetchImpl?: typeof fetch;
  localMedia?: LocalMediaStore;
  downloader?: DownloadQueue;
  agentChat?: AgentChatClient;
  agentProvider?: AgentProvider;
  oauthStorePath?: string;
  oauthClientId?: string;
  oauthAuthorizeUrl?: string;
  oauthTokenUrl?: string;
  oauthRedirectUri?: string;
  oauthChatUrl?: string;
  remux?: (dir: string) => Promise<RemuxStatus>;
  transcode?: TranscodeEngine;
  transcodeRun?: RemuxRunner;
  authToken?: string;
  role?: 'media' | 'crawl';
  crawlUrl?: string;
  mediaUrl?: string;
}

export async function registerApiRoutes(
  fastify: FastifyInstance,
  supplied: RouteDependencies = {},
): Promise<void> {
  const role = supplied.role === 'crawl' ? 'crawl' : 'media';
  const crawlUrl = supplied.crawlUrl ?? process.env.OPENPLEX_CRAWL_URL;
  const mediaUrl = supplied.mediaUrl ?? process.env.OPENPLEX_MEDIA_URL;
  const store = supplied.store ?? defaultStore;
  const now = supplied.now ?? Date.now;
  const mediaRoot = supplied.mediaRoot
    ?? process.env.OPENPLEX_MEDIA_PATH
    ?? '.data/media';
  const localMedia = supplied.localMedia
    ?? (store instanceof SQLiteStore ? new LocalMediaStore(store.db) : undefined);
  const library = store instanceof SQLiteStore ? new LibraryStore(store.db) : undefined;
  const transcode = supplied.transcode ?? new TranscodeEngine({
    root: path.join(mediaRoot, '..', 'transcode'),
    run: supplied.transcodeRun,
  });

  const client = role === 'crawl' ? supplied.client : undefined;
  const gateway = supplied.gateway ?? (role === 'crawl' ? new HlsGateway() : undefined);
  const homeParser = role === 'crawl' ? supplied.homeParser : undefined;
  const categoryParser = role === 'crawl' ? supplied.categoryParser : undefined;
  const searchParser = role === 'crawl' ? supplied.searchParser : undefined;
  const titleParser = role === 'crawl' ? supplied.titleParser : undefined;
  const episodeParser = role === 'crawl' ? supplied.episodeParser : undefined;
  const episodeApi = supplied.episodeApi;
  const tvwiki = supplied.tvwiki;
  const remux = supplied.remux
    ?? (process.env.NODE_ENV === 'test'
      ? async () => REMUX_STATUS.missing
      : undefined);
  const downloader = supplied.downloader ?? (role === 'crawl' && localMedia && episodeApi
    ? new DownloadQueue({
        store: localMedia,
        episodeApi,
        mediaRoot,
        fetchImpl: supplied.fetchImpl,
        now,
        remux,
        library,
        onComplete: mediaUrl
          ? async (item) => {
              if (!item.file_path) return;
              await notifyMediaIngest({
                mediaUrl,
                token: supplied.authToken,
                fetchImpl: supplied.fetchImpl,
                asset: {
                  adapter: 'tvwiki',
                  category: item.category,
                  id: item.id,
                  epIdx: item.epIdx,
                  title: item.title,
                  thumb: item.thumb,
                  filePath: item.file_path,
                  sizeBytes: item.size_bytes,
                },
              });
            }
          : undefined,
      })
    : undefined);
  if (downloader) {
    downloader.resumeInterrupted();
    fastify.addHook('onClose', async () => {
      downloader.stop();
    });
  }
  if (localMedia) {
    registerDownloadRoutes(fastify, {
      store: localMedia,
      downloader,
      mediaRoot,
      library,
      tvwiki,
      crawlUrl,
      fetchImpl: supplied.fetchImpl,
      authToken: supplied.authToken,
    });
  }
  const localAdapter = library ? new LocalAdapter({ library, now }) : undefined;
  const resolvedProfileIds = new WeakMap<FastifyRequest, number>();
  const requestProfileId: (request: FastifyRequest) => number = (request) => {
    const profileId = resolvedProfileIds.get(request);
    if (profileId === undefined) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Profile was not resolved');
    }
    return profileId;
  };
  if (library) {
    registerLibraryRoutes(fastify, {
      library,
      localAdapter,
      localMedia,
      mediaRoot,
      now,
      fetchImpl: supplied.fetchImpl,
      role,
      env: process.env,
      crawlUrl,
      resolveProfileId: requestProfileId,
    });
    registerLibraryStreamRoutes(fastify, { library, mediaRoot });
    if (localMedia) {
      registerSettingsRoutes(fastify, {
      localMedia,
      library,
      kmdbApiKey: () => process.env.KMDB_API_KEY,
    });
    }
    registerIngestRoutes(fastify, { library, localMedia, now });
    registerTranscodeRoutes(fastify, {
      engine: transcode,
      library,
      localMedia,
      mediaRoot,
    });
    const oauthClientId = supplied.oauthClientId ?? process.env.OPENPLEX_GPT_OAUTH_CLIENT_ID;
    const oauthSession = oauthClientId
      ? new GptOauthSession({
          store: new FileGptOauthStore(
            supplied.oauthStorePath
              ?? process.env.OPENPLEX_GPT_OAUTH_PATH
              ?? '.data/gpt-oauth.json',
          ),
          clientId: oauthClientId,
          authorizeUrl: supplied.oauthAuthorizeUrl
            ?? process.env.OPENPLEX_GPT_OAUTH_AUTHORIZE_URL
            ?? 'https://auth.openai.com/oauth/authorize',
          tokenUrl: supplied.oauthTokenUrl
            ?? process.env.OPENPLEX_GPT_OAUTH_TOKEN_URL
            ?? 'https://auth.openai.com/oauth/token',
          redirectUri: supplied.oauthRedirectUri
            ?? process.env.OPENPLEX_GPT_OAUTH_REDIRECT
            ?? 'http://127.0.0.1:33888/api/agent/oauth/callback',
          chatUrl: supplied.oauthChatUrl
            ?? process.env.OPENPLEX_GPT_CHAT_URL
            ?? 'https://api.openai.com/v1/chat/completions',
          fetchImpl: supplied.fetchImpl,
        })
      : undefined;
    registerOauthRoutes(fastify, { session: oauthSession });
    registerAgentRoutes(fastify, {
      library,
      chat: supplied.agentChat,
      resolveChat: supplied.agentChat
        ? undefined
        : () => resolveAgentChat({
            provider: supplied.agentProvider ?? parseAgentProvider(process.env.OPENPLEX_AGENT_PROVIDER),
            oauth: oauthSession,
            deepseekKey: process.env.DEEPSEEK_API_KEY,
            fetchImpl: supplied.fetchImpl,
          }),
      tvwiki,
      downloader,
      localAdapter,
      now,
      crawlUrl,
      fetchImpl: supplied.fetchImpl,
      authToken: supplied.authToken,
      scanMetadata: async (workId, force) => {
        const work = library.getWork(workId);
        if (!work) return { error: `Work ${workId} was not found` };
        if (localMedia?.isMetaLocked(workId) && !force) {
          return { workId, skipped: 'user_locked' };
        }
        const providers = buildProviderChain({
          role,
          settings: localMedia ? localMedia.getMetadataProviders() : ['tmdb'],
          env: process.env,
          crawlUrl,
          fetchImpl: supplied.fetchImpl,
        });
        return scanWork(library, work, { providers, force });
      },
      setLibraryPath: async (libraryId, libraryPath) => {
        if (!library.taxonomy.getLibrary(libraryId)) {
          return { error: `Library ${libraryId} was not found` };
        }
        try {
          library.taxonomy.setLibraryPath(libraryId, libraryPath);
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'Library path update failed' };
        }
        return { library: library.taxonomy.getLibrary(libraryId) };
      },
      setMetadataLocalMedia: localMedia,
      scanLibrary: async () => runLibraryScan({
        library,
        localAdapter,
        localMedia,
        role,
        env: process.env,
        crawlUrl,
        fetchImpl: supplied.fetchImpl,
      }),
      transcodeUnit: async (unitId, profile) => {
        if (!isTranscodeProfile(profile)) return { error: `Unknown profile: ${profile}` };
        const input = resolveInput(library, localMedia, mediaRoot, { unitId });
        if (!input) return { error: 'Local media file was not found' };
        return transcode.start(input, profile);
      },
      ingestUrl: async (url) => {
        if (!localAdapter || !localMedia) return { error: 'URL ingest is not configured' };
        return ingestFromUrl({
          url,
          library,
          localMedia,
          localAdapter,
          mediaRoot,
          now: now(),
          fetchImpl: supplied.fetchImpl,
        });
      },
    });
    if (role === 'media') {
      registerJellyfinRoutes(fastify, {
        library,
        mediaRoot,
        authToken: supplied.authToken,
      });
    }
  }
  const createSession = gateway
    ? gateway.createSession.bind(gateway)
    : undefined;
  fastify.addHook('preHandler', async (request) => {
    if (!request.url.split('?')[0].startsWith('/api/')) return;

    if (request[OPENPLEX_VISITOR] === true) {
      if (store instanceof SQLiteStore && localMedia) {
        resolvedProfileIds.set(request, ensureGuestProfile(store, localMedia));
        return;
      }
      throw new ApiError(500, 'INTERNAL_ERROR', 'Guest profile is not available');
    }

    const rawProfileId = request.headers['x-profile-id'];
    const profileId = rawProfileId === undefined ? 1 : parseProfileIdHeader(rawProfileId);
    if (profileId === null || !store.profileExists(profileId)) {
      throw new ApiError(400, 'PROFILE_INVALID', 'X-Profile-Id must identify an existing profile');
    }

    // Profiles are UX namespaces, not security principals. Selecting an ID is not authentication.
    resolvedProfileIds.set(request, profileId);
  });

  // Production token rotation: resolve a fresh hls_url from get_episode.php
  // whenever the gateway detects upstream 401/403 or the 45s TTL elapsed.
  const gatewayWithRefresh = gateway;
  if (gatewayWithRefresh && episodeApi && typeof gatewayWithRefresh.setRefreshHandler === 'function') {
    gatewayWithRefresh.setRefreshHandler(async (session) => {
      const ref = session.episode;
      if (!ref) return;
      const stream = await episodeApi.getEpisode({
        category: ref.category,
        wrId: ref.wrId,
        epIdx: ref.epIdx,
      });
      if (!stream.hlsUrl || !client) return;
      return {
        playlistUrl: resolveHttpUrl(stream.hlsUrl, client.baseUrl, 'HLS playlist'),
      };
    });
  }

  if (role === 'crawl') {
    fastify.post(
      '/api/metadata/lookup',
      {
        schema: {
          body: {
            type: 'object',
            required: ['title', 'kind'],
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 300 },
              kind: { type: 'string', enum: ['movie', 'tv'] },
              providers: {
                type: 'array',
                items: { type: 'string', enum: ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'] },
              },
            },
          },
        },
      },
      async (request) => {
        const body = request.body as {
          title: string;
          kind: 'movie' | 'tv';
          providers?: string[];
        };
        const providers = buildProviderChain({
          role: 'crawl',
          settings: body.providers ?? ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'],
          env: process.env,
          fetchImpl: supplied.fetchImpl,
        });
        for (const provider of providers) {
          const lookup = await provider.search(body.title, body.kind);
          // Returns the first definitive answer; never creates works/units/assets.
          if (lookup.status === 'hit' || lookup.status === 'blocked') return lookup;
        }
        return { status: 'no_match' };
      },
    );
  }

  fastify.get('/api/profiles', async () => ({ items: store.listProfiles() }));

  fastify.post(
    '/api/profiles',
    { schema: { body: createProfileBodySchema } },
    async (request, reply) => {
      const { name, color = null } = request.body as { name: string; color?: string | null };
      try {
        const profile = store.createProfile(name, color);
        return reply.code(201).send({ profile });
      } catch (error) {
        throw profileMutationError(error, 'PROFILE_CREATE_FAILED');
      }
    },
  );

  fastify.patch(
    '/api/profiles/:id',
    { schema: { params: profileParamsSchema, body: renameProfileBodySchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      requireProfile(store, id);
      try {
        return { profile: store.renameProfile(id, (request.body as { name: string }).name) };
      } catch (error) {
        throw profileMutationError(error, 'PROFILE_RENAME_FAILED');
      }
    },
  );

  fastify.delete(
    '/api/profiles/:id',
    { schema: { params: profileParamsSchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      if (id === 1) {
        throw new ApiError(409, 'PROFILE_DELETE_CONFLICT', 'The default profile cannot be deleted');
      }
      requireProfile(store, id);
      if (store.listProfiles().length <= 1) {
        throw new ApiError(409, 'PROFILE_DELETE_CONFLICT', 'The last profile cannot be deleted');
      }
      try {
        store.deleteProfile(id);
      } catch (error) {
        throw new ApiError(409, 'PROFILE_DELETE_CONFLICT', errorMessage(error));
      }
      return { success: true };
    },
  );

  fastify.get(
    '/api/profiles/:id/subtitle-style',
    { schema: { params: profileParamsSchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      requireProfile(store, id);
      const stored = store.getSubtitleStyle(id);
      return { style: stored === null ? null : normalizedSubtitleStyle(JSON.parse(stored) as unknown) };
    },
  );

  fastify.put(
    '/api/profiles/:id/subtitle-style',
    { schema: { params: profileParamsSchema, body: subtitleStyleBodySchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      requireProfile(store, id);
      const { style } = request.body as { style: Record<string, unknown> | null };
      const normalized = style === null ? null : normalizedSubtitleStyle(style);
      store.setSubtitleStyle(id, normalized === null ? null : JSON.stringify(normalized));
      return { style: normalized };
    },
  );

  fastify.get(
    '/api/profiles/:id/stats',
    { schema: { params: profileParamsSchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      requireProfile(store, id);
      return store.getStats(id, now());
    },
  );

  fastify.get('/api/status', async () => ({
    role,
    crawl: crawlUrl ? { url: crawlUrl } : null,
    proxyConfigured: proxyConfigured(),
  }));

  if (role === 'media') {
    fastify.get('/api/home', async (request, reply) => {
      if (request[OPENPLEX_VISITOR] === true) {
        if (!library) return { sections: [], continueWatching: [], nextUp: [] };
        return libraryHomePayload(library, store, requestProfileId(request), { visitor: true });
      }
      if (crawlUrl) {
        await proxyToCrawl(request, reply, {
          crawlUrl,
          token: supplied.authToken,
          fetchImpl: supplied.fetchImpl,
        });
        return;
      }
      if (!library) return { sections: [], continueWatching: [], nextUp: [] };
      return libraryHomePayload(library, store, requestProfileId(request));
    });
    for (const path of ['/api/category/*', '/api/search', '/api/title/*'] as const) {
      fastify.all(path, async (request, reply) => {
        if (!crawlUrl) {
          throw new ApiError(503, 'CRAWL_UNAVAILABLE', 'Crawl server is not configured');
        }
        await proxyToCrawl(request, reply, {
          crawlUrl,
          token: supplied.authToken,
          fetchImpl: supplied.fetchImpl,
        });
      });
    }
    for (const path of [
      '/hls/:sessionId/playlist.m3u8',
      '/hls/:sessionId/master.m3u8',
      '/hls/:sessionId/resource/:id',
      '/hls/:sessionId/subtitle/:id',
    ] as const) {
      fastify.get(path, async (request, reply) => {
        if (!crawlUrl) throw new ApiError(404, 'NOT_FOUND', 'Route not found');
        await proxyToCrawl(request, reply, {
          crawlUrl,
          token: supplied.authToken,
          fetchImpl: supplied.fetchImpl,
        });
      });
    }
  }

  if (role === 'crawl' && client && homeParser) {
  fastify.get('/api/home', async (request) => {
    const profileId = requestProfileId(request);
    const parsedSections = homeParser.parse(await client.getText('/'));
    const sections = mergeSectionWatchState(
      parsedSections,
      store.getWatchStateMap(profileId, parsedSections.flatMap((section) => section.items)),
    );
    const continueWatching = store
      .getHistory(profileId)
      // Keep in sync with client/src/utils/canResume.ts; validation is repeated at the API boundary.
      .filter((item) => isFinite(item.position_sec)
        && isFinite(item.duration_sec)
        && item.duration_sec > 0
        && item.position_sec > 10
        && item.position_sec < item.duration_sec
        && item.position_sec / item.duration_sec < 0.9);
    const nextUp = store.getNextUpCandidates(profileId, 20);
    return { sections, continueWatching, nextUp };
  });
  }

  if (role === 'crawl' && client && categoryParser && searchParser && titleParser) {
  fastify.get(
    '/api/category/:cat',
    {
      schema: {
        params: categoryParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { page: { type: 'integer', minimum: 1, default: 1 } },
        },
      },
    },
    async (request) => {
      const { cat } = request.params as { cat: string };
      const { page = 1 } = request.query as { page?: number };
      const path = page === 1 ? `/${cat}` : `/${cat}/p${page}`;
      const parsed = categoryParser.parse(await client.getText(path), {
        categoryPath: cat,
        page,
      });
      const watchState = store.getWatchStateMap(requestProfileId(request), parsed.items);
      return { ...parsed, items: mergeItemWatchState(parsed.items, watchState) };
    },
  );

  fastify.get(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          additionalProperties: false,
          properties: { q: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request) => {
      const q = (request.query as { q: string }).q.trim();
      if (!q) throw new ApiError(400, 'VALIDATION_ERROR', 'q must not be blank');
      const parsed = searchParser.parse(
        await client.getText('/bbs/search.php', {
          query: { sfl: 'wr_subject', sop: 'and', stx: q },
        }),
      );
      const watchState = store.getWatchStateMap(requestProfileId(request), parsed.items);
      return {
        ...parsed,
        items: mergeItemWatchState(parsed.items, watchState),
        total: parsed.items.length,
      };
    },
  );

  fastify.get(
    '/api/title/:cat/:id',
    { schema: { params: titleParamsSchema } },
    async (request) => {
      const { cat, id } = request.params as { cat: string; id: number };
      const parsed = titleParser.parse(await client.getText(`/${cat}/${id}`), {
        category: cat,
        wrId: id,
      });
      store.upsertEpisodeCatalog(parsed.episodes.map((episode, ordinal) => ({
        category: cat,
        id,
        epIdx: episode.epIdx,
        ordinal,
        title: episode.title,
        thumb: episode.thumbUrl ?? '',
      })));
      if (tvwiki) {
        try {
          tvwiki.importParsed({
            adapter: 'tvwiki',
            externalId: `${cat}/${id}`,
            title: parsed.title,
            kind: cat === 'movie' ? 'movie' : 'video_series',
            overview: null,
            poster: parsed.episodes[0]?.thumbUrl ?? null,
            units: parsed.episodes.map((episode, ordinal) => ({
              externalId: `${cat}/${id}/${episode.epIdx}`,
              title: episode.title,
              ordinal,
              thumb: episode.thumbUrl ?? null,
            })),
          });
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          request.log.warn({ err: error }, 'library import skipped');
        }
      }
      return parsed;
    },
  );
  }

  fastify.post(
    '/api/stream/:cat/:id/:epIdx',
    {
      schema: {
        params: streamParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            profile: { type: 'string', enum: ['original', '1080p', '720p', '480p'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { cat, id, epIdx } = request.params as {
        cat: string;
        id: number;
        epIdx: number;
      };
      const { profile } = request.query as { profile?: string };
      if (localMedia) {
        const local = localStreamPayload(localMedia, mediaRoot, {
          category: cat,
          id,
          epIdx,
        }, now());
        if (local) {
          if (profile && isTranscodeProfile(profile) && profile !== 'original' && library) {
            const input = resolveInput(library, localMedia, mediaRoot, { category: cat, id, epIdx });
            if (input) {
              const job = await transcode.start(input, profile);
              if (job.status === 'unavailable') {
                throw new ApiError(503, 'TRANSCODE_UNAVAILABLE', 'ffmpeg is not available');
              }
              if (job.status === 'completed' || job.status === 'ready') {
                return { ...local, transcodeUrl: `/transcode/${job.id}/index.m3u8` };
              }
            }
          }
          return local;
        }
      }

      if (role === 'media') {
        if (crawlUrl) {
          await proxyToCrawl(request, reply, {
            crawlUrl,
            token: supplied.authToken,
            fetchImpl: supplied.fetchImpl,
          });
          return;
        }
        throw new ApiError(404, 'STREAM_NOT_FOUND', 'Episode stream was not found');
      }

      if (!client || !episodeParser || !episodeApi || !createSession) {
        throw new ApiError(503, 'CRAWL_UNAVAILABLE', 'Crawl catalog is not configured');
      }

      const pagePath = `/${cat}/${id}/${epIdx}`;
      const page = episodeParser.parse(await client.getText(pagePath), {
        category: cat,
        wrId: id,
      });
      assertEpisodeMatches(page, epIdx);
      const stream = await episodeApi.getEpisode({ category: cat, wrId: id, epIdx });
      if (!stream.hlsUrl) {
        throw new ApiError(404, 'STREAM_NOT_FOUND', 'Episode stream was not found');
      }

      const subtitleInputs = subtitleDescriptions(stream, client.baseUrl);
      const session = createSession({
        playlistUrl: resolveHttpUrl(stream.hlsUrl, client.baseUrl, 'HLS playlist'),
        profileId: requestProfileId(request),
        episode: { category: cat, wrId: id, epIdx },
        subtitles: subtitleInputs,
      });
      const title = stream.title || page.title || '';
      if (downloader) {
        downloader.enqueue({
          category: cat,
          id,
          epIdx,
          title,
          thumb: stream.thumb ?? '',
        });
      }

      return {
        sessionId: session.sessionId,
        source: 'live',
        playlistUrl: `/hls/${session.sessionId}/playlist.m3u8`,
        subtitles: sessionSubtitles(session, subtitleInputs),
        title,
        nextEpisode: stream.nextEpisode,
      };
    },
  );

  fastify.get('/api/history', async (request) => ({
    items: store.getHistory(requestProfileId(request)),
  }));

  fastify.post(
    '/api/history',
    { schema: { body: historyBodySchema } },
    async (request) => {
      const item = request.body as WatchHistoryItem & { sessionId?: string };
      let profileId = requestProfileId(request);
      if (item.sessionId && gateway && 'sessions' in gateway && gateway.sessions) {
        const liveSession = gateway.sessions.get(item.sessionId);
        if (liveSession?.profileId !== undefined && store.profileExists(liveSession.profileId)) {
          profileId = liveSession.profileId;
        }
      }
      const historyItem = { ...item };
      delete historyItem.sessionId;
      store.upsertHistory(profileId, historyItem);
      if (library) {
        const binding = library.binding(
          'tvwiki',
          `${historyItem.category}/${historyItem.id}/${historyItem.epIdx}`,
        );
        if (binding?.unit_id) {
          library.setProgress(profileId, binding.unit_id, {
            position: historyItem.position_sec,
            duration: historyItem.duration_sec,
          }, now());
        }
      }
      if (downloader && localMedia) {
        prefetchNextEpisode(localMedia, downloader, historyItem);
      } else if (role === 'media' && crawlUrl && localMedia) {
        const next = localMedia.nextCatalogEpisode(
          historyItem.category,
          historyItem.id,
          historyItem.epIdx,
        );
        if (
          next
          && historyItem.duration_sec > 0
          && historyItem.position_sec / historyItem.duration_sec >= 0.5
        ) {
          const fetchImpl = supplied.fetchImpl ?? globalThis.fetch;
          const headers: Record<string, string> = { 'content-type': 'application/json' };
          if (supplied.authToken) headers.authorization = `Bearer ${supplied.authToken}`;
          void fetchImpl(`${crawlUrl.replace(/\/$/, '')}/api/downloads`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              category: historyItem.category,
              id: historyItem.id,
              epIdx: next.epIdx,
              title: next.title,
              thumb: next.thumb,
            }),
          });
        }
      }
      return { success: true };
    },
  );

  fastify.get('/api/bookmarks', async (request) => ({
    items: store.getBookmarks(requestProfileId(request)),
  }));

  fastify.post(
    '/api/bookmarks',
    { schema: { body: bookmarkBodySchema } },
    async (request) => {
      store.addBookmark(requestProfileId(request), request.body as BookmarkItem);
      return { success: true };
    },
  );

  fastify.delete(
    '/api/bookmarks/:cat/:id',
    { schema: { params: titleParamsSchema } },
    async (request) => {
      const { cat, id } = request.params as { cat: string; id: number };
      const profileId = requestProfileId(request);
      if (!store.isBookmarked(profileId, cat, id)) {
        throw new ApiError(404, 'BOOKMARK_NOT_FOUND', 'Bookmark was not found');
      }
      store.deleteBookmark(profileId, cat, id);
      return { success: true };
    },
  );
}

function parseProfileIdHeader(value: string | string[]): number | null {
  if (Array.isArray(value) || !/^[1-9]\d*$/.test(value)) return null;
  const profileId = Number(value);
  return Number.isSafeInteger(profileId) ? profileId : null;
}

function requireProfile(store: StoreLike, id: number): void {
  if (!store.profileExists(id)) {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', `Profile ${id} was not found`);
  }
}

function profileMutationError(error: unknown, code: string): ApiError {
  const message = errorMessage(error);
  const statusCode = /UNIQUE constraint failed/i.test(message) ? 409 : 400;
  return new ApiError(statusCode, code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Profile operation failed';
}

function watchStateKey(item: WatchStateItem): string | null {
  const id = item.id ?? item.wrId;
  return typeof id === 'number' ? `${item.category}:${id}` : null;
}

function mergeItemWatchState<T extends WatchStateItem>(
  items: readonly T[],
  watchState: ReadonlyMap<string, WatchState>,
): Array<T & { watchState: WatchState }> {
  return items.map((item) => {
    const key = watchStateKey(item);
    return {
      ...item,
      watchState: key === null
        ? { watched: false, progress: 0, unwatchedCount: null }
        : watchState.get(key) ?? { watched: false, progress: 0, unwatchedCount: null },
    };
  });
}

function mergeSectionWatchState<
  T extends WatchStateItem,
  S extends { items: T[] },
>(
  sections: readonly S[],
  watchState: ReadonlyMap<string, WatchState>,
): Array<Omit<S, 'items'> & { items: Array<T & { watchState: WatchState }> }> {
  return sections.map((section) => ({
    ...section,
    items: mergeItemWatchState(section.items, watchState),
  }));
}

export function installApiErrorHandlers(
  fastify: FastifyInstance,
  serveSpa = false,
): void {
  fastify.setNotFoundHandler((request, reply) => {
    if (serveSpa && request.method === 'GET' && acceptsHtml(request)) {
      void reply.sendFile('index.html');
      return;
    }
    sendError(reply, 404, 'NOT_FOUND', 'Route not found');
  });

  fastify.setErrorHandler((error, _request, reply) => {
    if ('validation' in error && error.validation) {
      sendError(reply, 400, 'VALIDATION_ERROR', error.message);
      return;
    }
    if (error instanceof ApiError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return;
    }
    if (error instanceof Error) {
      const name = error.name;
      if (name === 'TvwikiHttpException' && 'statusCode' in error) {
        const status = (error as { statusCode: number }).statusCode === 404 ? 404 : 502;
        sendError(
          reply,
          status,
          status === 404 ? 'UPSTREAM_NOT_FOUND' : 'UPSTREAM_ERROR',
          status === 404 ? 'Upstream resource was not found' : 'Upstream request failed',
        );
        return;
      }
      if (name === 'TvwikiBlockedException') {
        sendError(reply, 502, 'UPSTREAM_BLOCKED', 'Upstream request was blocked');
        return;
      }
      if (name === 'TvwikiNetworkException') {
        sendError(reply, 502, 'UPSTREAM_UNAVAILABLE', 'Upstream service is unavailable');
        return;
      }
    }
    fastify.log.error(error);
    sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
  });
}

function acceptsHtml(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0];
  return !path.startsWith('/api/') &&
    !path.startsWith('/hls/') &&
    !path.startsWith('/media/') &&
    request.headers.accept?.includes('text/html') === true;
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): void {
  void reply.code(statusCode).send({ error: { message, code } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function jsonString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
}

function normalizeNextEpisode(next: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!next) return null;
  return {
    idx: integer(next.idx) ?? 0,
    title: stringValue(next.title),
    hlsUrl: stringValue(next.hls_url),
    srt: stringValue(next.srt),
    vtt: stringValue(next.vtt),
    thumb: stringValue(next.thumb),
    pageUrl: stringValue(next.page_url),
  };
}

function assertEpisodeMatches(page: { epIdx: number | null }, requestedIndex: number): void {
  if (page.epIdx !== null && page.epIdx !== requestedIndex) {
    throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode page did not match the request');
  }
}

interface SubtitleDescription {
  id: string;
  url: string;
  contentType: string;
  format: 'vtt' | 'srt';
}

function subtitleDescriptions(stream: EpisodeStreamData, baseUrl: string): SubtitleDescription[] {
  const descriptions: SubtitleDescription[] = [];
  if (stream.vtt) {
    descriptions.push({
      id: 'vtt',
      url: resolveHttpUrl(stream.vtt, baseUrl, 'subtitle'),
      contentType: 'text/vtt',
      format: 'vtt',
    });
  }
  if (stream.srt) {
    descriptions.push({
      id: 'srt',
      url: resolveHttpUrl(stream.srt, baseUrl, 'subtitle'),
      contentType: 'application/x-subrip',
      format: 'srt',
    });
  }
  return descriptions;
}

function resolveHttpUrl(value: string, baseUrl: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new ApiError(502, 'INVALID_UPSTREAM_RESPONSE', `${label} URL was invalid`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(502, 'INVALID_UPSTREAM_RESPONSE', `${label} URL was invalid`);
  }
  return url.toString();
}

function sessionSubtitles(
  session: HlsSession,
  descriptions: readonly SubtitleDescription[],
): Array<{
  id: string;
  language: string;
  label: string;
  url: string;
  format: 'vtt' | 'srt';
}> {
  const result = [];
  const seen = new Set<string>();
  for (const description of descriptions) {
    const resource = [...session.resources.values()].find(
      (candidate) => candidate.kind === 'subtitle' && candidate.url.toString() === description.url,
    );
    if (!resource || seen.has(resource.id)) continue;
    seen.add(resource.id);
    result.push({
      id: resource.id,
      language: 'ko',
      label: 'Korean',
      url: `/hls/${session.sessionId}/subtitle/${resource.id}`,
      format: description.format,
    });
  }
  return result;
}
