'use client';
import {useEffect,useState} from 'react';
import {Check,Copy,Share2,UserPlus} from 'lucide-react';
import type {GroupDetail} from '@/lib/contracts';
import {inviteLink} from '@/lib/invite-link';
import {Avatar,Modal,request} from './ui';

/** Opens the invite dialog. Only owners and admins receive the invite code, so others see nothing. */
export function InviteButton({group,changed,className='button secondary',compact=false}:{group:GroupDetail|null;changed:()=>void;className?:string;compact?:boolean}){
  const [open,setOpen]=useState(false);
  if(!group?.inviteCode)return null;
  return <><button type="button" className={className} aria-label={compact?'Invite people':undefined} onClick={()=>setOpen(true)}><UserPlus size={compact?19:17}/>{!compact&&'Invite people'}</button>
    {open&&<InviteDialog group={group} changed={changed} close={()=>setOpen(false)}/>}</>;
}

function InviteDialog({group,changed,close}:{group:GroupDetail;changed:()=>void;close:()=>void}){
  // The reset response is authoritative, so copy and share never offer a revoked link while the group refreshes.
  const [code,setCode]=useState(group.inviteCode||''),link=inviteLink(window.location.origin,code);
  const [copied,setCopied]=useState<'link'|'code'|null>(null),[resetting,setResetting]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const canShare=typeof navigator.share==='function';
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(null),2000);return()=>clearTimeout(timer);},[copied]);
  async function copy(value:string,what:'link'|'code'){setError('');try{await navigator.clipboard.writeText(value);setCopied(what);}catch{setError('Copying isn’t allowed here. Select the link and copy it yourself.');}}
  async function share(){try{await navigator.share({title:`Join ${group.name} on TasteBuds`,url:link});}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))void copy(link,'link');}}
  async function reset(){setBusy(true);setError('');try{const fresh=await request<{inviteCode:string}>(`/api/groups/${group.id}/invite`,'POST',{});setCode(fresh.inviteCode);setStatus('New link ready. Old links and codes no longer work.');setResetting(false);changed();}catch(e){setError(e instanceof Error?e.message:'Could not reset the link.');}finally{setBusy(false);}}
  const shown=group.members.slice(0,5);
  return <Modal title="Invite people" subtitle={group.name} close={close} className="invite-dialog">
    <p className="hint">Anyone with this link can join by signing in with Discord. Share it with people you trust.</p>
    <div className="invite-link-field"><input readOnly aria-label="Invite link" value={link} onFocus={e=>e.currentTarget.select()}/><button type="button" className="button secondary" onClick={()=>void copy(link,'link')}>{copied==='link'?<><Check size={17}/>Copied</>:<><Copy size={17}/>Copy</>}</button></div>
    {canShare&&<button type="button" className="button primary full" onClick={()=>void share()}><Share2 size={18}/>Share link</button>}
    <div className="invite-members"><span className="avatar-stack" aria-hidden="true">{shown.map(m=><Avatar key={m.id} name={m.displayName} url={m.avatarUrl}/>)}</span><span>{group.members.length===1?'Only you so far':`${group.members.length} people are in this group`}</span></div>
    {status&&<p className="success" role="status">{status}</p>}{error&&<p className="error" role="alert">{error}</p>}
    <div className="invite-more">
      {resetting?<div className="inline-confirm"><p>Reset the link? Anyone who hasn’t joined yet will need the new one.</p><button disabled={busy} onClick={()=>void reset()}>{busy?'Resetting…':'Reset link'}</button><button disabled={busy} onClick={()=>setResetting(false)}>Cancel</button></div>
      :<><button type="button" className="text-button" onClick={()=>void copy(code,'code')}>{copied==='code'?'Code copied':'Copy code instead'}</button><button type="button" className="text-button" onClick={()=>{setStatus('');setResetting(true);}}>Reset link</button></>}
    </div>
  </Modal>;
}
