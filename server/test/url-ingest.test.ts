import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { isIngestableUrl } from '../src/ingest/url.js';
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

describe('URL ingest', () => {
  it('accepts a local media file and rejects a bare site homepage', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-url-'));
    dirs.push(directory);
    const file = path.join(directory, '이끼.2013.mp4');
    fs.writeFileSync(file, Buffer.from('mp4'));
    expect(isIngestableUrl(file)).toBe(true);
    expect(isIngestableUrl('https://example.com/watch/123')).toBe(false);
    expect(isIngestableUrl('https://cdn.example/film.mkv')).toBe(true);
  });

  it('imports a local video path into the movie library', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-url-app-'));
    dirs.push(directory);
    const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
    stores.push(store);
    const file = path.join(directory, '이끼.2013.mp4');
    fs.writeFileSync(file, Buffer.from('mp4'));
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot: path.join(directory, 'media') },
    });
    apps.push(app);
    await app.ready();

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: 'https://newtoki.example/' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('URL_NOT_INGESTABLE');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: file },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().items[0].title).toBe('이끼');
    expect(imported.json().items[0].kind).toBe('movie');
  });
});
