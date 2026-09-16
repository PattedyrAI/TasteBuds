import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {migrate} from '../scripts/migrate';
import {getPool} from '../src/server/db';
import * as service from '../src/server/service';
const url=process.env.TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.pathname!=='/everrate_test'||target.search)throw new Error('Use the disposable local everrate_test database');process.env.DATABASE_URL=url;}
describe.skipIf(!url)('personal discovery and authorized rereviews',()=>{
  const owner=randomUUID(),friend=randomUUID(),third=randomUUID(),outsider=randomUUID();
  let groupId:string,otherGroup:string,photoId:string,friendPhoto:string;
  async function photo(group:string,user:string){return (await getPool().query("INSERT INTO everrate.photos(group_id,owner_id,data,sha256,mime_type,width,height) VALUES($1,$2,$3,$4,'image/jpeg',1,1) RETURNING id",[group,user,Buffer.from('photo'),'a'.repeat(64)])).rows[0].id as string;}
  beforeAll(async()=>{
    await migrate(url);
    for(const [id,displayName] of [[owner,'Me'],[friend,'Friend'],[third,'Third'],[outsider,'Outsider']])await service.ensureUser({id,displayName});
    const group=await service.createGroup(owner,{name:'Discovery fixture'});groupId=group.id;
    for(const id of [friend,third])await service.joinGroup(id,{code:group.inviteCode!});
    otherGroup=(await service.createGroup(owner,{name:'Other discovery fixture'})).id;
    photoId=await photo(groupId,owner);friendPhoto=await photo(groupId,friend);
  });
  afterAll(async()=>{await getPool().end();});
  it('persists private idempotent saves, retains deleted-only saved items, and rejects outsiders',async()=>{
    const rating=await service.createRating(owner,{groupId,name:'Saved tea',score:6,photoId});
    expect(await service.saveItem(friend,rating.itemId,true)).toEqual({saved:true});
    expect(await service.saveItem(friend,rating.itemId,true)).toEqual({saved:true});
    expect((await getPool().query('SELECT count(*)::int n FROM everrate.saved_items WHERE item_id=$1',[rating.itemId])).rows[0].n).toBe(1);
    expect(await service.getItem(friend,rating.itemId)).toMatchObject({saved:true,myScore:null});
    expect(await service.getItem(owner,rating.itemId)).toMatchObject({saved:false,myScore:6});
    await expect(service.saveItem(outsider,rating.itemId,true)).rejects.toMatchObject({status:404});
    await service.deleteRating(owner,rating.id);
    expect((await service.listItems(friend,groupId)).map(i=>i.id)).toContain(rating.itemId);
    expect((await service.listItems(owner,groupId)).map(i=>i.id)).not.toContain(rating.itemId);
    expect(await service.saveItem(friend,rating.itemId,false)).toEqual({saved:false});
    expect(await service.saveItem(friend,rating.itemId,false)).toEqual({saved:false});
    expect((await service.listItems(friend,groupId)).map(i=>i.id)).not.toContain(rating.itemId);
    await expect(getPool().query('INSERT INTO everrate.saved_items(group_id,item_id,user_id) VALUES($1,$2,$3)',[otherGroup,rating.itemId,owner])).rejects.toMatchObject({code:'23503'});
  });
  it('selects personal latest score deterministically and falls back after deletion across list/get/update',async()=>{
    const a=await service.createRating(owner,{groupId,name:'Timeline',score:3,photoId,tastedAt:'2025-01-01T00:00:00Z'});
    const b=await service.createRating(owner,{groupId,itemId:a.itemId,score:9,photoId,tastedAt:'2025-01-02T00:00:00Z'});
    const c=await service.createRating(owner,{groupId,itemId:a.itemId,score:1,photoId,tastedAt:'2024-01-01T00:00:00Z'});
    expect((await service.listItems(owner,groupId)).find(i=>i.id===a.itemId)?.myScore).toBe(9);
    expect(await service.updateItem(owner,a.itemId,{name:'New timeline'})).toMatchObject({myScore:9,saved:false});
    await service.deleteRating(owner,b.id);
    expect(await service.getItem(owner,a.itemId)).toMatchObject({myScore:3});
    await getPool().query("UPDATE everrate.ratings SET tasted_at='2025-01-01',created_at='2025-01-01' WHERE id=ANY($1::uuid[])",[[a.id,c.id]]);
    expect((await service.getItem(owner,a.itemId)).myScore).toBe([a,c].sort((x,y)=>y.id.localeCompare(x.id))[0].score);
  });
  it('allows exact imported source photo only for its canonical author and keeps original history',async()=>{
    const original=await service.createRating(owner,{groupId,name:'Imported ownership',score:4,photoId,tastedAt:'2024-01-01T00:00:00Z'});
    await getPool().query('UPDATE everrate.ratings SET user_id=$1 WHERE id=$2',[friend,original.id]);
    const input={groupId,itemId:original.itemId,rereviewOf:original.id,score:8,photoId,idempotencyKey:randomUUID()};
    const repeated=await service.createRating(friend,input);
    expect((await service.createRating(friend,input)).id).toBe(repeated.id);
    expect(await service.getItem(friend,original.itemId)).toMatchObject({average:8,myScore:8,tastingCount:2});
    expect((await service.getItem(friend,original.itemId)).ratings.find(r=>r.id===original.id)).toMatchObject({score:4,photoId,countsTowardAverage:false});
    await expect(service.createRating(owner,{...input,idempotencyKey:undefined})).rejects.toMatchObject({status:404});
    await expect(service.createRating(friend,{...input,rereviewOf:undefined,idempotencyKey:undefined})).rejects.toMatchObject({status:404});
    await expect(service.createRating(friend,{...input,itemId:undefined,name:'Invalid',idempotencyKey:undefined})).rejects.toMatchObject({status:400});
    await expect(service.createRating(friend,{...input,itemId:randomUUID(),idempotencyKey:undefined})).rejects.toMatchObject({status:404});
    await expect(service.createRating(owner,{...input,groupId:otherGroup,idempotencyKey:undefined})).rejects.toMatchObject({status:404});
    expect((await service.createRating(friend,{...input,photoId:friendPhoto,idempotencyKey:undefined})).photoId).toBe(friendPhoto);
    const noPhoto=await service.createRating(friend,{groupId,name:'Missing legacy photo',score:5,photoId:friendPhoto});
    await getPool().query("UPDATE everrate.ratings SET photo_id=null,legacy_photo_missing=true,source='import' WHERE id=$1",[noPhoto.id]);
    await expect(service.createRating(friend,{...input,rereviewOf:noPhoto.id,itemId:noPhoto.itemId,idempotencyKey:undefined})).rejects.toMatchObject({status:404});
    const replacement=await service.createRating(friend,{...input,rereviewOf:noPhoto.id,itemId:noPhoto.itemId,photoId:friendPhoto,idempotencyKey:undefined});
    expect(replacement).toMatchObject({photoId:friendPhoto,score:8,legacyPhotoMissing:false});
    expect((await service.getItem(friend,noPhoto.itemId)).ratings.find(r=>r.id===noPhoto.id)).toMatchObject({photoId:null,legacyPhotoMissing:true,score:5});
    await service.deleteRating(friend,original.id);
    await expect(service.createRating(friend,{...input,idempotencyKey:undefined})).rejects.toMatchObject({status:404});
  });
  it('requires three shared latest scores, uses current members, and reports actual disagreements',async()=>{
    const group=await service.createGroup(owner,{name:'Taste-only fixture'});
    for(const id of [friend,third])await service.joinGroup(id,{code:group.inviteCode!});
    const p=await photo(group.id,owner),fp=await photo(group.id,friend),tp=await photo(group.id,third);
    const items:string[]=[];
    for(let index=0;index<3;index++){
      const r=await service.createRating(owner,{groupId:group.id,name:'Taste '+index,brand:'Maker',score:8,photoId:p});items.push(r.itemId);
      await service.createRating(friend,{groupId:group.id,itemId:r.itemId,score:index===0?2:9,photoId:fp,tastedAt:'2024-01-01T00:00:00Z'});
      if(index===0)await service.createRating(friend,{groupId:group.id,itemId:r.itemId,score:8,photoId:fp});
      await service.createRating(third,{groupId:group.id,itemId:r.itemId,score:2,photoId:tp});
      if(index===1)expect((await service.getTasteInsights(owner,group.id)).matches).toEqual([]);
    }
    const insight=await service.getTasteInsights(owner,group.id);
    expect(insight.matches.map(m=>m.person.id)).toEqual([friend,third]);
    expect(insight.matches[0]).toMatchObject({sharedCount:3,similarCount:3,meanDifference:2/3});
    expect(insight.matches[0].disagreements).toHaveLength(2);
    expect(insight.matches[0].disagreements.every(d=>d.difference===1)).toBe(true);
    expect(Object.keys(insight.matches[0].person).sort()).toEqual(['avatarUrl','displayName','id']);
    expect(insight.divisive).toHaveLength(3);expect(insight.divisive[0]).toMatchObject({lowScore:2,highScore:9,raterCount:3,brand:'Maker'});
    await service.removeMember(owner,group.id,third);
    expect((await service.getTasteInsights(owner,group.id)).divisive).toEqual([]);
    expect((await service.getTasteInsights(owner,group.id)).matches.map(m=>m.person.id)).toEqual([friend]);
    await expect(service.getTasteInsights(third,group.id)).rejects.toMatchObject({status:404});
    await expect(service.getTasteInsights(outsider,group.id)).rejects.toMatchObject({status:404});
    await service.saveItem(friend,items[0],true);await service.removeMember(owner,group.id,friend);
    await expect(service.saveItem(friend,items[0],false)).rejects.toMatchObject({status:404});
  });
});
