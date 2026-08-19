import type { FastifyInstance } from 'fastify';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
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

describe('library scan across media kinds', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lib-scan-'));
    dbPath = path.join(tempDirectory, 'db.sqlite');
    store = new SQLiteStore(dbPath);
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

  it('scans movie, show, and comic libraries and reports missing paths', async () => {
    const movieDir = path.join(tempDirectory, 'movies');
    const showDir = path.join(tempDirectory, 'shows');
    const comicDir = path.join(tempDirectory, 'comics');
    fs.mkdirSync(movieDir, { recursive: true });
    fs.mkdirSync(path.join(showDir, 'ShowName'), { recursive: true });
    fs.mkdirSync(path.join(comicDir, 'Title'), { recursive: true });
    fs.writeFileSync(path.join(movieDir, 'Oldboy.2003.mp4'), Buffer.from('movie-bytes'));
    fs.writeFileSync(path.join(showDir, 'ShowName', 'S01E01.mkv'), Buffer.from('ep-one'));
    fs.writeFileSync(path.join(showDir, 'ShowName', 'S01E02.mkv'), Buffer.from('ep-two'));
    fs.writeFileSync(path.join(comicDir, 'Title', '1화.cbz'), storeZip({
      '01.jpg': jpeg('page-one'),
    }));

    const settings = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        libraries: [
          { id: 1, path: movieDir },
          { id: 2, path: showDir },
          { id: 3, path: comicDir },
        ],
      },
    });
    expect(settings.statusCode).toBe(200);

    const scan = await app.inject({ method: 'POST', url: '/api/library/scan' });
    expect(scan.statusCode).toBe(200);
    const scanned = scan.json().scanned as Array<{ libraryId: number; files: number; error?: string }>;
    expect(scanned).toHaveLength(3);
    expect(scanned.every((row) => row.error === undefined)).toBe(true);

    const movies = await app.inject({ method: 'GET', url: '/api/library?kind=movie' });
    expect(movies.json().items).toHaveLength(1);
    const movie = movies.json().items[0];
    expect(movie.title).toBe('Oldboy');
    const movieDetail = await app.inject({ method: 'GET', url: `/api/library/${movie.id}` });
    expect(movieDetail.json().meta.year).toBe(2003);

    const shows = await app.inject({ method: 'GET', url: '/api/library?kind=video_series' });
    expect(shows.json().items).toHaveLength(1);
    const show = shows.json().items[0];
    expect(show.title).toBe('ShowName');
    const showDetail = await app.inject({ method: 'GET', url: `/api/library/${show.id}` });
    expect(showDetail.json().units).toHaveLength(2);

    const comics = await app.inject({ method: 'GET', url: '/api/library?kind=comic' });
    expect(comics.json().items.length).toBeGreaterThanOrEqual(1);

    const firstCount = scan.json().items.length as number;
    const second = await app.inject({ method: 'POST', url: '/api/library/scan' });
    expect(second.statusCode).toBe(200);
    expect(second.json().items.length).toBe(firstCount);

    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { libraries: [{ id: 1, path: path.join(tempDirectory, 'gone') }] },
    });
    const missing = await app.inject({ method: 'POST', url: '/api/library/scan' });
    expect(missing.statusCode).toBe(200);
    const missingRows = missing.json().scanned as Array<{ libraryId: number; error?: string }>;
    const missingMovie = missingRows.find((row) => row.libraryId === 1);
    expect(missingMovie?.error).toBe('PATH_MISSING');

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(6);
    } finally {
      db.close();
    }
  });
});

describe('rescan guard (user metadata lock)', () => {
  let app: FastifyInstance;
  let tempDirectory: string;
  let store: SQLiteStore;

  beforeEach(async () => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lock-scan-'));
    store = new SQLiteStore(path.join(tempDirectory, 'db.sqlite'));
    app = await buildServer({
      logger: false,
      dependencies: {
        store,
        mediaRoot: path.join(tempDirectory, 'media'),
        fetchImpl: (async () => {
          // tmdb search response: 0 results (default path never overwrites user data).
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }) as typeof fetch,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  async function lockWork(workId: number) {
    await app.inject({
      method: 'POST',
      url: '/api/agent/turn',
      payload: { message: `set metadata for ${workId}` },
    }).catch(() => undefined);
    // Direct agent-tool invocation is the reliable surface for locking:
    const { executeTool } = await import('../src/agent/tools.js');
    const library = new LibraryStore(store.db);
    const localMedia = new LocalMediaStore(store.db);
    await executeTool('set_metadata', { workId }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      localMedia,
    });
  }

  it('skips a locked work with skipped user_locked and force overrides without clearing the lock', async () => {
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'movie', title: '사용자수정.2019.mp4' }, 1);
    library.upsertWorkTitle(work.id, '사용자 지정 제목');
    await lockWork(work.id);

    const scan = await app.inject({ method: 'POST', url: '/api/library/scan' });
    expect(scan.statusCode).toBe(200);
    const body = scan.json();
    const lockedRow = body.items.find((row: { workId?: number }) => row.workId === work.id);
    expect(lockedRow).toMatchObject({ skipped: 'user_locked' });
    expect(library.getWork(work.id)?.title).toBe('사용자 지정 제목');

    // force through the agent scan_metadata path bypasses the lock.
    const { executeTool } = await import('../src/agent/tools.js');
    const forced = await executeTool('scan_metadata', { workId: work.id, force: true }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      scanMetadata: async (id, force) => ({ id, force }),
    });
    expect(forced).toMatchObject({ force: true });

    // The lock persists after a forced rescan.
    const again = await app.inject({ method: 'POST', url: '/api/library/scan' });
    const lockedAgain = again.json().items.find((row: { workId?: number }) => row.workId === work.id);
    expect(lockedAgain).toMatchObject({ skipped: 'user_locked' });
  });

  it('rescans normally for a work with tmdb_id but no lock (guard ignores tmdb_id)', async () => {
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'movie', title: '올드보이.2003.mp4' }, 1);
    library.taxonomy.upsertMeta(work.id, { tmdb_id: 670 });

    const scan = await app.inject({ method: 'POST', url: '/api/library/scan' });
    const row = scan.json().items.find((item: { workId?: number }) => item.workId === work.id);
    expect(row?.skipped).toBeUndefined();
  });

  it('unlocks via set_metadata { unlock: true } so rescan overwrites again', async () => {
    const library = new LibraryStore(store.db);
    const work = library.upsertWork({ kind: 'movie', title: '이끼.2013.mp4' }, 1);
    await lockWork(work.id);

    const { executeTool } = await import('../src/agent/tools.js');
    await executeTool('set_metadata', { workId: work.id, unlock: true }, {
      profileId: 1,
      library,
      enqueueDownload: async () => undefined,
      searchSource: async () => [],
      importLocal: async () => [],
      localMedia: new LocalMediaStore(store.db),
    });

    const scan = await app.inject({ method: 'POST', url: '/api/library/scan' });
    const row = scan.json().items.find((item: { workId?: number }) => item.workId === work.id);
    expect(row?.skipped).toBeUndefined();
  });
});
