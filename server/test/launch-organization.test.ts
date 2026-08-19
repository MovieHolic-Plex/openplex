import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/index.js';
import { LibraryStore } from '../src/store/library-store.js';
import { scanWork } from '../src/metadata/scan.js';
import { SQLiteStore } from '../src/store/sqlite-store.js';

describe('media entry library placement', () => {
  it('places a scanned movie under 영화 on two boots of the same database', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openplex-launch-org-'));
    const dbPath = path.join(directory, 'db.sqlite');
    const mediaRoot = path.join(directory, 'media');

    const first = await bootAndRead(dbPath, mediaRoot, true);
    const second = await bootAndRead(dbPath, mediaRoot, false);

    expect(first.libraryNames).toEqual(['영화', '시리즈', '만화']);
    expect(first.movieTitles).toEqual(['올드보이']);
    expect(first.year).toBe(2003);
    expect(first.movieTitles).not.toContain('시그널');
    expect(second.libraryNames).toEqual(first.libraryNames);
    expect(second.movieTitles).toEqual(first.movieTitles);
    expect(second.year).toBe(first.year);

    fs.rmSync(directory, { recursive: true, force: true });
  });
});

async function bootAndRead(dbPath: string, mediaRoot: string, seed: boolean): Promise<{
  libraryNames: string[];
  movieTitles: string[];
  year: number | null;
}> {
  const store = new SQLiteStore(dbPath);
  if (seed) {
    const library = new LibraryStore(store.db);
    const movie = library.upsertWork({ kind: 'movie', title: '올드보이.2003.1080p.mkv' }, 1);
    await scanWork(library, movie);
    library.upsertWork({ kind: 'video_series', title: '시그널' }, 2);
  }
  const app: FastifyInstance = await buildServer({
    logger: false,
    serveStatic: false,
    dependencies: { store, mediaRoot },
  });
  await app.ready();
  try {
    const libraries = await app.inject({ method: 'GET', url: '/api/libraries' });
    expect(libraries.statusCode).toBe(200);
    const items = libraries.json().items as Array<{ id: number; name: string; kind: string }>;
    const movieLib = items.find((row) => row.kind === 'movie');
    expect(movieLib).toBeDefined();
    const works = await app.inject({
      method: 'GET',
      url: `/api/libraries/${movieLib?.id}/works`,
    });
    expect(works.statusCode).toBe(200);
    const movieWork = (works.json().items as Array<{ id: number; title: string }>)[0];
    const meta = movieWork
      ? store.db.prepare('SELECT year FROM work_meta WHERE work_id = ?').get(movieWork.id) as { year: number | null } | undefined
      : undefined;
    return {
      libraryNames: items.map((row) => row.name),
      movieTitles: (works.json().items as Array<{ title: string }>).map((row) => row.title),
      year: meta?.year ?? null,
    };
  } finally {
    await app.close();
    store.close();
  }
}
