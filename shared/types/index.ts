export type MediaType = 'movie' | 'tv' | 'anime';

export interface MediaItem {
  id: string;
  category?: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  mediaType: MediaType;
  voteAverage?: number;
  voteCount?: number;
  country?: string | null;
  popularity?: number;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  watchState?: {
    watched: boolean;
    progress: number;
    unwatchedCount: number | null;
  };
}

export interface Episode {
  id: string;
  mediaId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  stillPath?: string;
  airDate?: string;
}

export interface StreamSource {
  id: string;
  name: string;
  url: string;
  quality?: string;
  isM3u8?: boolean;
  headers?: Record<string, string>;
  subtitles?: SubtitleTrack[];
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  format?: 'vtt' | 'srt';
}

export interface StreamInfo {
  mediaId: string;
  season?: number;
  episode?: number;
  sources: StreamSource[];
}

export interface WatchHistoryItem {
  id: string;
  mediaId: string;
  mediaItem: MediaItem;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  progressSeconds: number;
  durationSeconds: number;
  lastWatchedAt: string;
  completed: boolean;
}

export interface BookmarkItem {
  id: string;
  mediaId: string;
  mediaItem: MediaItem;
  createdAt: string;
}
