import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentChatClient, ChatMessage } from '../src/agent/loop.js';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

describe('agent HTTP route', () => {
  let app: FastifyInstance;
  let store: SQLiteStore;
  let tempDirectory: string;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-agent-routes-'));
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    const library = new LibraryStore(store.db);
    library.upsertWork({ kind: 'comic', title: '이끼' }, 1);
    const chat: AgentChatClient = {
      async complete(messages: readonly ChatMessage[]) {
        const last = messages[messages.length - 1];
        if (last?.role === 'user') {
          return {
            content: null,
            toolCalls: [{
              id: 't1',
              name: 'search_library',
              arguments: JSON.stringify({ query: '이끼' }),
            }],
          };
        }
        return { content: '보관함에 이끼가 있습니다.', toolCalls: [] };
      },
    };
    app = await buildServer({
      logger: false,
      dependencies: {
        store,
        mediaRoot: path.join(tempDirectory, 'media'),
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
        agentChat: chat,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('runs a turn and persists the tool trace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '이끼 있어?' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reply: '보관함에 이끼가 있습니다.',
      tools: [expect.objectContaining({ name: 'search_library' })],
    });
    const saved = store.db.prepare('SELECT message, reply FROM agent_runs').get() as {
      message: string;
      reply: string;
    };
    expect(saved).toEqual({
      message: '이끼 있어?',
      reply: '보관함에 이끼가 있습니다.',
    });
  });
});

describe('library scan route after extraction', () => {
  it('POST /api/library/scan still responds { items, scanned }', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-scan-route-'));
    const store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    try {
      const app = await buildServer({
        logger: false,
        dependencies: {
          store,
          mediaRoot: path.join(tempDirectory, 'media'),
          fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
        },
      });
      await app.ready();
      const response = await app.inject({ method: 'POST', url: '/api/library/scan' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['items', 'scanned']);
      expect(Array.isArray(body.items)).toBe(true);
      expect(Array.isArray(body.scanned)).toBe(true);
      await app.close();
    } finally {
      store.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
