'use client';
import {useEffect,useId,useRef} from 'react';
import {X,Utensils} from 'lucide-react';
export async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const res=await fetch(path,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const result=await res.json();if(!res.ok){if(res.status===401)window.location.href='/';throw new Error(result.error||'Something went wrong. Try again.');}return result;
}
export function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
  const titleId=useId();const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={close}><div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close" onClick={close}><X size={22}/></button></div>{children}</dialog>;
}
export function Photo({id,name,className=''}:{id:string|null;name:string;className?:string}){return id?<img className={`item-photo ${className}`} src={`/api/photos/${id}`} alt={name} loading="lazy"/>:<div className={`photo-placeholder ${className}`}><Utensils size={32}/><span>{name}</span></div>;}
export function Score({value}:{value:number|null}){return <span className="score">{value==null?'—':value.toFixed(1)}<small>/10</small></span>;}
export const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
