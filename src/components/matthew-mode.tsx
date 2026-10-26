'use client';
import {useEffect,useState} from 'react';
import {McLarenDrift} from './mclaren-drift';
import {CarCursor} from './car-cursor';

const SECRET='MATTHEW';
const STORAGE_KEY='tastebuds-secret-mode';
export type SecretMode='matthew'|'bristian';
/** Cans drifting behind the UI in either secret mode; positions and timing live in matthew.css. */
const FLOATERS=['peach','blue','blue','peach'];

/** Restore either theme before paint, including existing Matthew preferences. */
export const matthewModeBootScript=`try{var mode=localStorage.getItem('${STORAGE_KEY}');if(mode===null&&localStorage.getItem('tastebuds-matthew-mode')==='on')mode='matthew';if(mode==='matthew'||mode==='bristian')document.documentElement.dataset.theme=mode}catch(e){}`;

/** Keeps the last letters typed; returns the new buffer and whether the secret word was completed. */
export function trackSecret(buffer:string,key:string,secret=SECRET){
  if(key.length!==1)return {buffer,matched:false}; // Shift, CapsLock and other named keys
  if(!/^[a-z]$/i.test(key))return {buffer:'',matched:false};
  const next=(buffer+key.toUpperCase()).slice(-secret.length);
  return next===secret?{buffer:'',matched:true}:{buffer:next,matched:false};
}

/** Both names share one buffer so switching modes never leaves a partial secret behind. */
export function trackModeSecret(buffer:string,key:string):{buffer:string;mode:SecretMode|null}{
  const bristian=trackSecret(buffer,key,'BRISTIAN');
  const matthew=trackSecret(buffer,key);
  if(bristian.matched||matthew.matched)return {buffer:'',mode:bristian.matched?'bristian':'matthew'};
  return {buffer:bristian.buffer,mode:null};
}

function isEditable(target:EventTarget|null){
  return target instanceof HTMLElement&&(target.isContentEditable||!!target.closest('input,textarea,select,[contenteditable]'));
}

/** Typing MATTHEW or BRISTIAN on a physical keyboard toggles its saved theme. */
export function MatthewMode(){
  const [mode,setMode]=useState<SecretMode|null>(null);
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    const saved=document.documentElement.dataset.theme;
    setMode(saved==='matthew'||saved==='bristian'?saved:null);
    let buffer='';
    let hide:ReturnType<typeof setTimeout>|undefined;
    const onKey=(event:KeyboardEvent)=>{
      // Soft keyboards only open inside text fields, so ignoring those keeps this to real keyboards.
      if(event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||isEditable(event.target))return;
      const result=trackModeSecret(buffer,event.key);
      buffer=result.buffer;
      if(!result.mode)return;
      const root=document.documentElement;
      const on=root.dataset.theme!==result.mode;
      if(on)root.dataset.theme=result.mode;else delete root.dataset.theme;
      delete root.dataset.carCursor;
      setMode(on?result.mode:null);
      try{localStorage.setItem(STORAGE_KEY,on?result.mode:'off');}catch{}
      const name=result.mode==='bristian'?'Bristian':'Matthew';
      setNotice(`${name} mode ${on?'on':'off'}`);
      clearTimeout(hide);hide=setTimeout(()=>setNotice(''),2600);
    };
    window.addEventListener('keydown',onKey);
    return()=>{window.removeEventListener('keydown',onKey);clearTimeout(hide);};
  },[]);
  return <>
    <div className="matthew-floaters" aria-hidden="true">{FLOATERS.map((can,i)=><span key={i} className={`matthew-can ${can}`}/>)}</div>
    {mode&&<McLarenDrift key={mode} mode={mode}/>}
    {mode==='matthew'&&<CarCursor/>}
    <div className="matthew-notice" role="status" aria-live="polite">{notice&&<span>{notice}</span>}</div>
  </>;
}
