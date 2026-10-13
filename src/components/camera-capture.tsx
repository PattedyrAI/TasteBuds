'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,RefreshCw,Upload} from 'lucide-react';
import {Modal} from './ui';

/** Phones open their own camera app from a capture input, which gives better photos than a web viewfinder. */
export function prefersLiveCamera(){
  return typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&window.matchMedia('(pointer: fine)').matches;
}

/** A live viewfinder for computers and webcams. Every failure offers the photo library instead. */
export function CameraCapture({capture,close,upload}:{capture:(file:File)=>void;close:()=>void;upload:()=>void}){
  const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null);
  const [state,setState]=useState<'starting'|'ready'|'blocked'|'missing'|'failed'>('starting'),[facing,setFacing]=useState<'environment'|'user'>('environment'),[cameras,setCameras]=useState(0);
  useEffect(()=>{
    let active=true;setState('starting');
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1440}},audio:false}).then(async media=>{
      if(!active){media.getTracks().forEach(track=>track.stop());return;}
      stream.current=media;if(video.current){video.current.srcObject=media;await video.current.play().catch(()=>{});}
      setState('ready');
      const devices=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);if(active)setCameras(devices.filter(device=>device.kind==='videoinput').length);
    }).catch((error:unknown)=>{
      if(!active)return;
      const name=error instanceof DOMException?error.name:'';
      setState(name==='NotAllowedError'||name==='SecurityError'?'blocked':name==='NotFoundError'||name==='OverconstrainedError'?'missing':'failed');
    });
    return()=>{active=false;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  },[facing]);
  function shoot(){
    const source=video.current;if(!source||!source.videoWidth)return;
    const canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;
    canvas.getContext('2d')?.drawImage(source,0,0);
    canvas.toBlob(blob=>{if(!blob)return;capture(new File([blob],`photo-${Date.now()}.jpg`,{type:'image/jpeg'}));},'image/jpeg',.92);
  }
  const message={blocked:'Camera access is blocked. Allow it in your browser’s site settings, or choose a photo instead.',missing:'No camera was found on this device.',failed:'The camera didn’t start. Choose a photo instead.'};
  return <Modal title="Take a photo" className="camera-modal" close={close}>
    <div className="camera-frame" data-state={state}>
      <video ref={video} playsInline muted aria-label="Camera preview"/>
      {state==='starting'&&<p className="camera-note" role="status">Starting the camera…</p>}
      {state!=='starting'&&state!=='ready'&&<div className="camera-note" role="alert"><p>{message[state]}</p><button type="button" className="button secondary" onClick={upload}><Upload size={18}/>Choose a photo</button></div>}
    </div>
    <div className="camera-controls">
      {cameras>1?<button type="button" className="icon-button" aria-label="Switch camera" onClick={()=>setFacing(f=>f==='environment'?'user':'environment')}><RefreshCw size={20}/></button>:<span/>}
      <button type="button" className="shutter" aria-label="Take photo" disabled={state!=='ready'} onClick={shoot}><Camera size={26}/></button>
      <button type="button" className="text-button" onClick={upload}>Library</button>
    </div>
  </Modal>;
}
