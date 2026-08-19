import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { HlsGateway } from '../gateway/hls-gateway.js';
import { LOOPBACK_HOST } from '../auth/token.js';
import {
  installApiErrorHandlers,
  registerApiRoutes,
  type RouteDependencies,
} from '../routes/index.js';
import { SQLiteStore } from '../store/sqlite-store.js';
import { registerTokenAuth } from '../auth/token.js';
import { createProxiedFetch } from './proxy.js';

export const CRAWL_DEFAULT_PORT = 33889;

export interface BuildCrawlServerOptions {
  logger?: boolean;
  dependencies?: RouteDependencies;
  gateway?: HlsGateway;
  serveStatic?: boolean;
  authToken?: string;
}

export interface StartCrawlServerOptions extends BuildCrawlServerOptions {
  port?: number;
}

export async function buildCrawlServer(options: BuildCrawlServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: options.logger ?? true });
  const authToken = options.authToken;

  await fastify.register(cors, { origin: '*' });
  await fastify.register(sensible);

  fastify.get('/health', async () => ({
    status: 'ok',
    role: 'crawl',
    timestamp: new Date().toISOString(),
  }));

  registerTokenAuth(fastify, authToken);
  const gateway = options.gateway ?? new HlsGateway();
  await gateway.register(fastify);
  await registerApiRoutes(fastify, {
    ...options.dependencies,
    gateway,
    authToken,
    role: 'crawl',
  });

  installApiErrorHandlers(fastify, false);
  return fastify;
}

/** Crawl never binds off loopback. The media process is the LAN face. */
export async function startCrawlServer(options: StartCrawlServerOptions = {}): Promise<FastifyInstance> {
  const server = await buildCrawlServer(options);
  try {
    await server.listen({
      port: options.port ?? CRAWL_DEFAULT_PORT,
      host: LOOPBACK_HOST,
    });
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
    const upstreamUrl = process.env.OPENPLEX_UPSTREAM_URL;
    const server = await startCrawlServer({
      port: Number(process.env.OPENPLEX_CRAWL_PORT) || CRAWL_DEFAULT_PORT,
      authToken: process.env.OPENPLEX_AUTH_TOKEN,
      dependencies: {
        role: 'crawl',
        mediaUrl: process.env.OPENPLEX_MEDIA_URL,
        store: process.env.OPENPLEX_DATA_PATH
          ? new SQLiteStore(process.env.OPENPLEX_DATA_PATH)
          : undefined,
        mediaRoot: process.env.OPENPLEX_MEDIA_PATH,
        fetchImpl: createProxiedFetch(),
      },
    });
    server.log.info(`Crawl server running at ${server.listeningOrigin}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
