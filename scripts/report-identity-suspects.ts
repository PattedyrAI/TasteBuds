/** SELECT-only inventory and private correction drafts. No provider requests or applicator calls. */
import {randomUUID} from 'node:crypto';
import {chmod,lstat,mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import {z} from 'zod';
import {canonicalBrand} from '../src/domain/brand-identity';
import {identitySuspectFlags,identityToken,normalizedStoredIdentity,IDENTITY_CONFIDENCE_THRESHOLD,type IdentityInput,type IdentityFlag} from './lib/identity-suspects';
import {normalizePhotoIdentity,PHOTO_IDENTITY_VERSION,groupPhotoEvidence,type PhotoIdentity,type PhotoEvidence} from './analyze-photo-identities';
import {captureIdentitySnapshots,identityPlanSha256,type IdentityCorrectionPlan} from './apply-identity-corrections';

type ReportItem=IdentityInput&{id:string;groupId:string;coverPhotoId:string|null};
export type IdentityReviewRow=ReportItem&{flags:IdentityFlag[];analysis:PhotoEvidence[];photoEvidenceStatus:'not_supplied'|'no_photo'|'complete'|'incomplete'|'unverified';draftEligible:boolean;draftBlockedReason:string|null};
export function assertIdentitySuspectsTarget(connectionString:string,allowRemoteReadonly=false):void{
  const url=new URL(connectionString);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!url.pathname.slice(1))throw new Error('Use an explicit PostgreSQL URL without query options');
  if(!allowRemoteReadonly&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Non-loopback reads require --allow-remote-readonly');
}
/** Accept only the analyzer's real proposals.json envelope, not cache records or console summaries. */
export function parseIdentityAnalysis(value:unknown):Map<string,PhotoEvidence[]>{
  const evidence=z.object({itemId:z.uuid(),photoHash:z.string().regex(/^[a-f0-9]{64}$/),photoIds:z.array(z.uuid()).min(1),ratingIds:z.array(z.uuid()).optional(),identity:z.unknown().nullable()});
  const parsed=z.object({status:z.literal('proposals_only'),version:z.literal(PHOTO_IDENTITY_VERSION),items:z.array(z.object({itemId:z.uuid(),evidence:z.array(evidence)}))}).parse(value);
  const result=new Map<string,PhotoEvidence[]>();
  for(const item of parsed.items){
    if(result.has(item.itemId))throw new Error('Duplicate analysis item');
    const hashes=new Set<string>();
    const rows=item.evidence.map(row=>{
      if(row.itemId!==item.itemId||hashes.has(row.photoHash))throw new Error('Inconsistent or duplicate photo evidence');
      hashes.add(row.photoHash);
      return {...row,identity:row.identity===null?null:normalizePhotoIdentity(row.identity)};
    });
    result.set(item.itemId,rows);
  }
  return result;
}
/** Conservative draft: all photos agree, all identities are confident, and no unknown field is cleared. */
export function confidentIdentityPatch(item:IdentityInput,identities:(PhotoIdentity|null)[]):{name?:string;brand?:string}|null{
  if(!identities.length||identities.some(value=>!value||!value.name||value.nameConfidence<IDENTITY_CONFIDENCE_THRESHOLD||value.multipleProducts||!!value.ambiguity||(!!value.brand&&value.brandConfidence<IDENTITY_CONFIDENCE_THRESHOLD)))return null;
  const certain=identities as PhotoIdentity[];
  // Unknown brand alongside a known brand is incomplete, rather than consensus.
  for(const field of ['name','brand','variant'] as const){
    const values=certain.map(value=>field==='brand'?identityToken(canonicalBrand(value.brand)):field==='name'?normalizedStoredIdentity({name:value.name!,brand:value.brand,type:value.type}).name:identityToken(value.variant));
    if(new Set(values).size>1)return null;
  }
  const proposed=certain[0],stored=normalizedStoredIdentity(item),patch:{name?:string;brand?:string}={};
  if(stored.name!==normalizedStoredIdentity({name:proposed.name!,brand:proposed.brand,type:proposed.type}).name)patch.name=proposed.name!;
  if(proposed.brand&&identityToken(canonicalBrand(item.brand))!==identityToken(canonicalBrand(proposed.brand)))patch.brand=canonicalBrand(proposed.brand)!;
  // Replacing a brand must also remove a different brand embedded in the old title.
  if(patch.brand&&identityToken(item.name)!==identityToken(proposed.name))patch.name=proposed.name!;
  return Object.keys(patch).length?patch:null;
}

/** Owns an idle client transaction; includes every item, not only imported rows. */
export async function reportIdentitySuspects(client:PoolClient,analysis:Map<string,PhotoEvidence[]>=new Map()){
  let idle=false;
  try{await client.query('SAVEPOINT identity_suspects_idle_probe');}catch(error){if((error as {code?:string}).code==='25P01')idle=true;else throw error;}
  if(!idle){await client.query('RELEASE SAVEPOINT identity_suspects_idle_probe');throw new Error('A dedicated idle client is required');}
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    await client.query("SET LOCAL statement_timeout='60s'");
    const items=(await client.query<ReportItem>(`SELECT i.id,i.group_id AS "groupId",i.name,b.name brand,t.name type,
      COALESCE(i.legacy_photo_id,(SELECT r.photo_id FROM everrate.ratings r WHERE r.item_id=i.id AND r.photo_id IS NOT NULL AND r.deleted_at IS NULL ORDER BY r.created_at DESC,r.id LIMIT 1)) AS "coverPhotoId"
      FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id ORDER BY i.group_id,i.id`)).rows;
    const members=(await client.query<{groupId:string;displayName:string;nickname:string|null}>(`SELECT m.group_id AS "groupId",u.display_name AS "displayName",u.nickname FROM everrate.memberships m JOIN everrate.users u ON u.id=m.user_id`)).rows;
    const names=new Map<string,string[]>();
    for(const member of members)names.set(member.groupId,[...(names.get(member.groupId)||[]),member.displayName,...(member.nickname?[member.nickname]:[])]);
    const links=(await client.query<{itemId:string;photoId:string;hash:string}>(`WITH links AS (
      SELECT id item_id,legacy_photo_id photo_id FROM everrate.items WHERE legacy_photo_id IS NOT NULL
      UNION SELECT item_id,photo_id FROM everrate.ratings WHERE photo_id IS NOT NULL
      UNION SELECT r.item_id,rp.photo_id FROM everrate.rating_photos rp JOIN everrate.ratings r ON r.id=rp.rating_id
    ) SELECT l.item_id AS "itemId",l.photo_id AS "photoId",p.sha256 hash FROM links l JOIN everrate.photos p ON p.id=l.photo_id`)).rows;
    const byItem=new Map<string,typeof links>();
    for(const link of links)byItem.set(link.itemId,[...(byItem.get(link.itemId)||[]),link]);
    const knownTypeNames=[...new Set(items.flatMap(item=>item.type?[item.type]:[]))];
    const rows:IdentityReviewRow[]=[],candidates:{item:ReportItem;evidence:PhotoEvidence[];patch:NonNullable<ReturnType<typeof confidentIdentityPatch>>}[]=[];
    for(const item of items){
      const evidence=analysis.get(item.id)||[],current=byItem.get(item.id)||[];
      const linked=evidence.length>0&&evidence.every(row=>row.photoIds?.length&&row.photoIds.every(id=>current.some(link=>link.photoId===id&&link.hash===row.photoHash)));
      const complete=linked&&current.every(link=>evidence.some(row=>row.photoHash===link.hash&&row.photoIds?.includes(link.photoId)));
      const verified=linked?evidence:[];
      const flags=identitySuspectFlags(item,{memberNames:names.get(item.groupId),knownTypeNames});
      for(const row of verified)for(const flag of identitySuspectFlags(item,{analysis:row.identity,knownTypeNames}))if(!flags.some(old=>old.code===flag.code))flags.push(flag);
      if(evidence.length&&!linked)flags.push({code:'photo_evidence_unverified',severity:'medium'});
      if(analysis.size&&(current.length>0||evidence.length>0)&&(!complete||evidence.some(row=>!row.identity)))flags.push({code:'photo_evidence_incomplete',severity:'low'});
      if(verified.length&&groupPhotoEvidence(verified)[0]?.conflictingEvidence)flags.push({code:'photo_evidence_conflicting',severity:'high'});
      const patch=complete?confidentIdentityPatch(item,evidence.map(row=>row.identity)):null;
      const photoEvidenceStatus=!current.length?'no_photo':!analysis.size?'not_supplied':evidence.length&&!linked?'unverified':complete&&!evidence.some(row=>!row.identity)?'complete':'incomplete';
      rows.push({...item,flags,analysis:evidence,photoEvidenceStatus,draftEligible:false,draftBlockedReason:patch?null:!complete?'incomplete_photo_coverage':'no_confident_identity_change'});
      if(patch)candidates.push({item,evidence,patch});
    }
    const plans:IdentityCorrectionPlan[]=[];
    const groups=new Map<string,typeof candidates>();
    for(const candidate of candidates)groups.set(candidate.item.groupId,[...(groups.get(candidate.item.groupId)||[]),candidate]);
    for(const [groupId,group] of groups){
      // Chunk below existing snapshot/plan guard limits; hash actual pixels before drafting.
      for(let offset=0;offset<group.length;offset+=250){
        const batch=group.slice(offset,offset+250),safe:typeof candidates=[];
        const photoGuards=new Map<string,string>();
        for(const candidate of batch){
          const ids=[...new Set(candidate.evidence.flatMap(row=>row.photoIds||[]))];
          const review=rows.find(row=>row.id===candidate.item.id)!;
          if(ids.length>2000){review.draftBlockedReason='plan_guard_limit';continue;}
          const snapshots=await captureIdentitySnapshots(client,{photoIds:ids});
          const valid=snapshots.photos.every(photo=>photo.groupId===groupId&&photo.sha256===photo.storedSha256&&candidate.evidence.some(row=>row.photoHash===photo.sha256&&row.photoIds?.includes(photo.id)));
          if(!valid){review.flags.push({code:'photo_evidence_unverified',severity:'medium'});review.photoEvidenceStatus='unverified';review.draftBlockedReason='unverified_photo_evidence';continue;}
          // The v1 format can guard <=2000 photos per plan; otherwise leave for manual review.
          if(new Set([...photoGuards.keys(),...ids]).size>2000){review.draftBlockedReason='plan_guard_limit';continue;}
          for(const photo of snapshots.photos)photoGuards.set(photo.id,photo.sha256);
          safe.push(candidate);
        }
        if(!safe.length)continue;
        const snapshots=await captureIdentitySnapshots(client,{itemIds:safe.map(row=>row.item.id)});
        const plan:IdentityCorrectionPlan={version:1,planId:randomUUID(),groupId,evidence:'DRAFT ONLY: operator must review linked photo labels and all proposed identities before approval. No rename is authorized by this report.',items:snapshots.items.map(row=>({id:row.id,expectedSha256:row.sha256})),photos:[...photoGuards].map(([id,expectedSha256])=>({id,expectedSha256})),updates:safe.map(row=>({itemId:row.item.id,set:row.patch})),forks:[],moves:[]};
        identityPlanSha256(plan);plans.push(plan);
        for(const candidate of safe)rows.find(row=>row.id===candidate.item.id)!.draftEligible=true;
      }
    }
    const reasonCounts:Partial<Record<IdentityFlag['code'],number>>={};
    for(const row of rows)for(const flag of row.flags)reasonCounts[flag.code]=(reasonCounts[flag.code]||0)+1;
    const result={status:'review_only',version:1,generatedAt:new Date().toISOString(),confidenceThreshold:IDENTITY_CONFIDENCE_THRESHOLD,summary:{items:rows.length,suspects:rows.filter(row=>row.flags.length).length,itemsWithoutAnalysis:rows.filter(row=>!row.analysis.length).length,unknownAnalysisItems:[...analysis.keys()].filter(id=>!items.some(item=>item.id===id)).length,draftUpdates:plans.reduce((sum,plan)=>sum+plan.updates.length,0),reasonCounts},rows,plans};
    await client.query('ROLLBACK');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function privateDirectory(path:string){
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Private directory must be a real directory');
  await chmod(path,0o700);
}
async function privateJson(path:string,value:unknown){
  const file=await open(path,'wx',0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');}finally{await file.close();}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log('Usage: IDENTITY_SUSPECTS_DATABASE_URL=postgresql://127.0.0.1/db npx tsx scripts/report-identity-suspects.ts [--analysis=.private/photo-identities/proposals.json] [--allow-remote-readonly]');return;}
  if(args.some(arg=>arg!=='--allow-remote-readonly'&&!arg.startsWith('--analysis='))||args.filter(arg=>arg.startsWith('--analysis=')).length>1)throw new Error('Invalid arguments');
  const connectionString=process.env.IDENTITY_SUSPECTS_DATABASE_URL;
  if(!connectionString)throw new Error('Explicit database URL required');
  assertIdentitySuspectsTarget(connectionString,args.includes('--allow-remote-readonly'));
  let analysis=new Map<string,PhotoEvidence[]>();
  const analysisPath=args.find(arg=>arg.startsWith('--analysis='))?.slice(11);
  if(analysisPath==='')throw new Error('Analysis path required');
  if(analysisPath){const info=await lstat(analysisPath);if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024||info.mode&0o077)throw new Error('Analysis must be a private regular file under 64 MiB');analysis=parseIdentityAnalysis(JSON.parse(await readFile(analysisPath,'utf8')));}
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:10_000,options:'-c default_transaction_read_only=on',application_name:'everrate-identity-suspects-readonly'});
  try{
    const client=await pool.connect();
    let report:Awaited<ReturnType<typeof reportIdentitySuspects>>;
    try{report=await reportIdentitySuspects(client,analysis);}finally{client.release();}
    const root=resolve('.private');await privateDirectory(root);
    const directory=join(root,'identity-suspects');await privateDirectory(directory);
    const run=join(directory,randomUUID());await privateDirectory(run);
    await privateJson(join(run,'report.json'),report);
    for(const plan of report.plans)await privateJson(join(run,`draft-${plan.groupId}-${plan.planId}.json`),plan);
    // Only product identity columns are printed: never member values, notes, OCR or ambiguity text.
    console.table(report.rows.filter(row=>row.flags.length).map(row=>({id:row.id,group:row.groupId,brand:row.brand,name:row.name,type:row.type,coverPhotoId:row.coverPhotoId,flags:row.flags.map(flag=>flag.severity+':'+flag.code).join(', '),analysed:row.analysis.filter(e=>e.identity).map(e=>[e.identity!.brand,e.identity!.name].filter(Boolean).join(' / ')).join('; ')})));
    console.log(JSON.stringify(report.summary));console.log(`Private report: ${join(run,'report.json')}`);
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Identity suspect report stopped; no credentials or private text printed.');process.exitCode=1;});
