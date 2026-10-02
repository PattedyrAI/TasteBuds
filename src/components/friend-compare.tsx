'use client';
import {useEffect,useState} from 'react';
import type {Member,PersonRating,PersonRatingsPage} from '@/lib/contracts';
import {SelectMenu} from './select-menu';
import {request} from './ui';

/** What a card knows about the compared friend's score. `score:null` only ever means "loaded, and not rated". */
export type FriendScore={name:string;state:'loading'|'error'|'ready';score:number|null};
export type FriendScores=
 |{status:'idle'}
 |{status:'loading';name:string}
 |{status:'error';name:string;error:string;retry:()=>void}
 |{status:'ready';name:string;scores:ReadonlyMap<string,number>};

/** Ratings arrive newest first. Only the rating that counts toward the group average is the person's current score. */
export function latestScores(ratings:readonly PersonRating[]):Map<string,number>{
 const scores=new Map<string,number>(),settled=new Set<string>();
 for(const rating of ratings){
  if(rating.countsTowardAverage===false||settled.has(rating.itemId))continue;
  if(rating.countsTowardAverage===true){scores.set(rating.itemId,rating.score);settled.add(rating.itemId);}
  else if(!scores.has(rating.itemId))scores.set(rating.itemId,rating.score);
 }
 return scores;
}

/** Follows every nextCursor; a missing item is only "not rated" once the last page has arrived. */
export async function loadAllPersonRatings(groupId:string,personId:string,signal:AbortSignal):Promise<PersonRating[]>{
 const endpoint=`/api/groups/${encodeURIComponent(groupId)}/people/${encodeURIComponent(personId)}/ratings`;
 const ratings:PersonRating[]=[],seenCursors=new Set<string>();
 let cursor:string|null=null;
 do{
  const page:PersonRatingsPage=await request<PersonRatingsPage>(`${endpoint}?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,'GET',undefined,signal);
  ratings.push(...page.ratings);
  cursor=page.nextCursor;
  if(cursor&&seenCursors.has(cursor))throw new Error('Could not load every rating. Try again.');
  if(cursor)seenCursors.add(cursor);
 }while(cursor);
 return ratings;
}

type Loaded={key:string;value:FriendScores};
export function useFriendScores(groupId:string,person:{id:string;name:string}|null,revision:number):FriendScores{
 const [loaded,setLoaded]=useState<Loaded|null>(null),[retry,setRetry]=useState(0);
 const personId=person?.id??'',name=person?.name??'';
 const key=`${groupId}\u0000${personId}\u0000${revision}\u0000${retry}`;
 useEffect(()=>{
  if(!personId)return;
  const controller=new AbortController();
  loadAllPersonRatings(groupId,personId,controller.signal)
   .then(ratings=>{if(!controller.signal.aborted)setLoaded({key,value:{status:'ready',name,scores:latestScores(ratings)}});})
   .catch(e=>{if(!controller.signal.aborted)setLoaded({key,value:{status:'error',name,error:e instanceof Error?e.message:'Could not load ratings.',retry:()=>setRetry(v=>v+1)}});});
  return()=>controller.abort();
 },[groupId,personId,name,key]);
 if(!personId)return {status:'idle'};
 // A result for another group, person or refresh is stale and never shown.
 return loaded?.key===key?loaded.value:{status:'loading',name};
}

export function friendScoreFor(scores:FriendScores,itemId:string):FriendScore|undefined{
 if(scores.status==='idle')return undefined;
 if(scores.status!=='ready')return {name:scores.name,state:scores.status,score:null};
 return {name:scores.name,state:'ready',score:scores.scores.get(itemId)??null};
}

export function FriendComparePicker({members,viewerId,value,onChange,scores,itemIds}:{members:readonly Member[];viewerId:string;value:string;onChange:(personId:string)=>void;scores:FriendScores;itemIds:readonly string[]}){
 const friends=members.filter(m=>m.id!==viewerId).sort((a,b)=>a.displayName.localeCompare(b.displayName));
 if(!friends.length)return null;
 const rated=scores.status==='ready'?itemIds.filter(id=>scores.scores.has(id)).length:0;
 return <div className="friend-compare">
  <SelectMenu label="Compare scores with" value={value} onChange={onChange} searchable={friends.length>8} placeholder="Compare with a friend" options={[{value:'',label:'Compare with a friend',alwaysVisible:true},...friends.map(f=>({value:f.id,label:`Compare with ${f.displayName}`}))]}/>
  <p className="friend-compare-status" role="status">{scores.status==='loading'?<>Loading {scores.name}’s ratings…</>:scores.status==='ready'?<>{scores.name} has rated {rated} of {itemIds.length} {itemIds.length===1?'item':'items'} here.</>:null}</p>
  {scores.status==='error'&&<p className="error friend-compare-error" role="alert">{scores.name}’s ratings didn’t load. {scores.error} <button type="button" className="text-button" onClick={scores.retry}>Try again</button></p>}
 </div>;
}
