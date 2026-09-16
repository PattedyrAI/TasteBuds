'use client';
import {useState} from 'react';
import {SelectMenu} from './select-menu';
import {categoryChoices,resolveCategoryName} from '../domain/personal-discovery';
export function CategoryPicker({value,onChange,categories,disabled=false}:{value:string;onChange:(value:string)=>void;categories:string[];disabled?:boolean}){
 const [adding,setAdding]=useState(false),[draft,setDraft]=useState('');
 const options=categoryChoices([...categories,value]),current=resolveCategoryName(value,options),proposed=resolveCategoryName(draft,categories);
 const exists=categoryChoices(categories).some(c=>c.toLocaleLowerCase()===proposed.toLocaleLowerCase());
 return <div className="category-picker"><span className="field-label">Category <span className="optional">optional</span></span>
 <SelectMenu label="Category" value={current} onChange={next=>{if(next==='__new_category__'){setAdding(true);setDraft('');}else{onChange(next);setAdding(false);}}} disabled={disabled} searchable options={[{value:'',label:'Choose a category'},...options.map(c=>({value:c,label:c})),{value:'__new_category__',label:'+ Add a new category',alwaysVisible:true}]}/>
 {adding&&<div className="new-category"><label>New category name<input autoFocus value={draft} maxLength={80} disabled={disabled} onChange={e=>setDraft(e.target.value)} placeholder="For example, Smoothies" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(proposed){onChange(proposed);setAdding(false);}}}}/></label>
 <p className="hint">{exists?`Already available as ${proposed}. We’ll use that category.`:'Keep it broad enough for similar items. Put flavours in the item name.'}</p><div className="button-row"><button type="button" className="button secondary" disabled={disabled||!proposed} onClick={()=>{onChange(proposed);setAdding(false);}}>{exists?'Use existing category':'Add category'}</button><button type="button" className="text-button" disabled={disabled} onClick={()=>setAdding(false)}>Cancel</button></div></div>}
 </div>;
}
