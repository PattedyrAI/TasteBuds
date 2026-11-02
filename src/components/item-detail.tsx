'use client';
import {useEffect,useState} from 'react';
import {ReviewPhotos,reviewPhotoIds} from './review-photos';
import {ReviewConversation} from './review-conversation';
import {RatingStatus} from './rating-status';
import {BrandLabel} from './brand-label';
import {ReviewFieldValues} from './review-fields';
import {CategoryPicker} from './category-picker';
import {SaveItemButton} from './discovery-actions';
import {Plus,Trash2,Pencil,Repeat2} from 'lucide-react';
import type {ItemDetail as Detail,Rating,User} from '@/lib/contracts';
import {Avatar,Modal,Photo,Score,request,date} from './ui';
import {scoreAgreement} from '../domain/score-scale';
import {isSugarfree} from '../domain/energy-drinks';
import {isMatthew} from '../domain/matthew';

export function ItemDetail({id,user,owner,close,rate,edit,changed,person,rereview,categories}:{id:string;user:User;owner:boolean;close:()=>void;rate:(item:Detail)=>void;edit:(rating:Rating,item:Detail)=>void;changed:()=>void;person?:(id:string)=>void;rereview:(rating:Rating,item:Detail)=>void;categories:string[]}){
  const [item,setItem]=useState<Detail|null>(null),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[deleting,setDeleting]=useState<string|null>(null);
  const [metadataCategory,setMetadataCategory]=useState('');
  const [editItem,setEditItem]=useState(false);
  const load=()=>request<Detail>(`/api/items/${id}`).then(setItem).catch(e=>setError(e.message));
  useEffect(()=>{void load();},[id]);
  async function run(work:()=>Promise<unknown>){
    setError('');setBusy(true);
    try{await work();await load();changed();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}
    finally{setBusy(false);setDeleting(null);}
  }
  const latest=item?item.ratings.filter(r=>r.countsTowardAverage!==false):[];
  const people=[...new Map(latest.map(r=>[r.author.id,r])).values()];
  const agreement=scoreAgreement(people.map(r=>r.score));
  const mine=item?.ratings.find(r=>r.author.id===user.id&&r.countsTowardAverage!==false);
  return <Modal className="item-modal sheet" title={item?.name||'Loading…'} subtitle={item&&<div className="detail-brand"><BrandLabel brand={item.brand} interactive/>{item.variant&&<span className="muted">{isSugarfree(item.variant)?'Sugar-free':item.variant}</span>}{item.type&&<span className="tag">{item.type}</span>}</div>} close={close}
    footer={item&&<div className="button-row"><button className="button primary large grow" onClick={()=>{if(mine)rereview(mine,item);else rate(item);}}>{mine?<><Repeat2 size={18}/>Rate it again</>:<><Plus size={18}/>Rate it</>}</button><SaveItemButton item={item} changed={saved=>setItem(current=>current?{...current,saved}:current)}/></div>}>
    {error&&<p role="alert" className="error">{error}</p>}
    {!item?<div className="skeleton detail-skeleton" aria-busy="true"><span/><span/><span/></div>:<div className={`detail${item.myScore===10?' personal-perfect':''}`}>
      <div className="detail-hero"><Photo id={item.photoId} name={item.name}/></div>
      <section className="score-panel" aria-label="Scores">
        <div className="score-panel-main"><span className="score-panel-label">Group score</span><Score value={item.average} words size="lg"/><small className="muted">Average of each person’s latest score · {item.raterCount} {item.raterCount===1?'person':'people'} · {item.tastingCount} {item.tastingCount===1?'tasting':'tastings'}</small></div>
        <div className="score-panel-side"><span className="score-panel-label">You</span>{item.myScore==null?<span className="muted">Not tried yet</span>:<Score value={item.myScore} words/>}</div>
        {people.length>0&&<div className="score-spread" role="img" aria-label={`Scores: ${people.map(r=>`${r.author.displayName} ${r.score.toFixed(1)}`).join(', ')}`}>
          <div className="score-spread-track" aria-hidden="true">{people.map(r=><span key={r.author.id} className={`score-spread-dot${r.author.id===user.id?' me':''}`} style={{left:`${(r.score-1)/9*100}%`}} title={`${r.author.displayName}: ${r.score.toFixed(1)}`}><Avatar name={r.author.displayName} url={r.author.avatarUrl}/></span>)}</div>
          <div className="score-spread-scale" aria-hidden="true"><span>1</span><span>5</span><span>10</span></div>
          {agreement&&<p className="score-agreement">{agreement.label}<span className="muted"> · scores range {Math.min(...people.map(r=>r.score)).toFixed(1)}–{Math.max(...people.map(r=>r.score)).toFixed(1)}</span></p>}
        </div>}
      </section>
      {(owner||item.createdBy===user.id)&&!editItem&&<button className="text-button" onClick={()=>{setMetadataCategory(item.type||'');setEditItem(true);}}><Pencil size={14}/> Edit item details</button>}
      {editItem&&<form className="rating-form metadata-form" onSubmit={e=>{
        e.preventDefault();const data=new FormData(e.currentTarget);
        void run(async()=>{await request(`/api/items/${item.id}`,'PATCH',{name:data.get('name'),brand:data.get('brand')||null,variant:data.get('variant')||null,type:data.get('type')||null});setEditItem(false);});
      }}>
        <p className="hint">These details apply to every tasting of this item. Its rating history stays together.</p>
        <label>Name<input name="name" required maxLength={160} defaultValue={item.name}/></label>
        <label>Brand / Restaurant<input name="brand" maxLength={120} defaultValue={item.brand||''}/></label>
        <label>Variant<input name="variant" maxLength={120} defaultValue={item.variant||''}/></label>
        <input type="hidden" name="type" value={metadataCategory}/><CategoryPicker value={metadataCategory} onChange={setMetadataCategory} categories={categories} disabled={busy}/>
        <div className="button-row"><button className="button primary" disabled={busy}>Save item details</button><button type="button" className="button secondary" onClick={()=>setEditItem(false)}>Cancel</button></div>
      </form>}
      <h3 className="section-title">Every tasting <span className="muted">{item.ratings.length}</span></h3>{item.ratings.length===0&&<p className="muted">No ratings yet. Be the first to try it.</p>}
      {item.ratings.map(r=><article className="tasting" key={r.id} data-matthew={isMatthew(r.author.displayName)||undefined}>
        <header><Avatar name={r.author.displayName} url={r.author.avatarUrl}/><div><strong>{person?<button className="text-button" onClick={()=>person(r.author.id)}>{r.author.displayName}</button>:r.author.displayName}</strong><small>{date(r.tastedAt)}</small></div><Score value={r.score} words/></header><RatingStatus rating={r}/>
        <ReviewFieldValues fields={r.categoryFields||[]} values={r.customFields||{}}/>
        {r.note&&<p className="note">{r.note}</p>}
        {r.photoId?<ReviewPhotos ids={reviewPhotoIds(r)} name={`Photos from ${r.author.displayName}'s tasting`}/>:r.legacyPhotoMissing&&<small className="muted">Historical rating · original photo unavailable</small>}
        <div className="tasting-actions">{r.author.id===user.id&&<button className="text-button" onClick={()=>rereview(r,item)}><Repeat2 size={13}/> Rate again</button>}{r.author.id===user.id&&<button className="text-button" onClick={()=>edit(r,item)}><Pencil size={13}/> Edit</button>}{(r.author.id===user.id||owner)&&<button className="text-button danger" onClick={()=>setDeleting(r.id)}><Trash2 size={13}/> Delete</button>}</div>
        {deleting===r.id&&<div className="inline-confirm"><span>Remove this rating from the group?</span><button disabled={busy} onClick={()=>void run(()=>request(`/api/ratings/${r.id}`,'DELETE'))}>Remove</button><button onClick={()=>setDeleting(null)}>Keep it</button></div>}
        <ReviewConversation ratingId={r.id} comments={r.comments} user={user} owner={owner} person={person} onChange={comments=>{setItem(current=>current?{...current,ratings:current.ratings.map(rating=>rating.id===r.id?{...rating,comments}:rating)}:current);}}/>
      </article>)}
    </div>}
  </Modal>;
}
