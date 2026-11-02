'use client';
import {useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,ZoomIn,ZoomOut} from 'lucide-react';
import {Modal,Photo} from './ui';

export function PhotoViewer({ids,initialIndex=0,name,close}:{ids:string[];initialIndex?:number;name:string;close:()=>void}){
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
        <div className="review-gallery-controls">
          {ids.length>1&&<button type="button" className="icon-button" aria-label="Previous photo" disabled={index===0} onClick={()=>changePhoto(index-1)}><ChevronLeft size={22}/></button>}
          <span role="status">{index+1} / {ids.length}</span>
          {ids.length>1&&<button type="button" className="icon-button" aria-label="Next photo" disabled={index===ids.length-1} onClick={()=>changePhoto(index+1)}><ChevronRight size={22}/></button>}
        </div>
        <button type="button" className="photo-zoom-toggle" aria-pressed={zoomed} onClick={()=>setZoomed(value=>!value)}>{zoomed?<ZoomOut size={18}/>:<ZoomIn size={18}/>}<span>{zoomed?'Fit to screen':'Zoom in'}</span></button>
      </div>
      {zoomed&&<p className="hint">Scroll or swipe to explore the photo. Tap to fit it to the screen.</p>}
    </div>
  </Modal>;
}
