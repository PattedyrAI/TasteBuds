/** Explicit reviewed historical attribution repairs. Never infer a reviewer or announce an import. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import sharp from 'sharp';
import {z} from 'zod';
import {identityKey} from '../src/domain/ratings';
import {assertLocalTarget} from './import-legacy';
import {captureIdentitySnapshots,identitySnapshotSha256} from './apply-identity-corrections';
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),evidence=z.string().min(1).max(12000).refine(s=>s.trim().length>0);
const guard=z.object({id:uuid,expectedSha256:sha}).strict();
const score=z.number().min(1).max(10).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-8);
const date=z.iso.datetime({offset:true});
const correction=z.object({ratingId:uuid,expectedSha256:sha,sourceId:uuid,evidence,set:z.object({userId:uuid.optional(),score:score.optional(),itemId:uuid.optional(),photoId:uuid.nullable().optional()}).strict().refine(s=>Object.keys(s).length>0),photoException:evidence.optional()}).strict();
const addition=z.object({ratingId:uuid,sourceId:uuid,sourcePartKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),evidence,userId:uuid,itemId:uuid,score,note:z.string().max(5000).nullable(),tastedAt:date,createdAt:date,photoId:uuid.nullable(),photoException:evidence.optional()}).strict();
const photoImport=z.object({photoId:uuid,attachmentId:uuid,sourceId:uuid,ownerId:uuid,expectedOriginalSha256:sha,expectedPhotoSha256:sha,width:z.number().int().min(1).max(1600),height:z.number().int().min(1).max(1600),mimeType:z.literal('image/jpeg'),evidence}).strict();
const label=z.string().min(1).max(200).refine(s=>s===s.trim());
const newItem=z.object({itemId:uuid,name:label,brand:label.nullable(),variant:label.nullable(),type:label.nullable(),broadCategory:label.nullable(),createdBy:uuid,coverPhotoId:uuid.nullable(),evidence}).strict();
const schema=z.object({version:z.literal(1),planId:uuid,group:guard,evidence,users:z.array(guard).max(1000),memberships:z.array(guard).max(1000),items:z.array(guard).max(1000),sources:z.array(guard.extend({expectedSourceSha256:sha}).strict()).max(1000),attachments:z.array(guard).max(1000),photos:z.array(guard).max(1000),photoImports:z.array(photoImport).max(100),newItems:z.array(newItem).max(1000).default([]),corrections:z.array(correction).max(1000),additions:z.array(addition).max(1000)}).strict();
export type RatingCorrectionPlan=z.infer<typeof schema>;
type Row=Record<string,any>;
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const sorted=(values:string[])=>[...new Set(values)].sort();
const utc=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ratingJson=`to_jsonb(r)||jsonb_build_object('tasted_at',${utc('r.tasted_at')},'created_at',${utc('r.created_at')},'updated_at',${utc('r.updated_at')},'deleted_at',${utc('r.deleted_at')})`;
function fail(message:string):never{throw new Error(message);}
const snapshot=(id:string,row:Row)=>({id,sha256:identitySnapshotSha256(row),snapshot:row});
function parsePlan(input:unknown){
  const parsed=schema.safeParse(input);if(!parsed.success)fail('Invalid reviewed rating plan.');const plan=parsed.data;
  if(!plan.corrections.length&&!plan.additions.length)fail('Plan has no rating corrections.');
  for(const values of [plan.users.map(x=>x.id),plan.memberships.map(x=>x.id),plan.items.map(x=>x.id),plan.sources.map(x=>x.id),plan.attachments.map(x=>x.id),plan.photos.map(x=>x.id),plan.photoImports.map(x=>x.photoId),[...plan.items.map(x=>x.id),...plan.newItems.map(x=>x.itemId)],[...plan.corrections,...plan.additions].map(x=>x.ratingId),plan.additions.map(x=>x.sourceId+':'+x.sourcePartKey)])if(new Set(values).size!==values.length)fail('Duplicate guard, source part, or target ID.');
  const has=(rows:{id:string}[],id:string)=>rows.some(row=>row.id===id);
  const user=(id:string)=>{if(!has(plan.users,id)||!has(plan.memberships,id))fail('Every referenced user needs user and membership guards.');};
  const photo=(id:string|null|undefined)=>{if(id&&!has(plan.photos,id)&&!plan.photoImports.some(row=>row.photoId===id))fail('Every referenced photo needs reviewed evidence.');};
  for(const op of [...plan.corrections,...plan.additions])if(!has(plan.sources,op.sourceId))fail('Every rating operation needs an exact source-message guard.');
  for(const op of plan.corrections){if(op.set.userId)user(op.set.userId);if(op.set.itemId&&!has(plan.items,op.set.itemId)&&!plan.newItems.some(x=>x.itemId===op.set.itemId))fail('Destination item needs a guard.');photo(op.set.photoId);}
  for(const op of plan.additions){user(op.userId);if(!has(plan.items,op.itemId)&&!plan.newItems.some(x=>x.itemId===op.itemId))fail('New rating item needs a guard.');photo(op.photoId);if(!op.photoId&&!op.photoException)fail('Historical missing photo needs source constraints.');}
  for(const op of plan.photoImports){user(op.ownerId);if(has(plan.photos,op.photoId)||!has(plan.attachments,op.attachmentId)||!has(plan.sources,op.sourceId))fail('New photo needs new UUID and guarded source attachment/message.');}
  for(const item of plan.newItems){user(item.createdBy);photo(item.coverPhotoId);}
  const keys=plan.newItems.map(x=>identityKey(x.name,x.brand,x.variant));if(new Set(keys).size!==keys.length)fail('New items duplicate a reviewed identity.');
  return plan;
}
export function ratingCorrectionPlanSha256(input:unknown){return identitySnapshotSha256(parsePlan(input));}
export async function normalizeArchivedPhoto(input:Buffer){
  if(!input.length||input.length>10*1024*1024)fail('Archived source photo must fit current10MiB input limit.');
  try{
    const result=await sharp(input,{limitInputPixels:40_000_000,failOn:'error'}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
    if(result.data.length>10*1024*1024)fail('Normalized photo exceeds storage limit.');
    return {data:result.data,sha256:hash(result.data),width:result.info.width,height:result.info.height,mimeType:'image/jpeg' as const};
  }catch{fail('Archived photo could not be normalized within current limits.');}
}
/** SELECT-only; use a separate REPEATABLE READ READ ONLY transaction for a planning baseline. */
export async function captureRatingCorrectionSnapshots(client:PoolClient,input:{groupId:string;userIds?:string[];itemIds?:string[];ratingIds?:string[];photoIds?:string[];sourceIds?:string[];attachmentIds?:string[]}){
  const ids=z.object({groupId:uuid,userIds:z.array(uuid).max(1000).default([]),itemIds:z.array(uuid).max(1000).default([]),ratingIds:z.array(uuid).max(1000).default([]),photoIds:z.array(uuid).max(1000).default([]),sourceIds:z.array(uuid).max(1000).default([]),attachmentIds:z.array(uuid).max(1000).default([])}).strict().parse(input);
  const identity=await captureIdentitySnapshots(client,{itemIds:ids.itemIds,ratingIds:ids.ratingIds,photoIds:ids.photoIds});
  const groupRows=await client.query(`SELECT to_jsonb(g)||jsonb_build_object('created_at',${utc('g.created_at')}) row FROM everrate.groups g WHERE id=$1`,[ids.groupId]);if(!groupRows.rowCount)fail('Group is missing.');
  const users=await client.query(`SELECT id,to_jsonb(u)||jsonb_build_object('created_at',${utc('u.created_at')}) row FROM everrate.users u WHERE id=ANY($1::uuid[]) ORDER BY id`,[sorted(ids.userIds)]);
  const memberships=await client.query(`SELECT user_id id,to_jsonb(m)||jsonb_build_object('joined_at',${utc('m.joined_at')}) row FROM everrate.memberships m WHERE group_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id`,[ids.groupId,sorted(ids.userIds)]);
  if(users.rowCount!==sorted(ids.userIds).length||memberships.rowCount!==sorted(ids.userIds).length)fail('Guarded group member is missing.');
  const sources:{id:string;sha256:string;snapshot:{row:Row;linkedRatingsSha256:string}}[]=[];
  for(const id of sorted(ids.sourceIds)){
    const result=await client.query(`SELECT to_jsonb(m)||jsonb_build_object('sent_at',${utc('m.sent_at')}) row FROM everrate.archive_messages m WHERE id=$1`,[id]);if(!result.rowCount)fail('Source message missing.');const row=result.rows[0].row;
    const linked=await client.query(`SELECT ${ratingJson} row FROM everrate.ratings r WHERE group_id=$1 AND (source_message_id=$2 OR starts_with(source_message_id,$2||'#') OR starts_with(source_message_id,$3)) ORDER BY id`,[ids.groupId,row.message_id,'reviewed:'+row.message_id+':']);
    const value={row,linkedRatingsSha256:identitySnapshotSha256(linked.rows.map(x=>x.row))};sources.push({id,sha256:identitySnapshotSha256(value),snapshot:value});
  }
  const attachments:{id:string;sha256:string;snapshot:Row}[]=[];
  for(const id of sorted(ids.attachmentIds)){
    const found=await client.query(`SELECT to_jsonb(a) attachment,to_jsonb(f)||jsonb_build_object('created_at',${utc('f.created_at')}) file,jsonb_build_object('sha256',b.sha256,'byte_size',b.byte_size,'created_at',${utc('b.created_at')}) blob FROM everrate.archive_attachments a JOIN everrate.archive_files f ON f.id=a.archive_file_id JOIN everrate.archive_blobs b ON b.sha256=f.blob_sha256 WHERE a.id=$1`,[id]);
    if(!found.rowCount)fail('Archived attachment/file/blob linkage missing.');attachments.push(snapshot(id,found.rows[0]));
  }
  return {...identity,group:snapshot(ids.groupId,groupRows.rows[0].row),users:users.rows.map(x=>snapshot(x.id,x.row)),memberships:memberships.rows.map(x=>snapshot(x.id,x.row)),sources,attachments};
}
async function lockPlan(client:PoolClient,plan:RatingCorrectionPlan){
  await client.query('SELECT id FROM everrate.groups WHERE id=$1 FOR UPDATE',[plan.group.id]);
  await client.query('SELECT id FROM everrate.items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[sorted(plan.items.map(x=>x.id))]);
  await client.query('SELECT id FROM everrate.archive_messages WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[sorted(plan.sources.map(x=>x.id))]);
  await client.query(`SELECT id FROM everrate.ratings WHERE id=ANY($1::uuid[]) OR item_id=ANY($2::uuid[]) OR (group_id=$3 AND EXISTS(SELECT 1 FROM everrate.archive_messages m WHERE m.id=ANY($4::uuid[]) AND (source_message_id=m.message_id OR starts_with(source_message_id,m.message_id||'#') OR starts_with(source_message_id,'reviewed:'||m.message_id||':')))) ORDER BY id FOR NO KEY UPDATE`,[plan.corrections.map(x=>x.ratingId),plan.items.map(x=>x.id),plan.group.id,plan.sources.map(x=>x.id)]);
  await client.query('SELECT id FROM everrate.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[sorted(plan.users.map(x=>x.id))]);
  await client.query('SELECT user_id FROM everrate.memberships WHERE group_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY user_id FOR SHARE',[plan.group.id,sorted(plan.memberships.map(x=>x.id))]);
  await client.query('SELECT id FROM everrate.photos WHERE id=ANY($1::uuid[]) OR id IN (SELECT photo_id FROM everrate.ratings WHERE item_id=ANY($2::uuid[])) ORDER BY id FOR SHARE',[plan.photos.map(x=>x.id),plan.items.map(x=>x.id)]);
  for(const [table,query] of [['archive_attachments','id=ANY($1::uuid[])'],['archive_files','id IN (SELECT archive_file_id FROM everrate.archive_attachments WHERE id=ANY($1::uuid[]))'],['archive_blobs','sha256 IN (SELECT blob_sha256 FROM everrate.archive_files WHERE id IN (SELECT archive_file_id FROM everrate.archive_attachments WHERE id=ANY($1::uuid[])))']] as const)await client.query(`SELECT ${table==='archive_blobs'?'sha256':'id'} FROM everrate.${table} WHERE ${query} ORDER BY 1 FOR SHARE`,[plan.attachments.map(x=>x.id)]);
  // Labels are part of item snapshots; stabilize them before the fresh snapshot read.
  for(const [table,column] of [['brands','brand_id'],['item_types','type_id']] as const)await client.query(`SELECT id FROM everrate.${table} WHERE id IN (SELECT ${column} FROM everrate.items WHERE id=ANY($1::uuid[])) ORDER BY id FOR SHARE`,[plan.items.map(x=>x.id)]);
}
function verifyGuards(plan:RatingCorrectionPlan,before:Awaited<ReturnType<typeof captureRatingCorrectionSnapshots>>){
  if(before.group.sha256!==plan.group.expectedSha256)fail('Group snapshot changed.');
  for(const key of ['users','memberships','items','sources','attachments'] as const){const actual=new Map(before[key].map(x=>[x.id,x]));for(const expected of plan[key])if(actual.get(expected.id)?.sha256!==expected.expectedSha256)fail('Reviewed '+key+' snapshot changed.');}
  for(const item of before.items)if(item.snapshot.row.group_id!==plan.group.id)fail('Item belongs to another group.');
  for(const photo of plan.photos){const actual=before.photos.find(x=>x.id===photo.id);if(!actual||actual.groupId!==plan.group.id||actual.sha256!==photo.expectedSha256||actual.storedSha256!==photo.expectedSha256)fail('Photo group, stored hash, or bytes changed.');}
  for(const source of plan.sources)if(before.sources.find(x=>x.id===source.id)!.snapshot.row.sha256!==source.expectedSourceSha256)fail('Original source-message digest changed.');
  for(const op of plan.corrections){
    const old=before.ratings.find(x=>x.id===op.ratingId);if(!old||old.sha256!==op.expectedSha256||old.snapshot.group_id!==plan.group.id)fail('Rating snapshot or group changed.');
    if(!plan.items.some(x=>x.id===old.snapshot.item_id)||!plan.users.some(x=>x.id===old.snapshot.user_id)||!plan.memberships.some(x=>x.id===old.snapshot.user_id))fail('Original item and reviewer need guards.');
    if(old.photoId&&!plan.photos.some(x=>x.id===old.photoId))fail('Original rating photo needs an actual-byte guard.');
    const messageId=before.sources.find(x=>x.id===op.sourceId)!.snapshot.row.message_id,key=old.snapshot.source_message_id;
    if(typeof key!=='string'||!(key===messageId||key.startsWith(messageId+'#')||key.startsWith('reviewed:'+messageId+':')))fail('Correction source does not match original rating source linkage.');
    const resultingPhoto=op.set.photoId===undefined?old.photoId:op.set.photoId;
    if(!resultingPhoto&&(!op.photoException||!['import','discord'].includes(old.snapshot.source)))fail('Historical no-photo correction needs explicit source constraints.');
    if(old.snapshot.deleted_at)fail('Deleted ratings require a separate restoration review.');
  }
}
async function preparePhotoImports(client:PoolClient,plan:RatingCorrectionPlan,before:Awaited<ReturnType<typeof captureRatingCorrectionSnapshots>>){
  const prepared:Map<string,Awaited<ReturnType<typeof normalizeArchivedPhoto>>>=new Map();
  for(const op of plan.photoImports){
    const attachment=before.attachments.find(x=>x.id===op.attachmentId)!.snapshot,message=before.sources.find(x=>x.id===op.sourceId)!.snapshot.row;
    if(!message.sent_at)fail('Archived photo source needs its original message time.');
    if(attachment.attachment.source_id!==message.source_id||attachment.file.source_id!==message.source_id||attachment.attachment.message_id!==message.message_id||attachment.file.sha256!==op.expectedOriginalSha256||attachment.blob.sha256!==op.expectedOriginalSha256)fail('Photo attachment does not match reviewed source message/blob.');
    const found=await client.query('SELECT data FROM everrate.archive_blobs WHERE sha256=$1 AND octet_length(data)<=10485760',[op.expectedOriginalSha256]);
    if(!found.rowCount)fail('Original archive photo unavailable or exceeds current input limit.');const bytes:Buffer=found.rows[0].data;
    if(hash(bytes)!==op.expectedOriginalSha256||bytes.length!==Number(attachment.blob.byte_size)||bytes.length!==Number(attachment.file.byte_size))fail('Original archive photo actual digest or size changed.');
    const result=await normalizeArchivedPhoto(bytes);if(result.sha256!==op.expectedPhotoSha256||result.width!==op.width||result.height!==op.height||result.mimeType!==op.mimeType)fail('Normalized photo differs from reviewed output.');prepared.set(op.photoId,result);
  }
  return prepared;
}
/** Dedicated idle PoolClient; this function owns BEGIN/COMMIT/ROLLBACK, caller owns release. */
export async function applyRatingCorrections(client:PoolClient,input:unknown,options:{apply?:boolean}={}){
  const plan=parsePlan(input),planSha256=identitySnapshotSha256(plan),report={applied:false,alreadyApplied:false,corrections:0,additions:0,photos:0,newItems:0,planSha256};
  let idle=false;try{await client.query('SAVEPOINT everrate_rating_idle_probe');}catch(e){if((e as {code?:string}).code==='25P01')idle=true;else throw e;}
  if(!idle){await client.query('RELEASE SAVEPOINT everrate_rating_idle_probe');fail('A dedicated idle client is required; existing transaction left untouched.');}
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'");
    // Share ordering with identity repairs so item/history guards cannot race each other.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('everrate:identity-corrections:v1',0))");
    const prior=await client.query("SELECT details FROM everrate.audit_events WHERE action='rating-correction.plan' AND resource_id=$1",[plan.planId]);
    if(prior.rowCount){if(prior.rowCount!==1||prior.rows[0].details.planSha256!==planSha256)fail('Plan ID already used for different contents.');await client.query('ROLLBACK');return {...report,alreadyApplied:true};}
    await lockPlan(client,plan);
    const before=await captureRatingCorrectionSnapshots(client,{groupId:plan.group.id,userIds:plan.users.map(x=>x.id),itemIds:plan.items.map(x=>x.id),ratingIds:plan.corrections.map(x=>x.ratingId),photoIds:plan.photos.map(x=>x.id),sourceIds:plan.sources.map(x=>x.id),attachmentIds:plan.attachments.map(x=>x.id)});
    verifyGuards(plan,before);
    if((await client.query("SELECT 1 FROM everrate.discord_outbox WHERE rating_id=ANY($1::uuid[]) AND status IN ('pending','processing','failed')",[plan.corrections.map(x=>x.ratingId)])).rowCount)fail('Historical repair has an active announcement; resolve it separately first.');
    // The group FOR UPDATE lock also blocks FK inserts and service group access while checking absence.
    for(const item of plan.newItems){
      if((await client.query('SELECT 1 FROM everrate.items WHERE id=$1',[item.itemId])).rowCount)fail('Planned new item UUID already exists.');
      const existing=await client.query('SELECT i.name,i.variant,b.name brand FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id WHERE i.group_id=$1',[plan.group.id]);
      if(existing.rows.some(row=>identityKey(row.name,row.brand,row.variant)===identityKey(item.name,item.brand,item.variant)))fail('Reviewed new item identity already exists; explicitly select its guarded ID.');
    }
    const prepared=await preparePhotoImports(client,plan,before);
    if((await client.query('SELECT id FROM everrate.photos WHERE id=ANY($1::uuid[])',[plan.photoImports.map(x=>x.photoId)])).rowCount||(await client.query('SELECT id FROM everrate.ratings WHERE id=ANY($1::uuid[])',[plan.additions.map(x=>x.ratingId)])).rowCount)fail('Planned new photo/rating UUID already exists.');
    const source=(id:string)=>before.sources.find(x=>x.id===id)!.snapshot.row;
    // Compare the complete projected event set, including corrections and soft-deleted source rows.
    for(const guarded of before.sources){
      const message=guarded.snapshot.row;
      const existing=await client.query(`SELECT id,user_id,item_id FROM everrate.ratings WHERE group_id=$1 AND (source_message_id=$2 OR starts_with(source_message_id,$2||'#') OR starts_with(source_message_id,$3))`,[plan.group.id,message.message_id,'reviewed:'+message.message_id+':']);
      const projected=existing.rows.map(row=>{const change=plan.corrections.find(x=>x.ratingId===row.id)?.set;return {id:row.id,user:change?.userId||row.user_id,item:change?.itemId||row.item_id};});
      for(const op of plan.additions.filter(x=>source(x.sourceId).message_id===message.message_id))projected.push({id:op.ratingId,user:op.userId,item:op.itemId});
      const touched=new Set([...plan.corrections,...plan.additions].filter(x=>source(x.sourceId).message_id===message.message_id).map(x=>x.ratingId));
      for(const event of projected)if(touched.has(event.id)&&projected.some(other=>other.id!==event.id&&other.user===event.user&&other.item===event.item))fail('Reviewed source would contain duplicate reviewer/item events.');
    }
    // Validate missing-review uniqueness before writing, including corrected attribution in this plan.
    for(const op of plan.additions){
      const message=source(op.sourceId),key='reviewed:'+message.message_id+':'+op.sourcePartKey;
      const existing=await client.query(`SELECT id,user_id,item_id,source_message_id FROM everrate.ratings WHERE group_id=$1 AND (source_message_id=$2 OR starts_with(source_message_id,$2||'#') OR starts_with(source_message_id,$3))`,[plan.group.id,message.message_id,'reviewed:'+message.message_id+':']);
      for(const row of existing.rows){const patch=plan.corrections.find(x=>x.ratingId===row.id)?.set||{};if(row.source_message_id===key||((patch.userId||row.user_id)===op.userId&&(patch.itemId||row.item_id)===op.itemId))fail('Source already contains this reviewed rating or reviewer/item event.');}
      if(plan.additions.some(other=>other!==op&&source(other.sourceId).message_id===message.message_id&&other.userId===op.userId&&other.itemId===op.itemId))fail('Two additions duplicate the same source/reviewer/item event.');
      if((await client.query("SELECT 1 FROM everrate.legacy_import_links WHERE table_name='reviewed_discord_rating' AND record_key=$1 AND target_table='ratings'",[message.message_id+':'+op.sourcePartKey])).rowCount)fail('Reviewed source part is already linked.');
      if(!message.sent_at||(await client.query('SELECT $1::timestamptz=$2::timestamptz same',[op.createdAt,message.sent_at])).rows[0].same!==true)fail('New rating creation time must match original source message time.');
    }
    if(!options.apply){await client.query('ROLLBACK');return {...report,corrections:plan.corrections.length,additions:plan.additions.length,photos:plan.photoImports.length,newItems:plan.newItems.length};}
    const audit=async(action:string,id:string,details:unknown)=>client.query('INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES(NULL,$1,$2,$3,$4)',[plan.group.id,action,id,JSON.stringify({planId:plan.planId,planSha256,operatorEvidence:plan.evidence,details})]);
    for(const op of plan.photoImports){const image=prepared.get(op.photoId)!;await client.query('INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[op.photoId,plan.group.id,op.ownerId,image.data,image.sha256,image.mimeType,image.width,image.height,source(op.sourceId).sent_at]);await audit('rating-correction.photo-import',op.photoId,{...op,source:source(op.sourceId),attachment:before.attachments.find(x=>x.id===op.attachmentId)!.snapshot});}
    const ensureLabel=async(table:'brands'|'item_types',name:string|null)=>{
      if(name===null)return null;
      const current=await client.query(`SELECT id FROM everrate.${table} WHERE group_id=$1 AND lower(name)=lower($2) FOR SHARE`,[plan.group.id,name]);
      if(current.rowCount)return current.rows[0].id as string;
      return (await client.query(`INSERT INTO everrate.${table}(group_id,name) VALUES($1,$2) RETURNING id`,[plan.group.id,name])).rows[0].id as string;
    };
    for(const item of [...plan.newItems].sort((a,b)=>a.itemId.localeCompare(b.itemId))){
      const brandId=await ensureLabel('brands',item.brand),typeId=await ensureLabel('item_types',item.type);
      await client.query('INSERT INTO everrate.items(id,group_id,name,brand_id,variant,type_id,broad_category,identity_key,created_by,legacy_photo_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[item.itemId,plan.group.id,item.name,brandId,item.variant,typeId,item.broadCategory,identityKey(item.name,item.brand,item.variant),item.createdBy,item.coverPhotoId]);
      const resulting=(await captureIdentitySnapshots(client,{itemIds:[item.itemId]})).items[0];
      const row=resulting.snapshot.row;
      if(row.group_id!==plan.group.id||row.name!==item.name||row.brand_id!==brandId||row.variant!==item.variant||row.type_id!==typeId||row.broad_category!==item.broadCategory||row.identity_key!==identityKey(item.name,item.brand,item.variant)||row.created_by!==item.createdBy||row.legacy_photo_id!==item.coverPhotoId)fail('Created product differs from explicit reviewed fields.');
      await audit('rating-correction.item-create',item.itemId,{requested:item,resulting});
    }
    for(const op of [...plan.corrections].sort((a,b)=>a.ratingId.localeCompare(b.ratingId))){
      const old=before.ratings.find(x=>x.id===op.ratingId)!.snapshot,set=op.set,photo=set.photoId===undefined?old.photo_id:set.photoId;
      await client.query('UPDATE everrate.ratings SET user_id=$2,score=$3,item_id=$4,photo_id=$5,legacy_photo_missing=$6 WHERE id=$1',[op.ratingId,set.userId||old.user_id,set.score??old.score,set.itemId||old.item_id,photo,set.photoId===undefined?old.legacy_photo_missing:photo===null]);
    }
    for(const op of [...plan.additions].sort((a,b)=>a.ratingId.localeCompare(b.ratingId))){
      const message=source(op.sourceId),provenance={planId:plan.planId,planSha256,archiveMessageId:message.id,sourceId:message.source_id,messageId:message.message_id,sourceSha256:message.sha256,sourcePartKey:op.sourcePartKey,evidence:op.evidence,photoException:op.photoException||null};
      await client.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,photo_id,source,source_message_id,created_at,updated_at,legacy_metadata,legacy_photo_missing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'import',$9,$10,$10,$11,$12)",[op.ratingId,plan.group.id,op.itemId,op.userId,op.score,op.note,op.tastedAt,op.photoId,'reviewed:'+message.message_id+':'+op.sourcePartKey,op.createdAt,{reviewedRatingCorrection:provenance},!op.photoId]);
      await client.query("INSERT INTO everrate.legacy_import_links(source_id,table_name,record_key,target_table,target_id,source_sha256) VALUES($1,'reviewed_discord_rating',$2,'ratings',$3,$4)",[message.source_id,message.message_id+':'+op.sourcePartKey,op.ratingId,message.sha256]);
    }
    const after=await captureIdentitySnapshots(client,{ratingIds:[...plan.corrections,...plan.additions].map(x=>x.ratingId),photoIds:plan.photoImports.map(x=>x.photoId)});
    for(const op of plan.photoImports){
      const actual=after.photos.find(x=>x.id===op.photoId),image=prepared.get(op.photoId)!;
      if(!actual||actual.groupId!==plan.group.id||actual.sha256!==image.sha256||actual.storedSha256!==image.sha256||actual.bytes!==image.data.length||actual.width!==op.width||actual.height!==op.height||actual.mimeType!==op.mimeType)fail('Imported photo differs from reviewed normalized bytes.');
      const row=(await client.query(`SELECT owner_id,${utc('created_at')} created_at FROM everrate.photos WHERE id=$1`,[op.photoId])).rows[0];
      if(row.owner_id!==op.ownerId||row.created_at!==source(op.sourceId).sent_at)fail('Imported photo attribution or timestamp changed.');
    }
    for(const op of plan.corrections){
      const old=before.ratings.find(x=>x.id===op.ratingId)!.snapshot,current=after.ratings.find(x=>x.id===op.ratingId)!.snapshot,preserved={...current};
      for(const [key,column] of [['userId','user_id'],['score','score'],['itemId','item_id'],['photoId','photo_id']] as const)if(op.set[key]!==undefined){
        if(current[column]!==op.set[key])fail('Corrected rating differs from requested fields.');preserved[column]=old[column];
      }
      if(op.set.photoId!==undefined){if(current.legacy_photo_missing!==(op.set.photoId===null))fail('Corrected photo exception differs from review.');preserved.legacy_photo_missing=old.legacy_photo_missing;}
      if(identitySnapshotSha256(preserved)!==identitySnapshotSha256(old))fail('An unrelated historical rating field changed.');
      await audit('rating-correction.update',op.ratingId,{previous:old,resulting:current,requested:op,source:source(op.sourceId)});
    }
    for(const op of plan.additions){
      const row=after.ratings.find(x=>x.id===op.ratingId)!.snapshot,message=source(op.sourceId);
      const dates=(await client.query(`SELECT ${utc('$1::timestamptz')} tasted,${utc('$2::timestamptz')} created`,[op.tastedAt,op.createdAt])).rows[0];
      const provenance={planId:plan.planId,planSha256,archiveMessageId:message.id,sourceId:message.source_id,messageId:message.message_id,sourceSha256:message.sha256,sourcePartKey:op.sourcePartKey,evidence:op.evidence,photoException:op.photoException||null};
      if(row.group_id!==plan.group.id||row.user_id!==op.userId||row.item_id!==op.itemId||row.score!==op.score||row.photo_id!==op.photoId||row.note!==op.note||row.tasted_at!==dates.tasted||row.created_at!==dates.created||row.updated_at!==dates.created||row.deleted_at!==null||row.legacy_photo_missing!==!op.photoId||row.source!=='import'||row.source_message_id!=='reviewed:'+message.message_id+':'+op.sourcePartKey||identitySnapshotSha256(row.legacy_metadata)!==identitySnapshotSha256({reviewedRatingCorrection:provenance}))fail('Added rating differs from explicit reviewed fields.');
      await audit('rating-correction.add',op.ratingId,{requested:op,resulting:row,source:message});
    }
    if((await client.query('SELECT 1 FROM everrate.discord_outbox WHERE rating_id=ANY($1::uuid[]) AND status IN (\'pending\',\'processing\',\'failed\')',[ [...plan.corrections,...plan.additions].map(x=>x.ratingId)])).rowCount)fail('Historical addition unexpectedly created an announcement.');
    await audit('rating-correction.plan',plan.planId,{sources:before.sources,photoEvidence:before.photos,importedPhotos:after.photos.map(({id,sha256,bytes,width,height,mimeType})=>({id,sha256,bytes,width,height,mimeType})),corrections:plan.corrections.length,additions:plan.additions.length,photos:plan.photoImports.length,newItems:plan.newItems.length});
    await client.query('COMMIT');return {...report,applied:true,corrections:plan.corrections.length,additions:plan.additions.length,photos:plan.photoImports.length,newItems:plan.newItems.length};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main(){
  const args=process.argv.slice(2);if(args.includes('--help')){console.log('Usage: npx tsx scripts/apply-rating-corrections.ts --plan=<private.json> [--apply]\nRATING_CORRECTION_DATABASE_URL must explicitly select a local TasteBuds database. Default dry-run.');return;}
  if(args.some(x=>x!=='--apply'&&!x.startsWith('--plan='))||args.filter(x=>x.startsWith('--plan=')).length!==1)fail('Specify one private plan.');
  const connectionString=process.env.RATING_CORRECTION_DATABASE_URL;if(!connectionString)fail('Explicit local database target required.');assertLocalTarget(connectionString);
  const file=args.find(x=>x.startsWith('--plan='))!.slice(7),info=await stat(file);if(!info.isFile()||info.size>2*1024*1024||(info.mode&0o077))fail('Plan must be a private regular file below2MiB.');
  const plan=JSON.parse(await readFile(file,'utf8')),pool=new Pool({connectionString,max:1}),client=await pool.connect();try{console.log(JSON.stringify(await applyRatingCorrections(client,plan,{apply:args.includes('--apply')})));}finally{client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Reviewed rating correction stopped. No private record text or credentials printed.');process.exitCode=1;});
