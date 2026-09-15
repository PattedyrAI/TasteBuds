import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import sharp from 'sharp';
import { assertBackfillTarget, applyBackfillPlan } from '../scripts/backfill-legacy';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('backfill target boundary',()=>{
  it('refuses remote databases and libpq host overrides',()=>{
    expect(()=>assertBackfillTarget('postgresql://user@remote.example/everrate_test')).toThrow();
    expect(()=>assertBackfillTarget('postgresql://user@localhost/everrate_test?host=remote.example')).toThrow();
    expect(()=>assertBackfillTarget('postgresql://user@localhost/other')).toThrow();
    expect(()=>assertBackfillTarget('postgresql://user@127.0.0.1/everrate_test')).not.toThrow();
  });
});
const url=process.env.BACKFILL_TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Use a disposable local test database.');
describe.skipIf(!url)('transactional photo and metadata backfill',()=>{
  const id={user:randomUUID(),group:randomUUID(),item:randomUUID(),rating:randomUUID(),source:randomUUID(),file:randomUUID(),oldFile:randomUUID(),revision:randomUUID()};
  let db:Client,plan:any,before:any;
  beforeAll(async()=>{
    db=new Client({connectionString:url});await db.connect();
    const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#123456'}}).png().toBuffer();
    const sha=createHash('sha256').update(bytes).digest('hex');
    await db.query("INSERT INTO everrate.users(id,display_name) VALUES($1,'Backfill test')",[id.user]);
    await db.query("INSERT INTO everrate.groups(id,name,owner_id,invite_code) VALUES($1,'Backfill test',$2,$3)",[id.group,id.user,randomUUID()]);
    await db.query("INSERT INTO everrate.items(id,group_id,name,identity_key,created_by,legacy_metadata) VALUES($1,$2,'Ghost Energy Test','test',$3,$4)",[id.item,id.group,id.user,JSON.stringify({id:id.item})]);
    await db.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,source,source_message_id,legacy_photo_missing,legacy_metadata) VALUES($1,$2,$3,$4,7,'Preserve this note','2024-01-02T12:00:00Z','import','backfill-test',true,$5)",[id.rating,id.group,id.item,id.user,JSON.stringify({id:id.rating})]);
    await db.query("INSERT INTO everrate.import_sources(id,source_key,source_type) VALUES($1,$2,'test')",[id.source,randomUUID()]);
    await db.query('INSERT INTO everrate.archive_blobs(sha256,byte_size,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[sha,bytes.length,bytes]);
    await db.query("INSERT INTO everrate.archive_files(id,source_id,relative_path,sha256,byte_size,blob_sha256) VALUES($1,$2,'attachments/test.png',$3,$4,$3)",[id.file,id.source,sha,bytes.length]);
    before=(await db.query('SELECT score,note,tasted_at,created_at,updated_at FROM everrate.ratings WHERE id=$1',[id.rating])).rows[0];
    await db.query("UPDATE everrate.ratings SET legacy_metadata=jsonb_set(legacy_metadata,'{updated_at}',$2::jsonb) WHERE id=$1",[id.rating,JSON.stringify(before.updated_at.toISOString())]);
    plan={version:1,sourceFiles:[],candidateEvents:[],itemSuggestions:[{itemId:id.item,groupId:id.group,expectedNameSha256:hash('Ghost Energy Test'),patch:{brand:'Ghost',type:'Energy drinks'},evidence:[]}],photoSuggestions:[{ratingId:id.rating,groupId:id.group,userId:id.user,itemId:id.item,sourceKey:'backfill-test',archiveFileId:id.file,originalSha256:sha,relativeImage:'attachments/test.png',expectedNameSha256:hash('Ghost Energy Test')}]};
    const oldBytes=await sharp({create:{width:4,height:3,channels:3,background:'#654321'}}).png().toBuffer(),oldSha=createHash('sha256').update(oldBytes).digest('hex');
    await db.query('INSERT INTO everrate.archive_blobs(sha256,byte_size,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[oldSha,oldBytes.length,oldBytes]);
    await db.query("INSERT INTO everrate.archive_files(id,source_id,relative_path,sha256,byte_size,blob_sha256) VALUES($1,$2,'attachments/old.png',$3,$4,$3)",[id.oldFile,id.source,oldSha,oldBytes.length]);
    const proposal={discordMessageId:'old-backfill-test',authorId:id.user,itemName:'Ghost Energy Test',createdAt:'2024-01-01T12:00:00Z',score:6,comment:'Historical note'},previous={previous_score:6,previous_comment:'Historical note',previous_photo_url:null};
    await db.query("INSERT INTO everrate.archive_proposals(source_id,source_file,record_key,sha256,raw_record,disposition) VALUES($1,'import-ready.json',$2,$3,$4,'archived_unresolved')",[id.source,proposal.discordMessageId,hash(proposal),JSON.stringify(proposal)]);
    await db.query('INSERT INTO everrate.legacy_aliases(discord_id,user_id,source_id,evidence) VALUES($1,$2,$3,\'test\')',[id.user,id.user,id.source]);
    await db.query("INSERT INTO everrate.rating_revisions(id,rating_id,action,previous_value) VALUES($1,$2,'update',$3)",[id.revision,id.rating,JSON.stringify(previous)]);
    plan.candidateEvents=[{sourceKey:proposal.discordMessageId,sourceProposalSha256:hash(proposal),classification:'distinct_prior_message_with_unique_snapshot_target',targetItemId:id.item,targetUserId:id.user,relatedCurrentRatingId:id.rating,supportingRevisionHashes:[{id:id.revision,sha256:hash(previous)}],sourceCreatedAt:proposal.createdAt,score:6,calendarDayDifferent:true,photoComparison:'distinct',strongerReviewCandidate:true,priorPhoto:{archiveFileId:id.oldFile,relativeImage:'attachments/old.png',originalSha256:oldSha},priorPhotoHashes:[oldSha],currentPhotoHashes:[sha]}];
  });
  afterAll(async()=>{await db?.end();});
  it('rolls the whole transaction back when original bytes do not match the plan',async()=>{
    const invalid=structuredClone(plan);invalid.photoSuggestions[0].originalSha256='0'.repeat(64);
    await expect(applyBackfillPlan(url!,invalid)).rejects.toThrow();
    expect((await db.query('SELECT brand_id,type_id FROM everrate.items WHERE id=$1',[id.item])).rows[0]).toEqual({brand_id:null,type_id:null});
  });
  it('preserves rating identity, notes, scores and dates; creates no announcements; and is idempotent',async()=>{
    const result=await applyBackfillPlan(url!,plan);expect(result).toMatchObject({itemsUpdated:1,photosAttached:1});
    const rating=(await db.query('SELECT id,score,note,tasted_at,created_at,updated_at,photo_id,legacy_photo_missing FROM everrate.ratings WHERE id=$1',[id.rating])).rows[0];
    expect(rating).toMatchObject({...before,id:id.rating,legacy_photo_missing:false});expect(rating.photo_id).toBeTruthy();
    expect((await db.query('SELECT count(*)::int n FROM everrate.discord_outbox WHERE group_id=$1',[id.group])).rows[0].n).toBe(0);
    expect(await applyBackfillPlan(url!,plan)).toMatchObject({itemsUpdated:0,photosAttached:0});
    expect((await db.query("SELECT count(*)::int n FROM everrate.audit_events WHERE group_id=$1 AND action LIKE 'legacy.backfill.%'",[id.group])).rows[0].n).toBe(2);
  });
  it('preserves an explicit user item edit and rejects mismatched ownership',async()=>{
    await db.query("UPDATE everrate.items SET brand_id=NULL,type_id=NULL WHERE id=$1",[id.item]);
    await db.query("INSERT INTO everrate.audit_events(group_id,actor_id,action,resource_id) VALUES($1,$2,'item.update',$3)",[id.group,id.user,id.item]);
    const changed=structuredClone(plan);changed.photoSuggestions[0].userId=randomUUID();
    expect(await applyBackfillPlan(url!,changed)).toMatchObject({itemsUpdated:0,photosAttached:0});
    expect((await db.query('SELECT brand_id,type_id FROM everrate.items WHERE id=$1',[id.item])).rows[0]).toEqual({brand_id:null,type_id:null});
  });
  it('promotes only an explicitly reviewed distinct-day/photo source event once while retaining the latest score',async()=>{
    const result=await applyBackfillPlan(url!,plan,{promoteStrongEvents:true});expect(result.eventsPromoted).toBe(1);
    const rows=(await db.query('SELECT source_message_id,score,note,tasted_at FROM everrate.ratings WHERE item_id=$1 ORDER BY tasted_at DESC',[id.item])).rows;
    expect(rows).toHaveLength(2);expect(Number(rows[0].score)).toBe(7);expect(rows[1]).toMatchObject({source_message_id:'old-backfill-test',note:'Historical note',tasted_at:new Date('2024-01-01T12:00:00Z')});
    expect(Number(rows[1].score)).toBe(6);
    expect((await applyBackfillPlan(url!,plan,{promoteStrongEvents:true})).eventsPromoted).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM everrate.discord_outbox WHERE group_id=$1',[id.group])).rows[0].n).toBe(0);
  });
});
