import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileGptOauthStore, GptOauthSession } from '../src/agent/gpt-oauth.js';
import { createGptOauthClient } from '../src/agent/gpt-client.js';
import { resolveAgentChat } from '../src/agent/resolve.js';
import { buildServer } from '../src/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const dirs: string[] = [];
const stores: SQLiteStore[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of stores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of dirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-oauth-'));
  dirs.push(directory);
  return directory;
}

describe('GPT OAuth', () => {
  it('starts login, exchanges a code, persists the token, and chats with it', async () => {
    const root = tempDir();
    const store = new FileGptOauthStore(path.join(root, 'token.json'));
    const calls: Array<{ url: string; auth?: string; grant?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({
        url,
        auth: headers.get('authorization') ?? undefined,
        grant: new URLSearchParams(body).get('grant_type') ?? undefined,
      });
      if (url.includes('/oauth/token')) {
        return new Response(JSON.stringify({
          access_token: 'access-from-code',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '정리했습니다.', tool_calls: [] } }],
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const session = new GptOauthSession({
      store,
      fetchImpl,
      clientId: 'openplex-client',
      authorizeUrl: 'https://auth.example/oauth/authorize',
      tokenUrl: 'https://auth.example/oauth/token',
      redirectUri: 'http://127.0.0.1:33888/api/agent/oauth/callback',
      chatUrl: 'https://api.openai.com/v1/chat/completions',
    });
    const started = session.start();
    expect(started.authorizeUrl).toContain('https://auth.example/oauth/authorize?');
    expect(started.authorizeUrl).toContain('client_id=openplex-client');
    expect(started.authorizeUrl).toContain('code_challenge=');

    await session.exchange({ code: 'auth-code', state: started.state });
    expect(store.get()?.accessToken).toBe('access-from-code');

    const client = createGptOauthClient({ session, fetchImpl });
    const completion = await client.complete([{ role: 'user', content: '정리해' }]);
    expect(completion.content).toBe('정리했습니다.');
    expect(calls.some((call) => call.grant === 'authorization_code')).toBe(true);
    expect(calls.some((call) => call.auth === 'Bearer access-from-code' && call.url.includes('/chat/completions'))).toBe(true);
  });

  it('fails closed when gpt-oauth mode has no token', async () => {
    const root = tempDir();
    const store = new FileGptOauthStore(path.join(root, 'token.json'));
    const resolved = resolveAgentChat({
      provider: 'gpt-oauth',
      oauth: new GptOauthSession({
        store,
        clientId: 'openplex-client',
        authorizeUrl: 'https://auth.example/oauth/authorize',
        tokenUrl: 'https://auth.example/oauth/token',
        redirectUri: 'http://127.0.0.1/callback',
      }),
    });
    expect(resolved.chat).toBeUndefined();
    expect(resolved.unavailable?.code).toBe('AGENT_OAUTH_REQUIRED');
  });

  it('agent HTTP refuses a turn in gpt-oauth mode without a token and does not use DeepSeek', async () => {
    const root = tempDir();
    const sqlite = new SQLiteStore(path.join(root, 'db.sqlite'));
    stores.push(sqlite);
    let deepseekHit = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes('deepseek')) deepseekHit = true;
      return new Response('missing', { status: 404 });
    }) as typeof fetch;
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store: sqlite,
        mediaRoot: path.join(root, 'media'),
        fetchImpl,
        agentProvider: 'gpt-oauth',
        oauthStorePath: path.join(root, 'token.json'),
        oauthClientId: 'openplex-client',
      },
    });
    apps.push(app);
    await app.ready();

    const denied = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '정리해' },
    });
    expect(denied.statusCode).toBe(503);
    expect(denied.json().error.code).toBe('AGENT_OAUTH_REQUIRED');
    expect(deepseekHit).toBe(false);

    const start = await app.inject({ method: 'GET', url: '/api/agent/oauth/start' });
    expect(start.statusCode).toBe(200);
    expect(start.json().authorizeUrl).toContain('response_type=code');
  });

  it('exchanges OAuth on a live media app then completes an agent turn without restart', async () => {
    const root = tempDir();
    const sqlite = new SQLiteStore(path.join(root, 'db.sqlite'));
    stores.push(sqlite);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? init.body : '';
      if (url.includes('/oauth/token') && new URLSearchParams(body).get('grant_type') === 'authorization_code') {
        return new Response(JSON.stringify({
          access_token: 'live-access',
          refresh_token: 'live-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/chat/completions')) {
        const headers = new Headers(init?.headers);
        if (headers.get('authorization') !== 'Bearer live-access') {
          return new Response('unauthorized', { status: 401 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: '영화를 영화 보관함에 넣었습니다.', tool_calls: [] } }],
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store: sqlite,
        mediaRoot: path.join(root, 'media'),
        fetchImpl,
        agentProvider: 'gpt-oauth',
        oauthStorePath: path.join(root, 'token.json'),
        oauthClientId: 'openplex-client',
        oauthAuthorizeUrl: 'https://auth.example/oauth/authorize',
        oauthTokenUrl: 'https://auth.example/oauth/token',
        oauthChatUrl: 'https://api.openai.com/v1/chat/completions',
      },
    });
    apps.push(app);
    await app.ready();

    const before = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '정리해' },
    });
    expect(before.statusCode).toBe(503);
    expect(before.json().error.code).toBe('AGENT_OAUTH_REQUIRED');

    const start = await app.inject({ method: 'GET', url: '/api/agent/oauth/start' });
    expect(start.statusCode).toBe(200);
    const exchanged = await app.inject({
      method: 'POST',
      url: '/api/agent/oauth/exchange',
      payload: { code: 'auth-code', state: start.json().state },
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json().authorized).toBe(true);

    const turn = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '정리해' },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json().reply).toBe('영화를 영화 보관함에 넣었습니다.');
  });
});
