/** Read-only local inventory and guarded proposals. There is intentionally no apply mode. */
import {createHash} from 'node:crypto';
import {mkdir,open,realpath} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {identityKey} from '../src/domain/ratings';
import {assertLocalTarget} from './import-legacy';

export type BrandNameItem={
  id:string;groupId:string;name:string;brand:string|null;brandId:string|null;variant:string|null;
  identityKey:string;type:string|null;typeId:string|null;createdAt:string;manualEdit:boolean;artifact:boolean;
};
type PrefixRule={brand:string;aliases:string[];types:string[];family:'drink'|'packaged-food'};
const energy=['Energy drinks'];
const energyBrands=['3D Energy','AA Drink','Alani Nu','Arizona','Bang','Battery','Biltema','Black Rifle','Bloom','Bomba','Burn','C4','Celsius','Cult','Faxe Kondi','FitAid','G Fuel','Ghost','Gorilla Mind','Hell','Hitschies','Lemonsoda','Lucky Energy','Mountain Dew','NOS','Nocco','Optimum Nutrition','Oshee','Powerking','Prime','Pur Bru','Reign','Relentless','Rip It','Rockstar','Ryse','TRST','Toxic Waste','Uptime','ZOA'];
// These are curated prefixes observed in this collection, not a first-word brand guesser.
const rules:PrefixRule[]=[
  ...energyBrands.map(brand=>({brand,aliases:[brand],types:energy,family:'drink' as const})),
  {brand:'Red Bull',aliases:['Red Bull','Redbull'],types:energy,family:'drink'},
  {brand:'Monster',aliases:['Monster'],types:['Energy drinks','Hard seltzer'],family:'drink'},
  {brand:'White Claw',aliases:['White Claw'],types:['Hard seltzer'],family:'drink'},
  ...['Cabot','Kraft','Cheetos','Devour','M&S',"Trader Joe's",'Velveeta'].map(brand=>({brand,aliases:brand==="Trader Joe's"?[brand,'Trader Joe’s']:[brand],types:['Mac and cheese'],family:'packaged-food' as const})),
  {brand:'Buldak',aliases:['Buldak'],types:['Noodles'],family:'packaged-food'},
  {brand:"Jack Link's",aliases:["Jack Link's",'Jack Link’s'],types:['Jerky'],family:'packaged-food'},
  ...['Built','Fulfil','Met-Rx'].map(brand=>({brand,aliases:[brand],types:['Protein bars'],family:'packaged-food' as const})),
];
const fold=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
const orderedRules=rules.flatMap(rule=>rule.aliases.map(alias=>({rule,alias}))).sort((a,b)=>b.alias.length-a.alias.length);
type Refusal='no_known_prefix'|'type_context_mismatch'|'conflicting_explicit_brand'|'brand_only_name'|'non_product_name';
export type PrefixResult={ok:true;name:string;brand:string;matchedPrefix:string;typeContext:string;rule:'literal-prefix-v1'}|{ok:false;reason:Refusal};

/** Pure helper: a prefix must be literal, recognized and supported by the existing item type. */
export function normalizeLeadingBrand(input:{name:string;brand:string|null;type:string|null}):PrefixResult{
  const title=input.name.trim();
  const found=orderedRules.map(({rule,alias})=>({rule,match:title.match(new RegExp(`^${escape(alias)}(?=$|\\s|[-–—:])`,'iu'))})).find(candidate=>candidate.match);
  if(!found?.match)return {ok:false,reason:'no_known_prefix'};
  const {rule,match}=found;
  if(!input.type||!rule.types.some(type=>fold(type)===fold(input.type!)))return {ok:false,reason:'type_context_mismatch'};
  if(input.brand&&!rule.aliases.some(alias=>fold(alias)===fold(input.brand!)))return {ok:false,reason:'conflicting_explicit_brand'};
  const name=title.slice(match[0].length).replace(/^[\s:–—-]+/u,'').trim();
  if(!name)return {ok:false,reason:'brand_only_name'};
  // A correct drink brand can occur in a dish name or a legacy opinion, even after type inference.
  if((rule.family==='drink'&&/\b(burgers?|cheeseburgers?|pizza|cakes?|cookies?|sandwich(?:es)?)\b/iu.test(name))||/^(always\b|is\b|was\b|tastes?\b|sucks?\b|cooks?\b|my\b|i\b)/iu.test(name))return {ok:false,reason:'non_product_name'};
  return {ok:true,name,brand:rule.brand,matchedPrefix:match[0],typeContext:input.type,rule:'literal-prefix-v1'};
}

type Guard=Omit<BrandNameItem,'id'|'groupId'>;
export type BrandNameProposal={itemId:string;groupId:string;guard:Guard;proposed:{name:string;brand:string;identityKey:string};provenance:{rule:'literal-prefix-v1';matchedPrefix:string;typeContext:string;photoEvidence:false;preservedFields:string[]}};
type Review={itemId:string;groupId:string;guard:Guard;reason:Refusal|'manual_edit'|'legacy_artifact'|'identity_collision';proposed?:BrandNameProposal['proposed'];collidingItemIds?:string[]};
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function countBy<T>(rows:T[],key:(row:T)=>string){const counts:Record<string,number>=Object.create(null);for(const row of rows){const label=key(row);counts[label]=(counts[label]||0)+1;}return counts;}

export function buildBrandNamePlan(items:BrandNameItem[]){
  const snapshot=[...items].sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(snapshot.map(item=>item.id)).size!==snapshot.length)throw new Error('Duplicate item IDs in source inventory.');
  const candidates:BrandNameProposal[]=[],review:Review[]=[];
  for(const row of snapshot){
    const {id:itemId,groupId,...guard}=row;
    const result=normalizeLeadingBrand(row);
    const skip=row.manualEdit?'manual_edit':row.artifact?'legacy_artifact':result.ok===false?result.reason:null;
    if(skip){review.push({itemId,groupId,guard,reason:skip});continue;}
    if(!result.ok)continue;
    candidates.push({itemId,groupId,guard,proposed:{name:result.name,brand:result.brand,identityKey:identityKey(result.name,result.brand,row.variant)},provenance:{rule:result.rule,matchedPrefix:result.matchedPrefix,typeContext:result.typeContext,photoEvidence:false,preservedFields:['id','group_id','variant','type_id','ratings','rating_ids','rating_photos','scores','notes','dates']}});
  }
  const proposals:BrandNameProposal[]=[];
  for(const candidate of candidates){
    // Even a destination that might later move is held for review; no ordering-dependent merges.
    const collidingItemIds=[...new Set([
      ...snapshot.filter(row=>row.id!==candidate.itemId&&row.groupId===candidate.groupId&&(row.identityKey===candidate.proposed.identityKey||identityKey(row.name,row.brand,row.variant)===candidate.proposed.identityKey)).map(row=>row.id),
      ...candidates.filter(other=>other.itemId!==candidate.itemId&&other.groupId===candidate.groupId&&other.proposed.identityKey===candidate.proposed.identityKey).map(other=>other.itemId),
    ])].sort();
    if(collidingItemIds.length)review.push({itemId:candidate.itemId,groupId:candidate.groupId,guard:candidate.guard,reason:'identity_collision',proposed:candidate.proposed,collidingItemIds});
    else proposals.push(candidate);
  }
  return {version:1 as const,mode:'dry-run' as const,sourceItemsSha256:sha(snapshot),summary:{items:items.length,proposals:proposals.length,brandsAdded:proposals.filter(row=>!row.guard.brand).length,repeatedBrandsRemoved:proposals.filter(row=>!!row.guard.brand).length,byBrand:countBy(proposals,row=>row.proposed.brand),reviewByReason:countBy(review,row=>row.reason)},inventory:{byType:countBy(snapshot,row=>row.type||'[unclassified]'),byExistingBrand:countBy(snapshot,row=>row.brand||'[no brand]')},proposals,review};
}

export function assertFrozenBrandPlanTarget(connectionString:string){
  assertLocalTarget(connectionString);
  const parsed=new URL(connectionString);
  if(parsed.pathname!=='/everrate_import_test'||[...parsed.searchParams].length)throw new Error('Brand/name planning is restricted to the frozen local import database without connection overrides.');
}
export async function readBrandNamePlan(connectionString:string){
  assertFrozenBrandPlanTarget(connectionString);
  const db=new Client({connectionString,application_name:'everrate-readonly-brand-name-plan',connectionTimeoutMillis:10_000,statement_timeout:30_000});
  await db.connect();
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actual=(await db.query('SELECT current_database() name')).rows[0].name;
    if(actual!=='everrate_import_test')throw new Error('Unexpected source database.');
    const snapshot=await db.query(`SELECT i.id,i.group_id AS "groupId",i.name,b.name brand,i.brand_id AS "brandId",i.variant,i.identity_key AS "identityKey",t.name type,i.type_id AS "typeId",i.created_at::text AS "createdAt",
      EXISTS(SELECT 1 FROM everrate.audit_events a WHERE a.resource_id=i.id AND a.action='item.update') AS "manualEdit",
      EXISTS(SELECT 1 FROM everrate.import_issues e WHERE e.source_record_id='item:'||i.id::text AND e.reason='legacy_item_requires_reconciliation' AND e.resolved_at IS NULL) artifact
      FROM everrate.items i LEFT JOIN everrate.brands b ON b.id=i.brand_id LEFT JOIN everrate.item_types t ON t.id=i.type_id ORDER BY i.id`);
    const ratings=(await db.query("SELECT count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' ORDER BY r.id),'')) checksum FROM everrate.ratings r")).rows[0];
    const plan=buildBrandNamePlan(snapshot.rows);
    await db.query('ROLLBACK');
    return {...plan,source:{database:'everrate_import_test',capturedAt:new Date().toISOString(),transaction:'repeatable-read-read-only',ratingsCount:ratings.count,ratingsChecksum:ratings.checksum},applyRequirements:['Recheck every guard, including exact brand/type references and manual-edit/artifact status, in a transaction.','Recheck destination identity collisions against both live rows and the full batch.','Preserve item IDs, group IDs, variants, types, ratings and photos; do not merge or split items.','Write an audit with old/new name, brand and identity key. This plan has no photo-derived evidence.']};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help'){console.log('Usage: npx tsx scripts/plan-brand-names.ts [--output .private/brand-name-plan.json]\nReads only local everrate_import_test. No apply mode and no provider calls. Existing plan files are never overwritten.');return;}
  if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Unknown option.');
  const privateDir=resolve('.private'),output=resolve(args[1]||'.private/brand-name-plan.json');
  if(!output.startsWith(privateDir+sep)||dirname(output)!==privateDir||!output.endsWith('.json'))throw new Error('Plan output must be a JSON file directly inside .private.');
  await mkdir(privateDir,{recursive:true,mode:0o700});
  if(await realpath(privateDir)!==privateDir)throw new Error('Private output directory cannot be a symlink.');
  const plan=await readBrandNamePlan(process.env.BRAND_NAME_PLAN_DATABASE_URL||'postgresql://127.0.0.1:55439/everrate_import_test');
  const file=await open(output,'wx',0o600);
  try{await file.writeFile(JSON.stringify(plan,null,2)+'\n');}finally{await file.close();}
  console.log(JSON.stringify({mode:plan.mode,...plan.summary,ratings:plan.source.ratingsCount,privatePlan:output},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Read-only brand/name planning failed; no credentials or item records were logged.');process.exitCode=1;});
