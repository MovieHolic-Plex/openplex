import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LibraryStore } from '../store/library-store.js';
import { ApiError } from './errors.js';

const unitParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

export function registerLibraryStreamRoutes(
  fastify: FastifyInstance,
  options: { library: LibraryStore; mediaRoot: string },
): void {
  const { library, mediaRoot } = options;

  fastify.post('/api/library/units/:id/stream', { schema: { params: unitParams } }, async (request) => {
    const { id } = request.params as { id: number };
    const unit = library.getUnit(id);
    if (!unit) throw new ApiError(404, 'UNIT_NOT_FOUND', `Unit ${id} was not found`);
    const asset = pickPlayableAsset(library, id);
    const resolved = resolveAssetPath(library, mediaRoot, asset.path);
    if (!resolved) throw new ApiError(404, 'STREAM_NOT_FOUND', 'Local media file was not found');
    return {
      source: 'local',
      fileUrl: `/api/library/units/${id}/media`,
      title: unit.title,
      sessionId: `local-unit:${id}`,
    };
  });

  fastify.get('/api/library/units/:id/media', { schema: { params: unitParams } }, async (request, reply) => {
    const { id } = request.params as { id: number };
    if (!library.getUnit(id)) throw new ApiError(404, 'UNIT_NOT_FOUND', `Unit ${id} was not found`);
    const asset = pickPlayableAsset(library, id);
    const resolved = resolveAssetPath(library, mediaRoot, asset.path);
    if (!resolved) throw new ApiError(404, 'STREAM_NOT_FOUND', 'Local media file was not found');
    return sendFileRange(request, reply, resolved);
  });
}

function pickPlayableAsset(library: LibraryStore, unitId: number) {
  const assets = library.listAssets(unitId).filter((a) => a.kind === 'file' || a.kind === 'hls_local');
  const asset = assets.at(-1);
  if (!asset || !asset.path) throw new ApiError(404, 'STREAM_NOT_FOUND', 'Local media file was not found');
  return { ...asset, path: asset.path };
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveAssetPath(library: LibraryStore, mediaRoot: string, assetPath: string): string | null {
  const media = path.resolve(mediaRoot);
  const candidate = path.isAbsolute(assetPath) ? path.resolve(assetPath) : path.resolve(media, assetPath);
  let st: fs.Stats;
  try { st = fs.lstatSync(candidate); } catch { return null; }
  if (!st.isFile() || st.isSymbolicLink()) return null;
  if (isInside(media, candidate)) return candidate;
  for (const lib of library.taxonomy.listLibraries()) {
    if (lib.path && isInside(lib.path, candidate)) return candidate;
  }
  return null;
}

function sendFileRange(request: FastifyRequest, reply: FastifyReply, filePath: string) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const range = request.headers.range;
  const type = filePath.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
  if (typeof range === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) throw new ApiError(416, 'RANGE_NOT_SATISFIABLE', 'Invalid range');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start > end || start >= size) throw new ApiError(416, 'RANGE_NOT_SATISFIABLE', 'Invalid range');
    const chunk = fs.readFileSync(filePath).subarray(start, end + 1);
    return reply.status(206).headers({
      'Content-Type': type,
      'Content-Length': String(chunk.length),
      'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${size}`,
      'Accept-Ranges': 'bytes',
    }).send(chunk);
  }
  return reply.type(type).header('Accept-Ranges', 'bytes').send(fs.readFileSync(filePath));
}
