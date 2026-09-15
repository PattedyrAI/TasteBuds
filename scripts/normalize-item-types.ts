/** Normalize existing subcategory rows locally; never merge items or modify ratings. */
import {Client} from 'pg';
import {pathToFileURL} from 'node:url';
import {canonicalItemType} from '../src/domain/item-types';
import {assertLocalTarget} from './import-legacy';

type TypeRow={id:string;group_id:string;name:string};
type ItemRow={id:string;group_id:string;type_id:string|null};
type Mapping={groupId:string;fromTypeId:string;toTypeId:string;oldName:string;newName:string;operation:'rename'|'reuse';affectedItemIds:string[]};
export async function normalizeItemTypes(connectionString:string,apply=false){
  assertLocalTarget(connectionString);
  const db=new Client({connectionString,application_name:'everrate-local-type-normalization',connectionTimeoutMillis:10_000,statement_timeout:30_000});
  await db.connect();
  try{
    await db.query(apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if(apply){
      await db.query("SELECT pg_advisory_xact_lock(hashtext('everrate:normalize-item-types:v1'))");
      // Keep the planned references stable until aliases are removed; this is a short local maintenance transaction.
      await db.query('LOCK TABLE everrate.item_types,everrate.items IN SHARE ROW EXCLUSIVE MODE');
    }
    const before=(await db.query("SELECT count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' ORDER BY r.id),'')) checksum FROM everrate.ratings r")).rows[0];
    const types:TypeRow[]=(await db.query('SELECT id,group_id,name FROM everrate.item_types ORDER BY group_id,name,id')).rows;
    const items:ItemRow[]=(await db.query('SELECT id,group_id,type_id FROM everrate.items ORDER BY id')).rows;
    const buckets=new Map<string,{name:string;rows:TypeRow[]}>();
    for(const row of types){
      const name=canonicalItemType(row.name);if(!name||name.length>200)throw new Error('A type cannot be normalized to a valid label.');
      const key=row.group_id+':'+name.toLowerCase();let bucket=buckets.get(key);
      if(!bucket){bucket={name,rows:[]};buckets.set(key,bucket);}bucket.rows.push(row);
    }
    const mappings:Mapping[]=[];
    for(const bucket of buckets.values()){
      const target=bucket.rows.find(row=>row.name===bucket.name)||bucket.rows.find(row=>row.name.toLowerCase()===bucket.name.toLowerCase())||bucket.rows[0];
      for(const row of bucket.rows){
        if(row.id===target.id&&row.name===bucket.name)continue;
        mappings.push({groupId:row.group_id,fromTypeId:row.id,toTypeId:target.id,oldName:row.name,newName:bucket.name,operation:row.id===target.id?'rename':'reuse',affectedItemIds:items.filter(item=>item.group_id===row.group_id&&item.type_id===row.id).map(item=>item.id)});
      }
    }
    if(apply){
      // Rename survivor first; its chosen canonical label cannot conflict with another bucket.
      for(const mapping of mappings.filter(mapping=>mapping.operation==='rename'))await db.query('UPDATE everrate.item_types SET name=$3 WHERE id=$1 AND group_id=$2',[mapping.fromTypeId,mapping.groupId,mapping.newName]);
      for(const mapping of mappings){
        if(mapping.operation==='reuse'){
          const changed=await db.query('UPDATE everrate.items SET type_id=$3 WHERE group_id=$1 AND type_id=$2 RETURNING id',[mapping.groupId,mapping.fromTypeId,mapping.toTypeId]);
          if(changed.rowCount!==mapping.affectedItemIds.length)throw new Error('Item references changed during normalization.');
          const removed=await db.query('DELETE FROM everrate.item_types t WHERE t.id=$1 AND t.group_id=$2 AND NOT EXISTS(SELECT 1 FROM everrate.items i WHERE i.type_id=t.id)',[mapping.fromTypeId,mapping.groupId]);
          if(removed.rowCount!==1)throw new Error('Alias still has item references.');
        }
        await db.query("INSERT INTO everrate.audit_events(group_id,action,resource_id,details) VALUES($1,'item_type.normalize',$2,$3)",[mapping.groupId,mapping.toTypeId,JSON.stringify({version:1,...mapping})]);
      }
    }
    const after=(await db.query("SELECT count(*)::int count,md5(coalesce(string_agg(md5(row_to_json(r)::text),'' ORDER BY r.id),'')) checksum FROM everrate.ratings r")).rows[0];
    if(before.count!==after.count||before.checksum!==after.checksum)throw new Error('Ratings changed during normalization.');
    await db.query(apply?'COMMIT':'ROLLBACK');
    return {applied:apply,typeRowsBefore:types.length,typeRowsAfter:types.length-mappings.filter(mapping=>mapping.operation==='reuse').length,items:items.length,ratings:before.count,ratingsUnchanged:true,typesRenamed:mappings.filter(mapping=>mapping.operation==='rename').length,aliasRowsRemoved:mappings.filter(mapping=>mapping.operation==='reuse').length,itemsReassigned:mappings.filter(mapping=>mapping.operation==='reuse').reduce((total,mapping)=>total+mapping.affectedItemIds.length,0),mappings};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
async function main(){
  if(process.argv.includes('--help')){console.log('Usage: npx tsx scripts/normalize-item-types.ts [--apply]\nTYPE_NORMALIZATION_DATABASE_URL selects a local TasteBuds database. Default is dry-run. Audits alias mappings; never modifies ratings.');return;}
  if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw new Error('Unknown option.');
  const result=await normalizeItemTypes(process.env.TYPE_NORMALIZATION_DATABASE_URL||'postgresql://127.0.0.1:55439/everrate_import_test',process.argv.includes('--apply'));
  // Print aggregate counts and public type labels only, not user/item identifiers.
  console.log(JSON.stringify({...result,mappings:result.mappings.map(({oldName,newName,operation,affectedItemIds})=>({oldName,newName,operation,affectedItems:affectedItemIds.length}))},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main().catch(()=>{console.error('Type normalization failed; no credentials or private records were logged.');process.exitCode=1;});
