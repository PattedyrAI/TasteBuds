'use client';
import {useState} from 'react';
import {ArrowLeft,Plus,Trash2} from 'lucide-react';
import type {Category,CategoryField} from '../lib/contracts';
import {categoryFieldsSchema} from '../domain/category-template';
import {Modal,request} from './ui';
const fieldTypes:Record<CategoryField['type'],string>={text:'Text',number:'Number',price:'Price',select:'Select list',boolean:'Yes / no',location:'Location (Google Maps)'};
export function CategoryTemplate({groupId,initial,close,created,standalone=false}:{groupId:string;initial?:Category;close:()=>void;created:(category:Category)=>void;standalone?:boolean}){
  const [name,setName]=useState(initial?.name||''),[fields,setFields]=useState<CategoryField[]>(initial?.fields||[]);
  const [options,setOptions]=useState<Record<string,string>>(Object.fromEntries((initial?.fields||[]).map(f=>[f.id,(f.options||[]).join('\n')])));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(id:string,patch:Partial<CategoryField>)=>setFields(current=>current.map(f=>f.id===id?{...f,...patch}:f));
  return <Modal title={initial?`Edit ${initial.name}`:'New category'} close={close}><form className="rating-form category-template" onSubmit={async event=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const complete=fields.map(field=>({...field,options:field.type==='select'?(options[field.id]||'').split('\n').map(v=>v.trim()).filter(Boolean):undefined}));
      const checked=categoryFieldsSchema.safeParse(complete);if(!checked.success)throw new Error(checked.error.issues[0].message);
      created(await request<Category>(`/api/groups/${groupId}/categories${initial?'/'+initial.id:''}`,initial?'PATCH':'POST',{name,fields:checked.data}));
    }catch(error){setError(error instanceof Error?error.message:'The category could not be saved.');setBusy(false);}
  }}>
    <p className="hint">{initial?'Changes apply to new ratings. Earlier ratings keep the fields they were written with.':standalone?'Decide which extra fields ratings in this category should have, and which can be used as filters.':'Your draft is kept. Decide which extra fields ratings in this category should have, and which can be used as filters.'}</p>
    <label>Category name<input autoFocus required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)} placeholder="For example Restaurants"/></label>
    <p className="hint">Photo, score, date and note already exist on every rating.</p>
    <div className="template-fields">{fields.map((field,index)=><fieldset className="template-field" key={field.id} disabled={busy}>
      <legend>Field {index+1}</legend><div className="template-field-heading"><label>Field name<input required maxLength={80} value={field.label} onChange={event=>update(field.id,{label:event.target.value})} placeholder="For example Cuisine, Price or Location"/></label><button type="button" className="icon-button danger" aria-label={`Remove field ${index+1}`} onClick={()=>setFields(current=>current.filter(f=>f.id!==field.id))}><Trash2 size={18}/></button></div>
      <label>Field type<select value={field.type} onChange={event=>update(field.id,{type:event.target.value as CategoryField['type'],filterable:event.target.value==='location'?false:field.filterable})}>{Object.entries(fieldTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {field.type==='select'&&<label>Options – one per line<textarea required rows={4} value={options[field.id]||''} onChange={event=>setOptions(current=>({...current,[field.id]:event.target.value}))} placeholder={'Italian\nIndian\nJapanese'}/></label>}
      <label className="checkbox"><input type="checkbox" checked={field.required} onChange={event=>update(field.id,{required:event.target.checked})}/>Required when the rating is published</label>
      {field.type!=='location'&&<label className="checkbox"><input type="checkbox" checked={field.filterable} onChange={event=>update(field.id,{filterable:event.target.checked})}/>Use as a filter in the category and on the map</label>}
      {field.type==='location'&&<p className="hint">Enables Google search on the rating and gives the category its own map view.</p>}
    </fieldset>)}</div>
    <button type="button" className="button secondary" disabled={busy||fields.length>=20} onClick={()=>setFields(current=>[...current,{id:crypto.randomUUID(),label:'',type:'text',required:false,filterable:false}])}><Plus size={17}/>Add field</button>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Saving…':initial?'Save fields':standalone?'Create category':'Create and continue the rating'}</button>
    <button type="button" className="text-button" disabled={busy} onClick={close}><ArrowLeft size={16}/>{initial||standalone?'Cancel':'Back to the draft'}</button>
  </form></Modal>;
}
