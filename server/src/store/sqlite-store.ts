import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLibraryTables, LibraryStore } from './library-store.js';
import { createLocalMediaTables } from './local-media-store.js';

export const SCHEMA_VERSION = 6;
const DEFAULT_PROFILE_ID = 1;
const DEFAULT_PROFILE_NAME = 'default';

export interface WatchHistoryItem {
  category: string;
  id: number;
  epIdx: number;
  title: string;
  thumb: string;
  position_sec: number;
  duration_sec: number;
  updated_at?: number;
}

export interface BookmarkItem {
  category: string;
  id: number;
  title: string;
  thumb: string;
  created_at?: number;
}

export interface Profile {
  id: number;
  name: string;
  avatar_color: string | null;
  subtitle_style: string | null;
  created_at: number | null;
}

export interface EpisodeCatalogItem {
  category: string;
  id: number;
  epIdx: number;
  ordinal: number;
  title: string;
  thumb: string;
  updated_at?: number;
}

export interface NextUpCandidate {
  category: string;
  id: number;
  epIdx: number;
  title: string;
  thumb: string;
  nextOrdinal: number;
}

export interface WatchState {
  watched: boolean;
  progress: number;
  unwatchedCount: number | null;
}

export interface WatchStateItem {
  category: string;
  id?: number;
  wrId?: number;
}

export interface ProfileStats {
  totalWatchSeconds: number;
  seriesCount: number;
  movieCount: number;
  topSeries: Array<{
    category: string;
    id: number;
    title: string;
    watchSeconds: number;
  }>;
  daily: Array<{
    date: string;
    watchSeconds: number;
  }>;
}

export interface SQLiteStoreOptions {
  /** Test seam used to prove that legacy DDL and data copies roll back together. */
  migrationHook?: (phase: 'legacy-rows-copied') => void;
}

interface CountRow {
  count: number;
}

interface WatchStateRow {
  category: string;
  id: number;
  position_sec: number | null;
  duration_sec: number | null;
  catalog_count: number;
  unwatched_count: number;
}

export class SQLiteStore {
  public db: Database.Database;

  constructor(
    dbPath: string = '.data/openplex.db',
    private readonly options: SQLiteStoreOptions = {},
  ) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    try {
      this.init();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private init(): void {
    // These are connection settings, and foreign_keys cannot be toggled in a transaction.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      throw new Error(`Unsupported database schema version ${version}`);
    }

    if (version < SCHEMA_VERSION) {
      const hasWatchHistory = this.tableExists('watch_history');
      const hasBookmarks = this.tableExists('bookmarks');
      const hasLegacyWatchHistory = hasWatchHistory && !this.columnExists('watch_history', 'profile_id');
      const hasLegacyBookmarks = hasBookmarks && !this.columnExists('bookmarks', 'profile_id');

      if (hasLegacyWatchHistory || hasLegacyBookmarks) {
        this.migrateLegacySchema(hasLegacyWatchHistory, hasLegacyBookmarks);
      } else if (!hasWatchHistory && !hasBookmarks) {
        this.createFreshSchema();
      } else {
        this.migrateAdditiveSchema();
      }
      new LibraryStore(this.db).importTvwikiRows();
      return;
    }

    // Additive tables are required independently of profile migration state.
    this.db.transaction(() => {
      this.createEpisodeCatalogTable();
      createLocalMediaTables(this.db);
      createLibraryTables(this.db);
    })();
  }

  private tableExists(name: string): boolean {
    return this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined;
  }

  private columnExists(table: string, column: string): boolean {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return columns.some((candidate) => candidate.name === column);
  }

  private createFreshSchema(): void {
    this.db.transaction(() => {
      this.createProfilesTable();
      this.insertDefaultProfile();
      this.createWatchHistoryTable('watch_history');
      this.createBookmarksTable('bookmarks');
      this.createEpisodeCatalogTable();
      createLocalMediaTables(this.db);
      createLibraryTables(this.db);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  private migrateLegacySchema(
    hasLegacyWatchHistory: boolean,
    hasLegacyBookmarks: boolean,
  ): void {
    this.db.transaction(() => {
      this.createProfilesTable();
      this.insertDefaultProfile();

      if (hasLegacyWatchHistory) {
        this.createWatchHistoryTable('watch_history_new');
        this.db.exec(`
          INSERT INTO watch_history_new (
            profile_id, category, id, epIdx, title, thumb,
            position_sec, duration_sec, updated_at
          )
          SELECT
            1, category, id, epIdx, title, thumb,
            position_sec, duration_sec, updated_at
          FROM watch_history
        `);
      } else if (!this.tableExists('watch_history')) {
        this.createWatchHistoryTable('watch_history');
      }

      if (hasLegacyBookmarks) {
        this.createBookmarksTable('bookmarks_new');
        this.db.exec(`
          INSERT INTO bookmarks_new (
            profile_id, category, id, title, thumb, created_at
          )
          SELECT 1, category, id, title, thumb, created_at
          FROM bookmarks
        `);
      } else if (!this.tableExists('bookmarks')) {
        this.createBookmarksTable('bookmarks');
      }

      this.options.migrationHook?.('legacy-rows-copied');

      if (hasLegacyWatchHistory) {
        this.db.exec('DROP TABLE watch_history; ALTER TABLE watch_history_new RENAME TO watch_history;');
      }
      if (hasLegacyBookmarks) {
        this.db.exec('DROP TABLE bookmarks; ALTER TABLE bookmarks_new RENAME TO bookmarks;');
      }

      this.createEpisodeCatalogTable();
      createLocalMediaTables(this.db);
      createLibraryTables(this.db);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  private migrateAdditiveSchema(): void {
    this.db.transaction(() => {
      this.createEpisodeCatalogTable();
      createLocalMediaTables(this.db);
      createLibraryTables(this.db);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  private createProfilesTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        avatar_color TEXT,
        subtitle_style TEXT,
        created_at INTEGER
      )
    `);
  }

  private insertDefaultProfile(): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO profiles (id, name, avatar_color, subtitle_style, created_at)
      VALUES (?, ?, NULL, NULL, ?)
    `).run(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, Date.now());
  }

  private createWatchHistoryTable(table: 'watch_history' | 'watch_history_new'): void {
    this.db.exec(`
      CREATE TABLE ${table} (
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
      )
    `);
  }

  private createBookmarksTable(table: 'bookmarks' | 'bookmarks_new'): void {
    this.db.exec(`
      CREATE TABLE ${table} (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        id INTEGER NOT NULL,
        title TEXT NOT NULL,
        thumb TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, category, id)
      )
    `);
  }

  private createEpisodeCatalogTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episode_catalog (
        category TEXT,
        id INTEGER,
        ep_idx INTEGER,
        ordinal INTEGER,
        title TEXT,
        thumb TEXT,
        updated_at INTEGER,
        PRIMARY KEY (category, id, ep_idx)
      )
    `);
  }

  public listProfiles(): Profile[] {
    return this.db.prepare(`
      SELECT id, name, avatar_color, subtitle_style, created_at
      FROM profiles
      ORDER BY id
    `).all() as Profile[];
  }

  public profileExists(id: number): boolean {
    return Number.isInteger(id) && id > 0 && this.db
      .prepare('SELECT 1 FROM profiles WHERE id = ?')
      .get(id) !== undefined;
  }

  public createProfile(name: string, color: string | null = null): Profile {
    const normalizedName = this.validProfileName(name);
    if (color !== null && typeof color !== 'string') {
      throw new Error('Profile color must be a string or null');
    }
    const createdAt = Date.now();
    const result = this.db.prepare(`
      INSERT INTO profiles (name, avatar_color, subtitle_style, created_at)
      VALUES (?, ?, NULL, ?)
    `).run(normalizedName, color, createdAt);
    return this.db.prepare(`
      SELECT id, name, avatar_color, subtitle_style, created_at
      FROM profiles WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as Profile;
  }

  public renameProfile(id: number, name: string): Profile {
    const normalizedName = this.validProfileName(name);
    const result = this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?')
      .run(normalizedName, id);
    if (result.changes === 0) throw new Error(`Profile ${id} does not exist`);
    return this.db.prepare(`
      SELECT id, name, avatar_color, subtitle_style, created_at
      FROM profiles WHERE id = ?
    `).get(id) as Profile;
  }

  public deleteProfile(id: number): void {
    if (id === DEFAULT_PROFILE_ID) throw new Error('The default profile cannot be deleted');
    this.db.transaction(() => {
      const profileCount = (this.db.prepare('SELECT COUNT(*) AS count FROM profiles').get() as CountRow).count;
      if (profileCount <= 1) throw new Error('The last remaining profile cannot be deleted');
      const result = this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
      if (result.changes === 0) throw new Error(`Profile ${id} does not exist`);
    })();
  }

  private validProfileName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Profile name must not be blank');
    }
    return name.trim();
  }

  public getSubtitleStyle(profileId: number): string | null {
    const row = this.db.prepare('SELECT subtitle_style FROM profiles WHERE id = ?')
      .get(profileId) as { subtitle_style: string | null } | undefined;
    if (!row) throw new Error(`Profile ${profileId} does not exist`);
    return row.subtitle_style;
  }

  public setSubtitleStyle(profileId: number, json: string | null): void {
    if (json !== null) {
      if (typeof json !== 'string') throw new Error('Subtitle style must be JSON text or null');
      JSON.parse(json);
    }
    const result = this.db.prepare('UPDATE profiles SET subtitle_style = ? WHERE id = ?')
      .run(json, profileId);
    if (result.changes === 0) throw new Error(`Profile ${profileId} does not exist`);
  }

  public upsertHistory(profileId: number, item: WatchHistoryItem): void {
    const updatedAt = item.updated_at ?? Date.now();
    this.db.prepare(`
      INSERT INTO watch_history (
        profile_id, category, id, epIdx, title, thumb,
        position_sec, duration_sec, updated_at
      )
      VALUES (@profile_id, @category, @id, @epIdx, @title, @thumb, @position_sec, @duration_sec, @updated_at)
      ON CONFLICT(profile_id, category, id, epIdx) DO UPDATE SET
        title = excluded.title,
        thumb = excluded.thumb,
        position_sec = excluded.position_sec,
        duration_sec = excluded.duration_sec,
        updated_at = excluded.updated_at
    `).run({
      profile_id: profileId,
      category: item.category,
      id: item.id,
      epIdx: item.epIdx,
      title: item.title,
      thumb: item.thumb,
      position_sec: item.position_sec,
      duration_sec: item.duration_sec,
      updated_at: updatedAt,
    });
  }

  public getHistory(profileId: number, limit?: number): WatchHistoryItem[] {
    const boundedLimit = this.limit(limit);
    const sql = `
      SELECT category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at
      FROM watch_history
      WHERE profile_id = ?
      ORDER BY updated_at DESC
      ${boundedLimit === null ? '' : 'LIMIT ?'}
    `;
    return (boundedLimit === null
      ? this.db.prepare(sql).all(profileId)
      : this.db.prepare(sql).all(profileId, boundedLimit)) as WatchHistoryItem[];
  }

  public getHistoryItem(
    profileId: number,
    category: string,
    id: number,
    epIdx: number,
  ): WatchHistoryItem | null {
    const row = this.db.prepare(`
      SELECT category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at
      FROM watch_history
      WHERE profile_id = ? AND category = ? AND id = ? AND epIdx = ?
    `).get(profileId, category, id, epIdx) as WatchHistoryItem | undefined;
    return row ?? null;
  }

  public deleteHistoryItem(
    profileId: number,
    category: string,
    id: number,
    epIdx?: number,
  ): void {
    if (typeof epIdx === 'number') {
      this.db.prepare(`
        DELETE FROM watch_history
        WHERE profile_id = ? AND category = ? AND id = ? AND epIdx = ?
      `).run(profileId, category, id, epIdx);
    } else {
      this.db.prepare(`
        DELETE FROM watch_history
        WHERE profile_id = ? AND category = ? AND id = ?
      `).run(profileId, category, id);
    }
  }

  public addBookmark(profileId: number, item: BookmarkItem): void {
    const createdAt = item.created_at ?? Date.now();
    this.db.prepare(`
      INSERT INTO bookmarks (profile_id, category, id, title, thumb, created_at)
      VALUES (@profile_id, @category, @id, @title, @thumb, @created_at)
      ON CONFLICT(profile_id, category, id) DO UPDATE SET
        title = excluded.title,
        thumb = excluded.thumb,
        created_at = excluded.created_at
    `).run({
      profile_id: profileId,
      category: item.category,
      id: item.id,
      title: item.title,
      thumb: item.thumb,
      created_at: createdAt,
    });
  }

  public getBookmarks(profileId: number, limit?: number): BookmarkItem[] {
    const boundedLimit = this.limit(limit);
    const sql = `
      SELECT category, id, title, thumb, created_at
      FROM bookmarks
      WHERE profile_id = ?
      ORDER BY created_at DESC
      ${boundedLimit === null ? '' : 'LIMIT ?'}
    `;
    return (boundedLimit === null
      ? this.db.prepare(sql).all(profileId)
      : this.db.prepare(sql).all(profileId, boundedLimit)) as BookmarkItem[];
  }

  public isBookmarked(profileId: number, category: string, id: number): boolean {
    return this.db.prepare(`
      SELECT 1 FROM bookmarks WHERE profile_id = ? AND category = ? AND id = ?
    `).get(profileId, category, id) !== undefined;
  }

  public deleteBookmark(profileId: number, category: string, id: number): void {
    this.db.prepare(`
      DELETE FROM bookmarks WHERE profile_id = ? AND category = ? AND id = ?
    `).run(profileId, category, id);
  }

  private limit(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : null;
  }

  public upsertEpisodeCatalog(items: readonly EpisodeCatalogItem[]): void {
    if (items.length === 0) return;
    const statement = this.db.prepare(`
      INSERT INTO episode_catalog (category, id, ep_idx, ordinal, title, thumb, updated_at)
      VALUES (@category, @id, @ep_idx, @ordinal, @title, @thumb, @updated_at)
      ON CONFLICT(category, id, ep_idx) DO UPDATE SET
        ordinal = excluded.ordinal,
        title = excluded.title,
        thumb = excluded.thumb,
        updated_at = excluded.updated_at
    `);
    this.db.transaction((catalogItems: readonly EpisodeCatalogItem[]) => {
      for (const item of catalogItems) {
        statement.run({
          category: item.category,
          id: item.id,
          ep_idx: item.epIdx,
          ordinal: item.ordinal,
          title: item.title,
          thumb: item.thumb,
          updated_at: item.updated_at ?? Date.now(),
        });
      }
    })(items);
  }

  public getNextUpCandidates(profileId: number, limit: number): NextUpCandidate[] {
    const boundedLimit = this.limit(limit) ?? 20;
    return this.db.prepare(`
      WITH series_activity AS (
        SELECT c.category, c.id, MAX(h.updated_at) AS last_activity
        FROM episode_catalog c
        JOIN watch_history h
          ON h.profile_id = ?
         AND h.category = c.category
         AND h.id = c.id
        WHERE c.category <> 'movie'
        GROUP BY c.category, c.id
      ), unwatched AS (
        SELECT
          c.category,
          c.id,
          c.ep_idx,
          c.ordinal,
          c.title,
          c.thumb,
          a.last_activity,
          ROW_NUMBER() OVER (
            PARTITION BY c.category, c.id
            ORDER BY c.ordinal, c.ep_idx
          ) AS candidate_number
        FROM episode_catalog c
        JOIN series_activity a
          ON a.category = c.category AND a.id = c.id
        LEFT JOIN watch_history h
          ON h.profile_id = ?
         AND h.category = c.category
         AND h.id = c.id
         AND h.epIdx = c.ep_idx
        WHERE h.profile_id IS NULL
      )
      SELECT
        category,
        id,
        ep_idx AS epIdx,
        title,
        thumb,
        ordinal AS nextOrdinal
      FROM unwatched
      WHERE candidate_number = 1
      ORDER BY last_activity DESC, category, id
      LIMIT ?
    `).all(profileId, profileId, boundedLimit) as NextUpCandidate[];
  }

  public getWatchStateMap(
    profileId: number,
    items: readonly WatchStateItem[],
  ): Map<string, WatchState> {
    const requestedByKey = new Map<string, { category: string; id: number }>();
    for (const item of items) {
      const id = item.id ?? item.wrId;
      if (typeof id !== 'number' || !Number.isInteger(id)) continue;
      requestedByKey.set(this.watchStateKey(item.category, id), { category: item.category, id });
    }
    const requested = [...requestedByKey.values()];
    const result = new Map<string, WatchState>();
    if (requested.length === 0) return result;

    const values = requested.map(() => '(?, ?)').join(', ');
    const parameters = requested.flatMap((item) => [item.category, item.id]);
    const rows = this.db.prepare(`
      WITH requested(category, id) AS (VALUES ${values}),
      ranked_history AS (
        SELECT
          h.category,
          h.id,
          h.position_sec,
          h.duration_sec,
          ROW_NUMBER() OVER (
            PARTITION BY h.category, h.id
            ORDER BY h.updated_at DESC, h.epIdx DESC
          ) AS history_rank
        FROM watch_history h
        JOIN requested r ON r.category = h.category AND r.id = h.id
        WHERE h.profile_id = ?
      )
      SELECT
        r.category,
        r.id,
        latest.position_sec,
        latest.duration_sec,
        COUNT(c.ep_idx) AS catalog_count,
        COALESCE(SUM(CASE
          WHEN c.ep_idx IS NOT NULL AND (
            episode.position_sec IS NULL
            OR episode.duration_sec <= 0
            OR episode.position_sec / episode.duration_sec < 0.9
          ) THEN 1 ELSE 0 END), 0) AS unwatched_count
      FROM requested r
      LEFT JOIN ranked_history latest
        ON latest.category = r.category
       AND latest.id = r.id
       AND latest.history_rank = 1
      LEFT JOIN episode_catalog c
        ON c.category = r.category AND c.id = r.id
      LEFT JOIN watch_history episode
        ON episode.profile_id = ?
       AND episode.category = c.category
       AND episode.id = c.id
       AND episode.epIdx = c.ep_idx
      GROUP BY r.category, r.id, latest.position_sec, latest.duration_sec
    `).all(...parameters, profileId, profileId) as WatchStateRow[];

    for (const row of rows) {
      const position = row.position_sec ?? 0;
      const duration = row.duration_sec ?? 0;
      const rawProgress = duration > 0 ? position / duration : 0;
      const progress = Number.isFinite(rawProgress)
        ? Math.max(0, Math.min(1, rawProgress))
        : 0;
      result.set(this.watchStateKey(row.category, row.id), {
        watched: duration > 0 && rawProgress >= 0.9,
        progress,
        unwatchedCount: row.catalog_count > 0 ? row.unwatched_count : null,
      });
    }
    return result;
  }

  public watchStateKey(category: string, id: number): string {
    return `${category}:${id}`;
  }

  public getStats(profileId: number, now: number = Date.now()): ProfileStats {
    if (!Number.isFinite(now)) throw new Error('now must be a finite epoch millisecond value');

    const totals = this.db.prepare(`
      SELECT
        COALESCE(SUM(position_sec), 0) AS totalWatchSeconds,
        COUNT(DISTINCT CASE WHEN category <> 'movie' THEN category || ':' || id END) AS seriesCount,
        COUNT(DISTINCT CASE WHEN category = 'movie' THEN category || ':' || id END) AS movieCount
      FROM watch_history
      WHERE profile_id = ?
    `).get(profileId) as {
      totalWatchSeconds: number;
      seriesCount: number;
      movieCount: number;
    };

    const topSeries = this.db.prepare(`
      SELECT
        category,
        id,
        MAX(title) AS title,
        SUM(position_sec) AS watchSeconds
      FROM watch_history
      WHERE profile_id = ? AND category <> 'movie'
      GROUP BY category, id
      ORDER BY watchSeconds DESC, MAX(updated_at) DESC, category, id
      LIMIT 5
    `).all(profileId) as ProfileStats['topSeries'];

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(today);
      start.setDate(today.getDate() - (6 - index));
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      return {
        startSeconds: start.getTime() / 1000,
        endSeconds: end.getTime() / 1000,
        date: this.localDate(start),
        watchSeconds: 0,
      };
    });

    const activity = this.db.prepare(`
      SELECT position_sec, updated_at / 1000.0 AS updated_at_seconds
      FROM watch_history
      WHERE profile_id = ?
        AND updated_at / 1000.0 >= ?
        AND updated_at / 1000.0 < ?
    `).all(
      profileId,
      buckets[0].startSeconds,
      buckets[buckets.length - 1].endSeconds,
    ) as Array<{ position_sec: number; updated_at_seconds: number }>;

    for (const row of activity) {
      const bucket = buckets.find((candidate) =>
        row.updated_at_seconds >= candidate.startSeconds
        && row.updated_at_seconds < candidate.endSeconds);
      if (bucket) bucket.watchSeconds += row.position_sec;
    }

    return {
      totalWatchSeconds: totals.totalWatchSeconds,
      seriesCount: totals.seriesCount,
      movieCount: totals.movieCount,
      topSeries,
      daily: buckets.map(({ date, watchSeconds }) => ({ date, watchSeconds })),
    };
  }

  private localDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public close(): void {
    this.db.close();
  }
}

export const defaultStore = new SQLiteStore(
  process.env.OPENPLEX_DATA_PATH
    ?? (process.env.NODE_ENV === 'test' ? ':memory:' : '.data/openplex.db'),
);
