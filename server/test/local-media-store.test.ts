import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MEDIA_CACHE_BYTES,
  LocalMediaStore,
} from '../src/store/local-media-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];

function tempDatabase(name = 'openplex.db'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-media-'));
  tempDirectories.push(directory);
  return path.join(directory, name);
}

function openStore(dbPath = tempDatabase()): SQLiteStore {
  const store = new SQLiteStore(dbPath);
  openStores.push(store);
  return store;
}

function mediaStore(dbPath = tempDatabase()): LocalMediaStore {
  return new LocalMediaStore(openStore(dbPath).db);
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createV2Database(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      avatar_color TEXT,
      subtitle_style TEXT,
      created_at INTEGER
    );
    INSERT INTO profiles (id, name, created_at) VALUES (1, 'default', 1);
    CREATE TABLE watch_history (
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      id INTEGER NOT NULL,
      epIdx INTEGER NOT NULL,
      title TEXT NOT NULL,
      thumb TEXT NOT NULL,
      position_sec REAL NOT NULL,
      duration_sec REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, category, id, epIdx)
    );
    CREATE TABLE bookmarks (
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      id INTEGER NOT NULL,
      title TEXT NOT NULL,
      thumb TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, category, id)
    );
    CREATE TABLE episode_catalog (
      category TEXT,
      id INTEGER,
      ep_idx INTEGER,
      ordinal INTEGER,
      title TEXT,
      thumb TEXT,
      updated_at INTEGER,
      PRIMARY KEY (category, id, ep_idx)
    );
  `);
  db.prepare(`
    INSERT INTO watch_history
      (profile_id, category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at)
    VALUES (1, 'drama', 41, 2, 'Kept episode', '/kept.jpg', 10, 100, 50)
  `).run();
  db.pragma('user_version = 2');
  db.close();
}

describe('local_media schema', () => {
  it('migrates a v2 database to v3 without dropping existing profile history', () => {
    const dbPath = tempDatabase();
    createV2Database(dbPath);

    const store = openStore(dbPath);
    expect(store.db.pragma('user_version', { simple: true })).toBe(6);
    expect(store.getHistory(1)).toEqual([expect.objectContaining({
      category: 'drama',
      id: 41,
      epIdx: 2,
      title: 'Kept episode',
    })]);
    expect(store.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('local_media', 'app_settings')
    `).all()).toEqual(expect.arrayContaining([
      { name: 'local_media' },
      { name: 'app_settings' },
    ]));
  });
});

describe('LocalMediaStore', () => {
  it('inserts a pending row and returns it from get/list', () => {
    const store = mediaStore();
    const item = store.upsertPending({
      category: 'drama',
      id: 41,
      epIdx: 2,
      title: 'Episode 2',
      thumb: '/2.jpg',
    }, 1_700);

    expect(item).toEqual({
      category: 'drama',
      id: 41,
      epIdx: 2,
      title: 'Episode 2',
      thumb: '/2.jpg',
      file_path: null,
      size_bytes: 0,
      download_status: 'pending',
      done_segments: 0,
      total_segments: 0,
      error: null,
      created_at: 1_700,
      updated_at: 1_700,
      last_accessed_at: null,
    });
    expect(store.get('drama', 41, 2)).toEqual(item);
    expect(store.list()).toEqual([item]);
  });

  it('does not reset a completed row when upsertPending is called again', () => {
    const store = mediaStore();
    store.upsertPending({
      category: 'drama',
      id: 41,
      epIdx: 2,
      title: 'Episode 2',
      thumb: '/2.jpg',
    }, 1);
    store.markCompleted({
      category: 'drama',
      id: 41,
      epIdx: 2,
      file_path: 'drama/41/2/playlist.m3u8',
      size_bytes: 4096,
    }, 2);

    const again = store.upsertPending({
      category: 'drama',
      id: 41,
      epIdx: 2,
      title: 'Renamed',
      thumb: '/new.jpg',
    }, 3);

    expect(again.download_status).toBe('completed');
    expect(again.file_path).toBe('drama/41/2/playlist.m3u8');
    expect(again.size_bytes).toBe(4096);
    expect(again.title).toBe('Episode 2');
  });

  it('requeues a failed row as pending', () => {
    const store = mediaStore();
    store.upsertPending({
      category: 'movie',
      id: 9,
      epIdx: 0,
      title: 'Movie',
      thumb: '/m.jpg',
    }, 1);
    store.markFailed({ category: 'movie', id: 9, epIdx: 0 }, 'upstream 502', 2);

    const retried = store.upsertPending({
      category: 'movie',
      id: 9,
      epIdx: 0,
      title: 'Movie',
      thumb: '/m.jpg',
    }, 3);

    expect(retried.download_status).toBe('pending');
    expect(retried.error).toBeNull();
    expect(retried.updated_at).toBe(3);
  });

  it('tracks progress, completed bytes, access time, and eviction order', () => {
    const store = mediaStore();
    store.upsertPending({
      category: 'drama',
      id: 1,
      epIdx: 1,
      title: 'Old',
      thumb: '',
    }, 10);
    store.markCompleted({
      category: 'drama',
      id: 1,
      epIdx: 1,
      file_path: 'drama/1/1/playlist.m3u8',
      size_bytes: 100,
    }, 11);
    store.upsertPending({
      category: 'drama',
      id: 1,
      epIdx: 2,
      title: 'New',
      thumb: '',
    }, 20);
    store.markCompleted({
      category: 'drama',
      id: 1,
      epIdx: 2,
      file_path: 'drama/1/2/playlist.m3u8',
      size_bytes: 50,
    }, 21);
    store.touchAccessed('drama', 1, 1, 30);

    expect(store.completedBytes()).toBe(150);
    expect(store.completedForEviction().map((item) => item.epIdx)).toEqual([2, 1]);
    expect(store.get('drama', 1, 1)?.last_accessed_at).toBe(30);
  });

  it('stores library visibility with a private default and rejects invalid values', () => {
    const sqlite = openStore();
    const store = new LocalMediaStore(sqlite.db);
    expect(store.getLibraryVisibility()).toBe('private');

    store.setLibraryVisibility('public');
    expect(store.getLibraryVisibility()).toBe('public');

    store.setLibraryVisibility('private');
    expect(store.getLibraryVisibility()).toBe('private');

    expect(() => store.setLibraryVisibility('open' as never)).toThrow(/Invalid library visibility/);

    sqlite.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('library_visibility', 'garbage')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
    expect(store.getLibraryVisibility()).toBe('private');
  });

  it('stores a configurable cache budget and defaults to 50GB', () => {
    const store = mediaStore();
    expect(store.getMaxCacheBytes()).toBe(DEFAULT_MEDIA_CACHE_BYTES);
    store.setMaxCacheBytes(1024);
    expect(store.getMaxCacheBytes()).toBe(1024);
  });

  it('returns the next catalog episode after the current one', () => {
    const sqlite = openStore();
    sqlite.upsertEpisodeCatalog([
      { category: 'drama', id: 41, epIdx: 11, ordinal: 0, title: 'Ep 1', thumb: '/1.jpg' },
      { category: 'drama', id: 41, epIdx: 908_177, ordinal: 1, title: 'Ep 2', thumb: '/2.jpg' },
    ]);
    const store = new LocalMediaStore(sqlite.db);
    expect(store.nextCatalogEpisode('drama', 41, 11)).toEqual({
      epIdx: 908_177,
      title: 'Ep 2',
      thumb: '/2.jpg',
    });
    expect(store.nextCatalogEpisode('drama', 41, 908_177)).toBeNull();
  });
});
