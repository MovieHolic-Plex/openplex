import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Work, WorkKind } from './library-store.js';

export const LIBRARY_KIND = {
  movie: 'movie',
  show: 'show',
  comic: 'comic',
} as const;

export type LibraryKind = (typeof LIBRARY_KIND)[keyof typeof LIBRARY_KIND];

export type MediaLibrary = {
  readonly id: number;
  readonly name: string;
  readonly kind: LibraryKind;
  readonly path: string | null;
};

export type Collection = {
  readonly id: number;
  readonly name: string;
  readonly created_at: number;
};

export type WorkMeta = {
  readonly work_id: number;
  readonly year: number | null;
  readonly aired: string | null;
  readonly studio: string | null;
  readonly content_rating: string | null;
  readonly original_title: string | null;
  readonly tmdb_id: number | null;
  readonly tvdb_id: number | null;
  readonly runtime_sec: number | null;
};

export const DEFAULT_LIBRARIES = [
  { name: '영화', kind: LIBRARY_KIND.movie },
  { name: '시리즈', kind: LIBRARY_KIND.show },
  { name: '만화', kind: LIBRARY_KIND.comic },
] as const;

export function createTaxonomyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('movie', 'show', 'comic')),
      path TEXT
    );
    CREATE TABLE IF NOT EXISTS work_libraries (
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      PRIMARY KEY (work_id, library_id)
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_works (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, work_id)
    );
    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS work_genres (
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
      PRIMARY KEY (work_id, genre_id)
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS work_tags (
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (work_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS work_meta (
      work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
      year INTEGER,
      aired TEXT,
      studio TEXT,
      content_rating TEXT,
      original_title TEXT,
      tmdb_id INTEGER,
      tvdb_id INTEGER,
      runtime_sec INTEGER
    );
  `);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO libraries (name, kind, path) VALUES (?, ?, NULL)
  `);
  for (const seed of DEFAULT_LIBRARIES) {
    insert.run(seed.name, seed.kind);
  }
}

export class TaxonomyStore {
  constructor(private readonly db: Database.Database) {}

  public listLibraries(): MediaLibrary[] {
    return this.db.prepare(`
      SELECT id, name, kind, path FROM libraries ORDER BY id
    `).all() as MediaLibrary[];
  }

  public getLibrary(id: number): MediaLibrary | null {
    return (this.db.prepare(`
      SELECT id, name, kind, path FROM libraries WHERE id = ?
    `).get(id) as MediaLibrary | undefined) ?? null;
  }

  public setLibraryPath(id: number, libraryPath: string | null): void {
    if (!this.getLibrary(id)) {
      throw new Error(`Library ${id} was not found`);
    }
    const trimmed = libraryPath === null ? null : libraryPath.trim();
    const normalized = trimmed === null || trimmed.length === 0 ? null : trimmed;
    if (normalized !== null && !path.isAbsolute(normalized)) {
      throw new Error(`Library path must be absolute: ${normalized}`);
    }
    this.db.prepare(`
      UPDATE libraries SET path = ? WHERE id = ?
    `).run(normalized, id);
  }

  public setLibraryPaths(
    entries: ReadonlyArray<{ readonly id: number; readonly path: string | null }>,
  ): void {
    const applyAll = this.db.transaction(() => {
      for (const entry of entries) {
        this.setLibraryPath(entry.id, entry.path);
      }
    });
    applyAll();
  }

  public defaultLibraryFor(kind: WorkKind): MediaLibrary | null {
    const libraryKind: LibraryKind = kind === 'movie'
      ? LIBRARY_KIND.movie
      : kind === 'comic'
        ? LIBRARY_KIND.comic
        : LIBRARY_KIND.show;
    return (this.db.prepare(`
      SELECT id, name, kind, path FROM libraries WHERE kind = ? ORDER BY id LIMIT 1
    `).get(libraryKind) as MediaLibrary | undefined) ?? null;
  }

  public assignWork(workId: number, libraryId: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO work_libraries (work_id, library_id) VALUES (?, ?)
    `).run(workId, libraryId);
  }

  public assignDefaultLibrary(work: Work): void {
    const library = this.defaultLibraryFor(work.kind);
    if (library) this.assignWork(work.id, library.id);
  }

  public listWorks(filter: {
    readonly libraryId?: number;
    readonly genre?: string;
    readonly year?: number;
    readonly collectionId?: number;
    readonly kind?: WorkKind;
    readonly sort?: 'title' | 'year' | 'added' | 'recent';
  } = {}): Work[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.kind) {
      clauses.push('w.kind = ?');
      params.push(filter.kind);
    }
    if (filter.libraryId) {
      clauses.push('EXISTS (SELECT 1 FROM work_libraries wl WHERE wl.work_id = w.id AND wl.library_id = ?)');
      params.push(filter.libraryId);
    }
    if (filter.collectionId) {
      clauses.push('EXISTS (SELECT 1 FROM collection_works cw WHERE cw.work_id = w.id AND cw.collection_id = ?)');
      params.push(filter.collectionId);
    }
    if (filter.genre) {
      clauses.push(`EXISTS (
        SELECT 1 FROM work_genres wg
        JOIN genres g ON g.id = wg.genre_id
        WHERE wg.work_id = w.id AND g.name = ?
      )`);
      params.push(filter.genre);
    }
    if (filter.year) {
      clauses.push('EXISTS (SELECT 1 FROM work_meta m WHERE m.work_id = w.id AND m.year = ?)');
      params.push(filter.year);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const order = filter.sort === 'title'
      ? 'w.title COLLATE NOCASE, w.id'
      : filter.sort === 'year'
        ? 'IFNULL((SELECT year FROM work_meta WHERE work_id = w.id), 0) DESC, w.id'
        : filter.sort === 'added'
          ? 'w.created_at DESC, w.id'
          : 'w.updated_at DESC, w.id';
    return this.db.prepare(`
      SELECT w.id, w.kind, w.title, w.overview, w.poster, w.backdrop, w.created_at, w.updated_at
      FROM works w
      ${where}
      ORDER BY ${order}
    `).all(...params) as Work[];
  }

  public createCollection(name: string, now: number): Collection {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Collection name must not be blank');
    const result = this.db.prepare(`
      INSERT INTO collections (name, created_at) VALUES (?, ?)
    `).run(trimmed, now);
    const row = this.getCollection(Number(result.lastInsertRowid));
    if (!row) throw new Error('Failed to persist collection');
    return row;
  }

  public getCollection(id: number): Collection | null {
    return (this.db.prepare(`
      SELECT id, name, created_at FROM collections WHERE id = ?
    `).get(id) as Collection | undefined) ?? null;
  }

  public listCollections(): Collection[] {
    return this.db.prepare(`
      SELECT id, name, created_at FROM collections ORDER BY name COLLATE NOCASE, id
    `).all() as Collection[];
  }

  public addToCollection(collectionId: number, workId: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?, ?)
    `).run(collectionId, workId);
  }

  public setGenres(workId: number, names: readonly string[]): void {
    this.db.prepare('DELETE FROM work_genres WHERE work_id = ?').run(workId);
    const insertGenre = this.db.prepare('INSERT OR IGNORE INTO genres (name) VALUES (?)');
    const link = this.db.prepare(`
      INSERT OR IGNORE INTO work_genres (work_id, genre_id)
      SELECT ?, id FROM genres WHERE name = ?
    `);
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed.length === 0) continue;
      insertGenre.run(trimmed);
      link.run(workId, trimmed);
    }
  }

  public listGenres(workId: number): string[] {
    return (this.db.prepare(`
      SELECT g.name FROM genres g
      JOIN work_genres wg ON wg.genre_id = g.id
      WHERE wg.work_id = ?
      ORDER BY g.name
    `).all(workId) as Array<{ name: string }>).map((row) => row.name);
  }

  public listAllGenres(): string[] {
    return (this.db.prepare(`
      SELECT name FROM genres ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
  }

  public getMeta(workId: number): WorkMeta | null {
    return (this.db.prepare(`
      SELECT work_id, year, aired, studio, content_rating, original_title, tmdb_id, tvdb_id, runtime_sec
      FROM work_meta WHERE work_id = ?
    `).get(workId) as WorkMeta | undefined) ?? null;
  }

  public upsertMeta(workId: number, patch: Partial<Omit<WorkMeta, 'work_id'>>): WorkMeta {
    const current = this.getMeta(workId);
    const next = {
      year: patch.year !== undefined ? patch.year : current?.year ?? null,
      aired: patch.aired !== undefined ? patch.aired : current?.aired ?? null,
      studio: patch.studio !== undefined ? patch.studio : current?.studio ?? null,
      content_rating: patch.content_rating !== undefined ? patch.content_rating : current?.content_rating ?? null,
      original_title: patch.original_title !== undefined ? patch.original_title : current?.original_title ?? null,
      tmdb_id: patch.tmdb_id !== undefined ? patch.tmdb_id : current?.tmdb_id ?? null,
      tvdb_id: patch.tvdb_id !== undefined ? patch.tvdb_id : current?.tvdb_id ?? null,
      runtime_sec: patch.runtime_sec !== undefined ? patch.runtime_sec : current?.runtime_sec ?? null,
    };
    this.db.prepare(`
      INSERT INTO work_meta (
        work_id, year, aired, studio, content_rating, original_title, tmdb_id, tvdb_id, runtime_sec
      ) VALUES (
        @workId, @year, @aired, @studio, @content_rating, @original_title, @tmdb_id, @tvdb_id, @runtime_sec
      )
      ON CONFLICT(work_id) DO UPDATE SET
        year = excluded.year,
        aired = excluded.aired,
        studio = excluded.studio,
        content_rating = excluded.content_rating,
        original_title = excluded.original_title,
        tmdb_id = excluded.tmdb_id,
        tvdb_id = excluded.tvdb_id,
        runtime_sec = excluded.runtime_sec
    `).run({ workId, ...next });
    const saved = this.getMeta(workId);
    if (!saved) throw new Error('Failed to persist work metadata');
    return saved;
  }
}
