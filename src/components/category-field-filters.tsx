'use client';
import type {Category,Item} from '../lib/contracts';
import type {FieldFilters} from '../domain/restaurant-filters';
export function CategoryFieldFilters({category,items,value,onChange}:{category?:Category;items:Item[];value:FieldFilters;onChange:(filters:FieldFilters)=>void}){
  const fields=category?.fields.filter(field=>field.filterable&&field.type!=='location')||[];
  if(!fields.length)return null;
  const update=(id:string,patch:FieldFilters[string])=>onChange({...value,[id]:patch});
  return <div className="category-field-filters"><p className="hint">Filtrer {category?.name}. Ekstrafeltene fra den nyeste vurderingen brukes.</p><div className="field-filter-grid">{fields.map(field=>{
    const selected=value[field.id]||{};
    if(field.type==='number'||field.type==='price')return <fieldset key={field.id}><legend>{field.label}</legend><div className="range-filter"><input type="number" aria-label={`${field.label} fra`} placeholder="Fra" step="any" value={selected.min??''} onChange={event=>update(field.id,{...selected,min:event.target.value===''?undefined:Number(event.target.value)})}/><span>–</span><input type="number" aria-label={`${field.label} til`} placeholder="Til" step="any" value={selected.max??''} onChange={event=>update(field.id,{...selected,max:event.target.value===''?undefined:Number(event.target.value)})}/></div></fieldset>;
    const raw=field.type==='boolean'?['true','false']:[...(field.options||[]),...items.filter(item=>item.type===category?.name).flatMap(item=>{const v=item.customFields?.[field.id];return v===undefined?[]:[String(v)];})];
    const options=[...new Map(raw.map(option=>[option.toLocaleLowerCase(),option])).values()].sort((a,b)=>a.localeCompare(b));
    return <label key={field.id}>{field.label}<select value={selected.value||''} onChange={event=>update(field.id,{value:event.target.value})}><option value="">Alle</option>{options.map(option=><option key={option} value={option}>{field.type==='boolean'?(option==='true'?'Ja':'Nei'):option}</option>)}</select></label>;
  })}</div></div>;
}
