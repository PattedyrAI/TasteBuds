import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import sharp from 'sharp';
import {migrate} from '../scripts/migrate';
import {applyRatingCorrections,captureRatingCorrectionSnapshots,ratingCorrectionPlanSha256,normalizeArchivedPhoto,type RatingCorrectionPlan} from '../scripts/apply-rating-corrections';
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable local database required');
describe('reviewed archive photo normalization',()=>{
  it('uses deterministic JPEG output and rejects invalid or oversized input',async()=>{
    const input=await sharp({create:{width:12,height:8,channels:3,background:'#13bb88'}}).png().toBuffer();
    const a=await normalizeArchivedPhoto(input),b=await normalizeArchivedPhoto(input);
    expect(a.sha256).toBe(hash(a.data));expect(a).toEqual(b);expect(a).toMatchObject({mimeType:'image/jpeg',width:12,height:8});
    await expect(normalizeArchivedPhoto(Buffer.from('invalid'))).rejects.toThrow();
    await expect(normalizeArchivedPhoto(Buffer.alloc(10*1024*1024+1))).rejects.toThrow();
  });
});
describe.skipIf(!url)('reviewed rating repairs in disposable PostgreSQL',()=>{
  let admin:Pool,pool:Pool,client:PoolClient,database:string;
  beforeAll(async()=>{admin=new Pool({connectionString:url});database='everrate_rating_repair_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());pool=new Pool({connectionString:target.toString(),max:3});client=await pool.connect();});
  afterAll(async()=>{client?.release();await pool?.end();if(database)await admin.query(`DROP DATABASE "${database}"`);await admin?.end();});
  async function fixture(){
    const user=randomUUID(),friend=randomUUID(),group=randomUUID(),item=randomUUID(),otherItem=randomUUID(),rating=randomUUID(),source=randomUUID(),message=randomUUID(),attachment=randomUUID(),file=randomUUID(),photo=randomUUID();
    for(const id of [user,friend])await client.query('INSERT INTO everrate.users(id,display_name) VALUES($1,$2)',[id,id===user?'Sender':'Reviewed friend']);
    await client.query('INSERT INTO everrate.groups(id,owner_id,name,invite_code) VALUES($1,$2,$3,$4)',[group,user,'Fixture',randomUUID()]);
    for(const id of [user,friend])await client.query('INSERT INTO everrate.memberships(group_id,user_id,role) VALUES($1,$2,$3)',[group,id,id===user?'owner':'member']);
    for(const id of [item,otherItem])await client.query('INSERT INTO everrate.items(id,group_id,name,identity_key,created_by) VALUES($1,$2,$3,$4,$5)',[id,group,id===item?'Wrong grouping':'Reviewed drink','fixture',user]);
    const input=await sharp({create:{width:12,height:8,channels:3,background:'#'+source.replaceAll('-','').slice(0,6)}}).png().toBuffer(),normalized=await normalizeArchivedPhoto(input),blobHash=hash(input),messageId='discord-'+randomUUID();
    const raw={id:messageId,content:'friend rates this 9; sender rates 7',createdAt:'2026-06-26T12:34:56.123456Z'};
    await client.query("INSERT INTO everrate.import_sources(id,source_key,source_type) VALUES($1,$2,'fixture')",[source,randomUUID()]);
    await client.query('INSERT INTO everrate.archive_messages(id,source_id,message_id,sha256,raw_record,sent_at) VALUES($1,$2,$3,$4,$5,$6)',[message,source,messageId,hash(JSON.stringify(raw)),raw,raw.createdAt]);
    await client.query('INSERT INTO everrate.archive_blobs(sha256,byte_size,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[blobHash,input.length,input]);
    await client.query('INSERT INTO everrate.archive_files(id,source_id,relative_path,sha256,byte_size,blob_sha256) VALUES($1,$2,$3,$4,$5,$4)',[file,source,'fixture-'+file+'.png',blobHash,input.length]);
    await client.query('INSERT INTO everrate.archive_attachments(id,source_id,message_id,attachment_id,ordinal,sha256,raw_record,archive_file_id) VALUES($1,$2,$3,$4,0,$5,$6,$7)',[attachment,source,messageId,randomUUID(),hash('{}'),{},file]);
    await client.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,source,source_message_id,tasted_at,legacy_photo_missing) VALUES($1,$2,$3,$4,5,'Original note','import',$5,'2026-06-26T12:34:56.123456Z',true)",[rating,group,item,user,messageId]);
    await client.query("INSERT INTO everrate.rating_revisions(rating_id,actor_id,action,previous_value) VALUES($1,NULL,'update',$2)",[rating,{original:true}]);
    await client.query('INSERT INTO everrate.comments(group_id,rating_id,user_id,body) VALUES($1,$2,$3,$4)',[group,rating,user,'Original comment']);
    const snapshots=await captureRatingCorrectionSnapshots(client,{groupId:group,userIds:[user,friend],itemIds:[item,otherItem],ratingIds:[rating],photoIds:[],sourceIds:[message],attachmentIds:[attachment]});
    const plan:RatingCorrectionPlan={newItems:[],version:1,planId:randomUUID(),group:{id:group,expectedSha256:snapshots.group.sha256},evidence:'Reviewed sender and relay identities from exact source.',users:snapshots.users.map(row=>({id:row.id,expectedSha256:row.sha256})),memberships:snapshots.memberships.map(row=>({id:row.id,expectedSha256:row.sha256})),items:snapshots.items.map(row=>({id:row.id,expectedSha256:row.sha256})),sources:snapshots.sources.map(row=>({id:row.id,expectedSha256:row.sha256,expectedSourceSha256:row.snapshot.row.sha256})),attachments:snapshots.attachments.map(row=>({id:row.id,expectedSha256:row.sha256})),photos:[],photoImports:[{photoId:photo,attachmentId:attachment,sourceId:message,ownerId:user,expectedOriginalSha256:blobHash,expectedPhotoSha256:normalized.sha256,width:12,height:8,mimeType:'image/jpeg',evidence:'Exact archived package photo.'}],corrections:[{ratingId:rating,expectedSha256:snapshots.ratings[0].sha256,sourceId:message,evidence:'Sender explicitly reports friend score9.',set:{userId:friend,score:9,itemId:otherItem,photoId:photo}}],additions:[{ratingId:randomUUID(),sourceId:message,sourcePartKey:'sender-score-1',evidence:'Sender score7 distinct from friend relay9.',userId:user,itemId:otherItem,score:7,note:null,tastedAt:raw.createdAt,createdAt:raw.createdAt,photoId:photo}]};
    return {user,friend,group,item,otherItem,rating,message,attachment,photo,plan,snapshots,messageId,source,file,blobHash};
  }
  it('dry-runs then atomically repairs and adds relay events without rewriting history',async()=>{
    const f=await fixture();expect(await applyRatingCorrections(client,f.plan)).toMatchObject({applied:false,corrections:1,additions:1,photos:1});
    expect((await client.query('SELECT 1 FROM everrate.photos WHERE id=$1',[f.photo])).rowCount).toBe(0);
    expect(await applyRatingCorrections(client,f.plan,{apply:true})).toMatchObject({applied:true,corrections:1,additions:1,photos:1});
    const after=await captureRatingCorrectionSnapshots(client,{groupId:f.group,userIds:[],itemIds:[],ratingIds:[f.rating],photoIds:[f.photo],sourceIds:[],attachmentIds:[]});
    const row=after.ratings[0].snapshot,old=f.snapshots.ratings[0].snapshot;
    expect({...row,user_id:old.user_id,score:old.score,item_id:old.item_id,photo_id:old.photo_id,legacy_photo_missing:old.legacy_photo_missing}).toEqual(old);
    expect(row).toMatchObject({user_id:f.friend,score:9,item_id:f.otherItem,photo_id:f.photo,legacy_photo_missing:false});
    expect((await client.query('SELECT count(*)::int n FROM everrate.rating_revisions WHERE rating_id=$1',[f.rating])).rows[0].n).toBe(1);
    expect((await client.query('SELECT count(*)::int n FROM everrate.comments WHERE rating_id=$1',[f.rating])).rows[0].n).toBe(1);
    expect((await client.query('SELECT 1 FROM everrate.discord_outbox WHERE group_id=$1',[f.group])).rowCount).toBe(0);
    expect(await applyRatingCorrections(client,f.plan,{apply:true})).toMatchObject({alreadyApplied:true});
    await expect(applyRatingCorrections(client,{...f.plan,evidence:'Changed'}, {apply:true})).rejects.toThrow();
    expect(ratingCorrectionPlanSha256(f.plan)).toMatch(/^[0-9a-f]{64}$/);
  });
  async function refresh(f:Awaited<ReturnType<typeof fixture>>){
    const snap=await captureRatingCorrectionSnapshots(client,{groupId:f.group,userIds:f.plan.users.map(x=>x.id),itemIds:f.plan.items.map(x=>x.id),ratingIds:f.plan.corrections.map(x=>x.ratingId),photoIds:f.plan.photos.map(x=>x.id),sourceIds:f.plan.sources.map(x=>x.id),attachmentIds:f.plan.attachments.map(x=>x.id)});
    f.plan.group.expectedSha256=snap.group.sha256;
    for(const key of ['users','memberships','items','sources','attachments'] as const)for(const guard of f.plan[key])guard.expectedSha256=snap[key].find(x=>x.id===guard.id)!.sha256;
    for(const op of f.plan.corrections)op.expectedSha256=snap.ratings.find(x=>x.id===op.ratingId)!.sha256;
    return snap;
  }
  async function immutableHistory(f:Awaited<ReturnType<typeof fixture>>){
    const result:Record<string,unknown>={};
    for(const table of ['archive_messages','archive_attachments','archive_files','archive_blobs','rating_revisions','comments','legacy_import_links']){
      const rows=await client.query(`SELECT to_jsonb(t) row FROM everrate.${table} t ORDER BY to_jsonb(t)::text`);result[table]=rows.rows;
    }
    return result;
  }
  it('keeps all existing archives, comments, revisions and legacy links byte-for-byte unchanged',async()=>{
    const f=await fixture(),before=await immutableHistory(f);
    await applyRatingCorrections(client,f.plan,{apply:true});
    const after=await immutableHistory(f),links=after.legacy_import_links as {row:{target_id:string}}[];
    after.legacy_import_links=links.filter(x=>x.row.target_id!==f.plan.additions[0].ratingId);
    expect(after).toEqual(before);
    const audits=await client.query('SELECT actor_id,details FROM everrate.audit_events WHERE group_id=$1',[f.group]);
    expect(audits.rows.every(x=>x.actor_id===null&&x.details.planSha256===ratingCorrectionPlanSha256(f.plan))).toBe(true);
  });
  it.each(['score','note','source-json','membership','user','item'])('rejects changed %s reviewed evidence with no partial writes',async(kind)=>{
    const f=await fixture();
    if(kind==='score')await client.query('UPDATE everrate.ratings SET score=8 WHERE id=$1',[f.rating]);
    if(kind==='note')await client.query("UPDATE everrate.ratings SET note='Edited after review' WHERE id=$1",[f.rating]);
    if(kind==='source-json')await client.query("UPDATE everrate.archive_messages SET raw_record=jsonb_build_object('changed',true) WHERE id=$1",[f.message]);
    if(kind==='membership')await client.query("UPDATE everrate.memberships SET joined_at=joined_at+interval '1 microsecond' WHERE group_id=$1 AND user_id=$2",[f.group,f.friend]);
    if(kind==='user')await client.query("UPDATE everrate.users SET display_name='Changed' WHERE id=$1",[f.friend]);
    if(kind==='item')await client.query("UPDATE everrate.items SET name='Changed' WHERE id=$1",[f.item]);
    await expect(applyRatingCorrections(client,f.plan,{apply:true})).rejects.toThrow(/changed/);
    expect((await client.query('SELECT 1 FROM everrate.photos WHERE id=$1',[f.photo])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM everrate.audit_events WHERE group_id=$1',[f.group])).rowCount).toBe(0);
  });
  it('guards original and normalized photo bytes separately from stored hashes',async()=>{
    const f=await fixture();f.plan.photoImports[0].expectedPhotoSha256='a'.repeat(64);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('Normalized photo');
    f.plan.photoImports[0].expectedPhotoSha256=(await normalizeArchivedPhoto((await client.query('SELECT data FROM everrate.archive_blobs WHERE sha256=$1',[f.blobHash])).rows[0].data)).sha256;
    await client.query("UPDATE everrate.archive_blobs SET data=set_byte(data,0,0) WHERE sha256=$1",[f.blobHash]);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('actual digest');
  });
  it('rejects source mismatch and accepts numeric legacy source parts',async()=>{
    const f=await fixture();await client.query('UPDATE everrate.ratings SET source_message_id=$2 WHERE id=$1',[f.rating,f.messageId+'#0']);await refresh(f);
    expect(await applyRatingCorrections(client,f.plan)).toMatchObject({applied:false});
    await client.query("UPDATE everrate.ratings SET source_message_id='unrelated-message#0' WHERE id=$1",[f.rating]);await refresh(f);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('source does not match');
  });
  it('rejects a duplicate reviewer created by a correction or missing-rating addition, including legacy #parts',async()=>{
    const f=await fixture();await client.query("INSERT INTO everrate.ratings(group_id,item_id,user_id,score,source,source_message_id,legacy_photo_missing) VALUES($1,$2,$3,9,'import',$4,true)",[f.group,f.otherItem,f.friend,f.messageId+'#1']);await refresh(f);
    f.plan.additions=[];
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('duplicate reviewer/item');
    f.plan.corrections[0].set.userId=f.user;f.plan.additions=[{ratingId:randomUUID(),sourceId:f.message,sourcePartKey:'duplicate-friend',evidence:'Explicit but duplicate',userId:f.friend,itemId:f.otherItem,score:9,note:null,tastedAt:'2026-06-26T12:34:56.123456Z',createdAt:'2026-06-26T12:34:56.123456Z',photoId:f.photo}];
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('duplicate reviewer/item');
  });
  it('source snapshots detect a new legacy #part even when its item was not in the plan',async()=>{
    const f=await fixture(),unreviewed=randomUUID();await client.query("INSERT INTO everrate.items(id,group_id,name,identity_key,created_by) VALUES($1,$2,'Elsewhere','elsewhere',$3)",[unreviewed,f.group,f.user]);
    await client.query("INSERT INTO everrate.ratings(group_id,item_id,user_id,score,source,source_message_id,legacy_photo_missing) VALUES($1,$2,$3,6,'import',$4,true)",[f.group,unreviewed,f.user,f.messageId+'#1']);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('sources snapshot changed');
  });
  it('creates an explicit new product and its cover, but rejects an existing identity with a stale identity_key',async()=>{
    const f=await fixture(),itemId=randomUUID();
    f.plan.newItems=[{itemId,name:'The Most Stuf',brand:'Oreo',variant:null,type:'Cookie',broadCategory:'Snacks',createdBy:f.user,coverPhotoId:f.photo,evidence:'Package title and manufacturer reviewed.'}];
    f.plan.corrections[0].set.itemId=itemId;f.plan.additions[0].itemId=itemId;
    expect(await applyRatingCorrections(client,f.plan)).toMatchObject({newItems:1});
    await applyRatingCorrections(client,f.plan,{apply:true});
    const result=await client.query('SELECT i.*,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=$1',[itemId]);
    expect(result.rows[0]).toMatchObject({name:'The Most Stuf',brand:'Oreo',type:'Cookie',legacy_photo_id:f.photo,created_by:f.user,group_id:f.group});
    const g=await fixture();g.plan.newItems=[{...f.plan.newItems[0],itemId:randomUUID(),name:'  Wrong grouping  '.trim(),brand:null,type:null,createdBy:g.user,coverPhotoId:g.photo}];
    await expect(applyRatingCorrections(client,g.plan)).rejects.toThrow('identity already exists');
  });
  it('requires documented no-photo exceptions and an exact source timestamp',async()=>{
    const f=await fixture();f.plan.photoImports=[];f.plan.corrections[0].set.photoId=null;f.plan.additions[0].photoId=null;
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('missing photo');
    f.plan.additions[0].photoException='Original message and adjacent archive contain no photo.';f.plan.corrections[0].photoException='Original imported event has no available photo.';
    expect(await applyRatingCorrections(client,f.plan)).toMatchObject({photos:0});
    f.plan.additions[0].createdAt='2026-06-26T12:34:56.123455Z';
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('creation time');
  });
  it('refuses to take ownership of an existing transaction even when notices are suppressed',async()=>{
    const f=await fixture();await client.query("BEGIN; SET LOCAL client_min_messages='error'");
    await expect(applyRatingCorrections(client,f.plan,{apply:true})).rejects.toThrow('dedicated idle');
    await client.query("UPDATE everrate.ratings SET note='caller-owned' WHERE id=$1",[f.rating]);await client.query('ROLLBACK');
    expect((await client.query('SELECT note FROM everrate.ratings WHERE id=$1',[f.rating])).rows[0].note).toBe('Original note');
  });
  it('serializes simultaneous retries into exactly one application',async()=>{
    const f=await fixture(),second=await pool.connect();
    try{const results=await Promise.all([applyRatingCorrections(client,f.plan,{apply:true}),applyRatingCorrections(second,f.plan,{apply:true})]);expect(results.filter(x=>x.applied)).toHaveLength(1);expect(results.filter(x=>x.alreadyApplied)).toHaveLength(1);}finally{second.release();}
  });
  it('rolls back photos, products, corrections, additions, links and audits on a late failure',async()=>{
    const f=await fixture(),itemId=randomUUID();f.plan.newItems=[{itemId,name:'New Product',brand:'New Brand',variant:null,type:null,broadCategory:null,createdBy:f.user,coverPhotoId:f.photo,evidence:'Reviewed photo'}];f.plan.additions[0].itemId=itemId;
    await client.query(`CREATE FUNCTION everrate.reject_rating_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='rating-correction.plan' THEN RAISE EXCEPTION 'fixture final failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_rating_plan BEFORE INSERT ON everrate.audit_events FOR EACH ROW EXECUTE FUNCTION everrate.reject_rating_plan()`);
    try{await expect(applyRatingCorrections(client,f.plan,{apply:true})).rejects.toThrow('fixture final failure');}finally{await client.query('DROP TRIGGER reject_rating_plan ON everrate.audit_events; DROP FUNCTION everrate.reject_rating_plan()');}
    expect((await client.query('SELECT 1 FROM everrate.photos WHERE id=$1',[f.photo])).rowCount).toBe(0);expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[itemId])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM everrate.ratings WHERE id=$1',[f.plan.additions[0].ratingId])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM everrate.audit_events WHERE group_id=$1',[f.group])).rowCount).toBe(0);
    expect((await client.query('SELECT user_id,score FROM everrate.ratings WHERE id=$1',[f.rating])).rows[0]).toEqual({user_id:f.user,score:'5.00'});
    expect((await client.query('SELECT 1 FROM everrate.legacy_import_links WHERE target_id=$1',[f.plan.additions[0].ratingId])).rowCount).toBe(0);
  });

  it('rejects cross-group destinations, missing reviewers and mismatched photo-source attachments',async()=>{
    const f=await fixture(),g=await fixture();
    f.plan.items.push({id:g.otherItem,expectedSha256:g.snapshots.items.find(x=>x.id===g.otherItem)!.sha256});f.plan.corrections[0].set.itemId=g.otherItem;
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('another group');
    f.plan.items.pop();f.plan.corrections[0].set.itemId=f.otherItem;
    const original=f.plan.photoImports[0].attachmentId;f.plan.attachments.push(...g.plan.attachments);f.plan.photoImports[0].attachmentId=g.attachment;
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('attachment does not match');
    f.plan.photoImports[0].attachmentId=original;f.plan.attachments.pop();
    await client.query('DELETE FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[f.group,f.friend]);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('member is missing');
  });
  it('rejects active announcements before changing a historical event',async()=>{
    const f=await fixture();await client.query("INSERT INTO everrate.discord_outbox(group_id,rating_id,payload,status) VALUES($1,$2,'{}','processing')",[f.group,f.rating]);
    await expect(applyRatingCorrections(client,f.plan,{apply:true})).rejects.toThrow('active announcement');
    expect((await client.query('SELECT status FROM everrate.discord_outbox WHERE rating_id=$1',[f.rating])).rows[0].status).toBe('processing');
  });
  it('dry-run rejects a photo import whose reviewed source lacks a date',async()=>{
    const f=await fixture();f.plan.additions=[];await client.query('UPDATE everrate.archive_messages SET sent_at=NULL WHERE id=$1',[f.message]);await refresh(f);
    await expect(applyRatingCorrections(client,f.plan)).rejects.toThrow('original message time');
  });
  it.each(['correction','addition','photo','item'])('checks exact %s write results and rolls back trigger changes',async(kind)=>{
    const f=await fixture(),itemId=randomUUID();
    f.plan.newItems=[{itemId,name:'Reviewed Product',brand:null,variant:null,type:null,broadCategory:null,createdBy:f.user,coverPhotoId:f.photo,evidence:'Exact reviewed package.'}];f.plan.additions[0].itemId=itemId;
    const table=kind==='photo'?'photos':kind==='item'?'items':'ratings';
    const event=kind==='correction'?'UPDATE':'INSERT';
    const change=kind==='photo'?'NEW.width:=1':kind==='item'?"NEW.name:='Wrong product'":'NEW.score:=1';
    await client.query(`CREATE FUNCTION everrate.change_reviewed_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${change}; RETURN NEW; END $$; CREATE TRIGGER change_reviewed_result BEFORE ${event} ON everrate.${table} FOR EACH ROW EXECUTE FUNCTION everrate.change_reviewed_result()`);
    try{await expect(applyRatingCorrections(client,f.plan,{apply:true})).rejects.toThrow(/differs/);}finally{await client.query(`DROP TRIGGER change_reviewed_result ON everrate.${table}; DROP FUNCTION everrate.change_reviewed_result()`);}
    expect((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[itemId])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM everrate.photos WHERE id=$1',[f.photo])).rowCount).toBe(0);
    expect((await client.query('SELECT score FROM everrate.ratings WHERE id=$1',[f.rating])).rows[0].score).toBe('5.00');
  });

});
