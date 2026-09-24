import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as service from '../src/server/service';
import {createCategory} from '../src/server/services/categories';
import { getPool } from '../src/server/db';
const photoCache=new Map<string,Promise<string>>();
async function testPhoto(userId:string,groupId:string):Promise<string>{
  const key=userId+groupId;let pending=photoCache.get(key);
  if(!pending){pending=getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,userId,Buffer.from('photo'),'a'.repeat(64)]).then(result=>result.rows[0].id);photoCache.set(key,pending);}
  return pending;
}
async function createWithPhoto(userId:string,input:Omit<Parameters<typeof service.createRating>[1],'photoId'>&{photoId?:string|null}){return service.createRating(userId,{...input,photoId:input.photoId||await testPhoto(userId,input.groupId)});}
const url = process.env.TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))) throw new Error('Integration tests require a disposable LOCAL TEST_DATABASE_URL with a database name ending _test');
if (url) process.env.DATABASE_URL = url;
const users = [randomUUID(), randomUUID(), randomUUID()];
let groupId: string;
describe.skipIf(!url)('private PostgreSQL application service', () => {
  beforeAll(async () => {
    for (const id of users) await service.ensureUser({ id, displayName: 'Test '+id.slice(0,4) });
    groupId = (await service.createGroup(users[0], { name: 'Integration '+randomUUID() })).id;
  });
  afterAll(async () => { await getPool().end(); });
  it('denies outsiders and permits invitation joining with owner-only settings', async () => {
    await expect(service.getGroup(users[2], groupId)).rejects.toMatchObject({ status: 404 });
    const g = await service.getGroup(users[0], groupId);
    await service.joinGroup(users[1], { code: g.inviteCode! });
    expect((await service.getGroup(users[1], groupId)).inviteCode).toBeNull();
    await expect(service.updateGroup(users[1], groupId, { name: 'Hijack' })).rejects.toMatchObject({ status: 403 });
  });
  it('appends tastings, isolates identities and calculates latest-per-person average', async () => {
    const a = await createWithPhoto(users[0], { groupId, name: 'Cola', brand: 'Coke', score: 2 });
    await createWithPhoto(users[0], { groupId, itemId: a.itemId, score: 8 });
    await createWithPhoto(users[1], { groupId, itemId: a.itemId, score: 6 });
    const item = await service.getItem(users[1], a.itemId);
    expect(item).toMatchObject({ average: 7, raterCount: 2, tastingCount: 3 });
    expect(item.ratings).toHaveLength(3);
    expect(item.ratings.find(r=>r.id===a.id)).toMatchObject({isRereview:false,countsTowardAverage:false});
    expect(item.ratings.find(r=>r.author.id===users[0]&&r.id!==a.id)).toMatchObject({isRereview:true,countsTowardAverage:true});
    expect(item.ratings.find(r=>r.author.id===users[1])).toMatchObject({isRereview:false,countsTowardAverage:true});
    const feed=await service.getFeed(users[0],groupId,{limit:1});
    const mine=await service.getPersonRatings(users[0],groupId,users[0],{limit:1});
    expect(mine.ratings[0]).toMatchObject({isRereview:true,countsTowardAverage:true});
    expect(feed[0].countsTowardAverage).toBe(true);

    const unknown = await createWithPhoto(users[0], { groupId, name: 'Cola', score: 5 });
    const variant = await createWithPhoto(users[0], { groupId, name: 'Cola', brand: 'Coke', variant: 'Zero', score: 5 });
    expect(new Set([a.itemId, unknown.itemId, variant.itemId]).size).toBe(3);
    await expect(service.getItem(users[2], a.itemId)).rejects.toMatchObject({ status: 404 });
  });
  it('keeps backdated rereviews out of the average and restores the previous score after deletion', async () => {
    const first=await createWithPhoto(users[0],{groupId,name:'Rereview timeline',score:3,tastedAt:'2024-01-01T12:00:00Z'});
    const latest=await createWithPhoto(users[0],{groupId,itemId:first.itemId,score:9,tastedAt:'2025-01-01T12:00:00Z'});
    const backdated=await createWithPhoto(users[0],{groupId,itemId:first.itemId,score:1,tastedAt:'2023-01-01T12:00:00Z'});
    await createWithPhoto(users[1],{groupId,itemId:first.itemId,score:5});
    const before=await service.getItem(users[0],first.itemId);
    expect(before).toMatchObject({average:7,raterCount:2,tastingCount:4});
    expect(before.ratings.find(r=>r.id===latest.id)).toMatchObject({isRereview:true,countsTowardAverage:true});
    expect(before.ratings.find(r=>r.id===backdated.id)).toMatchObject({isRereview:false,countsTowardAverage:false});
    await service.deleteRating(users[0],latest.id);
    const after=await service.getItem(users[0],first.itemId);
    expect(after).toMatchObject({average:4,raterCount:2,tastingCount:3});
    expect(after.ratings.find(r=>r.id===first.id)).toMatchObject({isRereview:true,countsTowardAverage:true});
    expect(after.ratings.filter(r=>r.countsTowardAverage)).toHaveLength(2);
  });
  it('marks exactly one counting review when tasting and creation timestamps tie', async () => {
    const first=await createWithPhoto(users[0],{groupId,name:'Tied rereviews',score:4,tastedAt:'2024-01-01T12:00:00Z'});
    const second=await createWithPhoto(users[0],{groupId,itemId:first.itemId,score:8,tastedAt:'2024-01-01T12:00:00Z'});
    await getPool().query("UPDATE everrate.ratings SET created_at='2024-01-01T12:00:00Z' WHERE id=ANY($1::uuid[])",[[first.id,second.id]]);
    const item=await service.getItem(users[0],first.itemId),winner=[first,second].sort((a,b)=>b.id.localeCompare(a.id))[0];
    expect(item.average).toBe(winner.score);
    expect(item.ratings.filter(r=>r.countsTowardAverage).map(r=>r.id)).toEqual([winner.id]);
    expect(item.ratings.find(r=>r.id===winner.id)?.isRereview).toBe(true);
  });
  it('serializes concurrent submits with the same idempotency key', async () => {
    const input = { groupId, name: 'Concurrent', score: 7, idempotencyKey: randomUUID() };
    const results = await Promise.all([createWithPhoto(users[0], input), createWithPhoto(users[0], input)]);
    expect(results[0].id).toBe(results[1].id);
    await expect(createWithPhoto(users[0], { ...input, score: 8 })).rejects.toMatchObject({ status: 409 });
  });
  it('enforces ownership and retains revisions after edits and soft deletes', async () => {
    const rating = await createWithPhoto(users[1], { groupId, name: 'Correction', score: 3 });
    await expect(service.updateRating(users[2], rating.id, { score: 9 })).rejects.toMatchObject({ status: 404 });
    const edited = await service.updateRating(users[1], rating.id, { score: 9 });
    expect(edited.score).toBe(9);
    const comment = await service.addComment(users[1], rating.id, { body: 'Nice' });
    await expect(service.deleteComment(users[2], comment.id)).rejects.toMatchObject({ status: 404 });
    await service.deleteComment(users[0], comment.id);
    await service.deleteRating(users[0], rating.id);
    const detail = await service.getItem(users[1], rating.itemId);
    expect(detail.ratings).toHaveLength(0);
    const revisions = await getPool().query('select * from everrate.rating_revisions where rating_id=$1', [rating.id]);
    expect(revisions.rowCount).toBe(2);
  });
  it('lets members manage their own history without gaining admin access or changing another person’s review',async()=>{
    const mine=await createWithPhoto(users[1],{groupId,name:'My editable review',score:4.5,note:'Original opinion'});
    const other=await createWithPhoto(users[0],{groupId,name:'Another person review',score:8});
    const history=await service.getPersonRatings(users[1],groupId,users[1]);
    expect(history.ratings.some(r=>r.id===mine.id)).toBe(true);
    expect(history.ratings.some(r=>r.id===other.id)).toBe(false);
    await expect(service.updateGroup(users[1],groupId,{ownerId:users[1]})).rejects.toMatchObject({status:403});
    await expect(service.updateRating(users[1],other.id,{score:1})).rejects.toMatchObject({status:403});
    await expect(service.deleteRating(users[1],other.id)).rejects.toMatchObject({status:403});
    await service.updateRating(users[1],mine.id,{score:7.5,note:'Updated opinion'});
    expect((await service.getItem(users[1],mine.itemId)).ratings[0]).toMatchObject({id:mine.id,score:7.5,note:'Updated opinion'});
    await service.deleteRating(users[1],mine.id);
    expect((await service.getPersonRatings(users[1],groupId,users[1])).ratings.some(r=>r.id===mine.id)).toBe(false);
    expect((await service.getItem(users[1],other.itemId)).ratings[0].score).toBe(8);
    expect((await getPool().query("SELECT user_id FROM everrate.memberships WHERE group_id=$1 AND role='owner'",[groupId])).rows).toEqual([{user_id:users[0]}]);
  });
  it('preserves an existing relay photo during an authorized historical correction', async () => {
    await service.joinGroup(users[1],{code:(await service.getGroup(users[0],groupId)).inviteCode!});
    const relayPhoto = await testPhoto(users[0], groupId);
    const rating = await createWithPhoto(users[1], {groupId, name:'Relayed review', score:4});
    await getPool().query("UPDATE everrate.ratings SET photo_id=$1,source='import' WHERE id=$2",[relayPhoto,rating.id]);
    await expect(service.updateRating(users[1],rating.id,{score:8,photoId:relayPhoto})).resolves.toMatchObject({score:8,photoId:relayPhoto});
    await expect(service.updateRating(users[0],rating.id,{note:'Owner correction',photoId:relayPhoto})).resolves.toMatchObject({note:'Owner correction',photoId:relayPhoto});
    const foreignPhoto=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,users[0],Buffer.from('other'),'b'.repeat(64)])).rows[0].id;
    await expect(service.updateRating(users[1],rating.id,{photoId:foreignPhoto})).rejects.toMatchObject({status:404});
    await expect(service.updateRating(users[2],rating.id,{score:1,photoId:relayPhoto})).rejects.toMatchObject({status:404});
    const revisions=await getPool().query('SELECT previous_value FROM everrate.rating_revisions WHERE rating_id=$1',[rating.id]);
    expect(revisions.rowCount).toBe(2);
    expect(revisions.rows.every(row=>row.previous_value.photo_id===relayPhoto)).toBe(true);
  });
  it('never silently combines same-name submissions, and rejects ordinary-member moderation', async () => {
    const input = { groupId, name: 'Same exact name', brand: 'Same brand', score: 7 };
    const first = await createWithPhoto(users[0], input);
    const second = await createWithPhoto(users[0], input);
    expect(second.itemId).not.toBe(first.itemId);
    await expect(service.updateRating(users[1], first.id, { score: 2 })).rejects.toMatchObject({ status: 403 });
    await expect(service.deleteRating(users[1], first.id)).rejects.toMatchObject({ status: 403 });
    const comment = await service.addComment(users[0], first.id, {body:'Owner comment'});
    await expect(service.deleteComment(users[1], comment.id)).rejects.toMatchObject({ status: 403 });
  });
  it('rotates invitations and restricts member removal', async () => {
    const prior = (await service.getGroup(users[0],groupId)).inviteCode!;
    await expect(service.rotateInvite(users[1],groupId)).rejects.toMatchObject({status:403});
    const fresh = await service.rotateInvite(users[0],groupId);
    expect(fresh.inviteCode).not.toBe(prior);
    await expect(service.joinGroup(users[2],{code:prior})).rejects.toMatchObject({status:404});
    await service.joinGroup(users[2],{code:fresh.inviteCode});
    await expect(service.removeMember(users[1],groupId,users[2])).rejects.toMatchObject({status:403});
    await service.removeMember(users[0],groupId,users[2]);
    await expect(service.getFeed(users[2],groupId)).rejects.toMatchObject({status:404});
  });
  it('filters a private catalogue and queues announcements only when connected', async () => {
    const before = await createWithPhoto(users[0],{groupId,name:'Tea pot',brand:'Maker',type:'Kitchen',score:8});
    const empty = await getPool().query('SELECT id FROM everrate.discord_outbox WHERE rating_id=$1',[before.id]);
    expect(empty.rowCount).toBe(0);
    await getPool().query('INSERT INTO everrate.discord_connections(group_id,webhook_encrypted,enabled,updated_by) VALUES($1,$2,true,$3)',[groupId,'local-test-ciphertext',users[0]]);
    const after = await createWithPhoto(users[0],{groupId,itemId:before.itemId,score:9});
    const queued = await getPool().query('SELECT payload,status FROM everrate.discord_outbox WHERE rating_id=$1',[after.id]);
    expect(queued.rows[0]).toMatchObject({status:'pending',payload:{itemName:'Tea pot',score:9}});
    const matching = await service.listItems(users[1],groupId,{search:'TEA',brand:'Maker',type:'Kitchen',sort:'score'});
    expect(matching.map(i=>i.id)).toContain(before.itemId);
    expect(await service.listItems(users[1],groupId,{search:'%'})).toHaveLength(0);
    await expect(service.listItems(users[2],groupId)).rejects.toMatchObject({status:404});
    await getPool().query("UPDATE everrate.discord_outbox SET status='processing',locked_at=now() WHERE rating_id=$1",[after.id]);
    await service.deleteRating(users[0],after.id);
    expect((await getPool().query('SELECT status FROM everrate.discord_outbox WHERE rating_id=$1',[after.id])).rows[0].status).toBe('cancelled');
  });
  it('rechecks membership after waiting for a concurrent removal transaction', async () => {
    const g = await service.createGroup(users[0], {name:'Concurrent removal'});
    await service.joinGroup(users[1],{code:g.inviteCode!});
    const blocker = await getPool().connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[g.id]);
    const pending = createWithPhoto(users[1],{groupId:g.id,name:'Must be rejected',score:5}).then(value=>({value,error:null}),error=>({value:null,error}));
    try {
      let waiting = false;
      for(let n=0;n<100;n++) {
        const activity = await getPool().query("SELECT 1 FROM pg_stat_activity WHERE application_name='tastebuds' AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
        if(activity.rowCount) {waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await blocker.query('DELETE FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[g.id,users[1]]);
      await blocker.query('COMMIT');
      expect((await pending).error).toMatchObject({status:404});
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  it('retains departed members history while current-member statistics exclude them', async () => {
    const g = await service.createGroup(users[0],{name:'Membership statistics'});
    await service.joinGroup(users[1],{code:g.inviteCode!});
    const first = await createWithPhoto(users[0],{groupId:g.id,name:'Shared tea',score:8});
    await createWithPhoto(users[1],{groupId:g.id,itemId:first.itemId,score:2});
    await service.removeMember(users[0],g.id,users[1]);
    const item = await service.getItem(users[0],first.itemId);
    expect(item).toMatchObject({average:8,raterCount:1,tastingCount:2});
    expect(item.ratings).toHaveLength(2);
    expect((await service.getGroup(users[0],g.id)).stats.activeMembers).toBe(1);
  });
  it('corrects item metadata only for creator or owner without merging item histories', async () => {
    await createCategory(users[0],groupId,{name:'Old type',fields:[]});
    const original = await createWithPhoto(users[1],{groupId,name:'Original',brand:'Old brand',variant:'Old variant',type:'Old type',broadCategory:'Old broad',score:7});
    const target = await createWithPhoto(users[0],{groupId,name:'Corrected',brand:'New brand',variant:'New variant',type:'New type',score:8});
    await expect(service.updateItem(users[2],original.itemId,{name:'Leaked'})).rejects.toMatchObject({status:404});
    await expect(service.updateItem(users[1],target.itemId,{name:'Forbidden'})).rejects.toMatchObject({status:403});
    await expect(service.updateItem(users[1],original.itemId,{})).rejects.toMatchObject({status:400});
    await expect(service.updateItem(users[1],original.itemId,{name:' '})).rejects.toMatchObject({status:400});
    const updated = await service.updateItem(users[1],original.itemId,{name:'Corrected',brand:'New brand',variant:'New variant',type:'New type'});
    expect(updated).toMatchObject({id:original.itemId,createdBy:users[1],name:'Corrected',brand:'New brand',variant:'New variant',type:'New type',broadCategory:'Old broad',tastingCount:1});
    expect((await service.getItem(users[0],target.itemId)).tastingCount).toBe(1);
    const cleared = await service.updateItem(users[0],original.itemId,{brand:null,variant:'',type:null,broadCategory:null});
    expect(cleared).toMatchObject({id:original.itemId,name:'Corrected',brand:null,variant:null,type:null,broadCategory:null});
    const audit = await getPool().query("SELECT details FROM everrate.audit_events WHERE resource_id=$1 AND action='item.update' ORDER BY created_at",[original.itemId]);
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0].details.previous).toMatchObject({name:'Original',brand:'Old brand',variant:'Old variant',type:'Old type',broadCategory:'Old broad'});
    expect((await getPool().query('SELECT identity_key FROM everrate.items WHERE id=$1',[original.itemId])).rows[0].identity_key).toBe('["corrected",null,null]');
  });
  it('preserves fresh brand metadata when an item edit waits behind another edit', async () => {
    const rating = await createWithPhoto(users[0],{groupId,name:'Before concurrent edit',brand:'Before brand',score:5});
    const brand = await getPool().query('INSERT INTO everrate.brands(group_id,name) VALUES($1,$2) RETURNING id',[groupId,'Concurrent '+randomUUID()]);
    const blocker = await getPool().connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM everrate.items WHERE id=$1 FOR UPDATE',[rating.itemId]);
    const pending = service.updateItem(users[0],rating.itemId,{name:'After concurrent edit'}).then(value=>({value,error:null}),error=>({value:null,error}));
    try {
      let waiting = false;
      for(let n=0;n<100;n++) {
        const activity = await getPool().query("SELECT 1 FROM pg_stat_activity WHERE application_name='tastebuds' AND wait_event_type='Lock' AND pid<>pg_backend_pid()");
        if(activity.rowCount) {waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await blocker.query('UPDATE everrate.items SET brand_id=$1 WHERE id=$2',[brand.rows[0].id,rating.itemId]);
      await blocker.query('COMMIT');
      const result = await pending;
      expect(result.error).toBeNull();
      const row = (await getPool().query('SELECT i.identity_key,b.name brand FROM everrate.items i JOIN everrate.brands b ON b.id=i.brand_id WHERE i.id=$1',[rating.itemId])).rows[0];
      expect(JSON.parse(row.identity_key)[1]).toBe(row.brand.toLowerCase());
      const log = await getPool().query("SELECT details FROM everrate.audit_events WHERE resource_id=$1 AND action='item.update'",[rating.itemId]);
      expect(log.rows[0].details.previous.brand).toBe(row.brand);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  it('corrects comments for author and owner, retaining prior bodies in the audit log', async () => {
    const rating = await createWithPhoto(users[0],{groupId,name:'Comment target',score:5});
    const original = await service.addComment(users[0],rating.id,{body:'Original note'});
    await expect(service.updateComment(users[2],original.id,{body:'Leak'})).rejects.toMatchObject({status:404});
    await expect(service.updateComment(users[1],original.id,{body:'Not mine'})).rejects.toMatchObject({status:403});
    await expect(service.updateComment(users[0],original.id,{body:' '})).rejects.toMatchObject({status:400});
    const edited = await service.updateComment(users[0],original.id,{body:'Corrected note'});
    expect(edited).toMatchObject({id:original.id,body:'Corrected note'});
    const memberComment = await service.addComment(users[1],rating.id,{body:'Member note'});
    await service.updateComment(users[0],memberComment.id,{body:'Moderated note'});
    const audit = await getPool().query("SELECT details FROM everrate.audit_events WHERE resource_id=$1 AND action='comment.update'",[memberComment.id]);
    expect(audit.rows[0].details).toMatchObject({previousBody:'Member note'});
    const detail = await service.getItem(users[1],rating.itemId);
    expect(detail.ratings[0].comments.map(comment=>comment.body)).toEqual(['Corrected note','Moderated note']);
    await service.deleteComment(users[0],original.id);
    await expect(service.updateComment(users[0],original.id,{body:'Undelete'})).rejects.toMatchObject({status:404});
  });
  it('rejects cross-group relationships directly at the PostgreSQL foreign-key boundary', async () => {
    const other = await service.createGroup(users[2],{name:'Foreign key isolation'});
    const foreign = await createWithPhoto(users[2],{groupId:other.id,name:'Foreign key target',score:5});
    const local = await createWithPhoto(users[0],{groupId,name:'Local FK target',score:6});
    const photo = await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[other.id,users[2],Buffer.from('fk'),'f'.repeat(64)]);
    await expect(getPool().query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id) VALUES($1,$2,$3,5,$4)',[groupId,foreign.itemId,users[0],await testPhoto(users[0],groupId)])).rejects.toMatchObject({code:'23503'});
    await expect(getPool().query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id) VALUES($1,$2,$3,5,$4)',[groupId,local.itemId,users[0],photo.rows[0].id])).rejects.toMatchObject({code:'23503'});
    await expect(getPool().query("INSERT INTO everrate.comments(group_id,rating_id,user_id,body) VALUES($1,$2,$3,'No cross-group comment')",[groupId,foreign.id,users[0]])).rejects.toMatchObject({code:'23503'});
  });
  it('rolls back the complete new item and rating if transactional announcement queueing fails', async () => {
    const isolated = await service.createGroup(users[0],{name:'Outbox rollback'});
    await getPool().query('INSERT INTO everrate.discord_connections(group_id,webhook_encrypted,enabled,updated_by) VALUES($1,$2,true,$3)',[isolated.id,'test-only-ciphertext',users[0]]);
    const constraint = 'test_outbox_reject_'+randomUUID().replaceAll('-','');
    // Only this disposable group is rejected; concurrent suites retain their own outboxes.
    await getPool().query('ALTER TABLE everrate.discord_outbox ADD CONSTRAINT '+constraint+" CHECK (group_id <> '"+isolated.id+"'::uuid)");
    try {
      const key = randomUUID();
      await expect(createWithPhoto(users[0],{groupId:isolated.id,name:'Must roll back',brand:'Rollback brand',type:'Rollback type',score:7,idempotencyKey:key})).rejects.toMatchObject({code:'23514'});
      for (const table of ['items','ratings','brands','item_types','discord_outbox']) {
        expect((await getPool().query('SELECT count(*)::int n FROM everrate.'+table+' WHERE group_id=$1',[isolated.id])).rows[0].n).toBe(0);
      }
    } finally { await getPool().query('ALTER TABLE everrate.discord_outbox DROP CONSTRAINT '+constraint); }
  });
  it('requires a real attached photo for every new rating and for correcting legacy photo exceptions', async () => {
    await expect(service.createRating(users[0],{groupId,name:'No photo',score:5,photoId:undefined as unknown as string})).rejects.toMatchObject({status:400});
    const withPhoto=await createWithPhoto(users[0],{groupId,name:'Required photo',score:7});
    const corrected=await service.updateRating(users[0],withPhoto.id,{score:8});
    expect(corrected.photoId).toBe(withPhoto.photoId);
    await expect(getPool().query('INSERT INTO everrate.ratings(group_id,item_id,user_id,score) VALUES($1,$2,$3,5)',[groupId,withPhoto.itemId,users[0]])).rejects.toMatchObject({code:'23514'});
    const old=await getPool().query("INSERT INTO everrate.ratings(group_id,item_id,user_id,score,source,legacy_photo_missing) VALUES($1,$2,$3,5,'import',true) RETURNING id",[groupId,withPhoto.itemId,users[0]]);
    await expect(service.updateRating(users[0],old.rows[0].id,{score:8})).rejects.toMatchObject({status:400});
    const repaired=await service.updateRating(users[0],old.rows[0].id,{score:8,photoId:withPhoto.photoId!});
    expect(repaired).toMatchObject({photoId:withPhoto.photoId,legacyPhotoMissing:false});
  });
  it('rejects cross-group items and photos and requires owner transfer before leaving', async () => {
    const other = await service.createGroup(users[2], { name: 'Other' });
    const rating = await createWithPhoto(users[2], { groupId: other.id, name: 'Private', score: 6 });
    await expect(createWithPhoto(users[0], { groupId, itemId: rating.itemId, score: 7 })).rejects.toMatchObject({ status: 404 });
    const photo = await getPool().query(`insert into everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) values($1,$2,$3,$4,'image/jpeg',1,1) returning id`, [other.id,users[2],Buffer.from('x'),'a'.repeat(64)]);
    await expect(createWithPhoto(users[0], { groupId, name: 'Foreign', score: 7, photoId: photo.rows[0].id })).rejects.toMatchObject({ status: 404 });
    await expect(service.updateGroup(users[0], groupId, { leave: true })).rejects.toMatchObject({ status: 409 });
    await service.updateGroup(users[0], groupId, { ownerId: users[1] });
    await service.updateGroup(users[0], groupId, { leave: true });
    await expect(service.getGroup(users[0], groupId)).rejects.toMatchObject({ status: 404 });
  });
});
