import {canonicalBrand} from './brand-identity';
import {canonicalItemType} from './item-types';
import {isSugarfree} from './energy-drinks';

export type SameProductItem = {id: string; name: string; brand: string | null; variant: string | null; type: string | null; tastingCount: number};
/** What the model returns: positions in the block it was shown. Untrusted until validated. */
export type RawSameProductGroup = {items: number[]; keep: number; confidence: number; reason: string};
export type SameProductCluster = {itemIds: string[]; keepNameOf: string; confidence: number; reason: string};

/** Largest block sent in one request; bigger blocks are reported, not silently split (a split would hide cross-chunk duplicates). */
export const MAX_BLOCK_SIZE = 150;
/** Below this the rating form stays quiet and the review list leaves the merge unticked. */
export const CONFIDENT = 0.8;

const compact = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Items are only ever compared inside one block: same brand, same type and the same Sugarfree tag.
 * The sugar rule is enforced here, in code, so a sugar-free and a regular item never reach the same request.
 * Unknown brands never merge (null).
 */
export function sameProductBlock(item: Pick<SameProductItem, 'brand' | 'variant' | 'type'>): string | null {
  const brand = canonicalBrand(item.brand);
  if (!brand || !compact(brand)) return null;
  const type = item.type?.trim() ? compact(canonicalItemType(item.type)) : '';
  return JSON.stringify([compact(brand), type, isSugarfree(item.variant)]);
}

/** Blocks with at least two items, in a stable order. */
export function sameProductBlocks<T extends SameProductItem>(items: readonly T[]): T[][] {
  const blocks = new Map<string, T[]>();
  for (const item of items) {
    const key = sameProductBlock(item);
    if (!key) continue;
    const block = blocks.get(key) ?? [];
    block.push(item);
    blocks.set(key, block);
  }
  return [...blocks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, block]) => block.sort((a, b) => a.id.localeCompare(b.id))).filter(block => block.length > 1);
}

/** Only the fields the model needs; brand, type and sugar status are shared by the whole block. */
export function sameProductPayload(block: readonly SameProductItem[]) {
  const first = block[0];
  return {
    brand: canonicalBrand(first.brand), type: first.type ? canonicalItemType(first.type) : null, sugarfree: isSugarfree(first.variant),
    entries: block.map((item, index) => ({index, name: item.name, ...(item.variant && !isSugarfree(item.variant) ? {variant: item.variant} : {}), ratings: item.tastingCount})),
  };
}

/** Rejects anything outside the block, overlapping groups, singletons and a kept name from outside the group. */
export function validateSameProductGroups(block: readonly SameProductItem[], raw: readonly RawSameProductGroup[]): SameProductCluster[] {
  const used = new Set<number>(), clusters: SameProductCluster[] = [];
  const key = block.length ? sameProductBlock(block[0]) : null;
  for (const group of raw) {
    const indexes = [...new Set(group.items)];
    if (indexes.length < 2 || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= block.length || used.has(index))) continue;
    if (!indexes.includes(group.keep)) continue;
    if (!Number.isFinite(group.confidence) || group.confidence < 0 || group.confidence > 1) continue;
    const members = indexes.map(index => block[index]);
    // Defence in depth: the block already guarantees this, but a cluster must never mix brands, types or sugar tags.
    if (!key || members.some(item => sameProductBlock(item) !== key)) continue;
    indexes.forEach(index => used.add(index));
    clusters.push({itemIds: members.map(item => item.id), keepNameOf: block[group.keep].id, confidence: group.confidence, reason: String(group.reason || '').slice(0, 300)});
  }
  return clusters;
}

/** Ratings move to the most-rated item (ties: lowest id), which then takes the clearest name. */
export function mergeTarget(cluster: SameProductCluster, items: ReadonlyMap<string, SameProductItem>) {
  const members = cluster.itemIds.map(id => items.get(id)!);
  const destination = [...members].sort((a, b) => b.tastingCount - a.tastingCount || a.id.localeCompare(b.id))[0];
  const keepName = items.get(cluster.keepNameOf)!.name;
  return {destination, sources: members.filter(item => item.id !== destination.id), rename: keepName !== destination.name ? keepName : null};
}
