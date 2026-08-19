import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LibraryStore } from '../store/library-store.js';
import {
  KNOWN_METADATA_PROVIDERS,
  type LibraryVisibility,
  type LocalMediaStore,
  type MetadataProviderName,
} from '../store/local-media-store.js';
import { ApiError } from './errors.js';
import { OPENPLEX_VISITOR } from '../auth/token.js';

const putBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visibility: { type: 'string', enum: ['private', 'public'] },
    libraries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'path'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer', minimum: 1 },
          path: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    metadataProviders: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

export interface SettingsRoutesOptions {
  readonly localMedia: LocalMediaStore;
  readonly library: LibraryStore;
  readonly listenHint?: string;
  /** Derived from env KMDB_API_KEY; GET-only, never stored. Read lazily. */
  readonly kmdbApiKey?: string | (() => string | undefined);
}

type LibraryPathUpdate = { id: number; path: string | null };

function settingsPayload(
  options: SettingsRoutesOptions,
  request: FastifyRequest,
): {
  visibility: LibraryVisibility;
  libraries: Array<{ id: number; name: string; kind: string; path: string | null }>;
  originHint: string | null;
  bindUnchanged: true;
  visitor: boolean;
  metadataProviders: MetadataProviderName[];
  kmdbConfigured: boolean;
} {
  const host = request.headers.host;
  return {
    visibility: options.localMedia.getLibraryVisibility(),
    libraries: options.library.taxonomy.listLibraries().map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      path: row.path,
    })),
    originHint: host ? `${request.protocol}://${host}` : (options.listenHint ?? null),
    bindUnchanged: true,
    visitor: request[OPENPLEX_VISITOR] === true,
    metadataProviders: options.localMedia.getMetadataProviders(),
    kmdbConfigured: typeof options.kmdbApiKey === 'function'
      ? Boolean(options.kmdbApiKey())
      : Boolean(options.kmdbApiKey),
  };
}

function normalizeLibraryPath(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!path.isAbsolute(trimmed)) {
    throw new ApiError(400, 'LIBRARY_PATH_NOT_ABSOLUTE', `Library path must be absolute: ${trimmed}`);
  }
  return trimmed;
}

export function registerSettingsRoutes(
  fastify: FastifyInstance,
  options: SettingsRoutesOptions,
): void {
  fastify.get('/api/settings', async (request) => settingsPayload(options, request));

  fastify.put(
    '/api/settings',
    {
      schema: { body: putBodySchema },
      preValidation: async (request) => {
        // Fastify's default AJV config strips unknown properties instead of
        // rejecting them, so enforce additionalProperties: false explicitly
        // against the raw body before validation runs.
        const raw = request.body as Record<string, unknown> | undefined;
        if (raw !== null && typeof raw === 'object') {
          for (const key of Object.keys(raw)) {
            if (key !== 'visibility' && key !== 'libraries' && key !== 'metadataProviders') {
              throw new ApiError(400, 'SETTINGS_UNKNOWN_PROPERTY', `Unknown settings property: ${key}`);
            }
          }
          if (
            raw.metadataProviders !== undefined
            && (!Array.isArray(raw.metadataProviders)
              || raw.metadataProviders.some((name) => typeof name !== 'string'))
          ) {
            throw new ApiError(
              400,
              'SETTINGS_METADATA_PROVIDERS_INVALID',
              'metadataProviders must be an array of provider names',
            );
          }
        }
      },
    },
    async (request) => {
      const body = request.body as {
        visibility?: LibraryVisibility;
        libraries?: LibraryPathUpdate[];
        metadataProviders?: string[];
      };

      if (body.metadataProviders !== undefined) {
        // The enum schema already rejects unknown names; normalize defensively
        // anyway so only known provider names are ever persisted.
        const known = body.metadataProviders.filter((name): name is MetadataProviderName =>
          (KNOWN_METADATA_PROVIDERS as readonly string[]).includes(name));
        options.localMedia.setMetadataProviders(known);
      }

      if (body.visibility !== undefined) {
        options.localMedia.setLibraryVisibility(body.visibility);
      }

      if (body.libraries !== undefined) {
        // Validate every entry before writing anything, then apply in one transaction.
        const updates = body.libraries.map((entry) => {
          if (!options.library.taxonomy.getLibrary(entry.id)) {
            throw new ApiError(404, 'LIBRARY_NOT_FOUND', `Library ${entry.id} was not found`);
          }
          return { id: entry.id, path: normalizeLibraryPath(entry.path) };
        });
        options.library.taxonomy.setLibraryPaths(updates);
      }

      return settingsPayload(options, request);
    },
  );
}
