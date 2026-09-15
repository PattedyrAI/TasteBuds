import {beforeEach, describe, expect, it, vi} from 'vitest';
import {itemMatchSearchTerms, rankItemMatches, type MatchableItem} from '../src/domain/item-matches';
import {findItemMatches} from '../src/server/item-matches';

const {listItemsMock} = vi.hoisted(() => ({listItemsMock: vi.fn()}));
vi.mock('../src/server/services/items', () => ({listItems: listItemsMock}));
beforeEach(() => { listItemsMock.mockReset(); listItemsMock.mockResolvedValue([]); });

function item(id: string, name: string, brand: string | null = null, variant: string | null = null): MatchableItem {
  return {id, name, brand, variant};
}

describe('explicit item suggestions', () => {
  it('finds a Juice/Juiced wording variation across a full product name', () => {
    const legacy = item('legacy', 'Monster Juiced Mango Loco', 'Monster', 'Mango Loco');
    const unrelated = item('other', 'Monster Ultra White', 'Monster', 'Ultra White');
    expect(rankItemMatches([unrelated, legacy], {name: 'Monster Juice Mango Loco', brand: 'Monster', variant: 'Mango Loco'})).toEqual([legacy]);
  });

  it('ranks exact wording before a close wording variation without combining IDs', () => {
    const exact = item('exact', 'Monster Juice Mango Loco', 'Monster');
    const legacy = item('legacy', 'Monster Juiced Mango Loco', 'Monster');
    expect(rankItemMatches([legacy, exact], {name: exact.name, brand: 'Monster'})).toEqual([exact, legacy]);
  });

  it('excludes known conflicting brands even when the generic item name is exact', () => {
    const coke = item('coke', 'Cola', 'Coke'), pepsi = item('pepsi', 'Cola', 'Pepsi'), unknown = item('unknown', 'Cola');
    expect(rankItemMatches([pepsi, unknown, coke], {name: 'Cola', brand: 'Coke'})).toEqual([coke, unknown]);
  });

  it('does not give known brands the same identity evidence as an explicit unknown brand', () => {
    const known = item('a', 'Cola', 'Coke'), unknown = item('z', 'Cola');
    expect(rankItemMatches([known, unknown], {name: 'Cola', brand: null})).toEqual([unknown, known]);
  });

  it('keeps known variants separate and ranks missing variant evidence lower', () => {
    const zero = item('zero', 'Cola', 'Coke', 'Zero');
    const regular = item('regular', 'Cola', 'Coke', 'Original');
    const unknown = item('unknown', 'Cola', 'Coke');
    expect(rankItemMatches([regular, unknown, zero], {name: 'Cola', brand: 'Coke', variant: 'Zero'})).toEqual([zero, unknown]);
  });

  it('returns deterministic ties and deduplicates query results without mutating inputs', () => {
    const a = item('a', 'Mango drink'), b = item('b', 'Mango drink');
    const input = [b, a, b];
    expect(rankItemMatches(input, {name: 'Mango drink'})).toEqual([a, b]);
    expect(input).toEqual([b, a, b]);
    expect(rankItemMatches([a, b], {name: 'Mango drink'})).toEqual([a, b]);
  });

  it('caps suggestions at eight after ranking every retrieved candidate', () => {
    const candidates = Array.from({length: 12}, (_, index) => item(String(index).padStart(2, '0'), 'Mango drink'));
    expect(rankItemMatches(candidates.reverse(), {name: 'Mango drink'}).map(match => match.id)).toEqual(['00', '01', '02', '03', '04', '05', '06', '07']);
  });

  it('ignores candidates matching only a brand and never expands to unrelated items', () => {
    expect(rankItemMatches([item('other', 'Coffee', 'Monster')], {name: 'Monster Juice Mango Loco', brand: 'Monster'})).toEqual([]);
  });

  it('handles case, accents and punctuation in candidate ranking', () => {
    const candidate = item('one', 'Açai-Bowl', ' Café ');
    expect(rankItemMatches([candidate], {name: 'ACAI BOWL', brand: 'café'})).toEqual([candidate]);
  });

  it('caps distinctive name searches at four plus supplied brand and variant', () => {
    const terms = itemMatchSearchTerms({name: 'The Monster Juice Mango Loco Limited Edition Summer Drink', brand: 'Example Brand', variant: 'Special Flavour'});
    expect(terms).toHaveLength(6);
    expect(terms).toContain('monster');
    expect(terms).toContain('example brand');
    expect(terms).toContain('special flavour');
    expect(terms).not.toContain('the');
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('never emits an empty catalogue search for punctuation-only names', () => {
    expect(itemMatchSearchTerms({name: '%%'})).toEqual(['%%']);
  });
});

describe('bounded group-scoped candidate retrieval', () => {
  it('accepts a one-character name from a valid recognition suggestion', async () => {
    const candidate = item('single', 'X');
    listItemsMock.mockResolvedValue([candidate]);
    await expect(findItemMatches('user', 'private-group', {name: 'X'})).resolves.toEqual([candidate]);
  });

  it('uses at most four name-token queries plus brand and variant, all within the current group', async () => {
    await findItemMatches('user', 'private-group', {name: 'One Two Three Four Five Six Seven Eight', brand: 'Example Brand', variant: 'Special Flavour'});
    expect(listItemsMock).toHaveBeenCalledTimes(6);
    for (const [userId, groupId, filters] of listItemsMock.mock.calls) {
      expect(userId).toBe('user');
      expect(groupId).toBe('private-group');
      expect(filters.limit).toBe(50);
      expect(filters.search.length).toBeGreaterThan(0);
      expect(filters.search.length).toBeLessThanOrEqual(200);
    }
  });

  it('finds full-name wording variations through the shared token candidates', async () => {
    const candidate = item('legacy', 'Monster Juiced Mango Loco', 'Monster', 'Mango Loco');
    listItemsMock.mockImplementation(async (_user, _group, filters) => filters.search === 'mango' ? [candidate] : []);
    await expect(findItemMatches('user', 'private-group', {name: 'Monster Juice Mango Loco', brand: 'Monster', variant: 'Mango Loco'})).resolves.toEqual([candidate]);
  });

  it.each([
    {}, {name: ''}, {name: 'x'.repeat(201)}, {name: 'Tea', brand: 'x'.repeat(201)},
    {name: 'Tea', variant: 'x'.repeat(201)}, {name: ['Tea']},
  ])('rejects invalid or unbounded matching inputs before querying: %j', async input => {
    await expect(findItemMatches('user', 'private-group', input)).rejects.toMatchObject({status: 400});
    expect(listItemsMock).not.toHaveBeenCalled();
  });

  it('preserves membership denial even for punctuation-only names', async () => {
    listItemsMock.mockRejectedValue({status: 404});
    await expect(findItemMatches('outsider', 'private-group', {name: '%%'})).rejects.toMatchObject({status: 404});
  });
});
