'use client';
import {useState} from 'react';
import type {Category,DiscordConnection,DiscordRoute,GroupDetail} from '../lib/contracts';
import {request} from './ui';

const labels:Record<DiscordRoute,string>={all:'All reviews (existing connection)',energy_drinks:'Energy-drink reviews',food:'Food reviews'};

function ConnectionForm({groupId,route,connection,categories,changed}:{groupId:string;route:DiscordRoute;connection?:DiscordConnection;categories:Category[];changed:()=>void}){
  const [url,setUrl]=useState(''),[enabled,setEnabled]=useState(connection?.enabled??false);
  const [selected,setSelected]=useState(connection?.categoryIds??[]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setSaved(false);
    try{
      await request(`/api/groups/${groupId}/discord`,'POST',{route,categoryIds:selected,enabled,url:url||undefined});
      setUrl('');setSaved(true);changed();
    }catch(error){setError(error instanceof Error?error.message:'Could not save the connection.');}
    finally{setBusy(false);}
  }
  return <form className="settings-section" onSubmit={save}>
    <h3>{labels[route]}</h3>
    <p>{connection?(connection.enabled?'Connected and sharing new reviews.':'Connection saved. Sharing is off.'):'No channel connected.'}</p>
    {route==='all'?<p>This existing connection includes every category. Turn it off before enabling separate channels.</p>:<>
      <p>Choose every category that belongs in this channel. New or unselected categories are not shared.</p>
      <details><summary>Choose categories ({selected.length} selected)</summary>
        {categories.map(category=><label className="checkbox" key={category.id}>
          <input type="checkbox" checked={selected.includes(category.id)} disabled={busy} onChange={event=>setSelected(event.target.checked?[...selected,category.id]:selected.filter(id=>id!==category.id))}/>{category.name}
        </label>)}
        {!categories.length&&<p>Create categories before connecting this channel.</p>}
      </details>
    </>}
    <label className="checkbox"><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>Share new {route==='all'?'reviews':labels[route].toLowerCase()} in Discord</label>
    <label>Discord channel webhook URL<input type="password" autoComplete="off" value={url} disabled={busy} onChange={event=>setUrl(event.target.value)} placeholder={connection?'Saved — enter a URL to replace':'https://discord.com/api/webhooks/…'}/></label>
    {error&&<p className="error" role="alert">{error}</p>}
    {saved&&<p className="success" role="status">Discord connection saved.</p>}
    <button className="button primary" disabled={busy}>{busy?'Saving…':'Save '+labels[route].toLowerCase()}</button>
  </form>;
}

export function DiscordSettings({group,changed}:{group:GroupDetail;changed:()=>void}){
  const connections=group.discordConnections??[];
  const routes:DiscordRoute[]=connections.some(connection=>connection.route==='all')?['all','energy_drinks','food']:['energy_drinks','food'];
  return <div><div className="settings-section"><h2>Bring the conversation to Discord</h2>
    <p>Send new reviews to separate channels. Existing reviews won’t be posted.</p>
    <small className="muted">In Discord, open each channel’s Settings → Integrations → Webhooks. Paste its URL into the matching connection below. URLs are stored encrypted and are never shown again.</small>
  </div>{routes.map(route=>{
    const connection=connections.find(connection=>connection.route===route);
    return <ConnectionForm key={group.id+route+JSON.stringify(connection)} groupId={group.id} route={route} connection={connection} categories={group.categories??[]} changed={changed}/>;
  })}</div>;
}
