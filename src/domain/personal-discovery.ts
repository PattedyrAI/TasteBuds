import type {Item} from '../lib/contracts';
import {browseCategory} from './browse-categories';
export type PersonalFilter='all'|'untried'|'saved';
export const normalizedBrand=(brand:string|null)=>brand?.trim().replace(/\s+/g,' ').toLocaleLowerCase('en')??'';
export function filterPersonalItems(items:Item[],filter:PersonalFilter):Item[]{
 return items.filter(i=>filter==='untried'?i.myScore==null:filter==='saved'?i.saved===true:true);
}
export function brandSummary(items:Item[],brand:string){
 const rows=items.filter(i=>normalizedBrand(i.brand)===normalizedBrand(brand));
 return {items:rows,total:rows.length,tried:rows.filter(i=>i.myScore!=null).length,saved:rows.filter(i=>i.saved).length,
  favourite:[...rows].filter(i=>i.myScore!=null).sort((a,b)=>b.myScore!-a.myScore!||a.name.localeCompare(b.name))[0]??null};
}
export function categoryChoices(types:(string|null)[]):string[]{
 const choices=new Map<string,string>();
 for(const type of types){const name=browseCategory(type);if(name&&!choices.has(name.toLocaleLowerCase()))choices.set(name.toLocaleLowerCase(),name);}
 return [...choices.values()].sort((a,b)=>a.localeCompare(b));
}
export function resolveCategoryName(value:string,existing:string[]):string{
 const name=browseCategory(value.trim().replace(/\s+/g,' '))??'';
 return categoryChoices(existing).find(c=>c.toLocaleLowerCase()===name.toLocaleLowerCase())??name;
}
