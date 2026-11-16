import type {Item} from '../lib/contracts';

/** "Surprise me" only suggests things the group likes: a group score of at least this. */
export const SURPRISE_MIN_SCORE = 7;

/** Items you have no current rating for, that the group scores 7 or higher. */
export function surpriseCandidates<T extends Pick<Item, 'myScore' | 'average'>>(items: readonly T[]): T[] {
  return items.filter(item => item.myScore == null && item.average != null && item.average >= SURPRISE_MIN_SCORE);
}

/** A random candidate, never the one just shown when there is another to choose. */
export function pickSurprise<T extends Pick<Item, 'id'>>(candidates: readonly T[], previousId: string | null = null, random: () => number = Math.random): T | null {
  const pool = candidates.length > 1 ? candidates.filter(item => item.id !== previousId) : candidates;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
