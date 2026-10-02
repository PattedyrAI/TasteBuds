'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,LoaderCircle,Check,X,Plus,Expand} from 'lucide-react';
import type {Category,CustomFields,Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {reviewPhotoIds} from './review-photos';
import {PhotoViewer} from './photo-viewer';
import {RatingInput} from './rating-input';
import {CategoryPicker} from './category-picker';
import {CategoryTemplate} from './category-template';
import {ReviewFields} from './review-fields';
import {validateCustomFields} from '../domain/category-template';
import {canonicalItemType} from '../domain/item-types';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
import {energyDrinkBrands,energyDrinkModels,energyDrinkSuggestion,isEnergyDrinkCategory,isSugarfree,SUGARFREE_VARIANT} from '../domain/energy-drinks';
export function RatingForm({groupId,item,editing,rereview,categories,categoryTemplates=[],canManageCategories=false,items=[],close,saved,aiEnabled=false}:{aiEnabled?:boolean;groupId:string;item?:Item;editing?:Rating;rereview?:Rating;categories:string[];categoryTemplates?:Category[];canManageCategories?:boolean;items?:Item[];close:()=>void;saved:()=>void}){
  const [previewId,setPreviewId]=useState<string|null>(null);
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
  const input=useRef<HTMLInputElement>(null),modelInput=useRef<HTMLInputElement>(null),cameraInput=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  // Energy drinks are looked up brand first, then that brand's models; Variant only says whether it is sugar-free.
  const energy=isEnergyDrinkCategory(type),locked=!!itemId||!!editing||!!busy;
  const brandChoices=energy&&!locked?energyDrinkBrands(items,brand):[],modelChoices=energy&&!locked?energyDrinkModels(items,brand,name):[];
  const choose=(v:Item)=>{setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setLinkedItem(v);setExtraValues({});setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||energy||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows);}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing,energy]);
  // Attaching a photo never starts recognition. AI needs both an enabled preference and a click.
  useEffect(()=>{if(!aiEnabled)uploadController.current?.abort();},[aiEnabled]);
  function selectPhotos(e:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';
    if(files.length&&!busy)void upload(files);
  }
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
      if(r.suggestion){const suggested=canonicalItemType(r.suggestion.type||''),suggestedType=categoryNames.find(name=>name.toLocaleLowerCase()===suggested.toLocaleLowerCase())||'',drink=isEnergyDrinkCategory(suggestedType)?energyDrinkSuggestion(r.suggestion.name,r.suggestion.variant):null;setName(drink?.name??r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(drink?(drink.sugarfree?SUGARFREE_VARIANT:''):r.suggestion.variant||'');changeCategory(suggestedType);setBroad(r.suggestion.broadCategory||'');setMatches(r.matches);setHint(r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not suggest details. Your photo is attached; you can fill them in yourself.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(typeof score!=='number'||!Number.isFinite(score)||score<1||score>10){setError('Choose a score from 1 to 10.');return;}if(Math.abs(score*10-Math.round(score*10))>1e-8){setError('Use at most one decimal place.');return;}if(!editing&&!brand.trim()){setError(itemId?'This item needs a brand before another review. Ask a group manager to update it.':'Enter a brand before saving your rating.');return;}if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const submitted=Object.fromEntries(Object.entries(extraValues).filter(([id])=>fields.some(field=>field.id===id)));
    const locationField=fields.find(field=>field.type==='location');
    if(!editing&&locationField&&linkedItem?.placeId)submitted[locationField.id]=linkedItem.placeId;
    const customFields=validateCustomFields(fields,submitted);
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId,photoIds,customFields});
    else await request('/api/ratings','POST',{groupId,itemId,customFields,name,brand:brand.trim()||null,variant:energy&&!itemId?(isSugarfree(variant)?SUGARFREE_VARIANT:null):variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,photoIds,rereviewOf:rereview?.id,idempotencyKey:key.current});
    saved();
  }catch(e){setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  if(creatingCategory)return <CategoryTemplate groupId={groupId} close={()=>setCreatingCategory(false)} created={category=>{setTemplates(previous=>[...previous.filter(c=>c.id!==category.id),category]);changeCategory(category.name);setCreatingCategory(false);setHint('Kategorien er klar. Utkastet ditt er beholdt — fyll inn resten og lagre vurderingen.');}}/>;
  return <Modal className="rating-modal" title={editing?'Edit your rating':rereview?'Rereview this item':'What did you try?'} close={close}><form onSubmit={save} className="rating-form">{rereview&&<p className="rereview-hint">Your earlier photos are ready to reuse. Keep, remove or add photos below. Your previous review stays in your history; only your latest score counts.</p>}
    <input ref={input} hidden type="file" multiple aria-label="Upload a photo" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!!busy||photoIds.length>=5} onChange={selectPhotos}/>
    <input ref={cameraInput} hidden type="file" aria-label="Take a photo" accept="image/*" capture="environment" disabled={!!busy||photoIds.length>=5} onChange={selectPhotos}/>
    <section className="review-photo-editor" aria-label="Review photos">
      <div className="review-photo-heading"><strong>Your photos</strong><span>{photoIds.length} / 5</span></div>
      {photoIds.length>0?<div className="review-photo-strip">{photoIds.map((id,index)=><div className="review-photo-tile" key={id}><button type="button" className="photo-preview" aria-label={`Enlarge photo ${index+1}`} onClick={()=>setPreviewId(id)}><Photo id={id} name={`Your photo ${index+1}`}/><span><Expand size={16}/></span></button><button type="button" className="photo-remove" disabled={!!busy} aria-label={`Remove photo ${index+1}`} onClick={()=>setPhotoIds(ids=>ids.filter(photo=>photo!==id))}><X size={18}/></button><button type="button" className="photo-cover" disabled={!!busy||index===0} aria-label={index===0?'Cover photo':`Make photo ${index+1} the cover`} onClick={()=>setPhotoIds(ids=>[id,...ids.filter(photo=>photo!==id)])}>{index===0?'Cover':'Make cover'}</button></div>)}{photoIds.length<5&&<button type="button" className="photo-add" disabled={!!busy} onClick={()=>input.current?.click()}><Plus size={24}/><span>Add photos</span></button>}</div>:<button type="button" className="upload" disabled={!!busy} onClick={()=>input.current?.click()}><Camera size={30}/><strong>Add your food photos</strong><span>Choose up to 5 photos. At least one is required.</span></button>}
      <div className="form-grid">
        <button type="button" className="button secondary" disabled={!!busy||photoIds.length>=5} onClick={()=>cameraInput.current?.click()}><Camera size={18}/>Take a photo</button>
        <button type="button" className="button secondary" disabled={!!busy||photoIds.length>=5} onClick={()=>input.current?.click()}><Upload size={18}/>Upload a photo</button>
      </div>
      <p className="hint">First photo is the cover. Tap a photo to enlarge. Up to 10 MB each.</p>
    </section>
    {!editing&&!itemId&&<div className="recognition-choice">{aiEnabled?<><button type="button" className="button secondary" disabled={!photoId||!!busy} onClick={()=>void recognize()}>Suggest details with AI</button><p className="hint">Optional. Only this button sends your cover photo to AI. Check the suggested details before saving.</p></>:<p className="hint"><strong>Manual mode.</strong> Fill in the details yourself. AI assistance is off.</p>}</div>}
    {busy&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}{hint&&<p className="hint">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><span>{m.name}<small>{[m.brand,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Or use the details below to add a new item.</span></div>}
    <div className="lookup-field"><label>{energy?'Brand':'Brand / Restaurant'}<input required maxLength={120} value={brand} disabled={locked} onChange={e=>setBrand(e.target.value)} placeholder={energy?'Search brands, e.g. Monster':'Add brand or restaurant'}/></label>
      {brandChoices.length>0&&<div className="lookup-chips" role="group" aria-label="Energy drink brands in your group">{brandChoices.map(b=><button type="button" key={b} onClick={()=>{setBrand(b);modelInput.current?.focus();}}>{b}</button>)}</div>}</div>
    <div className="lookup-field"><label>{energy?'Model / Flavour':'Model'}<input ref={modelInput} required maxLength={160} value={name} disabled={locked} onChange={e=>setName(e.target.value)} placeholder={energy?(brand.trim()?`Search ${brand.trim()} models`:'Ultra White, Mango Loco…'):'What is it?'}/></label>
      {modelChoices.length>0&&<div className="match-list"><strong>Already rated from {brand.trim()}</strong>{modelChoices.map(m=><button type="button" key={m.id} onClick={()=>choose(m)}><span>{m.name}{m.variant&&<small>{isSugarfree(m.variant)?'Sugarfree':m.variant}</small>}</span><Check size={18}/></button>)}<span className="muted">Or type a new model to add it.</span></div>}</div>
    <CategoryPicker value={type} onChange={changeCategory} categories={categoryNames} onCreate={canManageCategories?()=>setCreatingCategory(true):undefined} canCreate={canManageCategories} disabled={locked}/>
    {!editing&&itemId&&!brand.trim()&&<p className="error" role="alert">This item needs a brand before another review. Ask a group manager to update it.</p>}
    <ReviewFields fields={fields} values={extraValues} onChange={setExtraValues} groupId={groupId} disabled={!!busy} lockedPlaceId={editing?undefined:linkedItem?.placeId} editing={!!editing}/>
    {energy?<><label className="checkbox"><input type="checkbox" checked={isSugarfree(variant)} disabled={locked} onChange={e=>setVariant(e.target.checked?SUGARFREE_VARIANT:'')}/>Sugarfree</label>{itemId&&variant&&!isSugarfree(variant)&&<p className="hint">Variant: {variant}</p>}</>
    :(variant||!itemId)&&<label><span className="form-label-line">Variant <span className="optional">optional</span></span><input maxLength={120} value={variant} disabled={locked} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {itemId&&!item&&!editing&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setItemId(undefined);setLinkedItem(undefined);setExtraValues({});setHint('Creating a new item.');}}>Create a different item instead</button>}
    <RatingInput value={score} onChange={setScore} disabled={!!busy}/>
    <label><span className="form-label-line">Your notes <span className="optional">optional</span></span><textarea disabled={!!busy} value={note} maxLength={5000} rows={3} onChange={e=>setNote(e.target.value)} placeholder="What made it worth remembering?"/></label><label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} onChange={e=>setTastedAt(e.target.value)}/></label>
    {!photoId&&<p className="hint">Every rating needs a photo. You can fill in the details yourself if recognition doesn’t find the item.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={!!busy||!photoId}>{editing?'Save changes':rereview?'Save rereview':'Save rating'}</button>
  </form>{previewId&&photoIds.includes(previewId)&&<PhotoViewer ids={photoIds} initialIndex={photoIds.indexOf(previewId)} name={name||'Your photos'} close={()=>setPreviewId(null)}/>}</Modal>;
}
