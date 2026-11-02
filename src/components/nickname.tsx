'use client';
import {useId,useState} from 'react';
import type {User} from '@/lib/contracts';
import {BrandMark,request} from './ui';
import {Disclosure} from './disclosure';
import {InstallApp,useCanInstall} from './install-app';

function NicknameForm({user,saved,onboarding=false}:{user:User;saved:(user:User)=>void;onboarding?:boolean}){
  const [nickname,setNickname]=useState(user.nickname??user.displayName),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const helpId=useId(),errorId=useId(),value=nickname.trim();
  async function submit(event:React.FormEvent){
    event.preventDefault();if(busy)return;
    if(!value||value.length>40){setError('Choose a nickname between 1 and 40 characters.');return;}
    setBusy(true);setError('');
    try{const updated=await request<User>('/api/me','PATCH',{nickname:value});saved(updated);}
    catch(e){setError(e instanceof Error?e.message:'Could not save your nickname. Try again.');}
    finally{setBusy(false);}
  }
  return <form className="rating-form" onSubmit={submit} aria-label={onboarding?'Choose your nickname':'Edit your nickname'} aria-busy={busy}>
    <label>Your nickname<input autoFocus={onboarding} required maxLength={40} autoComplete="nickname" value={nickname} disabled={busy} aria-describedby={`${helpId}${error?` ${errorId}`:''}`} aria-invalid={!!error} onChange={event=>{setNickname(event.target.value);setError('');}}/></label>
    <p id={helpId} className="hint">Use 1–40 characters. This name appears on your ratings and comments. Changing it keeps all your reviews together.</p>
    {error&&<p id={errorId} className="error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy||!value||value.length>40}>{busy?'Saving your nickname…':onboarding?'Continue to TasteBuds':'Save nickname'}</button>
    {busy&&<p className="muted" role="status">Saving your nickname…</p>}
  </form>;
}

export function NicknameOnboarding({user,saved}:{user:User;saved:(user:User)=>void}){
  const [error,setError]=useState('');
  return <main className="nickname-onboarding"><div className="nickname-card">
    <span className="wordmark"><BrandMark/></span>
    <h1>What should we call you?</h1><p className="muted">Pick a name your friends will recognise. You can change it later in Settings.</p>
    <NicknameForm user={user} saved={saved} onboarding/>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="text-button" onClick={()=>void request('/auth/logout','POST',{}).then(()=>window.location.href='/').catch(e=>setError(e.message))}>Sign out</button>
  </div><style jsx>{`
    .nickname-onboarding{min-height:100dvh;display:grid;place-items:center;padding:28px 20px}.nickname-card{width:100%;max-width:460px;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:36px}.wordmark{margin-bottom:30px}.nickname-card h1{font-size:32px;letter-spacing:-1px;margin-bottom:14px}.nickname-card>.muted{font-size:14px;margin-bottom:24px}.nickname-card>.text-button{margin-top:18px}
    @media(max-width:480px){.nickname-card{padding:25px}.nickname-card h1{font-size:29px}}
  `}</style></main>;
}

export function AccountSettings({user,saved,preferencesSaved}:{user:User;saved:(user:User)=>void;preferencesSaved:(user:User)=>void}){
  const canInstall=useCanInstall(),[error,setError]=useState('');
  return <section className="settings settings-region" aria-labelledby="account-settings-title">
    <header className="settings-region-head"><div><h2 id="account-settings-title">Your account</h2><p className="hint">Your name and how you add ratings, in every group.</p></div></header>
    <div className="settings-list">
      <Disclosure title="Nickname" summary={user.nickname}><NicknameForm key={`${user.id}-${user.nickname}`} user={user} saved={saved}/></Disclosure>
      <Disclosure title="Photo suggestions" summary={user.aiEnabled?'On':'Off'}><PhotoPreferences key={`${user.id}-${user.aiEnabled}`} user={user} saved={preferencesSaved}/></Disclosure>
      {canInstall&&<Disclosure title="This device" summary="Not installed"><p className="hint">Open TasteBuds from your home screen or desktop, ready to take photos.</p><InstallApp/></Disclosure>}
    </div>
    <div className="settings-footer"><button className="text-button" onClick={()=>void request('/auth/logout','POST',{}).then(()=>window.location.href='/').catch(e=>setError(e.message))}>Sign out</button>{error&&<p className="error" role="alert">{error}</p>}</div>
  </section>;
}

function PhotoPreferences({user,saved}:{user:User;saved:(user:User)=>void}){
  const [enabled,setEnabled]=useState(user.aiEnabled),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const descriptionId=useId();
  async function change(next:boolean){
    if(busy)return;
    setBusy(true);setError('');setEnabled(next);
    try{saved(await request<User>('/api/me/preferences','PATCH',{aiEnabled:next}));}
    catch(e){setEnabled(!next);setError(e instanceof Error?e.message:'Could not save your photo preference. Try again.');}
    finally{setBusy(false);}
  }
  return <div className="rating-form" aria-busy={busy}>
    <label className="switch-field preference-switch"><input type="checkbox" role="switch" checked={enabled} disabled={busy} aria-describedby={descriptionId} onChange={event=>void change(event.target.checked)}/><span className="switch" aria-hidden="true"/><span><strong>Suggest details from my photos with AI</strong></span></label>
    <p id={descriptionId} className="hint">Off by default. When off, your photos aren’t sent to AI and you enter item details yourself. When on, you can tap “Fill in from photo” to send a photo to Google Gemini. Uploading alone never starts AI. A photo is required either way.</p>
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
