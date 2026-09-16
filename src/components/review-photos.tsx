'use client';
import {useState} from 'react';
import {ChevronLeft,ChevronRight,Expand} from 'lucide-react';
import {Modal,Photo} from './ui';
export function reviewPhotoIds(review:{photoId?:string|null;photoIds?:string[]}){
  return review.photoIds?.length?review.photoIds:review.photoId?[review.photoId]:[];
}
export function ReviewPhotos({ids,name,compact=false}:{ids:string[];name:string;compact?:boolean}){
  const [selected,setSelected]=useState(0),[expanded,setExpanded]=useState(false);
  const index=Math.min(selected,ids.length-1);
  if(!ids.length)return null;
  const controls=<div className="review-gallery-controls"><button type="button" className="icon-button" aria-label="Previous photo" disabled={index===0} onClick={()=>setSelected(index-1)}><ChevronLeft size={20}/></button><span role="status">{index+1} / {ids.length}</span><button type="button" className="icon-button" aria-label="Next photo" disabled={index===ids.length-1} onClick={()=>setSelected(index+1)}><ChevronRight size={20}/></button></div>;
  return <div className={`review-gallery${compact?' compact':''}`} aria-label={`${name}: ${ids.length} photos`}>
    <button type="button" className="review-gallery-open" aria-label={`Open photo ${index+1} of ${ids.length}`} onClick={()=>setExpanded(true)}><Photo id={ids[index]} name={`${name}, photo ${index+1}`}/><span className="review-gallery-count"><Expand size={14}/>{ids.length>1?`${index+1} / ${ids.length}`:'View photo'}</span></button>
    {!compact&&ids.length>1&&controls}
    {expanded&&<Modal title={name} close={()=>setExpanded(false)}><div className="review-gallery-expanded"><Photo id={ids[index]} name={`${name}, photo ${index+1}`}/>{ids.length>1&&controls}</div></Modal>}
  </div>;
}
