import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import {createGroup,ensureUser,createRating,getGroup,joinGroup,getItem} from '../src/server/service';
import {importRatings} from '../src/server/services/rating-import';
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local test DB required');
let admin:Pool,database:string,source:string,destination:string,sourceCategory:string,targetCategory:string,otherCategory:string,ratingId:string,photos:string[];
const actor=randomUUID(),other=randomUUID(),outsider=randomUUID();
describe.skipIf(!url)('personal category rating import',()=>{
 beforeAll(async()=>{
  admin=new Pool({connectionString:url});database='rating_import_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();
  for(const id of [actor,other,outsider])await ensureUser({id,displayName:'Fixture'});
  source=(await createGroup(actor,{name:'Source'})).id;destination=(await createGroup(other,{name:'Destination'})).id;
  await joinGroup(actor,{code:(await getGroup(other,destination)).inviteCode!});await joinGroup(other,{code:(await getGroup(actor,source)).inviteCode!});
  async function category(g:string,name:string){return (await getPool().query('INSERT INTO everrate.item_types(group_id,name) VALUES($1,$2) RETURNING id',[g,name])).rows[0].id;}
  sourceCategory=await category(source,'Drinks');otherCategory=await category(source,'Snacks');targetCategory=await category(destination,'Beverages');
  async function photo(owner=actor){return (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[source,owner,Buffer.from('fixture'),'a'.repeat(64)])).rows[0].id;}
  photos=[await photo(),await photo()];
  const rating=await createRating(actor,{groupId:source,name:'Drink',brand:'Maker',type:'Drinks',score:8.2,note:'Original note',tastedAt:'2025-01-02T12:00:00Z',photoId:photos[0],photoIds:photos});ratingId=rating.id;
  await createRating(actor,{groupId:source,name:'Snack',brand:'Maker',type:'Snacks',score:5,photoId:photos[0]});
  await createRating(other,{groupId:source,name:'Other person',brand:'Maker',type:'Drinks',score:9,photoId:await photo(other)});
 });
 afterAll(async()=>{await getPool().end();await admin.query(`DROP DATABASE "${database}"`);await admin.end();});
 const input=()=>({sourceGroupId:source,sourceCategoryId:sourceCategory,destinationCategoryId:targetCategory});
 it('copies only own category ratings, with independently authorized photos and original data',async()=>{
  expect(await importRatings(actor,destination,input())).toEqual({imported:1,skipped:0});
  const copied=(await getPool().query('SELECT * FROM everrate.ratings WHERE group_id=$1',[destination])).rows;
  expect(copied).toHaveLength(1);const row=copied[0];expect(row.user_id).toBe(actor);expect(Number(row.score)).toBe(8.2);expect(row.note).toBe('Original note');expect(row.tasted_at.toISOString()).toBe('2025-01-02T12:00:00.000Z');expect(row.photo_id).not.toBe(photos[0]);
  const detail=await getItem(actor,row.item_id);expect(detail.type).toBe('Beverages');expect(detail.ratings[0].photoIds).toHaveLength(2);
  for(const id of detail.ratings[0].photoIds!){const photo=(await getPool().query('SELECT * FROM everrate.photos WHERE id=$1',[id])).rows[0];expect(photo.group_id).toBe(destination);expect(photo.data.toString()).toBe('fixture');}
  expect((await getPool().query('SELECT note FROM everrate.ratings WHERE id=$1',[ratingId])).rows[0].note).toBe('Original note');
  expect((await getPool().query('SELECT 1 FROM everrate.discord_outbox WHERE group_id=$1',[destination])).rowCount).toBe(0);
 });
 it('skips prior copies even with simultaneous retries',async()=>{
  const results=await Promise.all([importRatings(actor,destination,input()),importRatings(actor,destination,input())]);expect(results).toEqual([{imported:0,skipped:1},{imported:0,skipped:1}]);
  expect((await getPool().query('SELECT 1 FROM everrate.ratings WHERE group_id=$1',[destination])).rowCount).toBe(1);
 });
 it('preserves field snapshots and rolls back the whole batch on a failed copy',async()=>{
  const original=(await getPool().query('SELECT photo_id FROM everrate.ratings WHERE id=$1',[ratingId])).rows[0];
  const added=await createRating(actor,{groupId:source,name:'Second drink',brand:'Maker',type:'Drinks',score:7,photoId:original.photo_id});
  await getPool().query(`UPDATE everrate.ratings SET custom_fields='{"aroma":"Citrus"}',category_fields='[{"id":"aroma","label":"Aroma","type":"text","required":false,"filterable":false}]' WHERE id=$1`,[added.id]);
  await getPool().query(`CREATE FUNCTION everrate.reject_fixture_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='import' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await getPool().query('CREATE TRIGGER reject_fixture_import BEFORE INSERT ON everrate.ratings FOR EACH ROW EXECUTE FUNCTION everrate.reject_fixture_import()');
  const before=(await getPool().query('SELECT count(*)::int n FROM everrate.photos WHERE group_id=$1',[destination])).rows[0].n;
  try{await expect(importRatings(actor,destination,input())).rejects.toThrow('fixture failure');}finally{await getPool().query('DROP TRIGGER reject_fixture_import ON everrate.ratings');}
  expect((await getPool().query('SELECT count(*)::int n FROM everrate.photos WHERE group_id=$1',[destination])).rows[0].n).toBe(before);
  expect(await importRatings(actor,destination,input())).toEqual({imported:1,skipped:1});
  const copied=(await getPool().query('SELECT custom_fields,category_fields FROM everrate.ratings WHERE user_id=$1 AND idempotency_key=$2',[actor,`group-import:${destination}:${added.id}`])).rows[0];
  expect(copied.custom_fields).toEqual({aroma:'Citrus'});expect(copied.category_fields[0].id).toBe('aroma');
 });
 it('rejects non-members, cross-group category IDs, same-group copies and caller-selected authors',async()=>{
  await expect(importRatings(outsider,destination,input())).rejects.toMatchObject({status:404});
  await expect(importRatings(actor,destination,{...input(),destinationCategoryId:otherCategory})).rejects.toMatchObject({status:404});
  await expect(importRatings(actor,source,input())).rejects.toMatchObject({status:400});
  await expect(importRatings(actor,destination,{...input(),userId:other})).rejects.toMatchObject({status:400});
  await getPool().query('DELETE FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[source,actor]);
  await expect(importRatings(actor,destination,input())).rejects.toMatchObject({status:404});
 });
});
