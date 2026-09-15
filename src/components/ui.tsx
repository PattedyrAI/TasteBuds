'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {X,Utensils} from 'lucide-react';
import {discordAvatarUrl} from './catalog-presentation';
export async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const res=await fetch(path,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const result=await res.json();if(!res.ok){if(res.status===401)window.location.href='/';throw new Error(result.error||'Something went wrong. Try again.');}return result;
}
export function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
  const titleId=useId();const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={close}><div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close" onClick={close}><X size={22}/></button></div>{children}</dialog>;
}
export function Photo({id,name,className=''}:{id:string|null;name:string;className?:string}){return id?<img className={`item-photo ${className}`} src={`/api/photos/${id}`} alt={name} loading="lazy"/>:<div className={`photo-placeholder ${className}`}><Utensils size={32}/><span>{name}</span></div>;}
export function Score({value}:{value:number|null}){
 const label=value==null?'—':value.toFixed(1),sixSeven=label==='6.7';
 return <span className={`score${sixSeven?' score-six-seven':''}`}>{sixSeven?<><span className="sr-only">6.7</span><span className="six-seven-digits" aria-hidden="true"><span className="six-seven-digit">6</span>.<span className="six-seven-digit">7</span></span></>:label}<small>/10</small></span>;
}
export const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});

export function Avatar({name,url,decorative=true}:{name:string;url:string|null;decorative?:boolean}){
  const safeUrl=discordAvatarUrl(url),[failed,setFailed]=useState<string|null>(null);
  return <span className="avatar" aria-hidden={decorative||undefined} role={decorative?undefined:'img'} aria-label={decorative?undefined:name}>
    {safeUrl&&failed!==safeUrl?<img src={safeUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(safeUrl)}/>:<span>{Array.from(name.trim())[0]?.toUpperCase()||'?'}</span>}
  </span>;
}
export function BrandMark(){return <><img className="brand-mark" src="/brand-mark.svg" alt="" width="32" height="32"/>TasteBuds</>;}
