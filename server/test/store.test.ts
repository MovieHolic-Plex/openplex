import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SQLiteStore,
  type EpisodeCatalogItem,
  type WatchHistoryItem,
} from '../src/store/sqlite-store.js';

const tempDirectories: string[] = [];
const openStores: SQLiteStore[] = [];

function tempDatabase(name = 'openplex.db'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-store-'));
  tempDirectories.push(directory);
  return path.join(directory, name);
}

function openStore(dbPath = tempDatabase()): SQLiteStore {
  const store = new SQLiteStore(dbPath);
  openStores.push(store);
  return store;
}

function history(overrides: Partial<WatchHistoryItem> = {}): WatchHistoryItem {
  return {
    category: 'drama',
    id: 41,
    epIdx: 11,
    title: 'Episode 11',
    thumb: '/11.jpg',
    position_sec: 120.5,
    duration_sec: 600.25,
    updated_at: 1_700_000_000_123,
    ...overrides,
  };
}

function catalog(
  category: string,
  id: number,
  episodeIndexes: readonly number[],
  titlePrefix = 'Episode',
): EpisodeCatalogItem[] {
  return episodeIndexes.map((epIdx, ordinal) => ({
    category,
    id,
    epIdx,
    ordinal,
    title: `${titlePrefix} ${ordinal + 1}`,
    thumb: `/${id}-${epIdx}.jpg`,
    updated_at: 100 + ordinal,
  }));
}

function createLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE watch_history (
      category TEXT NOT NULL,
      id INTEGER NOT NULL,
      epIdx INTEGER NOT NULL,
      title TEXT NOT NULL,
      thumb TEXT NOT NULL,
      position_sec REAL NOT NULL,
      duration_sec REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (category, id, epIdx)
    );
    CREATE TABLE bookmarks (
      category TEXT NOT NULL,
      id INTEGER NOT NULL,
      title TEXT NOT NULL,
      thumb TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (category, id)
    );
  `);
  db.prepare(`
    INSERT INTO watch_history
      (category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('drama', 41, 17, 'Legacy episode', '/legacy.jpg', 123.456789, 987.654321, 1_698_765_432_109);
  db.prepare(`
    INSERT INTO watch_history
      (category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('movie', 99, 0, 'Legacy movie', '/movie.jpg', 77.125, 100.5, 1_698_765_432_777);
  db.prepare(`
    INSERT INTO bookmarks (category, id, title, thumb, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('movie', 99, 'Legacy bookmark', '/bookmark.jpg', 1_612_345_678_901);
  db.close();
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLiteStore schema and migration', () => {
  it('creates the final v2 schema directly with connection pragmas enabled', () => {
    const store = openStore();
    const tableNames = (store.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all() as Array<{ name: string }>).map(({ name }) => name);

    expect(tableNames).toEqual(expect.arrayContaining([
      'profiles',
      'watch_history',
      'bookmarks',
      'episode_catalog',
      'local_media',
      'app_settings',
      'works',
      'units',
    ]));
    expect(store.db.pragma('user_version', { simple: true })).toBe(6);
    expect(store.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(String(store.db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    expect(store.listProfiles()).toEqual([
      expect.objectContaining({ id: 1, name: 'default' }),
    ]);

    const historyColumns = store.db.pragma('table_info(watch_history)') as Array<{ name: string }>;
    expect(historyColumns[0].name).toBe('profile_id');
    const historyForeignKeys = store.db.pragma('foreign_key_list(watch_history)') as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    expect(historyForeignKeys).toContainEqual(expect.objectContaining({
      table: 'profiles',
      from: 'profile_id',
      on_delete: 'CASCADE',
    }));
  });

  it('atomically migrates legacy rows without changing REAL values or timestamps and is restart-idempotent', () => {
    const dbPath = tempDatabase();
    createLegacyDatabase(dbPath);

    const store = openStore(dbPath);
    const migrated = store.getHistory(1);
    expect(migrated).toHaveLength(2);
    expect(migrated).toContainEqual({
      category: 'drama',
      id: 41,
      epIdx: 17,
      title: 'Legacy episode',
      thumb: '/legacy.jpg',
      position_sec: 123.456789,
      duration_sec: 987.654321,
      updated_at: 1_698_765_432_109,
    });
    expect(store.getBookmarks(1)).toEqual([{
      category: 'movie',
      id: 99,
      title: 'Legacy bookmark',
      thumb: '/bookmark.jpg',
      created_at: 1_612_345_678_901,
    }]);
    expect(store.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(store.db.pragma('foreign_key_check')).toEqual([]);

    store.close();
    const restarted = openStore(dbPath);
    expect(restarted.getHistory(1)).toEqual(migrated);
    expect(restarted.listProfiles()).toHaveLength(1);
    expect(restarted.db.pragma('user_version', { simple: true })).toBe(6);
    expect(restarted.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(restarted.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rolls the whole migration back when a deterministic mid-migration failure is injected', () => {
    const dbPath = tempDatabase();
    createLegacyDatabase(dbPath);

    expect(() => new SQLiteStore(dbPath, {
      migrationHook: () => {
        throw new Error('injected migration failure');
      },
    })).toThrow('injected migration failure');

    const inspection = new Database(dbPath);
    expect(inspection.pragma('user_version', { simple: true })).toBe(0);
    expect(inspection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profiles'").get())
      .toBeUndefined();
    expect(inspection.pragma('table_info(watch_history)')).not.toContainEqual(
      expect.objectContaining({ name: 'profile_id' }),
    );
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM watch_history').get())
      .toEqual({ count: 2 });
    expect(inspection.prepare('SELECT COUNT(*) AS count FROM bookmarks').get())
      .toEqual({ count: 1 });
    expect(inspection.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    inspection.close();

    const retried = openStore(dbPath);
    expect(retried.getHistory(1)).toHaveLength(2);
    expect(retried.getBookmarks(1)).toHaveLength(1);
    expect(retried.db.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('SQLiteStore profiles and scoped state', () => {
  it('validates profile input and stores subtitle style JSON', () => {
    const store = openStore();
    expect(() => store.createProfile('', '#fff')).toThrow('must not be blank');
    expect(() => store.createProfile(null as unknown as string, '#fff')).toThrow('must not be blank');

    const profile = store.createProfile('  Guest  ', '#abc123');
    expect(profile).toMatchObject({ name: 'Guest', avatar_color: '#abc123' });
    expect(store.renameProfile(profile.id, 'Guest Two')).toMatchObject({ name: 'Guest Two' });
    expect(store.getSubtitleStyle(profile.id)).toBeNull();
    store.setSubtitleStyle(profile.id, '{"fontScale":150,"color":"yellow"}');
    expect(store.getSubtitleStyle(profile.id)).toBe('{"fontScale":150,"color":"yellow"}');
    expect(() => store.setSubtitleStyle(profile.id, '{bad json')).toThrow();
    expect(() => store.renameProfile(9999, 'Missing')).toThrow('does not exist');
  });

  it('refuses deletion of profile 1 and the last remaining profile', () => {
    const store = openStore();
    expect(() => store.deleteProfile(1)).toThrow('default profile');

    store.db.prepare(`
      INSERT INTO profiles (id, name, avatar_color, subtitle_style, created_at)
      VALUES (2, 'only deletable', NULL, NULL, 1)
    `).run();
    store.db.prepare('DELETE FROM profiles WHERE id = 1').run();
    expect(() => store.deleteProfile(2)).toThrow('last remaining profile');
    expect(store.listProfiles()).toHaveLength(1);
  });

  it('scopes history and bookmarks by profile and enforces cascade deletion', () => {
    const store = openStore();
    const profile = store.createProfile('Second', '#222');
    const sharedIdentity = history({ id: 50, epIdx: 3 });

    store.upsertHistory(1, sharedIdentity);
    store.upsertHistory(profile.id, { ...sharedIdentity, position_sec: 480, title: 'Second profile' });
    store.addBookmark(1, { category: 'drama', id: 50, title: 'Default', thumb: '' });
    store.addBookmark(profile.id, { category: 'drama', id: 50, title: 'Second', thumb: '' });

    expect(store.getHistoryItem(1, 'drama', 50, 3)?.position_sec).toBe(120.5);
    expect(store.getHistoryItem(profile.id, 'drama', 50, 3)?.position_sec).toBe(480);
    expect(store.getBookmarks(1)[0].title).toBe('Default');
    expect(store.getBookmarks(profile.id)[0].title).toBe('Second');

    store.deleteProfile(profile.id);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM watch_history WHERE profile_id = ?')
      .get(profile.id)).toEqual({ count: 0 });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE profile_id = ?')
      .get(profile.id)).toEqual({ count: 0 });
    expect(store.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('supports scoped upsert, ordering, limits, and deletion', () => {
    const store = openStore();
    store.upsertHistory(1, history({ id: 1, updated_at: 100 }));
    store.upsertHistory(1, history({ id: 2, epIdx: 2, updated_at: 200 }));
    store.upsertHistory(1, history({ id: 2, epIdx: 2, position_sec: 444, updated_at: 300 }));

    expect(store.getHistory(1, 1)).toEqual([
      expect.objectContaining({ id: 2, position_sec: 444, updated_at: 300 }),
    ]);
    store.deleteHistoryItem(1, 'drama', 2, 2);
    expect(store.getHistoryItem(1, 'drama', 2, 2)).toBeNull();
    store.deleteHistoryItem(1, 'drama', 1);
    expect(store.getHistory(1)).toEqual([]);
  });
});

describe('SQLiteStore episode catalog and derived queries', () => {
  it('upserts catalog rows and calculates profile-specific watch state accurately', () => {
    const store = openStore();
    const profile = store.createProfile('Catalog Guest');
    store.upsertEpisodeCatalog(catalog('drama', 41, [101, 205, 999]));
    store.upsertEpisodeCatalog([{
      category: 'drama',
      id: 41,
      epIdx: 205,
      ordinal: 1,
      title: 'Updated second episode',
      thumb: '/updated.jpg',
      updated_at: 999,
    }]);
    store.upsertHistory(1, history({ epIdx: 101, position_sec: 95, duration_sec: 100 }));
    store.upsertHistory(1, history({
      epIdx: 205,
      position_sec: 25,
      duration_sec: 100,
      updated_at: 1_700_000_000_200,
    }));
    store.upsertHistory(profile.id, history({ epIdx: 101, position_sec: 10, duration_sec: 100 }));

    const catalogRow = store.db.prepare(`
      SELECT title, thumb, ordinal, updated_at FROM episode_catalog
      WHERE category = 'drama' AND id = 41 AND ep_idx = 205
    `).get();
    expect(catalogRow).toEqual({
      title: 'Updated second episode',
      thumb: '/updated.jpg',
      ordinal: 1,
      updated_at: 999,
    });

    const defaultState = store.getWatchStateMap(1, [
      { category: 'drama', wrId: 41 },
      { category: 'movie', id: 999 },
    ]);
    expect(defaultState.get('drama:41')).toEqual({
      watched: false,
      progress: 0.25,
      unwatchedCount: 2,
    });
    expect(defaultState.get('movie:999')).toEqual({
      watched: false,
      progress: 0,
      unwatchedCount: null,
    });
    expect(store.getWatchStateMap(profile.id, [{ category: 'drama', id: 41 }]).get('drama:41'))
      .toEqual({ watched: false, progress: 0.1, unwatchedCount: 3 });
  });

  it('selects the next opaque catalog episode by ordinal, orders by activity, and excludes complete series', () => {
    const store = openStore();
    store.upsertEpisodeCatalog([
      ...catalog('drama', 10, [901, 405, 777], 'Drama ten'),
      ...catalog('drama', 20, [55, 12], 'Drama twenty'),
      ...catalog('drama', 30, [88, 4], 'Complete'),
    ]);

    store.upsertHistory(1, history({ id: 10, epIdx: 901, updated_at: 2_000 }));
    store.upsertHistory(1, history({ id: 20, epIdx: 55, updated_at: 3_000 }));
    store.upsertHistory(1, history({ id: 30, epIdx: 88, updated_at: 4_000 }));
    store.upsertHistory(1, history({ id: 30, epIdx: 4, updated_at: 4_100 }));

    expect(store.getNextUpCandidates(1, 10)).toEqual([
      {
        category: 'drama',
        id: 20,
        epIdx: 12,
        title: 'Drama twenty 2',
        thumb: '/20-12.jpg',
        nextOrdinal: 1,
      },
      {
        category: 'drama',
        id: 10,
        epIdx: 405,
        title: 'Drama ten 2',
        thumb: '/10-405.jpg',
        nextOrdinal: 1,
      },
    ]);
    expect(store.getNextUpCandidates(1, 1)).toHaveLength(1);
  });

  it('returns totals, distinct counts, top five, and seven ascending local-calendar buckets including zeros', () => {
    const store = openStore();
    const local = (daysBefore: number, hour: number, minute = 0): number => {
      const value = new Date(2026, 7, 16, hour, minute, 0, 0);
      value.setDate(value.getDate() - daysBefore);
      return value.getTime();
    };
    const now = local(0, 12);

    store.upsertHistory(1, history({ id: 1, epIdx: 1, title: 'Series One', position_sec: 100, updated_at: local(6, 0) }));
    store.upsertHistory(1, history({ id: 1, epIdx: 2, title: 'Series One', position_sec: 50, updated_at: local(0, 23, 59) }));
    store.upsertHistory(1, history({ id: 2, epIdx: 1, title: 'Series Two', position_sec: 200, updated_at: local(1, 0) }));
    store.upsertHistory(1, history({ category: 'movie', id: 9, epIdx: 0, title: 'Movie', position_sec: 300, updated_at: local(3, 12) }));
    store.upsertHistory(1, history({ category: 'movie', id: 10, epIdx: 0, title: 'Old Movie', position_sec: 400, updated_at: local(8, 12) }));

    const stats = store.getStats(1, now);
    expect(stats.totalWatchSeconds).toBe(1_050);
    expect(stats.seriesCount).toBe(2);
    expect(stats.movieCount).toBe(2);
    expect(stats.topSeries).toEqual([
      expect.objectContaining({ id: 2, watchSeconds: 200 }),
      expect.objectContaining({ id: 1, watchSeconds: 150 }),
    ]);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.map(({ date }) => date)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
    expect(stats.daily.map(({ watchSeconds }) => watchSeconds)).toEqual([
      100, 0, 0, 300, 0, 200, 50,
    ]);
  });
});
