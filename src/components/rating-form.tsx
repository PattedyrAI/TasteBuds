'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,LoaderCircle,Check} from 'lucide-react';
import type {Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {RatingInput} from './rating-input';
import {CategoryPicker} from './category-picker';
import {resolveCategoryName} from '../domain/personal-discovery';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
import {energyDrinkBrands,energyDrinkModels,energyDrinkSuggestion,isEnergyDrinkCategory,isSugarfree,SUGARFREE_VARIANT} from '../domain/energy-drinks';
export function RatingForm({groupId,item,editing,rereview,categories,items=[],close,saved,aiEnabled=false}:{aiEnabled?:boolean;groupId:string;item?:Item;editing?:Rating;rereview?:Rating;categories:string[];items?:Item[];close:()=>void;saved:()=>void}){
  const [name,setName]=useState(item?.name||''),[brand,setBrand]=useState(item?.brand||''),[variant,setVariant]=useState(item?.variant||''),[type,setType]=useState(item?.type||'');
  const [broad,setBroad]=useState(item?.broadCategory||''),[itemId,setItemId]=useState(item?.id),[photoId,setPhotoId]=useState<string|null>(editing?.photoId||rereview?.photoId||null),[score,setScore]=useState<number|''>(editing?.score||rereview?.score||7),[note,setNote]=useState(editing?.note||'');
  const [tastedAt,setTastedAt]=useState(ratingDateValue(editing?.tastedAt||new Date())),[busy,setBusy]=useState(''),[error,setError]=useState(''),[hint,setHint]=useState(''),[matches,setMatches]=useState<Item[]>([]);
  const input=useRef<HTMLInputElement>(null),modelInput=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  // Energy drinks are looked up brand first, then that brand's models; Variant only says whether it is sugar-free.
  const energy=isEnergyDrinkCategory(type),locked=!!itemId||!!editing||!!busy;
  const brandChoices=energy&&!locked?energyDrinkBrands(items,brand):[],modelChoices=energy&&!locked?energyDrinkModels(items,brand,name):[];
  const choose=(v:Item)=>{setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||energy||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows);}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing,energy]);
  // Attaching a photo never starts recognition. AI needs both an enabled preference and a click.
  useEffect(()=>{if(!aiEnabled)uploadController.current?.abort();},[aiEnabled]);
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
      if(r.suggestion){const suggestedType=resolveCategoryName(r.suggestion.type||'',categories),drink=isEnergyDrinkCategory(suggestedType)?energyDrinkSuggestion(r.suggestion.name,r.suggestion.variant):null;setName(drink?.name??r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(drink?(drink.sugarfree?SUGARFREE_VARIANT:''):r.suggestion.variant||'');setType(suggestedType);setBroad(r.suggestion.broadCategory||'');setMatches(r.matches);setHint(r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not suggest details. Your photo is attached; you can fill them in yourself.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(typeof score!=='number'||!Number.isFinite(score)||score<1||score>10){setError('Choose a score from 1 to 10.');return;}if(Math.abs(score*10-Math.round(score*10))>1e-8){setError('Use at most one decimal place.');return;}if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId});
    else await request('/api/ratings','POST',{groupId,itemId,name,brand:brand||null,variant:energy&&!itemId?(isSugarfree(variant)?SUGARFREE_VARIANT:null):variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,rereviewOf:rereview?.id,idempotencyKey:key.current});
    saved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  return <Modal title={editing?'Edit your rating':rereview?'Rereview this item':'What did you try?'} close={close}><form onSubmit={save} className="rating-form">{rereview&&<p className="rereview-hint">Your earlier photo is ready to reuse. Tap it to change it. Your previous review stays in your history; only your latest score counts.</p>}
    {<><input ref={input} className="sr-only" type="file" aria-label="Upload a photo" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e=>{const f=e.target.files?.[0];e.currentTarget.value='';if(f)void upload(f);}}/><button type="button" className={`upload ${photoId?'has-photo':''}`} disabled={!!busy} onClick={()=>input.current?.click()}>{photoId?<Photo id={photoId} name="Your photo"/>:<><Camera size={30}/><strong>Add a photo · required</strong><span>Take a photo or choose one from your library.</span></>}</button></>}
    {!editing&&!itemId&&<div className="recognition-choice">{aiEnabled?<><button type="button" className="button secondary" disabled={!photoId||!!busy} onClick={()=>void recognize()}>Suggest details with AI</button><p className="hint">Optional. Only this button sends your photo to AI. Check the suggested details before saving.</p></>:<p className="hint"><strong>Manual mode.</strong> Your photo won’t be sent to AI. Fill in the details below, or enable AI assistance in Settings.</p>}</div>}
    {busy&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}{hint&&<p className="hint">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><span>{m.name}<small>{[m.brand,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Or use the details below to add a new item.</span></div>}
    {!energy&&<label>Item / Model<input required maxLength={160} value={name} disabled={locked} onChange={e=>setName(e.target.value)} placeholder="What is it?"/></label>}
    <div className="form-grid"><div className="lookup-field"><label>{energy?'Brand':'Brand / Restaurant'} <span className="optional">optional</span><input maxLength={120} value={brand} disabled={locked} onChange={e=>setBrand(e.target.value)} placeholder={energy?'Search brands, e.g. Monster':'Add brand or restaurant'}/></label>
      {brandChoices.length>0&&<div className="lookup-chips" role="group" aria-label="Energy drink brands in your group">{brandChoices.map(b=><button type="button" key={b} onClick={()=>{setBrand(b);modelInput.current?.focus();}}>{b}</button>)}</div>}</div>
      <CategoryPicker value={type} onChange={setType} categories={categories} disabled={locked}/></div>
    {energy&&<div className="lookup-field"><label>Model / Flavour<input ref={modelInput} required maxLength={160} value={name} disabled={locked} onChange={e=>setName(e.target.value)} placeholder={brand.trim()?`Search ${brand.trim()} models`:'Ultra White, Mango Loco…'}/></label>
      {modelChoices.length>0&&<div className="match-list"><strong>Already rated from {brand.trim()}</strong>{modelChoices.map(m=><button type="button" key={m.id} onClick={()=>choose(m)}><span>{m.name}{m.variant&&<small>{isSugarfree(m.variant)?'Sugarfree':m.variant}</small>}</span><Check size={18}/></button>)}<span className="muted">Or type a new model to add it.</span></div>}</div>}
    {energy?<><label className="checkbox"><input type="checkbox" checked={isSugarfree(variant)} disabled={locked} onChange={e=>setVariant(e.target.checked?SUGARFREE_VARIANT:'')}/>Sugarfree</label>{itemId&&variant&&!isSugarfree(variant)&&<p className="hint">Variant: {variant}</p>}</>
    :(variant||!itemId)&&<label>Variant <span className="optional">optional</span><input maxLength={120} value={variant} disabled={locked} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {itemId&&!item&&!editing&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setItemId(undefined);setHint('Creating a new item.');}}>Create a different item instead</button>}
    <RatingInput value={score} onChange={setScore} disabled={!!busy}/>
    <label>Your notes <span className="optional">optional</span><textarea disabled={!!busy} value={note} maxLength={5000} rows={3} onChange={e=>setNote(e.target.value)} placeholder="What made it worth remembering?"/></label><label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} onChange={e=>setTastedAt(e.target.value)}/></label>
    {!photoId&&<p className="hint">Every rating needs a photo. You can fill in the details yourself if recognition doesn’t find the item.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={!!busy||!photoId}>{editing?'Save changes':rereview?'Save rereview':'Save rating'}</button>
  </form></Modal>;
}
