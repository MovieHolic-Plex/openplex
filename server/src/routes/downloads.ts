import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DownloadQueue } from '../downloader/queue.js';
import { episodeDirectory } from '../downloader/evict.js';

import { proxyToCrawl } from '../crawl/bridge.js';
import type { LibraryStore } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { ApiError } from './errors.js';

const CATEGORY_PATTERN = '^[a-z_]+$';
const category = { type: 'string', pattern: CATEGORY_PATTERN } as const;
const positiveInteger = { type: 'integer', minimum: 1 } as const;
const episodeIndex = { type: 'integer', minimum: 0 } as const;

const downloadParamsSchema = {
  type: 'object',
  required: ['cat', 'id', 'epIdx'],
  additionalProperties: false,
  properties: { cat: category, id: positiveInteger, epIdx: episodeIndex },
} as const;

const enqueueBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unitId: positiveInteger,
    category,
    id: positiveInteger,
    epIdx: episodeIndex,
    title: { type: 'string', minLength: 1 },
    thumb: { type: 'string' },
  },
} as const;

const quotaBodySchema = {
  type: 'object',
  required: ['maxBytes'],
  additionalProperties: false,
  properties: { maxBytes: { type: 'integer', exclusiveMinimum: 0 } },
} as const;

export type LocalStreamPayload = {
  readonly sessionId: string;
  readonly source: 'local';
  readonly playlistUrl: string;
  readonly fileUrl?: string;
  readonly subtitles: Array<{
    id: string;
    language: string;
    label: string;
    url: string;
    format: 'vtt';
  }>;
  readonly title: string;
  readonly nextEpisode: Record<string, unknown> | null;
};

export function localStreamPayload(
  store: LocalMediaStore,
  mediaRoot: string,
  ref: { category: string; id: number; epIdx: number },
  now: number,
): LocalStreamPayload | null {
  const item = store.get(ref.category, ref.id, ref.epIdx);
  if (item?.download_status !== 'completed' || !item.file_path) return null;
  const stored = path.join(mediaRoot, item.file_path);
  if (!fs.existsSync(stored)) return null;

  store.touchAccessed(ref.category, ref.id, ref.epIdx, now);
  const episodeDir = episodeDirectory(mediaRoot, ref);
  const subtitleFile = path.join(episodeDir, 'subtitles.vtt');
  const next = store.nextCatalogEpisode(ref.category, ref.id, ref.epIdx);
  const base = `/media/${ref.category}/${ref.id}/${ref.epIdx}`;
  const payload: LocalStreamPayload = {
    sessionId: `local:${ref.category}:${ref.id}:${ref.epIdx}`,
    source: 'local',
    playlistUrl: `${base}/playlist.m3u8`,
    subtitles: fs.existsSync(subtitleFile)
      ? [{
          id: 'vtt',
          language: 'ko',
          label: 'Korean',
          url: `${base}/subtitles.vtt`,
          format: 'vtt',
        }]
      : [],
    title: item.title,
    nextEpisode: next ? { idx: next.epIdx, title: next.title, thumb: next.thumb } : null,
  };
  const mp4 = path.join(episodeDir, 'media.mp4');
  if (fs.existsSync(mp4) && fs.statSync(mp4).isFile()) {
    return { ...payload, fileUrl: `${base}/media.mp4` };
  }
  return payload;
}

export function prefetchNextEpisode(
  store: LocalMediaStore,
  downloader: DownloadQueue,
  item: { category: string; id: number; epIdx: number; position_sec: number; duration_sec: number },
): void {
  if (!(item.duration_sec > 0) || item.position_sec / item.duration_sec < 0.5) return;
  const next = store.nextCatalogEpisode(item.category, item.id, item.epIdx);
  if (!next) return;
  downloader.enqueue({
    category: item.category,
    id: item.id,
    epIdx: next.epIdx,
    title: next.title,
    thumb: next.thumb,
  });
}

export function registerDownloadRoutes(
  fastify: FastifyInstance,
  options: {
    readonly store: LocalMediaStore;
    readonly downloader?: DownloadQueue;
    readonly mediaRoot: string;
    readonly library?: LibraryStore;
    readonly tvwiki?: { enqueueSpec(unitId: number): { category: string; id: number; epIdx: number; title: string; thumb: string } | null };
    readonly crawlUrl?: string;
    readonly fetchImpl?: typeof fetch;
    readonly authToken?: string;
  },
): void {
  const { store, downloader, mediaRoot, library, tvwiki } = options;

  fastify.get('/api/downloads', async () => ({
    items: store.list(),
    usedBytes: store.completedBytes(),
    maxBytes: store.getMaxCacheBytes(),
  }));

  fastify.put(
    '/api/downloads/quota',
    { schema: { body: quotaBodySchema } },
    async (request) => {
      const { maxBytes } = request.body as { maxBytes: number };
      store.setMaxCacheBytes(maxBytes);
      return { maxBytes: store.getMaxCacheBytes() };
    },
  );

  fastify.post(
    '/api/downloads',
    { schema: { body: enqueueBodySchema } },
    async (request, reply) => {
      if (!downloader) {
        if (options.crawlUrl) {
          await proxyToCrawl(request, reply, {
            crawlUrl: options.crawlUrl,
            token: options.authToken,
            fetchImpl: options.fetchImpl,
          });
          return;
        }
        throw new ApiError(503, 'CRAWL_UNAVAILABLE', 'Crawl server is not configured');
      }
      const body = request.body as {
        unitId?: number;
        category?: string;
        id?: number;
        epIdx?: number;
        title?: string;
        thumb?: string;
      };
      if (typeof body.unitId === 'number') {
        if (!tvwiki || !library) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'unitId downloads require the library adapter');
        }
        const spec = tvwiki.enqueueSpec(body.unitId);
        if (!spec) throw new ApiError(404, 'UNIT_NOT_FOUND', `Unit ${body.unitId} was not found`);
        const item = downloader.enqueue(spec);
        return reply.code(item.download_status === 'completed' ? 200 : 202).send({ item });
      }
      if (
        typeof body.category !== 'string'
        || typeof body.id !== 'number'
        || typeof body.epIdx !== 'number'
        || typeof body.title !== 'string'
        || typeof body.thumb !== 'string'
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'category, id, epIdx, title, and thumb are required');
      }
      const draft = {
        category: body.category,
        id: body.id,
        epIdx: body.epIdx,
        title: body.title,
        thumb: body.thumb,
      };
      const item = downloader.enqueue(draft);
      return reply.code(item.download_status === 'completed' ? 200 : 202).send({ item });
    },
  );

  fastify.delete(
    '/api/downloads/:cat/:id/:epIdx',
    { schema: { params: downloadParamsSchema } },
    async (request, reply) => {
      const { cat, id, epIdx } = request.params as { cat: string; id: number; epIdx: number };
      if (!store.get(cat, id, epIdx)) {
        throw new ApiError(404, 'DOWNLOAD_NOT_FOUND', 'Download was not found');
      }
      if (!downloader) {
        if (options.crawlUrl) {
          await proxyToCrawl(request, reply, {
            crawlUrl: options.crawlUrl,
            token: options.authToken,
            fetchImpl: options.fetchImpl,
          });
          return;
        }
        throw new ApiError(503, 'CRAWL_UNAVAILABLE', 'Crawl server is not configured');
      }
      downloader.cancel({ category: cat, id, epIdx, title: '', thumb: '' });
      return { success: true };
    },
  );

  fastify.get(
    '/media/:cat/:id/:epIdx/playlist.m3u8',
    { schema: { params: downloadParamsSchema } },
    async (request, reply) => sendMedia(reply, mediaRoot, request, 'playlist.m3u8', 'application/vnd.apple.mpegurl'),
  );
  fastify.get(
    '/media/:cat/:id/:epIdx/media.mp4',
    { schema: { params: downloadParamsSchema } },
    async (request, reply) => sendMedia(reply, mediaRoot, request, 'media.mp4', 'video/mp4'),
  );
  fastify.get(
    '/media/:cat/:id/:epIdx/subtitles.vtt',
    { schema: { params: downloadParamsSchema } },
    async (request, reply) => sendMedia(reply, mediaRoot, request, 'subtitles.vtt', 'text/vtt; charset=utf-8'),
  );
  fastify.get(
    '/media/:cat/:id/:epIdx/key.bin',
    { schema: { params: downloadParamsSchema } },
    async (request, reply) => sendMedia(reply, mediaRoot, request, 'key.bin', 'application/octet-stream'),
  );
  fastify.get(
    '/media/:cat/:id/:epIdx/segments/:file',
    {
      schema: {
        params: {
          type: 'object',
          required: ['cat', 'id', 'epIdx', 'file'],
          additionalProperties: false,
          properties: {
            cat: category,
            id: positiveInteger,
            epIdx: episodeIndex,
            file: { type: 'string', pattern: '^seg\\d{5}\\.ts$' },
          },
        },
      },
    },
    async (request, reply) => {
      const { file } = request.params as { file: string };
      return sendMedia(reply, mediaRoot, request, path.join('segments', file), 'video/mp2t');
    },
  );
}

function sendMedia(
  reply: FastifyReply,
  mediaRoot: string,
  request: FastifyRequest,
  relative: string,
  contentType: string,
): FastifyReply {
  const params = request.params as { cat: string; id: number; epIdx: number };
  const target = safeMediaPath(mediaRoot, params.cat, params.id, params.epIdx, relative);
  if (!target) {
    throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Local media file was not found');
  }
  return reply.type(contentType).send(fs.readFileSync(target));
}

function safeMediaPath(
  mediaRoot: string,
  category: string,
  id: number,
  epIdx: number,
  relative: string,
): string | null {
  const root = path.resolve(mediaRoot);
  const target = path.resolve(root, category, String(id), String(epIdx), relative);
  const traversal = path.relative(root, target);
  if (traversal.startsWith('..') || path.isAbsolute(traversal)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}
