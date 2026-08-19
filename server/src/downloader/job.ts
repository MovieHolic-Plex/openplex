import fs from 'node:fs';
import path from 'node:path';
import { convertSubtitleToWebVtt } from '../gateway/subtitle-converter.js';
import type { LocalMediaDraft, LocalMediaStore } from '../store/local-media-store.js';
import { decryptAes128Cbc, materializeAesKey, mediaSequenceIv } from './crypto.js';
import { directorySize, episodeDirectory, evictIfNeeded } from './evict.js';
import {
  DownloadError,
  fetchBuffer,
  fetchText,
  isExpiredToken,
  mapLimit,
  sleep,
} from './http.js';
import {
  highestBandwidthUri,
  mediaRelativePath,
  parsePlaylist,
  renderLocalPlaylist,
  segmentFileName,
  type ParsedPlaylist,
  type PlaylistSegment,
} from './playlist.js';
import type { LibraryStore } from '../store/library-store.js';
import { remuxEpisodeDirectory, REMUX_STATUS, type RemuxStatus } from './remux.js';

export { DownloadError };

export type EpisodeSource = {
  getEpisode(options: {
    category: string;
    wrId: number;
    epIdx: number;
  }): Promise<{
    title: string;
    thumb: string | null;
    hlsUrl: string | null;
    srt: string | null;
    vtt: string | null;
  }>;
};

export type DownloadJobContext = {
  readonly store: LocalMediaStore;
  readonly episodeApi: EpisodeSource;
  readonly mediaRoot: string;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly segmentConcurrency: number;
  readonly playlistPollIntervalMs: number;
  readonly maxInactivePolls: number;
  readonly tokenRefreshMs: number;
  readonly decodeLevel7?: (json: string) => Buffer | null;
  readonly remux?: (dir: string) => Promise<RemuxStatus>;
  readonly library?: LibraryStore;
};

let warnedMissingFfmpeg = false;

export async function downloadEpisode(
  job: LocalMediaDraft,
  signal: AbortSignal,
  context: DownloadJobContext,
): Promise<void> {
  const episode = await context.episodeApi.getEpisode({
    category: job.category,
    wrId: job.id,
    epIdx: job.epIdx,
  });
  if (!episode.hlsUrl) throw new DownloadError('Episode stream has no playlist');

  const media = await resolveMediaPlaylist(new URL(episode.hlsUrl), signal, context);
  context.store.markDownloading(job, media.playlist.segments.length, context.now());

  const dir = episodeDirectory(context.mediaRoot, job);
  fs.mkdirSync(path.join(dir, 'segments'), { recursive: true });

  const keyBytes = await loadKey(media.playlist, signal, context);
  const segments = [...media.playlist.segments];
  await writeSegments(job, dir, segments, media.playlist, keyBytes, signal, context);
  if (!media.playlist.hasEndList) {
    await growLivePlaylist(job, dir, episode.hlsUrl, segments, keyBytes, signal, context);
  }
  await writeSubtitles(dir, episode, signal, context);

  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), renderLocalPlaylist(segments));
  context.store.markCompleted({
    ...job,
    file_path: mediaRelativePath(job.category, job.id, job.epIdx),
    size_bytes: directorySize(dir),
  }, context.now());
  await remuxCompletedEpisode(job, dir, context);
  evictIfNeeded(context.store, context.mediaRoot, job);
}

async function remuxCompletedEpisode(
  job: LocalMediaDraft,
  dir: string,
  context: DownloadJobContext,
): Promise<void> {
  let status: RemuxStatus;
  try {
    if (context.remux) {
      status = await context.remux(dir);
    } else {
      status = await remuxEpisodeDirectory(dir);
      if (status === REMUX_STATUS.missing && !warnedMissingFfmpeg) {
        warnedMissingFfmpeg = true;
        console.warn('ffmpeg not found; keeping HLS playlist');
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    status = REMUX_STATUS.failed;
  }
  if (status === REMUX_STATUS.missing) return;
  if (status !== REMUX_STATUS.ok) return;
  const mp4 = path.join(dir, 'media.mp4');
  if (!fs.existsSync(mp4)) return;
  const fileRel = mediaRelativePath(job.category, job.id, job.epIdx, 'media.mp4');
  const sizeBytes = fs.statSync(mp4).size;
  const binding = context.library?.binding('tvwiki', `${job.category}/${job.id}/${job.epIdx}`);
  if (binding?.unit_id && context.library) {
    context.library.addAsset({
      unitId: binding.unit_id,
      kind: 'file',
      path: fileRel,
      sizeBytes,
    }, context.now());
  }
}

async function resolveMediaPlaylist(
  url: URL,
  signal: AbortSignal,
  context: DownloadJobContext,
): Promise<{ url: URL; playlist: ParsedPlaylist }> {
  const parsed = parsePlaylist(
    await fetchText(url, signal, 'playlist', context.fetchImpl),
    url,
  );
  if (parsed.kind === 'media') return { url, playlist: parsed };
  const variant = highestBandwidthUri(parsed);
  if (!variant) throw new DownloadError('Master playlist has no variants');
  const media = parsePlaylist(
    await fetchText(variant, signal, 'playlist', context.fetchImpl),
    variant,
  );
  if (media.segments.length === 0) throw new DownloadError('Media playlist has no segments');
  return { url: variant, playlist: media };
}

async function loadKey(
  playlist: ParsedPlaylist,
  signal: AbortSignal,
  context: DownloadJobContext,
): Promise<Buffer | null> {
  if (!playlist.key || playlist.key.method === 'NONE') return null;
  if (playlist.key.method !== 'AES-128') {
    throw new DownloadError(`Unsupported HLS key method ${playlist.key.method}`);
  }
  const raw = await fetchBuffer(playlist.key.uri, signal, 'key', context.fetchImpl);
  return materializeAesKey(raw, context.decodeLevel7);
}

async function writeSegments(
  job: LocalMediaDraft,
  dir: string,
  segments: PlaylistSegment[],
  playlist: ParsedPlaylist,
  keyBytes: Buffer | null,
  signal: AbortSignal,
  context: DownloadJobContext,
  startIndex = 0,
): Promise<void> {
  let activePlaylist = playlist;
  let lastRefreshAt = context.now();
  let refreshInFlight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const episode = await context.episodeApi.getEpisode({
        category: job.category,
        wrId: job.id,
        epIdx: job.epIdx,
      });
      if (!episode.hlsUrl) throw new DownloadError('Episode stream has no playlist');
      const media = await resolveMediaPlaylist(new URL(episode.hlsUrl), signal, context);
      for (const [index, next] of media.playlist.segments.entries()) {
        segments[index] = next;
      }
      activePlaylist = media.playlist;
      lastRefreshAt = context.now();
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  };

  let done = 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (hasSegment(dir, index)) done += 1;
  }
  context.store.setProgress(job, done, segments.length, context.now(), directorySize(dir));

  const indexes = segments.map((_, index) => index).filter((index) => index >= startIndex);
  await mapLimit(indexes, context.segmentConcurrency, async (index) => {
    if (signal.aborted) throw new DownloadError('Download cancelled');
    if (hasSegment(dir, index)) return;
    if (context.tokenRefreshMs > 0 && context.now() - lastRefreshAt >= context.tokenRefreshMs) {
      await refresh();
    }
    const body = await loadSegmentBytes(index, segments, signal, context, refresh);
    const iv = activePlaylist.key?.iv ?? mediaSequenceIv(activePlaylist.mediaSequence + index);
    const clear = keyBytes ? decryptAes128Cbc(body, keyBytes, iv) : body;
    fs.writeFileSync(path.join(dir, 'segments', segmentFileName(index)), clear);
    done += 1;
    context.store.setProgress(job, done, segments.length, context.now(), directorySize(dir));
  });
}

async function loadSegmentBytes(
  index: number,
  segments: readonly PlaylistSegment[],
  signal: AbortSignal,
  context: DownloadJobContext,
  refresh: () => Promise<void>,
): Promise<Buffer> {
  const first = segments[index];
  if (!first) throw new DownloadError(`Missing segment ${index}`);
  try {
    return await fetchBuffer(first.uri, signal, `segment ${index}`, context.fetchImpl);
  } catch (error) {
    if (!isExpiredToken(error)) throw error;
    await refresh();
    const retried = segments[index];
    if (!retried) throw error;
    return fetchBuffer(retried.uri, signal, `segment ${index}`, context.fetchImpl);
  }
}

function hasSegment(dir: string, index: number): boolean {
  try {
    return fs.statSync(path.join(dir, 'segments', segmentFileName(index))).size > 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function growLivePlaylist(
  job: LocalMediaDraft,
  dir: string,
  originalUrl: string,
  segments: PlaylistSegment[],
  keyBytes: Buffer | null,
  signal: AbortSignal,
  context: DownloadJobContext,
): Promise<void> {
  let inactive = 0;
  let playlistUrl = new URL(originalUrl);
  while (inactive < context.maxInactivePolls) {
    const current = parsePlaylist(
      await fetchText(playlistUrl, signal, 'playlist', context.fetchImpl),
      playlistUrl,
    );
    if (current.kind === 'master') break;
    if (current.hasEndList && current.segments.length <= segments.length) break;
    if (current.segments.length > segments.length) {
      const previous = segments.length;
      segments.push(...current.segments.slice(previous));
      await writeSegments(job, dir, segments, current, keyBytes, signal, context, previous);
      inactive = 0;
    } else if (current.hasEndList) {
      break;
    } else {
      inactive += 1;
      await sleep(context.playlistPollIntervalMs, signal);
      const fresh = await context.episodeApi.getEpisode({
        category: job.category,
        wrId: job.id,
        epIdx: job.epIdx,
      });
      if (fresh.hlsUrl) playlistUrl = new URL(fresh.hlsUrl);
    }
  }
}

async function writeSubtitles(
  dir: string,
  episode: { vtt: string | null; srt: string | null },
  signal: AbortSignal,
  context: DownloadJobContext,
): Promise<void> {
  const source = episode.vtt ?? episode.srt;
  if (!source) return;
  try {
    const text = await fetchText(new URL(source), signal, 'subtitle', context.fetchImpl);
    fs.writeFileSync(path.join(dir, 'subtitles.vtt'), convertSubtitleToWebVtt(text));
  } catch (error) {
    if (error instanceof DownloadError && /subtitle/i.test(error.message)) return;
    throw error;
  }
}
