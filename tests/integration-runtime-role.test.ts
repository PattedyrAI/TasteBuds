import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import * as service from '../src/server/service';
import {getPool} from '../src/server/db';
import {getPhoto,uploadPhoto} from '../src/server/photos';
import {connectDiscord} from '../src/server/discord';
import {runtimeRole} from '../scripts/provision-runtime-role';

// Deliberately opt-in: the other *_test names include frozen import/preview data.
const fixtureUrl=process.env.RUNTIME_ROLE_TEST_DATABASE_URL;
function assertFixture(value:string){
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/everrate_test'||[...url.searchParams].length)throw new Error('Runtime-role integration requires only the disposable local everrate_test database without overrides');
  return url;
}
const admin=fixtureUrl?new Pool({connectionString:assertFixture(fixtureUrl).toString(),max:1}):undefined;
let appUrl:string;
const owners=[randomUUID(),randomUUID(),randomUUID()];
const groups:string[]=[];
const fetchTrap=vi.fn(async()=>{throw new Error('Network is forbidden in runtime-role CRUD tests');});
// Same grants reviewed in provision-runtime-role.ts; never change the cluster role or its password.
const mutable=['users','groups','memberships','brands','item_types','items','photos','ratings','comments','recognition_jobs','discord_connections','discord_outbox','saved_items'];

describe.skipIf(!fixtureUrl)('real application CRUD through restricted everrate_app connections',()=>{
  beforeAll(async()=>{
    expect((await admin!.query('SELECT current_database() name')).rows[0].name).toBe('everrate_test');
    const attrs=(await admin!.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[runtimeRole])).rows[0];
    expect(attrs).toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false,rolreplication:false,rolbypassrls:false});
    const tx=await admin!.connect();
    try{
      await tx.query('BEGIN');
      await tx.query(`REVOKE ALL ON SCHEMA everrate FROM ${runtimeRole}`);
      await tx.query(`REVOKE ALL ON ALL TABLES IN SCHEMA everrate FROM ${runtimeRole}`);
      await tx.query(`GRANT USAGE ON SCHEMA everrate TO ${runtimeRole}`);
      for(const table of mutable)await tx.query(`GRANT SELECT,INSERT,UPDATE ON everrate.${table} TO ${runtimeRole}`);
      await tx.query(`GRANT SELECT ON everrate.legacy_aliases TO ${runtimeRole}`);
      await tx.query(`GRANT SELECT,INSERT,DELETE ON everrate.rating_photos TO ${runtimeRole}`);
      await tx.query(`GRANT DELETE ON everrate.memberships TO ${runtimeRole}`);
      await tx.query(`GRANT INSERT ON everrate.rating_revisions,everrate.audit_events TO ${runtimeRole}`);
      await tx.query('COMMIT');
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
    const connection=assertFixture(fixtureUrl!);connection.username=runtimeRole;connection.password='';appUrl=connection.toString();
    // The isolated local PostgreSQL fixture uses trust authentication; the database session still
    // authenticates as everrate_app. No admin connection or SET ROLE is used by the services.
    vi.stubEnv('DATABASE_URL',appUrl);vi.stubEnv('DISCORD_ENCRYPTION_KEY','ab'.repeat(32));vi.stubEnv('APP_URL','https://example.test');
    vi.stubGlobal('fetch',fetchTrap);
    expect((await getPool().query('SELECT session_user,current_user,current_database() database')).rows[0]).toEqual({session_user:runtimeRole,current_user:runtimeRole,database:'everrate_test'});
    for(const [index,id] of owners.entries())await service.ensureUser({id,displayName:`Runtime fixture ${index}`});
  });
  afterAll(async()=>{
    if(admin&&groups.length){
      const tx=await admin.connect();
      try{
        await tx.query('BEGIN');
        for(const table of ['rating_photos','audit_events','discord_outbox','discord_connections','comments','saved_items'])await tx.query(`DELETE FROM everrate.${table} WHERE group_id=ANY($1::uuid[])`,[groups]);
        await tx.query('DELETE FROM everrate.rating_revisions WHERE rating_id IN (SELECT id FROM everrate.ratings WHERE group_id=ANY($1::uuid[]))',[groups]);
        for(const table of ['ratings','recognition_jobs','items','photos','brands','item_types','memberships'])await tx.query(`DELETE FROM everrate.${table} WHERE group_id=ANY($1::uuid[])`,[groups]);
        await tx.query('DELETE FROM everrate.groups WHERE id=ANY($1::uuid[])',[groups]);
        await tx.query('DELETE FROM everrate.users WHERE id=ANY($1::uuid[])',[owners]);
        await tx.query('COMMIT');
      }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
    }
    await getPool().end();await admin?.end();vi.unstubAllGlobals();vi.unstubAllEnvs();
  });
  it('retains denied archive, deletion, audit rewrite and schema permissions during real connections',async()=>{
    await expect(getPool().query('SELECT 1 FROM everrate.legacy_aliases LIMIT 0')).resolves.toBeDefined();
    for(const sql of [
      'SELECT 1 FROM everrate.archive_messages LIMIT 0',
      'SELECT 1 FROM everrate.legacy_records LIMIT 0',
      'UPDATE everrate.legacy_aliases SET evidence=\'forbidden\' WHERE false',
      'DELETE FROM everrate.legacy_aliases WHERE false',
      'DELETE FROM everrate.ratings WHERE false',
      'DELETE FROM everrate.saved_items WHERE false',
      "UPDATE everrate.audit_events SET action='forbidden' WHERE false",
      'DELETE FROM everrate.rating_revisions WHERE false',
    ])await expect(getPool().query(sql)).rejects.toMatchObject({code:'42501'});
    expect((await getPool().query("SELECT has_schema_privilege(current_user,'everrate','CREATE') allowed")).rows[0].allowed).toBe(false);
  });
  it('resolves an existing Discord history through the restricted role',async()=>{
    const discordId=String(BigInt('0x'+owners[0].replaceAll('-','').slice(0,15)));
    await service.ensureUser({id:owners[0],discordId,displayName:'Original runtime handle'});
    const authId=randomUUID();
    expect(await service.ensureUser({id:authId,discordId,displayName:'New runtime handle'})).toMatchObject({id:owners[0],discordId});
    expect((await getPool().query('SELECT id FROM everrate.users WHERE id=$1',[authId])).rowCount).toBe(0);
  });
  it('persists groups, real photos, repeat/edit/delete history, comments and a durable outbox',async()=>{
    const [owner,member,outsider]=owners;
    const group=await service.createGroup(owner,{name:'Runtime CRUD '+randomUUID()});groups.push(group.id);
    await service.joinGroup(member,{code:group.inviteCode!});
    expect((await service.bootstrap(member)).groups.map(row=>row.id)).toContain(group.id);
    await expect(service.getGroup(outsider,group.id)).rejects.toMatchObject({status:404});
    await connectDiscord(owner,group.id,{url:'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',enabled:true});
    const photos=[];
    for(const [index,user] of [owner,owner,member].entries()){
      const data=await sharp({create:{width:24,height:24,channels:3,background:{r:20+index*30,g:40,b:60}}}).png().toBuffer();
      photos.push(await uploadPhoto(user,group.id,data));
    }
    expect(new Set(photos.map(photo=>photo.id)).size).toBe(3);
    expect((await getPhoto(member,photos[0].id)).mime_type).toBe('image/jpeg');
    await expect(getPhoto(outsider,photos[0].id)).rejects.toMatchObject({status:404});
    const first=await service.createRating(owner,{groupId:group.id,name:'Mango',brand:'Fixture maker',type:'Energy drink',score:2,note:'First tasting',tastedAt:'2026-01-01T12:00:00Z',photoId:photos[0].id,idempotencyKey:randomUUID()});
    // Imported reviews can reference a photo stored under another canonical user.
    await admin!.query('UPDATE everrate.photos SET owner_id=$1 WHERE id=$2',[member,photos[0].id]);
    const repeatedInput={groupId:group.id,itemId:first.itemId,rereviewOf:first.id,score:8,note:'Second tasting',tastedAt:'2026-01-02T12:00:00Z',photoId:photos[0].id,idempotencyKey:randomUUID()};
    const repeated=await service.createRating(owner,repeatedInput);
    expect((await service.createRating(owner,repeatedInput)).id).toBe(repeated.id);
    const other=await service.createRating(member,{groupId:group.id,itemId:first.itemId,score:6,tastedAt:'2026-01-02T13:00:00Z',photoId:photos[2].id});
    expect(await service.saveItem(member,first.itemId,true)).toEqual({saved:true});
    expect(await service.saveItem(member,first.itemId,true)).toEqual({saved:true});
    expect(await service.getItem(member,first.itemId)).toMatchObject({average:7,raterCount:2,tastingCount:3,type:'Energy drinks',myScore:6,saved:true});
    expect(await service.getItem(owner,first.itemId)).toMatchObject({myScore:8,saved:false});
    expect(await service.getTasteInsights(owner,group.id)).toEqual({matches:[],divisive:[]});
    expect(await service.saveItem(member,first.itemId,false)).toEqual({saved:false});
    await expect(service.saveItem(outsider,first.itemId,true)).rejects.toMatchObject({status:404});
    await expect(service.updateRating(member,first.id,{score:10})).rejects.toMatchObject({status:403});
    expect((await service.updateRating(owner,first.id,{score:3,note:'Corrected first tasting'})).score).toBe(3);
    expect((await service.updateRating(owner,repeated.id,{score:9})).score).toBe(9);
    expect((await service.getItem(owner,first.itemId)).average).toBe(7.5);
    const comment=await service.addComment(member,repeated.id,{body:'First comment'});
    expect((await service.updateComment(member,comment.id,{body:'Corrected comment'})).body).toBe('Corrected comment');
    await expect(service.updateComment(outsider,comment.id,{body:'Forbidden'})).rejects.toMatchObject({status:404});
    expect((await service.getItem(owner,first.itemId)).ratings.find(row=>row.id===repeated.id)?.comments[0].body).toBe('Corrected comment');
    await service.deleteComment(owner,comment.id);
    expect((await service.updateItem(owner,first.itemId,{name:'Mango edition',brand:'Fixture maker',variant:'Zero',type:'Energy drinks'})).name).toBe('Mango edition');
    expect((await service.listItems(member,group.id,{search:'Mango edition',brand:'Fixture maker',type:'Energy drinks'})).map(row=>row.id)).toEqual([first.itemId]);
    await service.deleteRating(owner,repeated.id);
    const current=await service.getItem(member,first.itemId);
    expect(current).toMatchObject({average:4.5,tastingCount:2,raterCount:2});
    expect(current.ratings.map(row=>row.id).sort()).toEqual([first.id,other.id].sort());
    const observer=new Pool({connectionString:appUrl,max:1});
    try{
      const saved=await observer.query('SELECT id,item_id,deleted_at FROM everrate.ratings WHERE group_id=$1',[group.id]);
      expect(saved.rowCount).toBe(3);expect(saved.rows.find(row=>row.id===repeated.id).deleted_at).not.toBeNull();
      const outbox=await observer.query('SELECT rating_id,status,payload FROM everrate.discord_outbox WHERE group_id=$1',[group.id]);
      expect(outbox.rowCount).toBe(3);expect(outbox.rows.find(row=>row.rating_id===repeated.id).status).toBe('cancelled');
      expect(outbox.rows.filter(row=>row.status==='pending')).toHaveLength(2);
      expect(outbox.rows.find(row=>row.rating_id===first.id).payload).toMatchObject({ratingId:first.id,itemId:first.itemId,itemName:'Mango',score:2});
    }finally{await observer.end();}
    const revisions=await admin!.query('SELECT action,previous_value FROM everrate.rating_revisions WHERE rating_id=ANY($1::uuid[])',[ [first.id,repeated.id] ]);
    expect(revisions.rowCount).toBe(3);expect(revisions.rows.filter(row=>row.action==='update')).toHaveLength(2);expect(revisions.rows.filter(row=>row.action==='delete')).toHaveLength(1);
    const audit=await admin!.query('SELECT action FROM everrate.audit_events WHERE group_id=$1',[group.id]);
    expect(audit.rows.map(row=>row.action)).toEqual(expect.arrayContaining(['group.create','rating.update','rating.delete','comment.update','comment.delete','item.update','discord.connection.updated']));
    await service.removeMember(owner,group.id,member);
    await expect(service.getItem(member,first.itemId)).rejects.toMatchObject({status:404});
    expect(fetchTrap).not.toHaveBeenCalled();
  });
});
