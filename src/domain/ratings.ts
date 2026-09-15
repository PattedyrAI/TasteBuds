const normalized = (value?: string | null) => value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') || null;
/** Unknown values stay explicit; they never match a known brand as a wildcard. */
export function identityKey(name: string, brand?: string | null, variant?: string | null): string {
  return JSON.stringify([normalized(name), normalized(brand), normalized(variant)]);
}
type Event = { userId: string; score: number; tastedAt: string; createdAt: string; deletedAt?: string | null };
export function latestAverage(events: Event[]) {
  const visible = events.filter(event => !event.deletedAt);
  const latest = new Map<string, Event>();
  for (const event of visible) {
    const current = latest.get(event.userId);
    if (!current || Date.parse(event.tastedAt) > Date.parse(current.tastedAt) || (Date.parse(event.tastedAt) === Date.parse(current.tastedAt) && Date.parse(event.createdAt) > Date.parse(current.createdAt))) latest.set(event.userId, event);
  }
  return { average: latest.size ? [...latest.values()].reduce((sum, event) => sum + event.score, 0) / latest.size : null, raterCount: latest.size, tastingCount: visible.length };
}
