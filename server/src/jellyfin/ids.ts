export const JELLYFIN_VIEW_ID = 'view:library' as const;
export const JELLYFIN_SERVER_ID = 'openplex' as const;

export type JellyfinItemId =
  | { readonly kind: 'view' }
  | { readonly kind: 'work'; readonly id: number }
  | { readonly kind: 'unit'; readonly id: number };

export function encodeJellyfinId(id: JellyfinItemId): string {
  switch (id.kind) {
    case 'view':
      return JELLYFIN_VIEW_ID;
    case 'work':
      return `work:${id.id}`;
    case 'unit':
      return `unit:${id.id}`;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

export function parseJellyfinId(raw: string): JellyfinItemId | null {
  if (raw === JELLYFIN_VIEW_ID) return { kind: 'view' };
  const match = /^(work|unit):(\d+)$/.exec(raw);
  if (!match) return null;
  const kind = match[1];
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id < 1) return null;
  if (kind === 'work') return { kind: 'work', id };
  if (kind === 'unit') return { kind: 'unit', id };
  return null;
}
