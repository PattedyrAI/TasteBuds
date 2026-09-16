'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,LoaderCircle,Check,X,Plus} from 'lucide-react';
import type {Category,CustomFields,Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {reviewPhotoIds} from './review-photos';
import {RatingInput} from './rating-input';
import {CategoryPicker} from './category-picker';
import {CategoryTemplate} from './category-template';
import {ReviewFields} from './review-fields';
import {validateCustomFields} from '../domain/category-template';
import {canonicalItemType} from '../domain/item-types';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
export function RatingForm({groupId,item,editing,rereview,categories,categoryTemplates=[],canManageCategories=false,close,saved,aiEnabled=false}:{aiEnabled?:boolean;groupId:string;item?:Item;editing?:Rating;rereview?:Rating;categories:string[];categoryTemplates?:Category[];canManageCategories?:boolean;close:()=>void;saved:()=>void}){
  const [name,setName]=useState(item?.name||''),[brand,setBrand]=useState(item?.brand||''),[variant,setVariant]=useState(item?.variant||''),[type,setType]=useState(item?.type||'');
  const [broad,setBroad]=useState(item?.broadCategory||''),[itemId,setItemId]=useState(item?.id),[photoIds,setPhotoIds]=useState<string[]>(reviewPhotoIds(editing||rereview||{})),[score,setScore]=useState<number|''>(editing?.score||rereview?.score||7),[note,setNote]=useState(editing?.note||'');
  const [tastedAt,setTastedAt]=useState(ratingDateValue(editing?.tastedAt||new Date())),[busy,setBusy]=useState(''),[error,setError]=useState(''),[hint,setHint]=useState(''),[matches,setMatches]=useState<Item[]>([]);
  const [templates,setTemplates]=useState(categoryTemplates),[creatingCategory,setCreatingCategory]=useState(false);
  const [extraValues,setExtraValues]=useState<CustomFields>(editing?.customFields||rereview?.customFields||{}),[linkedItem,setLinkedItem]=useState(item);
  const template=templates.find(c=>c.name.toLocaleLowerCase()===type.trim().toLocaleLowerCase());
  const fields=editing?(editing.categoryFields||[]):(template?.fields||[]);
  const categoryNames=templates.length?templates.map(c=>c.name):categories;
  const changeCategory=(next:string)=>{setType(next);setExtraValues({});};
  const photoId=photoIds[0]||null;
  const input=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const choose=(v:Item)=>{setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setLinkedItem(v);setExtraValues({});setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows);}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing]);
  // Attaching a photo never starts recognition. AI needs both an enabled preference and a click.
  useEffect(()=>{if(!aiEnabled)uploadController.current?.abort();},[aiEnabled]);
  async function upload(files:File[]){
    if(busy)return;
    if(files.length+photoIds.length>5){setError(`You can add ${5-photoIds.length} more photo${5-photoIds.length===1?'':'s'} (5 per review).`);return;}
    uploadController.current?.abort();const operation=new AbortController();uploadController.current=operation;
    setError('');setHint('');const failures:string[]=[];let uploaded=0;
    try{
      for(const [index,file] of files.entries()){
        if(operation.signal.aborted)return;
        setBusy(`Uploading photo ${index+1} of ${files.length}…`);
        try{
          const response=await fetch(`/api/photos?groupId=${groupId}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file,signal:operation.signal});
          const p=await response.json() as UploadedPhoto&{error?:string};if(!response.ok)throw new Error(p.error||'Could not upload this photo.');
          if(operation.signal.aborted)return;
          setPhotoIds(previous=>[...previous,p.id]);uploaded++;
        }catch(e){if(operation.signal.aborted)return;failures.push(`${file.name}: ${e instanceof Error?e.message:'Could not upload this photo.'}`);}
      }
      if(uploaded)setHint(`${uploaded} photo${uploaded===1?'':'s'} attached. The first photo is your cover.`);
      if(failures.length)setError(failures.join(' '));
    }finally{if(uploadController.current===operation)setBusy('');}
  }
  async function recognize(){
    if(!aiEnabled||!photoId||itemId||editing||busy)return;
    uploadController.current?.abort();const operation=new AbortController();uploadController.current=operation;
    setError('');setBusy('Looking for the item…');
    try{
      const r=await request<RecognitionResult>('/api/recognize','POST',{photoId},operation.signal);
      if(operation.signal.aborted)return;
      if(r.suggestion){setName(r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(r.suggestion.variant||'');const suggested=canonicalItemType(r.suggestion.type||'');changeCategory(categoryNames.find(name=>name.toLocaleLowerCase()===suggested.toLocaleLowerCase())||'');setBroad(r.suggestion.broadCategory||'');setMatches(r.matches);setHint(r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not suggest details. Your photo is attached; you can fill them in yourself.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(typeof score!=='number'||!Number.isFinite(score)||score<1||score>10){setError('Choose a score from 1 to 10.');return;}if(Math.abs(score*10-Math.round(score*10))>1e-8){setError('Use at most one decimal place.');return;}if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const submitted=Object.fromEntries(Object.entries(extraValues).filter(([id])=>fields.some(field=>field.id===id)));
    const locationField=fields.find(field=>field.type==='location');
    if(!editing&&locationField&&linkedItem?.placeId)submitted[locationField.id]=linkedItem.placeId;
    const customFields=validateCustomFields(fields,submitted);
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId,photoIds,customFields});
    else await request('/api/ratings','POST',{groupId,itemId,customFields,name,brand:brand||null,variant:variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,photoIds,rereviewOf:rereview?.id,idempotencyKey:key.current});
    saved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  if(creatingCategory)return <CategoryTemplate groupId={groupId} close={()=>setCreatingCategory(false)} created={category=>{setTemplates(previous=>[...previous.filter(c=>c.id!==category.id),category]);changeCategory(category.name);setCreatingCategory(false);setHint('Kategorien er klar. Utkastet ditt er beholdt — fyll inn resten og lagre vurderingen.');}}/>;
  return <Modal title={editing?'Edit your rating':rereview?'Rereview this item':'What did you try?'} close={close}><form onSubmit={save} className="rating-form">{rereview&&<p className="rereview-hint">Your earlier photos are ready to reuse. Keep, remove or add photos below. Your previous review stays in your history; only your latest score counts.</p>}
    <input ref={input} className="sr-only" type="file" multiple aria-label="Upload photos" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e=>{const files=Array.from(e.target.files||[]);e.currentTarget.value='';if(files.length)void upload(files);}}/>
    <section className="review-photo-editor" aria-label="Review photos">
      <div className="review-photo-heading"><strong>Your photos</strong><span>{photoIds.length} / 5</span></div>
      {photoIds.length>0?<div className="review-photo-strip">{photoIds.map((id,index)=><div className="review-photo-tile" key={id}><Photo id={id} name={`Your photo ${index+1}`}/><button type="button" className="photo-remove" disabled={!!busy} aria-label={`Remove photo ${index+1}`} onClick={()=>setPhotoIds(ids=>ids.filter(photo=>photo!==id))}><X size={18}/></button><button type="button" className="photo-cover" disabled={!!busy||index===0} aria-label={index===0?'Cover photo':`Make photo ${index+1} the cover`} onClick={()=>setPhotoIds(ids=>[id,...ids.filter(photo=>photo!==id)])}>{index===0?'Cover':'Make cover'}</button></div>)}{photoIds.length<5&&<button type="button" className="photo-add" disabled={!!busy} onClick={()=>input.current?.click()}><Plus size={24}/><span>Add photos</span></button>}</div>:<button type="button" className="upload" disabled={!!busy} onClick={()=>input.current?.click()}><Camera size={30}/><strong>Add photos · at least one required</strong><span>Choose up to 5 photos from your library.</span></button>}
      <p className="hint">First photo = cover. Up to 10 MB per photo.</p>
    </section>
    {!editing&&!itemId&&<div className="recognition-choice">{aiEnabled?<><button type="button" className="button secondary" disabled={!photoId||!!busy} onClick={()=>void recognize()}>Suggest details with AI</button><p className="hint">Optional. Only this button sends your cover photo to AI. Check the suggested details before saving.</p></>:<p className="hint"><strong>Manual mode.</strong> Your photo won’t be sent to AI. Fill in the details below, or enable AI assistance in Settings.</p>}</div>}
    {busy&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}{hint&&<p className="hint">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><span>{m.name}<small>{[m.brand,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Or use the details below to add a new item.</span></div>}
    <label>Item / Model<input required maxLength={160} value={name} disabled={!!itemId||!!editing||!!busy} onChange={e=>setName(e.target.value)} placeholder="What is it?"/></label>
    <div className="form-grid"><label>Brand / Restaurant <span className="optional">optional</span><input maxLength={120} value={brand} disabled={!!itemId||!!editing||!!busy} onChange={e=>setBrand(e.target.value)} placeholder="Add brand or restaurant"/></label><CategoryPicker value={type} onChange={changeCategory} categories={categoryNames} onCreate={canManageCategories?()=>setCreatingCategory(true):undefined} canCreate={canManageCategories} disabled={!!itemId||!!editing||!!busy}/></div>
    <ReviewFields fields={fields} values={extraValues} onChange={setExtraValues} groupId={groupId} disabled={!!busy} lockedPlaceId={editing?undefined:linkedItem?.placeId} editing={!!editing}/>
    {(variant||!itemId)&&<label>Variant <span className="optional">optional</span><input maxLength={120} value={variant} disabled={!!itemId||!!editing||!!busy} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {itemId&&!item&&!editing&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setItemId(undefined);setLinkedItem(undefined);setExtraValues({});setHint('Creating a new item.');}}>Create a different item instead</button>}
    <RatingInput value={score} onChange={setScore} disabled={!!busy}/>
    <label>Your notes <span className="optional">optional</span><textarea disabled={!!busy} value={note} maxLength={5000} rows={3} onChange={e=>setNote(e.target.value)} placeholder="What made it worth remembering?"/></label><label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} onChange={e=>setTastedAt(e.target.value)}/></label>
    {!photoId&&<p className="hint">Every rating needs a photo. You can fill in the details yourself if recognition doesn’t find the item.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={!!busy||!photoId}>{editing?'Save changes':rereview?'Save rereview':'Save rating'}</button>
  </form></Modal>;
}
