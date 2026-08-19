import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const mp4Bytes = Buffer.from('tiny-fake-mp4-payload-0123456789');

describe('library stream routes', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;
  let library: LibraryStore;
  let mediaRoot: string;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lib-stream-'));
    mediaRoot = path.join(tempDirectory, 'media');
    fs.mkdirSync(mediaRoot, { recursive: true });
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    app = await buildServer({
      logger: false,
      dependencies: {
        store,
        mediaRoot,
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      },
    });
    await app.ready();
    library = new LibraryStore(store.db);
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  function seedUnitWithAsset(assetPath: string): number {
    const work = library.upsertWork({ kind: 'movie', title: 'Local Movie' }, 1_000);
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 0,
      title: 'Local Movie',
    }, 1_001);
    library.addAsset({ unitId: unit.id, kind: 'file', path: assetPath, sizeBytes: mp4Bytes.length }, 1_002);
    return unit.id;
  }

  it('creates a local stream session for a unit with a file asset', async () => {
    fs.writeFileSync(path.join(mediaRoot, 'movie.mp4'), mp4Bytes);
    const unitId = seedUnitWithAsset('movie.mp4');

    const response = await app.inject({
      method: 'POST',
      url: `/api/library/units/${unitId}/stream`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { source: string; fileUrl: string; title: string; sessionId: string };
    expect(body.source).toBe('local');
    expect(body.fileUrl).toBe(`/api/library/units/${unitId}/media`);
    expect(body.title).toBe('Local Movie');
    expect(body.sessionId).toBe(`local-unit:${unitId}`);
  });

  it('serves the full media bytes', async () => {
    fs.writeFileSync(path.join(mediaRoot, 'movie.mp4'), mp4Bytes);
    const unitId = seedUnitWithAsset('movie.mp4');

    const response = await app.inject({
      method: 'GET',
      url: `/api/library/units/${unitId}/media`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('video/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.rawPayload.equals(mp4Bytes)).toBe(true);
  });

  it('serves a byte range with 206', async () => {
    fs.writeFileSync(path.join(mediaRoot, 'movie.mp4'), mp4Bytes);
    const unitId = seedUnitWithAsset('movie.mp4');

    const response = await app.inject({
      method: 'GET',
      url: `/api/library/units/${unitId}/media`,
      headers: { range: 'bytes=0-3' },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-length']).toBe('4');
    expect(response.headers['content-range']).toBe(`bytes 0-3/${mp4Bytes.length}`);
    expect(response.rawPayload.equals(mp4Bytes.subarray(0, 4))).toBe(true);
  });

  it('returns 404 for a missing unit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/library/units/9999/stream',
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects asset paths escaping the media root', async () => {
    fs.writeFileSync(path.join(tempDirectory, 'secret.mp4'), mp4Bytes);
    const unitId = seedUnitWithAsset('../secret.mp4');

    const streamResponse = await app.inject({
      method: 'POST',
      url: `/api/library/units/${unitId}/stream`,
    });
    expect(streamResponse.statusCode).toBe(404);

    const mediaResponse = await app.inject({
      method: 'GET',
      url: `/api/library/units/${unitId}/media`,
    });
    expect(mediaResponse.statusCode).toBe(404);
  });
});
