import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';
import { LibraryStore } from '../src/store/library-store.js';

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

describe('MVP local import → organize → play → agent', () => {
  it('ingests a year-titled video into 영화, streams /media/, and fail-closes oauth', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-mvp-'));
    dirs.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    stores.push(store);
    new LibraryStore(store.db).upsertWork({ kind: 'video_series', title: '시그널' }, 1);
    const file = path.join(directory, '올드보이.2003.1080p.mp4');
    fs.writeFileSync(file, Buffer.from('mp4-bytes'));

    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        mediaRoot: path.join(directory, 'media'),
        agentProvider: 'gpt-oauth',
        oauthStorePath: path.join(directory, 'token.json'),
        oauthClientId: 'openplex-client',
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      },
    });
    apps.push(app);
    await app.ready();

    const libraries = await app.inject({ method: 'GET', url: '/api/libraries' });
    expect(libraries.statusCode).toBe(200);
    expect(libraries.json().items.map((row: { name: string }) => row.name)).toEqual(['영화', '시리즈', '만화']);
    const movieLib = libraries.json().items.find((row: { kind: string }) => row.kind === 'movie');

    const ingested = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: file },
    });
    expect(ingested.statusCode).toBe(200);
    expect(ingested.json().items[0].title).toBe('올드보이');
    expect(ingested.json().items[0].title).not.toContain('1080p');
    const workId = ingested.json().items[0].id as number;

    const movieWorks = await app.inject({
      method: 'GET',
      url: `/api/libraries/${movieLib.id}/works`,
    });
    expect(movieWorks.statusCode).toBe(200);
    expect(movieWorks.json().items.map((row: { title: string }) => row.title)).toEqual(['올드보이']);
    expect(movieWorks.json().items.map((row: { title: string }) => row.title)).not.toContain('시그널');

    const detail = await app.inject({ method: 'GET', url: `/api/library/${workId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().work.title).toBe('올드보이');
    expect(detail.json().meta.year).toBe(2003);

    const stream = await app.inject({ method: 'POST', url: `/api/stream/movie/${workId}/0` });
    expect(stream.statusCode).toBe(200);
    expect(stream.json().source).toBe('local');
    expect(stream.json().fileUrl).toBe(`/media/movie/${workId}/0/media.mp4`);
    const media = await app.inject({ method: 'GET', url: stream.json().fileUrl });
    expect(media.statusCode).toBe(200);
    expect(media.rawPayload).toEqual(Buffer.from('mp4-bytes'));

    const denied = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '정리해' },
    });
    expect(denied.statusCode).toBe(503);
    expect(denied.json().error.code).toBe('AGENT_OAUTH_REQUIRED');
  });

  it('completes an agent turn when chat is supplied', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-mvp-agent-'));
    dirs.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    stores.push(store);
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: {
        store,
        mediaRoot: path.join(directory, 'media'),
        agentChat: {
          async complete() {
            return { content: '보관함을 정리했습니다.', toolCalls: [] };
          },
        },
      },
    });
    apps.push(app);
    await app.ready();
    const turn = await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: '정리해' },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json().reply).toBe('보관함을 정리했습니다.');
  });
});
