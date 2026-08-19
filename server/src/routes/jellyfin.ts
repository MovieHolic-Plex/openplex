import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseTvwikiId } from '../adapters/types.js';
import { episodeDirectory } from '../downloader/evict.js';
import { JELLYFIN_SERVER_ID, JELLYFIN_VIEW_ID, parseJellyfinId } from '../jellyfin/ids.js';
import { matchesIncludeTypes, unitItem, workItem } from '../jellyfin/items.js';
import type { LibraryStore, Unit } from '../store/library-store.js';
import { ApiError } from './errors.js';

const PREFIXES = ['/jellyfin', '/emby'] as const;

export function registerJellyfinRoutes(
  fastify: FastifyInstance,
  options: {
    readonly library: LibraryStore;
    readonly mediaRoot: string;
    readonly authToken?: string;
  },
): void {
  for (const prefix of PREFIXES) {
    mount(fastify, prefix, options);
  }
}

function mount(
  fastify: FastifyInstance,
  prefix: string,
  options: {
    readonly library: LibraryStore;
    readonly mediaRoot: string;
    readonly authToken?: string;
  },
): void {
  const { library, mediaRoot, authToken } = options;

  fastify.post(`${prefix}/Users/AuthenticateByName`, async (request) => {
    const body = asRecord(request.body);
    const username = stringField(body, 'Username') || stringField(body, 'username') || 'openplex';
    const password = stringField(body, 'Pw')
      || stringField(body, 'pw')
      || stringField(body, 'Password')
      || stringField(body, 'password');
    if (authToken && password !== authToken) {
      throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    const token = authToken ?? 'loopback-session';
    return {
      User: {
        Name: username,
        ServerId: JELLYFIN_SERVER_ID,
        Id: '1',
        HasPassword: Boolean(authToken),
      },
      SessionInfo: {
        Id: 'openplex-session',
        UserId: '1',
        UserName: username,
        Client: 'OpenPlex',
      },
      AccessToken: token,
      ServerId: JELLYFIN_SERVER_ID,
    };
  });

  fastify.get(`${prefix}/System/Info/Public`, async () => systemInfo());
  fastify.get(`${prefix}/System/Info`, async () => systemInfo());
  fastify.get(`${prefix}/Sessions`, async () => ({ Items: [] }));
  fastify.get(`${prefix}/Sessions/PlayStates`, async () => ({ Items: [] }));

  fastify.get(`${prefix}/Users/:userId/Views`, async () => ({
    Items: [{
      Id: JELLYFIN_VIEW_ID,
      Name: '보관함',
      CollectionType: 'mixed',
      Type: 'CollectionFolder',
      IsFolder: true,
      ServerId: JELLYFIN_SERVER_ID,
    }],
    TotalRecordCount: 1,
  }));

  fastify.get(`${prefix}/Users/:userId/Items`, async (request) => {
    const query = asRecord(request.query);
    const include = String(query.IncludeItemTypes ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const parentId = typeof query.ParentId === 'string' ? parseJellyfinId(query.ParentId) : null;
    const items = collectItems(library, include, parentId);
    return { Items: items, TotalRecordCount: items.length, StartIndex: 0 };
  });

  fastify.get(`${prefix}/Users/:userId/Items/:itemId`, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const item = resolveItem(library, itemId);
    if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', `Item ${itemId} was not found`);
    return item;
  });

  fastify.get(`${prefix}/Videos/:itemId/stream`, async (request, reply) => {
    return streamItem(library, mediaRoot, request, reply);
  });
  fastify.get(`${prefix}/Videos/:itemId/stream.mp4`, async (request, reply) => {
    return streamItem(library, mediaRoot, request, reply);
  });
}

function collectItems(
  library: LibraryStore,
  include: readonly string[],
  parentId: ReturnType<typeof parseJellyfinId>,
) {
  if (parentId?.kind === 'work') {
    return library.listUnits(parentId.id)
      .map(unitItem)
      .filter((item) => matchesIncludeTypes(item.Type, include));
  }
  if (include.includes('Episode') && !include.some((type) => type === 'Series' || type === 'Movie' || type === 'Book')) {
    return library.listWorks().flatMap((work) => library.listUnits(work.id).map(unitItem));
  }
  return library.listWorks()
    .map(workItem)
    .filter((item) => matchesIncludeTypes(item.Type, include));
}

function resolveItem(library: LibraryStore, rawId: string) {
  const parsed = parseJellyfinId(rawId);
  if (parsed?.kind === 'work') {
    const work = library.getWork(parsed.id);
    return work ? workItem(work) : null;
  }
  if (parsed?.kind === 'unit') {
    const unit = library.getUnit(parsed.id);
    return unit ? unitItem(unit) : null;
  }
  if (parsed?.kind === 'view') {
    return {
      Id: JELLYFIN_VIEW_ID,
      Name: '보관함',
      Type: 'CollectionFolder',
      IsFolder: true,
      ServerId: JELLYFIN_SERVER_ID,
    };
  }
  return null;
}

function streamItem(
  library: LibraryStore,
  mediaRoot: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { itemId } = request.params as { itemId: string };
  const unit = playableUnit(library, itemId);
  if (!unit) throw new ApiError(404, 'ITEM_NOT_FOUND', `Item ${itemId} was not found`);
  const binding = library.bindingForUnit(unit.id);
  const playable = binding ? parseTvwikiId(binding.external_id) : null;
  if (!playable) throw new ApiError(404, 'STREAM_NOT_FOUND', 'Local media was not found');
  const ref = { category: playable.category, id: playable.wrId, epIdx: playable.epIdx };
  const dir = episodeDirectory(mediaRoot, ref);
  const mp4 = path.join(dir, 'media.mp4');
  if (fs.existsSync(mp4) && fs.statSync(mp4).isFile()) {
    return reply.type('video/mp4').send(fs.readFileSync(mp4));
  }
  const playlist = path.join(dir, 'playlist.m3u8');
  if (fs.existsSync(playlist) && fs.statSync(playlist).isFile()) {
    return reply.redirect(`/media/${ref.category}/${ref.id}/${ref.epIdx}/playlist.m3u8`);
  }
  throw new ApiError(404, 'STREAM_NOT_FOUND', 'Local media was not found');
}

function playableUnit(library: LibraryStore, rawId: string): Unit | null {
  const parsed = parseJellyfinId(rawId);
  if (parsed?.kind === 'unit') return library.getUnit(parsed.id);
  if (parsed?.kind === 'work') return library.listUnits(parsed.id)[0] ?? null;
  return null;
}

function systemInfo() {
  return {
    ServerName: 'OpenPlex',
    Version: '0.1.0',
    Id: JELLYFIN_SERVER_ID,
    ProductName: 'OpenPlex',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

