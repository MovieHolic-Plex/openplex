import type { WorkKind } from '../store/library-store.js';

export type AdapterSearchHit = {
  readonly adapter: string;
  readonly externalId: string;
  readonly title: string;
  readonly kind: WorkKind;
  readonly poster: string | null;
};

export type AdapterUnit = {
  readonly externalId: string;
  readonly title: string;
  readonly ordinal: number;
  readonly thumb: string | null;
};

export type AdapterWork = {
  readonly adapter: string;
  readonly externalId: string;
  readonly title: string;
  readonly kind: WorkKind;
  readonly overview: string | null;
  readonly poster: string | null;
  readonly units: readonly AdapterUnit[];
};

export type TvwikiPlayable = {
  readonly category: string;
  readonly wrId: number;
  readonly epIdx: number;
};

export type EnqueueSpec = {
  readonly category: string;
  readonly id: number;
  readonly epIdx: number;
  readonly title: string;
  readonly thumb: string;
};

export interface SourceAdapter {
  readonly name: string;
  search(query: string): Promise<readonly AdapterSearchHit[]>;
  getWork(externalId: string): Promise<AdapterWork | null>;
}

export function parseTvwikiId(externalId: string): TvwikiPlayable | null {
  const match = /^([a-z_]+)\/(\d+)(?:\/(\d+))?$/.exec(externalId);
  if (!match) return null;
  const category = match[1];
  const wrId = Number(match[2]);
  const epIdx = match[3] === undefined ? null : Number(match[3]);
  if (!category || !Number.isInteger(wrId)) return null;
  return {
    category,
    wrId,
    epIdx: epIdx ?? 0,
  };
}
