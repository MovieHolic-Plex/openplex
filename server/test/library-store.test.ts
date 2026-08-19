import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryStore } from '../src/store/library-store.js';
import { LocalMediaStore } from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-lib-'));
  tempDirectories.push(directory);
  return path.join(directory, 'openplex.db');
}

function openStore(dbPath = tempDatabase()): SQLiteStore {
  const store = new SQLiteStore(dbPath);
  openStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('library schema v6', () => {
  it('creates library tables on a fresh database and reports schema 6', () => {
    const store = openStore();
    const names = (store.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);

    expect(store.db.pragma('user_version', { simple: true })).toBe(6);
    expect(names).toEqual(expect.arrayContaining([
      'works',
      'seasons',
      'units',
      'source_bindings',
      'source_adapters',
      'assets',
      'unit_progress',
      'libraries',
      'collections',
      'work_meta',
    ]));
  });

  it('copies tvwiki catalog, history, and completed local media into works/units', () => {
    const dbPath = tempDatabase();
    const v3 = openStore(dbPath);
    expect(v3.db.pragma('user_version', { simple: true })).toBe(6);

    v3.upsertEpisodeCatalog([
      { category: 'drama', id: 41, epIdx: 11, ordinal: 0, title: 'Ep 1', thumb: '/1.jpg' },
      { category: 'drama', id: 41, epIdx: 22, ordinal: 1, title: 'Ep 2', thumb: '/2.jpg' },
    ]);
    v3.upsertHistory(1, {
      category: 'drama',
      id: 41,
      epIdx: 11,
      title: 'Drama 41 - Ep 1',
      thumb: '/1.jpg',
      position_sec: 120,
      duration_sec: 600,
      updated_at: 50,
    });
    const media = new LocalMediaStore(v3.db);
    media.upsertPending({
      category: 'drama',
      id: 41,
      epIdx: 11,
      title: 'Ep 1',
      thumb: '/1.jpg',
    }, 10);
    media.markCompleted({
      category: 'drama',
      id: 41,
      epIdx: 11,
      file_path: 'drama/41/11/playlist.m3u8',
      size_bytes: 4096,
    }, 11);
    v3.close();

    const reopened = new SQLiteStore(dbPath);
    openStores.push(reopened);
    // Force remigration path: already v4, so copy via explicit helper on first open after catalog write.
    const library = new LibraryStore(reopened.db);
    library.importTvwikiRows();

    const works = library.listWorks();
    expect(works).toEqual([expect.objectContaining({
      kind: 'video_series',
      title: 'drama 41',
    })]);
    const work = works[0];
    if (!work) throw new Error('expected migrated work');
    const units = library.listUnits(work.id);
    expect(units.map((unit) => unit.title)).toEqual(['Ep 1', 'Ep 2']);
    expect(library.binding('tvwiki', 'drama/41')).toMatchObject({ work_id: work.id, unit_id: null });
    expect(library.binding('tvwiki', 'drama/41/11')).toMatchObject({ work_id: work.id });
    expect(library.getProgress(1, units[0]?.id ?? 0)).toMatchObject({
      position: 120,
      duration: 600,
    });
    expect(library.listAssets(units[0]?.id ?? 0)).toEqual([expect.objectContaining({
      kind: 'hls_local',
      path: 'drama/41/11/playlist.m3u8',
      size_bytes: 4096,
    })]);
  });
});

describe('LibraryStore', () => {
  it('creates a comic work, binds a local source, and records page progress', () => {
    const library = new LibraryStore(openStore().db);
    const work = library.upsertWork({
      kind: 'comic',
      title: '이끼',
      overview: 'thriller',
      poster: '/moss.jpg',
    }, 1_000);
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'chapter',
      ordinal: 0,
      title: '1화',
    }, 1_001);
    library.bindSource({
      workId: work.id,
      unitId: unit.id,
      adapter: 'local',
      externalId: 'comics/moss/1',
    });
    library.setProgress(1, unit.id, { position: 4, duration: 20, pageIndex: 4 }, 1_002);

    expect(library.getWork(work.id)).toMatchObject({ kind: 'comic', title: '이끼' });
    expect(library.listWorks({ kind: 'comic' })).toHaveLength(1);
    expect(library.listWorks({ kind: 'movie' })).toHaveLength(0);
    expect(library.nextUnwatchedUnit(1, work.id)?.id).toBe(unit.id);
    const progress = library.getProgress(1, unit.id);
    expect(progress).toEqual({
      position: 4,
      duration: 20,
      page_index: 4,
      updated_at: 1_002,
    });
  });

  it('returns the next unwatched episode by ordinal', () => {
    const library = new LibraryStore(openStore().db);
    const work = library.upsertWork({ kind: 'video_series', title: 'Show' }, 1);
    const first = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 0,
      title: 'E1',
    }, 2);
    const second = library.upsertUnit({
      workId: work.id,
      kind: 'episode',
      ordinal: 1,
      title: 'E2',
    }, 3);
    library.setProgress(1, first.id, { position: 90, duration: 100 }, 4);

    expect(library.nextUnwatchedUnit(1, work.id)).toMatchObject({ id: second.id, title: 'E2' });
  });
});
