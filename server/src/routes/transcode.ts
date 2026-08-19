import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { episodeDirectory } from '../downloader/evict.js';
import { parseTvwikiId } from '../adapters/types.js';
import type { LibraryStore } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { isTranscodeProfile, TranscodeEngine } from '../transcode/engine.js';
import { ApiError } from './errors.js';

export function registerTranscodeRoutes(
  fastify: FastifyInstance,
  options: {
    readonly engine: TranscodeEngine;
    readonly library: LibraryStore;
    readonly localMedia?: LocalMediaStore;
    readonly mediaRoot: string;
  },
): void {
  const { engine, library, localMedia, mediaRoot } = options;

  fastify.post(
    '/api/transcode',
    {
      schema: {
        body: {
          type: 'object',
          required: ['profile'],
          additionalProperties: false,
          properties: {
            profile: { type: 'string', enum: ['original', '1080p', '720p', '480p'] },
            unitId: { type: 'integer', minimum: 1 },
            category: { type: 'string' },
            id: { type: 'integer', minimum: 1 },
            epIdx: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as {
        profile: string;
        unitId?: number;
        category?: string;
        id?: number;
        epIdx?: number;
      };
      if (!isTranscodeProfile(body.profile)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'profile is invalid');
      }
      const input = resolveInput(library, localMedia, mediaRoot, body);
      if (!input) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Local media file was not found');
      const job = await engine.start(input, body.profile);
      if (job.status === 'unavailable') {
        throw new ApiError(503, 'TRANSCODE_UNAVAILABLE', 'ffmpeg is not available');
      }
      if (job.status === 'failed') {
        throw new ApiError(500, 'TRANSCODE_FAILED', job.error ?? 'transcode failed');
      }
      return {
        job,
        transcodeUrl: `/transcode/${job.id}/index.m3u8`,
      };
    },
  );

  fastify.get(
    '/api/transcode/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const job = engine.get(id);
      if (!job) throw new ApiError(404, 'TRANSCODE_NOT_FOUND', `Transcode ${id} was not found`);
      return { job };
    },
  );

  fastify.get(
    '/transcode/:id/index.m3u8',
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = engine.get(id);
      if (!job?.playlistPath || !fs.existsSync(job.playlistPath)) {
        throw new ApiError(404, 'TRANSCODE_NOT_FOUND', 'Transcode playlist was not found');
      }
      return reply.type('application/vnd.apple.mpegurl').send(fs.readFileSync(job.playlistPath));
    },
  );
}

export function resolveInput(
  library: LibraryStore,
  _localMedia: LocalMediaStore | undefined,
  mediaRoot: string,
  ref: { unitId?: number; category?: string; id?: number; epIdx?: number },
): string | null {
  if (typeof ref.category === 'string' && typeof ref.id === 'number' && typeof ref.epIdx === 'number') {
    return existingMediaFile(mediaRoot, ref.category, ref.id, ref.epIdx);
  }
  if (typeof ref.unitId !== 'number') return null;
  const binding = library.bindingForUnit(ref.unitId);
  const playable = binding ? parseTvwikiId(binding.external_id) : null;
  if (playable) return existingMediaFile(mediaRoot, playable.category, playable.wrId, playable.epIdx);
  const assets = library.listAssets(ref.unitId);
  for (const asset of assets) {
    if (asset.path && fs.existsSync(asset.path)) return asset.path;
  }
  return null;
}

function existingMediaFile(mediaRoot: string, category: string, id: number, epIdx: number): string | null {
  const dir = episodeDirectory(mediaRoot, { category, id, epIdx });
  const mp4 = path.join(dir, 'media.mp4');
  if (fs.existsSync(mp4)) return mp4;
  const playlist = path.join(dir, 'playlist.m3u8');
  if (fs.existsSync(playlist)) return playlist;
  return null;
}
