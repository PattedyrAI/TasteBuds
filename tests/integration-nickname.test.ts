import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';

const url=process.env.TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['postgres:','postgresql:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!target.pathname.endsWith('_test')||target.search)throw Error('Local disposable test database required');}
describe.skipIf(!url)('self-selected nicknames preserve canonical history',()=>{
 let admin:Pool,database:string,groupId:string,photoId:string,itemId:string;
 const person=randomUUID(),other=randomUUID(),provider='900000000000000301';
 beforeAll(async()=>{
  admin=new Pool({connectionString:url});database='everrate_nickname_'+randomUUID().replaceAll('-','')+'_test';await admin.query(`CREATE DATABASE "${database}"`);
  const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();
  await service.ensureUser({id:person,discordId:provider,displayName:'Discord fixture name'});await service.ensureUser({id:other,displayName:'Other reviewer'});
  const group=await service.createGroup(person,{name:'Nickname fixture'});groupId=group.id;await service.joinGroup(other,{code:group.inviteCode!});
  photoId=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,person,Buffer.from('fixture'),'a'.repeat(64)])).rows[0].id;
  const first=await service.createRating(person,{groupId,name:'Tea',score:6,photoId});itemId=first.itemId;
  await service.createRating(person,{groupId,itemId,score:8,photoId});await service.addComment(person,first.id,{body:'My earlier tasting'});
 });
 afterAll(async()=>{if(database){await getPool().end();await admin.query(`DROP DATABASE "${database}"`);}await admin?.end();});
 async function preserved(){const result:Record<string,unknown>={};for(const table of ['ratings','rating_revisions','comments','groups','memberships','legacy_aliases'])result[table]=(await getPool().query(`SELECT to_jsonb(t) row FROM everrate.${table} t ORDER BY to_jsonb(t)::text`)).rows;return result;}
 it('marks unset nicknames explicitly and falls back to the Discord display name',async()=>{expect((await service.bootstrap(person)).user).toMatchObject({id:person,nickname:null,displayName:'Discord fixture name'});});
 it('updates every historical author/person/member projection without rewriting identity or review rows',async()=>{
  const before=await preserved(),oldUser=(await getPool().query('SELECT to_jsonb(u) row FROM everrate.users u WHERE id=$1',[person])).rows[0].row;
  expect(await service.updateNickname(person,{nickname:'  Tea friend  '})).toMatchObject({id:person,nickname:'Tea friend',displayName:'Tea friend',discordId:provider});
  expect(await preserved()).toEqual(before);const nextUser=(await getPool().query('SELECT to_jsonb(u) row FROM everrate.users u WHERE id=$1',[person])).rows[0].row;
  expect({...nextUser,nickname:oldUser.nickname}).toEqual(oldUser);
  expect((await service.bootstrap(person)).user.displayName).toBe('Tea friend');
  expect((await service.getGroup(other,groupId)).members.find(m=>m.id===person)?.displayName).toBe('Tea friend');
  const item=await service.getItem(other,itemId);expect(item.ratings).toHaveLength(2);expect(item.ratings.every(r=>r.author.displayName==='Tea friend'&&r.author.nickname==='Tea friend')).toBe(true);
  expect(item.ratings.flatMap(r=>r.comments)[0].author.displayName).toBe('Tea friend');expect((await service.getFeed(other,groupId)).every(r=>r.author.displayName==='Tea friend')).toBe(true);
  expect((await service.listPeople(other,groupId)).find(p=>p.id===person)?.displayName).toBe('Tea friend');expect((await service.getPersonRatings(other,groupId,person)).person.displayName).toBe('Tea friend');
 });
 it('keeps the nickname through Discord profile refresh and concurrent login/update',async()=>{
  expect(await service.ensureUser({id:randomUUID(),discordId:provider,displayName:'New Discord fixture name'})).toMatchObject({id:person,nickname:'Tea friend',displayName:'Tea friend'});
  await Promise.all([service.ensureUser({id:randomUUID(),discordId:provider,displayName:'Latest provider name'}),service.updateNickname(person,{nickname:'Evening taster'})]);
  expect((await service.bootstrap(person)).user).toMatchObject({id:person,nickname:'Evening taster',displayName:'Evening taster'});
  expect((await getPool().query('SELECT display_name FROM everrate.users WHERE id=$1',[person])).rows[0].display_name).toBe('Latest provider name');
 });
 it('rejects unknown body fields, blank/oversized/missing/null nicknames and missing users without changes',async()=>{
  const before=(await service.bootstrap(person)).user;
  for(const value of [{nickname:''},{nickname:' \t\n '},{nickname:'x'.repeat(41)},{nickname:'two\nlines'},{nickname:'tab\tname'},{nickname:'line\u2028break'},{nickname:'null\0byte'},{nickname:null},{},{nickname:'Hijack',userId:other},{nickname:'Hijack',id:other},{nickname:'Hijack',discordId:provider}])await expect(service.updateNickname(person,value)).rejects.toMatchObject({status:400});
  await expect(service.updateNickname(randomUUID(),{nickname:'Missing'})).rejects.toMatchObject({status:404});expect((await service.bootstrap(person)).user).toEqual(before);expect((await service.bootstrap(other)).user.nickname).toBeNull();
 });
 it('allows duplicate nicknames and the exact trimmed length boundaries',async()=>{
  await service.updateNickname(person,{nickname:'X'});await service.updateNickname(other,{nickname:'X'});expect((await service.bootstrap(other)).user.displayName).toBe('X');
  const maximum='N'.repeat(40);expect(await service.updateNickname(person,{nickname:' '+maximum+' '})).toMatchObject({nickname:maximum});
  expect(await service.updateNickname(person,{nickname:'  Taster ☕🧑‍🍳  '})).toMatchObject({nickname:'Taster ☕🧑‍🍳'});
 });
 it('enforces nickname shape at the database boundary too',async()=>{for(const nickname of ['', '   ',' padded','x'.repeat(41),'two\nlines','tab\tname','line\u2028break'])await expect(getPool().query('UPDATE everrate.users SET nickname=$2 WHERE id=$1',[person,nickname])).rejects.toMatchObject({code:'23514'});});
 it('queues newly written Discord author text using the nickname without announcing the rename',async()=>{
  expect((await getPool().query('SELECT count(*)::int n FROM everrate.discord_outbox')).rows[0].n).toBe(0);
  await service.updateNickname(person,{nickname:'Tea friend'});await getPool().query('INSERT INTO everrate.discord_connections(group_id,webhook_encrypted,enabled,updated_by) VALUES($1,$2,true,$3)',[groupId,'fixture-never-sent',person]);
  const rating=await service.createRating(person,{groupId,itemId,score:9,photoId});expect(rating.author.displayName).toBe('Tea friend');
  expect((await getPool().query('SELECT payload FROM everrate.discord_outbox WHERE rating_id=$1',[rating.id])).rows[0].payload.authorName).toBe('Tea friend');
 });
});
