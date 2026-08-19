import type Database from 'better-sqlite3';

export const SCHEMA_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS local_media (
    category TEXT NOT NULL,
    id INTEGER NOT NULL,
    epIdx INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    thumb TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    download_status TEXT NOT NULL CHECK (
      download_status IN ('pending', 'downloading', 'completed', 'failed')
    ),
    done_segments INTEGER NOT NULL DEFAULT 0,
    total_segments INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    PRIMARY KEY (category, id, epIdx)
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const DEFAULT_MEDIA_CACHE_BYTES = 50 * 1024 * 1024 * 1024;
const MAX_CACHE_KEY = 'media_max_bytes';
export const VISIBILITY_KEY = 'library_visibility';
export const GUEST_PROFILE_KEY = 'guest_profile_id';
export const METADATA_PROVIDERS_KEY = 'metadata_providers';
export const META_LOCK_PREFIX = 'meta_locked:';

export const KNOWN_METADATA_PROVIDERS = ['tmdb', 'kmdb', 'daum', 'naver', 'watcha'] as const;
export type MetadataProviderName = (typeof KNOWN_METADATA_PROVIDERS)[number];
export const DEFAULT_METADATA_PROVIDERS: readonly MetadataProviderName[] = KNOWN_METADATA_PROVIDERS;

function knownMetadataProviders(value: readonly unknown[]): MetadataProviderName[] {
  return value.filter(
    (name): name is MetadataProviderName =>
      typeof name === 'string'
      && (KNOWN_METADATA_PROVIDERS as readonly string[]).includes(name),
  );
}

export type LibraryVisibility = 'private' | 'public';

export const DOWNLOAD_STATUS = {
  pending: 'pending',
  downloading: 'downloading',
  completed: 'completed',
  failed: 'failed',
} as const;

export type DownloadStatus = (typeof DOWNLOAD_STATUS)[keyof typeof DOWNLOAD_STATUS];

export type LocalMediaItem = {
  readonly category: string;
  readonly id: number;
  readonly epIdx: number;
  readonly title: string;
  readonly thumb: string;
  readonly file_path: string | null;
  readonly size_bytes: number;
  readonly download_status: DownloadStatus;
  readonly done_segments: number;
  readonly total_segments: number;
  readonly error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly last_accessed_at: number | null;
};

export type LocalMediaRef = {
  readonly category: string;
  readonly id: number;
  readonly epIdx: number;
};

export type LocalMediaDraft = LocalMediaRef & {
  readonly title: string;
  readonly thumb: string;
};

export type CatalogEpisode = {
  readonly epIdx: number;
  readonly title: string;
  readonly thumb: string;
};

export function createLocalMediaTables(db: Database.Database): void {
  db.exec(SCHEMA_TABLES_SQL);
}

function isDownloadStatus(value: string): value is DownloadStatus {
  return value === 'pending'
    || value === 'downloading'
    || value === 'completed'
    || value === 'failed';
}

function asItem(row: LocalMediaItem): LocalMediaItem {
  if (!isDownloadStatus(row.download_status)) {
    throw new Error(`Invalid download_status ${row.download_status}`);
  }
  return row;
}

export class LocalMediaStore {
  constructor(private readonly db: Database.Database) {}

  public get(category: string, id: number, epIdx: number): LocalMediaItem | null {
    const row = this.db.prepare(`
      SELECT category, id, epIdx, title, thumb, file_path, size_bytes,
             download_status, done_segments, total_segments, error,
             created_at, updated_at, last_accessed_at
      FROM local_media
      WHERE category = ? AND id = ? AND epIdx = ?
    `).get(category, id, epIdx) as LocalMediaItem | undefined;
    return row ? asItem(row) : null;
  }

  public list(): LocalMediaItem[] {
    return (this.db.prepare(`
      SELECT category, id, epIdx, title, thumb, file_path, size_bytes,
             download_status, done_segments, total_segments, error,
             created_at, updated_at, last_accessed_at
      FROM local_media
      ORDER BY updated_at DESC, category, id, epIdx
    `).all() as LocalMediaItem[]).map(asItem);
  }

  public upsertPending(draft: LocalMediaDraft, now: number): LocalMediaItem {
    const existing = this.get(draft.category, draft.id, draft.epIdx);
    if (existing?.download_status === DOWNLOAD_STATUS.completed) return existing;
    if (
      existing?.download_status === DOWNLOAD_STATUS.pending
      || existing?.download_status === DOWNLOAD_STATUS.downloading
    ) {
      return existing;
    }

    this.db.prepare(`
      INSERT INTO local_media (
        category, id, epIdx, title, thumb, file_path, size_bytes,
        download_status, done_segments, total_segments, error,
        created_at, updated_at, last_accessed_at
      ) VALUES (
        @category, @id, @epIdx, @title, @thumb, NULL, 0,
        'pending', 0, 0, NULL, @now, @now, NULL
      )
      ON CONFLICT(category, id, epIdx) DO UPDATE SET
        title = excluded.title,
        thumb = excluded.thumb,
        download_status = 'pending',
        done_segments = 0,
        total_segments = 0,
        error = NULL,
        updated_at = excluded.updated_at
    `).run({ ...draft, now });
    const item = this.get(draft.category, draft.id, draft.epIdx);
    if (!item) throw new Error('Failed to persist local media row');
    return item;
  }

  public markDownloading(ref: LocalMediaRef, totalSegments: number, now: number): void {
    this.db.prepare(`
      UPDATE local_media
      SET download_status = 'downloading',
          total_segments = ?,
          updated_at = ?
      WHERE category = ? AND id = ? AND epIdx = ?
    `).run(totalSegments, now, ref.category, ref.id, ref.epIdx);
  }

  public setProgress(
    ref: LocalMediaRef,
    doneSegments: number,
    totalSegments: number,
    now: number,
    sizeBytes?: number,
  ): void {
    this.db.prepare(`
      UPDATE local_media
      SET done_segments = ?,
          total_segments = ?,
          updated_at = ?,
          size_bytes = COALESCE(?, size_bytes)
      WHERE category = ? AND id = ? AND epIdx = ?
    `).run(doneSegments, totalSegments, now, sizeBytes ?? null, ref.category, ref.id, ref.epIdx);
  }

  public markCompleted(
    ref: LocalMediaRef & { readonly file_path: string; readonly size_bytes: number },
    now: number,
  ): void {
    this.db.prepare(`
      UPDATE local_media
      SET download_status = 'completed',
          file_path = ?,
          size_bytes = ?,
          error = NULL,
          updated_at = ?
      WHERE category = ? AND id = ? AND epIdx = ?
    `).run(ref.file_path, ref.size_bytes, now, ref.category, ref.id, ref.epIdx);
  }

  public markFailed(ref: LocalMediaRef, error: string, now: number): void {
    this.db.prepare(`
      UPDATE local_media
      SET download_status = 'failed',
          error = ?,
          updated_at = ?
      WHERE category = ? AND id = ? AND epIdx = ?
    `).run(error, now, ref.category, ref.id, ref.epIdx);
  }

  public remove(ref: LocalMediaRef): void {
    this.db.prepare(`
      DELETE FROM local_media WHERE category = ? AND id = ? AND epIdx = ?
    `).run(ref.category, ref.id, ref.epIdx);
  }

  public touchAccessed(category: string, id: number, epIdx: number, now: number): void {
    this.db.prepare(`
      UPDATE local_media
      SET last_accessed_at = ?, updated_at = updated_at
      WHERE category = ? AND id = ? AND epIdx = ?
    `).run(now, category, id, epIdx);
  }

  public completedBytes(): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) AS total
      FROM local_media
      WHERE download_status = 'completed'
    `).get() as { total: number };
    return row.total;
  }

  public completedForEviction(): LocalMediaItem[] {
    return (this.db.prepare(`
      SELECT category, id, epIdx, title, thumb, file_path, size_bytes,
             download_status, done_segments, total_segments, error,
             created_at, updated_at, last_accessed_at
      FROM local_media
      WHERE download_status = 'completed'
      ORDER BY last_accessed_at IS NOT NULL, last_accessed_at ASC, created_at ASC
    `).all() as LocalMediaItem[]).map(asItem);
  }

  public interruptInFlight(now: number): LocalMediaItem[] {
    this.db.prepare(`
      UPDATE local_media
      SET download_status = 'pending', updated_at = ?
      WHERE download_status = 'downloading'
    `).run(now);
    return (this.db.prepare(`
      SELECT category, id, epIdx, title, thumb, file_path, size_bytes,
             download_status, done_segments, total_segments, error,
             created_at, updated_at, last_accessed_at
      FROM local_media
      WHERE download_status = 'pending'
      ORDER BY created_at ASC
    `).all() as LocalMediaItem[]).map(asItem);
  }

  public getMaxCacheBytes(): number {
    const row = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(MAX_CACHE_KEY) as { value: string } | undefined;
    if (!row) return DEFAULT_MEDIA_CACHE_BYTES;
    const parsed = Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEDIA_CACHE_BYTES;
  }

  public getLibraryVisibility(): LibraryVisibility {
    const row = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(VISIBILITY_KEY) as { value: string } | undefined;
    return row?.value === 'public' ? 'public' : 'private';
  }

  public setLibraryVisibility(value: LibraryVisibility): void {
    if (value !== 'private' && value !== 'public') {
      throw new Error(`Invalid library visibility: ${String(value)}`);
    }
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(VISIBILITY_KEY, value);
  }

  public getMetadataProviders(): MetadataProviderName[] {
    const row = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(METADATA_PROVIDERS_KEY) as { value: string } | undefined;
    if (!row) return [...DEFAULT_METADATA_PROVIDERS];
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return [...DEFAULT_METADATA_PROVIDERS];
    }
    if (!Array.isArray(parsed)) return [...DEFAULT_METADATA_PROVIDERS];
    const names = knownMetadataProviders(parsed);
    return [...new Set(names)];
  }

  public setMetadataProviders(names: readonly string[]): void {
    const unique = [...new Set(knownMetadataProviders(names))];
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(METADATA_PROVIDERS_KEY, JSON.stringify(unique));
  }

  public metaLockKey(workId: number): string {
    if (!Number.isSafeInteger(workId) || workId < 1) {
      throw new Error('work id must be a positive integer');
    }
    return `${META_LOCK_PREFIX}${workId}`;
  }

  public isMetaLocked(workId: number): boolean {
    const row = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(this.metaLockKey(workId)) as { value: string } | undefined;
    return row !== undefined;
  }

  public setMetaLocked(workId: number, locked: boolean): void {
    const key = this.metaLockKey(workId);
    if (locked) {
      this.db.prepare(`
        INSERT INTO app_settings (key, value) VALUES (?, '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key);
    } else {
      this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    }
  }

  public getGuestProfileId(): number | null {
    const row = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(GUEST_PROFILE_KEY) as { value: string } | undefined;
    if (!row) return null;
    const parsed = Number(row.value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
  }

  public setGuestProfileId(id: number): void {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error('guest profile id must be a positive integer');
    }
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(GUEST_PROFILE_KEY, String(id));
  }

  public setMaxCacheBytes(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      throw new Error('max cache bytes must be a positive number');
    }
    this.db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(MAX_CACHE_KEY, String(Math.floor(bytes)));
  }

  public nextCatalogEpisode(category: string, id: number, epIdx: number): CatalogEpisode | null {
    const row = this.db.prepare(`
      SELECT ep_idx AS epIdx, title, thumb
      FROM episode_catalog
      WHERE category = ? AND id = ?
        AND ordinal > (
          SELECT ordinal FROM episode_catalog
          WHERE category = ? AND id = ? AND ep_idx = ?
        )
      ORDER BY ordinal ASC, ep_idx ASC
      LIMIT 1
    `).get(category, id, category, id, epIdx) as CatalogEpisode | undefined;
    return row ?? null;
  }
}
