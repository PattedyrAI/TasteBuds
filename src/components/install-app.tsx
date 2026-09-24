'use client';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Download} from 'lucide-react';

interface InstallEvent extends Event {
  prompt():Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}

type Platform='ios'|'safari'|'other';
const dismissalKey='tastebuds-install-dismissed-until';
const InstallContext=createContext<{
  ready:boolean;installed:boolean;platform:Platform;available:boolean;dismissed:boolean;busy:boolean;
  install:()=>Promise<boolean>;dismiss:()=>void;
}|null>(null);

export function InstallProvider({children}:{children:React.ReactNode}){
  const pending=useRef<InstallEvent|null>(null),installing=useRef(false);
  const [ready,setReady]=useState(false),[installed,setInstalled]=useState(false);
  const [platform,setPlatform]=useState<Platform>('other');
  const [available,setAvailable]=useState(false),[dismissed,setDismissed]=useState(false),[busy,setBusy]=useState(false);
  function dismiss(){
    setDismissed(true);
    try{localStorage.setItem(dismissalKey,String(Date.now()+7*24*60*60*1000));}catch{/* Dismiss for this visit if storage is unavailable. */}
  }
  useEffect(()=>{
    const display=window.matchMedia('(display-mode: standalone)');
    const update=()=>setInstalled(display.matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));
    const offer=(event:Event)=>{event.preventDefault();pending.current=event as InstallEvent;setAvailable(true);};
    const done=()=>{setInstalled(true);pending.current=null;setAvailable(false);};
    window.addEventListener('beforeinstallprompt',offer);
    window.addEventListener('appinstalled',done);
    display.addEventListener('change',update);
    update();
    const ua=navigator.userAgent;
    setPlatform(/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'ios':/Safari/.test(ua)&&!/Chrome|Chromium|Edg/.test(ua)?'safari':'other');
    try{const until=Number(localStorage.getItem(dismissalKey));setDismissed(Number.isFinite(until)&&until>Date.now());}catch{/* Private browsing can disable storage. */}
    setReady(true);
    return()=>{window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',done);display.removeEventListener('change',update);};
  },[]);
  async function install(){
    if(installing.current)return true;
    const event=pending.current;
    if(!event)return false;
    // A browser install event can only be used once, across every install button.
    pending.current=null;installing.current=true;setBusy(true);
    try{
      await event.prompt();
      const choice=await event.userChoice;
      if(choice.outcome==='dismissed')dismiss();else setDismissed(true);
      return true;
    }catch{return false;}
    finally{installing.current=false;setBusy(false);}
  }
  return <InstallContext.Provider value={{ready,installed,platform,available,dismissed,busy,install,dismiss}}>{children}</InstallContext.Provider>;
}

export function InstallApp({invitation=false}:{invitation?:boolean}){
  const state=useContext(InstallContext),[help,setHelp]=useState(false);
  if(!state||!state.ready||state.installed)return null;
  if(invitation&&(state.dismissed||(!state.available&&state.platform!=='ios')))return null;
  return <section className={invitation?'install-app match-list':'install-app'} aria-label={invitation?'Install TasteBuds on your device':undefined}>
    {invitation&&<><strong>TasteBuds on your home screen</strong><p className="hint">Open it like a phone app, ready to take photos and share your ratings.</p></>}
    <button type="button" className="button secondary" disabled={state.busy} onClick={async()=>{if(!await state.install())setHelp(true);}}><Download size={17}/>{state.busy?'Opening install…':'Install TasteBuds'}</button>
    {help&&<p className="hint" role="status">{state.platform==='ios'?'In Safari, open Share → Add to Home Screen. If shown, keep Open as Web App enabled, then tap Add.':state.platform==='safari'?'In Safari, choose File → Add to Dock, then click Add.':'Open your browser menu and choose Install TasteBuds or Install app. If it isn’t offered, use Chrome or Edge, or Safari on Apple devices.'} Your ratings stay synced with the website.</p>}
    {invitation&&<button type="button" className="text-button" onClick={state.dismiss}>Not now</button>}
  </section>;
}

export function AppConnection(){
  const [offline,setOffline]=useState(false);
  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine);
    update();window.addEventListener('online',update);window.addEventListener('offline',update);
    if('serviceWorker' in navigator&&process.env.NODE_ENV==='production'){
      void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
    }
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  return offline?<div className="connection-banner" role="status">You’re offline. Reconnect before uploading photos or saving ratings.</div>:null;
}
