import type { Unit, Work, WorkKind } from '../store/library-store.js';
import { encodeJellyfinId, JELLYFIN_SERVER_ID } from './ids.js';

export type JellyfinItem = {
  readonly Id: string;
  readonly Name: string;
  readonly Type: string;
  readonly IsFolder: boolean;
  readonly ServerId: string;
  readonly ParentId?: string;
};

export function workItem(work: Work): JellyfinItem {
  return {
    Id: encodeJellyfinId({ kind: 'work', id: work.id }),
    Name: work.title,
    Type: workType(work.kind),
    IsFolder: work.kind !== 'movie',
    ServerId: JELLYFIN_SERVER_ID,
  };
}

export function unitItem(unit: Unit): JellyfinItem {
  return {
    Id: encodeJellyfinId({ kind: 'unit', id: unit.id }),
    Name: unit.title,
    Type: unit.kind === 'chapter' ? 'Book' : 'Episode',
    IsFolder: false,
    ServerId: JELLYFIN_SERVER_ID,
    ParentId: encodeJellyfinId({ kind: 'work', id: unit.work_id }),
  };
}

export function matchesIncludeTypes(type: string, include: readonly string[]): boolean {
  if (include.length === 0) return true;
  return include.includes(type);
}

function workType(kind: WorkKind): string {
  switch (kind) {
    case 'video_series':
      return 'Series';
    case 'movie':
      return 'Movie';
    case 'comic':
      return 'Book';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
