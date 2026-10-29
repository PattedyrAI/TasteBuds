'use client';
import {useState} from 'react';
import type {Category,DiscordConnection,DiscordRoute,GroupDetail} from '../lib/contracts';
import {Disclosure} from './disclosure';
import {request} from './ui';

const channels:Record<DiscordRoute,{title:string;what:string}>={
  all:{title:'All reviews',what:'Your first channel. It gets every review, so turn it off before you use the channels below.'},
  food:{title:'Food',what:'Reviews marked as food are posted here automatically.'},
  energy_drinks:{title:'Energy drinks',what:'Reviews in the categories you pick are posted here.'},
  other:{title:'Everything else',what:'Reviews that aren’t food or energy drinks are posted here.'},
};
type Status='sharing'|'paused'|'off';
const statusLabels:Record<Status,string>={sharing:'Sharing',paused:'Paused',off:'Not connected'};
function StatusLabel({status}:{status:Status}){return <span className={`status status-${status}`}>{statusLabels[status]}</span>;}
const looksLikeWebhook=(value:string)=>/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\//.test(value.trim());

function WebhookField({label,busy,connect,cancel}:{label:string;busy:boolean;connect:(url:string)=>void;cancel?:()=>void}){
  const [url,setUrl]=useState('');
  const invalid=url.trim()!==''&&!looksLikeWebhook(url);
  return <form className="webhook-field" onSubmit={event=>{event.preventDefault();if(!invalid&&url.trim())connect(url.trim());}}>
    <label>Webhook link<input type="text" inputMode="url" autoComplete="off" spellCheck={false} value={url} disabled={busy} aria-invalid={invalid} onChange={event=>setUrl(event.target.value)} placeholder="https://discord.com/api/webhooks/…"/></label>
    {invalid&&<p className="error" role="alert">That isn’t a Discord webhook link. It starts with https://discord.com/api/webhooks/.</p>}
    <div className="button-row"><button className="button primary" disabled={busy||!url.trim()||invalid}>{busy?'Connecting…':label}</button>{cancel&&<button type="button" className="text-button" disabled={busy} onClick={cancel}>Cancel</button>}</div>
  </form>;
}

function Channel({groupId,route,connection,categories,changed}:{groupId:string;route:DiscordRoute;connection?:DiscordConnection;categories:Category[];changed:()=>void}){
  const picks=route==='energy_drinks',saved=connection?.categoryIds??[];
  const [enabled,setEnabled]=useState(connection?.enabled??false),[selected,setSelected]=useState(saved);
  const [linked,setLinked]=useState(!!connection),[replacing,setReplacing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const differs=(a:string[],b:string[])=>a.length!==b.length||a.some(id=>!b.includes(id));
  // Rows keep their state across refreshes; adopt newer server state (e.g. another owner's change) unless a save is in flight or categories are being edited.
  const snapshot=JSON.stringify(connection??null),[seen,setSeen]=useState(snapshot);
  if(snapshot!==seen&&!busy){const before=(JSON.parse(seen) as DiscordConnection|null)?.categoryIds??[];setSeen(snapshot);setLinked(!!connection);setEnabled(connection?.enabled??false);if(!differs(selected,before))setSelected(saved);}
  const categoriesChanged=picks&&differs(selected,saved);
  async function send(next:{enabled:boolean;url?:string},message:string){
    const previous=enabled;
    setBusy(true);setError('');setDone('');setEnabled(next.enabled);
    try{await request(`/api/groups/${groupId}/discord`,'POST',{route,enabled:next.enabled,url:next.url,categoryIds:picks?selected:saved});setEnabled(next.enabled);if(next.url)setLinked(true);setReplacing(false);setDone(message);changed();}
    catch(e){setEnabled(previous);setError(e instanceof Error?e.message:'Could not save this channel.');}
    finally{setBusy(false);}
  }
  const needsCategories=picks&&!selected.length;
  return <Disclosure nested title={picks&&selected.length?<>{channels[route].title}<small>{selected.length} {selected.length===1?'category':'categories'}</small></>:channels[route].title} summary={<StatusLabel status={linked?(enabled?'sharing':'paused'):'off'}/>}>
    <p className="hint">{channels[route].what}</p>
    {picks&&<fieldset className="chip-field" disabled={busy}><legend>Categories for this channel</legend>
      {categories.length?<div className="chip-row">{categories.map(category=>{const on=selected.includes(category.id);return <button type="button" key={category.id} className={on?'chip selected':'chip'} aria-pressed={on} onClick={()=>{setDone('');setSelected(on?selected.filter(id=>id!==category.id):[...selected,category.id]);}}>{category.name}</button>;})}</div>
      :<p className="hint">Add a category first, then pick it here.</p>}
      {categoriesChanged&&linked&&<button type="button" className="button primary" disabled={busy||(enabled&&needsCategories)} onClick={()=>void send({enabled},'Categories saved.')}>Save categories</button>}
    </fieldset>}
    {linked?<>
      <label className="switch-field"><input type="checkbox" role="switch" checked={enabled} disabled={busy||(!enabled&&needsCategories)} onChange={event=>void send({enabled:event.target.checked},event.target.checked?'Sharing new reviews again.':'Paused. New reviews won’t be posted here.')}/><span className="switch" aria-hidden="true"/><span><strong>Post new reviews here</strong><small>{!enabled&&needsCategories?'Pick a category first.':'Existing reviews are never posted.'}</small></span></label>
      {replacing?<WebhookField label="Save new link" busy={busy} connect={url=>void send({enabled,url},'Webhook link replaced.')} cancel={()=>setReplacing(false)}/>
      :<button type="button" className="text-button" onClick={()=>{setDone('');setReplacing(true);}}>Replace webhook link</button>}
    </>:route!=='all'&&<>{needsCategories?<p className="hint">Pick at least one category, then paste the webhook link.</p>:null}<WebhookField label="Connect channel" busy={busy||needsCategories} connect={url=>void send({enabled:true,url},'Connected. New reviews will be posted here.')}/></>}
    {error&&<p className="error" role="alert">{error}</p>}{done&&<p className="success" role="status">{done}</p>}
  </Disclosure>;
}

export function discordSummary(group:GroupDetail){
  const connections=group.discordConnections??[],sharing=connections.filter(connection=>connection.enabled).length;
  return !connections.length?'Not connected':`${sharing} of ${connections.length} ${connections.length===1?'channel':'channels'} sharing`;
}

export function DiscordSettings({group,changed}:{group:GroupDetail;changed:()=>void}){
  const connections=group.discordConnections??[];
  const routes:DiscordRoute[]=[...(connections.some(connection=>connection.route==='all')?['all' as const]:[]),'food','energy_drinks','other'];
  return <>
    <p className="hint">Post new reviews to your Discord server with the photo, score, note and a link back to TasteBuds. Each kind of review can go to its own channel.</p>
    <Disclosure nested title="How to get a webhook link">
      <ol className="steps">
        <li>In Discord, open the channel’s settings with the cog next to its name. You need the Manage Webhooks permission.</li>
        <li>Go to <strong>Integrations → Webhooks → New Webhook</strong>, then choose <strong>Copy Webhook URL</strong>.</li>
        <li>Open the matching channel below, paste the link and choose <strong>Connect channel</strong>.</li>
      </ol>
      <p className="hint">Links are stored encrypted and never shown again. To change one, replace it.</p>
    </Disclosure>
    <div className="settings-list nested">{routes.map(route=><Channel key={route} groupId={group.id} route={route} connection={connections.find(connection=>connection.route===route)} categories={group.categories??[]} changed={changed}/>)}</div>
  </>;
}
