import type { FastifyInstance } from 'fastify';
import { LocalAdapter } from '../adapters/local-adapter.js';
import { parseTvwikiId } from '../adapters/types.js';
import type { ResolvedAgent } from '../agent/resolve.js';
import { runAgentTurn, type AgentChatClient } from '../agent/loop.js';
import type { DownloadQueue } from '../downloader/queue.js';
import type { LibraryStore } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import { ApiError } from './errors.js';

export function registerAgentRoutes(
  fastify: FastifyInstance,
  options: {
    readonly library: LibraryStore;
    readonly chat?: AgentChatClient;
    readonly tvwiki?: {
      enqueueSpec(unitId: number): { category: string; id: number; epIdx: number; title: string; thumb: string } | null;
      search?(query: string): Promise<readonly import('../adapters/types.js').AdapterSearchHit[]>;
    };
    readonly downloader?: DownloadQueue;
    readonly localAdapter?: LocalAdapter;
    readonly now?: () => number;
    readonly crawlUrl?: string;
    readonly fetchImpl?: typeof fetch;
    readonly authToken?: string;
    readonly scanMetadata?: (workId: number, force?: boolean) => Promise<unknown>;
  readonly setMetadataLocalMedia?: Pick<LocalMediaStore, 'setMetaLocked'>;
    readonly transcodeUnit?: (unitId: number, profile: string) => Promise<unknown>;
    readonly ingestUrl?: (url: string) => Promise<unknown>;
    readonly setLibraryPath?: (libraryId: number, libraryPath: string | null) => Promise<unknown>;
    readonly scanLibrary?: () => Promise<unknown>;
    readonly unavailable?: { readonly code: string; readonly message: string };
    readonly resolveChat?: () => ResolvedAgent;
  },
): void {
  const now = options.now ?? Date.now;

  fastify.post(
    '/api/agent/turn',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: { message: { type: 'string', minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (request) => {
      const resolved = options.resolveChat
        ? options.resolveChat()
        : { chat: options.chat, unavailable: options.unavailable };
      if (!resolved.chat) {
        throw new ApiError(
          503,
          resolved.unavailable?.code ?? 'AGENT_UNAVAILABLE',
          resolved.unavailable?.message ?? 'DeepSeek API key is not configured',
        );
      }
      const { message } = request.body as { message: string };
      const header = request.headers['x-profile-id'];
      const profileId = header === undefined ? 1 : Number(header);
      const turn = await runAgentTurn({
        profileId,
        message,
        library: options.library,
        chat: resolved.chat,
        enqueueDownload: async (unitId) => {
          const spec = options.tvwiki?.enqueueSpec(unitId);
          if (spec && options.downloader) {
            options.downloader.enqueue(spec);
            return;
          }
          if (options.crawlUrl) {
            await enqueueOnCrawl({
              library: options.library,
              crawlUrl: options.crawlUrl,
              fetchImpl: options.fetchImpl,
              authToken: options.authToken,
            }, unitId);
            return;
          }
          throw new Error('Unit is not downloadable');
        },
        searchSource: async (adapter, query) => {
          if (adapter === 'tvwiki' && options.tvwiki?.search) return options.tvwiki.search(query);
          if (adapter === 'tvwiki' && options.crawlUrl) {
            return searchCrawl(options.crawlUrl, query, options.fetchImpl, options.authToken);
          }
          if (adapter === 'local') {
            return options.library.searchWorks(query).map((work) => ({
              adapter: 'local',
              externalId: String(work.id),
              title: work.title,
              kind: work.kind,
              poster: work.poster,
            }));
          }
          return [];
        },
        importLocal: async (root) => {
          const importer = options.localAdapter ?? new LocalAdapter({ library: options.library, now });
          return importer.importRoot(root);
        },
        adapterEnabled: (name) => options.library.isSourceAdapterEnabled(name),
        scanMetadata: options.scanMetadata,
        localMedia: options.setMetadataLocalMedia,
        transcodeUnit: options.transcodeUnit,
        ingestUrl: options.ingestUrl,
        setLibraryPath: options.setLibraryPath,
        scanLibrary: options.scanLibrary,
      });
      options.library.recordAgentRun({
        profileId,
        message,
        reply: turn.reply,
        tools: turn.tools,
      }, now());
      return turn;
    },
  );
}

async function enqueueOnCrawl(
  options: {
    readonly library: LibraryStore;
    readonly crawlUrl: string;
    readonly fetchImpl?: typeof fetch;
    readonly authToken?: string;
  },
  unitId: number,
): Promise<void> {
  const unit = options.library.getUnit(unitId);
  const binding = options.library.bindingForUnit(unitId);
  const playable = binding ? parseTvwikiId(binding.external_id) : null;
  if (!unit || !playable) throw new Error('Unit is not downloadable');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.authToken) headers.authorization = `Bearer ${options.authToken}`;
  const response = await fetchImpl(`${options.crawlUrl.replace(/\/$/, '')}/api/downloads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category: playable.category,
      id: playable.wrId,
      epIdx: playable.epIdx,
      title: unit.title,
      thumb: unit.thumb ?? '',
    }),
  });
  if (!response.ok) throw new Error(`Crawl enqueue failed (${response.status})`);
}

async function searchCrawl(
  crawlUrl: string,
  query: string,
  fetchImpl: typeof fetch | undefined,
  token: string | undefined,
) {
  const impl = fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await impl(
    `${crawlUrl.replace(/\/$/, '')}/api/search?q=${encodeURIComponent(query)}`,
    { headers },
  );
  if (!response.ok) return [];
  const payload = await response.json() as { items?: Array<Record<string, unknown>> };
  return (payload.items ?? []).flatMap((item) => {
    const category = item.category;
    const wrId = item.wrId;
    const title = item.title;
    if (typeof category !== 'string' || typeof wrId !== 'number' || typeof title !== 'string') {
      return [];
    }
    return [{
      adapter: 'tvwiki',
      externalId: `${category}/${wrId}`,
      title,
      kind: category === 'movie' ? 'movie' as const : 'video_series' as const,
      poster: typeof item.thumbUrl === 'string' ? item.thumbUrl : null,
    }];
  });
}
