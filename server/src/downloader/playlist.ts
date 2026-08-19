export type PlaylistVariant = {
  readonly bandwidth: number;
  readonly uri: URL;
};

export type PlaylistSegment = {
  readonly uri: URL;
  readonly duration: number;
};

export type PlaylistKey = {
  readonly method: string;
  readonly uri: URL;
  readonly iv: Buffer | null;
};

export type ParsedPlaylist = {
  readonly kind: 'master' | 'media';
  readonly variants: readonly PlaylistVariant[];
  readonly segments: readonly PlaylistSegment[];
  readonly key: PlaylistKey | null;
  readonly hasEndList: boolean;
  readonly mediaSequence: number;
  readonly targetDuration: number;
};

export function parsePlaylist(text: string, baseUrl: URL): ParsedPlaylist {
  const variants: PlaylistVariant[] = [];
  const segments: PlaylistSegment[] = [];
  let pendingBandwidth: number | null = null;
  let pendingDuration: number | null = null;
  let key: PlaylistKey | null = null;
  let hasEndList = false;
  let mediaSequence = 0;
  let targetDuration = 0;

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const match = /BANDWIDTH=(\d+)/i.exec(line);
      pendingBandwidth = match ? Number(match[1]) : 0;
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number.parseFloat(line.slice('#EXTINF:'.length));
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      key = parseKeyTag(line, baseUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      hasEndList = true;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number.parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseInt(line.slice('#EXT-X-TARGETDURATION:'.length), 10) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;

    const uri = new URL(line, baseUrl);
    if (pendingBandwidth !== null) {
      variants.push({ bandwidth: pendingBandwidth, uri });
      pendingBandwidth = null;
      continue;
    }
    segments.push({
      uri,
      duration: Number.isFinite(pendingDuration) ? pendingDuration ?? 0 : 0,
    });
    pendingDuration = null;
  }

  return {
    kind: variants.length > 0 ? 'master' : 'media',
    variants,
    segments,
    key,
    hasEndList,
    mediaSequence,
    targetDuration,
  };
}

function parseKeyTag(line: string, baseUrl: URL): PlaylistKey | null {
  const method = /METHOD=([^,]+)/i.exec(line)?.[1];
  const uriMatch = /URI=(?:"([^"]+)"|'([^']+)'|([^,]+))/i.exec(line);
  const ivMatch = /IV=0x([0-9a-fA-F]+)/i.exec(line);
  const uriValue = uriMatch?.[1] ?? uriMatch?.[2] ?? uriMatch?.[3];
  if (!method || !uriValue) return null;
  return {
    method,
    uri: new URL(uriValue, baseUrl),
    iv: ivMatch?.[1] ? Buffer.from(ivMatch[1], 'hex') : null,
  };
}

export function highestBandwidthUri(playlist: ParsedPlaylist): URL | null {
  if (playlist.variants.length === 0) return null;
  let selected = playlist.variants[0];
  if (!selected) return null;
  for (const variant of playlist.variants) {
    if (variant.bandwidth > selected.bandwidth) selected = variant;
  }
  return selected.uri;
}

export function renderLocalPlaylist(segments: readonly PlaylistSegment[]): string {
  const target = Math.max(
    1,
    ...segments.map((segment) => Math.max(1, Math.ceil(segment.duration || 1))),
  );
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (const [index, segment] of segments.entries()) {
    lines.push(`#EXTINF:${segment.duration || 1},`);
    lines.push(`segments/${segmentFileName(index)}`);
  }
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

export function segmentFileName(index: number): string {
  return `seg${String(index).padStart(5, '0')}.ts`;
}

export function mediaRelativePath(
  category: string,
  id: number,
  epIdx: number,
  file = 'playlist.m3u8',
): string {
  return `${category}/${id}/${epIdx}/${file}`;
}
