/**
 * Cookie-free HTTP wrapper for metadata providers.
 *
 * Rules enforced here (plan: openplex-library-ux-meta todo 2):
 * - Sends ONLY a browser-like User-Agent and `Accept-Language: ko-KR`.
 * - Response `set-cookie` headers are ignored entirely: never stored, never replayed.
 * - Per-provider politeness: minimum 1000ms between requests to the same
 *   provider key, and concurrency 1 per provider.
 * - `sleep`/`now` are injectable so tests use a fake clock (no real waiting).
 */

export type FetchLike = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    redirect?: 'follow';
    signal?: AbortSignal;
  },
) => Promise<Response>;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export type PoliteClock = {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

const defaultClock: PoliteClock = {
  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
  now: () => Date.now(),
};

export type HttpFetchResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number };

export type PoliteGet = (
  providerKey: string,
  url: string,
  timeoutMs?: number,
) => Promise<HttpFetchResult>;

const MIN_INTERVAL_MS = 1000;

/**
 * Build a polite GET function. Politeness state is per provider key within
 * this instance; create one instance per provider process.
 */
export function createPoliteFetch(
  fetchImpl: FetchLike,
  clock: Partial<PoliteClock> = {},
): PoliteGet {
  const sleep = clock.sleep ?? defaultClock.sleep;
  const now = clock.now ?? defaultClock.now;
  const lastRequestAt = new Map<string, number>();
  const tail = new Map<string, Promise<unknown>>();

  async function request(
    providerKey: string,
    url: string,
    timeoutMs: number,
  ): Promise<HttpFetchResult> {
    const startedAt = now();
    const previous = lastRequestAt.get(providerKey);
    if (previous !== undefined) {
      const wait = previous + MIN_INTERVAL_MS - startedAt;
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt.set(providerKey, now());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          // ONLY these two headers. No cookie header is ever added because
          // set-cookie responses are dropped below and nothing is stored.
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'ko-KR',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = await response.text();
      // set-cookie is deliberately NOT read or stored.
      if (response.ok) return { ok: true, status: response.status, body };
      return { ok: false, status: response.status };
    } catch {
      // Timeout (abort) or network rejection.
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return function politeGet(providerKey, url, timeoutMs = 10000) {
    const previousTail = tail.get(providerKey) ?? Promise.resolve();
    const run = previousTail.then(
      () => request(providerKey, url, timeoutMs),
      () => request(providerKey, url, timeoutMs),
    );
    tail.set(
      providerKey,
      run.catch(() => undefined),
    );
    return run;
  };
}

/** Map an HttpFetchResult to the MetaLookup 'blocked' shape when failed. */
export function blockedStatus(result: HttpFetchResult): number {
  return result.ok ? 0 : result.status;
}
