import type { WorkKind } from './library-store.js';
import { LibraryStore, type Work } from './library-store.js';
import { LocalMediaStore } from './local-media-store.js';

export type IngestUnit = {
  readonly externalId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly thumb?: string | null;
};

export type IngestWorkRequest = {
  readonly adapter: string;
  readonly externalId: string;
  readonly title: string;
  readonly kind: WorkKind;
  readonly poster?: string | null;
  readonly units: readonly IngestUnit[];
};

export type IngestAssetRequest = {
  readonly adapter: string;
  readonly category: string;
  readonly id: number;
  readonly epIdx: number;
  readonly title: string;
  readonly thumb: string;
  readonly filePath: string;
  readonly sizeBytes: number;
};

export function ingestWork(
  library: LibraryStore,
  body: IngestWorkRequest,
  now: number,
): { work: Work } {
  const existing = library.binding(body.adapter, body.externalId);
  const work = existing
    ? library.getWork(existing.work_id)
    : library.upsertWork({
        kind: body.kind,
        title: body.title,
        poster: body.poster ?? undefined,
      }, now);
  if (!work) throw new Error('Failed to persist ingested work');
  if (!existing) {
    library.bindSource({
      workId: work.id,
      adapter: body.adapter,
      externalId: body.externalId,
    });
  }
  for (const unit of body.units) {
    const saved = library.upsertUnit({
      workId: work.id,
      kind: body.kind === 'comic' ? 'chapter' : 'episode',
      ordinal: unit.ordinal,
      title: unit.title,
      thumb: unit.thumb ?? undefined,
    }, now);
    library.bindSource({
      workId: work.id,
      unitId: saved.id,
      adapter: body.adapter,
      externalId: unit.externalId,
    });
  }
  return { work };
}

export function ingestAsset(
  library: LibraryStore,
  localMedia: LocalMediaStore,
  body: IngestAssetRequest,
  now: number,
): void {
  const unitKey = `${body.category}/${body.id}/${body.epIdx}`;
  const workKey = `${body.category}/${body.id}`;
  let binding = library.binding(body.adapter, unitKey);
  if (!binding?.unit_id) {
    ingestWork(library, {
      adapter: body.adapter,
      externalId: workKey,
      title: body.title,
      kind: body.category === 'movie' ? 'movie' : 'video_series',
      units: [{
        externalId: unitKey,
        title: body.title,
        ordinal: body.epIdx,
        thumb: body.thumb,
      }],
    }, now);
    binding = library.binding(body.adapter, unitKey);
  }
  localMedia.upsertPending({
    category: body.category,
    id: body.id,
    epIdx: body.epIdx,
    title: body.title,
    thumb: body.thumb,
  }, now);
  localMedia.markCompleted({
    category: body.category,
    id: body.id,
    epIdx: body.epIdx,
    file_path: body.filePath,
    size_bytes: body.sizeBytes,
  }, now);
  if (binding?.unit_id) {
    const kind = body.filePath.endsWith('.mp4') ? 'file' : 'hls_local';
    library.addAsset({
      unitId: binding.unit_id,
      kind,
      path: body.filePath,
      sizeBytes: body.sizeBytes,
    }, now);
  }
}
