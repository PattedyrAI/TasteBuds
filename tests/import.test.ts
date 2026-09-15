import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {assertLocalTarget,attachmentRelativePath,importLegacy,type LegacySnapshot} from '../scripts/import-legacy';
describe('legacy import safety',()=>{
  it('rejects remote apply targets and unsafe local attachment paths',()=>{
    expect(()=>assertLocalTarget('postgresql://user@remote.example/db')).toThrow();
    expect(()=>assertLocalTarget('postgresql://user@127.0.0.1/everrate_test')).not.toThrow();
    expect(attachmentRelativePath('/old/export/out/attachments/123-photo.jpg')).toBe('attachments/123-photo.jpg');
    expect(attachmentRelativePath('../../secret')).toBeNull();
    expect(attachmentRelativePath('https://attacker.example/private')).toBeNull();
  });
});
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw new Error('Use a disposable local _test database');
describe.skipIf(!url)('lossless local legacy import',()=>{
  let dir:string;let db:Pool;let snapshot:LegacySnapshot;
  const discord=String(Date.now())+'111',alias=String(Date.now())+'222';
  const ids={user:randomUUID(),group:randomUUID(),item:randomUUID(),rating:randomUUID(),history:randomUUID(),category:randomUUID(),comment:randomUUID()};
  beforeAll(async()=>{
    dir=await mkdtemp(join(tmpdir(),'everrate-import-'));await mkdir(join(dir,'attachments'));
    const bytes=await sharp({create:{width:3,height:2,channels:3,background:'#aabbcc'}}).png().toBuffer();
    await writeFile(join(dir,'attachments','123-photo.png'),bytes);
    const photo='https://legacy.example/storage/v1/object/public/rating-photos/discord-import/123-123-photo.png';
    await writeFile(join(dir,'messages.json'),JSON.stringify([{id:'123',channelId:'456',authorId:discord,createdAt:'2025-01-01T00:00:00Z',content:'Tea 7/10',attachments:[{id:'99',filename:'photo.png',localPath:'/old/out/attachments/123-photo.png',url:'https://cdn.example/old'}]}]));
    await writeFile(join(dir,'authors.json'),JSON.stringify({[discord]:ids.user,[alias]:ids.user}));
    await writeFile(join(dir,'import-ready.json'),JSON.stringify([{messageId:'123',discordMessageId:'123#0',authorId:discord,score:7,itemName:'Tea',createdAt:'2025-01-01T00:00:00Z'},{messageId:'deleted',discordMessageId:'deleted#0',authorId:discord,score:2,itemName:'Removed',createdAt:'2024-01-01T00:00:00Z'}]));
    snapshot={sourceKey:'fixture:'+randomUUID(),capturedAt:new Date().toISOString(),tables:{
      profiles:[{id:ids.user,discord_id:discord,username:'historical',display_name:'Historical',created_at:'2024-01-01T00:00:00Z'}],
      groups:[{id:ids.group,owner_id:ids.user,name:'Preserved group',invite_code:'OLD123',created_at:'2024-01-01T00:00:00Z'}],
      group_members:[{group_id:ids.group,user_id:ids.user,role:'owner',joined_at:'2024-01-01T00:00:00Z'}],
      categories:[{id:ids.category,slug:'drinks',name:'Drinks'}],category_fields:[],group_webhooks:[],
      items:[{id:ids.item,group_id:ids.group,created_by:ids.user,category_id:ids.category,name:'Tea',created_at:'2024-01-01T00:00:00Z',metadata:{cuisine:'Unknown'},address:'Historical address',latitude:1,longitude:2,image_url:photo}],
      ratings:[{id:ids.rating,group_id:ids.group,item_id:ids.item,user_id:ids.user,score:7,comment:'Original',photo_url:photo,created_at:'2025-01-01T00:00:00Z',updated_at:'2025-01-02T00:00:00Z',source:'discord',discord_message_id:'123#0'}],
      rating_history:[{id:ids.history,rating_id:ids.rating,previous_score:5,previous_comment:'Previous',previous_photo_url:photo,changed_at:'2025-01-02T00:00:00Z'}],
      comments:[{id:ids.comment,rating_id:ids.rating,user_id:ids.user,body:'Comment',created_at:'2025-01-01T01:00:00Z'}],
    }};
    db=new Pool({connectionString:url});
  });
  afterAll(async()=>{await db?.end();if(dir)await rm(dir,{recursive:true,force:true});});
  it('dry-run writes nothing; apply archives bytes and preserves core IDs without resurrecting missing proposals',async()=>{
    const dry=await importLegacy({targetUrl:url!,sourceDir:dir,snapshot});
    expect(dry.applied).toBe(false);
    expect((await db.query('SELECT id FROM everrate.users WHERE id=$1',[ids.user])).rowCount).toBe(0);
    const result=await importLegacy({targetUrl:url!,sourceDir:dir,snapshot,apply:true});
    expect(result.applied).toBe(true);
    expect((await db.query('SELECT count(*)::int n FROM everrate.ratings WHERE group_id=$1',[ids.group])).rows[0].n).toBe(1);
    expect((await db.query('SELECT id,photo_id,legacy_metadata FROM everrate.ratings WHERE id=$1',[ids.rating])).rows[0]).toMatchObject({id:ids.rating,legacy_metadata:{discord_message_id:'123#0'}});
    expect((await db.query('SELECT photo_id FROM everrate.ratings WHERE id=$1',[ids.rating])).rows[0].photo_id).toBeTruthy();
    expect((await db.query('SELECT actor_id,previous_value FROM everrate.rating_revisions WHERE id=$1',[ids.history])).rows[0]).toMatchObject({actor_id:null,previous_value:{previous_score:5}});
    expect((await db.query('SELECT count(*)::int n FROM everrate.legacy_aliases WHERE user_id=$1',[ids.user])).rows[0].n).toBe(2);
    expect((await db.query('SELECT legacy_metadata FROM everrate.items WHERE id=$1',[ids.item])).rows[0].legacy_metadata).toMatchObject({address:'Historical address',latitude:1,metadata:{cuisine:'Unknown'}});
    expect((await db.query('SELECT count(*)::int n FROM everrate.discord_outbox WHERE group_id=$1',[ids.group])).rows[0].n).toBe(0);
    const archive=await db.query('SELECT b.data FROM everrate.archive_files f JOIN everrate.archive_blobs b ON b.sha256=f.blob_sha256 JOIN everrate.import_sources s ON s.id=f.source_id WHERE s.source_key=$1 AND f.relative_path=$2',[snapshot.sourceKey,'attachments/123-photo.png']);
    expect(archive.rows[0].data.length).toBeGreaterThan(0);
    await importLegacy({targetUrl:url!,sourceDir:dir,snapshot,apply:true});
    expect((await db.query('SELECT count(*)::int n FROM everrate.ratings WHERE group_id=$1',[ids.group])).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int n FROM everrate.rating_revisions WHERE rating_id=$1',[ids.rating])).rows[0].n).toBe(1);
  });
  it('preserves a historical photo exception with an explicit flag and import issue',async()=>{
    const id=randomUUID();
    snapshot.tables.ratings.push({...snapshot.tables.ratings[0],id,photo_url:null,discord_message_id:'unavailable#0'});
    await importLegacy({targetUrl:url!,sourceDir:dir,snapshot,apply:true});
    const row=(await db.query('SELECT photo_id,legacy_photo_missing FROM everrate.ratings WHERE id=$1',[id])).rows[0];
    expect(row).toEqual({photo_id:null,legacy_photo_missing:true});
    const issue=await db.query("SELECT id FROM everrate.import_issues WHERE source_record_id=$1 AND reason='legacy_rating_photo_missing'",['rating:'+id]);
    expect(issue.rowCount).toBe(1);
  });

  it('flags conflicting attachment identities that share one physical export file',async()=>{
    const messages=JSON.parse(await (await import('node:fs/promises')).readFile(join(dir,'messages.json'),'utf8'));
    messages[0].attachments.push({...messages[0].attachments[0],id:'different-attachment-id'});
    await writeFile(join(dir,'messages.json'),JSON.stringify(messages));
    const result=await importLegacy({targetUrl:url!,sourceDir:dir,snapshot,apply:true});
    expect(result.ambiguousAttachmentPaths).toBe(1);
    const issues=await db.query("SELECT count(*)::int n FROM everrate.import_issues i JOIN everrate.import_sources s ON s.id=i.source_id WHERE s.source_key=$1 AND i.reason='attachment_original_bytes_ambiguous'",[snapshot.sourceKey]);
    expect(issues.rows[0].n).toBe(2);
  });

});
