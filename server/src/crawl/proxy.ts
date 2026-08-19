export function proxyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENPLEX_PROXY;
  return typeof value === 'string' && value.length > 0;
}

export function createProxiedFetch(
  env: NodeJS.ProcessEnv = process.env,
  base: typeof fetch = globalThis.fetch,
): typeof fetch {
  const proxy = env.OPENPLEX_PROXY;
  if (!proxy) return base;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('X-OpenPlex-Proxy', '1');
    return base(input, { ...init, headers });
  }) as typeof fetch;
}
