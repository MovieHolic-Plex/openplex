import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgentTurn, type AgentChatClient } from '../src/agent/loop.js';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SCHEMA_VERSION, SQLiteStore } from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-adapters-'));
  tempDirectories.push(directory);
  return path.join(directory, 'openplex.db');
}

function openStore(dbPath = tempDatabase()): SQLiteStore {
  const store = new SQLiteStore(dbPath);
  openStores.push(store);
  return store;
}

function scriptedChat(script: Array<{
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}>): AgentChatClient {
  let step = 0;
  return {
    async complete() {
      const next = script[step] ?? { content: 'done' };
      step += 1;
      return {
        content: next.content ?? null,
        toolCalls: next.toolCalls ?? [],
      };
    },
  };
}

describe('source adapter registry', () => {
  it('seeds local on a fresh schema v6 database', () => {
    const store = openStore();
    const library = new LibraryStore(store.db);

    expect(store.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(6);
    expect(library.listSourceAdapters()).toEqual([
      {
        name: 'local',
        enabled: true,
        kind: 'comic',
        kinds: ['comic'],
        config_json: '{"kinds":["comic"]}',
      },
    ]);
  });

  it('migrates a v4 database to v5 and seeds adapters', () => {
    const dbPath = tempDatabase();
    const previous = openStore(dbPath);
    previous.db.exec('DROP TABLE source_adapters');
    previous.db.pragma('user_version = 4');
    previous.close();

    const migrated = openStore(dbPath);
    expect(migrated.db.pragma('user_version', { simple: true })).toBe(6);
    expect(new LibraryStore(migrated.db).listSourceAdapters().map((row) => row.name))
      .toEqual(['local']);
  });

  it('lists adapters from the table and PATCH toggles enabled', async () => {
    const store = openStore();
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot: path.join(path.dirname(store.db.name), 'media') },
    });
    apps.push(app);
    await app.ready();

    const listed = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([
      { name: 'local', enabled: true, kind: 'comic', kinds: ['comic'] },
    ]);

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/sources/local',
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().item.enabled).toBe(false);

    const again = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(again.json().items.find((row: { name: string }) => row.name === 'local').enabled).toBe(false);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/sources/pirate',
      payload: { enabled: true },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SOURCE_NOT_FOUND');
  });

  it('rejects search_source on a disabled adapter and restores after enable', async () => {
    const store = openStore();
    const library = new LibraryStore(store.db);
    library.setSourceAdapterEnabled('local', false);
    const searched: string[] = [];

    const disabled = await runAgentTurn({
      profileId: 1,
      message: '찾아',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'c1',
            name: 'search_source',
            arguments: JSON.stringify({ adapter: 'local', query: '이끼' }),
          }],
        },
        { content: '꺼져 있습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async (adapter) => {
        searched.push(adapter);
        return [];
      },
      importLocal: async () => [],
      adapterEnabled: (name) => library.isSourceAdapterEnabled(name),
    });

    expect(searched).toEqual([]);
    expect(JSON.stringify(disabled.tools[0]?.result)).toMatch(/adapter disabled/i);

    library.setSourceAdapterEnabled('local', true);
    const enabled = await runAgentTurn({
      profileId: 1,
      message: '다시',
      library,
      chat: scriptedChat([
        {
          toolCalls: [{
            id: 'c2',
            name: 'search_source',
            arguments: JSON.stringify({ adapter: 'local', query: '이끼' }),
          }],
        },
        { content: '찾았습니다.' },
      ]),
      enqueueDownload: async () => undefined,
      searchSource: async (adapter) => {
        searched.push(adapter);
        return [];
      },
      importLocal: async () => [],
      adapterEnabled: (name) => library.isSourceAdapterEnabled(name),
    });

    expect(searched).toEqual(['local']);
    expect(enabled.tools[0]?.result).toEqual([]);
  });
});
