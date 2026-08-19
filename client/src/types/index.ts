import type { MediaItem, Episode } from '@openplex/shared';

export interface CategoryInfo {
  id: string;
  name: string;
  nameKo: string;
  icon?: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'all', name: 'All Categories', nameKo: '전체' },
  { id: 'drama', name: 'K-Drama', nameKo: '한국 드라마' },
  { id: 'movie', name: 'Movie', nameKo: '영화' },
  { id: 'animation', name: 'Animation', nameKo: '애니메이션' },
  { id: 'variety', name: 'TV Show / Variety', nameKo: '예능' },
  { id: 'documentary', name: 'Documentary', nameKo: '다큐' },
  { id: 'foreign_drama', name: 'Foreign Drama', nameKo: '해외 드라마' },
  { id: 'ott', name: 'OTT Originals', nameKo: 'OTT 시리즈' },
];

export interface TitleDetailResponse {
  id: string;
  category: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  rating?: number;
  releaseDate?: string;
  country?: string;
  qualityBadge?: string;
  episodes: Episode[];
  isBookmarked?: boolean;
}

export interface SearchResultResponse {
  items: MediaItem[];
  total: number;
}
