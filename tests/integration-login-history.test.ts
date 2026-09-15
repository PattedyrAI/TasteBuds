import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import {ensureUser,bootstrap,createGroup,createRating} from '../src/server/service';

const url=process.env.TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['postgres:','postgresql:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!target.pathname.endsWith('_test')||target.search)throw new Error('Local disposable test database required');}
describe.skipIf(!url)('verified Discord login preserves historical ownership',()=>{
 let admin:Pool,database:string,source:string;let sequence=0;
 const discord=()=>String(900000000000000000n+BigInt(++sequence));
 beforeAll(async()=>{admin=new Pool({connectionString:url});database='everrate_login_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();source=(await getPool().query("INSERT INTO everrate.import_sources(source_key,source_type) VALUES('login-fixture','test') RETURNING id")).rows[0].id;});
 afterAll(async()=>{if(database){await getPool().end();await admin.query(`DROP DATABASE "${database}"`);}await admin?.end();});
 async function historical(known?:{id:string;primary:string;alias:string}){const id=known?.id||randomUUID(),primary=known?.primary||discord(),alias=known?.alias||discord();await ensureUser({id,discordId:primary,displayName:'Historical handle'});await getPool().query('INSERT INTO everrate.legacy_aliases(discord_id,user_id,source_id,evidence) VALUES($1,$3,$4,\'reviewed alias\'),($2,$3,$4,\'reviewed alias\')',[primary,alias,id,source]);const group=await createGroup(id,{name:'Historical group'});const photo=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[group.id,id,Buffer.from('fixture'),'a'.repeat(64)])).rows[0].id;const rating=await createRating(id,{groupId:group.id,name:'Historical product',score:7.5,photoId:photo});return{id,primary,alias,group,rating};}
 it('resolves a new Auth UUID through the immutable primary Discord ID without moving history',async()=>{const old=await historical(),auth=randomUUID();const before=(await getPool().query('SELECT to_jsonb(r) row FROM everrate.ratings r WHERE id=$1',[old.rating.id])).rows[0].row;const account=await ensureUser({id:auth,discordId:old.primary,displayName:'Renamed handle'});expect(account.id).toBe(old.id);expect((await bootstrap(account.id)).groups.map(x=>x.id)).toContain(old.group.id);expect((await getPool().query('SELECT to_jsonb(r) row FROM everrate.ratings r WHERE id=$1',[old.rating.id])).rows[0].row).toEqual(before);expect((await getPool().query('SELECT id FROM everrate.users WHERE id=$1',[auth])).rowCount).toBe(0);});
 it('resolves a documented alternate Discord account and retains the primary ID',async()=>{const old=await historical(),auth=randomUUID();const account=await ensureUser({id:auth,discordId:old.alias,displayName:'Alternate handle'});expect(account).toMatchObject({id:old.id,discordId:old.primary});expect((await bootstrap(account.id)).groups[0].id).toBe(old.group.id);expect((await getPool().query('SELECT id FROM everrate.users WHERE id=$1',[auth])).rowCount).toBe(0);});
 it('preserves primary identity when the original Auth UUID logs in through its alias',async()=>{const old=await historical();expect(await ensureUser({id:old.id,discordId:old.alias,displayName:'Changed name'})).toMatchObject({id:old.id,discordId:old.primary});});
 it('fails closed when the Auth UUID and Discord identity belong to different users',async()=>{const a=await historical(),b=await historical();await expect(ensureUser({id:a.id,discordId:b.primary,displayName:'Conflict'})).rejects.toMatchObject({status:403});expect((await getPool().query('SELECT discord_id FROM everrate.users WHERE id=$1',[a.id])).rows[0].discord_id).toBe(a.primary);});
 it('rejects an unrecognized replacement Discord ID for an existing account',async()=>{const old=await historical();await expect(ensureUser({id:old.id,discordId:discord(),displayName:'Replacement'})).rejects.toMatchObject({status:403});});
 it('fails closed when primary and archived alias mappings disagree',async()=>{const a=await historical(),b=await historical();await getPool().query('UPDATE everrate.legacy_aliases SET user_id=$1 WHERE discord_id=$2',[a.id,b.primary]);await expect(ensureUser({id:randomUUID(),discordId:b.primary,displayName:'Conflict'})).rejects.toMatchObject({status:403});});
  it('serializes simultaneous first logins for one Discord identity',async()=>{const provider=discord();const accounts=await Promise.all(Array.from({length:6},()=>ensureUser({id:randomUUID(),discordId:provider,displayName:'Concurrent'})));expect(new Set(accounts.map(x=>x.id)).size).toBe(1);expect((await getPool().query('SELECT id FROM everrate.users WHERE discord_id=$1',[provider])).rowCount).toBe(1);});
  it('concurrent primary and alias logins keep one owner and unchanged memberships',async()=>{const old=await historical();const accounts=await Promise.all(Array.from({length:6},(_,i)=>ensureUser({id:randomUUID(),discordId:i%2?old.primary:old.alias,displayName:'Concurrent aliases'})));expect(accounts.every(x=>x.id===old.id&&x.discordId===old.primary)).toBe(true);expect((await bootstrap(old.id)).groups.map(x=>x.id)).toEqual([old.group.id]);});
  it('does not match an unrelated account by identical display name',async()=>{const old=await historical();const unrelated=await ensureUser({id:randomUUID(),discordId:discord(),displayName:'Historical handle'});expect(unrelated.id).not.toBe(old.id);expect((await bootstrap(unrelated.id)).groups).toEqual([]);});
  it('keeps the full review history across two linked accounts with new Auth UUIDs',async()=>{
    const old=await historical({id:'44444444-4444-4444-8444-444444444444',primary:'900000000000000201',alias:'900000000000000202'});
    await getPool().query(`INSERT INTO everrate.ratings(group_id,item_id,user_id,score,photo_id,tasted_at,note)
      SELECT group_id,item_id,user_id,score,photo_id,tasted_at-n*interval '1 day','Preserved historical review '||n FROM everrate.ratings CROSS JOIN generate_series(1,46) n WHERE id=$1`,[old.rating.id]);
    const history=async()=>(await getPool().query('SELECT to_jsonb(r) row FROM everrate.ratings r WHERE user_id=$1 ORDER BY id',[old.id])).rows;
    const before=await history();expect(before).toHaveLength(47);
    for(const [discordId,displayName]of [[old.primary,'Current fixture handle'],[old.alias,'Archived fixture handle']]){
      const authId=randomUUID();const account=await ensureUser({id:authId,discordId,displayName});
      expect(account).toMatchObject({id:old.id,discordId:old.primary});expect((await bootstrap(account.id)).groups.map(x=>x.id)).toEqual([old.group.id]);
      expect(await history()).toEqual(before);expect((await getPool().query('SELECT id FROM everrate.users WHERE id=$1',[authId])).rowCount).toBe(0);
    }
  });
});
