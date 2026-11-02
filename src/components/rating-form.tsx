'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,LoaderCircle,Check,X,Expand,Sparkles,Pencil,Plus,ImagePlus} from 'lucide-react';
import type {Category,CustomFields,Item,Rating,RecognitionResult,UploadedPhoto} from '@/lib/contracts';
import {Modal,Photo,request} from './ui';
import {reviewPhotoIds} from './review-photos';
import {PhotoViewer} from './photo-viewer';
import {RatingInput} from './rating-input';
import {CategoryPicker} from './category-picker';
import {CategoryTemplate} from './category-template';
import {ReviewFields} from './review-fields';
import {validateCustomFields} from '../domain/category-template';
import {normalizeReviewIdentity} from '../domain/brand-identity';
import {broadReviewKind,kindForType,reviewKinds,typesForKind} from '../domain/review-categories';
import {canonicalItemType} from '../domain/item-types';
import {ratingDateValue,ratingTimestamp} from '@/lib/rating-date';
import {energyDrinkBrands,energyDrinkModels,energyDrinkSuggestion,isEnergyDrinkCategory,isSugarfree,sugarfreeSibling,SUGARFREE_VARIANT} from '../domain/energy-drinks';
import {distinctTypes} from '../domain/category-taxonomy';
import {CameraCapture,prefersLiveCamera} from './camera-capture';
export function RatingForm({groupId,item,editing,rereview,categories,categoryTemplates=[],canManageCategories=false,items=[],close,saved,aiEnabled=false}:{aiEnabled?:boolean;groupId:string;item?:Item;editing?:Rating;rereview?:Rating;categories:string[];categoryTemplates?:Category[];canManageCategories?:boolean;items?:Item[];close:()=>void;saved:()=>void}){
  const draft=useRef<{name:string;brand:string;variant:string;type:string;broad:string;extraValues:CustomFields}|null>(null);
  const [detailsOpen,setDetailsOpen]=useState(false),[kindError,setKindError]=useState(false);
  const kindInput=useRef<HTMLInputElement>(null),[camera,setCamera]=useState(false),[dragging,setDragging]=useState(false),[moreTypes,setMoreTypes]=useState(false);
  const [previewId,setPreviewId]=useState<string|null>(null);
  const [name,setName]=useState(item?.name||''),[brand,setBrand]=useState(item?.brand||''),[variant,setVariant]=useState(item?.variant||''),[type,setType]=useState(item?.type||'');
  const [broad,setBroad]=useState(item?.broadCategory||''),[itemId,setItemId]=useState(item?.id),[photoIds,setPhotoIds]=useState<string[]>(reviewPhotoIds(editing||rereview||{})),[score,setScore]=useState<number|''>(editing?.score||rereview?.score||7),[note,setNote]=useState(editing?.note||'');
  const [tastedAt,setTastedAt]=useState(ratingDateValue(editing?.tastedAt||new Date())),[busy,setBusy]=useState(''),[error,setError]=useState(''),[hint,setHint]=useState(''),[matches,setMatches]=useState<Item[]>([]);
  const [templates,setTemplates]=useState(categoryTemplates),[creatingCategory,setCreatingCategory]=useState(false);
  const [extraValues,setExtraValues]=useState<CustomFields>(editing?.customFields||rereview?.customFields||{}),[linkedItem,setLinkedItem]=useState(item);
  // A rereview stays tied to one item; switching sugar version turns it into a first rating of the other item.
  const [rereviewing,setRereviewing]=useState(rereview);
  const template=templates.find(c=>c.name.toLocaleLowerCase()===type.trim().toLocaleLowerCase());
  const fields=editing?(editing.categoryFields||[]):(template?.fields||[]);
  const categoryNames=templates.length?templates.map(c=>c.name):categories;
  const changeCategory=(next:string)=>{setType(next);setExtraValues({});};
  const photoId=photoIds[0]||null;
  const input=useRef<HTMLInputElement>(null),modelInput=useRef<HTMLInputElement>(null),cameraInput=useRef<HTMLInputElement>(null),key=useRef(crypto.randomUUID()),uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  // Energy drinks are looked up brand first, then that brand's models; Variant only says whether it is sugar-free.
  const energy=isEnergyDrinkCategory(type),locked=!!itemId||!!editing||!!busy;
  const resolvedIdentity=normalizeReviewIdentity({name,brand,type});
  const brandChoices=energy&&!locked?energyDrinkBrands(items,brand):[],modelChoices=energy&&!locked?energyDrinkModels(items,resolvedIdentity.brand||brand,resolvedIdentity.name||name).filter(candidate=>candidate.brand?.trim()):[];
  const choose=(v:Item)=>{draft.current={name,brand,variant,type,broad,extraValues};setBroad(v.broadCategory||'');setItemId(v.id);setName(v.name);setBrand(v.brand||'');setVariant(v.variant||'');setType(v.type||'');setLinkedItem(v);setExtraValues({});setMatches([]);setHint('Linked to the existing item. Your rating will join its history.');};
  useEffect(()=>{
    if(itemId||editing||energy||name.trim().length<2){setMatches([]);return;}
    setMatches([]);
    let active=true;const timer=setTimeout(()=>{const query=new URLSearchParams({name:name.trim(),brand,variant});void request<Item[]>(`/api/groups/${groupId}/matches?${query}`).then(rows=>{if(active)setMatches(rows.filter(row=>{const kind=broadReviewKind(row.broadCategory)||kindForType(row.type);return !broadReviewKind(broad)||!kind||kind===broad;}));}).catch(()=>{});},300);
    return()=>{active=false;clearTimeout(timer);};
  },[groupId,name,brand,variant,itemId,editing,energy,broad]);
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
      if(r.suggestion){const suggested=canonicalItemType(r.suggestion.type||''),suggestedType=categoryNames.find(name=>name.toLocaleLowerCase()===suggested.toLocaleLowerCase())||'',drink=isEnergyDrinkCategory(suggestedType)?energyDrinkSuggestion(r.suggestion.name,r.suggestion.variant):null;setName(drink?.name??r.suggestion.name);setBrand(r.suggestion.brand||'');setVariant(drink?(drink.sugarfree?SUGARFREE_VARIANT:''):r.suggestion.variant||'');const suggestedKind=kindForType(suggestedType)||broadReviewKind(r.suggestion.broadCategory);const chosen=broadReviewKind(broad);changeCategory(chosen&&suggestedKind&&chosen!==suggestedKind?'':suggestedType);if(!chosen)setBroad(suggestedKind||'');setMatches(r.matches);setHint(chosen&&suggestedKind&&chosen!==suggestedKind?'The suggested type did not match your choice. Choose a type or leave it blank.':r.suggestion.confidence<.75?'A possible match. Check the details before saving.':'Details suggested from your photo. Check them before saving.');}
      else setHint(r.message||'Fill in what you know.');
    }catch(e){if(operation.signal.aborted)return;setError(e instanceof Error?e.message:'Could not suggest details. Your photo is attached; you can fill them in yourself.');}
    finally{if(uploadController.current===operation)setBusy('');}
  }
  async function save(e:React.FormEvent){e.preventDefault();if(!editing&&!itemId&&!broadReviewKind(broad)){setKindError(true);setError('Choose Food, Drink or Other.');kindInput.current?.focus();return;}if(typeof score!=='number'||!Number.isFinite(score)||score<1||score>10){setError('Choose a score from 1 to 10.');return;}if(Math.abs(score*10-Math.round(score*10))>1e-8){setError('Use at most one decimal place.');return;}if(!editing&&!brand.trim()){setError(itemId?'This item needs a brand before another review. Ask a group manager to update it.':'Enter a brand before saving your rating.');return;}if(!photoId){setError('Add a photo before saving your rating.');return;}setBusy('Saving your rating…');setError('');try{
    const submitted=Object.fromEntries(Object.entries(extraValues).filter(([id])=>fields.some(field=>field.id===id)));
    const locationField=fields.find(field=>field.type==='location');
    if(!editing&&locationField&&linkedItem?.placeId)submitted[locationField.id]=linkedItem.placeId;
    const customFields=validateCustomFields(fields,submitted);
    const timestamp=ratingTimestamp(tastedAt,editing?.tastedAt);
    if(editing)await request(`/api/ratings/${editing.id}`,'PATCH',{score,note,tastedAt:timestamp,photoId,photoIds,customFields});
    else await request('/api/ratings','POST',{groupId,itemId,customFields,name,brand:brand.trim()||null,variant:energy&&!itemId?(isSugarfree(variant)?SUGARFREE_VARIANT:null):variant||null,type:type||null,broadCategory:broad||null,score,note,tastedAt:timestamp,photoId,photoIds,rereviewOf:rereviewing?.id,idempotencyKey:key.current});
    if(mounted.current)saved();
  }catch(e){if(!mounted.current)return;setDetailsOpen(true);setError(e instanceof Error?e.message:'Could not save.');setBusy('');}}
  // Anything the person typed, picked or attached since opening is worth a confirmation before it is thrown away.
  const snapshot=()=>JSON.stringify({photoIds,note,score,tastedAt,extraValues,name,brand,variant,type,broad,itemId});
  const initial=useRef<string|null>(null);if(initial.current===null)initial.current=snapshot();
  const dirty=()=>!!busy||snapshot()!==initial.current;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  function openCamera(){if(prefersLiveCamera())setCamera(true);else cameraInput.current?.click();}
  function dropPhotos(event:React.DragEvent){event.preventDefault();setDragging(false);const files=Array.from(event.dataTransfer.files).filter(file=>file.type.startsWith('image/')||/\.(heic|heif)$/i.test(file.name));if(files.length&&!busy)void upload(files);}
  /** Sugar-free is part of the product, so switching it moves the rating to the other version (or a new one). */
  function setSugarfree(checked:boolean){
    setVariant(checked?SUGARFREE_VARIANT:'');
    if(!itemId||editing)return;
    let photoNote='';
    if(rereviewing){const reused=new Set(reviewPhotoIds(rereviewing));setRereviewing(undefined);if(photoIds.some(id=>reused.has(id))){setPhotoIds(ids=>ids.filter(id=>!reused.has(id)));photoNote=' Your earlier photos belong to the other version, so add a new one.';}}
    const current=linkedItem??items.find(i=>i.id===itemId);if(!current)return;
    const sibling=sugarfreeSibling(items,current,checked);
    if(sibling){choose(sibling);setHint(`Switched to ${checked?'the sugar-free':'the regular'} ${sibling.name}.${photoNote}`);return;}
    setItemId(undefined);setLinkedItem(undefined);setExtraValues({});
    setHint(`${checked?'A sugar-free':'A regular'} ${current.name} isn’t in your group yet. Saving adds it.${photoNote}`);
  }
  const kind=broadReviewKind(broad);
  // Most-used types first, so the common choice is one tap; the full list stays one step away.
  // Custom types have no built-in section; the group's own items decide where they belong.
  const kindOfCustom=(t:string)=>{const kinds=new Set(items.filter(i=>i.type&&canonicalItemType(i.type).toLowerCase()===canonicalItemType(t).toLowerCase()).map(i=>broadReviewKind(i.broadCategory)).filter(Boolean));return kinds.size===1?[...kinds][0]:null;};
  const typeChoices=kind?distinctTypes(typesForKind(categoryNames,kind)).filter(t=>kindForType(t)!==null||kindOfCustom(t)===null||kindOfCustom(t)===kind):[];
  const usage=new Map<string,number>();for(const i of items)if(i.type)usage.set(canonicalItemType(i.type).toLowerCase(),(usage.get(canonicalItemType(i.type).toLowerCase())??0)+i.tastingCount);
  const rankedTypes=[...typeChoices].sort((a,b)=>(usage.get(b.toLowerCase())??0)-(usage.get(a.toLowerCase())??0)||a.localeCompare(b));
  const quickTypes=rankedTypes.slice(0,6),selectedType=typeChoices.find(t=>t.toLowerCase()===canonicalItemType(type).toLowerCase())??(type||'');
  const cocktails=kind==='Drink'?(typeChoices.find(t=>t.toLowerCase()==='cocktails')??typeChoices.find(t=>t.toLowerCase()==='cocktail')):undefined;
  if(cocktails&&!quickTypes.includes(cocktails))quickTypes.push(cocktails);
  if(selectedType&&!quickTypes.some(t=>t.toLowerCase()===selectedType.toLowerCase()))quickTypes.push(selectedType);
  const linked=!!itemId&&!editing;
  const title=editing?'Edit your rating':rereviewing?'Rate it again':linked&&item?`Rate ${item.name}`:'Rate something';
  const unlink=()=>{setItemId(undefined);setLinkedItem(undefined);if(draft.current){const d=draft.current;setName(d.name);setBrand(d.brand);setVariant(d.variant);setType(d.type);setBroad(d.broad);setExtraValues(d.extraValues);}else{setType('');setBroad('');setExtraValues({});}setHint('Creating a new item.');};
  if(creatingCategory)return <CategoryTemplate groupId={groupId} close={()=>setCreatingCategory(false)} created={category=>{setTemplates(previous=>[...previous.filter(c=>c.id!==category.id),category]);changeCategory(category.name);setCreatingCategory(false);setHint('Type created. Your draft is ready to continue.');}}/>;
  const formId='rating-form';
  return <Modal className="rating-modal sheet" title={title} close={close} guard={dirty} guardMessage="Discard this rating?"
    footer={<>{error&&<p className="error" role="alert">{error}</p>}<button form={formId} className="button primary full large" disabled={!!busy||!photoId}>{busy==='Saving your rating…'?<><LoaderCircle size={18} className="spin"/>Saving…</>:!photoId?'Add a photo to save':editing?'Save changes':'Save rating'}</button></>}>
  <form id={formId} onSubmit={save} className="rating-form">{rereviewing&&<p className="callout">Your earlier photos are ready to reuse. Your previous rating stays in your history; only your latest score counts toward the group score.</p>}
    <input ref={input} hidden type="file" multiple aria-label="Upload a photo" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={!!busy||photoIds.length>=5} onChange={selectPhotos}/>
    <input ref={cameraInput} hidden type="file" aria-label="Take a photo" accept="image/*" capture="environment" disabled={!!busy||photoIds.length>=5} onChange={selectPhotos}/>
    <section className={`photo-step${photoIds.length?' has-photos':''}${dragging?' dragging':''}`} aria-label="Photos" onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={dropPhotos}>
      {photoIds.length>0?<div className="review-photo-strip">{photoIds.map((id,index)=><div className="review-photo-tile" key={id}><button type="button" className="photo-preview" aria-label={`Enlarge photo ${index+1}`} onClick={()=>setPreviewId(id)}><Photo id={id} name={`Your photo ${index+1}`}/><span className="photo-zoom"><Expand size={14}/></span></button><button type="button" className="photo-remove" disabled={!!busy} aria-label={`Remove photo ${index+1}`} onClick={()=>setPhotoIds(ids=>ids.filter(photo=>photo!==id))}><X size={16}/></button>{index===0?<span className="photo-cover-badge">Cover</span>:<button type="button" className="photo-cover" disabled={!!busy} aria-label={`Make photo ${index+1} the cover`} onClick={()=>setPhotoIds(ids=>[id,...ids.filter(photo=>photo!==id)])}>Make cover</button>}</div>)}
        {photoIds.length<5&&<div className="photo-add-tile"><button type="button" disabled={!!busy} onClick={openCamera} aria-label="Take another photo"><Camera size={20}/></button><button type="button" disabled={!!busy} onClick={()=>input.current?.click()} aria-label="Add a photo from your library"><ImagePlus size={20}/></button></div>}</div>
      :<div className="photo-empty"><p className="photo-empty-title">Start with a photo</p><p className="muted">Every rating needs one. It becomes the cover in your collection.</p><div className="photo-actions"><button type="button" className="button primary" disabled={!!busy} onClick={openCamera}><Camera size={19}/>Take photo</button><button type="button" className="button secondary" disabled={!!busy} onClick={()=>input.current?.click()}><Upload size={19}/>Choose photo</button></div></div>}
    </section>
    {busy&&busy!=='Saving your rating…'&&<p className="inline-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</p>}
    {!editing&&!itemId&&aiEnabled&&photoId&&<button type="button" className="button ghost ai-suggest" disabled={!!busy} onClick={()=>void recognize()}><Sparkles size={17}/>Fill in from photo</button>}
    {linked?<div className="linked-item"><Photo id={linkedItem?.photoId??null} name={name}/><div><strong>{name}</strong><span className="muted">{[brand,variant&&!energy?variant:null,type].filter(Boolean).join(' · ')}</span></div>{!item&&<button type="button" className="text-button" disabled={!!busy} onClick={unlink}><Pencil size={14}/>Change</button>}</div>
    :!editing&&<>
      <fieldset className="review-kind"><legend>What is it?</legend><div className="segmented-control" role="radiogroup">{reviewKinds.map((k,index)=><label key={k} className={broad===k?'selected':''}><input ref={index===0?kindInput:undefined} required type="radio" name="review-kind" value={k} checked={broad===k} disabled={!!busy} aria-invalid={kindError} aria-describedby={kindError?'kind-error':undefined} onChange={()=>{setBroad(k);setKindError(false);if(kindForType(type)&&kindForType(type)!==k)changeCategory('');}}/><span>{k}</span></label>)}</div>{kindError&&<p className="field-error" id="kind-error">Choose Food, Drink or Other.</p>}</fieldset>
      {kind&&<fieldset className="type-step"><legend>Category <span className="optional">optional</span></legend><div className="chip-row">{quickTypes.map(t=><button type="button" key={t} aria-pressed={selectedType.toLowerCase()===t.toLowerCase()} className={`chip${selectedType.toLowerCase()===t.toLowerCase()?' selected':''}`} disabled={!!busy} onClick={()=>changeCategory(selectedType.toLowerCase()===t.toLowerCase()?'':t)}>{t}</button>)}{(rankedTypes.length>quickTypes.length||canManageCategories)&&!moreTypes&&<button type="button" className="chip ghost" onClick={()=>setMoreTypes(true)}><Plus size={14}/>More</button>}</div>
        {moreTypes&&<CategoryPicker value={type} onChange={changeCategory} categories={typeChoices} onCreate={canManageCategories?()=>setCreatingCategory(true):undefined} canCreate={canManageCategories} disabled={locked}/>}</fieldset>}
    </>}
    {editing&&<p className="hint">{[name,brand,type].filter(Boolean).join(' · ')}</p>}
    {!linked&&!editing&&<div className="identity-fields">
    <div className="lookup-field"><label><span className="form-label-line">{energy?'Brand':'Brand or place'}</span><input required maxLength={120} value={brand} disabled={locked} onChange={e=>setBrand(e.target.value)} placeholder={energy?'Monster, Red Bull…':'Where is it from?'} autoComplete="off"/></label>
      {brandChoices.length>0&&<div className="chip-row" role="group" aria-label="Energy drink brands in your group">{brandChoices.map(b=><button type="button" className="chip" key={b} onClick={()=>{setBrand(b);modelInput.current?.focus();}}>{b}</button>)}</div>}</div>
    <div className="lookup-field"><label><span className="form-label-line">{energy?'Flavour':'What’s it called?'}</span><input ref={modelInput} required maxLength={160} value={name} onBlur={()=>{if(!locked){setName(resolvedIdentity.name||name);setBrand(resolvedIdentity.brand||brand);}}} disabled={locked} onChange={e=>setName(e.target.value)} placeholder={energy?(brand.trim()?`Search ${brand.trim()} flavours`:'Ultra White, Mango Loco…'):'Smash burger, flat white…'} autoComplete="off"/></label>
      {modelChoices.length>0&&<div className="match-list"><strong>Already rated from {brand.trim()}</strong>{modelChoices.map(m=><button type="button" key={m.id} onClick={()=>choose(m)}><Photo id={m.photoId} name={m.name}/><span>{m.name}{m.variant&&<small>{isSugarfree(m.variant)?'Sugar-free':m.variant}</small>}</span><Check size={18}/></button>)}</div>}</div>
    </div>}
    {energy&&!editing&&<label className="switch-field"><input type="checkbox" role="switch" checked={isSugarfree(variant)} disabled={!!busy} onChange={e=>setSugarfree(e.target.checked)}/><span className="switch" aria-hidden="true"/><span><strong>Sugar-free</strong><small>{linked?'Switches to the sugar-free version of this drink.':'Zero, Ultra and other no-sugar versions.'}</small></span></label>}
    {hint&&<p className="hint" role="status">{hint}</p>}
    {matches.length>0&&<div className="match-list"><strong>Already in your group?</strong>{matches.map(m=><button type="button" key={m.id} disabled={!!busy} onClick={()=>choose(m)}><Photo id={m.photoId} name={m.name}/><span>{m.name}<small>{[m.brand,m.type,m.variant].filter(Boolean).join(' · ')||'Brand unknown'}</small></span><Check size={18}/></button>)}<span className="muted">Pick one to add your rating to it, or keep typing to add something new.</span></div>}
    {!editing&&itemId&&!brand.trim()&&<p className="error" role="alert">This item needs a brand before another review. Ask a group manager to update it.</p>}
    <ReviewFields fields={fields.filter(field=>field.required)} values={extraValues} onChange={setExtraValues} groupId={groupId} disabled={!!busy} lockedPlaceId={editing?undefined:linkedItem?.placeId} editing={!!editing}/>
    <RatingInput value={score} onChange={setScore} disabled={!!busy}/>
    <label className="notes-field"><span className="form-label-line">Notes <span className="optional">optional</span></span><textarea disabled={!!busy} value={note} maxLength={5000} rows={2} onChange={e=>setNote(e.target.value)} placeholder="What stood out? Would you get it again?"/></label>
    <details className="review-more" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>More details <span className="optional">{energy?'date':'variant, date'}{fields.some(f=>!f.required)?', extra fields':''}</span></summary>
    {!energy&&(variant||!itemId)&&<label><span className="form-label-line">Variant <span className="optional">optional</span></span><input maxLength={120} value={variant} disabled={locked} onChange={e=>setVariant(e.target.value)} placeholder="Flavour, size, edition…"/></label>}
    {energy&&itemId&&variant&&!isSugarfree(variant)&&<p className="hint">Variant: {variant}</p>}
    <ReviewFields fields={fields.filter(field=>!field.required)} values={extraValues} onChange={setExtraValues} groupId={groupId} disabled={!!busy} lockedPlaceId={editing?undefined:linkedItem?.placeId} editing={!!editing}/>
    <label>Date tried<input required disabled={!!busy} type="date" value={tastedAt} max={ratingDateValue(new Date())} onChange={e=>setTastedAt(e.target.value)}/></label>
    </details>
  </form>{previewId&&photoIds.includes(previewId)&&<PhotoViewer ids={photoIds} initialIndex={photoIds.indexOf(previewId)} name={name||'Your photos'} close={()=>setPreviewId(null)}/>}
  {camera&&<CameraCapture close={()=>setCamera(false)} capture={file=>{setCamera(false);void upload([file]);}} upload={()=>{setCamera(false);input.current?.click();}}/>}
  </Modal>;
}
