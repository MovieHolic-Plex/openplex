import type { AdapterSearchHit } from '../adapters/types.js';
import type { LibraryStore, Work } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';
import nodePath from 'node:path';
import { recommendWorks } from './rag.js';

export const ALLOWED_SOURCE_ADAPTERS = ['local'] as const;
export type AllowedSourceAdapter = (typeof ALLOWED_SOURCE_ADAPTERS)[number];

export const AGENT_TOOL_NAMES = [
  'search_library',
  'get_work',
  'search_source',
  'enqueue_download',
  'import_local',
  'recommend_next',
  'set_metadata',
  'scan_metadata',
  'add_to_collection',
  'transcode_unit',
  'ingest_url',
  'set_library_path',
  'scan_library',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type AgentToolContext = {
  readonly profileId: number;
  readonly library: LibraryStore;
  readonly enqueueDownload: (unitId: number) => Promise<unknown>;
  readonly searchSource: (adapter: string, query: string) => Promise<readonly AdapterSearchHit[]>;
  readonly importLocal: (root: string) => Promise<readonly Work[]>;
  readonly adapterEnabled?: (name: string) => boolean;
  readonly scanMetadata?: (workId: number, force?: boolean) => Promise<unknown>;
  readonly transcodeUnit?: (unitId: number, profile: string) => Promise<unknown>;
  readonly ingestUrl?: (url: string) => Promise<unknown>;
  readonly setLibraryPath?: (libraryId: number, libraryPath: string | null) => Promise<unknown>;
  readonly scanLibrary?: () => Promise<unknown>;
  readonly localMedia?: Pick<LocalMediaStore, 'setMetaLocked'>;
};

export type ToolExecution = {
  readonly name: string;
  readonly arguments: unknown;
  readonly result: unknown;
};

export function isAllowedAdapter(name: string): name is AllowedSourceAdapter {
  return (ALLOWED_SOURCE_ADAPTERS as readonly string[]).includes(name);
}

export async function executeTool(
  name: string,
  rawArgs: unknown,
  context: AgentToolContext,
): Promise<unknown> {
  const args = asRecord(rawArgs);
  switch (name) {
    case 'search_library':
      return context.library.searchWorks(stringArg(args, 'query'));
    case 'get_work': {
      const workId = numberArg(args, 'workId');
      const work = context.library.getWork(workId);
      if (!work) return { error: `Work ${workId} was not found` };
      return { work, units: context.library.listUnits(workId) };
    }
    case 'search_source': {
      const adapter = stringArg(args, 'adapter');
      if (!isAllowedAdapter(adapter)) return { error: `Unknown adapter: ${adapter}` };
      if (context.adapterEnabled && !context.adapterEnabled(adapter)) {
        return { error: `Adapter disabled: ${adapter}` };
      }
      return context.searchSource(adapter, stringArg(args, 'query'));
    }
    case 'enqueue_download': {
      const unitId = numberArg(args, 'unitId');
      if (!context.library.getUnit(unitId)) return { error: `Unit ${unitId} was not found` };
      try {
        await context.enqueueDownload(unitId);
        return { enqueued: unitId };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Enqueue failed' };
      }
    }
    case 'import_local':
      return context.importLocal(stringArg(args, 'root'));
    case 'recommend_next':
      return recommendWorks(context.library, context.profileId, stringArg(args, 'query'));
    case 'set_metadata': {
      const workId = numberArg(args, 'workId');
      if (!context.library.getWork(workId)) return { error: `Work ${workId} was not found` };
      const genres = args.genres;
      if (Array.isArray(genres) && genres.every((item) => typeof item === 'string')) {
        context.library.taxonomy.setGenres(workId, genres);
      }
      const libraryId = numberArg(args, 'libraryId');
      if (Number.isFinite(libraryId) && context.library.taxonomy.getLibrary(libraryId)) {
        context.library.taxonomy.assignWork(workId, libraryId);
      }
      const collectionName = stringArg(args, 'collection');
      if (collectionName) {
        const existing = context.library.taxonomy.listCollections()
          .find((row) => row.name === collectionName);
        const collection = existing ?? context.library.taxonomy.createCollection(collectionName, Date.now());
        context.library.taxonomy.addToCollection(collection.id, workId);
      }
      const result = {
        meta: context.library.taxonomy.upsertMeta(workId, {
          year: Number.isFinite(numberArg(args, 'year')) ? numberArg(args, 'year') : undefined,
          studio: stringArg(args, 'studio') || undefined,
          original_title: stringArg(args, 'originalTitle') || undefined,
        }),
        genres: context.library.taxonomy.listGenres(workId),
      };
      // User-edited metadata is protected: lock the work so scans skip it.
      if (booleanArg(args, 'unlock') === true) {
        context.localMedia?.setMetaLocked(workId, false);
        return result;
      }
      context.localMedia?.setMetaLocked(workId, true);
      return result;
    }
    case 'scan_metadata': {
      const workId = numberArg(args, 'workId');
      if (!context.scanMetadata) return { error: 'Metadata scan is not configured' };
      return context.scanMetadata(workId, booleanArg(args, 'force'));
    }
    case 'add_to_collection': {
      const workId = numberArg(args, 'workId');
      const name = stringArg(args, 'name');
      if (!context.library.getWork(workId) || !name) return { error: 'Work or collection name is invalid' };
      const existing = context.library.taxonomy.listCollections().find((row) => row.name === name);
      const collection = existing ?? context.library.taxonomy.createCollection(name, Date.now());
      context.library.taxonomy.addToCollection(collection.id, workId);
      return { collection };
    }
    case 'transcode_unit': {
      if (!context.transcodeUnit) return { error: 'Transcode is not configured' };
      return context.transcodeUnit(numberArg(args, 'unitId'), stringArg(args, 'profile') || '720p');
    }
    case 'ingest_url': {
      if (!context.ingestUrl) return { error: 'URL ingest is not configured' };
      return context.ingestUrl(stringArg(args, 'url'));
    }
    case 'set_library_path': {
      const libraryId = numberArg(args, 'libraryId');
      if (!context.setLibraryPath) return { error: 'Library path update is not configured' };
      if (!Number.isFinite(libraryId)) return { error: 'libraryId is required' };
      if (!Object.prototype.hasOwnProperty.call(args, 'path')) {
        return { error: 'path is required' };
      }
      const rawPath = args.path;
      if (rawPath !== null && typeof rawPath !== 'string') {
        return { error: 'path must be a string or null' };
      }
      if (rawPath !== null && !nodePath.isAbsolute(rawPath)) {
        return { error: `Library path must be absolute: ${rawPath}` };
      }
      try {
        return await context.setLibraryPath(libraryId, rawPath);
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Library path update failed' };
      }
    }
    case 'scan_library': {
      if (!context.scanLibrary) return { error: 'Library scan is not configured' };
      try {
        return await context.scanLibrary();
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Library scan failed' };
      }
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function numberArg(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}
