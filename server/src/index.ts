import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { HlsGateway } from './gateway/hls-gateway.js';
import { SQLiteStore } from './store/sqlite-store.js';
import { LocalMediaStore } from './store/local-media-store.js';
import {
  installApiErrorHandlers,
  registerApiRoutes,
  type RouteDependencies,
} from './routes/index.js';
import { assertRemoteAuth, LOOPBACK_HOST, registerTokenAuth } from './auth/token.js';

export { LOOPBACK_HOST };

export interface BuildServerOptions {
  logger?: boolean;
  dependencies?: RouteDependencies;
  gateway?: HlsGateway;
  serveStatic?: boolean;
  authToken?: string;
}

export interface StartServerOptions extends BuildServerOptions {
  port?: number;
  host?: string;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options.logger ?? true });
  const authToken = options.authToken;

  await fastify.register(cors, { origin: '*' });
  await fastify.register(sensible);

  fastify.get('/health', async () => ({
    status: 'ok',
    role: 'media',
    timestamp: new Date().toISOString(),
  }));

  registerTokenAuth(fastify, authToken, {
    isPublicLibrary: () => visibilityStore?.getLibraryVisibility() === 'public',
  });
  const visibilityStore = options.dependencies?.store instanceof SQLiteStore
    ? (options.dependencies?.localMedia ?? new LocalMediaStore(options.dependencies.store.db))
    : undefined;
  if (options.gateway) {
    await options.gateway.register(fastify);
  }
  await registerApiRoutes(fastify, {
    ...options.dependencies,
    gateway: options.gateway,
    authToken,
    role: 'media',
    crawlUrl: options.dependencies?.crawlUrl ?? process.env.OPENPLEX_CRAWL_URL,
  });

  const serveStatic = options.serveStatic ?? process.env.NODE_ENV !== 'test';
  if (serveStatic) {
    const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
    await fastify.register(fastifyStatic, {
      root: clientDist,
      index: false,
    });
  }

  installApiErrorHandlers(fastify, serveStatic);
  return fastify;
}

/** Listens on loopback by default. Non-loopback bind requires OPENPLEX_AUTH_TOKEN. */
export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  const host = options.host ?? process.env.OPENPLEX_BIND ?? LOOPBACK_HOST;
  const authToken = options.authToken ?? process.env.OPENPLEX_AUTH_TOKEN;
  assertRemoteAuth(host, authToken);

  const server = await buildServer({ ...options, authToken });
  try {
    await server.listen({ port: options.port ?? 33888, host });
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && fileURLToPath(import.meta.url) === path.resolve(entrypoint);
}

if (process.env.NODE_ENV !== 'test' && isMainModule()) {
  try {
    const server = await startServer({
      port: Number(process.env.PORT) || 33888,
      dependencies: process.env.OPENPLEX_DATA_PATH
        ? { store: new SQLiteStore(process.env.OPENPLEX_DATA_PATH) }
        : undefined,
    });
    server.log.info(`Server running at ${server.listeningOrigin}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
