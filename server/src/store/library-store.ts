import type Database from 'better-sqlite3';
import {
  createSourceAdapterTables,
  getSourceAdapter,
  isSourceAdapterEnabled,
  listSourceAdapters,
  setSourceAdapterEnabled,
  type SourceAdapterRecord,
} from './source-adapters.js';
import { createTaxonomyTables, TaxonomyStore } from './taxonomy.js';

export const LIBRARY_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('video_series', 'movie', 'comic')),
    title TEXT NOT NULL,
    overview TEXT,
    poster TEXT,
    backdrop TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    title TEXT,
    UNIQUE (work_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('episode', 'chapter')),
    ordinal INTEGER NOT NULL,
    title TEXT NOT NULL,
    thumb TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (work_id, kind, ordinal)
  );
  CREATE TABLE IF NOT EXISTS source_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
    adapter TEXT NOT NULL,
    external_id TEXT NOT NULL,
    external_url TEXT,
    UNIQUE (adapter, external_id)
  );
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('hls_local', 'hls_live', 'file', 'image_pages')),
    path TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS unit_progress (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    page_index INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, unit_id)
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    reply TEXT NOT NULL,
    tools_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export type WorkKind = 'video_series' | 'movie' | 'comic';
export type UnitKind = 'episode' | 'chapter';
export type AssetKind = 'hls_local' | 'hls_live' | 'file' | 'image_pages';

export type Work = {
  readonly id: number;
  readonly kind: WorkKind;
  readonly title: string;
  readonly overview: string | null;
  readonly poster: string | null;
  readonly backdrop: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export type Unit = {
  readonly id: number;
  readonly work_id: number;
  readonly season_id: number | null;
  readonly kind: UnitKind;
  readonly ordinal: number;
  readonly title: string;
  readonly thumb: string | null;
  readonly created_at: number;
};

export type SourceBinding = {
  readonly id: number;
  readonly work_id: number;
  readonly unit_id: number | null;
  readonly adapter: string;
  readonly external_id: string;
  readonly external_url: string | null;
};

export type Asset = {
  readonly id: number;
  readonly unit_id: number;
  readonly kind: AssetKind;
  readonly path: string | null;
  readonly size_bytes: number;
  readonly created_at: number;
};

export type UnitProgress = {
  readonly position: number;
  readonly duration: number;
  readonly page_index: number | null;
  readonly updated_at: number;
};

export function createLibraryTables(db: Database.Database): void {
  db.exec(LIBRARY_TABLES_SQL);
  createSourceAdapterTables(db);
  createTaxonomyTables(db);
}

export class LibraryStore {
  public readonly taxonomy: TaxonomyStore;

  constructor(private readonly db: Database.Database) {
    this.taxonomy = new TaxonomyStore(db);
  }

  public importTvwikiRows(): void {
    const catalog = this.db.prepare(`
      SELECT category, id, ep_idx, ordinal, title, thumb
      FROM episode_catalog
      ORDER BY category, id, ordinal, ep_idx
    `).all() as Array<{
      category: string;
      id: number;
      ep_idx: number;
      ordinal: number;
      title: string;
      thumb: string;
    }>;
    const now = Date.now();
    for (const row of catalog) {
      const workKey = `${row.category}/${row.id}`;
      const kind: WorkKind = row.category === 'movie' ? 'movie' : 'video_series';
      const work = this.ensureBoundWork('tvwiki', workKey, {
        kind,
        title: seriesTitle(row.title, row.category, row.id),
        poster: row.thumb,
      }, now);
      const unit = this.upsertUnit({
        workId: work.id,
        kind: 'episode',
        ordinal: row.ordinal,
        title: row.title,
        thumb: row.thumb,
      }, now);
      this.bindSource({
        workId: work.id,
        unitId: unit.id,
        adapter: 'tvwiki',
        externalId: `${workKey}/${row.ep_idx}`,
      });
    }

    const history = this.db.prepare(`
      SELECT profile_id, category, id, epIdx, title, thumb, position_sec, duration_sec, updated_at
      FROM watch_history
    `).all() as Array<{
      profile_id: number;
      category: string;
      id: number;
      epIdx: number;
      title: string;
      thumb: string;
      position_sec: number;
      duration_sec: number;
      updated_at: number;
    }>;
    for (const row of history) {
      const workKey = `${row.category}/${row.id}`;
      const unitKey = `${workKey}/${row.epIdx}`;
      const work = this.ensureBoundWork('tvwiki', workKey, {
        kind: row.category === 'movie' ? 'movie' : 'video_series',
        title: seriesTitle(row.title, row.category, row.id),
        poster: row.thumb,
      }, row.updated_at);
      const binding = this.binding('tvwiki', unitKey);
      let unitId = binding?.unit_id;
      if (unitId === null || unitId === undefined) {
        const unit = this.upsertUnit({
          workId: work.id,
          kind: 'episode',
          ordinal: this.nextOrdinal(work.id),
          title: row.title,
          thumb: row.thumb,
        }, row.updated_at);
        this.bindSource({
          workId: work.id,
          unitId: unit.id,
          adapter: 'tvwiki',
          externalId: unitKey,
        });
        unitId = unit.id;
      }
      this.setProgress(row.profile_id, unitId, {
        position: row.position_sec,
        duration: row.duration_sec,
      }, row.updated_at);
    }

    if (!this.tableExists('local_media')) return;
    const media = this.db.prepare(`
      SELECT category, id, epIdx, file_path, size_bytes, download_status
      FROM local_media
      WHERE download_status = 'completed' AND file_path IS NOT NULL
    `).all() as Array<{
      category: string;
      id: number;
      epIdx: number;
      file_path: string;
      size_bytes: number;
      download_status: string;
    }>;
    for (const row of media) {
      const binding = this.binding('tvwiki', `${row.category}/${row.id}/${row.epIdx}`);
      if (!binding?.unit_id) continue;
      this.addAsset({
        unitId: binding.unit_id,
        kind: 'hls_local',
        path: row.file_path,
        sizeBytes: row.size_bytes,
      }, now);
    }
  }

  public upsertWork(
    draft: {
      kind: WorkKind;
      title: string;
      overview?: string;
      poster?: string;
      backdrop?: string;
    },
    now: number,
  ): Work {
    const result = this.db.prepare(`
      INSERT INTO works (kind, title, overview, poster, backdrop, created_at, updated_at)
      VALUES (@kind, @title, @overview, @poster, @backdrop, @now, @now)
    `).run({
      kind: draft.kind,
      title: draft.title,
      overview: draft.overview ?? null,
      poster: draft.poster ?? null,
      backdrop: draft.backdrop ?? null,
      now,
    });
    const work = this.getWork(Number(result.lastInsertRowid));
    if (!work) throw new Error('Failed to persist work');
    this.taxonomy.assignDefaultLibrary(work);
    return work;
  }

  public upsertWorkTitle(id: number, title: string): void {
    this.db.prepare('UPDATE works SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id);
  }

  public upsertWorkOverview(id: number, overview: string): void {
    this.db.prepare('UPDATE works SET overview = ?, updated_at = ? WHERE id = ?')
      .run(overview, Date.now(), id);
  }

  public upsertWorkPoster(id: number, poster: string): void {
    this.db.prepare('UPDATE works SET poster = ?, updated_at = ? WHERE id = ?')
      .run(poster, Date.now(), id);
  }

  public getWork(id: number): Work | null {
    return (this.db.prepare(`
      SELECT id, kind, title, overview, poster, backdrop, created_at, updated_at
      FROM works WHERE id = ?
    `).get(id) as Work | undefined) ?? null;
  }

  public searchWorks(query: string): Work[] {
    const trimmed = query.trim();
    if (!trimmed) return this.listWorks();
    const needle = `%${trimmed}%`;
    return this.db.prepare(`
      SELECT id, kind, title, overview, poster, backdrop, created_at, updated_at
      FROM works
      WHERE title LIKE ? OR IFNULL(overview, '') LIKE ?
      ORDER BY updated_at DESC, id
    `).all(needle, needle) as Work[];
  }

  public listInProgress(profileId: number): Array<{ work: Work; unit: Unit }> {
    const rows = this.db.prepare(`
      SELECT
        w.id AS work_id, w.kind, w.title AS work_title, w.overview, w.poster, w.backdrop,
        w.created_at AS work_created, w.updated_at,
        u.id AS unit_id, u.season_id, u.kind AS unit_kind, u.ordinal, u.title AS unit_title,
        u.thumb, u.created_at AS unit_created
      FROM unit_progress p
      JOIN units u ON u.id = p.unit_id
      JOIN works w ON w.id = u.work_id
      WHERE p.profile_id = ?
        AND (p.duration <= 0 OR p.position / p.duration < 0.9)
      ORDER BY p.updated_at DESC
    `).all(profileId) as Array<{
      work_id: number;
      kind: Work['kind'];
      work_title: string;
      overview: string | null;
      poster: string | null;
      backdrop: string | null;
      work_created: number;
      updated_at: number;
      unit_id: number;
      season_id: number | null;
      unit_kind: Unit['kind'];
      ordinal: number;
      unit_title: string;
      thumb: string | null;
      unit_created: number;
    }>;
    return rows.map((row) => ({
      work: {
        id: row.work_id,
        kind: row.kind,
        title: row.work_title,
        overview: row.overview,
        poster: row.poster,
        backdrop: row.backdrop,
        created_at: row.work_created,
        updated_at: row.updated_at,
      },
      unit: {
        id: row.unit_id,
        work_id: row.work_id,
        season_id: row.season_id,
        kind: row.unit_kind,
        ordinal: row.ordinal,
        title: row.unit_title,
        thumb: row.thumb,
        created_at: row.unit_created,
      },
    }));
  }

  public listWorks(filter: {
    kind?: WorkKind;
    libraryId?: number;
    genre?: string;
    year?: number;
    collectionId?: number;
    sort?: 'title' | 'year' | 'added' | 'recent';
  } = {}): Work[] {
    return this.taxonomy.listWorks(filter);
  }

  public upsertUnit(
    draft: {
      workId: number;
      kind: UnitKind;
      ordinal: number;
      title: string;
      thumb?: string;
      seasonId?: number;
    },
    now: number,
  ): Unit {
    this.db.prepare(`
      INSERT INTO units (work_id, season_id, kind, ordinal, title, thumb, created_at)
      VALUES (@workId, @seasonId, @kind, @ordinal, @title, @thumb, @now)
      ON CONFLICT(work_id, kind, ordinal) DO UPDATE SET
        title = excluded.title,
        thumb = excluded.thumb
    `).run({
      workId: draft.workId,
      seasonId: draft.seasonId ?? null,
      kind: draft.kind,
      ordinal: draft.ordinal,
      title: draft.title,
      thumb: draft.thumb ?? null,
      now,
    });
    const unit = this.db.prepare(`
      SELECT id, work_id, season_id, kind, ordinal, title, thumb, created_at
      FROM units WHERE work_id = ? AND kind = ? AND ordinal = ?
    `).get(draft.workId, draft.kind, draft.ordinal) as Unit | undefined;
    if (!unit) throw new Error('Failed to persist unit');
    return unit;
  }

  public listUnits(workId: number): Unit[] {
    return this.db.prepare(`
      SELECT id, work_id, season_id, kind, ordinal, title, thumb, created_at
      FROM units WHERE work_id = ? ORDER BY ordinal, id
    `).all(workId) as Unit[];
  }

  public getUnit(id: number): Unit | null {
    return (this.db.prepare(`
      SELECT id, work_id, season_id, kind, ordinal, title, thumb, created_at
      FROM units WHERE id = ?
    `).get(id) as Unit | undefined) ?? null;
  }

  public bindingForWork(workId: number): SourceBinding | null {
    return (this.db.prepare(`
      SELECT id, work_id, unit_id, adapter, external_id, external_url
      FROM source_bindings
      WHERE work_id = ? AND unit_id IS NULL
      ORDER BY id
      LIMIT 1
    `).get(workId) as SourceBinding | undefined) ?? null;
  }

  public bindingForUnit(unitId: number): SourceBinding | null {
    return (this.db.prepare(`
      SELECT id, work_id, unit_id, adapter, external_id, external_url
      FROM source_bindings WHERE unit_id = ?
      ORDER BY id
      LIMIT 1
    `).get(unitId) as SourceBinding | undefined) ?? null;
  }

  public bindSource(draft: {
    workId: number;
    unitId?: number | null;
    adapter: string;
    externalId: string;
    externalUrl?: string;
  }): SourceBinding {
    this.db.prepare(`
      INSERT INTO source_bindings (work_id, unit_id, adapter, external_id, external_url)
      VALUES (@workId, @unitId, @adapter, @externalId, @externalUrl)
      ON CONFLICT(adapter, external_id) DO UPDATE SET
        work_id = excluded.work_id,
        unit_id = excluded.unit_id,
        external_url = excluded.external_url
    `).run({
      workId: draft.workId,
      unitId: draft.unitId ?? null,
      adapter: draft.adapter,
      externalId: draft.externalId,
      externalUrl: draft.externalUrl ?? null,
    });
    const row = this.binding(draft.adapter, draft.externalId);
    if (!row) throw new Error('Failed to persist source binding');
    return row;
  }

  public binding(adapter: string, externalId: string): SourceBinding | null {
    return (this.db.prepare(`
      SELECT id, work_id, unit_id, adapter, external_id, external_url
      FROM source_bindings WHERE adapter = ? AND external_id = ?
    `).get(adapter, externalId) as SourceBinding | undefined) ?? null;
  }

  public addAsset(draft: {
    unitId: number;
    kind: AssetKind;
    path: string;
    sizeBytes: number;
  }, now: number): void {
    const existing = this.db.prepare(`
      SELECT id FROM assets WHERE unit_id = ? AND kind = ? AND path = ?
    `).get(draft.unitId, draft.kind, draft.path);
    if (existing) return;
    this.db.prepare(`
      INSERT INTO assets (unit_id, kind, path, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(draft.unitId, draft.kind, draft.path, draft.sizeBytes, now);
  }

  public listAssets(unitId: number): Asset[] {
    return this.db.prepare(`
      SELECT id, unit_id, kind, path, size_bytes, created_at
      FROM assets WHERE unit_id = ? ORDER BY id
    `).all(unitId) as Asset[];
  }

  public setProgress(
    profileId: number,
    unitId: number,
    value: { position: number; duration: number; pageIndex?: number },
    now: number,
  ): void {
    this.db.prepare(`
      INSERT INTO unit_progress (profile_id, unit_id, position, duration, page_index, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, unit_id) DO UPDATE SET
        position = excluded.position,
        duration = excluded.duration,
        page_index = excluded.page_index,
        updated_at = excluded.updated_at
    `).run(profileId, unitId, value.position, value.duration, value.pageIndex ?? null, now);
  }

  public getProgress(profileId: number, unitId: number): UnitProgress | null {
    return (this.db.prepare(`
      SELECT position, duration, page_index, updated_at
      FROM unit_progress WHERE profile_id = ? AND unit_id = ?
    `).get(profileId, unitId) as UnitProgress | undefined) ?? null;
  }

  public recordAgentRun(
    draft: {
      profileId: number;
      message: string;
      reply: string;
      tools: unknown;
    },
    now: number,
  ): void {
    this.db.prepare(`
      INSERT INTO agent_runs (profile_id, message, reply, tools_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(draft.profileId, draft.message, draft.reply, JSON.stringify(draft.tools), now);
  }

  public listSourceAdapters(): SourceAdapterRecord[] {
    return listSourceAdapters(this.db);
  }

  public getSourceAdapter(name: string): SourceAdapterRecord | null {
    return getSourceAdapter(this.db, name);
  }

  public setSourceAdapterEnabled(name: string, enabled: boolean): SourceAdapterRecord | null {
    return setSourceAdapterEnabled(this.db, name, enabled);
  }

  public isSourceAdapterEnabled(name: string): boolean {
    return isSourceAdapterEnabled(this.db, name);
  }

  public nextUnwatchedUnit(profileId: number, workId: number): Unit | null {
    return (this.db.prepare(`
      SELECT u.id, u.work_id, u.season_id, u.kind, u.ordinal, u.title, u.thumb, u.created_at
      FROM units u
      LEFT JOIN unit_progress p
        ON p.unit_id = u.id AND p.profile_id = ?
      WHERE u.work_id = ?
        AND (
          p.unit_id IS NULL
          OR p.duration <= 0
          OR p.position / p.duration < 0.9
        )
      ORDER BY u.ordinal, u.id
      LIMIT 1
    `).get(profileId, workId) as Unit | undefined) ?? null;
  }

  private ensureBoundWork(
    adapter: string,
    externalId: string,
    draft: { kind: WorkKind; title: string; poster?: string },
    now: number,
  ): Work {
    const existing = this.binding(adapter, externalId);
    if (existing) {
      const work = this.getWork(existing.work_id);
      if (work) return work;
    }
    const work = this.upsertWork(draft, now);
    this.bindSource({ workId: work.id, adapter, externalId: externalId });
    return work;
  }

  private nextOrdinal(workId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM units WHERE work_id = ?
    `).get(workId) as { next: number };
    return row.next;
  }

  private tableExists(name: string): boolean {
    return this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name) !== undefined;
  }
}

function seriesTitle(raw: string, category: string, id: number): string {
  const split = raw.split(' - ');
  if (split.length > 1) return split.slice(0, -1).join(' - ');
  return `${category} ${id}`;
}
