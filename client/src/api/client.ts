import type {
  BookmarkItem,
  Episode,
  MediaItem,
  SubtitleTrack,
  WatchHistoryItem,
} from '@openplex/shared';
import type { SearchResultResponse, TitleDetailResponse } from '../types';

interface ApiTitleItem {
  category: string;
  wrId: number;
  episodeId: number | null;
  title: string;
  thumbUrl: string | null;
  country: string | null;
  rating: number | null;
  description: string | null;
  goodCount?: number | null;
  watchState?: {
    watched: boolean;
    progress: number;
    unwatchedCount: number | null;
  };
}

interface ApiHomeSection {
  title: string;
  viewAllPath: string | null;
  items: ApiTitleItem[];
}

interface ApiHistoryItem {
  category: string;
  id: number;
  epIdx: number;
  title: string;
  thumb: string;
  position_sec: number;
  duration_sec: number;
  updated_at?: number;
}

interface ApiEpisode {
  category: string;
  wrId: number;
  epIdx: number;
  title: string;
  desc: string | null;
  thumbUrl: string | null;
}

interface ApiNextUpItem {
  category: string;
  id: number;
  epIdx: number;
  title: string;
  thumb: string;
  nextOrdinal: number;
}

export interface NextUpItem extends ApiNextUpItem {
  seriesTitle: string;
  seriesThumb?: string;
}

export interface StreamSessionResponse {
  sessionId: string;
  playlistUrl: string;
  fileUrl?: string;
  source?: 'live' | 'local';
  subtitles: SubtitleTrack[];
  title: string;
  nextEpisode: Record<string, unknown> | null;
}

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface LocalDownloadItem {
  category: string;
  id: number;
  epIdx: number;
  title: string;
  thumb: string;
  file_path: string | null;
  size_bytes: number;
  download_status: DownloadStatus;
  done_segments: number;
  total_segments: number;
  error: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number | null;
}

export interface DownloadsResponse {
  items: LocalDownloadItem[];
  usedBytes: number;
  maxBytes: number;
}

export function downloadKey(category: string, id: number | string, epIdx: number): string {
  return `${category}:${id}:${epIdx}`;
}

export type LibraryWork = {
  id: number;
  kind: 'video_series' | 'movie' | 'comic';
  title: string;
  overview: string | null;
  poster: string | null;
  backdrop: string | null;
};

export type LibraryUnit = {
  id: number;
  work_id: number;
  kind: 'episode' | 'chapter';
  ordinal: number;
  title: string;
  thumb: string | null;
};

export type ComicMeta = {
  work: LibraryWork;
  unit: LibraryUnit;
  pageCount: number;
};

export type AgentTurn = {
  reply: string;
  tools: Array<{ name: string; arguments: unknown; result: unknown }>;
};

function mediaType(category: string): MediaItem['mediaType'] {
  if (category === 'movie') return 'movie';
  if (category === 'animation') return 'anime';
  return 'tv';
}

function mediaItem(item: ApiTitleItem): MediaItem {
  return {
    id: String(item.wrId),
    category: item.category,
    title: item.title,
    overview: item.description ?? undefined,
    posterPath: item.thumbUrl ?? undefined,
    backdropPath: item.thumbUrl ?? undefined,
    mediaType: mediaType(item.category),
    voteAverage: item.rating ?? undefined,
    country: item.country ?? null,
    popularity: typeof item.goodCount === 'number' ? item.goodCount : undefined,
    watchState: item.watchState,
  };
}

function historyItem(item: ApiHistoryItem): WatchHistoryItem {
  const watchedAt = new Date(item.updated_at ?? Date.now()).toISOString();
  return {
    id: `${item.category}-${item.id}-${item.epIdx}`,
    mediaId: String(item.id),
    mediaItem: {
      id: String(item.id),
      category: item.category,
      title: item.title,
      posterPath: item.thumb || undefined,
      backdropPath: item.thumb || undefined,
      mediaType: mediaType(item.category),
    },
    episodeNumber: item.epIdx,
    episodeTitle: `Episode ${item.epIdx}`,
    progressSeconds: item.position_sec,
    durationSeconds: item.duration_sec,
    lastWatchedAt: watchedAt,
    completed: item.duration_sec > 0 && item.position_sec / item.duration_sec > 0.9,
  };
}

export interface ProfileItem {
  id: number;
  name: string;
  avatar_color: string | null;
  subtitle_style: string | null;
  created_at: number | null;
}

export interface SubtitleStyle {
  fontScale: number;
  color: 'white' | 'yellow' | 'cyan';
  backgroundOpacity: number;
  edgeStyle: 'none' | 'shadow' | 'outline';
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontScale: 100,
  color: 'white',
  backgroundOpacity: 70,
  edgeStyle: 'none',
};

export interface ProfileStats {
  totalWatchSeconds: number;
  seriesCount: number;
  movieCount: number;
  topSeries: Array<{
    category: string;
    id: number;
    title: string;
    watchSeconds: number;
  }>;
  daily: Array<{
    date: string;
    watchSeconds: number;
  }>;
}

export const METADATA_PROVIDERS = [
  { id: 'tmdb', label: 'TMDB' },
  { id: 'kmdb', label: 'KMDb' },
  { id: 'daum', label: '다음' },
  { id: 'naver', label: '네이버' },
  { id: 'watcha', label: '왓챠' },
] as const;

export interface SettingsData {
  visibility: 'private' | 'public';
  libraries: Array<{ id: number; name: string; kind: string; path: string | null }>;
  originHint: string | null;
  bindUnchanged: true;
  visitor: boolean;
  metadataProviders?: string[];
  kmdbConfigured?: boolean;
}

export const PROFILE_STORAGE_KEY = 'openplex.profileId';
export const AUTH_TOKEN_STORAGE_KEY = 'openplex.authToken';

export function withAuthToken(url: string): string {
  const token = readStoredAuthToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function readStoredAuthToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const query = new URLSearchParams(window.location.search).get('token');
  if (query) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, query);
    return query;
  }
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

class ApiClient {
  private readonly baseUrl = '/api';

  public getActiveProfileId(): number | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  public getAuthToken(): string | null {
    return readStoredAuthToken();
  }

  public setAuthToken(token: string | null): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (token === null || token.length === 0) {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    }
  }

  public setActiveProfileId(id: number | null): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (id === null) {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, String(id));
    }
  }

  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('Accept', 'application/json');
    if (options?.body !== undefined) headers.set('Content-Type', 'application/json');

    const activeProfileId = this.getActiveProfileId();
    if (activeProfileId !== null) {
      headers.set('X-Profile-Id', String(activeProfileId));
    }
    const token = this.getAuthToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });
    if (!response.ok) {
      let errPayload: unknown;
      try {
        errPayload = await response.json();
      } catch {
        // ignore json parse error
      }
      const message = (errPayload && typeof errPayload === 'object' && 'error' in errPayload && typeof (errPayload as { error?: { message?: string } }).error?.message === 'string')
        ? (errPayload as { error: { message: string } }).error.message
        : `OpenPlex API returned ${response.status}`;
      const err = new Error(message) as Error & { status?: number; data?: unknown };
      err.status = response.status;
      err.data = errPayload;
      throw err;
    }
    return response.json() as Promise<T>;
  }

  async getProfiles(): Promise<ProfileItem[]> {
    const res = await this.fetchJson<{ items: ProfileItem[] }>('/profiles');
    return res.items;
  }

  async createProfile(name: string, avatarColor?: string | null): Promise<ProfileItem> {
    const res = await this.fetchJson<{ profile: ProfileItem }>('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, color: avatarColor ?? null }),
    });
    return res.profile;
  }

  async renameProfile(id: number, name: string): Promise<ProfileItem> {
    const res = await this.fetchJson<{ profile: ProfileItem }>(`/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    return res.profile;
  }

  async deleteProfile(id: number): Promise<void> {
    await this.fetchJson<{ success: boolean }>(`/profiles/${id}`, {
      method: 'DELETE',
    });
  }

  async getProfileStats(id: number): Promise<ProfileStats> {
    return this.fetchJson<ProfileStats>(`/profiles/${id}/stats`);
  }

  async getSubtitleStyle(id: number): Promise<SubtitleStyle> {
    const response = await this.fetchJson<{ style: SubtitleStyle | null }>(
      `/profiles/${id}/subtitle-style`,
    );
    return response.style ?? { ...DEFAULT_SUBTITLE_STYLE };
  }

  async updateSubtitleStyle(id: number, style: SubtitleStyle): Promise<SubtitleStyle> {
    const response = await this.fetchJson<{ style: SubtitleStyle }>(
      `/profiles/${id}/subtitle-style`,
      { method: 'PUT', body: JSON.stringify({ style }) },
    );
    return response.style;
  }

  async getHome(): Promise<{
    heroItems: MediaItem[];
    nextUp: NextUpItem[];
    continueWatching: WatchHistoryItem[];
    sections: Array<{ id: string; title: string; category: string; items: MediaItem[] }>;
  }> {
    const response = await this.fetchJson<{
      sections: ApiHomeSection[];
      continueWatching: ApiHistoryItem[];
      nextUp: ApiNextUpItem[];
    }>('/home');
    const sections = response.sections.map((section, index) => {
      const category = section.viewAllPath?.split('/').filter(Boolean)[0]
        ?? section.items[0]?.category
        ?? 'drama';
      return {
        id: `${category}-${index}`,
        title: section.title,
        category,
        items: section.items.map(mediaItem),
      };
    });
    const catalogItems = sections.flatMap((section) => section.items);
    const seriesByKey = new Map(
      catalogItems.map((item) => [`${item.category}:${item.id}`, item]),
    );
    return {
      heroItems: catalogItems.slice(0, 5),
      nextUp: response.nextUp.map((item) => {
        const series = seriesByKey.get(`${item.category}:${item.id}`);
        return {
          ...item,
          seriesTitle: series?.title ?? item.title,
          seriesThumb: series?.backdropPath ?? series?.posterPath,
        };
      }),
      continueWatching: response.continueWatching.map(historyItem),
      sections,
    };
  }

  async getCategoryItems(category: string, page = 1): Promise<{
    items: MediaItem[];
    hasNext: boolean;
    page: number;
  }> {
    const response = await this.fetchJson<{
      items: ApiTitleItem[];
      hasNext: boolean;
      page: number;
    }>(`/category/${category}?page=${page}`);
    return { ...response, items: response.items.map(mediaItem) };
  }

  async search(query: string): Promise<SearchResultResponse> {
    if (!query.trim()) return { items: [], total: 0 };
    const response = await this.fetchJson<{ items: ApiTitleItem[]; total: number }>(
      `/search?q=${encodeURIComponent(query)}`,
    );
    return { items: response.items.map(mediaItem), total: response.total };
  }

  async getTitleDetail(id: string, category = 'drama'): Promise<TitleDetailResponse> {
    const response = await this.fetchJson<{
      category: string;
      wrId: number;
      title: string;
      episodes: ApiEpisode[];
    }>(`/title/${category}/${id}`);
    return {
      id: String(response.wrId),
      category: response.category,
      title: response.title,
      episodes: response.episodes.map((episode): Episode => ({
        id: `${episode.wrId}-${episode.epIdx}`,
        mediaId: String(episode.wrId),
        seasonNumber: 1,
        episodeNumber: episode.epIdx,
        title: episode.title,
        overview: episode.desc ?? undefined,
        stillPath: episode.thumbUrl ?? undefined,
      })),
    };
  }

  async createStream(category: string, id: string | number, epIdx: number): Promise<StreamSessionResponse> {
    return this.fetchJson<StreamSessionResponse>(`/stream/${category}/${id}/${epIdx}`, {
      method: 'POST',
    });
  }

  async createUnitStream(unitId: number): Promise<{ source: string; fileUrl: string; title: string; sessionId: string }> {
    return this.fetchJson(`/library/units/${unitId}/stream`, { method: 'POST' });
  }

  async getLibrary(kind?: 'video_series' | 'movie' | 'comic', extras?: {
    libraryId?: number;
    genre?: string;
    year?: number;
    sort?: 'recent' | 'added' | 'title' | 'year';
  }): Promise<LibraryWork[]> {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (extras?.libraryId) params.set('libraryId', String(extras.libraryId));
    if (extras?.genre) params.set('genre', extras.genre);
    if (extras?.year) params.set('year', String(extras.year));
    if (extras?.sort) params.set('sort', extras.sort);
    const query = params.toString();
    const response = await this.fetchJson<{ items: LibraryWork[] }>(`/library${query ? `?${query}` : ''}`);
    return response.items;
  }

  async getLibraries(): Promise<Array<{ id: number; name: string; kind: string }>> {
    const response = await this.fetchJson<{ items: Array<{ id: number; name: string; kind: string }> }>('/libraries');
    return response.items;
  }

  async ingestUrl(url: string): Promise<LibraryWork[]> {
    const response = await this.fetchJson<{ items: LibraryWork[] }>('/ingest/url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    return response.items;
  }

  async getLibraryWork(id: number): Promise<{ work: LibraryWork; units: LibraryUnit[] }> {
    return this.fetchJson(`/library/${id}`);
  }

  async getUnitBinding(unitId: number): Promise<{
    adapter: string;
    externalId: string;
    workId: number;
    unitId: number | null;
  }> {
    return this.fetchJson(`/library/units/${unitId}/binding`);
  }

  async getSources(): Promise<Array<{ name: string; enabled: boolean; kind: string; kinds: string[] }>> {
    const response = await this.fetchJson<{
      items: Array<{ name: string; enabled: boolean; kind: string; kinds: string[] }>;
    }>('/sources');
    return response.items;
  }

  async setSourceEnabled(name: string, enabled: boolean): Promise<{
    name: string;
    enabled: boolean;
    kind: string;
    kinds: string[];
  }> {
    const response = await this.fetchJson<{
      item: { name: string; enabled: boolean; kind: string; kinds: string[] };
    }>(`/sources/${name}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    return response.item;
  }

  async importLibrary(root: string): Promise<LibraryWork[]> {
    const response = await this.fetchJson<{ items: LibraryWork[] }>('/library/import', {
      method: 'POST',
      body: JSON.stringify({ root }),
    });
    return response.items;
  }

  async getComic(unitId: number): Promise<ComicMeta> {
    return this.fetchJson(`/comics/${unitId}`);
  }

  async fetchComicPage(unitId: number, page: number): Promise<Blob> {
    const headers = new Headers();
    const profileId = this.getActiveProfileId();
    if (profileId !== null) headers.set('X-Profile-Id', String(profileId));
    const token = this.getAuthToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`/api/comics/${unitId}/pages/${page}`, { headers });
    if (!response.ok) throw new Error(`Comic page ${page} failed (${response.status})`);
    return response.blob();
  }

  async getAgentOauthStatus(): Promise<{ configured: boolean; authorized: boolean }> {
    return this.fetchJson('/agent/oauth/status');
  }

  async startAgentOauth(): Promise<{ authorizeUrl: string; state: string }> {
    return this.fetchJson('/agent/oauth/start');
  }

  async agentTurn(message: string): Promise<AgentTurn> {
    return this.fetchJson<AgentTurn>('/agent/turn', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async enqueueDownloadByUnit(unitId: number): Promise<LocalDownloadItem> {
    const response = await this.fetchJson<{ item: LocalDownloadItem }>('/downloads', {
      method: 'POST',
      body: JSON.stringify({ unitId }),
    });
    return response.item;
  }

  async saveComicProgress(unitId: number, pageIndex: number, pageCount: number): Promise<void> {
    await this.fetchJson(`/library/units/${unitId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ pageIndex, pageCount }),
    });
  }

  async getDownloads(): Promise<DownloadsResponse> {
    return this.fetchJson<DownloadsResponse>('/downloads');
  }

  async enqueueDownload(payload: {
    category: string;
    id: number | string;
    epIdx: number;
    title: string;
    thumb: string;
  }): Promise<LocalDownloadItem> {
    const response = await this.fetchJson<{ item: LocalDownloadItem }>('/downloads', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        id: typeof payload.id === 'string' ? Number(payload.id) : payload.id,
      }),
    });
    return response.item;
  }

  async deleteDownload(category: string, id: number | string, epIdx: number): Promise<void> {
    await this.fetchJson<{ success: boolean }>(`/downloads/${category}/${id}/${epIdx}`, {
      method: 'DELETE',
    });
  }

  async updateHistory(payload: {
    category: string;
    id: number | string;
    epIdx: number;
    title: string;
    thumb: string;
    position_sec: number;
    duration_sec: number;
    sessionId?: string;
  }): Promise<{ success: boolean }> {
    return this.fetchJson<{ success: boolean }>('/history', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getSettings(): Promise<SettingsData> {
    return this.fetchJson<SettingsData>('/settings');
  }

  async putSettings(payload: {
    visibility?: 'private' | 'public';
    libraries?: Array<{ id: number; path: string | null }>;
    metadataProviders?: string[];
  }): Promise<SettingsData> {
    return this.fetchJson<SettingsData>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async scanLibrary(): Promise<unknown> {
    return this.fetchJson<unknown>('/library/scan', { method: 'POST' });
  }

  async getBookmarks(): Promise<BookmarkItem[]> {
    const response = await this.fetchJson<{
      items: Array<{ category: string; id: number; title: string; thumb: string; created_at: number }>;
    }>('/bookmarks');
    return response.items.map((item) => ({
      id: `${item.category}-${item.id}`,
      mediaId: String(item.id),
      mediaItem: {
        id: String(item.id),
        title: item.title,
        posterPath: item.thumb || undefined,
        mediaType: mediaType(item.category),
      },
      createdAt: new Date(item.created_at).toISOString(),
    }));
  }
}

export const api = new ApiClient();
