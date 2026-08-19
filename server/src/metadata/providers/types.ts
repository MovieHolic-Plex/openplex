export type MetaHit = {
  provider: 'tmdb' | 'kmdb' | 'daum' | 'naver' | 'watcha';
  title: string | null;          // 한글 제목
  originalTitle: string | null;  // 원제
  year: number | null;
  overview: string | null;
  poster: string | null;         // URL 문자엘만
  genres: readonly string[];
  externalId: string | null;
};

export type MetaLookup =
  | { status: 'hit'; hit: MetaHit }
  | { status: 'no_match' }
  | { status: 'blocked'; httpStatus: number };

export type MetaProvider = {
  readonly name: MetaHit['provider'];
  search(query: string, kind: 'movie' | 'tv'): Promise<MetaLookup>;
};
