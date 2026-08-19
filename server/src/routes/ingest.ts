import type { FastifyInstance } from 'fastify';
import { ingestAsset, ingestWork, type IngestAssetRequest, type IngestWorkRequest } from '../store/ingest.js';
import type { LibraryStore, WorkKind } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { ApiError } from './errors.js';

const WORK_KINDS = ['video_series', 'movie', 'comic'] as const;

export function registerIngestRoutes(
  fastify: FastifyInstance,
  options: {
    readonly library: LibraryStore;
    readonly localMedia?: LocalMediaStore;
    readonly now?: () => number;
  },
): void {
  const now = options.now ?? Date.now;

  fastify.post('/api/ingest/work', async (request) => {
    const body = parseWork(request.body);
    return ingestWork(options.library, body, now());
  });

  fastify.post('/api/ingest/asset', async (request) => {
    if (!options.localMedia) {
      throw new ApiError(400, 'INGEST_UNAVAILABLE', 'Local media store is not configured');
    }
    const body = parseAsset(request.body);
    ingestAsset(options.library, options.localMedia, body, now());
    return { ok: true };
  });
}

function parseWork(raw: unknown): IngestWorkRequest {
  const body = asRecord(raw);
  const kind = body.kind;
  if (typeof body.adapter !== 'string' || body.adapter.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'adapter is required');
  }
  if (typeof body.externalId !== 'string' || body.externalId.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'externalId is required');
  }
  if (typeof body.title !== 'string' || body.title.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'title is required');
  }
  if (!isWorkKind(kind)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'kind is invalid');
  }
  const unitsRaw = body.units;
  const units = Array.isArray(unitsRaw) ? unitsRaw.map(parseUnit) : [];
  return {
    adapter: body.adapter,
    externalId: body.externalId,
    title: body.title,
    kind,
    poster: typeof body.poster === 'string' ? body.poster : null,
    units,
  };
}

function parseUnit(raw: unknown): IngestWorkRequest['units'][number] {
  const unit = asRecord(raw);
  if (typeof unit.externalId !== 'string' || typeof unit.title !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'unit requires externalId and title');
  }
  const ordinal = typeof unit.ordinal === 'number' ? unit.ordinal : 0;
  return {
    externalId: unit.externalId,
    title: unit.title,
    ordinal,
    thumb: typeof unit.thumb === 'string' ? unit.thumb : null,
  };
}

function parseAsset(raw: unknown): IngestAssetRequest {
  const body = asRecord(raw);
  if (typeof body.adapter !== 'string' || typeof body.category !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'adapter and category are required');
  }
  if (typeof body.id !== 'number' || typeof body.epIdx !== 'number') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'id and epIdx are required');
  }
  if (typeof body.title !== 'string' || typeof body.filePath !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'title and filePath are required');
  }
  return {
    adapter: body.adapter,
    category: body.category,
    id: body.id,
    epIdx: body.epIdx,
    title: body.title,
    thumb: typeof body.thumb === 'string' ? body.thumb : '',
    filePath: body.filePath,
    sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : 0,
  };
}

function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === 'string' && (WORK_KINDS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
