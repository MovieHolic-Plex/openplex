import fs from 'node:fs';
import path from 'node:path';
import type { LibraryStore, Work } from '../store/library-store.js';
import { parseFilenameHint } from '../metadata/scan.js';
import { compareNumericNames, isImageName, listZipImages, readZipImage } from './zip.js';

export type LocalAdapterOptions = {
  readonly library: LibraryStore;
  readonly now?: () => number;
};

const ARCHIVE = /\.(cbz|zip)$/i;

export class LocalAdapter {
  private readonly library: LibraryStore;
  private readonly now: () => number;

  constructor(options: LocalAdapterOptions) {
    this.library = options.library;
    this.now = options.now ?? Date.now;
  }

  public importRoot(root: string): Work[] {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Import root does not exist: ${root}`);
    }
    const works: Work[] = [];
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const work = this.importWorkDirectory(path.join(resolved, entry.name), entry.name);
      if (work) works.push(work);
    }
    return works;
  }

  public scanLibrary(row: { id: number; kind: string; path: string | null }): {
    works: Work[];
    result: { libraryId: number; files: number; truncated?: true; error?: 'PATH_MISSING' };
  } {
    if (!row.path) return { works: [], result: { libraryId: row.id, files: 0, error: 'PATH_MISSING' } };
    const root = path.resolve(row.path);
    let st: fs.Stats;
    try { st = fs.lstatSync(root); } catch { return { works: [], result: { libraryId: row.id, files: 0, error: 'PATH_MISSING' } }; }
    if (!st.isDirectory() || st.isSymbolicLink()) {
      return { works: [], result: { libraryId: row.id, files: 0, error: 'PATH_MISSING' } };
    }
    const works: Work[] = [];
    const counter = { files: 0, truncated: false };
    if (row.kind === 'movie') {
      for (const file of walkVideos(root, 0, counter)) {
        const work = this.ingestVideoFile(file, 'movie', 0, row.id);
        if (work) works.push(work);
      }
    } else if (row.kind === 'show') {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return { works: [], result: { libraryId: row.id, files: 0, error: 'PATH_MISSING' } }; }
      for (const entry of entries) {
        if (shouldSkipName(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
        const showDir = path.join(root, entry.name);
        try { if (fs.lstatSync(showDir).isSymbolicLink()) continue; } catch { continue; }
        const videos = walkVideos(showDir, 1, counter);
        if (videos.length === 0) continue;
        const series = this.ensureWork(`file:${normId(showDir)}`, 'video_series', entry.name, row.id);
        videos.sort((a, b) => a.localeCompare(b));
        for (const [index, file] of videos.entries()) {
          const hint = parseFilenameHint(path.basename(file));
          const ordinal = hint.season !== null && hint.episode !== null
            ? hint.season * 1000 + hint.episode
            : index;
          this.ingestVideoUnit(series.id, file, ordinal, hint.title);
        }
        works.push(series);
      }
    } else if (row.kind === 'comic') {
      for (const dir of walkComicRoots(root, 0, counter)) {
        const work = this.importWorkDirectory(dir, path.basename(dir));
        if (work) {
          this.library.taxonomy.assignWork(work.id, row.id);
          works.push(work);
        }
      }
    }
    const result: { libraryId: number; files: number; truncated?: true; error?: 'PATH_MISSING' } = {
      libraryId: row.id,
      files: counter.files,
    };
    if (counter.truncated) result.truncated = true;
    return { works, result };
  }

  private ensureWork(externalId: string, kind: 'movie' | 'video_series' | 'comic', title: string, libraryId: number): Work {
    const existing = this.library.binding('local', externalId);
    if (existing) {
      const work = this.library.getWork(existing.work_id);
      if (!work) throw new Error('Failed to load work');
      this.library.taxonomy.assignWork(work.id, libraryId);
      return work;
    }
    const work = this.library.upsertWork({ kind, title }, this.now());
    this.library.bindSource({ workId: work.id, adapter: 'local', externalId });
    this.library.taxonomy.assignWork(work.id, libraryId);
    return work;
  }

  private ingestVideoFile(file: string, kind: 'movie', ordinal: number, libraryId: number): Work {
    const hint = parseFilenameHint(path.basename(file));
    const work = this.ensureWork(`file:${normId(file)}`, kind, hint.title, libraryId);
    this.ingestVideoUnit(work.id, file, ordinal, hint.title);
    if (hint.year !== null) this.library.taxonomy.upsertMeta(work.id, { year: hint.year });
    return work;
  }

  private ingestVideoUnit(workId: number, file: string, ordinal: number, title: string): void {
    const unitKey = `file:${normId(file)}`;
    if (this.library.binding('local', unitKey)) return;
    const unit = this.library.upsertUnit({
      workId,
      kind: 'episode',
      ordinal,
      title,
    }, this.now());
    this.library.bindSource({ workId, unitId: unit.id, adapter: 'local', externalId: unitKey });
    this.library.addAsset({
      unitId: unit.id,
      kind: 'file',
      path: file,
      sizeBytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
    }, this.now());
  }

  public listPages(unitId: number): readonly string[] {
    const assetPath = this.assetPath(unitId);
    if (!assetPath) return [];
    return pageNames(assetPath);
  }

  public readPage(unitId: number, pageIndex: number): Buffer {
    const assetPath = this.assetPath(unitId);
    if (!assetPath) throw new Error(`Unit ${unitId} has no pages`);
    const names = pageNames(assetPath);
    if (pageIndex < 0 || pageIndex >= names.length) {
      throw new Error(`Page ${pageIndex} was not found`);
    }
    if (fs.statSync(assetPath).isDirectory()) {
      const file = names[pageIndex];
      if (!file) throw new Error(`Page ${pageIndex} was not found`);
      return fs.readFileSync(path.join(assetPath, file));
    }
    return readZipImage(fs.readFileSync(assetPath), pageIndex);
  }

  private importWorkDirectory(directory: string, title: string): Work | null {
    const chapters = discoverChapters(directory);
    if (chapters.length === 0) return null;
    const now = this.now();
    const workKey = `local:work:${directory}`;
    const existing = this.library.binding('local', workKey);
    const work = existing
      ? this.library.getWork(existing.work_id)
      : this.library.upsertWork({ kind: 'comic', title }, now);
    if (!work) throw new Error('Failed to persist imported work');
    if (!existing) {
      this.library.bindSource({ workId: work.id, adapter: 'local', externalId: workKey });
    }
    for (const [ordinal, chapter] of chapters.entries()) {
      const unitKey = `local:unit:${chapter.path}`;
      if (this.library.binding('local', unitKey)) continue;
      const unit = this.library.upsertUnit({
        workId: work.id,
        kind: 'chapter',
        ordinal,
        title: chapter.title,
      }, now);
      this.library.bindSource({
        workId: work.id,
        unitId: unit.id,
        adapter: 'local',
        externalId: unitKey,
      });
      this.library.addAsset({
        unitId: unit.id,
        kind: 'image_pages',
        path: chapter.path,
        sizeBytes: directorySize(chapter.path),
      }, now);
    }
    return work;
  }

  private assetPath(unitId: number): string | null {
    const asset = this.library.listAssets(unitId).find((item) => item.kind === 'image_pages');
    return asset?.path ?? null;
  }
}

const VIDEO = /\.(mp4|mkv|webm|mov|m4v|avi)$/i;
const MAX_FILES = 5000;
const MAX_DEPTH = 10;

function shouldSkipName(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name.startsWith('.');
}

function normId(abs: string): string {
  const resolved = path.resolve(abs);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function walkVideos(dir: string, depth: number, counter: { files: number; truncated: boolean }): string[] {
  const out: string[] = [];
  if (counter.truncated || depth > MAX_DEPTH) {
    if (depth > MAX_DEPTH) counter.truncated = true;
    return out;
  }
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (counter.truncated) break;
    if (shouldSkipName(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let st: fs.Stats;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      out.push(...walkVideos(full, depth + 1, counter));
    } else if (st.isFile() && VIDEO.test(entry.name)) {
      counter.files += 1;
      if (counter.files > MAX_FILES) { counter.truncated = true; break; }
      out.push(full);
    }
  }
  return out;
}

function walkComicRoots(dir: string, depth: number, counter: { files: number; truncated: boolean }): string[] {
  const roots: string[] = [];
  if (counter.truncated || depth > MAX_DEPTH) {
    if (depth > MAX_DEPTH) counter.truncated = true;
    return roots;
  }
  const chapters = discoverChapters(dir);
  if (chapters.length > 0) {
    counter.files += 1;
    roots.push(dir);
    return roots;
  }
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return roots; }
  for (const entry of entries) {
    if (shouldSkipName(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    try { if (fs.lstatSync(full).isSymbolicLink()) continue; } catch { continue; }
    roots.push(...walkComicRoots(full, depth + 1, counter));
  }
  return roots;
}

type Chapter = { readonly title: string; readonly path: string };

function discoverChapters(directory: string): Chapter[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const chapters: Chapter[] = [];
  const looseImages = entries
    .filter((entry) => entry.isFile() && isImageName(entry.name))
    .map((entry) => entry.name);
  if (looseImages.length > 0) {
    chapters.push({ title: path.basename(directory), path: directory });
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && ARCHIVE.test(entry.name)) {
      chapters.push({ title: stripArchiveExt(entry.name), path: full });
    }
    if (entry.isDirectory()) {
      const nested = fs.readdirSync(full).filter((name) => isImageName(name));
      if (nested.length > 0) chapters.push({ title: entry.name, path: full });
    }
  }
  return chapters;
}

function pageNames(assetPath: string): string[] {
  if (fs.statSync(assetPath).isDirectory()) {
    return fs.readdirSync(assetPath).filter((name) => isImageName(name)).sort(compareNumericNames);
  }
  return listZipImages(fs.readFileSync(assetPath)).map((entry) => entry.name);
}

function stripArchiveExt(name: string): string {
  return name.replace(/\.(cbz|zip)$/i, '');
}

function directorySize(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}
