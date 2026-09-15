'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight} from 'lucide-react';
import type {Person,PersonRatingsPage} from '@/lib/contracts';
import {Avatar,Photo,Score,date,request} from './ui';

export function People({groupId,personId,select,open}:{groupId:string;personId:string|null;select:(id:string|null)=>void;open:(itemId:string)=>void}){
  const [people,setPeople]=useState<Person[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setPeople(null);setError('');
    void request<Person[]>(`/api/groups/${groupId}/people`,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setPeople(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[groupId,retry]);
  if(personId)return <PersonHistory key={`${groupId}-${personId}`} groupId={groupId} personId={personId} back={()=>select(null)} open={open}/>;
  return <section aria-label="People in this group">
    {error?<div className="error" role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>Try again</button></div>:!people?<p role="status">Loading your people…</p>:<div className="people-grid">{people.map(person=><button className="person-card" key={person.id} onClick={()=>select(person.id)}>
      <Avatar name={person.displayName} url={person.avatarUrl}/>
      <div className="person-copy"><h2>{person.displayName}</h2><p>{person.ratingCount} {person.ratingCount===1?'rating':'ratings'} · {person.itemCount} {person.itemCount===1?'item':'items'}</p><small>{person.lastRatedAt?`Last tried ${date(person.lastRatedAt)}`:'Their first rating is still to come.'}</small></div><ArrowUpRight size={18} aria-hidden="true"/>
    </button>)}</div>}
    <style jsx>{`
      .people-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
      .person-card{display:flex;align-items:center;gap:14px;text-align:left;background:white;border:1px solid var(--line);border-radius:16px;padding:22px;color:var(--ink);min-width:0}
      .person-card:hover{border-color:var(--blue)}.person-copy{flex:1;min-width:0}.person-copy h2{font-size:17px;margin:0 0 8px;overflow-wrap:anywhere}.person-copy p{font-size:13px;margin:0 0 5px}.person-copy small{font-size:12px;color:var(--muted)}.avatar{flex-shrink:0}
    `}</style>
  </section>;
}

function PersonHistory({groupId,personId,back,open}:{groupId:string;personId:string;back:()=>void;open:(itemId:string)=>void}){
  const [page,setPage]=useState<PersonRatingsPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  const pending=useRef<AbortController|null>(null);
  const endpoint=`/api/groups/${groupId}/people/${personId}/ratings`;
  useEffect(()=>{
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    void request<PersonRatingsPage>(endpoint,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setPage(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{controller.abort();pending.current?.abort();};
  },[endpoint,retry]);
  async function more(){
    if(busy||!page?.nextCursor)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{
      const next=await request<PersonRatingsPage>(`${endpoint}?cursor=${encodeURIComponent(page.nextCursor)}`,'GET',undefined,controller.signal);
      if(!controller.signal.aborted)setPage(previous=>({...next,ratings:[...(previous?.ratings||[]),...next.ratings.filter(r=>!previous?.ratings.some(old=>old.id===r.id))]}));
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load ratings.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <section aria-label="Person’s rating history">
    <button className="text-button back" onClick={back}><ArrowLeft size={16}/> All people</button>
    {page&&<><div className="person-heading"><Avatar name={page.person.displayName} url={page.person.avatarUrl}/><div><h2>{page.person.displayName}</h2><p>Every rating in this group, including repeat tastings.</p></div></div>
      <div className="stat-strip person-stats"><div><strong>{page.person.ratingCount}</strong><span>ratings</span></div><div><strong>{page.person.itemCount}</strong><span>items tried</span></div></div>
      {page.ratings.length===0?<div className="empty-state"><h3>No ratings yet.</h3><p>Their first tasting will appear here.</p></div>:<div className="history-list">{page.ratings.map(r=><button className="history-card" key={r.id} onClick={()=>open(r.itemId)}>
        <div className="history-photo"><Photo id={r.photoId} name={r.itemName}/></div><div className="history-copy"><h3>{r.itemName} <ArrowUpRight size={15} aria-hidden="true"/></h3>{(r.brand||r.variant)&&<p>{[r.brand,r.variant].filter(Boolean).join(' · ')}</p>}<time dateTime={r.tastedAt}>{date(r.tastedAt)}</time>{r.note&&<p className="note">{r.note}</p>}{!r.photoId&&r.legacyPhotoMissing&&<small>Historical rating · original photo unavailable</small>}</div><Score value={r.score}/>
      </button>)}</div>}
      <p className="muted" role="status">Showing {page.ratings.length} of {page.person.ratingCount} ratings</p>
    </>}
    {error&&<div className="error" role="alert">{error} {!page&&<button onClick={()=>setRetry(v=>v+1)}>Try again</button>}</div>}
    {busy&&<p role="status">Loading ratings…</p>}
    {page?.nextCursor&&<button className="button secondary" disabled={busy} onClick={()=>void more()}>{busy?'Loading…':error?'Try loading more again':'Load more ratings'}</button>}
    <style jsx>{`
      .person-stats{grid-template-columns:repeat(2,1fr)}.back{margin-bottom:24px}.person-heading{display:flex;align-items:center;gap:14px;margin-bottom:24px}.person-heading h2{margin:0 0 6px;overflow-wrap:anywhere}.person-heading p{margin:0;color:var(--muted);font-size:14px}.history-list{display:grid;gap:14px}.history-card{display:flex;gap:20px;align-items:flex-start;text-align:left;padding:20px;border:1px solid var(--line);border-radius:16px;background:white;color:var(--ink);width:100%}.history-card:hover{border-color:var(--blue)}.history-photo{width:100px;height:100px;flex-shrink:0;border-radius:12px;overflow:hidden}.history-copy{flex:1;min-width:0}.history-copy h3{margin:0 0 6px;font-size:17px;overflow-wrap:anywhere}.history-copy p{margin:0 0 8px;font-size:13px;color:var(--muted)}.history-copy time,.history-copy small{font-size:12px;color:var(--muted)}.history-copy p.note{color:var(--ink);margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}.history-photo :global(.item-photo),.history-photo :global(.photo-placeholder){width:100%;height:100%;object-fit:cover}.history-photo :global(.photo-placeholder span){display:none}
      @media(max-width:600px){.history-card{padding:14px;gap:12px;flex-wrap:wrap}.history-photo{width:64px;height:64px}.history-copy{flex-basis:calc(100% - 76px)}.history-card :global(.score){margin-left:76px}.person-heading{align-items:flex-start}.stat-strip{margin-bottom:22px}}
    `}</style>
  </section>;
}
