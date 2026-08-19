import { parseTvwikiId } from '../adapters/types.js';
import type { LibraryStore } from '../store/library-store.js';

export function libraryHomePayload(
  library: LibraryStore,
  store: {
    getHistory(profileId: number): Array<{
      category: string;
      id: number;
      epIdx: number;
      title: string;
      thumb: string;
      position_sec: number;
      duration_sec: number;
    }>;
    getNextUpCandidates(profileId: number, limit: number): unknown[];
  },
  profileId: number,
  options?: { visitor?: boolean },
) {
  const items = library.listWorks()
    .filter((work) => work.kind === 'video_series' || work.kind === 'movie')
    .map((work) => {
      const binding = library.bindingForWork(work.id);
      const parsed = binding ? parseTvwikiId(binding.external_id) : null;
      return {
        category: parsed?.category ?? (work.kind === 'movie' ? 'movie' : 'drama'),
        wrId: parsed?.wrId ?? work.id,
        episodeId: null,
        title: work.title,
        thumbUrl: work.poster,
        country: null,
        rating: null,
        description: work.overview,
      };
    });
  const continueWatching = options?.visitor === true
    ? []
    : store.getHistory(profileId).filter((item) =>
    Number.isFinite(item.position_sec)
    && Number.isFinite(item.duration_sec)
    && item.duration_sec > 0
    && item.position_sec > 10
    && item.position_sec < item.duration_sec
    && item.position_sec / item.duration_sec < 0.9);
  return {
    sections: items.length > 0
      ? [{ title: '보관함', viewAllPath: null, items }]
      : [],
    continueWatching,
    nextUp: options?.visitor === true ? [] : store.getNextUpCandidates(profileId, 20),
  };
}
