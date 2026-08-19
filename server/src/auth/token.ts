import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../routes/errors.js';

export const LOOPBACK_HOST = '127.0.0.1' as const;
export const LOOPBACK_BIND_HOSTS = [LOOPBACK_HOST, '::1', 'localhost'] as const;

export function isLoopbackBind(host: string): boolean {
  return (LOOPBACK_BIND_HOSTS as readonly string[]).includes(host);
}

export function assertRemoteAuth(host: string, token: string | undefined): void {
  if (isLoopbackBind(host)) return;
  if (typeof token === 'string' && token.length > 0) return;
  throw new Error('OPENPLEX_AUTH_TOKEN is required when OPENPLEX_BIND is not loopback');
}

export function readRequestToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const bearer = /^Bearer\s+(\S+)/i.exec(authorization);
    if (bearer?.[1]) return bearer[1];
    const mediaBrowser = /Token="?([^",\s]+)"?/i.exec(authorization);
    if (mediaBrowser?.[1]) return mediaBrowser[1];
  }
  const named = firstHeader(
    request.headers['x-openplex-token']
      ?? request.headers['x-emby-token']
      ?? request.headers['x-mediabrowser-token'],
  );
  if (named) return named;
  const query = request.query;
  if (query !== null && typeof query === 'object' && 'token' in query) {
    const token = (query as { token?: unknown }).token;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return undefined;
}

export const OPENPLEX_VISITOR: unique symbol = Symbol('openplexVisitor');

declare module 'fastify' {
  interface FastifyRequest {
    [OPENPLEX_VISITOR]?: boolean;
  }
}

const DIGITS = '[1-9][0-9]*';

const VISITOR_ALLOWLIST: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/api\/settings$/],
  ['GET', /^\/api\/library$/],
  ['GET', new RegExp(`^/api/library/${DIGITS}$`)],
  ['GET', /^\/api\/libraries$/],
  ['GET', new RegExp(`^/api/libraries/${DIGITS}/works$`)],
  ['GET', /^\/api\/collections$/],
  ['GET', new RegExp(`^/api/library/units/${DIGITS}/binding$`)],
  ['GET', new RegExp(`^/api/library/units/${DIGITS}/media$`)],
  ['GET', new RegExp(`^/api/comics/${DIGITS}$`)],
  ['GET', new RegExp(`^/api/comics/${DIGITS}/pages/${DIGITS}$`)],
  ['GET', /^\/api\/home$/],
  ['POST', new RegExp(`^/api/library/units/${DIGITS}/stream$`)],
  ['POST', /^\/api\/history$/],
  ['PUT', new RegExp(`^/api/library/units/${DIGITS}/progress$`)],
];

export function isVisitorAllowlisted(method: string, pathname: string): boolean {
  return VISITOR_ALLOWLIST.some(([allowed, pattern]) => method === allowed && pattern.test(pathname));
}

export interface TokenAuthOptions {
  isPublicLibrary?: () => boolean;
}

export function registerTokenAuth(
  fastify: FastifyInstance,
  token: string | undefined,
  options: TokenAuthOptions = {},
): void {
  if (token === undefined || token.length === 0) return;
  fastify.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (!requiresAccessToken(path)) return;
    if (readRequestToken(request) === token) return;
    if (options.isPublicLibrary?.() && isVisitorAllowlisted(request.method, path)) {
      request[OPENPLEX_VISITOR] = true;
      return;
    }
    throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  });
}

function requiresAccessToken(path: string): boolean {
  if (path.endsWith('/Users/AuthenticateByName')) return false;
  if (path.endsWith('/System/Info/Public')) return false;
  return path.startsWith('/api/')
    || path.startsWith('/hls/')
    || path.startsWith('/media/')
    || path.startsWith('/jellyfin/')
    || path.startsWith('/emby/');
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}
