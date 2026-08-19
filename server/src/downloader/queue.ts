import fs from 'node:fs';
import type { LocalMediaDraft, LocalMediaItem, LocalMediaStore } from '../store/local-media-store.js';
import { removeEpisodeFiles } from './evict.js';
import {
  downloadEpisode,
  DownloadError,
  type DownloadJobContext,
  type EpisodeSource,
} from './job.js';
import type { LibraryStore } from '../store/library-store.js';
import type { RemuxStatus } from './remux.js';

export { DownloadError, type EpisodeSource };

export type DownloadQueueOptions = {
  readonly store: LocalMediaStore;
  readonly episodeApi: EpisodeSource;
  readonly mediaRoot: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly segmentConcurrency?: number;
  readonly playlistPollIntervalMs?: number;
  readonly maxInactivePolls?: number;
  readonly tokenRefreshMs?: number;
  readonly decodeLevel7?: (json: string) => Buffer | null;
  readonly remux?: (dir: string) => Promise<RemuxStatus>;
  readonly library?: LibraryStore;
  readonly onComplete?: (item: LocalMediaItem) => Promise<void>;
};

type Job = LocalMediaDraft;

function jobKey(job: Job): string {
  return `${job.category}:${job.id}:${job.epIdx}`;
}

export class DownloadQueue {
  private readonly context: DownloadJobContext;
  private readonly queued: Job[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private pumping = false;
  private readonly onComplete?: (item: LocalMediaItem) => Promise<void>;

  constructor(options: DownloadQueueOptions) {
    this.context = {
      store: options.store,
      episodeApi: options.episodeApi,
      mediaRoot: options.mediaRoot,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      now: options.now ?? Date.now,
      segmentConcurrency: options.segmentConcurrency ?? 8,
      playlistPollIntervalMs: options.playlistPollIntervalMs ?? 10_000,
      maxInactivePolls: options.maxInactivePolls ?? 6,
      tokenRefreshMs: options.tokenRefreshMs ?? 40_000,
      decodeLevel7: options.decodeLevel7,
      remux: options.remux,
      library: options.library,
    };
    this.onComplete = options.onComplete;
    fs.mkdirSync(options.mediaRoot, { recursive: true });
  }

  public enqueue(draft: LocalMediaDraft): LocalMediaItem {
    const item = this.context.store.upsertPending(draft, this.context.now());
    if (item.download_status === 'completed') return item;
    this.schedule(draft);
    return this.context.store.get(draft.category, draft.id, draft.epIdx) ?? item;
  }

  public resumeInterrupted(): void {
    for (const item of this.context.store.interruptInFlight(this.context.now())) {
      this.schedule(item);
    }
  }

  public cancel(draft: Job): void {
    const key = jobKey(draft);
    this.controllers.get(key)?.abort();
    this.queuedKeys.delete(key);
    const remaining = this.queued.filter((job) => jobKey(job) !== key);
    this.queued.length = 0;
    this.queued.push(...remaining);
    removeEpisodeFiles(this.context.mediaRoot, draft);
    this.context.store.remove(draft);
  }

  public stop(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.queued.length = 0;
    this.queuedKeys.clear();
  }

  public list(): LocalMediaItem[] {
    return this.context.store.list();
  }

  private schedule(draft: Job): void {
    const key = jobKey(draft);
    if (this.queuedKeys.has(key) || this.controllers.has(key)) return;
    this.queuedKeys.add(key);
    this.queued.push(draft);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queued.length > 0) {
        const job = this.queued.shift();
        if (!job) break;
        this.queuedKeys.delete(jobKey(job));
        await this.run(job);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async run(job: Job): Promise<void> {
    const key = jobKey(job);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    try {
      await downloadEpisode(job, controller.signal, this.context);
      const completed = this.context.store.get(job.category, job.id, job.epIdx);
      if (completed?.download_status === 'completed' && this.onComplete) {
        await this.onComplete(completed);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Download failed';
      this.context.store.markFailed(job, message, this.context.now());
    } finally {
      this.controllers.delete(key);
    }
  }
}
