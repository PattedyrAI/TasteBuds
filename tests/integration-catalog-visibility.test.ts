import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../scripts/migrate';
import { getPool } from '../src/server/db';
import * as service from '../src/server/service';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || target.search) throw new Error('A local disposable TEST_DATABASE_URL is required');
}

describe.skipIf(!url)('catalog visibility follows retained nondeleted tastings', () => {
  let admin: Pool, database: string, groupId: string;
  const owner = randomUUID(), outsider = randomUUID();
  let emptyItem: string, ratedItem: string, deletedItem: string, repeatItem: string, deletedRating: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    database = 'everrate_catalog_' + randomUUID().replaceAll('-', '') + '_test';
    await admin.query(`CREATE DATABASE "${database}"`);
    const target = new URL(url!); target.pathname = '/' + database;
    await migrate(target.toString());
    process.env.DATABASE_URL = target.toString();
    await service.ensureUser({ id: owner, displayName: 'Catalog owner' });
    await service.ensureUser({ id: outsider, displayName: 'Outside reviewer' });
    groupId = (await service.createGroup(owner, { name: 'Catalog fixture' })).id;
    emptyItem = (await getPool().query(`INSERT INTO everrate.items(group_id,name,identity_key,created_by,legacy_metadata) VALUES($1,'A Empty alias','empty-alias',$2,'{"originalReviewerLabel":"alias"}') RETURNING id`, [groupId, owner])).rows[0].id;
    const photoId = (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id", [groupId, owner, Buffer.from('fixture'), 'a'.repeat(64)])).rows[0].id;
    const rated = await service.createRating(owner, { groupId, name: 'B Rated product', type: 'Tea', score: 7, photoId }); ratedItem = rated.itemId;
    const deleted = await service.createRating(owner, { groupId, name: 'C Deleted-only product', type: 'Dormant type', score: 6, photoId }); deletedItem = deleted.itemId; deletedRating = deleted.id;
    await service.deleteRating(owner, deleted.id);
    const repeat = await service.createRating(owner, { groupId, name: 'D Repeat product', type: 'Tea', score: 4, photoId }); repeatItem = repeat.itemId;
    await service.createRating(owner, { groupId, itemId: repeatItem, score: 8, photoId });
  });

  afterAll(async () => {
    if (database) {
      await getPool().end();
      await admin.query(`DROP DATABASE "${database}"`);
    }
    await admin?.end();
  });

  it('excludes empty legacy and deleted-only items while including normally rated products', async () => {
    const items = await service.listItems(owner, groupId, { sort: 'name' });
    expect(items.map(item => item.id)).toEqual([ratedItem, repeatItem]);
    expect(items.map(item => item.type)).toEqual(['Tea', 'Tea']);
  });

  it('applies visibility before search, category filtering and pagination', async () => {
    expect(await service.listItems(owner, groupId, { search: 'Empty alias' })).toEqual([]);
    expect(await service.listItems(owner, groupId, { type: 'Dormant type' })).toEqual([]);
    expect((await service.listItems(owner, groupId, { sort: 'name', limit: 1 })).map(item => item.id)).toEqual([ratedItem]);
    expect((await service.listItems(owner, groupId, { sort: 'name', limit: 1, offset: 1 })).map(item => item.id)).toEqual([repeatItem]);
  });

  it('counts repeated tastings once per item and keeps group totals consistent with Home items', async () => {
    const items = await service.listItems(owner, groupId);
    const group = await service.getGroup(owner, groupId);
    expect(group.stats).toEqual({ itemCount: 2, tastingCount: 3, activeMembers: 1 });
    expect(group.stats.itemCount).toBe(items.length);
    expect(items.find(item => item.id === repeatItem)?.tastingCount).toBe(2);
  });

  it('retains authorized direct item access and stored history for hidden rows', async () => {
    for (const id of [emptyItem, deletedItem]) expect(await service.getItem(owner, id)).toMatchObject({ id, tastingCount: 0, ratings: [] });
    expect((await getPool().query('SELECT count(*)::int n FROM everrate.items WHERE group_id=$1', [groupId])).rows[0].n).toBe(4);
    expect((await getPool().query('SELECT deleted_at FROM everrate.ratings WHERE id=$1', [deletedRating])).rows[0].deleted_at).not.toBeNull();
    expect((await getPool().query('SELECT count(*)::int n FROM everrate.rating_revisions WHERE rating_id=$1', [deletedRating])).rows[0].n).toBe(1);
  });

  it('still denies outsiders both catalog access and direct hidden-item access', async () => {
    await expect(service.listItems(outsider, groupId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getGroup(outsider, groupId)).rejects.toMatchObject({ status: 404 });
    await expect(service.getItem(outsider, emptyItem)).rejects.toMatchObject({ status: 404 });
  });
});
