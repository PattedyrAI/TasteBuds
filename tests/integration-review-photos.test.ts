import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import {createGroup,ensureUser,createRating,updateRating,getItem,getFeed,getPersonRatings,joinGroup,getGroup,deleteRating} from '../src/server/service';
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local test DB required');
let admin:Pool,database:string,group:string,otherGroup:string;const owner=randomUUID(),member=randomUUID();let photos:string[],foreign:string,crossGroup:string;
describe.skipIf(!url)('review photo galleries',()=>{
 beforeAll(async()=>{
  admin=new Pool({connectionString:url});database='gallery_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();
  await ensureUser({id:owner,displayName:'Owner'});await ensureUser({id:member,displayName:'Member'});group=(await createGroup(owner,{name:'Gallery'})).id;otherGroup=(await createGroup(owner,{name:'Other'})).id;await joinGroup(member,{code:(await getGroup(owner,group)).inviteCode!});
  async function photo(user=owner,g=group){return (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[g,user,Buffer.from('fixture'),'a'.repeat(64)])).rows[0].id as string;}
  photos=await Promise.all(Array.from({length:6},()=>photo()));foreign=await photo(member);crossGroup=await photo(owner,otherGroup);
 });
 afterAll(async()=>{await getPool().end();await admin.query(`DROP DATABASE "${database}"`);await admin.end();});
 const input=()=>({groupId:group,name:'Gallery product',score:8,photoId:photos[0],photoIds:photos.slice(0,3)});
 it('persists ordered photos across details, feed and personal history',async()=>{
  const r=await createRating(owner,input());expect(r.photoIds).toEqual(photos.slice(0,3));
  expect((await getItem(owner,r.itemId)).ratings[0].photoIds).toEqual(r.photoIds);
  expect((await getFeed(owner,group))[0].photoIds).toEqual(r.photoIds);
  expect((await getPersonRatings(owner,group,owner)).ratings[0].photoIds).toEqual(r.photoIds);
  const edited=await updateRating(owner,r.id,{photoId:photos[2],photoIds:[photos[2],photos[1]]});expect(edited.photoIds).toEqual([photos[2],photos[1]]);
  expect((await updateRating(owner,r.id,{note:'Keep gallery'})).photoIds).toEqual(edited.photoIds);
  const revision=(await getPool().query('SELECT previous_value FROM everrate.rating_revisions WHERE rating_id=$1 ORDER BY created_at LIMIT 1',[r.id])).rows[0].previous_value;expect(revision.photo_ids).toEqual(photos.slice(0,3));
  const repeat=await createRating(owner,{...input(),itemId:r.itemId,rereviewOf:r.id,photoId:photos[2],photoIds:edited.photoIds,score:9});expect(repeat.photoIds).toEqual(edited.photoIds);expect((await getItem(owner,r.itemId)).average).toBe(9);
  await deleteRating(owner,repeat.id);expect((await getItem(owner,r.itemId)).average).toBe(8);
 });
 it('requires one to five distinct photos with a consistent cover',async()=>{
  for(const photoIds of [[],photos,[photos[0],photos[0]],[photos[1]]])await expect(createRating(owner,{...input(),photoIds})).rejects.toMatchObject({status:400});
  const r=await createRating(owner,{groupId:group,name:'Legacy client',score:7,photoId:photos[0]});expect(r.photoIds).toEqual([photos[0]]);
  await expect(updateRating(owner,r.id,{photoIds:[]})).rejects.toMatchObject({status:400});
 });
 it('denies foreign and cross-group attachments and edits by other members',async()=>{
  for(const id of [foreign,crossGroup])await expect(createRating(owner,{...input(),photoIds:[photos[0],id]})).rejects.toMatchObject({status:404});
  const r=await createRating(owner,input());await expect(updateRating(member,r.id,{photoIds:[foreign]})).rejects.toMatchObject({status:403});
  await expect(updateRating(owner,r.id,{photoIds:[photos[0],foreign]})).rejects.toMatchObject({status:404});
 });
 it('preserves extras for older clients and serializes concurrent edits',async()=>{
  const r=await createRating(owner,input());
  const oldClient=await updateRating(owner,r.id,{photoId:photos[3]});expect(oldClient.photoIds).toEqual([photos[3],photos[1],photos[2]]);
  await Promise.all([updateRating(owner,r.id,{photoIds:[photos[4],photos[2]]}),updateRating(owner,r.id,{note:'Concurrent note'})]);
  const result=(await getItem(owner,r.itemId)).ratings.find(review=>review.id===r.id)!;
  expect(result.photoIds).toEqual([photos[4],photos[2]]);expect(result.note).toBe('Concurrent note');
 });
 it('reuses every imported photo only from the author’s own source review',async()=>{
  const r=await createRating(owner,input());await getPool().query('UPDATE everrate.photos SET owner_id=$1 WHERE id=ANY($2::uuid[])',[member,photos.slice(0,3)]);
  const repeat=await createRating(owner,{...input(),itemId:r.itemId,rereviewOf:r.id});expect(repeat.photoIds).toEqual(photos.slice(0,3));
  expect((await updateRating(owner,r.id,{photoIds:[photos[2],photos[0]]})).photoIds).toEqual([photos[2],photos[0]]);
  await expect(createRating(owner,{...input(),itemId:r.itemId})).rejects.toMatchObject({status:404});
 });
});
