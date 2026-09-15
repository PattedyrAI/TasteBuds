import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {normalizeItemTypes} from '../scripts/normalize-item-types';
describe('normalization target safety',()=>{
  it('rejects remote databases before connecting',async()=>{
    await expect(normalizeItemTypes('postgresql://user@remote.example/everrate_test')).rejects.toThrow();
    await expect(normalizeItemTypes('postgresql://user@localhost/everrate_test?host=remote.example')).rejects.toThrow();
  });
});
const url=process.env.TYPE_NORMALIZATION_TEST_DATABASE_URL;
if(url&&(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Use a disposable local test database.');
describe.skipIf(!url)('group-scoped type normalization',()=>{
  const ids={user:randomUUID(),a:randomUUID(),b:randomUUID(),canonical:randomUUID(),aliasA:randomUUID(),aliasB:randomUUID(),itemA:randomUUID(),itemB:randomUUID(),rating:randomUUID()};let db:Client,before:any;
  beforeAll(async()=>{
    db=new Client({connectionString:url});await db.connect();
    await db.query("INSERT INTO everrate.users(id,display_name) VALUES($1,'Normalization test')",[ids.user]);
    for(const group of [ids.a,ids.b])await db.query("INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,'Normalization test',$2,$3)",[group,ids.user,randomUUID()]);
    await db.query("INSERT INTO everrate.item_types(id,group_id,name) VALUES($1,$2,'Soft drinks'),($3,$2,'Soda'),($4,$5,'sodas')",[ids.canonical,ids.a,ids.aliasA,ids.aliasB,ids.b]);
    for(const [id,group,type] of [[ids.itemA,ids.a,ids.aliasA],[ids.itemB,ids.b,ids.aliasB]])await db.query("INSERT INTO everrate.items(id,group_id,name,type_id,identity_key,created_by) VALUES($1,$2,'Preserved item',$3,'identity',$4)",[id,group,type,ids.user]);
    await db.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,source,legacy_photo_missing) VALUES($1,$2,$3,$4,8,'Preserved note','2025-01-01T12:00:00Z','import',true)",[ids.rating,ids.a,ids.itemA,ids.user]);
    before=(await db.query('SELECT * FROM everrate.ratings WHERE id=$1',[ids.rating])).rows[0];
  });
  afterAll(async()=>{await db?.end();});
  it('dry-run describes changes without updating rows or creating audit entries',async()=>{
    const result=await normalizeItemTypes(url!);expect(result.applied).toBe(false);expect(result.mappings.some((m:any)=>m.fromTypeId===ids.aliasA&&m.toTypeId===ids.canonical)).toBe(true);
    expect((await db.query('SELECT type_id FROM everrate.items WHERE id=$1',[ids.itemA])).rows[0].type_id).toBe(ids.aliasA);
    expect((await db.query("SELECT count(*)::int n FROM everrate.audit_events WHERE group_id IN ($1,$2) AND action='item_type.normalize'",[ids.a,ids.b])).rows[0].n).toBe(0);
  });
  it('reuses the canonical row in its own group and renames the other group independently',async()=>{
    const result=await normalizeItemTypes(url!,true);expect(result.applied).toBe(true);
    expect((await db.query('SELECT type_id FROM everrate.items WHERE id=$1',[ids.itemA])).rows[0].type_id).toBe(ids.canonical);
    expect((await db.query('SELECT type_id FROM everrate.items WHERE id=$1',[ids.itemB])).rows[0].type_id).toBe(ids.aliasB);
    expect((await db.query('SELECT name FROM everrate.item_types WHERE id=$1',[ids.aliasB])).rows[0].name).toBe('Soft drinks');
    expect((await db.query('SELECT 1 FROM everrate.item_types WHERE id=$1',[ids.aliasA])).rowCount).toBe(0);
    expect((await db.query('SELECT * FROM everrate.ratings WHERE id=$1',[ids.rating])).rows[0]).toEqual(before);
    const audits=(await db.query("SELECT details FROM everrate.audit_events WHERE group_id IN ($1,$2) AND action='item_type.normalize'",[ids.a,ids.b])).rows;
    expect(audits).toHaveLength(2);expect(audits.some(x=>x.details.affectedItemIds.includes(ids.itemA))).toBe(true);
  });
  it('does nothing on a second apply',async()=>{
    const result=await normalizeItemTypes(url!,true);expect(result.mappings).toHaveLength(0);expect(result.itemsReassigned).toBe(0);
  });
});
