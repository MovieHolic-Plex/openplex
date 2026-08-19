import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LocalAdapter } from '../adapters/local-adapter.js';
import { isIngestableUrl, ingestFromUrl } from '../ingest/url.js';
import { buildProviderChain, scanWork } from '../metadata/scan.js';
import type { LibraryStore, WorkKind } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { ApiError } from './errors.js';

const workParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

const comicParamsSchema = {
  type: 'object',
  required: ['unitId'],
  additionalProperties: false,
  properties: { unitId: { type: 'integer', minimum: 1 } },
} as const;

const comicPageParamsSchema = {
  type: 'object',
  required: ['unitId', 'page'],
  additionalProperties: false,
  properties: {
    unitId: { type: 'integer', minimum: 1 },
    page: { type: 'integer', minimum: 0 },
  },
} as const;

export async function runLibraryScan(options: {
  readonly library: LibraryStore;
  readonly localAdapter?: LocalAdapter;
  readonly localMedia?: Pick<LocalMediaStore, 'isMetaLocked'>;
  readonly providerSettings?: readonly string[];
  readonly role?: 'media' | 'crawl';
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly crawlUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly force?: boolean;
}): Promise<{
  items: unknown[];
  scanned: Array<{ libraryId: number; files: number; truncated?: true; error?: 'PATH_MISSING' }>
}> {
  const { library, localAdapter, localMedia, fetchImpl } = options;
  const role = options.role === 'crawl' ? 'crawl' : 'media';
  const env = options.env ?? process.env;
  const crawlUrl = options.crawlUrl ?? process.env.OPENPLEX_CRAWL_URL;
  const providerSettings = options.providerSettings
    ?? (localMedia && 'getMetadataProviders' in localMedia
      ? (localMedia as LocalMediaStore).getMetadataProviders()
      : undefined);
  const providers = buildProviderChain({
    role,
    settings: providerSettings ?? ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'],
    env,
    crawlUrl,
    fetchImpl,
  });
  const scanned: Array<{ libraryId: number; files: number; truncated?: true; error?: 'PATH_MISSING' }> = [];
  if (localAdapter) {
    for (const lib of library.taxonomy.listLibraries()) {
      const { result } = localAdapter.scanLibrary({
        id: lib.id,
        kind: lib.kind,
        path: lib.path,
      });
      scanned.push(result);
    }
  }
  const items = [];
  for (const work of library.listWorks()) {
    if (localMedia?.isMetaLocked(work.id) && !options.force) {
      items.push({ workId: work.id, skipped: 'user_locked' });
      continue;
    }
    items.push(await scanWork(library, work, { providers }));
  }
  return { items, scanned };
}

export function registerLibraryRoutes(
  fastify: FastifyInstance,
  options: {
    readonly library: LibraryStore;
    readonly localAdapter?: LocalAdapter;
    readonly localMedia?: LocalMediaStore;
    readonly mediaRoot?: string;
    readonly now?: () => number;
    readonly fetchImpl?: typeof fetch;
    readonly tmdbKey?: string;
    readonly role?: 'media' | 'crawl';
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly crawlUrl?: string;
    readonly resolveProfileId?: (request: FastifyRequest) => number;
  },
): void {
  const { library, localAdapter, localMedia, mediaRoot, now = Date.now, fetchImpl } = options;

  fastify.get(
    '/api/library',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['video_series', 'movie', 'comic'] },
            libraryId: { type: 'integer', minimum: 1 },
            genre: { type: 'string', minLength: 1 },
            year: { type: 'integer', minimum: 1800 },
            collectionId: { type: 'integer', minimum: 1 },
            sort: { type: 'string', enum: ['title', 'year', 'added', 'recent'] },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        kind?: WorkKind;
        libraryId?: number;
        genre?: string;
        year?: number;
        collectionId?: number;
        sort?: 'title' | 'year' | 'added' | 'recent';
      };
      return { items: library.listWorks(query) };
    },
  );

  fastify.get('/api/libraries', async () => ({
    items: library.taxonomy.listLibraries(),
  }));

  fastify.get(
    '/api/libraries/:id/works',
    {
      schema: {
        params: workParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            genre: { type: 'string', minLength: 1 },
            year: { type: 'integer', minimum: 1800 },
            sort: { type: 'string', enum: ['title', 'year', 'added', 'recent'] },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      if (!library.taxonomy.getLibrary(id)) {
        throw new ApiError(404, 'LIBRARY_NOT_FOUND', `Library ${id} was not found`);
      }
      const query = request.query as {
        genre?: string;
        year?: number;
        sort?: 'title' | 'year' | 'added' | 'recent';
      };
      return { items: library.listWorks({ ...query, libraryId: id }) };
    },
  );

  fastify.get('/api/collections', async () => ({
    items: library.taxonomy.listCollections(),
  }));

  fastify.post(
    '/api/collections',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
        },
      },
    },
    async (request) => {
      const { name } = request.body as { name: string };
      return { collection: library.taxonomy.createCollection(name, now()) };
    },
  );

  fastify.post(
    '/api/collections/:id/works',
    {
      schema: {
        params: workParamsSchema,
        body: {
          type: 'object',
          required: ['workId'],
          additionalProperties: false,
          properties: { workId: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      const { workId } = request.body as { workId: number };
      if (!library.taxonomy.getCollection(id)) {
        throw new ApiError(404, 'COLLECTION_NOT_FOUND', `Collection ${id} was not found`);
      }
      if (!library.getWork(workId)) {
        throw new ApiError(404, 'WORK_NOT_FOUND', `Work ${workId} was not found`);
      }
      library.taxonomy.addToCollection(id, workId);
      return { ok: true };
    },
  );

  fastify.patch(
    '/api/library/:id/meta',
    {
      schema: {
        params: workParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            year: { type: 'integer', minimum: 1800 },
            aired: { type: 'string' },
            studio: { type: 'string' },
            content_rating: { type: 'string' },
            original_title: { type: 'string' },
            tmdb_id: { type: 'integer' },
            tvdb_id: { type: 'integer' },
            runtime_sec: { type: 'integer', minimum: 0 },
            genres: { type: 'array', items: { type: 'string' } },
            libraryId: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      if (!library.getWork(id)) throw new ApiError(404, 'WORK_NOT_FOUND', `Work ${id} was not found`);
      const body = request.body as {
        year?: number;
        aired?: string;
        studio?: string;
        content_rating?: string;
        original_title?: string;
        tmdb_id?: number;
        tvdb_id?: number;
        runtime_sec?: number;
        genres?: string[];
        libraryId?: number;
      };
      if (body.libraryId) {
        if (!library.taxonomy.getLibrary(body.libraryId)) {
          throw new ApiError(404, 'LIBRARY_NOT_FOUND', `Library ${body.libraryId} was not found`);
        }
        library.taxonomy.assignWork(id, body.libraryId);
      }
      const meta = library.taxonomy.upsertMeta(id, body);
      if (body.genres) library.taxonomy.setGenres(id, body.genres);
      return { meta, genres: library.taxonomy.listGenres(id) };
    },
  );

  fastify.get(
    '/api/library/units/:id/binding',
    { schema: { params: workParamsSchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      const binding = library.bindingForUnit(id);
      if (!binding) throw new ApiError(404, 'BINDING_NOT_FOUND', `Binding for unit ${id} was not found`);
      return {
        adapter: binding.adapter,
        externalId: binding.external_id,
        workId: binding.work_id,
        unitId: binding.unit_id,
      };
    },
  );

  fastify.get(
    '/api/sources',
    async () => ({
      items: library.listSourceAdapters().map((adapter) => ({
        name: adapter.name,
        enabled: adapter.enabled,
        kind: adapter.kind,
        kinds: adapter.kinds,
      })),
    }),
  );

  fastify.patch(
    '/api/sources/:name',
    {
      schema: {
        params: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 64 } },
        },
        body: {
          type: 'object',
          required: ['enabled'],
          additionalProperties: false,
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (request) => {
      const { name } = request.params as { name: string };
      const { enabled } = request.body as { enabled: boolean };
      const updated = library.setSourceAdapterEnabled(name, enabled);
      if (!updated) throw new ApiError(404, 'SOURCE_NOT_FOUND', `Source ${name} was not found`);
      return {
        item: {
          name: updated.name,
          enabled: updated.enabled,
          kind: updated.kind,
          kinds: updated.kinds,
        },
      };
    },
  );

  fastify.post(
    '/api/library/scan',
    async () => runLibraryScan({
      library,
      localAdapter,
      localMedia,
      role: options.role,
      env: options.env,
      crawlUrl: options.crawlUrl,
      fetchImpl,
    }),
  );

  fastify.post(
    '/api/ingest/url',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          additionalProperties: false,
          properties: { url: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      if (!localAdapter || !localMedia || !mediaRoot) {
        throw new ApiError(400, 'IMPORT_UNAVAILABLE', 'URL ingest is not configured');
      }
      const { url } = request.body as { url: string };
      if (!isIngestableUrl(url)) {
        throw new ApiError(400, 'URL_NOT_INGESTABLE', 'URL is not an ingestible media file or local path');
      }
      try {
        const result = await ingestFromUrl({
          url,
          library,
          localMedia,
          localAdapter,
          mediaRoot,
          now: now(),
          fetchImpl,
        });
        const providers = buildProviderChain({
          role: options.role === 'crawl' ? 'crawl' : 'media',
          settings: localMedia ? localMedia.getMetadataProviders() : ['tmdb'],
          env: options.env ?? process.env,
          crawlUrl: options.crawlUrl,
          fetchImpl,
        });
        for (const work of result.works) {
          if (localMedia?.isMetaLocked(work.id)) continue;
          await scanWork(library, work, { providers });
        }
        return { items: result.works };
      } catch (error) {
        if (error instanceof Error) {
          throw new ApiError(400, 'URL_NOT_INGESTABLE', error.message);
        }
        throw error;
      }
    },
  );

  fastify.get(
    '/api/library/:id',
    { schema: { params: workParamsSchema } },
    async (request) => {
      const { id } = request.params as { id: number };
      const work = library.getWork(id);
      if (!work) throw new ApiError(404, 'WORK_NOT_FOUND', `Work ${id} was not found`);
      return {
        work,
        units: library.listUnits(id),
        meta: library.taxonomy.getMeta(id),
        genres: library.taxonomy.listGenres(id),
      };
    },
  );

  fastify.post(
    '/api/library/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['root'],
          additionalProperties: false,
          properties: { root: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      if (!localAdapter) {
        throw new ApiError(400, 'IMPORT_UNAVAILABLE', 'Local import is not configured');
      }
      const { root } = request.body as { root: string };
      try {
        const items = localAdapter.importRoot(root);
        const providers = buildProviderChain({
          role: options.role === 'crawl' ? 'crawl' : 'media',
          settings: localMedia ? localMedia.getMetadataProviders() : ['tmdb'],
          env: options.env ?? process.env,
          crawlUrl: options.crawlUrl,
          fetchImpl,
        });
        for (const work of items) {
          if (localMedia?.isMetaLocked(work.id)) continue;
          await scanWork(library, work, { providers });
        }
        return { items };
      } catch (error) {
        if (error instanceof Error && /does not exist/.test(error.message)) {
          throw new ApiError(400, 'IMPORT_ROOT_INVALID', error.message);
        }
        throw error;
      }
    },
  );

  fastify.get(
    '/api/comics/:unitId',
    { schema: { params: comicParamsSchema } },
    async (request) => {
      const { unitId } = request.params as { unitId: number };
      const unit = library.getUnit(unitId);
      if (!unit || unit.kind !== 'chapter') {
        throw new ApiError(404, 'COMIC_NOT_FOUND', `Comic unit ${unitId} was not found`);
      }
      const work = library.getWork(unit.work_id);
      if (!work || !localAdapter) {
        throw new ApiError(404, 'COMIC_NOT_FOUND', `Comic unit ${unitId} was not found`);
      }
      return {
        work,
        unit,
        pageCount: localAdapter.listPages(unitId).length,
      };
    },
  );

  fastify.get(
    '/api/comics/:unitId/pages/:page',
    { schema: { params: comicPageParamsSchema } },
    async (request, reply) => {
      const { unitId, page } = request.params as { unitId: number; page: number };
      if (!localAdapter) throw new ApiError(404, 'COMIC_NOT_FOUND', 'Comic unit was not found');
      try {
        const bytes = localAdapter.readPage(unitId, page);
        const names = localAdapter.listPages(unitId);
        const name = names[page] ?? 'page.bin';
        return reply.type(contentTypeFor(name)).send(bytes);
      } catch (error) {
        if (error instanceof Error && /not found/i.test(error.message)) {
          throw new ApiError(404, 'PAGE_NOT_FOUND', error.message);
        }
        throw error;
      }
    },
  );

  fastify.put(
    '/api/library/units/:id/progress',
    {
      schema: {
        params: workParamsSchema,
        body: {
          type: 'object',
          required: ['pageIndex', 'pageCount'],
          additionalProperties: false,
          properties: {
            pageIndex: { type: 'integer', minimum: 0 },
            pageCount: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: number };
      const unit = library.getUnit(id);
      if (!unit) throw new ApiError(404, 'UNIT_NOT_FOUND', `Unit ${id} was not found`);
      const { pageIndex, pageCount } = request.body as { pageIndex: number; pageCount: number };
      const profileHeader = request.headers['x-profile-id'];
      const profileId = options.resolveProfileId
        ? options.resolveProfileId(request)
        : profileHeader === undefined ? 1 : Number(profileHeader);
      library.setProgress(profileId, id, {
        position: pageIndex,
        duration: pageCount,
        pageIndex,
      }, now());
      return { progress: library.getProgress(profileId, id) };
    },
  );
}

function contentTypeFor(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.avif$/i.test(name)) return 'image/avif';
  return 'image/jpeg';
}
