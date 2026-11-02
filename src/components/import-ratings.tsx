'use client';
import {useEffect,useState} from 'react';
import type {Category,Group,GroupDetail} from '@/lib/contracts';
import {request} from './ui';

export function ImportRatings({group,groups,changed}:{group:GroupDetail;groups:Group[];changed:(message:string)=>void}){
  const [source,setSource]=useState(''),[categories,setCategories]=useState<Category[]>([]),[category,setCategory]=useState(''),[destination,setDestination]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  useEffect(()=>{
    let active=true;setCategories([]);setCategory('');setError('');setSuccess('');
    if(!source){setLoading(false);return;}
    setLoading(true);
    request<GroupDetail>(`/api/groups/${source}`).then(value=>{if(active)setCategories(value.categories||[]);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[source]);
  async function submit(){
    setBusy(true);setError('');setSuccess('');
    try{const result=await request<{imported:number;skipped:number}>(`/api/groups/${group.id}/import-ratings`,'POST',{sourceGroupId:source,sourceCategoryId:category,destinationCategoryId:destination});const message=`${result.imported} ratings imported. ${result.skipped} already imported.`;setSuccess(message);changed(message);}
    catch(e){setError(e instanceof Error?e.message:'Could not import ratings.');}finally{setBusy(false);}
  }
  return <form className="settings-section" onSubmit={e=>{e.preventDefault();void submit();}}><h2>Import your ratings</h2><p>Copy your ratings from one category in another group into this group. Originals stay where they are. Ratings already imported are skipped.</p>
    <label>From group<select required disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose a group</option>{groups.filter(g=>g.id!==group.id).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    <label>From category<select required disabled={busy||loading||!source} value={category} onChange={e=>setCategory(e.target.value)}><option value="">{loading?'Loading categories…':'Choose a category'}</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Into category in {group.name}<select required disabled={busy} value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose a category</option>{group.categories?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <p className="hint">Includes scores, notes, tasting dates and photos. Only your active ratings with photos are copied. Comments and Discord announcements are excluded.</p>
    <button className="button secondary" disabled={busy||loading||!source||!category||!destination}>{busy?'Importing…':'Import all my ratings in this category'}</button>
    {error&&<p className="error" role="alert">{error}</p>}{success&&<p className="success" role="status">{success}</p>}
  </form>;
}
