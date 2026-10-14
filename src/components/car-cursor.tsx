'use client';
import {useEffect,useRef} from 'react';
import {Burnout,type CarSpec} from './burnout';

/** ChatGPT-drawn McLaren 720S from above and in front, nose toward the bottom left; dihedral doors closed (frame 0) to fully up. */
const SHEET='/matthew/720s-frames.png';
const CAR:CarSpec={frames:8,w:56,h:53,hot:{x:2,y:47},wheel:{x:52,y:24,rx:2.5,ry:5},back:{x:.79,y:-.62}};
/** Smoke is drawn at half resolution, so each smoke pixel is a chunky 2x2. */
const SMOKE_SCALE=2;

/** Things the pointer can click. Text fields are excluded: they keep the native caret instead of the car. */
export const CLICKABLE='a[href],button:not(:disabled),summary,label,select,[role=button],[role=option],[role=switch],[role=tab],input[type=checkbox],input[type=radio],input[type=range]';
const TEXT_FIELD='textarea,[contenteditable]:not([contenteditable=false]),input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color])';

export function cursorState(target:EventTarget|null):'text'|'click'|'idle'{
  if(!(target instanceof Element))return 'idle';
  if(target.closest(TEXT_FIELD))return 'text';
  return target.closest(CLICKABLE)?'click':'idle';
}

/** Matthew mode: the mouse pointer becomes a pixel 720S that lifts its doors and does a burnout over anything clickable. */
export function CarCursor(){
  const layerRef=useRef<HTMLDivElement>(null),carRef=useRef<HTMLCanvasElement>(null),smokeRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const layer=layerRef.current,carCanvas=carRef.current,smokeCanvas=smokeRef.current;
    const car=carCanvas?.getContext('2d'),smoke=smokeCanvas?.getContext('2d');
    if(!layer||!carCanvas||!smokeCanvas||!car||!smoke)return;
    const root=document.documentElement;
    const fine=window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const burnout=new Burnout(CAR,reduced.matches);
    // Modals use showModal(), which paints in the top layer above any z-index. The cursor is a manual popover so it can
    // join the top layer too, re-shown whenever a new modal opens so it stays the newest (topmost) entry.
    const popover=typeof layer.showPopover==='function';
    let modals=0;
    const raise=()=>{
      const open=document.querySelectorAll('dialog:modal').length;
      if(popover&&(open>modals||!layer.matches(':popover-open'))){if(layer.matches(':popover-open'))layer.hidePopover();layer.showPopover();}
      modals=open;
    };

    let sheet:HTMLImageElement|null=null;
    let smokeImage:ImageData|null=null,smokePixels:Uint32Array|null=null;
    const sizeSmoke=()=>{
      smokeCanvas.width=Math.ceil(innerWidth/SMOKE_SCALE);smokeCanvas.height=Math.ceil(innerHeight/SMOKE_SCALE);
      smokeImage=smoke.createImageData(smokeCanvas.width,smokeCanvas.height);smokePixels=new Uint32Array(smokeImage.data.buffer);
    };
    const origin={x:0,y:0};
    let raf=0,drawn=-1;
    const render=(now:number)=>{
      raf=0;
      burnout.update(now,origin);
      if(sheet?.complete&&(burnout.frame!==drawn||burnout.spinning)){burnout.drawCar(car,sheet,now);drawn=burnout.frame;}
      if(smokeImage&&smokePixels){
        smokePixels.fill(0);
        burnout.drawSmoke(smokePixels,smokeCanvas.width,smokeCanvas.height,now,SMOKE_SCALE);
        smoke.putImageData(smokeImage,0,0);
      }
      if(burnout.busy)raf=requestAnimationFrame(render);
    };
    const wake=()=>{raf||=requestAnimationFrame(render);};

    const onMove=(event:PointerEvent)=>{
      if(event.pointerType!=='mouse'||!fine.matches||root.dataset.theme!=='matthew'){delete root.dataset.carCursor;burnout.hover(false,performance.now());return;}
      raise();
      // Without popover support the car would sit under an open modal, so fall back to the native pointer there.
      if(!popover&&modals){delete root.dataset.carCursor;return;}
      if(!sheet){sheet=new Image();sheet.onload=()=>{drawn=-1;wake();};sheet.src=SHEET;sizeSmoke();}
      root.dataset.carCursor='';
      const state=cursorState(event.target);
      carCanvas.hidden=state==='text';
      origin.x=event.clientX-CAR.hot.x;origin.y=event.clientY-CAR.hot.y;
      carCanvas.style.transform=`translate3d(${origin.x}px,${origin.y}px,0)`;
      burnout.hover(state==='click',performance.now());
      wake();
    };
    const onOut=(event:MouseEvent)=>{if(!event.relatedTarget){carCanvas.hidden=true;burnout.hover(false,performance.now());wake();}};
    const onResize=()=>{if(sheet)sizeSmoke();};
    window.addEventListener('pointermove',onMove,{passive:true});
    document.addEventListener('mouseout',onOut);
    window.addEventListener('resize',onResize);
    return()=>{
      window.removeEventListener('pointermove',onMove);document.removeEventListener('mouseout',onOut);window.removeEventListener('resize',onResize);
      cancelAnimationFrame(raf);delete root.dataset.carCursor;if(popover&&layer.matches(':popover-open'))layer.hidePopover();
    };
  },[]);
  return <div ref={layerRef} className="car-cursor" aria-hidden="true" popover="manual">
    <canvas ref={smokeRef} className="car-cursor-smoke"/>
    <canvas ref={carRef} className="car-cursor-car" width={CAR.w+1} height={CAR.h+1} hidden/>
  </div>;
}
