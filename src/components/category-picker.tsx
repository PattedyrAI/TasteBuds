'use client';
import {SelectMenu} from './select-menu';
export function CategoryPicker({value,onChange,categories,disabled=false,onCreate,canCreate=false}:{value:string;onChange:(value:string)=>void;categories:string[];disabled?:boolean;onCreate?:()=>void;canCreate?:boolean}){
 const options=[...new Map([...categories,value].filter(Boolean).map(name=>[name.toLocaleLowerCase(),name])).values()].sort((a,b)=>a.localeCompare(b));
 const current=options.find(name=>name.toLocaleLowerCase()===value.toLocaleLowerCase())||value;
 return <div className="category-picker"><span className="field-label">Category <span className="optional">optional</span></span>
 <SelectMenu label="Category" value={current} onChange={next=>{if(next==='__new_category__')onCreate?.();else onChange(next);}} disabled={disabled} searchable options={[{value:'',label:'Choose a category'},...options.map(name=>({value:name,label:name})),...(canCreate&&onCreate?[{value:'__new_category__',label:'+ Lag kategori',alwaysVisible:true}]:[])]}/>
 </div>;
}
