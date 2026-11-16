import {describe, expect, it} from 'vitest';
import {mergeTarget, sameProductBlock, sameProductBlocks, sameProductPayload, validateSameProductGroups, type SameProductItem} from '../src/domain/same-product';
import {reviewPage, type SameProductReview} from '../scripts/plan-same-product-merges';

const item = (id: string, patch: Partial<SameProductItem> = {}): SameProductItem => ({id, name: 'Pistachio & Berries', brand: 'Red Bull', variant: null, type: 'Energy drinks', tastingCount: 1, ...patch});

describe('same-product blocks', () => {
  it('never puts a sugar-free item in the same block as a regular one', () => {
    expect(sameProductBlock(item('a'))).not.toBe(sameProductBlock(item('b', {variant: 'Sugarfree'})));
    expect(sameProductBlock(item('a', {variant: 'Sugarfree'}))).toBe(sameProductBlock(item('b', {variant: 'Sugar free'})));
  });
  it('treats brand spelling and type aliases as one block but keeps brands and types apart', () => {
    expect(sameProductBlock(item('a', {brand: 'Redbull'}))).toBe(sameProductBlock(item('b', {brand: 'Red Bull'})));
    expect(sameProductBlock(item('a', {type: 'Energy drink'}))).toBe(sameProductBlock(item('b')));
    expect(sameProductBlock(item('a', {brand: 'Monster'}))).not.toBe(sameProductBlock(item('b')));
    expect(sameProductBlock(item('a', {type: 'Soda'}))).not.toBe(sameProductBlock(item('b')));
  });
  it('never compares items without a brand', () => {
    expect(sameProductBlock(item('a', {brand: null}))).toBeNull();
    expect(sameProductBlock(item('a', {brand: '  '}))).toBeNull();
  });
  it('only returns blocks that have something to compare', () => {
    const blocks = sameProductBlocks([item('b'), item('a', {name: 'Winter Edition Pistachio and Berries'}), item('c', {variant: 'Sugarfree'}), item('d', {brand: null})]);
    expect(blocks.map(block => block.map(row => row.id))).toEqual([['a', 'b']]);
  });
  it('sends the model only names, non-sugar variants and counts', () => {
    const payload = sameProductPayload([item('a', {tastingCount: 3}), item('b', {name: 'Winter Edition Pistachio and Berries'})]);
    expect(payload).toEqual({brand: 'Red Bull', type: 'Energy drinks', sugarfree: false, entries: [{index: 0, name: 'Pistachio & Berries', ratings: 3}, {index: 1, name: 'Winter Edition Pistachio and Berries', ratings: 1}]});
    expect(JSON.stringify(payload)).not.toContain('"a"');
  });
});

describe('model output validation', () => {
  const block = [item('a'), item('b', {name: 'Winter Edition Pistachio and Berries'}), item('c', {name: 'Fig Apple'})];
  it('maps indexes to item ids and keeps the chosen name', () => {
    expect(validateSameProductGroups(block, [{items: [0, 1], keep: 1, confidence: .9, reason: 'Edition label only'}]))
      .toEqual([{itemIds: ['a', 'b'], keepNameOf: 'b', confidence: .9, reason: 'Edition label only'}]);
  });
  it('drops singletons, out-of-range, non-integer, overlapping and invalid groups', () => {
    const out = validateSameProductGroups(block, [
      {items: [0], keep: 0, confidence: 1, reason: ''},
      {items: [0, 7], keep: 0, confidence: 1, reason: ''},
      {items: [0, 1.5], keep: 0, confidence: 1, reason: ''},
      {items: [0, 1], keep: 2, confidence: 1, reason: 'keep outside group'},
      {items: [0, 1], keep: 0, confidence: 4, reason: 'bad confidence'},
      {items: [0, 1], keep: 0, confidence: .9, reason: 'first'},
      {items: [1, 2], keep: 1, confidence: .9, reason: 'overlaps'},
    ]);
    expect(out.map(cluster => cluster.reason)).toEqual(['first']);
  });
  it('refuses a group that mixes sugar tags even if the block was assembled wrongly', () => {
    const mixed = [item('a'), item('b', {variant: 'Sugarfree'})];
    expect(validateSameProductGroups(mixed, [{items: [0, 1], keep: 0, confidence: 1, reason: ''}])).toEqual([]);
  });
});

describe('merge target', () => {
  it('moves ratings to the most-rated item and renames it to the kept name', () => {
    const items = new Map([item('a', {tastingCount: 1}), item('b', {name: 'Winter Edition Pistachio and Berries', tastingCount: 4})].map(row => [row.id, row]));
    const target = mergeTarget({itemIds: ['a', 'b'], keepNameOf: 'a', confidence: 1, reason: ''}, items);
    expect(target.destination.id).toBe('b');
    expect(target.sources.map(row => row.id)).toEqual(['a']);
    expect(target.rename).toBe('Pistachio & Berries');
  });
  it('breaks ties by lowest id and skips a no-op rename', () => {
    const items = new Map([item('b'), item('a')].map(row => [row.id, row]));
    expect(mergeTarget({itemIds: ['b', 'a'], keepNameOf: 'b', confidence: 1, reason: ''}, items)).toMatchObject({destination: {id: 'a'}, rename: null});
  });
});

describe('review page', () => {
  it('escapes every user-typed value', () => {
    const review: SameProductReview = {version: 1, runId: '00000000-0000-4000-8000-000000000000', model: 'm', promptVersion: 'p', skippedBlocks: 0, clusters: [{
      key: '0123456789ab', groupId: '00000000-0000-4000-8000-000000000001', approved: true, confidence: .9, reason: '<img src=x onerror=alert(1)>',
      destinationId: '00000000-0000-4000-8000-000000000002', rename: '"><script>x</script>',
      items: [{id: '00000000-0000-4000-8000-000000000002', name: '<b>A</b>', brand: 'R&B', variant: null, type: null, tastingCount: 1}, {id: '00000000-0000-4000-8000-000000000003', name: 'B', brand: 'R', variant: "'v'", type: null, tastingCount: 2}],
    }]};
    const html = reviewPage(review, new Map(), new Map());
    expect(html).not.toMatch(/<script>|<img src=x|<b>A<\/b>/);
    expect(html).toContain('&lt;b&gt;A&lt;/b&gt;');
    expect(html).toContain('R&amp;B');
  });
});

describe('review file integrity', async () => {
  const {assertReviewIntegrity} = await import('../scripts/plan-same-product-merges');
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const row = (n: number, patch: Record<string, unknown> = {}) => ({id: id(n), name: `Name ${n}`, brand: 'Red Bull', variant: null, type: 'Energy drinks', tastingCount: 1, ...patch});
  const cluster = (key: string, items: ReturnType<typeof row>[], patch: Record<string, unknown> = {}) => ({key, groupId: id(99), approved: true, confidence: .9, reason: '', destinationId: items[0].id, rename: null, items, ...patch});
  const review = (clusters: ReturnType<typeof cluster>[]) => ({version: 1 as const, runId: id(98), model: 'm', promptVersion: 'p', skippedBlocks: 0, clusters});
  it('accepts an untouched review', () => {
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2)]), cluster('bbbbbbbbbbbb', [row(3), row(4)])]))).not.toThrow();
  });
  it('rejects a destination edited to an item outside its cluster (e.g. a sugar-free item elsewhere)', () => {
    const sugarfree = cluster('bbbbbbbbbbbb', [row(3, {variant: 'Sugarfree'}), row(4, {variant: 'Sugarfree'})]);
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2)], {destinationId: id(3)}), sugarfree]))).toThrow(/outside the cluster/);
  });
  it('rejects overlapping clusters, mixed sugar tags or brands, and invented names', () => {
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2)]), cluster('bbbbbbbbbbbb', [row(2), row(3)])]))).toThrow(/overlap/);
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2, {variant: 'Sugarfree'})])]))).toThrow(/Sugarfree/);
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2, {brand: 'Monster'})])]))).toThrow(/brands/);
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2)], {rename: 'Something new'})]))).toThrow(/renames/);
  });
  it('ignores clusters the operator left unapproved', () => {
    expect(() => assertReviewIntegrity(review([cluster('aaaaaaaaaaaa', [row(1), row(2)], {approved: false, destinationId: id(7)})]))).not.toThrow();
  });
});
