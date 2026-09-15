import {describe,it,expect} from 'vitest';
import {ratingDateValue,ratingTimestamp} from '../src/lib/rating-date';
describe('rating calendar dates',()=>{
  it('preserves the original instant when correcting a score without changing its date',()=>{
    const original='2024-07-01T21:46:38.123Z';
    expect(ratingTimestamp(ratingDateValue(original),original)).toBe(original);
  });
  it('converts a chosen calendar day to a valid ISO datetime at local noon',()=>{
    const result=ratingTimestamp('2026-09-15');
    expect(result).toMatch(/^2026-09-\d{2}T\d{2}:00:00\.000Z$/);
    expect(new Date(result).getHours()).toBe(12);expect(ratingDateValue(result)).toBe('2026-09-15');
  });
  it('rejects invalid calendar input rather than silently moving into the next month',()=>{
    expect(()=>ratingTimestamp('2026-02-30')).toThrow();expect(()=>ratingTimestamp('not-a-date')).toThrow();
  });
});
