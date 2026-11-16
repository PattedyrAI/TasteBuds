import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHash, randomUUID} from 'node:crypto';
import {Pool, type PoolClient} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';
import {createGroupCategory} from '../scripts/create-group-category';
import {analyzeCatalog, blockId, exportBlocks, judgeFromJudgments, readCatalog} from '../scripts/plan-same-product-merges';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || target.search) throw new Error('A local disposable TEST_DATABASE_URL is required');
}
const restaurants = [
  {id: 'location', label: 'Location', type: 'location', required: true, filterable: false},
  {id: 'cuisine', label: 'Cuisine', type: 'text', required: false, filterable: true},
  {id: 'price', label: 'Price', type: 'price', required: false, filterable: true},
];

describe.skipIf(!url)('operator tools', () => {
  let admin: Pool, database: string, groupId: string, client: PoolClient;
  const owner = randomUUID();
  beforeAll(async () => {
    admin = new Pool({connectionString: url});
    database = 'everrate_operator_' + randomUUID().replaceAll('-', '') + '_test';
    await admin.query(`CREATE DATABASE "${database}"`);
    const target = new URL(url!); target.pathname = '/' + database;
    await migrate(target.toString());
    process.env.DATABASE_URL = target.toString();
    await service.ensureUser({id: owner, displayName: 'Owner'});
    groupId = (await service.createGroup(owner, {name: 'Operator fixture'})).id;
    client = await getPool().connect();
  });
  afterAll(async () => {
    client?.release();
    if (database) { await getPool().end(); await admin.query(`DROP DATABASE "${database}"`); }
    await admin?.end();
  });

  const spec = (patch: Record<string, unknown> = {}) => ({groupId, name: 'Restaurants', fields: restaurants, note: 'Requested by Patrick in TKT-20102', ...patch});
  const types = async () => (await client.query('SELECT name,fields FROM everrate.item_types WHERE group_id=$1 AND lower(name)=$2', [groupId, 'restaurants'])).rows;

  it('validates and rolls back by default, then creates with apply and an operator audit row', async () => {
    expect(await createGroupCategory(client, spec())).toMatchObject({status: 'validated', applied: false});
    expect(await types()).toEqual([]);
    const created = await createGroupCategory(client, spec(), {apply: true});
    expect(created).toMatchObject({status: 'created', applied: true});
    expect(await types()).toEqual([{name: 'Restaurants', fields: restaurants.map(field => expect.objectContaining(field))}]);
    const audit = (await client.query("SELECT actor_id,details FROM everrate.audit_events WHERE resource_id=$1 AND action='category.create'", [created.categoryId])).rows;
    expect(audit).toEqual([{actor_id: null, details: expect.objectContaining({operator: true, note: 'Requested by Patrick in TKT-20102'})}]);
    // The app sees it as a normal template.
    const group = await service.getGroup(owner, groupId);
    expect(group.categories?.find(c => c.name === 'Restaurants')?.fields).toEqual(restaurants.map(field => expect.objectContaining(field)));
  });

  it('is a no-op for the same template and never overwrites a different one', async () => {
    expect(await createGroupCategory(client, spec({name: 'restaurants'}), {apply: true})).toMatchObject({status: 'already-exists', applied: false});
    await expect(createGroupCategory(client, spec({fields: restaurants.slice(0, 2)}), {apply: true})).rejects.toThrow(/different template/);
    expect(await types()).toHaveLength(1);
  });

  it('defaults fields to none, like the app', async () => {
    const result = await createGroupCategory(client, {groupId, name: 'Plain notes', note: 'Parity check for TKT-20102'});
    expect(result).toMatchObject({status: 'validated'});
  });

  it('rejects templates the app itself would reject', async () => {
    await expect(createGroupCategory(client, spec({name: 'Bars', fields: [restaurants[0], {...restaurants[0], id: 'second', label: 'Second'}]}))).rejects.toThrow(/one location field/);
    await expect(createGroupCategory(client, spec({name: 'Bars', groupId: randomUUID()}))).rejects.toThrow(/Group not found/);
    await expect(createGroupCategory(client, spec({name: 'Bars', note: 'short'}))).rejects.toThrow();
  });

  it('round-trips external judgments through the same validation as a live model', async () => {
    const rate = async (name: string, brand: string) => {
      const bytes = Buffer.from(`${name} ${randomUUID()}`);
      const photoId = (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id", [groupId, owner, bytes, createHash('sha256').update(bytes).digest('hex')])).rows[0].id;
      return (await service.createRating(owner, {groupId, brand, name, type: 'Energy drinks', broadCategory: 'Drink', score: 7, photoId})).itemId;
    };
    const a = await rate('Pistachio & Berries', 'Red Bull'), b = await rate('Winter Edition Pistachio and Berries', 'Red Bull');
    await rate('Mango Loco', 'Monster');
    const catalog = await readCatalog(client, groupId);
    const exported = exportBlocks(catalog);
    expect(exported.blocks).toHaveLength(1); // Monster has no partner
    expect(JSON.stringify(exported.blocks)).not.toContain(a); // names only, no ids
    const entries = exported.blocks[0].payload.entries.map(entry => entry.name);
    const groups = [{items: [0, 1], keep: entries.indexOf('Pistachio & Berries'), confidence: .93, reason: 'Edition label only'}];
    let current = catalog;
    const answer = (blockIdValue = exported.blocks[0].blockId, g: unknown = groups) => ({version: 1, judge: 'openai/codex-chatgpt', blocks: [{blockId: blockIdValue, groups: g}]});
    const {judge, label} = judgeFromJudgments(answer(), catalog);
    const review = await analyzeCatalog(catalog, judge, label);
    expect(review.model).toBe('external:openai/codex-chatgpt');
    expect(review.clusters).toHaveLength(1);
    expect(review.clusters[0].items.map(item => item.id).sort()).toEqual([a, b].sort());
    // Out-of-range answers are dropped exactly like a live model's.
    const bad = judgeFromJudgments(answer(undefined, [{items: [0, 9], keep: 0, confidence: 1, reason: ''}]), catalog);
    expect((await analyzeCatalog(catalog, bad.judge, bad.label)).clusters).toEqual([]);
    // Missing, duplicate and left-over answers are refused.
    expect(() => judgeFromJudgments({version: 1, judge: 'x', blocks: []}, catalog)).toThrow(/do not match/);
    expect(() => judgeFromJudgments({version: 1, judge: 'x', blocks: [answer().blocks[0], answer().blocks[0]]}, catalog)).toThrow(/Duplicate/);
    expect(() => judgeFromJudgments({version: 1, judge: 'x', blocks: [answer().blocks[0], answer('0123456789abcdef').blocks[0]]}, catalog)).toThrow(/do not match/);
    // An item renamed after export invalidates the old answer instead of merging different products.
    await getPool().query("UPDATE everrate.items SET name='Fig Apple' WHERE id=$1", [b]);
    current = await readCatalog(client, groupId); expect(() => judgeFromJudgments(answer(), current)).toThrow(/do not match/);
    await getPool().query("UPDATE everrate.items SET name='Winter Edition Pistachio and Berries' WHERE id=$1", [b]);
    current = await readCatalog(client, groupId); expect(() => judgeFromJudgments(answer(), current)).not.toThrow();
    // A block that vanished (one item no longer visible) leaves its answer over, which is refused.
    await getPool().query('UPDATE everrate.ratings SET deleted_at=now() WHERE item_id=$1', [b]);
    current = await readCatalog(client, groupId); expect(() => judgeFromJudgments(answer(), current)).toThrow(/do not match/);
    await getPool().query('UPDATE everrate.ratings SET deleted_at=NULL WHERE item_id=$1', [b]);
    expect(blockId(catalog.filter(i => [a, b].includes(i.id)).reverse())).toBe(exported.blocks[0].blockId);
  });
});
