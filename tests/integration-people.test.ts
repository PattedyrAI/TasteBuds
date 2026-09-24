import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';
import {createCategory} from '../src/server/services/categories';

const url=process.env.PEOPLE_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['postgres:','postgresql:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!target.pathname.endsWith('_test')||target.search)throw new Error('Use a local disposable PEOPLE_TEST_DATABASE_URL');}
describe.skipIf(!url)('group People and complete person history',()=>{
  let admin:Pool,database:string,groupId:string,otherGroupId:string,invite:string;
  const owner=randomUUID(),person=randomUUID(),quiet=randomUUID(),outsider=randomUUID(),former=randomUUID();
  let first:string,second:string,third:string,otherPerson:string,otherGroup:string,deleted:string,itemId:string;
  beforeAll(async()=>{
    admin=new Pool({connectionString:url});database='everrate_people_'+randomUUID().replaceAll('-','')+'_test';
    await admin.query(`CREATE DATABASE "${database}"`);
    const target=new URL(url!);target.pathname='/'+database;await migrate(target.toString());process.env.DATABASE_URL=target.toString();
    for(const [id,name] of [[owner,'Owner'],[person,'Canonical reviewer'],[quiet,'No ratings yet'],[outsider,'Outsider'],[former,'Former member']])await service.ensureUser({id,displayName:name,...(id===person?{discordId:'998877665544332211'}:{})});
    const group=await service.createGroup(owner,{name:'People fixture'});groupId=group.id;invite=group.inviteCode!;
    await createCategory(owner,groupId,{name:'Tea',fields:[]});
    for(const id of [person,quiet,former])await service.joinGroup(id,{code:invite});
    const other=await service.createGroup(person,{name:'Other private group'});otherGroupId=other.id;
    const photo=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,person,Buffer.from('fixture'),'a'.repeat(64)])).rows[0].id;
    const one=await service.createRating(person,{groupId,name:'Repeated tea',brand:'Fixture brand',type:'Tea',score:4,photoId:photo,tastedAt:'2025-01-01T12:00:00.000Z'});first=one.id;itemId=one.itemId;
    second=(await service.createRating(person,{groupId,itemId,score:7.5,photoId:photo,tastedAt:'2025-01-02T12:00:00.000Z'})).id;
    third=(await service.createRating(person,{groupId,name:'Another drink',type:'Tea',score:9,photoId:photo,tastedAt:'2025-01-02T12:00:00.000Z'})).id;
    await getPool().query("UPDATE everrate.ratings SET created_at=CASE WHEN id=$1 THEN '2025-01-03T12:00:00.123456Z'::timestamptz ELSE '2025-01-03T12:00:00.123457Z'::timestamptz END WHERE id=ANY($2::uuid[])",[second,[second,third]]);
    deleted=(await service.createRating(person,{groupId,itemId,score:2,photoId:photo})).id;await service.deleteRating(person,deleted);
    const ownerPhoto=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[groupId,owner,Buffer.from('owner'),'b'.repeat(64)])).rows[0].id;
    otherPerson=(await service.createRating(owner,{groupId,itemId,score:8,photoId:ownerPhoto})).id;
    const outsidePhoto=(await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[otherGroupId,person,Buffer.from('outside'),'c'.repeat(64)])).rows[0].id;
    otherGroup=(await service.createRating(person,{groupId:otherGroupId,name:'Private elsewhere',score:10,photoId:outsidePhoto})).id;
    await service.removeMember(owner,groupId,former);
  });
  afterAll(async()=>{if(database){await getPool().end();await admin.query(`DROP DATABASE "${database}"`);}await admin?.end();});
  it('lists every active current reviewer once with group-only counts and no Discord identifiers',async()=>{
    const people=await service.listPeople(owner,groupId);
    expect(people.map(p=>p.id).sort()).toEqual([owner,person].sort());
    expect(people.find(p=>p.id===person)).toMatchObject({displayName:'Canonical reviewer',ratingCount:3,itemCount:2});
    expect(people.find(p=>p.id===quiet)).toBeUndefined();
    expect(JSON.stringify(people)).not.toContain('998877665544332211');
    expect(people.every(p=>!('discordId' in p))).toBe(true);
  });
  it('returns all repeat tastings across cursor pages without duplicate or missing IDs',async()=>{
    const page1=await service.getPersonRatings(owner,groupId,person,{limit:2});
    expect(page1.person).toMatchObject({id:person,ratingCount:3,itemCount:2});
    expect(page1.ratings.map(r=>r.id)).toEqual([third,second]);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2=await service.getPersonRatings(owner,groupId,person,{limit:2,cursor:page1.nextCursor!});
    expect(page2.ratings.map(r=>r.id)).toEqual([first]);expect(page2.nextCursor).toBeNull();
    const all=[...page1.ratings,...page2.ratings];expect(new Set(all.map(r=>r.id)).size).toBe(3);
    expect(all.filter(r=>r.itemId===itemId)).toHaveLength(2);
    expect(all.map(r=>r.id)).not.toEqual(expect.arrayContaining([otherPerson,otherGroup,deleted]));
    expect(all.find(r=>r.id===second)).toMatchObject({score:7.5,itemName:'Repeated tea',brand:'Fixture brand',photoId:expect.any(String)});
    expect(JSON.stringify(page1)).not.toContain('998877665544332211');
  });
  it('gives current members with no ratings an empty complete history',async()=>{
    expect(await service.getPersonRatings(owner,groupId,quiet)).toMatchObject({person:{id:quiet,ratingCount:0,itemCount:0},ratings:[],nextCursor:null});
  });
  it('does not skip ratings created within the same millisecond at a page boundary',async()=>{
    const ids:string[]=[];let cursor:string|undefined;
    do {
      const page=await service.getPersonRatings(owner,groupId,person,{limit:1,cursor});
      ids.push(...page.ratings.map(r=>r.id));cursor=page.nextCursor??undefined;
    }while(cursor);
    expect(ids).toEqual([third,second,first]);
  });
  it('denies outsiders, cross-group targets, and former members without exposing history',async()=>{
    await expect(service.listPeople(outsider,groupId)).rejects.toMatchObject({status:404});
    await expect(service.getPersonRatings(outsider,groupId,person)).rejects.toMatchObject({status:404});
    await expect(service.getPersonRatings(owner,groupId,outsider)).rejects.toMatchObject({status:404});
    await expect(service.getPersonRatings(owner,groupId,former)).rejects.toMatchObject({status:404});
    await expect(service.getPersonRatings(owner,otherGroupId,person)).rejects.toMatchObject({status:404});
  });
  it('rejects malformed IDs and cursors and bounds page size',async()=>{
    await expect(service.getPersonRatings(owner,groupId,'not-a-user')).rejects.toMatchObject({status:400});
    await expect(service.getPersonRatings(owner,groupId,person,{limit:101})).rejects.toMatchObject({status:400});
    await expect(service.getPersonRatings(owner,groupId,person,{cursor:'not-valid-json'})).rejects.toMatchObject({status:400});
  });
});
