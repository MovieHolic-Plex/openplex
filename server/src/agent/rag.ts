import type { LibraryStore, Work } from '../store/library-store.js';

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function scoreText(query: string, document: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const documentTokens = tokenize(document);
  if (documentTokens.length === 0) return 0;
  let hits = 0;
  for (const token of documentTokens) {
    if (queryTokens.has(token)) hits += 1;
  }
  return hits / Math.sqrt(documentTokens.length * queryTokens.size);
}

export function recommendWorks(
  library: LibraryStore,
  profileId: number,
  message: string,
  limit = 3,
): Array<{ work: Work; unitId: number | null; score: number }> {
  const inProgress = library.listInProgress(profileId);
  const taste = inProgress
    .map((item) => `${item.work.title} ${item.work.overview ?? ''} ${item.unit.title}`)
    .join(' ');
  const query = `${message} ${taste}`.trim();
  const ranked = library.listWorks()
    .map((work) => ({
      work,
      unitId: library.nextUnwatchedUnit(profileId, work.id)?.id ?? null,
      score: scoreText(query, `${work.title} ${work.overview ?? ''} ${work.kind}`),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.work.id - right.work.id);
  return ranked.slice(0, limit);
}
