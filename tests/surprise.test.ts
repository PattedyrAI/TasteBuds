import {describe, expect, it} from 'vitest';
import {pickSurprise, surpriseCandidates} from '../src/domain/surprise';

const item = (id: string, average: number | null, myScore: number | null = null) => ({id, average, myScore});

describe('surprise me', () => {
  it('only offers untried items the group scores 7 or higher', () => {
    const items = [item('a', 7), item('b', 6.9), item('c', 9, 4), item('d', null), item('e', 10)];
    expect(surpriseCandidates(items).map(row => row.id)).toEqual(['a', 'e']);
  });
  it('treats a missing personal score as untried and any real score as tried', () => {
    expect(surpriseCandidates([{id: 'a', average: 8, myScore: undefined}]).map(row => row.id)).toEqual(['a']);
    expect(surpriseCandidates([item('a', 8, 1)])).toEqual([]);
  });
  it('picks uniformly with the given random source', () => {
    const pool = [item('a', 8), item('b', 8), item('c', 8)];
    expect(pickSurprise(pool, null, () => 0)?.id).toBe('a');
    expect(pickSurprise(pool, null, () => 0.5)?.id).toBe('b');
    expect(pickSurprise(pool, null, () => 0.9999)?.id).toBe('c');
    expect(pickSurprise(pool, null, () => 1)?.id).toBe('c'); // defensive upper bound
  });
  it('never repeats the previous pick when another exists, and handles one or none', () => {
    const pool = [item('a', 8), item('b', 8)];
    for (const r of [0, 0.3, 0.7, 0.99]) expect(pickSurprise(pool, 'a', () => r)?.id).toBe('b');
    expect(pickSurprise([item('a', 8)], 'a')?.id).toBe('a');
    expect(pickSurprise([], null)).toBeNull();
  });
});
