import { HLS_UPSTREAM_HEADERS } from '../gateway/hls-gateway.js';

export class DownloadError extends Error {
  readonly name = 'DownloadError';
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

export function isExpiredToken(error: unknown): boolean {
  return error instanceof DownloadError
    && (error.statusCode === 401 || error.statusCode === 403);
}

export async function fetchBuffer(
  url: URL,
  signal: AbortSignal,
  label: string,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    signal,
    redirect: 'follow',
    headers: HLS_UPSTREAM_HEADERS,
  });
  if (!response.ok) throw new DownloadError(`Unable to load ${label} (${response.status})`, response.status);
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchText(
  url: URL,
  signal: AbortSignal,
  label: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  return (await fetchBuffer(url, signal, label, fetchImpl)).toString('utf8');
}

export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  }));
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DownloadError('Download cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DownloadError('Download cancelled'));
    }, { once: true });
  });
}
