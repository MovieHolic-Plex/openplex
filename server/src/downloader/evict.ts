import fs from 'node:fs';
import path from 'node:path';
import type { LocalMediaRef, LocalMediaStore } from '../store/local-media-store.js';

export function episodeDirectory(mediaRoot: string, ref: LocalMediaRef): string {
  return path.join(mediaRoot, ref.category, String(ref.id), String(ref.epIdx));
}

export function directorySize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}

export function removeEpisodeFiles(mediaRoot: string, ref: LocalMediaRef): void {
  fs.rmSync(episodeDirectory(mediaRoot, ref), { recursive: true, force: true });
}

export function evictIfNeeded(
  store: LocalMediaStore,
  mediaRoot: string,
  keep: LocalMediaRef,
): void {
  const maxBytes = store.getMaxCacheBytes();
  let used = store.completedBytes();
  if (used <= maxBytes) return;

  for (const item of store.completedForEviction()) {
    if (used <= maxBytes) return;
    if (item.category === keep.category && item.id === keep.id && item.epIdx === keep.epIdx) {
      continue;
    }
    removeEpisodeFiles(mediaRoot, item);
    store.remove(item);
    used -= item.size_bytes;
  }
}
