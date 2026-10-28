'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {X,Utensils} from 'lucide-react';
import {discordAvatarUrl} from './catalog-presentation';
import {scoreBand,scoreLabel} from '../domain/score-scale';
export async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const res=await fetch(path,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const result=await res.json();if(!res.ok){if(res.status===401)window.location.href='/';throw new Error(result.error||'Something went wrong. Try again.');}return result;
}
/** Open dialogs, innermost last. Each owns one browser history entry so Back closes it instead of leaving the app. */
type Layer={level:number;close:()=>void;guard?:()=>boolean;confirm:()=>void};
const layers:Layer[]=[];
let listening=false,sweep:ReturnType<typeof setTimeout>|undefined,silent=0;
/** History moves made by this module; their popstate events must not close anything. */
function traverse(delta:number){silent++;window.history.go(delta);}
/** Bring the history depth back in line with the dialogs still open (saved, replaced or removed by a parent). */
function settle(){
  if(silent)return;// a traversal is in flight; its popstate settles again
  const target=layers.at(-1)?.level??0,current=levelOf(window.history.state);
  if(current>target)traverse(target-current);
}
function rewindHistory(){clearTimeout(sweep);sweep=setTimeout(settle,0);}
const levelOf=(state:unknown)=>typeof state==='object'&&state!==null&&typeof (state as {tbModal?:unknown}).tbModal==='number'?(state as {tbModal:number}).tbModal:0;
function onPopState(event:PopStateEvent){
  if(silent){silent--;settle();return;}
  const level=levelOf(event.state);
  for(const layer of [...layers].reverse()){
    if(layer.level<=level)break;
    // Unsaved work: restore the entry and ask first.
    if(layer.guard?.()){window.history.pushState({...(event.state||{}),tbModal:layer.level},'');layer.confirm();return;}
    layer.close();
  }
}
/** Dismiss through history when this layer owns the current entry, so Back and the close button stay in step. */
function useDismissLayer(close:()=>void,guard?:()=>boolean){
  const [confirming,setConfirming]=useState(false);
  const layer=useRef<Layer|null>(null);
  const latest=useRef({close,guard});latest.current={close,guard};
  useEffect(()=>{
    if(!listening){window.addEventListener('popstate',onPopState);listening=true;}
    const level=(layers.at(-1)?.level??0)+1;
    const entry:Layer={level,close:()=>latest.current.close(),guard:()=>latest.current.guard?.()??false,confirm:()=>setConfirming(true)};
    layers.push(entry);layer.current=entry;
    // A dialog that replaces others reuses the entry at its own depth instead of stacking a stale one.
    const current=levelOf(window.history.state),state={...(window.history.state||{}),tbModal:level};
    if(current<level)window.history.pushState(state,'');
    else if(current===level)window.history.replaceState(state,'');
    else traverse(level-current);
    return()=>{const index=layers.indexOf(entry);if(index>=0)layers.splice(index,1);rewindHistory();};
  },[]);
  const dismiss=(force=false)=>{
    const entry=layer.current;if(!entry)return;
    if(!force&&entry.guard?.()){setConfirming(true);return;}
    setConfirming(false);
    if(levelOf(window.history.state)===entry.level){entry.guard=undefined;window.history.back();}
    else entry.close();
  };
  return {dismiss,confirming,setConfirming};
}
export function Modal({title,close,children,className='',guard,guardMessage='Discard your changes?',footer,subtitle}:{title:string;close:()=>void;children:React.ReactNode;className?:string;guard?:()=>boolean;guardMessage?:string;footer?:React.ReactNode;subtitle?:React.ReactNode}){
  const titleId=useId();const ref=useRef<HTMLDialogElement>(null);const pointerStart=useRef<EventTarget|null>(null),drag=useRef<{y:number}|null>(null);
  const {dismiss,confirming,setConfirming}=useDismissLayer(close,guard);
  // Removing an open dialog drops focus to <body>; hand it back to whatever opened it so keyboard users keep their place in the list.
  useEffect(()=>{const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;ref.current?.showModal();return()=>{const focus=document.activeElement;if(opener?.isConnected&&(!focus||focus===document.body))opener.focus({preventScroll:true});};},[]);
  // A press that starts and ends on the backdrop closes; dragging a text selection out of the sheet does not.
  const outside=(event:React.PointerEvent<HTMLDialogElement>)=>{const box=ref.current?.getBoundingClientRect();return !!box&&event.target===ref.current&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom);};
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={titleId}
    onPointerDown={event=>{pointerStart.current=outside(event)?event.target:null;}}
    onPointerUp={event=>{if(pointerStart.current&&outside(event))dismiss();pointerStart.current=null;}}
    onCancel={event=>{event.preventDefault();event.stopPropagation();dismiss();}}>
    <div className="modal-head" onPointerDown={event=>{if(event.pointerType!=='mouse')drag.current={y:event.clientY};}} onPointerMove={event=>{const start=drag.current;if(!start||!ref.current)return;const dy=Math.max(0,event.clientY-start.y);ref.current.style.transform=dy?`translateY(${dy}px)`:'';}} onPointerUp={event=>{const start=drag.current;drag.current=null;if(!start||!ref.current)return;ref.current.style.transform='';if(event.clientY-start.y>90)dismiss();}} onPointerCancel={()=>{drag.current=null;if(ref.current)ref.current.style.transform='';}}><span className="sheet-grip" aria-hidden="true"/><div className="modal-title"><h2 id={titleId}>{title}</h2>{subtitle}</div><button type="button" className="icon-button" aria-label="Close" onClick={()=>dismiss()}><X size={22}/></button></div>
    <div className="modal-body">{children}</div>
    {footer&&<div className="modal-footer">{footer}</div>}
    {confirming&&<div className="discard-confirm" role="alertdialog" aria-label={guardMessage}><p>{guardMessage}</p><div className="button-row"><button type="button" className="button secondary" onClick={()=>setConfirming(false)}>Keep editing</button><button type="button" className="button danger-solid" onClick={()=>dismiss(true)}>Discard</button></div></div>}
  </dialog>;
}
export function Photo({id,name,className=''}:{id:string|null;name:string;className?:string}){return id?<img className={`item-photo ${className}`} src={`/api/photos/${id}`} alt={name} loading="lazy"/>:<div className={`photo-placeholder ${className}`}><Utensils size={32}/><span>{name}</span></div>;}
export function Score({value,words=false,size}:{value:number|null;words?:boolean;size?:'lg'}){
 const label=value==null?'—':value.toFixed(1),sixSeven=label==='6.7',tier=value==null?undefined:scoreBand(value).tier;
 return <span className={`score${sixSeven?' score-six-seven':''}${size?` score-${size}`:''}`} data-tier={tier}><span className="score-number">{sixSeven?<><span className="sr-only">6.7</span><span className="six-seven-digits" aria-hidden="true"><span className="six-seven-digit">6</span>.<span className="six-seven-digit">7</span></span></>:label}<small>/10</small></span>{words&&value!=null&&<span className="score-words">{scoreLabel(value)}</span>}</span>;
}
export const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});

export function Avatar({name,url,decorative=true}:{name:string;url:string|null;decorative?:boolean}){
  const safeUrl=discordAvatarUrl(url),[failed,setFailed]=useState<string|null>(null);
  return <span className="avatar" aria-hidden={decorative||undefined} role={decorative?undefined:'img'} aria-label={decorative?undefined:name}>
    {safeUrl&&failed!==safeUrl?<img src={safeUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(safeUrl)}/>:<span>{Array.from(name.trim())[0]?.toUpperCase()||'?'}</span>}
  </span>;
}
export function BrandMark(){return <><img className="brand-mark" src="/brand-mark.svg" alt="" width="32" height="32"/><span className="wordmark-text">TasteBuds</span><span className="wordmark-matthew" aria-hidden="true">MATTHEW</span></>;}
