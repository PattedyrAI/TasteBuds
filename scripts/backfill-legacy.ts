/** Applies vetted local cached evidence; historical event promotion requires explicit review. */
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import sharp from 'sharp';
import {analyzeBackfill} from './analyze-backfill';
import {identityKey} from '../src/domain/ratings';
type Row=Record<string,any>;
type Plan={version:number;sourceFiles:Row[];itemSuggestions:Row[];photoSuggestions:Row[];candidateEvents?:Row[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteHash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function stableId(value:string){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function assertBackfillTarget(value:string):void {
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/everrate(?:_[a-z0-9_]+)?$/.test(url.pathname)||url.searchParams.has('host')||url.searchParams.has('hostaddr'))throw new Error('Backfill requires a local TasteBuds database.');
}
export async function applyBackfillPlan(connectionString:string,plan:Plan,options:{promoteStrongEvents?:boolean}={}){
  assertBackfillTarget(connectionString);
  if(plan.version!==1)throw new Error('Unsupported backfill plan.');
  const db=new Client({connectionString,application_name:'everrate-local-cached-backfill',connectionTimeoutMillis:10_000,statement_timeout:30_000});
  await db.connect();const report={itemsUpdated:0,photosAttached:0,itemsSkipped:0,photosSkipped:0,eventsPromoted:0};
  async function label(table:'brands'|'item_types',groupId:string,name:string){
    if(!name.trim()||name.length>200)throw new Error('Invalid metadata label.');
    const insert=await db.query(`INSERT INTO everrate.${table}(group_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`,[groupId,name]);
    return insert.rows[0]?.id||(await db.query(`SELECT id FROM everrate.${table} WHERE group_id=$1 AND lower(name)=lower($2)`,[groupId,name])).rows[0]?.id;
  }
  async function audit(groupId:string,action:string,resourceId:string,details:unknown){await db.query('INSERT INTO everrate.audit_events(group_id,action,resource_id,details) VALUES($1,$2,$3,$4)',[groupId,action,resourceId,JSON.stringify(details)]);}
  try{
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('everrate:cached-backfill:v1'))");
    for(const file of plan.sourceFiles){if(!(await db.query('SELECT 1 FROM everrate.archive_files WHERE relative_path=$1 AND sha256=$2',[file.relativePath,file.sha256])).rowCount)throw new Error('Backfill evidence is absent from the archive.');}
    for(const suggestion of plan.itemSuggestions){
      const row=(await db.query('SELECT i.*,b.name brand,t.name type FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id WHERE i.id=$1 AND i.group_id=$2 FOR UPDATE OF i',[suggestion.itemId,suggestion.groupId])).rows[0];
      if(!row||!row.legacy_metadata?.id||hash(row.name)!==suggestion.expectedNameSha256||(await db.query("SELECT 1 FROM everrate.audit_events WHERE resource_id=$1 AND action='item.update' LIMIT 1",[row.id])).rowCount){report.itemsSkipped++;continue;}
      const nextBrand=!row.brand_id&&suggestion.patch.brand?suggestion.patch.brand:row.brand;
      const nextType=suggestion.patch.type&&(!row.type_id||['food','drinks'].includes(String(row.type).toLowerCase()))?suggestion.patch.type:row.type;
      if(nextBrand===row.brand&&nextType===row.type){report.itemsSkipped++;continue;}
      const brandId=nextBrand?await label('brands',row.group_id,nextBrand):null,typeId=nextType?await label('item_types',row.group_id,nextType):null;
      await db.query('UPDATE everrate.items SET brand_id=$2,type_id=$3,identity_key=$4 WHERE id=$1',[row.id,brandId,typeId,identityKey(row.name,nextBrand,row.variant)]);
      await audit(row.group_id,'legacy.backfill.metadata',row.id,{version:1,previous:{brandId:row.brand_id,typeId:row.type_id},updated:{brandId,typeId},evidence:suggestion.evidence,sourceFiles:plan.sourceFiles});report.itemsUpdated++;
    }
    for(const suggestion of plan.photoSuggestions){
      const row=(await db.query('SELECT r.*,i.name item_name FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id WHERE r.id=$1 AND r.group_id=$2 AND r.user_id=$3 AND r.item_id=$4 FOR UPDATE OF r',[suggestion.ratingId,suggestion.groupId,suggestion.userId,suggestion.itemId])).rows[0];
      const changed=row?.legacy_metadata?.updated_at&&new Date(row.updated_at).getTime()!==new Date(row.legacy_metadata.updated_at).getTime();
      if(!row||row.photo_id||row.deleted_at||row.source!=='import'||!row.legacy_metadata?.id||changed||row.source_message_id!==suggestion.sourceKey||hash(row.item_name)!==suggestion.expectedNameSha256||(await db.query("SELECT 1 FROM everrate.audit_events WHERE resource_id IN ($1,$2) AND action IN ('rating.update','rating.delete','item.update') LIMIT 1",[row.id,row.item_id])).rowCount){report.photosSkipped++;continue;}
      const original=(await db.query('SELECT b.data,b.sha256 FROM everrate.archive_files f JOIN everrate.archive_blobs b ON b.sha256=f.blob_sha256 WHERE f.id=$1 AND f.relative_path=$2 AND f.sha256=$3',[suggestion.archiveFileId,suggestion.relativeImage,suggestion.originalSha256])).rows[0];
      if(!original||byteHash(original.data)!==suggestion.originalSha256)throw new Error('Original photo bytes do not match the reviewed plan.');
      const image=await sharp(original.data,{limitInputPixels:80_000_000,failOn:'error'}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
      const photoId=stableId(`backfill-photo:v1:${row.group_id}:${row.user_id}:${original.sha256}`);
      await db.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,$7) ON CONFLICT(id) DO NOTHING",[photoId,row.group_id,row.user_id,image.data,byteHash(image.data),image.info.width,image.info.height]);
      await db.query('UPDATE everrate.ratings SET photo_id=$2,legacy_photo_missing=false WHERE id=$1',[row.id,photoId]);
      await audit(row.group_id,'legacy.backfill.photo',row.id,{version:1,previousPhotoId:null,photoId,archiveFileId:suggestion.archiveFileId,originalSha256:suggestion.originalSha256,sourceKey:suggestion.sourceKey,sourceImageMessageId:suggestion.sourceImageMessageId,labelSha256:suggestion.labelSha256,sourceWorkSha256:suggestion.sourceWorkSha256});
      await db.query("UPDATE everrate.import_issues SET resolved_at=now() WHERE source_record_id=$1 AND reason='legacy_rating_photo_missing' AND resolved_at IS NULL",['rating:'+row.id]);report.photosAttached++;
    }
    if(options.promoteStrongEvents)for(const candidate of plan.candidateEvents||[]){
      if(!candidate.strongerReviewCandidate||candidate.classification!=='distinct_prior_message_with_unique_snapshot_target'||!candidate.calendarDayDifferent||candidate.photoComparison!=='distinct'||!candidate.priorPhoto)continue;
      const current=(await db.query('SELECT r.*,i.name item_name FROM everrate.ratings r JOIN everrate.items i ON i.id=r.item_id WHERE r.id=$1 AND r.item_id=$2 AND r.user_id=$3 AND r.deleted_at IS NULL FOR UPDATE OF r',[candidate.relatedCurrentRatingId,candidate.targetItemId,candidate.targetUserId])).rows[0];
      if(!current)throw new Error('Historical target changed after review.');
      if((await db.query("SELECT 1 FROM everrate.ratings WHERE group_id=$1 AND source='import' AND source_message_id=$2",[current.group_id,candidate.sourceKey])).rowCount)continue;
      const archived=(await db.query("SELECT source_id,raw_record FROM everrate.archive_proposals WHERE source_file='import-ready.json' AND record_key=$1 AND sha256=$2",[candidate.sourceKey,candidate.sourceProposalSha256])).rows[0];
      if(!archived)throw new Error('Historical proposal is not archived.');
      const proposal=archived.raw_record,when=new Date(proposal.createdAt),latest=new Date(current.tasted_at);
      if(!Number.isFinite(when.getTime())||when>=latest||when.toISOString().slice(0,10)===latest.toISOString().slice(0,10)||proposal.discordMessageId!==candidate.sourceKey||proposal.score!==candidate.score||proposal.itemName.trim().toLowerCase()!==current.item_name.trim().toLowerCase())throw new Error('Historical event identity no longer matches.');
      if(!(await db.query('SELECT 1 FROM everrate.legacy_aliases WHERE discord_id=$1 AND user_id=$2',[proposal.authorId,current.user_id])).rowCount)throw new Error('Historical author mapping is missing.');
      let snapshotProof=false;
      for(const proof of candidate.supportingRevisionHashes||[]){const row=(await db.query('SELECT previous_value FROM everrate.rating_revisions WHERE id=$1 AND rating_id=$2',[proof.id,current.id])).rows[0];if(row&&hash(row.previous_value)===proof.sha256&&Number(row.previous_value.previous_score)===proposal.score&&(row.previous_value.previous_comment||null)===(proposal.comment||null))snapshotProof=true;}
      if(!snapshotProof||!candidate.currentPhotoHashes?.length||!candidate.priorPhotoHashes?.length||candidate.priorPhotoHashes.some((value:string)=>candidate.currentPhotoHashes.includes(value)))throw new Error('Historical snapshot or distinct-photo proof is missing.');
      const photo=candidate.priorPhoto,original=(await db.query('SELECT b.data,b.sha256 FROM everrate.archive_files f JOIN everrate.archive_blobs b ON b.sha256=f.blob_sha256 WHERE f.id=$1 AND f.relative_path=$2 AND f.sha256=$3',[photo.archiveFileId,photo.relativeImage,photo.originalSha256])).rows[0];
      if(!original||byteHash(original.data)!==photo.originalSha256||!candidate.priorPhotoHashes.includes(photo.originalSha256))throw new Error('Historical original photo hash differs.');
      const image=await sharp(original.data,{limitInputPixels:80_000_000,failOn:'error'}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
      const photoId=stableId(`backfill-photo:v1:${current.group_id}:${current.user_id}:${original.sha256}`),ratingId=stableId(`backfill-rating:v1:${current.group_id}:${candidate.sourceKey}`);
      await db.query("INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,$7) ON CONFLICT(id) DO NOTHING",[photoId,current.group_id,current.user_id,image.data,byteHash(image.data),image.info.width,image.info.height]);
      await db.query("INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,photo_id,source,source_message_id,created_at,updated_at,legacy_metadata,legacy_photo_missing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'import',$9,$7,$7,$10,false)",[ratingId,current.group_id,current.item_id,current.user_id,proposal.score,proposal.comment||null,when,photoId,candidate.sourceKey,JSON.stringify({id:ratingId,sourceProposal:proposal,backfillEvidence:candidate})]);
      await db.query("INSERT INTO everrate.legacy_import_links(source_id,table_name,record_key,target_table,target_id,source_sha256) VALUES($1,'discord_proposals',$2,'ratings',$3,$4) ON CONFLICT DO NOTHING",[archived.source_id,candidate.sourceKey,ratingId,candidate.sourceProposalSha256]);
      await db.query("UPDATE everrate.archive_proposals SET disposition='recovered_historical_event',linked_rating_id=$2 WHERE source_id=$3 AND record_key=$1 AND source_file IN ('import-ready.json','proposed.json')",[candidate.sourceKey,ratingId,archived.source_id]);
      await db.query("UPDATE everrate.import_issues SET resolved_at=now() WHERE source_id=$1 AND source_record_id=$2 AND reason='proposal_not_promoted_without_event_proof' AND resolved_at IS NULL",[archived.source_id,'proposal:'+candidate.sourceKey]);
      await audit(current.group_id,'legacy.backfill.historical_event',ratingId,{version:1,sourceKey:candidate.sourceKey,relatedCurrentRatingId:current.id,supportingRevisionIds:candidate.supportingRevisionHashes.map((proof:Row)=>proof.id),photoId,originalSha256:original.sha256});report.eventsPromoted++;
    }
    await db.query('COMMIT');return report;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
async function main(){
  if(process.argv.includes('--help')){console.log('Usage: npx tsx scripts/backfill-legacy.ts [--apply] [--promote-reviewed-events]\nBACKFILL_DATABASE_URL selects a local database; LEGACY_EXPORT_DIR selects the preserved export. Default is analysis only. Event promotion additionally requires the explicit review flag. No provider calls.');return;}
  if(process.argv.slice(2).some(arg=>!['--apply','--promote-reviewed-events'].includes(arg)))throw new Error('Unknown option.');
  const url=process.env.BACKFILL_DATABASE_URL||'postgresql://127.0.0.1:55439/everrate_import_test';
  assertBackfillTarget(url);
  const analysis=await analyzeBackfill(url,process.env.LEGACY_EXPORT_DIR||'.private/legacy-export');
  console.log(JSON.stringify(process.argv.includes('--apply')?await applyBackfillPlan(url,analysis.plan,{promoteStrongEvents:process.argv.includes('--promote-reviewed-events')}):analysis.summary,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Cached backfill failed; transaction rolled back. No private records or credentials were logged.');process.exitCode=1;});
