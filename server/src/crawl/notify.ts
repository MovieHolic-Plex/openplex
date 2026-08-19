import type { IngestAssetRequest, IngestWorkRequest } from '../store/ingest.js';

export async function notifyMediaIngest(options: {
  readonly mediaUrl: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly work?: IngestWorkRequest;
  readonly asset?: IngestAssetRequest;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const base = options.mediaUrl.replace(/\/$/, '');
  if (options.work) {
    await post(fetchImpl, `${base}/api/ingest/work`, headers, options.work);
  }
  if (options.asset) {
    await post(fetchImpl, `${base}/api/ingest/asset`, headers, options.asset);
  }
}

async function post(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Media ingest failed (${response.status})`);
  }
}
