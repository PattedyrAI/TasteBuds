import {SUGARFREE_VARIANT, isSugarfree} from './energy-drinks';
import {identityKey} from './ratings';

export type SugarfreeReviewItem = {id: string; groupId: string; name: string; brand: string | null; variant: string | null};
export type SugarfreeClassification = 'canonical-sugarfree' | 'canonical-regular' | 'needs-normalisation' | 'known-sugarfree-product-line' | 'unknown';
export type SugarfreeReview = {
  item: SugarfreeReviewItem;
  classification: SugarfreeClassification;
  reason: string;
  proposed: {name: string; variant: string} | null;
  moveToItemId: string | null;
};
const words = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, ' ').trim();
const claim = /\b(?:sugar[\s-]*free|zero[\s-]+sugar|no[\s-]+sugar|sukkerfri|sockerfri)\b/gi;
const exactVariant = /^(?:sugar free|sugarfree|zero(?: sugar)?|no sugar|sukkerfri|sockerfri)$/;

/** Deliberately finite product-line table; expand only after label/source review.
 * Manufacturer sources checked 2026-10-13:
 * https://www.monsterenergy.com/en-ca/energy-drinks/monster-ultra/zero-ultra/
 * https://www.monsterenergy.com/en-ca/energy-drinks/monster-ultra/zero-sugar-ultra-paradise/
 * https://www.monsterenergy.com/en-pr/energy-drinks/monster-ultra/
 * https://www.redbull.com/int-en/energydrink/questions/what-is-red-bull-sugarfree
 * https://www.redbull.com/int-en/energydrink/questions/what-is-the-difference-between-red-bull-zero-and-red-bull-sugarfree
 * Zero Ultra / White, Paradise and Sunrise are documented Monster Ultra products.
 * Red Bull Zero and Sugarfree are distinct formulations: never collapse their names.
 */
export const KNOWN_SUGARFREE_PRODUCT_LINES = [
  {brand: 'Monster', names: ['ultra', 'zero ultra', 'ultra white', 'ultra paradise', 'ultra sunrise']},
  {brand: 'Red Bull', names: ['zero', 'sugarfree', 'sugar free']},
] as const;

function knownLine(brand: string | null, name: string): boolean {
  if (!brand) return false;
  const brandKey = words(brand);
  const product = words(name).replace(brandKey === 'monster' ? /^monster(?: energy)?\s+/ : /^red\s*bull\s+/, '');
  return KNOWN_SUGARFREE_PRODUCT_LINES.some(line => words(line.brand) === brandKey &&
    (line.names as readonly string[]).includes(product));
}

export function classifySugarfreeItem(item: SugarfreeReviewItem): SugarfreeReview {
  const result = (classification: SugarfreeClassification, reason: string, name?: string): SugarfreeReview => ({
    item, classification, reason, proposed: name === undefined ? null : {name, variant: SUGARFREE_VARIANT}, moveToItemId: null,
  });
  if (item.variant === SUGARFREE_VARIANT) return result('canonical-sugarfree', 'Stored sugarfree identity; unchanged');
  if (item.variant !== null && (!isSugarfree(item.variant) || !exactVariant.test(words(item.variant)))) {
    return result('unknown', 'Non-canonical or mixed flavour variant; human/photo review required');
  }
  const hasNameClaim = item.name.match(claim) !== null;
  const cleanName = hasNameClaim
    ? item.name.replace(claim, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s+/g, ' ').trim()
    : item.name.trim();
  const productLine = knownLine(item.brand, item.name);
  // Bare Zero is not a universal sugar claim. Only the explicit Monster Zero Ultra alias is stripped.
  const monsterZeroUltra = words(item.brand || '') === 'monster' &&
    /^(?:monster(?: energy)? )?zero ultra$/.test(words(item.name));
  const proposedName = monsterZeroUltra ? cleanName.replace(/\bzero\s+/i, '') : cleanName;
  if (!proposedName) return productLine
    ? result('known-sugarfree-product-line', 'Keep the complete product-line name to avoid an empty identity; review required', item.name.trim())
    : result('unknown', 'Removing the claim would empty the product name; human/photo review required');
  if (hasNameClaim || monsterZeroUltra || item.variant !== null) {
    return result('needs-normalisation', 'Explicit sugarfree claim; review proposed canonical identity', proposedName);
  }
  if (productLine) return result('known-sugarfree-product-line', 'Manufacturer-listed sugarfree product line; review required', item.name.trim());
  if (/\b(?:zero|ultra)\b/i.test(item.name) || !item.brand?.trim()) {
    return result('unknown', 'Ambiguous product name or missing brand; human/photo review required');
  }
  return result('canonical-regular', 'Stored regular identity only; sugar content unverified');
}

/** Uses the same identity comparison as the app, never across groups or unknown brands. */
export function reviewSugarfreeItems(items: SugarfreeReviewItem[]): SugarfreeReview[] {
  const rows = items.map(classifySugarfreeItem).sort((a, b) => a.item.id.localeCompare(b.item.id));
  const buckets = new Map<string, SugarfreeReview[]>();
  for (const row of rows) {
    if (!row.item.brand?.trim()) continue;
    const target = row.proposed || row.item;
    const key = JSON.stringify([row.item.groupId, identityKey(target.name, row.item.brand, target.variant)]);
    const bucket = buckets.get(key) || [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2 || !bucket.some(row => row.proposed)) continue;
    // Prefer a pre-existing canonical destination; otherwise the lowest UUID wins deterministically.
    const destination = bucket.find(row => !row.proposed) || bucket[0];
    for (const row of bucket) if (row.proposed && row !== destination) row.moveToItemId = destination.item.id;
  }
  return rows;
}
