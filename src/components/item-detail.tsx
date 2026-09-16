'use client';
import {useEffect,useState} from 'react';
import {ReviewPhotos,reviewPhotoIds} from './review-photos';
import {RatingStatus} from './rating-status';
import {BrandLabel} from './brand-label';
import {CategoryPicker} from './category-picker';
import {SaveItemButton} from './discovery-actions';
import {Plus,Trash2,Pencil,Repeat2} from 'lucide-react';
import type {ItemDetail as Detail,Rating,User} from '@/lib/contracts';
import {Avatar,Modal,Photo,Score,request,date} from './ui';

export function ItemDetail({id,user,owner,close,rate,edit,changed,person,rereview,categories}:{id:string;user:User;owner:boolean;close:()=>void;rate:(item:Detail)=>void;edit:(rating:Rating,item:Detail)=>void;changed:()=>void;person?:(id:string)=>void;rereview:(rating:Rating,item:Detail)=>void;categories:string[]}){
  const [item,setItem]=useState<Detail|null>(null),[error,setError]=useState('');
  const [comments,setComments]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<string|null>(null);
  const [metadataCategory,setMetadataCategory]=useState('');
  const [editItem,setEditItem]=useState(false),[editComment,setEditComment]=useState<{id:string;body:string}|null>(null);
  const load=()=>request<Detail>(`/api/items/${id}`).then(setItem).catch(e=>setError(e.message));
  useEffect(()=>{void load();},[id]);
  async function run(work:()=>Promise<unknown>){
    setError('');setBusy(true);
    try{await work();await load();changed();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}
    finally{setBusy(false);setDeleting(null);}
  }
  return <Modal title={item?.name||'Item history'} close={close}>
    {error&&<p role="alert" className="error">{error}</p>}
    {!item?<p className="muted">Loading ratings…</p>:<div className={`detail${item.myScore===10?' personal-perfect':''}`}>
      <div className="detail-summary"><Photo id={item.photoId} name={item.name}/><div>
        <div className="detail-brand"><BrandLabel brand={item.brand} interactive/>{item.variant&&<p className="muted">{item.variant}</p>}</div>
        {item.type&&<span className="tag">{item.type}</span>}<Score value={item.average}/>
        <p>{item.raterCount} people · {item.tastingCount} tastings</p><small className="muted">Average of each person’s latest rating.</small><p className="personal-score">{item.myScore==null?"You haven’t tried this":`Your latest score: ${item.myScore.toFixed(1)}/10`}</p><SaveItemButton item={item} changed={saved=>setItem(current=>current?{...current,saved}:current)}/>
        {(owner||item.createdBy===user.id)&&<button className="text-button" onClick={()=>{setMetadataCategory(item.type||'');setEditItem(v=>!v);}}><Pencil size={13}/> Edit item details</button>}
      </div></div>
      {editItem&&<form className="rating-form metadata-form" onSubmit={e=>{
        e.preventDefault();const data=new FormData(e.currentTarget);
        void run(async()=>{await request(`/api/items/${item.id}`,'PATCH',{name:data.get('name'),brand:data.get('brand')||null,variant:data.get('variant')||null,type:data.get('type')||null});setEditItem(false);});
      }}>
        <p className="hint">These details apply to every tasting of this item. Its rating history stays together.</p>
        <label>Item / Model<input name="name" required maxLength={160} defaultValue={item.name}/></label>
        <label>Brand / Restaurant<input name="brand" maxLength={120} defaultValue={item.brand||''}/></label>
        <label>Variant<input name="variant" maxLength={120} defaultValue={item.variant||''}/></label>
        <input type="hidden" name="type" value={metadataCategory}/><CategoryPicker value={metadataCategory} onChange={setMetadataCategory} categories={categories} disabled={busy}/>
        <div className="button-row"><button className="button primary" disabled={busy}>Save item details</button><button type="button" className="button secondary" onClick={()=>setEditItem(false)}>Cancel</button></div>
      </form>}
      <button className="button primary full" onClick={()=>{const previous=item.ratings.find(r=>r.author.id===user.id&&r.countsTowardAverage);if(previous)rereview(previous,item);else rate(item);}}><Plus size={18}/> {item.ratings.some(r=>r.author.id===user.id)?'Add a rereview':'Add your rating'}</button>
      <h3>Every tasting</h3>{item.ratings.length===0&&<p className="muted">No ratings yet. Be the first to try it.</p>}
      {item.ratings.map(r=><article className="tasting" key={r.id}>
        <header><Avatar name={r.author.displayName} url={r.author.avatarUrl}/><div><strong>{person?<button className="text-button" onClick={()=>person(r.author.id)}>{r.author.displayName}</button>:r.author.displayName}</strong><small>{date(r.tastedAt)}</small></div><Score value={r.score}/></header><RatingStatus rating={r}/>
        {r.note&&<p className="note">{r.note}</p>}
        {r.photoId?<ReviewPhotos ids={reviewPhotoIds(r)} name={`Photos from ${r.author.displayName}'s tasting`}/>:r.legacyPhotoMissing&&<small className="muted">Historical rating · original photo unavailable</small>}
        <div className="tasting-actions">{r.author.id===user.id&&<button className="text-button" onClick={()=>rereview(r,item)}><Repeat2 size={13}/> Rereview</button>}{r.author.id===user.id&&<button className="text-button" onClick={()=>edit(r,item)}><Pencil size={13}/> Edit</button>}{(r.author.id===user.id||owner)&&<button className="text-button danger" onClick={()=>setDeleting(r.id)}><Trash2 size={13}/> Delete</button>}</div>
        {deleting===r.id&&<div className="inline-confirm"><span>Remove this rating from the group?</span><button disabled={busy} onClick={()=>void run(()=>request(`/api/ratings/${r.id}`,'DELETE'))}>Remove</button><button onClick={()=>setDeleting(null)}>Keep it</button></div>}
        {r.comments.map(c=><div className="comment" key={c.id}><strong>{c.author.displayName}</strong>
          {editComment?.id===c.id?<form className="comment-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(`/api/comments/${c.id}`,'PATCH',{body:editComment.body});setEditComment(null);});}}>
            <input aria-label="Edit comment" required maxLength={3000} value={editComment.body} onChange={e=>setEditComment({id:c.id,body:e.target.value})}/><button disabled={busy||!editComment.body.trim()}>Save</button><button type="button" onClick={()=>setEditComment(null)}>Cancel</button>
          </form>:<><span>{c.body}</span>{c.author.id===user.id&&<button aria-label="Edit your comment" onClick={()=>setEditComment({id:c.id,body:c.body})}><Pencil size={13}/></button>}{(c.author.id===user.id||owner)&&<button aria-label={`Delete comment by ${c.author.displayName}`} onClick={()=>setDeleting(`comment:${c.id}`)}>×</button>}</>}
          {deleting===`comment:${c.id}`&&<div className="inline-confirm"><span>Delete this comment?</span><button disabled={busy} onClick={()=>void run(()=>request(`/api/comments/${c.id}`,'DELETE'))}>Delete</button><button onClick={()=>setDeleting(null)}>Keep it</button></div>}
        </div>)}
        <form className="comment-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await request(`/api/ratings/${r.id}/comments`,'POST',{body:comments[r.id]});setComments(v=>({...v,[r.id]:''}));});}}><input aria-label={`Comment on ${r.author.displayName}'s rating`} placeholder="Add a thought…" value={comments[r.id]||''} maxLength={3000} onChange={e=>setComments(v=>({...v,[r.id]:e.target.value}))}/><button disabled={busy||!comments[r.id]?.trim()}>Post</button></form>
      </article>)}
    </div>}
  </Modal>;
}
