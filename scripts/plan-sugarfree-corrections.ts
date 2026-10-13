/** Read-only candidate planner. Generated plans require human/photo review before apply. */
import {randomUUID} from 'node:crypto';
import {chmod, lstat, mkdir, open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool, type PoolClient} from 'pg';
import {reviewSugarfreeItems, type SugarfreeReviewItem, type SugarfreeReview} from '../src/domain/sugarfree-corrections';
import {captureIdentitySnapshots, identityPlanSha256, type IdentityCorrectionPlan} from './apply-identity-corrections';

type DatabaseItem = SugarfreeReviewItem & {coverPhotoId: string | null};
export type SugarfreeGroupPlan = {groupId: string; rows: SugarfreeReview[]; plan: IdentityCorrectionPlan | null};

/** URL options cannot override the checked hostname (e.g. ?host=remote). */
export function assertSugarfreeReviewTarget(connectionString: string, allowRemoteReadonly = false): void {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.search || url.hash) {
    throw new Error('Use an explicit PostgreSQL URL without query options');
  }
  if (!allowRemoteReadonly && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Non-loopback review requires --allow-remote-readonly');
  }
}

/** Owns a transaction on a dedicated idle client. No SQL writes or applicator calls. */
export async function planSugarfreeCorrections(client: PoolClient): Promise<SugarfreeGroupPlan[]> {
  // Like the applicator, refuse to accidentally consume a caller-owned transaction.
  let idle = false;
  try { await client.query('SAVEPOINT sugarfree_planner_idle_probe'); }
  catch (error) { if ((error as {code?: string}).code === '25P01') idle = true; else throw error; }
  if (!idle) {
    await client.query('RELEASE SAVEPOINT sugarfree_planner_idle_probe');
    throw new Error('A dedicated idle client is required');
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='60s'");
    const result = await client.query<DatabaseItem>(`
      SELECT i.id, i.group_id AS "groupId", i.name, b.name AS brand, i.variant,
             i.legacy_photo_id AS "coverPhotoId"
      FROM everrate.items i
      JOIN everrate.item_types t ON t.id=i.type_id AND t.group_id=i.group_id
      LEFT JOIN everrate.brands b ON b.id=i.brand_id AND b.group_id=i.group_id
      WHERE t.name='Energy drinks' ORDER BY i.group_id,i.id`);
    const groups = new Map<string, DatabaseItem[]>();
    for (const item of result.rows) {
      const items = groups.get(item.groupId) || [];
      items.push(item);
      groups.set(item.groupId, items);
    }
    const output: SugarfreeGroupPlan[] = [];
    for (const [groupId, items] of groups) {
      const rows = reviewSugarfreeItems(items);
      const updates = rows.filter(row => row.proposed && !row.moveToItemId)
        .map(row => ({itemId: row.item.id, set: row.proposed!}));
      const duplicates = rows.filter(row => row.moveToItemId);
      const ratings = await client.query<{id: string; item_id: string}>(
        'SELECT id,item_id FROM everrate.ratings WHERE item_id=ANY($1::uuid[]) ORDER BY id',
        [duplicates.map(row => row.item.id)],
      );
      if (!updates.length && !ratings.rows.length) {
        output.push({groupId, rows, plan: null});
        continue;
      }
      const destinations = new Map(duplicates.map(row => [row.item.id, row.moveToItemId!]));
      const touched = new Set(updates.map(update => update.itemId));
      for (const rating of ratings.rows) {
        touched.add(rating.item_id);
        touched.add(destinations.get(rating.item_id)!);
      }
      const coverIds = items.filter(item => touched.has(item.id) && item.coverPhotoId).map(item => item.coverPhotoId!);
      const baseline = await captureIdentitySnapshots(client, {
        itemIds: [...touched], ratingIds: ratings.rows.map(rating => rating.id), photoIds: coverIds,
      });
      if (baseline.photos.some(photo => photo.groupId !== groupId || photo.storedSha256 !== photo.sha256)) {
        throw new Error('Photo evidence differs from stored digest or group; review required');
      }
      const plan: IdentityCorrectionPlan = {
        version: 1, planId: randomUUID(), groupId,
        evidence: 'UNREVIEWED sugarfree candidates from stored names/variants and the documented manufacturer allowlist. Human/photo review is required before apply; stored regular is not nutritional verification. Duplicate sources remain unchanged; only ratings move.',
        items: baseline.items.map(item => ({id: item.id, expectedSha256: item.sha256})),
        photos: baseline.photos.map(photo => ({id: photo.id, expectedSha256: photo.sha256})),
        updates, forks: [],
        moves: baseline.ratings.map(rating => ({
          ratingId: rating.id, fromItemId: rating.snapshot.item_id,
          toItemId: destinations.get(rating.snapshot.item_id)!, expectedSha256: rating.sha256,
          photoId: rating.photoId, photoSha256: rating.photoSha256,
        })),
      };
      identityPlanSha256(plan); // Validate the exact v1 contract and all size/count limits.
      output.push({groupId, rows, plan});
    }
    await client.query('ROLLBACK');
    return output;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function writePrivatePlan(plan: IdentityCorrectionPlan): Promise<string> {
  const directory = resolve('.private');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) {
    throw new Error('Private output directory must be an owned, non-symlink directory');
  }
  await chmod(directory, 0o700);
  const content = JSON.stringify(plan, null, 2) + '\n';
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Plan exceeds applicator file limit');
  const file = resolve(directory, `sugarfree-plan-${plan.groupId}-${plan.planId}.json`);
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(content); } finally { await handle.close(); }
  return file;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--allow-remote-readonly')) throw new Error('Unknown planner option');
  const connectionString = process.env.SUGARFREE_REVIEW_DATABASE_URL;
  if (!connectionString) throw new Error('SUGARFREE_REVIEW_DATABASE_URL is required');
  assertSugarfreeReviewTarget(connectionString, args.includes('--allow-remote-readonly'));
  const pool = new Pool({connectionString, max: 1, connectionTimeoutMillis: 10000});
  try {
    const client = await pool.connect();
    let groups: SugarfreeGroupPlan[];
    try { groups = await planSugarfreeCorrections(client); } finally { client.release(); }
    if (!groups.length) console.log('No Energy drinks items; no plan written.');
    for (const group of groups) {
      const file = group.plan ? await writePrivatePlan(group.plan) : null;
      console.log(`Group ${group.groupId}: ${group.rows.length} items; ${group.plan?.updates.length || 0} updates; ${group.plan?.moves.length || 0} rating moves`);
      const counts = new Map<string, number>();
      for (const row of group.rows) counts.set(row.classification, (counts.get(row.classification) || 0) + 1);
      console.table([...counts].map(([classification, count]) => ({classification, count})));
      // Log only item identity fields and machine-generated reasons, never rating notes or snapshots.
      console.table(group.rows.map(row => ({
        item: row.item.id, brand: row.item.brand, before: JSON.stringify([row.item.name, row.item.variant]),
        after: JSON.stringify([row.proposed?.name ?? row.item.name, row.proposed?.variant ?? row.item.variant]),
        classification: row.classification,
        action: row.moveToItemId ? `MOVE ratings -> ${row.moveToItemId}; retain source` : row.proposed ? 'REVIEW update' : 'unchanged',
        reason: row.reason,
      })));
      console.log(file ? `UNREVIEWED candidate plan: ${file}` : 'No actionable corrections; no plan written.');
    }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('Sugarfree planning stopped; no private record text or credentials were printed.');
    process.exitCode = 1;
  });
}
