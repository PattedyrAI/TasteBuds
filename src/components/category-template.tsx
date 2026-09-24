'use client';
import {useState} from 'react';
import {ArrowLeft,Plus,Trash2} from 'lucide-react';
import type {Category,CategoryField} from '../lib/contracts';
import {categoryFieldsSchema} from '../domain/category-template';
import {Modal,request} from './ui';
const fieldTypes:Record<CategoryField['type'],string>={text:'Tekst',number:'Tall',price:'Pris',select:'Valgliste',boolean:'Ja / nei',location:'Lokasjon (Google Maps)'};
export function CategoryTemplate({groupId,initial,close,created}:{groupId:string;initial?:Category;close:()=>void;created:(category:Category)=>void}){
  const [name,setName]=useState(initial?.name||''),[fields,setFields]=useState<CategoryField[]>(initial?.fields||[]);
  const [options,setOptions]=useState<Record<string,string>>(Object.fromEntries((initial?.fields||[]).map(f=>[f.id,(f.options||[]).join('\n')])));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(id:string,patch:Partial<CategoryField>)=>setFields(current=>current.map(f=>f.id===id?{...f,...patch}:f));
  return <Modal title={initial?'Rediger kategorimal':'Lag kategori'} close={close}><form className="rating-form category-template" onSubmit={async event=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const complete=fields.map(field=>({...field,options:field.type==='select'?(options[field.id]||'').split('\n').map(v=>v.trim()).filter(Boolean):undefined}));
      const checked=categoryFieldsSchema.safeParse(complete);if(!checked.success)throw new Error(checked.error.issues[0].message);
      created(await request<Category>(`/api/groups/${groupId}/categories${initial?'/'+initial.id:''}`,initial?'PATCH':'POST',{name,fields:checked.data}));
    }catch(error){setError(error instanceof Error?error.message:'Kategorien kunne ikke lagres.');setBusy(false);}
  }}>
    <p className="hint">{initial?'Endringer gjelder nye vurderinger. Tidligere vurderinger beholder feltene de ble skrevet med.':'Utkastet ditt beholdes. Bestem hvilke ekstra felt vurderinger i denne kategorien skal ha, og hvilke som kan brukes som filtre.'}</p>
    <label>Kategorinavn<input autoFocus required maxLength={80} value={name} disabled={busy} onChange={event=>setName(event.target.value)} placeholder="For eksempel Restauranter"/></label>
    <p className="hint">Bilde, poengsum, dato og notat finnes allerede i alle vurderinger.</p>
    <div className="template-fields">{fields.map((field,index)=><fieldset className="template-field" key={field.id} disabled={busy}>
      <legend>Felt {index+1}</legend><div className="template-field-heading"><label>Feltnavn<input required maxLength={80} value={field.label} onChange={event=>update(field.id,{label:event.target.value})} placeholder="For eksempel Cuisine, Pris eller Lokasjon"/></label><button type="button" className="icon-button danger" aria-label={`Fjern felt ${index+1}`} onClick={()=>setFields(current=>current.filter(f=>f.id!==field.id))}><Trash2 size={18}/></button></div>
      <label>Felttype<select value={field.type} onChange={event=>update(field.id,{type:event.target.value as CategoryField['type'],filterable:event.target.value==='location'?false:field.filterable})}>{Object.entries(fieldTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {field.type==='select'&&<label>Valgalternativer – ett per linje<textarea required rows={4} value={options[field.id]||''} onChange={event=>setOptions(current=>({...current,[field.id]:event.target.value}))} placeholder={'Italiensk\nIndisk\nJapansk'}/></label>}
      <label className="checkbox"><input type="checkbox" checked={field.required} onChange={event=>update(field.id,{required:event.target.checked})}/>Obligatorisk når vurderingen publiseres</label>
      {field.type!=='location'&&<label className="checkbox"><input type="checkbox" checked={field.filterable} onChange={event=>update(field.id,{filterable:event.target.checked})}/>Bruk som filter i kategorien og på kartet</label>}
      {field.type==='location'&&<p className="hint">Aktiverer Google-søk i vurderingen og gir kategorien et eget kartvalg.</p>}
    </fieldset>)}</div>
    <button type="button" className="button secondary" disabled={busy||fields.length>=20} onClick={()=>setFields(current=>[...current,{id:crypto.randomUUID(),label:'',type:'text',required:false,filterable:false}])}><Plus size={17}/>Legg til felt</button>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Lagrer…':initial?'Lagre kategorimal':'Opprett og fortsett vurderingen'}</button>
    <button type="button" className="text-button" disabled={busy} onClick={close}><ArrowLeft size={16}/>{initial?'Avbryt':'Tilbake til utkastet'}</button>
  </form></Modal>;
}
