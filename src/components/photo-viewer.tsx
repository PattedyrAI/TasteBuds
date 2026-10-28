'use client';
import {useRef,useState} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,ZoomIn,ZoomOut} from 'lucide-react';
import {Modal,Photo} from './ui';

/** `details` adds a way on to the item, for viewers opened from a list where the photo replaced the usual tap target. */
export function PhotoViewer({ids,initialIndex=0,name,close,details}:{ids:string[];initialIndex?:number;name:string;close:()=>void;details?:()=>void}){
  const [selected,setSelected]=useState(initialIndex),[zoomed,setZoomed]=useState(false);
  const viewport=useRef<HTMLDivElement>(null);
  const index=Math.max(0,Math.min(selected,ids.length-1));
  function changePhoto(next:number){
    setSelected(Math.max(0,Math.min(next,ids.length-1)));
    setZoomed(false);
    viewport.current?.scrollTo(0,0);
  }
  if(!ids.length)return null;
  return <Modal title={name} close={close} className="photo-viewer-modal">
    <div className="photo-viewer" onKeyDown={event=>{
      if(zoomed)return;
      if(event.key==='ArrowLeft'){event.preventDefault();changePhoto(index-1);}
      if(event.key==='ArrowRight'){event.preventDefault();changePhoto(index+1);}
    }}>
      <div className={`photo-viewer-stage${zoomed?' is-zoomed':''}`} ref={viewport}>
        <button type="button" className="photo-viewer-image" aria-label={zoomed?'Fit photo to screen':'Zoom in on photo'} onClick={()=>setZoomed(value=>!value)}>
          <Photo id={ids[index]} name={`${name}, photo ${index+1}`}/>
        </button>
      </div>
      <div className="photo-viewer-toolbar">
        {ids.length>1?<div className="review-gallery-controls">
          <button type="button" className="icon-button" aria-label="Previous photo" disabled={index===0} onClick={()=>changePhoto(index-1)}><ChevronLeft size={22}/></button>
          <span role="status">{index+1} / {ids.length}</span>
          <button type="button" className="icon-button" aria-label="Next photo" disabled={index===ids.length-1} onClick={()=>changePhoto(index+1)}><ChevronRight size={22}/></button>
        </div>:details?<button type="button" className="photo-zoom-toggle" onClick={details}><span>View details</span><ArrowUpRight size={18}/></button>:<span/>}
        <button type="button" className="photo-zoom-toggle" aria-pressed={zoomed} onClick={()=>setZoomed(value=>!value)}>{zoomed?<ZoomOut size={18}/>:<ZoomIn size={18}/>}<span>{zoomed?'Fit to screen':'Zoom in'}</span></button>
      </div>
      {zoomed&&<p className="hint">Scroll or swipe to explore the photo. Tap to fit it to the screen.</p>}
    </div>
  </Modal>;
}
