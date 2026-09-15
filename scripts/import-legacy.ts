/** Read-only legacy source; explicit --apply may write ONLY a local TasteBuds database. */
import {readFile,readdir,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {basename,join,relative,resolve,sep} from 'node:path';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import sharp from 'sharp';
import {identityKey} from '../src/domain/ratings';
type Row=Record<string,any>;
export type LegacySnapshot={sourceKey:string;capturedAt:string;tables:Record<string,Row[]>};
type Options={targetUrl:string;sourceDir:string;snapshot:LegacySnapshot;apply?:boolean;metadataOnly?:boolean};
const tables=['profiles','groups','group_members','categories','category_fields','items','ratings','rating_history','comments','group_webhooks'];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value);
const stableId=(value:string)=>{const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export function assertLocalTarget(value:string):void {
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/(everrate|everrate_[a-z0-9_]+)$/.test(url.pathname))throw new Error('Apply requires a LOCAL TasteBuds PostgreSQL database');
  if(url.searchParams.has('host')||url.searchParams.has('hostaddr'))throw new Error('Connection host overrides are not allowed');
}
export function attachmentRelativePath(value:string):string|null {
  if(/^[a-z]+:\/\//i.test(value)||value.split(/[\\/]/).includes('..')||value.includes('\0'))return null;
  const match=value.replaceAll('\\','/').match(/(?:^|\/)attachments\/([^/]+)$/);
  return match?`attachments/${match[1]}`:null;
}
async function optionalJson(path:string,fallback:any){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
async function filesUnder(root:string,folder=root):Promise<{path:string;size:number}[]> {
  const output:{path:string;size:number}[]=[];
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(folder,entry.name);
    if(entry.isSymbolicLink())throw new Error('Source archive must not contain symbolic links');
    if(entry.isDirectory())output.push(...await filesUnder(root,path));
    else if(entry.isFile())output.push({path:relative(root,path).split(sep).join('/'),size:(await stat(path)).size});
  }
  return output;
}
async function fileHash(path:string){const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
function rowKey(table:string,row:Row){return String(row.id??(table==='group_members'?`${row.group_id}:${row.user_id}`:table==='category_fields'?`${row.category_id}:${row.key}`:row.group_id??hash(json(row))));}
function protectSecretRow(table:string,row:Row):Row {
  if(table!=='group_webhooks'||!row.url)return row;
  const key=process.env.DISCORD_ENCRYPTION_KEY;if(!key)throw new Error('DISCORD_ENCRYPTION_KEY required to archive existing webhook secrets');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),iv);
  const encrypted=Buffer.concat([cipher.update(row.url,'utf8'),cipher.final()]);
  const {url:_,...safe}=row;
  return {...safe,url_encrypted:`legacy-v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`};
}
export async function loadLegacySnapshot():Promise<LegacySnapshot> {
  let connectionString=process.env.LEGACY_DATABASE_URL;
  if(!connectionString){const secrets=JSON.parse(await readFile(resolve('.private/railway-legacy.json'),'utf8')).pg;const url=new URL('postgresql://localhost');url.hostname=secrets.RAILWAY_TCP_PROXY_DOMAIN;url.port=secrets.RAILWAY_TCP_PROXY_PORT;url.username=secrets.POSTGRES_USER;url.password=secrets.POSTGRES_PASSWORD;url.pathname='/'+secrets.POSTGRES_DB;connectionString=url.href;}
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:15_000,statement_timeout:30_000,application_name:'everrate-legacy-read-only'});const db=await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot:LegacySnapshot={sourceKey:process.env.LEGACY_SOURCE_KEY||'scawwyrate:legacy-public:v1',capturedAt:new Date().toISOString(),tables:{}};
    for(const table of tables)snapshot.tables[table]=(await db.query(`SELECT * FROM public.${table}`)).rows;
    await db.query('ROLLBACK');return snapshot;
  }finally{db.release();await pool.end();}
}
export async function importLegacy(options:Options){
  const {snapshot}=options,root=await realpath(options.sourceDir);
  if(options.apply)assertLocalTarget(options.targetUrl);
  const files=await filesUnder(root),messages:Row[]=await optionalJson(join(root,'messages.json'),[]),authors:Record<string,string>=await optionalJson(join(root,'authors.json'),{});
  const proposals:Row[]=await optionalJson(join(root,'import-ready.json'),[]);
  let cleanup='';try{cleanup=await readFile(join(root,'cleanup-plan.md'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const unresolvedSection=cleanup.match(/^## Unresolved[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]||'';
  const unresolvedNames=new Set([...unresolvedSection.matchAll(/`([^`]+)`/g)].map(match=>match[1].toLowerCase()));
  const ambiguousItems=(snapshot.tables.items||[]).filter(row=>unresolvedNames.has(row.name.toLowerCase()));
  const attachmentIdsByPath=new Map<string,Set<string>>();
  for(const message of messages)for(const attachment of message.attachments||[]){const path=attachmentRelativePath(attachment.localPath||'');if(path){let ids=attachmentIdsByPath.get(path);if(!ids){ids=new Set();attachmentIdsByPath.set(path,ids);}ids.add(String(attachment.id));}}
  const ambiguousPaths=new Set([...attachmentIdsByPath].filter(([,ids])=>ids.size>1).map(([path])=>path));
  const report={applied:!!options.apply,metadataOnly:!!options.metadataOnly,sourceCounts:Object.fromEntries(Object.entries(snapshot.tables).map(([k,v])=>[k,v.length])),sourceFiles:files.length,sourceBytes:files.reduce((n,f)=>n+f.size,0),messages:messages.length,attachmentRecords:messages.reduce((n,m)=>n+(m.attachments?.length||0),0),attachmentFiles:files.filter(f=>f.path.startsWith('attachments/')).length,proposals:proposals.length,aliases:Object.keys(authors).length,ambiguousAttachmentPaths:ambiguousPaths.size,knownAmbiguousItems:ambiguousItems.length,imported: {} as Record<string,number>,archivedBytes:0,photoCount:0,issueCount:0};
  if(!options.apply)return report;
  const pool=new Pool({connectionString:options.targetUrl,max:1,application_name:'everrate-legacy-local-import'}),db=await pool.connect();
  let sourceId='';const fileIds=new Map<string,string>(),photoCache=new Map<string,string|null>();
  const photoPaths=new Map<string,string>();
  for(const message of messages)for(const attachment of message.attachments||[]){const path=attachmentRelativePath(attachment.localPath||'');if(path)photoPaths.set(`${message.id}-${basename(path)}`,path);}
  async function issue(key:string,reason:string,raw:unknown){await db.query('INSERT INTO everrate.import_issues(source_id,source_record_id,reason,raw_record) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[sourceId,key,reason,json(raw)]);}
  async function photo(url:string|null|undefined,groupId:string,ownerId:string):Promise<string|null>{
    if(!url)return null;const cacheKey=`${groupId}:${ownerId}:${url}`;if(photoCache.has(cacheKey))return photoCache.get(cacheKey)!;
    const id=stableId('legacy-photo:'+cacheKey);
    if((await db.query('SELECT id FROM everrate.photos WHERE id=$1',[id])).rowCount){photoCache.set(cacheKey,id);return id;}
    let path:string|undefined;
    try{const objectPath=decodeURIComponent(new URL(url).pathname).split('/storage/v1/object/public/rating-photos/discord-import/');if(objectPath.length===2&&!objectPath[1].includes('/'))path=photoPaths.get(objectPath[1]);}catch{}
    if(!path){await issue('photo:'+hash(url),'photo_source_not_found',{url});photoCache.set(cacheKey,null);return null;}
    if(ambiguousPaths.has(path)){await issue('photo:'+hash(url),'photo_source_ambiguous',{url,relativePath:path});photoCache.set(cacheKey,null);return null;}
    try{
      const image=await sharp(join(root,path),{limitInputPixels:80_000_000,failOn:'error'}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer({resolveWithObject:true});
      await db.query('INSERT INTO everrate.photos(id,group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',[id,groupId,ownerId,image.data,hash(image.data),'image/jpeg',image.info.width,image.info.height]);
      report.photoCount++;photoCache.set(cacheKey,id);return id;
    }catch(error){await issue('photo:'+hash(url),'photo_could_not_be_reencoded',{url,relativePath:path,errorClass:(error as NodeJS.ErrnoException).code||'image_processing'});photoCache.set(cacheKey,null);return null;}
  }
  async function rowImport(table:string,row:Row,target:string,insert:()=>Promise<string>){
    const key=rowKey(table,row),sha=hash(json(row));
    const linked=await db.query('SELECT source_sha256 FROM everrate.legacy_import_links WHERE source_id=$1 AND table_name=$2 AND record_key=$3 AND target_table=$4',[sourceId,table,key,target]);
    if(linked.rowCount){if(linked.rows[0].source_sha256!==sha)await issue(`${table}:${key}`,'source_changed_after_import',protectSecretRow(table,row));return;}
    await db.query('SAVEPOINT legacy_row');
    try{const id=await insert();await db.query('INSERT INTO everrate.legacy_import_links(source_id,table_name,record_key,target_table,target_id,source_sha256) VALUES($1,$2,$3,$4,$5,$6)',[sourceId,table,key,target,id,sha]);await db.query('RELEASE SAVEPOINT legacy_row');report.imported[target]=(report.imported[target]||0)+1;}
    catch(error){await db.query('ROLLBACK TO SAVEPOINT legacy_row');await db.query('RELEASE SAVEPOINT legacy_row');await issue(`${table}:${key}`,'core_row_failed_'+((error as NodeJS.ErrnoException).code||'validation'),protectSecretRow(table,row));}
  }
  try{
    await db.query("SELECT pg_advisory_lock(hashtextextended($1,0))",['legacy-import:'+snapshot.sourceKey]);
    const source=await db.query("INSERT INTO everrate.import_sources(source_key,source_type,status,expected_count,metadata) VALUES($1,'legacy_database_and_discord','importing',$2,$3) ON CONFLICT(source_key) DO UPDATE SET status='importing',expected_count=excluded.expected_count,metadata=excluded.metadata RETURNING id",[snapshot.sourceKey,(snapshot.tables.ratings||[]).length,json({capturedAt:snapshot.capturedAt,metadataOnly:!!options.metadataOnly})]);sourceId=source.rows[0].id;
    // Each original is committed separately; restarts resume via hashes without retaining 2.6 GB in memory.
    for(const file of files){
      const sha=await fileHash(join(root,file.path));
      if(!options.metadataOnly){
        const existing=await db.query('SELECT sha256 FROM everrate.archive_blobs WHERE sha256=$1',[sha]);
        if(!existing.rowCount){const bytes=await readFile(join(root,file.path));if(hash(bytes)!==sha)throw new Error('Source file changed while archiving');await db.query('INSERT INTO everrate.archive_blobs(sha256,byte_size,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[sha,bytes.length,bytes]);report.archivedBytes+=bytes.length;}
      }
      const result=await db.query('INSERT INTO everrate.archive_files(source_id,relative_path,sha256,byte_size,blob_sha256) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,relative_path,sha256) DO UPDATE SET blob_sha256=coalesce(everrate.archive_files.blob_sha256,excluded.blob_sha256) RETURNING id',[sourceId,file.path,sha,file.size,options.metadataOnly?null:sha]);fileIds.set(file.path,result.rows[0].id);
    }
    await db.query('BEGIN');
    for(const [table,rows] of Object.entries(snapshot.tables))for(const row of rows)await db.query('INSERT INTO everrate.legacy_records(source_id,table_name,record_key,sha256,raw_record,captured_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[sourceId,table,rowKey(table,row),hash(json(row)),json(protectSecretRow(table,row)),snapshot.capturedAt]);
    for(const row of snapshot.tables.profiles||[])await rowImport('profiles',row,'users',async()=>{await db.query('INSERT INTO everrate.users(id,discord_id,display_name,avatar_url,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[row.id,row.discord_id||null,row.display_name||row.username,row.avatar_url||null,row.created_at]);return row.id;});
    for(const row of snapshot.tables.groups||[])await rowImport('groups',row,'groups',async()=>{await db.query('INSERT INTO everrate.groups(id,name,owner_id,invite_code,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[row.id,row.name,row.owner_id,randomBytes(24).toString('base64url'),row.created_at]);return row.id;});
    for(const row of snapshot.tables.group_members||[])await rowImport('group_members',row,'memberships',async()=>{await db.query('INSERT INTO everrate.memberships(group_id,user_id,role,joined_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.group_id,row.user_id,row.role,row.joined_at]);return row.group_id;});
    for(const [discordId,userId] of Object.entries(authors)){
      if(!(await db.query('SELECT id FROM everrate.users WHERE id=$1',[userId])).rowCount){await issue('alias:'+discordId,'alias_profile_missing',{discordId,userId});continue;}
      const old=await db.query('SELECT user_id FROM everrate.legacy_aliases WHERE discord_id=$1',[discordId]);
      if(old.rowCount&&old.rows[0].user_id!==userId){await issue('alias:'+discordId,'alias_conflict',{discordId,userId});continue;}
      await db.query('INSERT INTO everrate.legacy_aliases(discord_id,user_id,source_id,evidence) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[discordId,userId,sourceId,'authors.json; intentional same-person alias documented in create-profiles.ts']);
    }
    const category=new Map((snapshot.tables.categories||[]).map(row=>[row.id,row]));
    for(const row of snapshot.tables.items||[])await rowImport('items',row,'items',async()=>{
      const photoId=await photo(row.image_url,row.group_id,row.created_by);
      await db.query('INSERT INTO everrate.items(id,group_id,name,broad_category,identity_key,created_by,created_at,legacy_metadata,legacy_photo_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[row.id,row.group_id,row.name,category.get(row.category_id)?.slug||null,identityKey(row.name,null,null),row.created_by,row.created_at,json(row),photoId]);return row.id;
    });
    for(const row of snapshot.tables.ratings||[])await rowImport('ratings',row,'ratings',async()=>{
      const photoId=await photo(row.photo_url,row.group_id,row.user_id);
      const tastedAt=row.visited_at?`${(row.visited_at instanceof Date?row.visited_at.toISOString():String(row.visited_at)).slice(0,10)}T12:00:00Z`:row.created_at;
      if(!photoId)await issue('rating:'+row.id,'legacy_rating_photo_missing',row);
      await db.query('INSERT INTO everrate.ratings(id,group_id,item_id,user_id,score,note,tasted_at,photo_id,source,source_message_id,created_at,updated_at,legacy_metadata,legacy_photo_missing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'import\',$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING',[row.id,row.group_id,row.item_id,row.user_id,row.score,row.comment||null,tastedAt,photoId,row.discord_message_id||null,row.created_at,row.updated_at||row.created_at,json(row),!photoId]);return row.id;
    });
    for(const row of snapshot.tables.rating_history||[])await rowImport('rating_history',row,'rating_revisions',async()=>{
      await db.query("INSERT INTO everrate.rating_revisions(id,rating_id,actor_id,action,previous_value,created_at) VALUES($1,$2,NULL,'update',$3,$4) ON CONFLICT(id) DO NOTHING",[row.id,row.rating_id,json(row),row.changed_at]);return row.id;
    });
    const ratings=new Map((snapshot.tables.ratings||[]).map(row=>[row.id,row]));
    for(const row of snapshot.tables.comments||[])await rowImport('comments',row,'comments',async()=>{
      await db.query('INSERT INTO everrate.comments(id,group_id,rating_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[row.id,ratings.get(row.rating_id)?.group_id,row.rating_id,row.user_id,row.body,row.created_at]);return row.id;
    });
    for(const row of ambiguousItems)await issue('item:'+row.id,'legacy_item_requires_reconciliation',{...row,evidence:'cleanup-plan.md: Unresolved'});
    for(const message of messages){
      await db.query('INSERT INTO everrate.archive_messages(source_id,message_id,channel_id,author_discord_id,sent_at,sha256,raw_record) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[sourceId,message.id,message.channelId||null,message.authorId||null,message.createdAt||null,hash(json(message)),json(message)]);
      for(const [ordinal,attachment] of (message.attachments||[]).entries()){
        const path=attachmentRelativePath(attachment.localPath||''),fileId=path?fileIds.get(path):null;
        await db.query('INSERT INTO everrate.archive_attachments(source_id,message_id,attachment_id,ordinal,sha256,raw_record,archive_file_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[sourceId,message.id,attachment.id||String(ordinal),ordinal,hash(json(attachment)),json(attachment),fileId||null]);
        if(!fileId)await issue(`attachment:${message.id}:${ordinal}`,'attachment_file_missing',attachment);
        if(path&&ambiguousPaths.has(path))await issue(`attachment:${message.id}:${ordinal}`,'attachment_original_bytes_ambiguous',attachment);
      }
    }
    const byMessage=new Map((snapshot.tables.ratings||[]).filter(row=>row.discord_message_id).map(row=>[row.discord_message_id,row.id]));
    for(const filename of ['import-ready.json','proposed.json','unparsed.json']){
      const records:Row[]=await optionalJson(join(root,filename),[]);if(!Array.isArray(records))continue;
      for(const [index,row] of records.entries()){
        const linked=byMessage.get(row.discordMessageId),key=String(row.discordMessageId||row.messageId||index);
        const disposition=linked?'represented_by_live_rating':'archived_unresolved';
        await db.query('INSERT INTO everrate.archive_proposals(source_id,source_file,record_key,sha256,raw_record,disposition,linked_rating_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[sourceId,filename,key,hash(json(row)),json(row),disposition,linked||null]);
        if(filename==='import-ready.json'&&!linked)await issue(`proposal:${key}`,'proposal_not_promoted_without_event_proof',row);
      }
    }
    const counts=await db.query('SELECT count(*)::int n FROM everrate.import_issues WHERE source_id=$1 AND resolved_at IS NULL',[sourceId]);report.issueCount=counts.rows[0].n;
    const imported=await db.query("SELECT count(*)::int n FROM everrate.legacy_import_links WHERE source_id=$1 AND target_table='ratings'",[sourceId]);
    await db.query('UPDATE everrate.import_sources SET status=$2,imported_count=$3,metadata=$4,completed_at=now() WHERE id=$1',[sourceId,options.metadataOnly?'metadata_only':report.issueCount?'completed_with_issues':'completed',imported.rows[0].n,json(report)]);
    await db.query('COMMIT');return report;
  }catch(error){await db.query('ROLLBACK');if(sourceId)await db.query("UPDATE everrate.import_sources SET status='failed' WHERE id=$1",[sourceId]);throw error;}
  finally{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['legacy-import:'+snapshot.sourceKey]);db.release();await pool.end();}
}
async function main(){
  const snapshot=await loadLegacySnapshot();
  const report=await importLegacy({snapshot,targetUrl:process.env.DATABASE_URL||'postgresql://localhost/everrate',sourceDir:process.env.LEGACY_EXPORT_DIR||'.private/legacy-export',apply:process.argv.includes('--apply'),metadataOnly:process.argv.includes('--metadata-only')});
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]?.endsWith('import-legacy.ts'))main().catch(error=>{console.error('Legacy import failed:',(error as NodeJS.ErrnoException).code||'validation_or_processing_error');process.exitCode=1;});
