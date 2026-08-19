import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { convertSubtitleToWebVtt } from './subtitle-converter.js';

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_RESOURCE_TTL_MS = 2 * 60 * 1_000;
const DEFAULT_SEGMENT_CACHE_SIZE = 20;
const TOKEN_REFRESH_MS = 45 * 1_000;
const PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DEFAULT_REFERER = 'https://player.bunny-frame.online/';

export const HLS_UPSTREAM_HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  Referer: DEFAULT_REFERER,
  Origin: 'https://player.bunny-frame.online',
  Accept: '*/*',
} as const;

export type HlsResourceKind = 'playlist' | 'segment' | 'key' | 'subtitle';

export interface HlsSessionResource {
  readonly id: string;
  url: URL;
  readonly kind: HlsResourceKind;
  contentType?: string;
}

export interface HlsSession {
  readonly sessionId: string;
  readonly createdAt: number;
  expiresAt: number;
  playlistUrl: URL;
  readonly profileId?: number;
  readonly episode?: HlsEpisodeRef;
  readonly resources: Map<string, HlsSessionResource>;
  lastTokenRefreshAt: number;
  privateState: {
    nextResourceNumber: number;
    resourceIdsByIdentity: Map<string, string>;
    refreshPromise?: Promise<void>;
  };
}

export interface HlsEpisodeRef {
  category: string;
  wrId: number;
  epIdx: number;
}

export interface CreateHlsSessionOptions {
  playlistUrl: string | URL;
  profileId?: number;
  episode?: HlsEpisodeRef;
  subtitles?: readonly (string | URL | {
    id?: string;
    url: string | URL;
    contentType?: string;
  })[];
  ttlMs?: number;
}

export type HlsTokenRefreshResult =
  | void
  | string
  | URL
  | {
      playlistUrl?: string | URL;
      resources?: ReadonlyMap<string, string | URL> | Record<string, string | URL>;
    };

export interface HlsGatewayOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sessionTtlMs?: number;
  segmentCacheSize?: number;
  segmentCacheTtlMs?: number;
  tokenRefreshMs?: number;
  refreshSession?: (session: HlsSession) => Promise<HlsTokenRefreshResult>;
  keyDecoder?: { decode(json: string): Buffer | null };
  upstreamHeaders?: HeadersInit;
}

interface CacheEntry {
  body: Buffer;
  contentType?: string;
  expiresAt: number;
}

interface GatewayParams {
  sessionId: string;
  id?: string;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function validHttpUrl(value: string | URL, name: string): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${name} must use http or https`);
  }
  return url;
}

function resourceIdentity(kind: HlsResourceKind, url: URL): string {
  return `${kind}:${url.toString()}`;
}

function hashResourceIdentity(identity: string): string {
  return createHash('sha256').update(identity).digest('base64url').slice(0, 20);
}

function isPlaylistUrl(url: URL): boolean {
  return /\.m3u8$/i.test(url.pathname);
}

function isSubtitleUrl(url: URL): boolean {
  return /\.(?:srt|vtt)$/i.test(url.pathname);
}

function looksLikeEncryptedKey(url: URL, contentType: string | null, body: Buffer): boolean {
  if (/level[_-]?7/i.test(url.pathname) || /level[_-]?7/i.test(url.search)) return true;
  if (contentType?.toLowerCase().includes('json')) return true;
  const first = body.toString('utf8', 0, Math.min(body.length, 64)).trimStart()[0];
  return first === '{';
}

function upstreamError(reply: FastifyReply, response: Response): FastifyReply {
  return reply.code(502).send({ error: `Upstream returned ${response.status}` });
}

export class HlsSessionManager {
  private readonly sessions = new Map<string, HlsSession>();
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

  constructor(options: Pick<HlsGatewayOptions, 'now' | 'sessionTtlMs'> = {}) {
    this.now = options.now ?? Date.now;
    this.defaultTtlMs = positiveInteger(
      options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
      'sessionTtlMs',
    );
  }

  create(options: CreateHlsSessionOptions): HlsSession {
    const createdAt = this.now();
    const ttlMs = positiveInteger(options.ttlMs ?? this.defaultTtlMs, 'ttlMs');
    const session: HlsSession = {
      sessionId: randomUUID(),
      createdAt,
      expiresAt: createdAt + ttlMs,
      playlistUrl: validHttpUrl(options.playlistUrl, 'playlistUrl'),
      profileId: options.profileId,
      episode: options.episode,
      resources: new Map(),
      lastTokenRefreshAt: createdAt,
      privateState: {
        nextResourceNumber: 0,
        resourceIdsByIdentity: new Map(),
      },
    };

    for (const subtitle of options.subtitles ?? []) {
      const description = typeof subtitle === 'string' || subtitle instanceof URL
        ? { url: subtitle }
        : subtitle;
      this.registerResource(
        session,
        validHttpUrl(description.url, 'subtitle URL'),
        'subtitle',
        description.id,
        description.contentType,
      );
    }

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): HlsSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  registerResource(
    session: HlsSession,
    url: URL,
    kind: HlsResourceKind,
    requestedId?: string,
    contentType?: string,
  ): HlsSessionResource {
    const identity = resourceIdentity(kind, url);
    const existingId = session.privateState.resourceIdsByIdentity.get(identity);
    if (existingId) return session.resources.get(existingId)!;

    let id = requestedId?.trim();
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || session.resources.has(id)) {
      id = hashResourceIdentity(identity);
      while (session.resources.has(id)) {
        id = `${hashResourceIdentity(identity)}-${session.privateState.nextResourceNumber++}`;
      }
    }

    const resource: HlsSessionResource = { id, url, kind, contentType };
    session.resources.set(id, resource);
    session.privateState.resourceIdsByIdentity.set(identity, id);
    return resource;
  }
}

export class HlsGateway {
  readonly sessions: HlsSessionManager;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly segmentCacheSize: number;
  private readonly segmentCacheTtlMs: number;
  private readonly tokenRefreshMs: number;
  private readonly refreshSession?: HlsGatewayOptions['refreshSession'];
  private refreshHandler?: HlsGatewayOptions['refreshSession'];
  private readonly decoder: { decode(json: string): Buffer | null } | null;
  private readonly upstreamHeaders: Headers;
  private readonly segmentCache = new Map<string, CacheEntry>();
  private readonly inflightSegments = new Map<string, Promise<CacheEntry | null>>();

  constructor(options: HlsGatewayOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sessions = new HlsSessionManager(options);
    this.segmentCacheSize = positiveInteger(
      options.segmentCacheSize ?? DEFAULT_SEGMENT_CACHE_SIZE,
      'segmentCacheSize',
    );
    this.segmentCacheTtlMs = positiveInteger(
      options.segmentCacheTtlMs ?? DEFAULT_RESOURCE_TTL_MS,
      'segmentCacheTtlMs',
    );
    this.tokenRefreshMs = positiveInteger(
      options.tokenRefreshMs ?? TOKEN_REFRESH_MS,
      'tokenRefreshMs',
    );
    this.refreshSession = options.refreshSession;
    this.decoder = options.keyDecoder ?? null;
    this.upstreamHeaders = new Headers(options.upstreamHeaders);
    if (!this.upstreamHeaders.has('User-Agent')) {
      this.upstreamHeaders.set('User-Agent', DEFAULT_USER_AGENT);
    }
    if (!this.upstreamHeaders.has('Referer')) {
      this.upstreamHeaders.set('Referer', DEFAULT_REFERER);
    }
    if (!this.upstreamHeaders.has('Accept')) this.upstreamHeaders.set('Accept', '*/*');
  }

  createSession(options: CreateHlsSessionOptions | string | URL): HlsSession {
    return this.sessions.create(
      typeof options === 'string' || options instanceof URL
        ? { playlistUrl: options }
        : options,
    );
  }

  /** Registers a production token-refresh resolver (episode -> fresh hls_url). */
  setRefreshHandler(handler: HlsGatewayOptions['refreshSession']): void {
    this.refreshHandler = handler;
  }

  async register(fastify: FastifyInstance): Promise<void> {
    const playlistHandler = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const params = request.params as GatewayParams;
      return this.handlePlaylist(params.sessionId, reply);
    };

    fastify.get('/hls/:sessionId/playlist.m3u8', playlistHandler);
    // Keep compatibility with the player shell while retaining one gateway path.
    fastify.get('/hls/:sessionId/master.m3u8', playlistHandler);

    fastify.get('/hls/:sessionId/resource/:id', async (request, reply) => {
      const params = request.params as GatewayParams;
      return this.handleResource(params.sessionId, params.id ?? '', reply);
    });

    fastify.get('/hls/:sessionId/subtitle/:id', async (request, reply) => {
      const params = request.params as GatewayParams;
      return this.handleSubtitle(params.sessionId, params.id ?? '', reply);
    });
  }

  private sessionOr404(sessionId: string, reply: FastifyReply): HlsSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) reply.code(404).send({ error: 'HLS session not found or expired' });
    return session;
  }

  private async handlePlaylist(sessionId: string, reply: FastifyReply): Promise<FastifyReply> {
    const session = this.sessionOr404(sessionId, reply);
    if (!session) return reply;

    try {
      await this.refreshIfNeeded(session);
      let response = await this.fetchUpstream(session.playlistUrl);
      if ((response.status === 401 || response.status === 403)) {
        // Upstream token likely rotated: force a refresh and retry once.
        await this.refreshIfNeeded(session, true);
        response = await this.fetchUpstream(session.playlistUrl);
      }
      if (!response.ok) return upstreamError(reply, response);
      const rewritten = this.rewritePlaylist(await response.text(), session.playlistUrl, session);
      return reply.type(PLAYLIST_CONTENT_TYPE).send(rewritten);
    } catch {
      return reply.code(502).send({ error: 'Unable to load upstream playlist' });
    }
  }

  private rewritePlaylist(text: string, sourceUrl: URL, session: HlsSession): string {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const trailingNewline = /\r?\n$/.test(text);
    const rewritten = text.split(/\r?\n/).map((line) => {
      if (/^#EXT-X-(?:KEY|SESSION-KEY|MEDIA|I-FRAME-STREAM-INF|MAP):/i.test(line)) {
        return line.replace(/URI=("([^"]+)"|'([^']+)'|([^,\s]+))/gi, (match, quoted, double, single, plain) => {
          const raw = double ?? single ?? plain;
          let url: URL;
          try {
            url = validHttpUrl(new URL(raw, sourceUrl), 'playlist URI');
          } catch {
            return match;
          }
          const kind: HlsResourceKind = /^#EXT-X-(?:KEY|SESSION-KEY):/i.test(line)
            ? 'key'
            : /^#EXT-X-MEDIA:/i.test(line) && (isSubtitleUrl(url) || /TYPE=SUBTITLES/i.test(line))
              ? 'subtitle'
              : isPlaylistUrl(url)
                ? 'playlist'
                : 'segment';
          const resource = this.sessions.registerResource(session, url, kind);
          const path = kind === 'subtitle'
            ? `/hls/${session.sessionId}/subtitle/${resource.id}`
            : `/hls/${session.sessionId}/resource/${resource.id}`;
          const quote = quoted[0] === '"' || quoted[0] === "'" ? quoted[0] : '';
          return `URI=${quote}${path}${quote}`;
        });
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      let url: URL;
      try {
        url = validHttpUrl(new URL(trimmed, sourceUrl), 'playlist URI');
      } catch {
        return line;
      }
      const kind: HlsResourceKind = isPlaylistUrl(url) ? 'playlist' : 'segment';
      const resource = this.sessions.registerResource(session, url, kind);
      return `/hls/${session.sessionId}/resource/${resource.id}`;
    });

    let result = rewritten.join(newline);
    if (trailingNewline && !result.endsWith(newline)) result += newline;
    if (!trailingNewline && result.endsWith(newline)) result = result.slice(0, -newline.length);
    return result;
  }

  private async handleResource(
    sessionId: string,
    resourceId: string,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const session = this.sessionOr404(sessionId, reply);
    if (!session) return reply;
    const resource = session.resources.get(resourceId);
    if (!resource || resource.kind === 'subtitle') {
      return reply.code(404).send({ error: 'Resource is not registered for this session' });
    }

    try {
      await this.refreshIfNeeded(session);
      if (resource.kind === 'playlist') {
        const response = await this.fetchUpstream(resource.url);
        if (!response.ok) return upstreamError(reply, response);
        return reply
          .type(PLAYLIST_CONTENT_TYPE)
          .send(this.rewritePlaylist(await response.text(), resource.url, session));
      }

      if (resource.kind === 'key') return this.fetchKey(resource, reply);

      const cacheKey = `${session.sessionId}:${resource.id}`;
      const cached = this.getCachedSegment(cacheKey);
      if (cached) return this.sendSegment(cached, reply);

      let pending = this.inflightSegments.get(cacheKey);
      if (!pending) {
        pending = this.loadSegment(resource);
        this.inflightSegments.set(cacheKey, pending);
        pending.then(
          () => this.inflightSegments.delete(cacheKey),
          () => this.inflightSegments.delete(cacheKey),
        );
      }
      const loaded = await pending;
      if (!loaded) return reply.code(502).send({ error: 'Unable to load upstream segment' });
      this.cacheSegment(cacheKey, loaded);
      return this.sendSegment(loaded, reply);
    } catch {
      return reply.code(502).send({ error: 'Unable to load upstream resource' });
    }
  }

  private async handleSubtitle(
    sessionId: string,
    resourceId: string,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const session = this.sessionOr404(sessionId, reply);
    if (!session) return reply;
    const resource = session.resources.get(resourceId);
    if (!resource || resource.kind !== 'subtitle') {
      return reply.code(404).send({ error: 'Subtitle is not registered for this session' });
    }

    try {
      await this.refreshIfNeeded(session);
      const response = await this.fetchUpstream(resource.url);
      if (!response.ok) return upstreamError(reply, response);
      return reply
        .header('Cache-Control', 'private, max-age=60')
        .type('text/vtt; charset=utf-8')
        .send(convertSubtitleToWebVtt(await response.text()));
    } catch {
      return reply.code(502).send({ error: 'Unable to load upstream subtitle' });
    }
  }

  private async fetchKey(resource: HlsSessionResource, reply: FastifyReply): Promise<FastifyReply> {
    const response = await this.fetchUpstream(resource.url);
    if (!response.ok) return upstreamError(reply, response);
    let body = Buffer.from(await response.arrayBuffer());

    if (this.decoder && looksLikeEncryptedKey(resource.url, response.headers.get('content-type'), body)) {
      const decoded = this.decoder.decode(body.toString('utf8'));
      if (!decoded) return reply.code(502).send({ error: 'Encrypted key decode failed' });
      body = Buffer.from(decoded);
    } else if (!this.decoder && body.length !== 16 && looksLikeEncryptedKey(resource.url, response.headers.get('content-type'), body)) {
      return reply.code(502).send({ error: 'No key decoder registered' });
    }

    return reply
      .header('Cache-Control', 'private, max-age=60')
      .type('application/octet-stream')
      .send(body);
  }

  private async loadSegment(resource: HlsSessionResource): Promise<CacheEntry | null> {
    const response = await this.fetchUpstream(resource.url);
    if (!response.ok) return null;
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? resource.contentType,
      expiresAt: this.now() + this.segmentCacheTtlMs,
    };
  }

  private sendSegment(entry: CacheEntry, reply: FastifyReply): FastifyReply {
    return reply
      .header('Cache-Control', 'private, max-age=60')
      .type(entry.contentType ?? 'video/mp2t')
      .send(entry.body);
  }

  private getCachedSegment(cacheKey: string): CacheEntry | undefined {
    const entry = this.segmentCache.get(cacheKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.segmentCache.delete(cacheKey);
      return undefined;
    }
    this.segmentCache.delete(cacheKey);
    this.segmentCache.set(cacheKey, entry);
    return entry;
  }

  private cacheSegment(cacheKey: string, entry: CacheEntry): void {
    this.segmentCache.delete(cacheKey);
    this.segmentCache.set(cacheKey, entry);
    while (this.segmentCache.size > this.segmentCacheSize) {
      const oldestKey = this.segmentCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.segmentCache.delete(oldestKey);
    }
  }

  private async fetchUpstream(url: URL): Promise<Response> {
    return this.fetchImpl(url, {
      headers: HLS_UPSTREAM_HEADERS,
      redirect: 'follow',
    });
  }

  private async refreshIfNeeded(session: HlsSession, force = false): Promise<void> {
    const resolver = this.refreshHandler ?? this.refreshSession;
    if (!resolver) return;
    if (!force && this.now() - session.lastTokenRefreshAt < this.tokenRefreshMs) {
      return;
    }
    if (session.privateState.refreshPromise) return session.privateState.refreshPromise;

    const promise = this.performRefresh(session, resolver);
    session.privateState.refreshPromise = promise;
    try {
      await promise;
    } finally {
      if (session.privateState.refreshPromise === promise) {
        session.privateState.refreshPromise = undefined;
      }
    }
  }

  private async performRefresh(
    session: HlsSession,
    resolver: NonNullable<HlsGatewayOptions['refreshSession']>,
  ): Promise<void> {
    const refreshed = await resolver(session);
    if (typeof refreshed === 'string' || refreshed instanceof URL) {
      session.playlistUrl = validHttpUrl(refreshed, 'refreshed playlist URL');
    } else if (refreshed) {
      if (refreshed.playlistUrl) {
        session.playlistUrl = validHttpUrl(refreshed.playlistUrl, 'refreshed playlist URL');
      }
      const replacements = refreshed.resources instanceof Map
        ? refreshed.resources.entries()
        : Object.entries(refreshed.resources ?? {});
      for (const [id, url] of replacements) {
        const resource = session.resources.get(id);
        if (resource) resource.url = validHttpUrl(url, 'refreshed resource URL');
      }
    }
    session.lastTokenRefreshAt = this.now();
  }
}

export async function registerHlsGateway(
  fastify: FastifyInstance,
  options: HlsGatewayOptions = {},
): Promise<HlsGateway> {
  const gateway = new HlsGateway(options);
  await gateway.register(fastify);
  return gateway;
}

export const createHlsGateway = (options: HlsGatewayOptions = {}): HlsGateway =>
  new HlsGateway(options);
