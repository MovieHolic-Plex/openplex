import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

describe('settings routes', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-settings-'));
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    app = await buildServer({
      logger: false,
      dependencies: {
        store,
        mediaRoot: path.join(tempDirectory, 'media'),
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('GET /api/settings defaults to private with the seeded libraries', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.visibility).toBe('private');
    expect(body.bindUnchanged).toBe(true);
    expect(body.visitor).toBe(false);
    expect(typeof body.originHint).toBe('string');
    expect(body.libraries).toHaveLength(3);
    for (const library of body.libraries) {
      expect(library).toEqual(expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        kind: expect.any(String),
        path: null,
      }));
    }
  });

  it('PUT public persists and GET reflects it', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { visibility: 'public' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().visibility).toBe('public');

    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json().visibility).toBe('public');
  });

  it('rejects an invalid visibility value with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { visibility: 'open' },
    });
    expect(response.statusCode).toBe(400);
    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json().visibility).toBe('private');
  });

  it('rejects additional properties with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { visibility: 'public', scan: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an unknown library id and writes nothing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { libraries: [{ id: 9999, path: null }] },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('LIBRARY_NOT_FOUND');
  });

  it('returns 400 for a relative library path', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { libraries: [{ id: 1, path: 'relative/dir' }] },
    });
    expect(response.statusCode).toBe(400);
    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json().libraries.find((row: { id: number }) => row.id === 1).path).toBeNull();
  });

  it('roundtrips library paths through /api/settings and /api/libraries', async () => {
    const moviesRoot = path.join(tempDirectory, 'movies');
    fs.mkdirSync(moviesRoot, { recursive: true });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { libraries: [{ id: 1, path: moviesRoot }, { id: 2, path: '' }] },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json();
    expect(putBody.libraries.find((row: { id: number }) => row.id === 1).path).toBe(moviesRoot);
    // Empty string clears the path to null.
    expect(putBody.libraries.find((row: { id: number }) => row.id === 2).path).toBeNull();

    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.json().libraries.find((row: { id: number }) => row.id === 1).path)
      .toBe(moviesRoot);

    const libraries = await app.inject({ method: 'GET', url: '/api/libraries' });
    expect(libraries.statusCode).toBe(200);
    expect(libraries.json().items.find((row: { id: number }) => row.id === 1).path)
      .toBe(moviesRoot);
  });

  it('keeps the schema at user_version 6', () => {
    expect(store.db.pragma('user_version', { simple: true })).toBe(6);
  });
});

describe('metadata provider settings', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-settings-meta-'));
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    app = await buildServer({
      logger: false,
      dependencies: {
        store,
        mediaRoot: path.join(tempDirectory, 'media'),
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('defaults to the full provider list', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.statusCode).toBe(200);
    expect(response.json().metadataProviders)
      .toEqual(['tmdb', 'kmdb', 'daum', 'naver', 'watcha']);
  });

  it('persists metadataProviders through PUT and reflects them in GET', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { metadataProviders: ['tmdb'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().metadataProviders).toEqual(['tmdb']);
    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json().metadataProviders).toEqual(['tmdb']);
  });

  it('drops unknown provider names on save', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { metadataProviders: ['tmdb', 'bogus', 'daum'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().metadataProviders).toEqual(['tmdb', 'daum']);
  });

  it('exposes kmdbConfigured as a boolean without ever leaking the key', async () => {
    const previous = process.env.KMDB_API_KEY;
    try {
      delete process.env.KMDB_API_KEY;
      const without = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(without.json().kmdbConfigured).toBe(false);
      process.env.KMDB_API_KEY = 'secret-kmdb-key-value';
      const withKey = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(withKey.json().kmdbConfigured).toBe(true);
      expect(JSON.stringify(withKey.json())).not.toContain('secret-kmdb-key-value');
    } finally {
      if (previous === undefined) delete process.env.KMDB_API_KEY;
      else process.env.KMDB_API_KEY = previous;
    }
  });

  it('rejects kmdbConfigured in a PUT body with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { kmdbConfigured: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects non-string provider entries with 400', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { metadataProviders: ['tmdb', 5] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('keeps the schema at user_version 6 after provider settings writes', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { metadataProviders: ['kmdb'] },
    });
    expect(store.db.pragma('user_version', { simple: true })).toBe(6);
  });
});
