'use client';
import {useEffect,useState} from 'react';

const SECRET='MATTHEW';
const STORAGE_KEY='tastebuds-matthew-mode';

/** Runs before paint so a saved Matthew mode never flashes the light theme. */
export const matthewModeBootScript=`try{if(localStorage.getItem('${STORAGE_KEY}')==='on')document.documentElement.dataset.theme='matthew'}catch(e){}`;

/** Keeps the last letters typed; returns the new buffer and whether the secret word was completed. */
export function trackSecret(buffer:string,key:string){
  if(key.length!==1)return {buffer,matched:false}; // Shift, CapsLock and other named keys
  if(!/^[a-z]$/i.test(key))return {buffer:'',matched:false};
  const next=(buffer+key.toUpperCase()).slice(-SECRET.length);
  return next===SECRET?{buffer:'',matched:true}:{buffer:next,matched:false};
}

function isEditable(target:EventTarget|null){
  return target instanceof HTMLElement&&(target.isContentEditable||!!target.closest('input,textarea,select,[contenteditable]'));
}

/** Easter egg: typing MATTHEW on a physical keyboard toggles a dark theme with orange accents. */
export function MatthewMode(){
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    let buffer='';
    let hide:ReturnType<typeof setTimeout>|undefined;
    const onKey=(event:KeyboardEvent)=>{
      // Soft keyboards only open inside text fields, so ignoring those keeps this to real keyboards.
      if(event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||isEditable(event.target))return;
      const result=trackSecret(buffer,event.key);
      buffer=result.buffer;
      if(!result.matched)return;
      const root=document.documentElement;
      const on=root.dataset.theme!=='matthew';
      if(on)root.dataset.theme='matthew';else delete root.dataset.theme;
      try{localStorage.setItem(STORAGE_KEY,on?'on':'off');}catch{}
      setNotice(on?'Matthew mode on':'Matthew mode off');
      clearTimeout(hide);hide=setTimeout(()=>setNotice(''),2600);
    };
    window.addEventListener('keydown',onKey);
    return()=>{window.removeEventListener('keydown',onKey);clearTimeout(hide);};
  },[]);
  return <div className="matthew-notice" role="status" aria-live="polite">{notice&&<span>{notice}</span>}</div>;
}
