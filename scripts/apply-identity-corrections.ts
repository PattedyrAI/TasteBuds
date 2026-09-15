/** Explicit reviewed identity repairs; no recognition, identity inference, or announcements. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import {z} from 'zod';
import {identityKey} from '../src/domain/ratings';
import {assertLocalTarget} from './import-legacy';

const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().min(1).max(200).refine(value=>value===value.trim(),'Use explicitly trimmed metadata');
const fields={name:text,brand:text.nullable(),variant:text.nullable(),type:text.nullable(),broadCategory:text.nullable()};
const patch=z.object(fields).partial().strict().refine(value=>Object.keys(value).length>0,'Empty metadata patch');
const guard=z.object({id:uuid,expectedSha256:sha}).strict();
const planSchema=z.object({
  version:z.literal(1),planId:uuid,groupId:uuid,evidence:z.string().min(1).max(12000).refine(value=>value.trim().length>0),
  items:z.array(guard).min(1).max(1000),photos:z.array(guard).max(2000),
  updates:z.array(z.object({itemId:uuid,set:patch.optional(),photoId:uuid.nullable().optional()}).strict().refine(value=>value.set!==undefined||value.photoId!==undefined)).max(1000),
  forks:z.array(z.object({newItemId:uuid,sourceItemId:uuid,set:z.object(fields).strict(),photoId:uuid.nullable()}).strict()).max(1000),
  moves:z.array(z.object({ratingId:uuid,fromItemId:uuid,toItemId:uuid,expectedSha256:sha,photoId:uuid.nullable(),photoSha256:sha.nullable()}).strict()).max(2000),
}).strict();
export type IdentityCorrectionPlan=z.infer<typeof planSchema>;
type Row=Record<string,any>;
export class IdentityCorrectionError extends Error {constructor(message:string){super(message);this.name='IdentityCorrectionError';}}
function fail(message:string):never {throw new IdentityCorrectionError(message);}
function canonical(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
  return fail('Snapshot must contain plain JSON values.');
}
export function identitySnapshotSha256(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
export function identityPlanSha256(value:unknown):string {return identitySnapshotSha256(parsePlan(value));}
function unique(values:string[],label:string){if(new Set(values).size!==values.length)fail('Duplicate '+label+' in plan.');}
function parsePlan(value:unknown):IdentityCorrectionPlan {
  const parsed=planSchema.safeParse(value);if(!parsed.success)return fail('Invalid identity correction plan.');const plan=parsed.data;
  if(!plan.updates.length&&!plan.forks.length&&!plan.moves.length)fail('Plan contains no corrections.');
  unique(plan.items.map(row=>row.id),'item guard');unique(plan.photos.map(row=>row.id),'photo guard');
  unique(plan.updates.map(row=>row.itemId),'item update');unique(plan.forks.map(row=>row.newItemId),'fork UUID');unique(plan.moves.map(row=>row.ratingId),'rating move');
  const items=new Set(plan.items.map(row=>row.id)),forks=new Set(plan.forks.map(row=>row.newItemId)),photos=new Map(plan.photos.map(row=>[row.id,row.expectedSha256]));
  for(const update of plan.updates){if(!items.has(update.itemId))fail('Every updated item needs an old snapshot guard.');if(update.photoId&&!photos.has(update.photoId))fail('Updated cover photo needs an explicit photo guard.');}
  for(const fork of plan.forks){if(items.has(fork.newItemId)||!items.has(fork.sourceItemId))fail('Fork must use a new UUID and guarded existing source.');if(fork.photoId&&!photos.has(fork.photoId))fail('Fork photo needs an explicit photo guard.');}
  for(const move of plan.moves){
    if(!items.has(move.fromItemId)||(!items.has(move.toItemId)&&!forks.has(move.toItemId))||move.fromItemId===move.toItemId)fail('Rating move must name guarded source and distinct reviewed destination.');
    if(move.photoId===null?move.photoSha256!==null:photos.get(move.photoId)!==move.photoSha256)fail('Rating photo ID/hash must match an explicit photo guard.');
  }
  return plan;
}
const sorted=(ids:string[])=>[...new Set(ids)].sort();
const utc=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const itemJson=`to_jsonb(i)||jsonb_build_object('created_at',${utc('i.created_at')})`;
const ratingJson=`to_jsonb(r)||jsonb_build_object('tasted_at',${utc('r.tasted_at')},'created_at',${utc('r.created_at')},'updated_at',${utc('r.updated_at')},'deleted_at',${utc('r.deleted_at')})`;
export type ItemIdentitySnapshot={id:string;sha256:string;snapshot:{row:Row;brand:string|null;type:string|null;ratingsSha256:string}};
export type RatingIdentitySnapshot={id:string;sha256:string;snapshot:Row;photoId:string|null;photoSha256:string|null};
export type PhotoIdentitySnapshot={id:string;sha256:string;storedSha256:string;bytes:number;width:number;height:number;mimeType:string;groupId:string};
/** SELECT-only. For a consistent planning baseline, caller may use REPEATABLE READ READ ONLY. */
export async function captureIdentitySnapshots(client:PoolClient,ids:{itemIds?:string[];ratingIds?:string[];photoIds?:string[]}) {
  const requested=z.object({itemIds:z.array(uuid).max(1000).optional(),ratingIds:z.array(uuid).max(2000).optional(),photoIds:z.array(uuid).max(2000).optional()}).strict().safeParse(ids);
  if(!requested.success)return fail('Invalid snapshot IDs.');
  const itemIds=sorted(ids.itemIds||[]),ratingIds=sorted(ids.ratingIds||[]);
  const itemRows=await client.query(`SELECT i.id,${itemJson} row,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=ANY($1::uuid[]) ORDER BY i.id`,[itemIds]);
  const history=await client.query(`SELECT r.item_id,${ratingJson} row,p.sha256 photo_sha256 FROM everrate.ratings r LEFT JOIN everrate.photos p ON p.id=r.photo_id WHERE r.item_id=ANY($1::uuid[]) ORDER BY r.item_id,r.id`,[itemIds]);
  const historyByItem=new Map<string,unknown[]>();
  for(const row of history.rows){const rows=historyByItem.get(row.item_id)||[];rows.push({row:row.row,photoSha256:row.photo_sha256});historyByItem.set(row.item_id,rows);}
  const ratingRows=await client.query(`SELECT r.id,${ratingJson} row FROM everrate.ratings r WHERE r.id=ANY($1::uuid[]) ORDER BY r.id`,[ratingIds]);
  if(itemRows.rowCount!==itemIds.length||ratingRows.rowCount!==ratingIds.length)fail('A requested item or rating is missing.');
  const photoIds=sorted([...(ids.photoIds||[]),...ratingRows.rows.flatMap(row=>row.row.photo_id?[row.row.photo_id]:[])]);
  const photos:PhotoIdentitySnapshot[]=[];
  // Hash one bounded photo at a time; never return or log its bytes.
  for(const id of photoIds){
    const found=await client.query('SELECT id,group_id,sha256,data,width,height,mime_type FROM everrate.photos WHERE id=$1',[id]);if(!found.rowCount)fail('A requested photo is missing.');
    const photo=found.rows[0];photos.push({id,sha256:createHash('sha256').update(photo.data).digest('hex'),storedSha256:photo.sha256,bytes:photo.data.length,width:photo.width,height:photo.height,mimeType:photo.mime_type,groupId:photo.group_id});
  }
  const photoHashes=new Map(photos.map(photo=>[photo.id,photo.sha256]));
  const items:ItemIdentitySnapshot[]=itemRows.rows.map(row=>{const snapshot={row:row.row,brand:row.brand,type:row.type,ratingsSha256:identitySnapshotSha256(historyByItem.get(row.id)||[])};return {id:row.id,sha256:identitySnapshotSha256(snapshot),snapshot};});
  const ratings:RatingIdentitySnapshot[]=ratingRows.rows.map(row=>({id:row.id,snapshot:row.row,sha256:identitySnapshotSha256(row.row),photoId:row.row.photo_id,photoSha256:photoHashes.get(row.row.photo_id)||null}));
  return {items,ratings,photos};
}
async function lockRows(client:PoolClient,plan:IdentityCorrectionPlan){
  await client.query('SELECT id FROM everrate.items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[sorted(plan.items.map(row=>row.id))]);
  await client.query('SELECT id FROM everrate.ratings WHERE id=ANY($1::uuid[]) OR item_id=ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE',[sorted(plan.moves.map(row=>row.ratingId)),sorted(plan.items.map(row=>row.id))]);
  // Joined labels are read only after the item locks and these label locks are acquired.
  for(const [table,column] of [['brands','brand_id'],['item_types','type_id']] as const)await client.query(`SELECT id FROM everrate.${table} WHERE id IN (SELECT ${column} FROM everrate.items WHERE id=ANY($1::uuid[])) ORDER BY id FOR SHARE`,[plan.items.map(row=>row.id)]);
  await client.query('SELECT id FROM everrate.photos WHERE id=ANY($1::uuid[]) OR id IN (SELECT photo_id FROM everrate.ratings WHERE item_id=ANY($2::uuid[])) ORDER BY id FOR SHARE',[sorted(plan.photos.map(row=>row.id)),sorted(plan.items.map(row=>row.id))]);
}
function verifySnapshots(plan:IdentityCorrectionPlan,snapshots:Awaited<ReturnType<typeof captureIdentitySnapshots>>){
  const items=new Map(snapshots.items.map(item=>[item.id,item])),ratings=new Map(snapshots.ratings.map(rating=>[rating.id,rating])),photos=new Map(snapshots.photos.map(photo=>[photo.id,photo]));
  for(const expected of plan.items){const actual=items.get(expected.id);if(!actual||actual.snapshot.row.group_id!==plan.groupId||actual.sha256!==expected.expectedSha256)fail('Item group or snapshot changed since review.');}
  for(const expected of plan.photos){const actual=photos.get(expected.id);if(!actual||actual.groupId!==plan.groupId||actual.sha256!==expected.expectedSha256||actual.storedSha256!==expected.expectedSha256)fail('Photo group, stored digest, or actual bytes differ from reviewed evidence.');}
  for(const move of plan.moves){const actual=ratings.get(move.ratingId);if(!actual||actual.snapshot.group_id!==plan.groupId||actual.snapshot.item_id!==move.fromItemId||actual.sha256!==move.expectedSha256||actual.photoId!==move.photoId||actual.photoSha256!==move.photoSha256)fail('Rating snapshot, source, group, or photo changed since review.');}
}
async function ensureLabels(client:PoolClient,plan:IdentityCorrectionPlan){
  const labels=new Map<string,{id:string;name:string}>();
  for(const [table,field] of [['brands','brand'],['item_types','type']] as const){
    const names=sorted([...plan.updates.map(value=>value.set?.[field]),...plan.forks.map(value=>value.set[field])].filter((value):value is string=>typeof value==='string'));
    names.sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())||a.localeCompare(b));
    for(const name of names){
      const result=await client.query(`INSERT INTO everrate.${table}(group_id,name) VALUES($1,$2) ON CONFLICT(group_id,lower(name)) DO UPDATE SET name=everrate.${table}.name RETURNING id,name`,[plan.groupId,name]);
      labels.set(field+':'+name,result.rows[0]);
    }
  }
  return labels;
}
/** Owns the transaction. Caller supplies a dedicated, idle PoolClient and owns its release. */
export async function applyIdentityCorrections(client:PoolClient,input:unknown,options:{apply?:boolean}={}){
  const plan=parsePlan(input),planSha256=identitySnapshotSha256(plan);
  const report={applied:false,alreadyApplied:false,updates:0,forks:0,moves:0,planSha256};
  // SAVEPOINT fails outside a transaction, independently of client_min_messages.
  // A successful probe means the caller owns a transaction; leave that transaction intact.
  let idle=false;
  try{await client.query('SAVEPOINT everrate_identity_idle_probe');}
  catch(error){if((error as {code?:string}).code==='25P01')idle=true;else throw error;}
  if(!idle){await client.query('RELEASE SAVEPOINT everrate_identity_idle_probe');return fail('A dedicated idle client is required; caller transaction was left untouched.');}
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('everrate:identity-corrections:v1',0))");
    const prior=await client.query("SELECT details FROM everrate.audit_events WHERE action='identity-correction.plan' AND resource_id=$1",[plan.planId]);
    if(prior.rowCount){if(prior.rowCount!==1||prior.rows[0].details.planSha256!==planSha256)fail('Plan ID was already used with different contents.');await client.query('ROLLBACK');return {...report,alreadyApplied:true};}
    await lockRows(client,plan);
    const before=await captureIdentitySnapshots(client,{itemIds:plan.items.map(row=>row.id),ratingIds:plan.moves.map(row=>row.ratingId),photoIds:plan.photos.map(row=>row.id)});
    verifySnapshots(plan,before);
    if((await client.query('SELECT id FROM everrate.items WHERE id=ANY($1::uuid[])',[plan.forks.map(row=>row.newItemId)])).rowCount)fail('A planned fork UUID already exists.');
    if(!options.apply){await client.query('ROLLBACK');return {...report,updates:plan.updates.length,forks:plan.forks.length,moves:plan.moves.length};}
    const labels=await ensureLabels(client,plan),oldItems=new Map(before.items.map(item=>[item.id,item]));
    const audits:{action:string;resource:string;details:Record<string,unknown>}[]=[];
    for(const update of [...plan.updates].sort((a,b)=>a.itemId.localeCompare(b.itemId))){
      const old=oldItems.get(update.itemId)!.snapshot,row=old.row,set=update.set||{};
      const brand=set.brand===undefined?{id:row.brand_id,name:old.brand}:set.brand===null?{id:null,name:null}:labels.get('brand:'+set.brand)!;
      const type=set.type===undefined?{id:row.type_id,name:old.type}:set.type===null?{id:null,name:null}:labels.get('type:'+set.type)!;
      const name=set.name??row.name,variant=set.variant===undefined?row.variant:set.variant,broad=set.broadCategory===undefined?row.broad_category:set.broadCategory;
      const photoId=update.photoId===undefined?row.legacy_photo_id:update.photoId;
      const key=set.name!==undefined||set.brand!==undefined||set.variant!==undefined?identityKey(name,brand.name,variant):row.identity_key;
      await client.query('UPDATE everrate.items SET name=$2,brand_id=$3,variant=$4,type_id=$5,broad_category=$6,identity_key=$7,legacy_photo_id=$8 WHERE id=$1',[update.itemId,name,brand.id,variant,type.id,broad,key,photoId]);
      audits.push({action:'identity-correction.item',resource:update.itemId,details:{previous:old,requested:set,...(update.photoId!==undefined?{photoId:update.photoId}:{})}});
    }
    for(const fork of [...plan.forks].sort((a,b)=>a.newItemId.localeCompare(b.newItemId))){
      const old=oldItems.get(fork.sourceItemId)!.snapshot,set=fork.set,brand=set.brand?labels.get('brand:'+set.brand)!:null,type=set.type?labels.get('type:'+set.type)!:null;
      await client.query('INSERT INTO everrate.items(id,group_id,name,brand_id,variant,type_id,broad_category,identity_key,created_by,legacy_photo_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[fork.newItemId,plan.groupId,set.name,brand?.id||null,set.variant,type?.id||null,set.broadCategory,identityKey(set.name,brand?.name,set.variant),old.row.created_by,fork.photoId]);
      audits.push({action:'identity-correction.fork',resource:fork.newItemId,details:{sourceItemId:fork.sourceItemId,sourceSnapshot:old,requested:set,photoId:fork.photoId}});
    }
    for(const move of [...plan.moves].sort((a,b)=>a.ratingId.localeCompare(b.ratingId))){
      await client.query('UPDATE everrate.ratings SET item_id=$2 WHERE id=$1',[move.ratingId,move.toItemId]);
      audits.push({action:'identity-correction.rating-move',resource:move.ratingId,details:{previous:before.ratings.find(row=>row.id===move.ratingId)!.snapshot,toItemId:move.toItemId,photoId:move.photoId,photoSha256:move.photoSha256}});
    }
    const after=await captureIdentitySnapshots(client,{itemIds:[...plan.updates.map(row=>row.itemId),...plan.forks.map(row=>row.newItemId)],ratingIds:plan.moves.map(row=>row.ratingId)});
    for(const update of plan.updates){
      const old=oldItems.get(update.itemId)!.snapshot.row,current=after.items.find(row=>row.id===update.itemId)!.snapshot.row;
      const preserved={...current},set=update.set||{};
      for(const [field,column] of [['name','name'],['brand','brand_id'],['variant','variant'],['type','type_id'],['broadCategory','broad_category']] as const)if(set[field]!==undefined)preserved[column]=old[column];
      if(set.name!==undefined||set.brand!==undefined||set.variant!==undefined)preserved.identity_key=old.identity_key;
      if(update.photoId!==undefined)preserved.legacy_photo_id=old.legacy_photo_id;
      if(identitySnapshotSha256(preserved)!==identitySnapshotSha256(old))fail('An item field outside the reviewed correction changed.');
    }
    for(const move of plan.moves){const old=before.ratings.find(row=>row.id===move.ratingId)!,current=after.ratings.find(row=>row.id===move.ratingId)!;if(identitySnapshotSha256({...current.snapshot,item_id:old.snapshot.item_id})!==old.sha256||current.snapshot.item_id!==move.toItemId)fail('A rating field other than the reviewed item association changed.');}
    for(const audit of audits){
      const resulting=after.items.find(row=>row.id===audit.resource)||after.ratings.find(row=>row.id===audit.resource);
      await client.query('INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES(NULL,$1,$2,$3,$4)',[plan.groupId,audit.action,audit.resource,JSON.stringify({planId:plan.planId,planSha256,evidence:plan.evidence,...audit.details,resulting})]);
    }
    await client.query("INSERT INTO everrate.audit_events(actor_id,group_id,action,resource_id,details) VALUES(NULL,$1,'identity-correction.plan',$2,$3)",[plan.groupId,plan.planId,JSON.stringify({planSha256,evidence:plan.evidence,photoEvidence:before.photos,updates:plan.updates.length,forks:plan.forks.length,moves:plan.moves.length})]);
    await client.query('COMMIT');return {...report,applied:true,updates:plan.updates.length,forks:plan.forks.length,moves:plan.moves.length};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log('Usage: npx tsx scripts/apply-identity-corrections.ts --plan=<private.json> [--apply]\nIDENTITY_CORRECTION_DATABASE_URL must explicitly name a local database. Default validates and rolls back.');return;}
  if(args.some(arg=>arg!=='--apply'&&!arg.startsWith('--plan='))||args.filter(arg=>arg.startsWith('--plan=')).length!==1)fail('Specify exactly one private plan file.');
  const connectionString=process.env.IDENTITY_CORRECTION_DATABASE_URL;if(!connectionString)fail('Explicit local target is required.');assertLocalTarget(connectionString);
  const path=args.find(arg=>arg.startsWith('--plan='))!.slice(7);const info=await stat(path);if(info.size>2*1024*1024||info.mode&0o077)fail('Plan must be a private file under 2 MiB.');
  const plan=JSON.parse(await readFile(path,'utf8')),pool=new Pool({connectionString,max:1,application_name:'everrate-reviewed-identity-correction'}),client=await pool.connect();
  try{console.log(JSON.stringify(await applyIdentityCorrections(client,plan,{apply:args.includes('--apply')})));}finally{client.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Identity correction stopped; no private record text or credentials were printed.');process.exitCode=1;});
