export interface ItemMatchQuery { name: string; brand?: string | null; variant?: string | null }
export interface MatchableItem { id: string; name: string; brand: string | null; variant: string | null }

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const label = (value?: string | null) => value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') || null;
const tokens = (value: string) => [...new Set(value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || [])];
const commonWords = new Set(['a', 'an', 'the', 'and', 'with', 'for', 'from', 'of', 'in']);

/** Search strings retain accents for SQL; ranking tolerates accent/punctuation changes. */
export function itemMatchSearchTerms(query: ItemMatchQuery): string[] {
  const name = label(query.name) || '';
  const words = [...new Set(name.match(/[\p{L}\p{N}]+/gu) || [])];
  const distinctive = words.filter(word => word.length > 1 && !commonWords.has(word));
  const chosen = (distinctive.length ? distinctive : words).sort((a, b) => b.length - a.length || compare(a, b)).slice(0, 4);
  const terms = [...(chosen.length ? chosen : [name]), label(query.brand), label(query.variant)];
  return [...new Set(terms.filter((term): term is string => Boolean(term)).map(term => term.slice(0, 200)))];
}

function nameSimilarity(name: string, candidate: string): number {
  const wanted = tokens(name), available = tokens(candidate);
  if (!wanted.length || !available.length) return label(name) === label(candidate) ? 1 : 0;
  const used = new Set<number>();
  let overlap = 0;
  for (const word of wanted.sort((a, b) => b.length - a.length || compare(a, b))) {
    let best = 0, index = -1;
    for (let n = 0; n < available.length; n++) {
      if (used.has(n)) continue;
      const other = available[n];
      const closePrefix = Math.min(word.length, other.length) >= 4 && !/^\d+$/.test(word) && !/^\d+$/.test(other)
        && Math.min(word.length, other.length) / Math.max(word.length, other.length) >= .75
        && (word.startsWith(other) || other.startsWith(word));
      const score = word === other ? 1 : closePrefix ? .8 : 0;
      if (score > best) { best = score; index = n; }
    }
    if (index >= 0) { used.add(index); overlap += best; }
  }
  return .7 * overlap / wanted.length + .3 * overlap / available.length;
}

function matchScore(item: MatchableItem, query: ItemMatchQuery): number | null {
  const similarity = nameSimilarity(query.name, item.name);
  if (similarity < .5) return null;
  let score = similarity * 100;
  for (const [field, weight] of [['brand', 20], ['variant', 10]] as const) {
    const wanted = label(query[field]), actual = label(item[field]);
    if (wanted && actual && wanted !== actual) return null;
    if (wanted && actual) score += weight;
    // Missing identity evidence is never a wildcard or an exact known-brand match.
    else if (wanted !== actual) score -= weight;
  }
  return score;
}

/** Suggestions only: callers must still obtain an explicit item selection. */
export function rankItemMatches<T extends MatchableItem>(items: T[], query: ItemMatchQuery): T[] {
  const unique = new Map<string, T>();
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
  return [...unique.values()].flatMap(item => {
    const score = matchScore(item, query);
    return score === null ? [] : [{item, score}];
  }).sort((a, b) => b.score - a.score || compare(label(a.item.name) || '', label(b.item.name) || '') || compare(a.item.id, b.item.id))
    .slice(0, 8).map(result => result.item);
}
