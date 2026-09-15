'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,LoaderCircle,Check} from 'lucide-react';
import type {Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
export function RatingForm({groupId,item,editing,close,saved}:{groupId:string;item?:Item;editing?:Rating;close:()=>void;saved:()=>void}){
  const [name,setName]=useState(item?.name||''),[brand,setBrand]=useState(item?.brand||''),[variant,setVariant]=useState(item?.variant||''),[type,setType]=useState(item?.type||'');
  const [broad,setBroad]=useState(item?.broadCategory||''),[itemId,setItemId]=useState(item?.id),[photoId,setPhotoId]=useState<string|null>(editing?.photoId||null),[score,setScore]=useState(editing?.score||7),[note,setNote]=useState(editing?.note||'');
  const [tastedAt,setTastedAt]=useState(ratingDateValue(editing?.tastedAt||new Date())),[busy,setBusy]=useState(''),[error,setError]=useState(''),[hint,setHint]=useState(''),[matches,setMatches]=useState<Item[]>([]);
  const input=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const choose=(v:Item)=>{setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows);}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing]);
  async function upload(file:File){
    uploadController.current?.abort();const operation=new AbortController();uploadController.current=operation;
    setError('');setBusy('Reading your photo…');
    try{
      const response=await fetch(`/api/photos?groupId=${groupId}`,{method:'POST',headers:{'Content-Type':file.type},body:file,signal:operation.signal});
      const p=await response.json() as UploadedPhoto&{error?:string};if(!response.ok)throw new Error(p.error||'Could not upload this photo.');setPhotoId(p.id);
      if(itemId){setHint('Photo attached to this tasting.');return;}
      setBusy('Looking for the item…');const r=await request<RecognitionResult>('/api/recognize','POST',{photoId:p.id},operation.signal);
      if(operation.signal.aborted)return;
      if(r.suggestion){setName(r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(r.suggestion.variant||'');setType(r.suggestion.type||'');setBroad(r.suggestion.broadCategory||'');setMatches(r.matches);setHint(r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not read this photo. You can still fill in the details.');}finally{setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId});
    else await request('/api/ratings','POST',{groupId,itemId,name,brand:brand||null,variant:variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,idempotencyKey:key.current});
    saved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  return <Modal title={editing?'Edit your rating':'What did you try?'} close={close}><form onSubmit={save} className="rating-form">
    {<><input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/><button type="button" className={`upload ${photoId?'has-photo':''}`} disabled={!!busy} onClick={()=>input.current?.click()}>{photoId?<Photo id={photoId} name="Your photo"/>:<><Camera size={30}/><strong>Add a photo · required</strong><span>Take a photo or choose one from your library.</span></>}</button></>}
    {busy&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}{hint&&<p className="hint">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><span>{m.name}<small>{[m.brand,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Or use the details below to add a new item.</span></div>}
    <label>Item / Model<input required maxLength={160} value={name} disabled={!!itemId||!!editing||!!busy} onChange={e=>setName(e.target.value)} placeholder="What is it?"/></label>
    <div className="form-grid"><label>Brand / Restaurant <span className="optional">optional</span><input maxLength={120} value={brand} disabled={!!itemId||!!editing||!!busy} onChange={e=>setBrand(e.target.value)} placeholder="Add brand or restaurant"/></label><label>Type <span className="optional">optional</span><input maxLength={80} value={type} disabled={!!itemId||!!editing||!!busy} onChange={e=>setType(e.target.value)} placeholder="Coffee, burger, phone…"/></label></div>
    {(variant||!itemId)&&<label>Variant <span className="optional">optional</span><input maxLength={120} value={variant} disabled={!!itemId||!!editing||!!busy} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {itemId&&!item&&!editing&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setItemId(undefined);setHint('Creating a new item.');}}>Create a different item instead</button>}
    <fieldset className="rating-scale"><legend>Your rating <strong>{score}/10</strong></legend><div className="score-buttons">{Array.from({length:10},(_,i)=>i+1).map(n=><button key={n} type="button" disabled={!!busy} aria-label={`Rate ${n} out of 10`} aria-pressed={score===n} className={score===n?'selected':''} onClick={()=>setScore(n)}>{n}</button>)}</div><div className="scale-labels"><span>Not for me</span><span>Would try again</span><span>All-time favourite</span></div></fieldset>
    <label>Your notes <span className="optional">optional</span><textarea disabled={!!busy} value={note} maxLength={5000} rows={3} onChange={e=>setNote(e.target.value)} placeholder="What made it worth remembering?"/></label><label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} onChange={e=>setTastedAt(e.target.value)}/></label>
    {!photoId&&<p className="hint">Every rating needs a photo. You can fill in the details yourself if recognition doesn’t find the item.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={!!busy||!photoId}>{editing?'Save changes':'Save rating'}</button>
  </form></Modal>;
}
