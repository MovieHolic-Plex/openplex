import fs from 'node:fs';
import path from 'node:path';
import { LocalAdapter } from '../adapters/local-adapter.js';
import { parseFilenameHint } from '../metadata/scan.js';
import { ingestAsset } from '../store/ingest.js';
import type { LibraryStore, Work } from '../store/library-store.js';
import type { LocalMediaStore } from '../store/local-media-store.js';

const MEDIA_EXT = /\.(mp4|mkv|webm|mov|m4v|avi|mp3|m4a|flac|cbz|zip)$/i;

export function isIngestableUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/')) {
    return fs.existsSync(trimmed);
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'file:') return true;
    if (url.protocol === 'http:' || url.protocol === 'https:') return MEDIA_EXT.test(url.pathname);
    return false;
  } catch {
    return false;
  }
}

export async function ingestFromUrl(options: {
  readonly url: string;
  readonly library: LibraryStore;
  readonly localMedia: LocalMediaStore;
  readonly localAdapter: LocalAdapter;
  readonly mediaRoot: string;
  readonly now: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ works: readonly Work[] }> {
  const raw = options.url.trim();
  const localPath = asLocalPath(raw);
  if (localPath) {
    if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
      return { works: options.localAdapter.importRoot(localPath) };
    }
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      return {
        works: [importLocalFile(
          options.library,
          options.localMedia,
          options.mediaRoot,
          localPath,
          options.now,
        )],
      };
    }
    throw new Error(`Path does not exist: ${localPath}`);
  }
  const url = new URL(raw);
  if (!MEDIA_EXT.test(url.pathname)) {
    throw new Error('URL is not an ingestible media file');
  }
  const dest = await downloadRemote(url, options.mediaRoot, options.fetchImpl ?? globalThis.fetch);
  return {
    works: [importLocalFile(options.library, options.localMedia, options.mediaRoot, dest, options.now)],
  };
}

function asLocalPath(raw: string): string | null {
  if (raw.startsWith('file:')) {
    const url = new URL(raw);
    return decodeURIComponent(url.pathname.startsWith('/') && /^[A-Za-z]:/.test(url.pathname.slice(1))
      ? url.pathname.slice(1)
      : url.pathname);
  }
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\')) return raw;
  return null;
}

function importLocalFile(
  library: LibraryStore,
  localMedia: LocalMediaStore,
  mediaRoot: string,
  filePath: string,
  now: number,
): Work {
  const hint = parseFilenameHint(path.basename(filePath));
  const kind = /\.(cbz|zip)$/i.test(filePath) ? 'comic' : 'movie';
  const work = library.upsertWork({ kind, title: hint.title }, now);
  if (kind === 'comic') {
    const unit = library.upsertUnit({
      workId: work.id,
      kind: 'chapter',
      ordinal: 0,
      title: hint.title,
    }, now);
    library.bindSource({
      workId: work.id,
      unitId: unit.id,
      adapter: 'url',
      externalId: `url:${filePath}`,
    });
    library.addAsset({
      unitId: unit.id,
      kind: 'image_pages',
      path: filePath,
      sizeBytes: fs.statSync(filePath).size,
    }, now);
    return work;
  }
  const id = work.id;
  const destRel = `movie/${id}/0/media.mp4`;
  const destAbs = path.join(mediaRoot, destRel);
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  if (path.resolve(filePath) !== path.resolve(destAbs)) {
    fs.copyFileSync(filePath, destAbs);
  }
  library.bindSource({ workId: work.id, adapter: 'url', externalId: `movie/${id}` });
  const unit = library.upsertUnit({
    workId: work.id,
    kind: 'episode',
    ordinal: 0,
    title: hint.title,
  }, now);
  library.bindSource({
    workId: work.id,
    unitId: unit.id,
    adapter: 'url',
    externalId: `movie/${id}/0`,
  });
  ingestAsset(library, localMedia, {
    adapter: 'url',
    category: 'movie',
    id,
    epIdx: 0,
    title: hint.title,
    thumb: '',
    filePath: destRel,
    sizeBytes: fs.statSync(destAbs).size,
  }, now);
  if (hint.year) library.taxonomy.upsertMeta(work.id, { year: hint.year });
  return work;
}

async function downloadRemote(url: URL, mediaRoot: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const name = path.basename(url.pathname) || 'media.bin';
  const dir = path.join(mediaRoot, 'url', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, bytes);
  return dest;
}
