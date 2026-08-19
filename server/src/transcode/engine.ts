import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFfmpegPath, type RemuxRunner } from '../downloader/remux.js';

export const TRANSCODE_PROFILES = {
  original: 'original',
  '1080p': '1080p',
  '720p': '720p',
  '480p': '480p',
} as const;

export type TranscodeProfile = (typeof TRANSCODE_PROFILES)[keyof typeof TRANSCODE_PROFILES];

export type TranscodeJob = {
  readonly id: string;
  readonly profile: TranscodeProfile;
  readonly status: 'ready' | 'running' | 'completed' | 'failed' | 'unavailable';
  readonly playlistPath: string | null;
  readonly error: string | null;
};

const HEIGHT: Record<Exclude<TranscodeProfile, 'original'>, number> = {
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
};

export function isTranscodeProfile(value: string): value is TranscodeProfile {
  return value === 'original' || value === '1080p' || value === '720p' || value === '480p';
}

export class TranscodeEngine {
  private readonly jobs = new Map<string, TranscodeJob>();

  constructor(
    private readonly options: {
      readonly root: string;
      readonly run?: RemuxRunner;
    },
  ) {
    fs.mkdirSync(options.root, { recursive: true });
  }

  public get(id: string): TranscodeJob | null {
    return this.jobs.get(id) ?? null;
  }

  public async start(inputPath: string, profile: TranscodeProfile): Promise<TranscodeJob> {
    if (profile === 'original') {
      const job: TranscodeJob = {
        id: randomUUID(),
        profile,
        status: 'ready',
        playlistPath: inputPath,
        error: null,
      };
      this.jobs.set(job.id, job);
      return job;
    }
    const id = randomUUID();
    const dir = path.join(this.options.root, id);
    fs.mkdirSync(dir, { recursive: true });
    const playlistPath = path.join(dir, 'index.m3u8');
    const running: TranscodeJob = {
      id,
      profile,
      status: 'running',
      playlistPath,
      error: null,
    };
    this.jobs.set(id, running);
    const height = HEIGHT[profile];
    const args = [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-vf',
      `scale=-2:${height}`,
      '-c:a',
      'aac',
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_list_size',
      '0',
      playlistPath,
    ];
    const run = this.options.run ?? defaultRun;
    const result = await run(resolveFfmpegPath(), args);
    const finished: TranscodeJob = result.missing === true || result.code === 127
      ? { id, profile, status: 'unavailable', playlistPath: null, error: 'ffmpeg not found' }
      : result.code === 0 && fs.existsSync(playlistPath)
        ? { id, profile, status: 'completed', playlistPath, error: null }
        : { id, profile, status: 'failed', playlistPath: null, error: 'transcode failed' };
    this.jobs.set(id, finished);
    return finished;
  }
}

async function defaultRun(
  command: string,
  args: readonly string[],
): Promise<{ readonly code: number; readonly missing?: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: 'ignore' });
    child.on('error', (error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        resolve({ code: 127, missing: true });
        return;
      }
      reject(error);
    });
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}
