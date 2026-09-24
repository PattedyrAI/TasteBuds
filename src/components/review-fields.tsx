'use client';
import type {Dispatch,SetStateAction} from 'react';
import type {CategoryField,CustomFields} from '../lib/contracts';
import {LocationPicker} from './location-picker';
export function ReviewFields({fields,values,onChange,groupId,disabled=false,lockedPlaceId,editing=false}:{fields:CategoryField[];values:CustomFields;onChange:Dispatch<SetStateAction<CustomFields>>;groupId:string;disabled?:boolean;lockedPlaceId?:string|null;editing?:boolean}){
  const set=(id:string,value:string|number|boolean|undefined)=>onChange(current=>{const next={...current};if(value===undefined||value==='')delete next[id];else next[id]=value;return next;});
  return <div className="review-extra-fields">{fields.map(field=>{
    const value=values[field.id];
    if(field.type==='location')return <div key={field.id}><span className="field-label">{field.label}{field.required?' *':''}</span>{lockedPlaceId||editing?<p className="hint">{lockedPlaceId||value?'Stedet er knyttet til denne oppføringen. Nye vurderinger vises på samme sted.':'Denne vurderingen har ikke et lagret sted.'}</p>:<LocationPicker required={field.required} groupId={groupId} value={typeof value==='string'?value:''} onChange={value=>set(field.id,value)} disabled={disabled}/>}</div>;
    return <label key={field.id}>{field.label} {field.required?<span aria-label="obligatorisk">*</span>:<span className="optional">valgfritt</span>}
      {field.type==='select'?<select required={field.required} disabled={disabled} value={typeof value==='string'?value:''} onChange={event=>set(field.id,event.target.value)}><option value="">Velg…</option>{field.options?.map(option=><option key={option} value={option}>{option}</option>)}</select>
      :field.type==='boolean'?<select required={field.required} disabled={disabled} value={typeof value==='boolean'?String(value):''} onChange={event=>set(field.id,event.target.value===''?undefined:event.target.value==='true')}><option value="">Velg…</option><option value="true">Ja</option><option value="false">Nei</option></select>
      :<input required={field.required} disabled={disabled} type={field.type==='text'?'text':'number'} maxLength={field.type==='text'?1000:undefined} min={field.type==='price'?0:undefined} step={field.type==='price'?'0.01':'any'} value={typeof value==='number'||typeof value==='string'?value:''} onChange={event=>set(field.id,field.type==='text'?event.target.value:event.target.value===''?undefined:Number(event.target.value))}/>}
    </label>;
  })}</div>;
}
export function ReviewFieldValues({fields,values}:{fields:CategoryField[];values:CustomFields}){
  return <dl className="review-field-values">{fields.filter(field=>field.type!=='location'&&values[field.id]!==undefined).map(field=><div key={field.id}><dt>{field.label}</dt><dd>{typeof values[field.id]==='boolean'?(values[field.id]?'Ja':'Nei'):String(values[field.id])}</dd></div>)}</dl>;
}
