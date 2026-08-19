import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../routes/errors.js';

const PROXY_PREFIXES = ['/api/home', '/api/category', '/api/search', '/api/title', '/api/stream', '/hls/'] as const;

export function shouldProxyToCrawl(path: string): boolean {
  return PROXY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}`) || path.startsWith(prefix));
}

export async function proxyToCrawl(
  request: FastifyRequest,
  reply: FastifyReply,
  options: {
    readonly crawlUrl: string;
    readonly token?: string;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const target = new URL(request.url, options.crawlUrl.replace(/\/$/, '/'));
  const headers = new Headers();
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  const profile = request.headers['x-profile-id'];
  if (typeof profile === 'string') headers.set('X-Profile-Id', profile);
  if (request.headers.accept) headers.set('Accept', String(request.headers.accept));
  const method = request.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  if (hasBody) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetchImpl(target, {
      method,
      headers,
      body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError(503, 'CRAWL_UNAVAILABLE', 'Crawl server is unavailable');
    }
    throw error;
  }
  const location = response.headers.get('location');
  if (location && response.status >= 300 && response.status < 400) {
    void reply.code(response.status).header('location', location).send();
    return;
  }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (contentType.includes('application/json')) {
    const text = buffer.toString('utf8');
    void reply.code(response.status).type(contentType).send(text.length > 0 ? JSON.parse(text) : {});
    return;
  }
  void reply.code(response.status).type(contentType).send(buffer);
}

export function crawlPath(url: string): string {
  return url.split('?')[0] ?? url;
}
