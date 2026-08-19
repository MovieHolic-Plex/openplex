import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REMUX_STATUS = {
  ok: 'ok',
  missing: 'missing',
  failed: 'failed',
} as const;

export type RemuxStatus = (typeof REMUX_STATUS)[keyof typeof REMUX_STATUS];

export type RemuxRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly code: number; readonly missing?: boolean }>;

const DEFAULT_TIMEOUT_MS = 60_000;

export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FFMPEG_PATH;
  return typeof configured === 'string' && configured.length > 0 ? configured : 'ffmpeg';
}

export async function remuxPlaylistToMp4(options: {
  readonly playlistPath: string;
  readonly outputPath: string;
  readonly ffmpegPath?: string;
  readonly run?: RemuxRunner;
}): Promise<RemuxStatus> {
  const command = options.ffmpegPath ?? resolveFfmpegPath();
  const run = options.run ?? defaultRun;
  const result = await run(command, [
    '-y',
    '-i',
    options.playlistPath,
    '-c',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    options.outputPath,
  ]);
  if (result.missing === true || result.code === 127) return REMUX_STATUS.missing;
  if (result.code !== 0 || !fs.existsSync(options.outputPath)) return REMUX_STATUS.failed;
  return REMUX_STATUS.ok;
}

export async function remuxEpisodeDirectory(
  dir: string,
  options: { readonly ffmpegPath?: string; readonly run?: RemuxRunner } = {},
): Promise<RemuxStatus> {
  return remuxPlaylistToMp4({
    playlistPath: path.join(dir, 'playlist.m3u8'),
    outputPath: path.join(dir, 'media.mp4'),
    ffmpegPath: options.ffmpegPath,
    run: options.run,
  });
}

async function defaultRun(
  command: string,
  args: readonly string[],
): Promise<{ readonly code: number; readonly missing?: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
    }, DEFAULT_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        resolve({ code: 127, missing: true });
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1 });
    });
  });
}
