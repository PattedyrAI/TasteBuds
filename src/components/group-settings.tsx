'use client';
import {canManageGroup} from '../domain/group-roles';
import {CategoryTemplate} from './category-template';
import {useState} from 'react';
import {Plus} from 'lucide-react';
import type {Category,CategoryField,GroupDetail,User} from '@/lib/contracts';
import {Avatar,request} from './ui';
import {DiscordSettings,discordSummary} from './discord-settings';
import {Disclosure} from './disclosure';
import {InviteButton} from './invite-dialog';

const fieldTypes:Record<CategoryField['type'],string>={text:'Text',number:'Number',price:'Price',select:'Choice',boolean:'Yes / no',location:'Location'};
const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;

function CategoryRow({category,edit}:{category:Category;edit:()=>void}){
  const filters=category.fields.filter(field=>field.filterable).length;
  return <Disclosure nested title={category.name} summary={category.fields.length?`${plural(category.fields.length,'field','fields')}${filters?`, ${plural(filters,'filter','filters')}`:''}`:'Basics only'}>
    {category.fields.length?<ul className="field-list">{category.fields.map(field=><li key={field.id}><span>{field.label}</span><span className="field-meta">{fieldTypes[field.type]}{field.required&&<span className="tag">Required</span>}{field.filterable&&<span className="tag">Filter</span>}</span></li>)}</ul>
    :<p className="hint">Ratings here only ask for the basics: photo, score, date and note.</p>}
    <button type="button" className="button secondary" onClick={edit}>Edit fields</button>
  </Disclosure>;
}

export function GroupSettings({group,user,changed}:{group:GroupDetail;user:User;changed:()=>void}){
  const [name,setName]=useState(group.name),[error,setError]=useState(''),[success,setSuccess]=useState(''),[busy,setBusy]=useState(false),[confirming,setConfirming]=useState<string|null>(null);
  const [editingCategory,setEditingCategory]=useState<Category|'new'|null>(null);
  const owner=canManageGroup(group.role),categories=group.categories||[];
  async function run(fn:()=>Promise<unknown>,message:string){setBusy(true);setError('');setSuccess('');try{await fn();setSuccess(message);changed();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);setConfirming(null);}}
  const confirmText=confirming==='leave'?'Leave this group? Your ratings stay, but you’ll need a new invite to come back.':confirming?.startsWith('owner:')?(group.role==='admin'?'Make them the owner? Your platform admin access stays.':'Make them the owner? You’ll become a regular member.'):'Remove their access to this group? Their ratings stay.';
  const confirmAction=()=>confirming==='leave'?request(`/api/groups/${group.id}`,'PATCH',{leave:true}):confirming!.startsWith('owner:')?request(`/api/groups/${group.id}`,'PATCH',{ownerId:confirming!.slice(6)}):request(`/api/groups/${group.id}/members/${confirming}`,'DELETE');
  const confirmBox=(id:string)=>confirming===id&&<div className="inline-confirm"><p>{confirmText}</p><button disabled={busy} onClick={()=>void run(confirmAction,id==='leave'?'You left the group.':'Membership updated.')}>{id==='leave'?'Leave group':id.startsWith('owner:')?'Make owner':'Remove'}</button><button disabled={busy} onClick={()=>setConfirming(null)}>Cancel</button></div>;
  return <section className="settings settings-region" aria-labelledby="group-settings-title">
    <header className="settings-region-head"><div><h2 id="group-settings-title">{group.name}</h2><p className="hint">{owner?'Group settings apply to everyone in the group.':'You’re a member of this group.'}</p></div><InviteButton group={group} changed={changed}/></header>
    {error&&<p className="error" role="alert">{error}</p>}{success&&<p className="success" role="status">{success}</p>}
    <div className="settings-list">
      <Disclosure title="Members" summary={<><span className="avatar-stack" aria-hidden="true">{group.members.slice(0,4).map(m=><Avatar key={m.id} name={m.displayName} url={m.avatarUrl}/>)}</span>{plural(group.members.length,'person','people')}</>}>
        {group.members.map(m=><div key={m.id}><div className="member"><Avatar name={m.displayName} url={m.avatarUrl}/><div><strong>{m.displayName}{m.id===user.id?' (you)':''}</strong><small>{m.role==='admin'?'Platform admin':m.role==='owner'?'Owner':'Member'}</small></div>
          {owner&&m.id!==user.id&&<div className="member-actions"><button className="text-button" disabled={busy} onClick={()=>setConfirming(`owner:${m.id}`)}>Make owner</button>{m.id!==group.ownerId&&m.role!=='admin'&&<button className="text-button danger" disabled={busy} onClick={()=>setConfirming(m.id)}>Remove</button>}</div>}</div>
          {confirmBox(m.id)}{confirmBox(`owner:${m.id}`)}</div>)}
        {owner&&<InviteButton group={group} changed={changed} className="button secondary invite-inline"/>}
      </Disclosure>
      {owner&&<Disclosure title="Discord" summary={discordSummary(group)}><DiscordSettings group={group} changed={changed}/></Disclosure>}
      {owner&&<Disclosure title="Categories" summary={categories.length?plural(categories.length,'category','categories'):'None yet'}>
        <p className="hint">A category decides which extra fields a rating asks for, and which of them members can filter by.</p>
        {categories.length>0&&<div className="settings-list nested">{categories.map(category=><CategoryRow key={category.id} category={category} edit={()=>setEditingCategory(category)}/>)}</div>}
        <button type="button" className="button secondary" onClick={()=>setEditingCategory('new')}><Plus size={17}/>New category</button>
      </Disclosure>}
      {owner&&<Disclosure title="Group name" summary={group.name}>
        <form className="inline-form" onSubmit={e=>{e.preventDefault();void run(()=>request(`/api/groups/${group.id}`,'PATCH',{name}),'Group name saved.');}}><label>Group name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button className="button primary" disabled={busy||!name.trim()||name.trim()===group.name}>Save name</button></form>
      </Disclosure>}
    </div>
    {!owner&&<div className="settings-footer">{confirming==='leave'?confirmBox('leave'):<button className="text-button danger" disabled={busy} onClick={()=>setConfirming('leave')}>Leave group</button>}</div>}
    {editingCategory&&<CategoryTemplate groupId={group.id} initial={editingCategory==='new'?undefined:editingCategory} standalone close={()=>setEditingCategory(null)} created={()=>{setEditingCategory(null);changed();}}/>}
  </section>;
}
