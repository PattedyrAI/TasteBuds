'use client';
import {useEffect,useRef} from 'react';

/** Sprite strip (matthew.css, /matthew/720s-frames.png): ChatGPT-drawn McLaren 720S, side profile facing left, dihedral doors closed (frame 0) to fully up. */
const FRAMES=8;
const FRAME_W=59,FRAME_H=35;
const SCALE=1;
/** Nose tip in sprite pixels: the point that clicks. */
const HOT_X=1,HOT_Y=28;
const FRAME_MS=26;

/** Things the pointer can click. Text fields are excluded: they keep the native caret instead of the car. */
export const CLICKABLE='a[href],button:not(:disabled),summary,label,select,[role=button],[role=option],[role=switch],[role=tab],input[type=checkbox],input[type=radio],input[type=range]';
const TEXT_FIELD='textarea,[contenteditable]:not([contenteditable=false]),input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color])';

export function cursorState(target:EventTarget|null):'text'|'click'|'idle'{
  if(!(target instanceof Element))return 'idle';
  if(target.closest(TEXT_FIELD))return 'text';
  return target.closest(CLICKABLE)?'click':'idle';
}

/** Matthew mode: the mouse pointer becomes a pixel 720S that lifts its doors over anything clickable. */
export function CarCursor(){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const car=ref.current;
    if(!car)return;
    const root=document.documentElement;
    const fine=window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,target=0,timer:ReturnType<typeof setInterval>|undefined;
    const draw=()=>{car.style.backgroundPosition=`${-frame*FRAME_W*SCALE}px 0`;};
    const step=()=>{
      if(frame===target){clearInterval(timer);timer=undefined;return;}
      frame+=frame<target?1:-1;draw();
    };
    const aim=(next:number)=>{
      if(next===target)return;
      target=next;
      if(reduced.matches){frame=target;draw();return;}
      timer??=setInterval(step,FRAME_MS);
    };
    const onMove=(event:PointerEvent)=>{
      if(event.pointerType!=='mouse'||!fine.matches){delete root.dataset.carCursor;return;}
      root.dataset.carCursor='';
      const state=cursorState(event.target);
      car.hidden=state==='text';
      car.style.transform=`translate3d(${event.clientX-HOT_X*SCALE}px,${event.clientY-HOT_Y*SCALE}px,0)`;
      aim(state==='click'?FRAMES-1:0);
    };
    const onOut=(event:MouseEvent)=>{if(!event.relatedTarget)car.hidden=true;};
    window.addEventListener('pointermove',onMove,{passive:true});
    document.addEventListener('mouseout',onOut);
    return()=>{
      window.removeEventListener('pointermove',onMove);document.removeEventListener('mouseout',onOut);
      clearInterval(timer);delete root.dataset.carCursor;
    };
  },[]);
  return <div ref={ref} className="car-cursor" aria-hidden="true" hidden style={{width:FRAME_W*SCALE,height:FRAME_H*SCALE,backgroundSize:`${FRAME_W*FRAMES*SCALE}px ${FRAME_H*SCALE}px`}}/>;
}
