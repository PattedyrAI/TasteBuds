import {api,HttpError} from '@/server/auth';
import * as service from '@/server/service';
import {recognize} from '@/server/recognition';
import {connectDiscord} from '@/server/discord';
import {readJsonBody} from '@/server/request-body';
import {findItemMatches} from '@/server/item-matches';
import type {ItemFilters} from '@/lib/contracts';
async function handle(request:Request,{params}:{params:Promise<{path:string[]}>}){
  return api(request,async userId=>{
    const p=(await params).path,method=request.method;
    const body = method==='POST'||method==='PATCH' ? await readJsonBody(request) : {};
    if(p.length===2&&p[0]==='me'&&p[1]==='preferences'&&method==='PATCH')return service.updatePreferences(userId,body);
    if(p.length===1&&p[0]==='me'&&method==='PATCH')return service.updateNickname(userId,body);
    if(p.length===1&&p[0]==='bootstrap'&&method==='GET')return service.bootstrap(userId);
    if(p.length===1&&p[0]==='groups'){
      if(method==='GET')return (await service.bootstrap(userId)).groups;
      if(method==='POST')return service.createGroup(userId,body as {name:string});
    }
    if(p.join('/')==='groups/join'&&method==='POST')return service.joinGroup(userId,body as {code:string});
    if(p[0]==='groups'&&p[1]){
      if(p.length===2&&method==='GET')return service.getGroup(userId,p[1]);
      if(p.length===2&&method==='PATCH')return service.updateGroup(userId,p[1],body);
      if(p.length===3&&p[2]==='invite'&&method==='POST')return service.rotateInvite(userId,p[1]);
      if(p.length===4&&p[2]==='members'&&method==='DELETE')return service.removeMember(userId,p[1],p[3]);
      if(p.length===3&&p[2]==='items'&&method==='GET')return service.listItems(userId,p[1],Object.fromEntries(new URL(request.url).searchParams) as ItemFilters);
      if(p.length===3&&p[2]==='matches'&&method==='GET')return findItemMatches(userId,p[1],Object.fromEntries(new URL(request.url).searchParams));
      if(p.length===3&&p[2]==='feed'&&method==='GET')return service.getFeed(userId,p[1],Object.fromEntries(new URL(request.url).searchParams));
      if(p.length===3&&p[2]==='people'&&method==='GET')return service.listPeople(userId,p[1]);
      if(p.length===5&&p[2]==='people'&&p[4]==='ratings'&&method==='GET')return service.getPersonRatings(userId,p[1],p[3],Object.fromEntries(new URL(request.url).searchParams));
      if(p.length===3&&p[2]==='discord'&&method==='POST')return connectDiscord(userId,p[1],body);
    }
    if(p.length===2&&p[0]==='items'&&method==='GET')return service.getItem(userId,p[1]);
    if(p.length===2&&p[0]==='items'&&method==='PATCH')return service.updateItem(userId,p[1],body);
    if(p[0]==='ratings'){
      if(p.length===1&&method==='POST')return service.createRating(userId,body as unknown as Parameters<typeof service.createRating>[1]);
      if(p.length===2&&method==='PATCH')return service.updateRating(userId,p[1],body);
      if(p.length===2&&method==='DELETE')return service.deleteRating(userId,p[1]);
      if(p.length===3&&p[2]==='comments'&&method==='POST')return service.addComment(userId,p[1],body as {body:string});
    }
    if(p.length===2&&p[0]==='comments'&&method==='DELETE')return service.deleteComment(userId,p[1]);
    if(p.length===2&&p[0]==='comments'&&method==='PATCH')return service.updateComment(userId,p[1],body as {body:string});
    if(p.length===1&&p[0]==='recognize'&&method==='POST')return recognize(userId,String(body.photoId||''));
    throw new HttpError('Not found.',404);
  });
}
export const GET=handle;export const POST=handle;export const PATCH=handle;export const DELETE=handle;
