import {describe, expect, it} from 'vitest';
import {classifySugarfreeItem, reviewSugarfreeItems, type SugarfreeReviewItem} from '../src/domain/sugarfree-corrections';

const item = (patch: Partial<SugarfreeReviewItem> = {}): SugarfreeReviewItem => ({
  id: 'a', groupId: 'group-a', name: 'Original', brand: 'Monster', variant: null, ...patch,
});

describe('sugarfree review classification', () => {
  it('leaves a canonical sugarfree identity untouched', () => {
    expect(classifySugarfreeItem(item({name: 'Ultra Paradise', variant: 'Sugarfree'})))
      .toMatchObject({classification: 'canonical-sugarfree', proposed: null});
  });
  it('labels stored regular identities without claiming nutritional verification', () => {
    expect(classifySugarfreeItem(item())).toMatchObject({classification: 'canonical-regular', proposed: null});
  });
  it.each(['Sugar Free', 'sugar-free', 'sukkerfri', 'no sugar', 'zero sugar'])('strips explicit name claim %s', claim => {
    expect(classifySugarfreeItem(item({name: `Original ${claim}`})))
      .toMatchObject({classification: 'needs-normalisation', proposed: {name: 'Original', variant: 'Sugarfree'}});
  });
  it.each(['Sugar Free', 'sukkerfri', 'ZERO', 'zero sugar', 'sockerfri'])('canonicalizes variant %s', variant => {
    expect(classifySugarfreeItem(item({variant})))
      .toMatchObject({classification: 'needs-normalisation', proposed: {name: 'Original', variant: 'Sugarfree'}});
  });
  it('strips Monster Zero only in the established Zero Ultra line', () => {
    expect(classifySugarfreeItem(item({name: 'Zero Ultra'})))
      .toMatchObject({classification: 'needs-normalisation', proposed: {name: 'Ultra', variant: 'Sugarfree'}});
    expect(classifySugarfreeItem(item({name: 'Monster Zero Ultra'})).proposed?.name).toBe('Monster Ultra');
  });
  it.each(['Ultra Paradise', 'Ultra White', 'Monster Ultra Sunrise'])('recognizes brand-scoped Monster line %s', name => {
    expect(classifySugarfreeItem(item({name})))
      .toMatchObject({classification: 'known-sugarfree-product-line', proposed: {name, variant: 'Sugarfree'}});
  });
  it('leaves Coca-Cola Zero and ambiguous energy-drink Zero names for review', () => {
    for (const brand of ['Coca-Cola', 'Monster', 'Other']) {
      expect(classifySugarfreeItem(item({brand, name: 'Zero'})))
        .toMatchObject({classification: 'unknown', proposed: null});
    }
  });
  it('does not apply Monster product-line knowledge to other or missing brands', () => {
    for (const brand of ['Other', null]) {
      expect(classifySugarfreeItem(item({brand, name: 'Ultra Paradise'})))
        .toMatchObject({classification: 'unknown', proposed: null});
    }
  });
  it('preserves Red Bull Zero as a separate product from Sugarfree', () => {
    expect(classifySugarfreeItem(item({brand: 'Red Bull', name: 'Zero'})))
      .toMatchObject({classification: 'known-sugarfree-product-line', proposed: {name: 'Zero', variant: 'Sugarfree'}});
    expect(classifySugarfreeItem(item({brand: 'Red Bull', name: 'Red Bull Sugarfree'})))
      .toMatchObject({classification: 'needs-normalisation', proposed: {name: 'Red Bull', variant: 'Sugarfree'}});
  });
  it('does not discard flavours or generate an empty name', () => {
    for (const patch of [{variant: 'Mango'}, {variant: 'Mango Zero'}, {name: 'Sugar Free'}]) {
      expect(classifySugarfreeItem(item(patch))).toMatchObject({classification: 'unknown', proposed: null});
    }
  });
  it('does not match partial words or unsupported Ultra product names', () => {
    for (const name of ['Sugarfreedom', 'Zeroes', 'Ultra Mystery', 'Not Ultra Paradise']) {
      expect(classifySugarfreeItem(item({name})).proposed).toBeNull();
    }
  });
  it('does not infer sugarfree from unrelated whitespace or parentheses', () => {
    for (const name of ['Original  Green', 'Original ()', ' Original ']) {
      expect(classifySugarfreeItem(item({name})))
        .toMatchObject({classification: 'canonical-regular', proposed: null});
    }
  });
  it('preserves a known line name when it consists entirely of the claim', () => {
    expect(classifySugarfreeItem(item({brand: 'Red Bull', name: 'Sugarfree'})))
      .toMatchObject({classification: 'known-sugarfree-product-line', proposed: {name: 'Sugarfree', variant: 'Sugarfree'}});
  });
});

describe('duplicate proposals', () => {
  it('moves towards the already canonical item rather than renaming the duplicate', () => {
    const rows = reviewSugarfreeItems([
      item({id: 'legacy', name: 'Ultra Paradise Sugar Free'}),
      item({id: 'canonical', name: 'Ultra Paradise', variant: 'Sugarfree'}),
    ]);
    expect(rows.find(row => row.item.id === 'legacy'))
      .toMatchObject({moveToItemId: 'canonical', proposed: {name: 'Ultra Paradise', variant: 'Sugarfree'}});
    expect(rows.find(row => row.item.id === 'canonical')?.moveToItemId).toBeNull();
  });
  it('never merges different brands, unknown brands, or groups', () => {
    const rows = reviewSugarfreeItems([
      item({id: 'a', name: 'Original Sugar Free'}),
      item({id: 'b', name: 'Original', brand: 'Other', variant: 'Sugarfree'}),
      item({id: 'c', name: 'Original', variant: 'Sugarfree', groupId: 'other'}),
      item({id: 'd', name: 'Original Sugar Free', brand: null}),
      item({id: 'e', name: 'Original', brand: null, variant: 'Sugarfree'}),
    ]);
    expect(rows.every(row => row.moveToItemId === null)).toBe(true);
  });
  it('chooses one stable destination when all colliding identities need corrections', () => {
    const inputs = [item({id: 'b', name: 'Original sukkerfri'}), item({id: 'a', name: 'Original Sugar Free'})];
    const forward = reviewSugarfreeItems(inputs);
    const reverse = reviewSugarfreeItems([...inputs].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.find(row => row.item.id === 'b')?.moveToItemId).toBe('a');
    expect(forward.find(row => row.item.id === 'a')?.moveToItemId).toBeNull();
  });
  it('compares duplicates using the app identity normalization', () => {
    const rows = reviewSugarfreeItems([
      item({id: 'a', name: 'Original Sugar Free', brand: 'MONSTER'}),
      item({id: 'b', name: ' original ', variant: 'Sugarfree'}),
    ]);
    expect(rows.find(row => row.item.id === 'a')?.moveToItemId).toBe('b');
  });
});
