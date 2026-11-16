/**
 * Finds items that are the same product under different names and plans rating moves onto one item.
 * Read-only. `--analyze` makes paid model calls and writes a private review page; `--plan` turns the
 * approved clusters into guarded version-1 plans for scripts/apply-identity-corrections.ts.
 */
import {createHash, randomUUID} from 'node:crypto';
import {chmod, lstat, mkdir, open, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool, type PoolClient} from 'pg';
import sharp from 'sharp';
import {z} from 'zod';
import {MAX_BLOCK_SIZE, CONFIDENT, mergeTarget, sameProductBlock, sameProductBlocks, validateSameProductGroups, type SameProductItem} from '../src/domain/same-product';
import {judgeSameProducts, SAME_PRODUCT_PROMPT_VERSION, type SameProductJudge} from '../src/server/same-product';
import {captureIdentitySnapshots, identityPlanSha256, type IdentityCorrectionPlan} from './apply-identity-corrections';
import {assertSugarfreeReviewTarget as assertReviewTarget} from './plan-sugarfree-corrections';

export type CatalogItem = SameProductItem & {groupId: string; coverPhotoId: string | null};
const reviewItem = z.object({id: z.string().uuid(), name: z.string(), brand: z.string().nullable(), variant: z.string().nullable(), type: z.string().nullable(), tastingCount: z.number().int()});
const reviewCluster = z.object({
  key: z.string().regex(/^[0-9a-f]{12}$/), groupId: z.string().uuid(), approved: z.boolean(), confidence: z.number(), reason: z.string(),
  destinationId: z.string().uuid(), rename: z.string().nullable(), items: z.array(reviewItem).min(2),
});
export const reviewSchema = z.object({version: z.literal(1), runId: z.string().uuid(), model: z.string(), promptVersion: z.string(), skippedBlocks: z.number().int(), clusters: z.array(reviewCluster)});
export type SameProductReview = z.infer<typeof reviewSchema>;

async function onDedicatedClient<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  // Like the applicator, refuse to consume a caller-owned transaction.
  let idle = false;
  try { await client.query('SAVEPOINT same_product_idle_probe'); }
  catch (error) { if ((error as {code?: string}).code === '25P01') idle = true; else throw error; }
  if (!idle) { await client.query('RELEASE SAVEPOINT same_product_idle_probe'); throw new Error('A dedicated idle client is required'); }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { await client.query("SET LOCAL statement_timeout='60s'"); return await work(); }
  finally { await client.query('ROLLBACK'); }
}

const itemColumns = `i.id, i.group_id AS "groupId", i.name, b.name AS brand, i.variant, t.name AS type, i.legacy_photo_id AS "legacyPhotoId",
  (SELECT count(*)::int FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL) AS "tastingCount",
  (SELECT count(*)::int FROM everrate.ratings r WHERE r.item_id=i.id) AS "historyCount",
  (SELECT r.photo_id FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL AND r.photo_id IS NOT NULL ORDER BY r.tasted_at DESC,r.created_at DESC,r.id DESC LIMIT 1) AS "coverPhotoId"
  FROM everrate.items i
  LEFT JOIN everrate.brands b ON b.id=i.brand_id AND b.group_id=i.group_id
  LEFT JOIN everrate.item_types t ON t.id=i.type_id AND t.group_id=i.group_id`;

/** Items people can see (at least one live rating), per the app's own catalog rule. */
export async function readCatalog(client: PoolClient, groupId?: string): Promise<CatalogItem[]> {
  return onDedicatedClient(client, async () => (await client.query<CatalogItem>(
    `SELECT ${itemColumns} WHERE EXISTS (SELECT 1 FROM everrate.ratings r WHERE r.item_id=i.id AND r.deleted_at IS NULL)
     ${groupId ? 'AND i.group_id=$1' : ''} ORDER BY i.group_id,i.id`, groupId ? [groupId] : [])).rows);
}

const clusterKey = (ids: string[]) => createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 12);

/** One model call per block; blocks never span groups, brands, types or the Sugarfree tag. */
export async function analyzeCatalog(catalog: CatalogItem[], judge: SameProductJudge = judgeSameProducts, model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'): Promise<SameProductReview> {
  const groups = new Map<string, CatalogItem[]>();
  for (const item of catalog) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  const clusters: SameProductReview['clusters'] = [];
  let skippedBlocks = 0;
  for (const [groupId, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const byId = new Map(items.map(item => [item.id, item]));
    for (const block of sameProductBlocks(items)) {
      if (block.length > MAX_BLOCK_SIZE) { skippedBlocks++; continue; }
      for (const cluster of validateSameProductGroups(block, await judge(block))) {
        const {destination, rename} = mergeTarget(cluster, byId);
        clusters.push({
          key: clusterKey(cluster.itemIds), groupId, approved: cluster.confidence >= CONFIDENT, confidence: cluster.confidence, reason: cluster.reason,
          destinationId: destination.id, rename,
          items: cluster.itemIds.map(id => byId.get(id)!).map(({id, name, brand, variant, type, tastingCount}) => ({id, name, brand, variant, type, tastingCount})),
        });
      }
    }
  }
  return {version: 1, runId: randomUUID(), model, promptVersion: SAME_PRODUCT_PROMPT_VERSION, skippedBlocks, clusters};
}

/**
 * Approved clusters become guarded plans from a fresh snapshot. A cluster whose items changed identity
 * since review (renamed, re-branded, sugar tag flipped, no longer visible) is dropped and reported.
 */
/** Plan moves per batch stay well under the applicator's 2000-move / 1000-item limits; all history rows move. */
const MAX_PLAN_MOVES = 1800, MAX_PLAN_ITEMS = 900;

/**
 * A review file is an operator-editable input: re-check every invariant the analysis produced
 * instead of trusting it (destination inside its own cluster, no shared items, one block, an existing name).
 */
export function assertReviewIntegrity(review: SameProductReview): void {
  const seen = new Set<string>();
  for (const cluster of review.clusters.filter(row => row.approved)) {
    const ids = cluster.items.map(item => item.id);
    if (new Set(ids).size !== ids.length || ids.some(id => seen.has(id))) throw new Error('Review clusters overlap; regenerate the review');
    ids.forEach(id => seen.add(id));
    if (!ids.includes(cluster.destinationId)) throw new Error(`Cluster ${cluster.key} keeps ratings on an item outside the cluster`);
    const block = sameProductBlock(cluster.items[0]);
    if (!block || cluster.items.some(item => sameProductBlock(item) !== block)) throw new Error(`Cluster ${cluster.key} mixes brands, types or the Sugarfree tag`);
    if (cluster.rename !== null && !cluster.items.some(item => item.name === cluster.rename)) throw new Error(`Cluster ${cluster.key} renames to a name none of its items has`);
  }
}

export async function planApprovedClusters(client: PoolClient, review: SameProductReview, evidence: string) {
  if (evidence.trim().length < 20) throw new Error('Describe the operator review in --evidence');
  assertReviewIntegrity(review);
  const approved = review.clusters.filter(cluster => cluster.approved);
  const ids = [...new Set(approved.flatMap(cluster => cluster.items.map(item => item.id)))];
  return onDedicatedClient(client, async () => {
    const current = new Map((await client.query<CatalogItem & {legacyPhotoId: string | null; historyCount: number}>(`SELECT ${itemColumns} WHERE i.id=ANY($1::uuid[])`, [ids])).rows.map(row => [row.id, row]));
    const stale: string[] = [], oversized: string[] = [], plans: IdentityCorrectionPlan[] = [];
    const usable = approved.filter(cluster => {
      const rows = cluster.items.map(item => current.get(item.id));
      // The complete reviewed identity must be unchanged: a flavour variant edited after review is another product.
      const ok = rows.every((row, n) => {
        const was = cluster.items[n];
        return row && row.groupId === cluster.groupId && row.tastingCount > 0 && row.name === was.name && row.brand === was.brand && row.variant === was.variant && row.type === was.type;
      });
      if (!ok) { stale.push(cluster.key); return false; }
      const history = cluster.items.filter(item => item.id !== cluster.destinationId).reduce((sum, item) => sum + current.get(item.id)!.historyCount, 0);
      if (history > MAX_PLAN_MOVES || cluster.items.length > MAX_PLAN_ITEMS) { oversized.push(cluster.key); return false; }
      return true;
    });
    for (const groupId of [...new Set(usable.map(cluster => cluster.groupId))].sort()) {
      let batch: typeof usable = [], moveCount = 0;
      const flush = async () => {
        if (!batch.length) return;
        const destinations = new Map<string, string>();
        for (const cluster of batch) for (const item of cluster.items) if (item.id !== cluster.destinationId) destinations.set(item.id, cluster.destinationId);
        // All history rows move, including deleted ones, so nothing stays behind on the source item.
        const ratings = await client.query<{id: string}>('SELECT id FROM everrate.ratings WHERE item_id=ANY($1::uuid[]) ORDER BY id', [[...destinations.keys()]]);
        const itemIds = batch.flatMap(cluster => cluster.items.map(item => item.id));
        const covers = itemIds.map(id => current.get(id)!.legacyPhotoId).filter((id): id is string => !!id);
        const baseline = await captureIdentitySnapshots(client, {itemIds, ratingIds: ratings.rows.map(row => row.id), photoIds: covers});
        if (baseline.photos.some(photo => photo.groupId !== groupId || photo.storedSha256 !== photo.sha256)) throw new Error('Photo evidence differs from stored digest or group; review required');
        const plan: IdentityCorrectionPlan = {
          version: 1, planId: randomUUID(), groupId,
          evidence: `${evidence.trim()}\nSame-product clusters from model ${review.model} (${review.promptVersion}), run ${review.runId}, approved in review: ${batch.map(cluster => cluster.key).join(', ')}. Ratings move to the most-rated item; source items stay unchanged and drop out of the catalog once empty.`.slice(0, 12000),
          items: baseline.items.map(item => ({id: item.id, expectedSha256: item.sha256})),
          photos: baseline.photos.map(photo => ({id: photo.id, expectedSha256: photo.sha256})),
          updates: batch.filter(cluster => cluster.rename).map(cluster => ({itemId: cluster.destinationId, set: {name: cluster.rename!.trim()}})),
          forks: [],
          moves: baseline.ratings.map(rating => ({
            ratingId: rating.id, fromItemId: rating.snapshot.item_id as string, toItemId: destinations.get(rating.snapshot.item_id as string)!,
            expectedSha256: rating.sha256, photoId: rating.photoId, photoSha256: rating.photoSha256,
          })),
        };
        identityPlanSha256(plan); // Validates the exact v1 contract and its size limits.
        plans.push(plan);
        batch = []; moveCount = 0;
      };
      for (const cluster of usable.filter(cluster => cluster.groupId === groupId)) {
        // Every history row moves, deleted ones included, so size batches by complete history.
        const moves = cluster.items.filter(item => item.id !== cluster.destinationId).reduce((sum, item) => sum + current.get(item.id)!.historyCount, 0);
        if (batch.length && (moveCount + moves > MAX_PLAN_MOVES || batch.reduce((n, c) => n + c.items.length, 0) + cluster.items.length > MAX_PLAN_ITEMS || batch.length >= 150)) await flush();
        batch.push(cluster); moveCount += moves;
      }
      await flush();
    }
    return {plans, stale, oversized};
  });
}

async function privateDirectory(...parts: string[]): Promise<string> {
  const root = resolve('.private');
  let directory = root;
  for (const part of ['', ...parts]) {
    directory = resolve(directory, part);
    await mkdir(directory, {recursive: true, mode: 0o700});
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new Error('Private output directory must be an owned, non-symlink directory');
    await chmod(directory, 0o700);
  }
  return directory;
}
async function writePrivate(file: string, content: string | Buffer): Promise<string> {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(content); } finally { await handle.close(); }
  return file;
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
/** Self-contained page: every value is escaped user text; thumbnails are embedded so nothing is fetched. */
export function reviewPage(review: SameProductReview, thumbnails: ReadonlyMap<string, string>, covers: ReadonlyMap<string, string | null>): string {
  const card = (cluster: SameProductReview['clusters'][number], n: number) => `<article class="${cluster.approved ? 'on' : 'off'}">
<header><span class="n">${n + 1}</span><code>${cluster.key}</code><span class="conf">${Math.round(cluster.confidence * 100)}%</span><span class="state">${cluster.approved ? 'Will merge' : 'Left apart (low confidence)'}</span></header>
<p class="reason">${escape(cluster.reason)}</p>
<div class="items">${cluster.items.map(item => {
    const thumb = thumbnails.get(covers.get(item.id) ?? '');
    return `<figure class="${item.id === cluster.destinationId ? 'dest' : ''}">${thumb ? `<img alt="" src="${thumb}">` : '<div class="ph"></div>'}<figcaption><b>${escape(item.brand)} ${escape(item.name)}</b>${item.variant ? `<small>${escape(item.variant)}</small>` : ''}<small>${item.tastingCount} rating${item.tastingCount === 1 ? '' : 's'}${item.id === cluster.destinationId ? ' · keeps ratings' : ''}</small></figcaption></figure>`;
  }).join('')}</div>
${cluster.rename ? `<p class="rename">Merged item will be named <b>${escape(cluster.rename)}</b></p>` : ''}</article>`;
  const on = review.clusters.filter(c => c.approved).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Same-product review</title><style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#16203a;--muted:#667089;--line:#dfe4ee;--ok:#1f7a4d;--off:#9a6b00}
@media (prefers-color-scheme:dark){:root{--bg:#10131c;--card:#191e2b;--ink:#e8ecf5;--muted:#9aa4ba;--line:#2a3142;--ok:#5fd39a;--off:#e8b64c}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 6px}.sum{color:var(--muted);margin:0 0 20px}article{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
article.off{opacity:.75}header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px}.n{font-weight:700}code{color:var(--muted)}.conf{font-weight:600}
.on .state{color:var(--ok)}.off .state{color:var(--off)}.reason{color:var(--muted);margin:6px 0 10px;font-size:13px}.items{display:flex;gap:10px;flex-wrap:wrap}
figure{margin:0;width:150px;border:2px solid transparent;border-radius:10px;padding:4px}figure.dest{border-color:var(--ok)}img,.ph{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;background:var(--line)}
figcaption{display:grid;gap:2px;font-size:12px;margin-top:4px}small{color:var(--muted)}.rename{font-size:13px;margin:10px 0 0}</style></head><body><main>
<h1>Same-product merges to review</h1><p class="sum">${review.clusters.length} groups found · ${on} will merge · ${review.clusters.length - on} left apart${review.skippedBlocks ? ` · ${review.skippedBlocks} oversized blocks skipped` : ''}. Sugar-free and regular items are never grouped. The green frame keeps the ratings. Reply with the numbers to reject or to add.</p>
${review.clusters.map(card).join('\n')}</main></body></html>`;
}

async function thumbnails(client: PoolClient, photoIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!photoIds.length) return out;
  const rows = await onDedicatedClient(client, async () => (await client.query<{id: string; data: Buffer}>('SELECT id,data FROM everrate.photos WHERE id=ANY($1::uuid[])', [photoIds])).rows);
  for (const row of rows) {
    try { out.set(row.id, 'data:image/jpeg;base64,' + (await sharp(row.data).rotate().resize({width: 300, height: 400, fit: 'cover'}).jpeg({quality: 70}).toBuffer()).toString('base64')); } catch { /* unreadable photo: placeholder */ }
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const known = ['--allow-remote-readonly', '--analyze'];
  if (args.some(arg => !known.includes(arg) && !/^--(group|plan|evidence)=/.test(arg))) throw new Error('Unknown planner option');
  const connectionString = process.env.SAME_PRODUCT_DATABASE_URL;
  if (!connectionString) throw new Error('SAME_PRODUCT_DATABASE_URL is required');
  assertReviewTarget(connectionString, args.includes('--allow-remote-readonly'));
  const pool = new Pool({connectionString, max: 1, connectionTimeoutMillis: 10000});
  try {
    const client = await pool.connect();
    try {
      const reviewFile = option('plan');
      if (reviewFile) {
        const review = reviewSchema.parse(JSON.parse(await readFile(resolve(reviewFile), 'utf8')));
        const {plans, stale, oversized} = await planApprovedClusters(client, review, option('evidence') ?? '');
        const directory = await privateDirectory('same-product', review.runId);
        for (const plan of plans) {
          const file = await writePrivate(resolve(directory, `plan-${plan.groupId}-${plan.planId}.json`), JSON.stringify(plan, null, 2) + '\n');
          console.log(`Plan ${file}: ${plan.moves.length} rating moves, ${plan.updates.length} renames`);
        }
        if (oversized.length) console.log(`Skipped ${oversized.length} clusters too large for one plan (handle separately): ${oversized.join(', ')}`);
        if (stale.length) console.log(`Dropped ${stale.length} clusters whose items changed since review: ${stale.join(', ')}`);
        if (!plans.length) console.log('No approved clusters; no plan written.');
        return;
      }
      const catalog = await readCatalog(client, option('group'));
      const groups = new Map<string, CatalogItem[]>();
      for (const item of catalog) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
      const blocks = [...groups.values()].flatMap(items => sameProductBlocks(items));
      console.log(`${catalog.length} visible items; ${blocks.length} blocks to compare (${blocks.filter(b => b.length > MAX_BLOCK_SIZE).length} too large); largest ${Math.max(0, ...blocks.map(b => b.length))}.`);
      if (!args.includes('--analyze')) { console.log('Inventory only. Add --analyze to make the paid model calls.'); return; }
      const review = await analyzeCatalog(catalog);
      const covers = new Map(catalog.map(item => [item.id, item.coverPhotoId]));
      const thumbs = await thumbnails(client, review.clusters.flatMap(c => c.items.map(item => covers.get(item.id))).filter((id): id is string => !!id));
      const directory = await privateDirectory('same-product', review.runId);
      await writePrivate(resolve(directory, 'review.json'), JSON.stringify(review, null, 2) + '\n');
      const page = await writePrivate(resolve(directory, 'review.html'), reviewPage(review, thumbs, covers));
      console.log(`${review.clusters.length} clusters (${review.clusters.filter(c => c.approved).length} confident). Review page: ${page}`);
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    const code = error instanceof Error && /^(provider_\d{3}|not_configured|invalid_model|block_too_large|Unknown planner option|SAME_PRODUCT_DATABASE_URL is required|Non-loopback review requires --allow-remote-readonly|Describe the operator review in --evidence|Review clusters overlap; regenerate the review)$/.test(error.message) ? error.message : 'stopped';
    console.error(`Same-product planning stopped (${code}); no private record text or credentials were printed.`);
    process.exitCode = 1;
  });
}
