import type { FastifyInstance } from 'fastify';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from(tag)]);

function storeZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localFull = Buffer.concat([local, nameBytes, data]);
    locals.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));
    offset += localFull.length;
  }
  const centralBlob = Buffer.concat(centrals);
  const localBlob = Buffer.concat(locals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBlob.length, 12);
  end.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, end]);
}

describe('library import and comic page routes', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lib-routes-'));
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

  it('imports a cbz and serves the first page bytes', async () => {
    const comicDir = path.join(tempDirectory, 'library', '테스트만화');
    fs.mkdirSync(comicDir, { recursive: true });
    fs.writeFileSync(path.join(comicDir, '1화.cbz'), storeZip({
      '01.jpg': jpeg('page-one'),
      '02.jpg': jpeg('page-two'),
    }));

    const imported = await app.inject({
      method: 'POST',
      url: '/api/library/import',
      payload: { root: path.join(tempDirectory, 'library') },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().items[0].title).toBe('테스트만화');

    const list = await app.inject({ method: 'GET', url: '/api/library?kind=comic' });
    expect(list.json().items).toHaveLength(1);
    const workId = list.json().items[0].id as number;
    const detail = await app.inject({ method: 'GET', url: `/api/library/${workId}` });
    const unitId = detail.json().units[0].id as number;

    const meta = await app.inject({ method: 'GET', url: `/api/comics/${unitId}` });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().pageCount).toBe(2);

    const page = await app.inject({ method: 'GET', url: `/api/comics/${unitId}/pages/0` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/image\/jpeg/);
    expect(page.rawPayload).toEqual(jpeg('page-one'));

    const progress = await app.inject({
      method: 'PUT',
      url: `/api/library/units/${unitId}/progress`,
      payload: { pageIndex: 1, pageCount: 2 },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().progress.page_index).toBe(1);
  });
});
