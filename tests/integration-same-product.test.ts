import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {createHash, randomUUID} from 'node:crypto';
import {Pool, type PoolClient} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';
import {findSameProduct} from '../src/server/same-product';
import {analyzeCatalog, planApprovedClusters, readCatalog} from '../scripts/plan-same-product-merges';
import {applyIdentityCorrections} from '../scripts/apply-identity-corrections';
import type {RawSameProductGroup, SameProductItem} from '../src/domain/same-product';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || target.search) throw new Error('A local disposable TEST_DATABASE_URL is required');
}
/** Fake model: everything mentioning pistachio is one product; it keeps the shortest name. */
const pistachioJudge = async (block: readonly SameProductItem[]): Promise<RawSameProductGroup[]> => {
  const hits = block.flatMap((row, index) => /pistachio/i.test(row.name) ? [index] : []);
  if (hits.length < 2) return [];
  const keep = [...hits].sort((a, b) => block[a].name.length - block[b].name.length)[0];
  return [{items: hits, keep, confidence: .95, reason: 'Edition label only'}];
};

describe.skipIf(!url)('same-product matching and merge planning', () => {
  let admin: Pool, database: string, groupId: string, client: PoolClient;
  const owner = randomUUID(), friend = randomUUID();
  const ids: Record<string, string> = {};
  async function rate(user: string, name: string, variant: string | null, score: number, brand = 'Red Bull', itemId?: string) {
    const bytes = Buffer.from(`photo ${name} ${variant} ${randomUUID()}`);
    const photoId = (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id", [groupId, user, bytes, createHash('sha256').update(bytes).digest('hex')])).rows[0].id;
    return service.createRating(user, itemId ? {groupId, itemId, score, photoId} : {groupId, brand, name, variant, type: 'Energy drinks', broadCategory: 'Drink', score, photoId});
  }

  beforeAll(async () => {
    admin = new Pool({connectionString: url});
    database = 'everrate_same_product_' + randomUUID().replaceAll('-', '') + '_test';
    await admin.query(`CREATE DATABASE "${database}"`);
    const target = new URL(url!); target.pathname = '/' + database;
    await migrate(target.toString());
    process.env.DATABASE_URL = target.toString();
    await service.ensureUser({id: owner, displayName: 'Owner'});
    await service.ensureUser({id: friend, displayName: 'Friend'});
    await service.updatePreferences(owner, {aiEnabled: true});
    groupId = (await service.createGroup(owner, {name: 'Same product fixture'})).id;
    await getPool().query("INSERT INTO everrate.memberships(group_id,user_id,role) VALUES($1,$2,'member')", [groupId, friend]);
    ids.long = (await rate(owner, 'Winter Edition Pistachio and Berries', null, 7)).itemId; // the owner creates the category
    ids.short = (await rate(friend, 'Pistachio & Berries', null, 2)).itemId;
    await rate(owner, '', null, 8, 'Red Bull', ids.long);
    ids.sugarfree = (await rate(owner, 'Winter Edition Pistachio and Berries', 'Sugarfree', 6)).itemId;
    ids.other = (await rate(owner, 'Fig Apple', null, 5)).itemId;
    ids.monster = (await rate(owner, 'Pistachio Cream', null, 5, 'Monster')).itemId;
    process.env.GEMINI_API_KEY = 'local-mock-only';
    client = await getPool().connect();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    client?.release();
    if (database) { await getPool().end(); await admin.query(`DROP DATABASE "${database}"`); }
    await admin?.end();
  });

  type Payload = {entries: {name: string}[]; sugarfree: boolean; brand: string};
  function stubModel(answer: RawSameProductGroup[] | ((payload: Payload) => RawSameProductGroup[])) {
    const bodies: Payload[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: {body: string}) => {
      const payload: Payload = JSON.parse(JSON.parse(init.body).contents[0].parts[1].text);
      bodies.push(payload);
      const groups = typeof answer === 'function' ? answer(payload) : answer;
      return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({groups})}]}}]}), {status: 200});
    }));
    return bodies;
  }

  it('suggests the existing item for a differently worded new rating, comparing only same-brand regular drinks', async () => {
    const pistachio = (payload: Payload) => [{items: payload.entries.flatMap((entry, index) => /pistachio/i.test(entry.name) ? [index] : []), keep: 0, confidence: .92, reason: 'Edition label only'}];
    const bodies = stubModel(pistachio);
    const result = await findSameProduct(owner, groupId, {name: 'Red Bull The Winter Edition Pistachio Berries', brand: 'Red Bull', variant: null, type: 'Energy drinks'});
    expect(result.match?.id).toBe(ids.long); // the most-rated of the matching items
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({brand: 'Red Bull', sugarfree: false});
    const sent = bodies[0].entries.map(entry => entry.name);
    expect(sent[0]).toBe('The Winter Edition Pistachio Berries'); // brand prefix normalised away like a real save
    expect(sent.slice(1).sort()).toEqual(['Fig Apple', 'Pistachio & Berries', 'Winter Edition Pistachio and Berries']);
  });

  it('keeps sugar-free and regular apart: a sugar-free rating only sees sugar-free items', async () => {
    const bodies = stubModel([{items: [0, 1], keep: 1, confidence: .9, reason: 'same'}]);
    const result = await findSameProduct(owner, groupId, {name: 'Pistachio Berries', brand: 'Red Bull', variant: 'Sugarfree', type: 'Energy drinks'});
    expect(result.match?.id).toBe(ids.sugarfree);
    expect(bodies[0]).toMatchObject({sugarfree: true});
    expect(bodies[0].entries).toHaveLength(2);
  });

  it('returns an exact identity without a model call, and stays quiet when unsure or the model fails', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await findSameProduct(owner, groupId, {name: 'fig apple', brand: 'Red Bull', variant: null, type: 'Energy drinks'})).match?.id).toBe(ids.other);
    expect(fetchSpy).not.toHaveBeenCalled();
    stubModel(payload => [{items: [0, payload.entries.findIndex(entry => /pistachio/i.test(entry.name))], keep: 0, confidence: .5, reason: 'maybe'}]);
    expect((await findSameProduct(owner, groupId, {name: 'Berry Pistachio', brand: 'Red Bull', variant: null, type: 'Energy drinks'})).match).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 500})));
    expect((await findSameProduct(owner, groupId, {name: 'Berry Pistachio', brand: 'Red Bull', variant: null, type: 'Energy drinks'})).match).toBeNull();
    expect((await findSameProduct(owner, groupId, {name: 'Something', brand: 'Unknown brand', variant: null, type: 'Energy drinks'})).match).toBeNull();
  });

  it('respects the AI preference and group membership', async () => {
    await expect(findSameProduct(friend, groupId, {name: 'Pistachio', brand: 'Red Bull', type: 'Energy drinks'})).rejects.toMatchObject({status: 403});
    const outsider = randomUUID();
    await service.ensureUser({id: outsider, displayName: 'Outsider'});
    await service.updatePreferences(outsider, {aiEnabled: true});
    await expect(findSameProduct(outsider, groupId, {name: 'Pistachio Berries Winter', brand: 'Red Bull', type: 'Energy drinks'})).rejects.toMatchObject({status: 404});
  });

  it('plans the backfill per block, applies through the guarded applicator and leaves sugar-free alone', async () => {
    const judged: string[][] = [];
    const review = await analyzeCatalog(await readCatalog(client), async block => { judged.push(block.map(row => row.id)); return pistachioJudge(block); }, 'fake-model');
    // Monster and the sugar-free item have no same-block partner, so they never reach the model.
    expect(judged).toEqual([[ids.other, ids.long, ids.short].sort()]);
    expect(review.clusters).toHaveLength(1);
    expect(review.clusters[0]).toMatchObject({approved: true, destinationId: ids.long, rename: 'Pistachio & Berries'});
    expect(review.clusters[0].items.map(row => row.id).sort()).toEqual([ids.long, ids.short].sort());

    await expect(planApprovedClusters(client, review, 'short')).rejects.toThrow(/evidence/);
    const {plans, stale} = await planApprovedClusters(client, review, 'Patrick reviewed the cluster list and photos on the review page.');
    expect(stale).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0].moves.map(move => [move.fromItemId, move.toItemId])).toEqual([[ids.short, ids.long]]);
    expect(plans[0].updates).toEqual([{itemId: ids.long, set: {name: 'Pistachio & Berries'}}]);

    expect((await applyIdentityCorrections(client, plans[0], {apply: false})).applied).toBe(false);
    await applyIdentityCorrections(client, plans[0], {apply: true});
    const items = await service.listItems(owner, groupId);
    const merged = items.find(row => row.id === ids.long)!;
    expect(merged).toMatchObject({name: 'Pistachio & Berries', tastingCount: 3, raterCount: 2});
    expect(items.some(row => row.id === ids.short)).toBe(false); // empty source drops out of the catalog
    expect(items.find(row => row.id === ids.sugarfree)).toMatchObject({name: 'Winter Edition Pistachio and Berries', variant: 'Sugarfree', tastingCount: 1});
    expect((await applyIdentityCorrections(client, plans[0], {apply: true})).alreadyApplied).toBe(true);
  });

  it('treats a flavour variant edited after review as stale', async () => {
    const a = (await rate(owner, 'Lime Pistachio', null, 4, 'Monster')).itemId;
    const review = await analyzeCatalog(await readCatalog(client, groupId), pistachioJudge, 'fake-model');
    const cluster = review.clusters.find(row => row.items.some(item => item.id === a))!;
    await getPool().query("UPDATE everrate.items SET variant='Mango' WHERE id=$1", [a]);
    const {plans, stale} = await planApprovedClusters(client, {...review, clusters: [cluster]}, 'Reviewed on the page; variant changed meanwhile.');
    expect(plans).toEqual([]);
    expect(stale).toEqual([cluster.key]);
    await getPool().query('UPDATE everrate.items SET variant=NULL WHERE id=$1', [a]);
  });

  it('sizes plans by complete history and skips a cluster too large for one plan', async () => {
    const big = (await rate(owner, 'Salted Pistachio', null, 4, 'Burn')).itemId;
    const other = (await rate(owner, 'Salted Pistachio Edition', null, 5, 'Burn')).itemId;
    await rate(owner, '', null, 6, 'Burn', other); // destination has more live ratings
    await getPool().query(`INSERT INTO everrate.ratings(group_id,item_id,user_id,score,tasted_at,photo_id,source,deleted_at)
      SELECT $1,$2,$3,5,now(),(SELECT photo_id FROM everrate.ratings WHERE item_id=$2 LIMIT 1),'import',now() FROM generate_series(1,1801)`, [groupId, big, owner]);
    const review = await analyzeCatalog((await readCatalog(client, groupId)).filter(row => row.brand === 'Burn'), pistachioJudge, 'fake-model');
    expect(review.clusters).toHaveLength(1);
    expect(review.clusters[0].destinationId).toBe(other);
    const {plans, oversized} = await planApprovedClusters(client, review, 'Reviewed; this one carries a large deleted history.');
    expect(plans).toEqual([]);
    expect(oversized).toEqual([review.clusters[0].key]);
  });

  it('splits batches by photo guards, not only by moves and items', async () => {
    const review = await analyzeCatalog((await readCatalog(client, groupId)).filter(row => row.brand !== 'Burn'), pistachioJudge, 'fake-model');
    const extra = (await rate(owner, 'Pistachio Twist', null, 6, 'Rockstar')).itemId, extra2 = (await rate(owner, 'Pistachio Twist Edition', null, 6, 'Rockstar')).itemId;
    const second = await analyzeCatalog((await readCatalog(client, groupId)).filter(row => row.brand === 'Rockstar'), pistachioJudge, 'fake-model');
    const clusters = [...review.clusters.filter(c => c.items.every(i => i.brand === 'Monster')), ...second.clusters];
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(second.clusters[0].items.map(i => i.id).sort()).toEqual([extra, extra2].sort());
    const loose = await planApprovedClusters(client, {...review, clusters}, 'Reviewed on the page; testing batch sizing.');
    expect(loose.plans).toHaveLength(1);
    const tight = await planApprovedClusters(client, {...review, clusters}, 'Reviewed on the page; testing batch sizing.', {moves: 1800, items: 900, photos: 1});
    expect(tight.plans.length).toBe(clusters.length); // one moved photo per cluster: each cluster needs its own plan
    for (const plan of tight.plans) expect(plan.photos.length).toBeLessThanOrEqual(1);
  });

  it('drops an approved cluster whose items changed after review', async () => {
    const a = (await rate(owner, 'Peach Pistachio', null, 4, 'Monster')).itemId;
    const review = await analyzeCatalog(await readCatalog(client, groupId), pistachioJudge, 'fake-model');
    const cluster = review.clusters.find(row => row.items.some(item => item.id === a))!;
    expect(cluster).toBeDefined();
    await service.updateItem(owner, a, {name: 'Peach', brand: 'Monster', variant: null, type: 'Energy drinks', broadCategory: 'Drink'});
    const {plans, stale} = await planApprovedClusters(client, {...review, clusters: [cluster]}, 'Reviewed on the page; this one changed meanwhile.');
    expect(plans).toEqual([]);
    expect(stale).toEqual([cluster.key]);
  });
});
