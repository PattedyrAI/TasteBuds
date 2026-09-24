'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,LoaderCircle,Check} from 'lucide-react';
import type {Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {RatingInput} from './rating-input';
import {CategoryPicker} from './category-picker';
import {resolveCategoryName} from '../domain/personal-discovery';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
export function RatingForm({groupId,item,editing,rereview,categories,close,saved,aiEnabled=false}:{aiEnabled?:boolean;groupId:string;item?:Item;editing?:Rating;rereview?:Rating;categories:string[];close:()=>void;saved:()=>void}){
  const [name,setName]=useState(item?.name||''),[brand,setBrand]=useState(item?.brand||''),[variant,setVariant]=useState(item?.variant||''),[type,setType]=useState(item?.type||'');
  const [broad,setBroad]=useState(item?.broadCategory||''),[itemId,setItemId]=useState(item?.id),[photoId,setPhotoId]=useState<string|null>(editing?.photoId||rereview?.photoId||null),[score,setScore]=useState<number|''>(editing?.score||rereview?.score||7),[note,setNote]=useState(editing?.note||'');
  const [tastedAt,setTastedAt]=useState(ratingDateValue(editing?.tastedAt||new Date())),[busy,setBusy]=useState(''),[error,setError]=useState(''),[hint,setHint]=useState(''),[matches,setMatches]=useState<Item[]>([]);
  const input=useRef<HTMLInputElement>(null),cameraInput=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const choose=(v:Item)=>{setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows);}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing]);
  // Attaching a photo never starts recognition. AI needs both an enabled preference and a click.
  useEffect(()=>{if(!aiEnabled)uploadController.current?.abort();},[aiEnabled]);
  function selectPhoto(e:React.ChangeEvent<HTMLInputElement>){
    const file=e.currentTarget.files?.[0];e.currentTarget.value='';
    if(file&&!busy)void upload(file);
  }
  async function upload(file:File){
    uploadController.current?.abort();const operation=new AbortController();uploadController.current=operation;
    setError('');setHint('');setBusy('Uploading your photo…');
    try{
      const response=await fetch(`/api/photos?groupId=${groupId}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file,signal:operation.signal});
      const p=await response.json() as UploadedPhoto&{error?:string};if(!response.ok)throw new Error(p.error||'Could not upload this photo.');
      if(operation.signal.aborted)return;
      setPhotoId(p.id);setHint(itemId?'Photo attached to this tasting.':'Photo attached. Fill in the item details below.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not upload this photo. Try another image.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function recognize(){
    if(!aiEnabled||!photoId||itemId||editing||busy)return;
    uploadController.current?.abort();const operation=new AbortController();uploadController.current=operation;
    setError('');setBusy('Looking for the item…');
    try{
      const r=await request<RecognitionResult>('/api/recognize','POST',{photoId},operation.signal);
      if(operation.signal.aborted)return;
      if(r.suggestion){setName(r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(r.suggestion.variant||'');setType(resolveCategoryName(r.suggestion.type||'',categories));setBroad(r.suggestion.broadCategory||'');setMatches(r.matches);setHint(r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not suggest details. Your photo is attached; you can fill them in yourself.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(typeof score!=='number'||!Number.isFinite(score)||score<1||score>10){setError('Choose a score from 1 to 10.');return;}if(Math.abs(score*10-Math.round(score*10))>1e-8){setError('Use at most one decimal place.');return;}if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId});
    else await request('/api/ratings','POST',{groupId,itemId,name,brand:brand||null,variant:variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,rereviewOf:rereview?.id,idempotencyKey:key.current});
    saved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  return <Modal title={editing?'Edit your rating':rereview?'Rereview this item':'What did you try?'} close={close}><form onSubmit={save} className="rating-form">{rereview&&<p className="rereview-hint">Your earlier photo is ready to reuse. Tap it to change it. Your previous review stays in your history; only your latest score counts.</p>}
    <input ref={input} hidden type="file" aria-label="Upload a photo" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!!busy} onChange={selectPhoto}/>
    <input ref={cameraInput} hidden type="file" aria-label="Take a photo" accept="image/*" capture="environment" disabled={!!busy} onChange={selectPhoto}/>
    {photoId?<button type="button" className="upload has-photo" aria-label="Replace photo from library" disabled={!!busy} onClick={()=>input.current?.click()}><Photo id={photoId} name="Your photo"/></button>:<div className="upload"><Camera size={30}/><strong>Add a photo · required</strong><span>Take a photo or choose one from your library.</span></div>}
    <div className="form-grid">
      <button type="button" className="button secondary" disabled={!!busy} onClick={()=>cameraInput.current?.click()}><Camera size={18}/>Take a photo</button>
      <button type="button" className="button secondary" disabled={!!busy} onClick={()=>input.current?.click()}><Upload size={18}/>Upload a photo</button>
    </div>
    {!editing&&!itemId&&<div className="recognition-choice">{aiEnabled?<><button type="button" className="button secondary" disabled={!photoId||!!busy} onClick={()=>void recognize()}>Suggest details with AI</button><p className="hint">Optional. Only this button sends your photo to AI. Check the suggested details before saving.</p></>:<p className="hint"><strong>Manual mode.</strong> Your photo won’t be sent to AI. Fill in the details below, or enable AI assistance in Settings.</p>}</div>}
    {busy&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}{hint&&<p className="hint">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><span>{m.name}<small>{[m.brand,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Or use the details below to add a new item.</span></div>}
    <label>Item / Model<input required maxLength={160} value={name} disabled={!!itemId||!!editing||!!busy} onChange={e=>setName(e.target.value)} placeholder="What is it?"/></label>
    <div className="form-grid"><label>Brand / Restaurant <span className="optional">optional</span><input maxLength={120} value={brand} disabled={!!itemId||!!editing||!!busy} onChange={e=>setBrand(e.target.value)} placeholder="Add brand or restaurant"/></label><CategoryPicker value={type} onChange={setType} categories={categories} disabled={!!itemId||!!editing||!!busy}/></div>
    {(variant||!itemId)&&<label>Variant <span className="optional">optional</span><input maxLength={120} value={variant} disabled={!!itemId||!!editing||!!busy} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {itemId&&!item&&!editing&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setItemId(undefined);setHint('Creating a new item.');}}>Create a different item instead</button>}
    <RatingInput value={score} onChange={setScore} disabled={!!busy}/>
    <label>Your notes <span className="optional">optional</span><textarea disabled={!!busy} value={note} maxLength={5000} rows={3} onChange={e=>setNote(e.target.value)} placeholder="What made it worth remembering?"/></label><label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} onChange={e=>setTastedAt(e.target.value)}/></label>
    {!photoId&&<p className="hint">Every rating needs a photo. You can fill in the details yourself if recognition doesn’t find the item.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={!!busy||!photoId}>{editing?'Save changes':rereview?'Save rereview':'Save rating'}</button>
  </form></Modal>;
}
