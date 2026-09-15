'use client';
import {useEffect,useState} from 'react';
import {Download} from 'lucide-react';

interface InstallEvent extends Event {
  prompt():Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}

export function InstallApp(){
  const [prompt,setPrompt]=useState<InstallEvent|null>(null);
  const [installed,setInstalled]=useState(false);
  const [platform,setPlatform]=useState<'ios'|'safari'|'other'>('other');
  const [help,setHelp]=useState(false);
  useEffect(()=>{
    const display=window.matchMedia('(display-mode: standalone)');
    const update=()=>setInstalled(display.matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));
    const offer=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent);};
    const done=()=>{setInstalled(true);setPrompt(null);};
    update();
    const ua=navigator.userAgent;
    setPlatform(/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'ios':/Safari/.test(ua)&&!/Chrome|Chromium|Edg/.test(ua)?'safari':'other');
    window.addEventListener('beforeinstallprompt',offer);
    window.addEventListener('appinstalled',done);
    display.addEventListener('change',update);
    return()=>{window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',done);display.removeEventListener('change',update);};
  },[]);
  if(installed)return null;
  return <div className="install-app"><button type="button" className="button secondary" onClick={async()=>{
    if(!prompt){setHelp(v=>!v);return;}
    try{await prompt.prompt();await prompt.userChoice;}finally{setPrompt(null);}
  }}><Download size={17}/> Install TasteBuds</button>{help&&<p className="hint">{platform==='ios'?'In Safari, open Share → Add to Home Screen, then tap Add.':platform==='safari'?'In Safari, choose File → Add to Dock, then click Add.':'Open your browser menu and choose Install TasteBuds or Install app. If it isn’t offered, use Chrome or Edge, or Safari on Apple devices.'} Your ratings stay synced with the website.</p>}</div>;
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
