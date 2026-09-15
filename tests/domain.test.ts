import { describe, expect, it } from 'vitest';
import { identityKey, latestAverage } from '../src/domain/ratings';
import { createRatingSchema } from '../src/domain/validation';
describe('item identity', () => {
  it('keeps unknown brands distinct from known brands and variants', () => {
    expect(identityKey(' Cola ', null, null)).not.toBe(identityKey('Cola', 'Coke', null));
    expect(identityKey('Cola', 'Coke', 'Zero')).not.toBe(identityKey('Cola', 'Coke', null));
    expect(identityKey(' COLA ', ' Coke ', null)).toBe(identityKey('cola', 'coke', null));
  });
});
describe('latest-person average', () => {
  it('uses each person latest tasting, not each event, and skips deleted events', () => {
    expect(latestAverage([
      { userId: 'a', score: 2, tastedAt: '2026-01-01', createdAt: '2026-01-01' },
      { userId: 'a', score: 8, tastedAt: '2026-02-01', createdAt: '2026-02-01' },
      { userId: 'b', score: 6, tastedAt: '2026-01-01', createdAt: '2026-01-01' },
      { userId: 'b', score: 10, tastedAt: '2026-03-01', createdAt: '2026-03-01', deletedAt: '2026-04-01' },
    ])).toEqual({ average: 7, raterCount: 2, tastingCount: 3 });
  });
  it('has an honest empty state', () => expect(latestAverage([])).toEqual({ average: null, raterCount: 0, tastingCount: 0 }));
});
describe('rating validation', () => {
  const input = { groupId: 'ae27b2d0-e1ef-4bd2-b579-b34760f90560', name: 'Tea', score: 7, photoId:'ae27b2d0-e1ef-4bd2-b579-b34760f90561' };
  it('rejects bad scores, missing identity, invalid IDs and dates', () => {
    for (const patch of [{photoId:undefined}, {photoId:null}, { score: 0 }, { score: 11 }, { score: NaN }, { name: ' ' }, { groupId: 'bad' }, { tastedAt: 'invalid' }]) {
      expect(createRatingSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
    expect(createRatingSchema.safeParse(input).success).toBe(true);
  });
});
