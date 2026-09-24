import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as service from '../src/server/service';
import {createCategory} from '../src/server/services/categories';
import {getPool} from '../src/server/db';
import {uploadPhoto,getPhoto} from '../src/server/photos';
import sharp from 'sharp';
const url=process.env.TEST_DATABASE_URL;
if(url&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test')))throw Error('Disposable local test database required');
if(url)process.env.DATABASE_URL=url;
const [admin,owner,member,outsider]=Array.from({length:4},()=>randomUUID());
const previous=process.env.PLATFORM_ADMIN_USER_ID;
let groupId:string,photoId:string;
describe.skipIf(!url)('one configured platform administrator',()=>{
 beforeAll(async()=>{process.env.PLATFORM_ADMIN_USER_ID=admin;for(const id of [admin,owner,member,outsider])await service.ensureUser({id,displayName:'Pat'});const group=await service.createGroup(owner,{name:'Private group'});groupId=group.id;await service.joinGroup(member,{code:group.inviteCode!});});
 afterAll(async()=>{if(previous===undefined)delete process.env.PLATFORM_ADMIN_USER_ID;else process.env.PLATFORM_ADMIN_USER_ID=previous;await getPool().end();});
 it('lists and administers existing and future groups without membership, preserving their owner',async()=>{
  expect((await service.bootstrap(admin)).groups.find(g=>g.id===groupId)).toMatchObject({role:'admin',ownerId:owner});
  expect(await service.getGroup(admin,groupId)).toMatchObject({role:'admin',ownerId:owner,inviteCode:expect.any(String)});
  await service.updateGroup(admin,groupId,{name:'Managed by Pat'});
  await createCategory(admin,groupId,{name:'Admin category',fields:[]});
  const future=await service.createGroup(member,{name:'Future group'});expect((await service.bootstrap(admin)).groups.some(g=>g.id===future.id)).toBe(true);
  expect(await service.getPersonRatings(admin,groupId,admin)).toMatchObject({person:{id:admin,ratingCount:0},ratings:[],nextCursor:null});
  expect((await getPool().query('SELECT count(*)::int n FROM everrate.memberships WHERE user_id=$1',[admin])).rows[0].n).toBe(0);
 });
 it('does not promote matching nicknames, other members, outsiders or missing configuration',async()=>{
  expect((await service.getGroup(member,groupId)).role).toBe('member');await expect(createCategory(member,groupId,{name:'Forbidden',fields:[]})).rejects.toMatchObject({status:403});
  expect((await service.bootstrap(outsider)).groups).toEqual([]);await expect(service.getGroup(outsider,groupId)).rejects.toMatchObject({status:404});
  process.env.PLATFORM_ADMIN_USER_ID='Pat';await expect(service.getGroup(admin,groupId)).rejects.toMatchObject({status:404});
  delete process.env.PLATFORM_ADMIN_USER_ID;await expect(service.getGroup(admin,groupId)).rejects.toMatchObject({status:404});process.env.PLATFORM_ADMIN_USER_ID=admin;
 });
 it('authorizes private photos and moderation, and counts an admin tasting normally',async()=>{
  const bytes=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).jpeg().toBuffer();
  const otherPhoto=await uploadPhoto(member,groupId,bytes);expect((await getPhoto(admin,otherPhoto.id)).group_id).toBe(groupId);await expect(getPhoto(outsider,otherPhoto.id)).rejects.toMatchObject({status:404});
  const own=await uploadPhoto(admin,groupId,bytes);photoId=own.id;
  await expect(service.createRating(admin,{groupId,name:'Invalid first tasting',photoId:otherPhoto.id,score:8})).rejects.toMatchObject({status:404});
  expect((await getPool().query('SELECT count(*)::int n FROM everrate.memberships WHERE group_id=$1 AND user_id=$2',[groupId,admin])).rows[0].n).toBe(0);
  const memberRating=await service.createRating(member,{groupId,name:'Member tasting',photoId:otherPhoto.id,score:2});
  await service.updateRating(admin,memberRating.id,{score:3});await service.deleteRating(admin,memberRating.id);
  const rating=await service.createRating(admin,{groupId,name:'Admin tasting',photoId,score:8});expect(await service.getItem(admin,rating.itemId)).toMatchObject({average:8,raterCount:1});
  const comment=await service.addComment(member,rating.id,{body:'Member comment'});await service.deleteComment(admin,comment.id);await expect(service.deleteRating(member,rating.id)).rejects.toMatchObject({status:403});
  await service.updateRating(admin,rating.id,{score:9});
 });
 it('transfers the actual ownership safely and cannot remove the current owner',async()=>{
  await expect(service.removeMember(admin,groupId,owner)).rejects.toMatchObject({status:409});
  await service.updateGroup(admin,groupId,{ownerId:member});
  expect((await service.getGroup(admin,groupId)).ownerId).toBe(member);expect((await service.getGroup(owner,groupId)).role).toBe('member');expect((await service.getGroup(member,groupId)).role).toBe('owner');
  expect((await service.getGroup(admin,groupId)).role).toBe('admin');
  await service.updateGroup(admin,groupId,{ownerId:admin});expect((await service.getGroup(admin,groupId)).ownerId).toBe(admin);
 });
});
