import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

const dirs: string[] = [];
const stores: SQLiteStore[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const store of stores.splice(0)) {
    if (store.db.open) store.close();
  }
  for (const directory of dirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function open(): { store: SQLiteStore; library: LibraryStore } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-tax-'));
  dirs.push(directory);
  const store = new SQLiteStore(path.join(directory, 'db.sqlite'));
  stores.push(store);
  return { store, library: new LibraryStore(store.db) };
}

describe('Plex-like taxonomy', () => {
  it('seeds 영화/시리즈/만화 and assigns a new movie to 영화', () => {
    const { library } = open();
    expect(library.taxonomy.listLibraries().map((row) => row.name)).toEqual(['영화', '시리즈', '만화']);
    const work = library.upsertWork({ kind: 'movie', title: '이끼' }, 1);
    const movieLib = library.taxonomy.listLibraries().find((row) => row.kind === 'movie');
    expect(movieLib).toBeDefined();
    expect(library.listWorks({ libraryId: movieLib?.id })).toEqual([
      expect.objectContaining({ id: work.id, title: '이끼' }),
    ]);
  });

  it('lists a movie under 영화 and keeps a series out of that library', () => {
    const { library } = open();
    const movie = library.upsertWork({ kind: 'movie', title: '올드보이' }, 1);
    const series = library.upsertWork({ kind: 'video_series', title: '시그널' }, 2);
    const movieLib = library.taxonomy.defaultLibraryFor('movie');
    const showLib = library.taxonomy.defaultLibraryFor('video_series');
    expect(movieLib?.name).toBe('영화');
    expect(showLib?.name).toBe('시리즈');
    const movieTitles = library.listWorks({ libraryId: movieLib?.id }).map((row) => row.title);
    const showTitles = library.listWorks({ libraryId: showLib?.id }).map((row) => row.title);
    expect(movieTitles).toEqual(['올드보이']);
    expect(movieTitles).not.toContain('시그널');
    expect(showTitles).toEqual(['시그널']);
    expect(showTitles).not.toContain('올드보이');
    expect(movie.id).not.toBe(series.id);
  });

  it('filters works by genre and year and groups a collection', () => {
    const { library } = open();
    const moss = library.upsertWork({ kind: 'movie', title: '이끼' }, 1);
    const other = library.upsertWork({ kind: 'movie', title: '아무영화' }, 2);
    library.taxonomy.upsertMeta(moss.id, { year: 2013 });
    library.taxonomy.upsertMeta(other.id, { year: 2020 });
    library.taxonomy.setGenres(moss.id, ['스릴러']);
    library.taxonomy.setGenres(other.id, ['코미디']);
    const collection = library.taxonomy.createCollection('한국영화', 3);
    library.taxonomy.addToCollection(collection.id, moss.id);

    expect(library.listWorks({ genre: '스릴러' }).map((row) => row.title)).toEqual(['이끼']);
    expect(library.listWorks({ year: 2013 }).map((row) => row.title)).toEqual(['이끼']);
    expect(library.listWorks({ collectionId: collection.id }).map((row) => row.title)).toEqual(['이끼']);
  });

  it('exposes libraries and collection routes', async () => {
    const { store, library } = open();
    const work = library.upsertWork({ kind: 'movie', title: '이끼' }, 1);
    library.taxonomy.setGenres(work.id, ['스릴러']);
    library.taxonomy.upsertMeta(work.id, { year: 2013 });
    const app = await buildServer({
      logger: false,
      serveStatic: false,
      dependencies: { store, mediaRoot: path.join(os.tmpdir(), 'openplex-tax-media') },
    });
    apps.push(app);
    await app.ready();

    const libraries = await app.inject({ method: 'GET', url: '/api/libraries' });
    expect(libraries.statusCode).toBe(200);
    expect(libraries.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '영화', kind: 'movie' }),
    ]));
    const movieId = libraries.json().items.find((row: { kind: string }) => row.kind === 'movie').id;

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/libraries/${movieId}/works?genre=${encodeURIComponent('스릴러')}&year=2013`,
    });
    expect(filtered.json().items).toEqual([expect.objectContaining({ title: '이끼' })]);

    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { name: '한국영화' },
    });
    expect(created.statusCode).toBe(200);
    const collectionId = created.json().collection.id as number;
    const added = await app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/works`,
      payload: { workId: work.id },
    });
    expect(added.statusCode).toBe(200);

    const meta = await app.inject({
      method: 'PATCH',
      url: `/api/library/${work.id}/meta`,
      payload: { studio: '청어람', genres: ['스릴러', '미스터리'] },
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().meta.studio).toBe('청어람');
    expect(meta.json().genres).toEqual(['미스터리', '스릴러']);
  });
});
