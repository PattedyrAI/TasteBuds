import {canonicalItemType} from './item-types';

type LookupItem={id:string;name:string;brand:string|null;variant:string|null;type:string|null;tastingCount?:number};

export const SUGARFREE_VARIANT='Sugarfree';
const LIMIT=6;
const words=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// "Redbull" and "Red Bull" are the same brand for lookup purposes.
const key=(value:string|null|undefined)=>words(value||'').replace(/\s+/g,'');

export function isEnergyDrinkCategory(type:string|null|undefined):boolean{
  return !!type?.trim()&&canonicalItemType(type)==='Energy drinks';
}

/** Sugar-free labels in stored or AI-suggested variants all map onto the single toggle. */
export function isSugarfree(variant:string|null|undefined):boolean{
  return /\b(sugar ?free|zero( sugar)?|no sugar|sukkerfri|sockerfri)\b/.test(words(variant||''));
}

/** Brands already used for energy drinks in the group, most-tried first, filtered by what has been typed. */
export function energyDrinkBrands(items:LookupItem[],query:string):string[]{
  const counts=new Map<string,{name:string;count:number}>();
  for(const item of items){
    if(!item.brand?.trim()||!isEnergyDrinkCategory(item.type))continue;
    const k=key(item.brand),entry=counts.get(k)??{name:item.brand.trim(),count:0};
    entry.count+=item.tastingCount??1;counts.set(k,entry);
  }
  const wanted=key(query);
  // An exact brand is already chosen; the next lookup is its models.
  if(wanted&&counts.has(wanted))return [];
  return [...counts.entries()].filter(([k])=>k.includes(wanted)).map(([,v])=>v)
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,LIMIT).map(v=>v.name);
}

/** Existing energy drinks from one brand, narrowed by every typed model/flavour word. */
export function energyDrinkModels<T extends LookupItem>(items:T[],brand:string,query:string):T[]{
  const wanted=key(brand);
  if(!wanted)return [];
  const typed=words(query).split(' ').filter(Boolean);
  return items.filter(item=>{
    if(!isEnergyDrinkCategory(item.type))return false;
    // Older items may carry the brand only inside their name.
    const sameBrand=item.brand?key(item.brand)===wanted:key(item.name).startsWith(wanted);
    const text=words(`${item.name} ${item.variant||''}`);
    return sameBrand&&typed.every(word=>text.includes(word));
  }).sort((a,b)=>(b.tastingCount??0)-(a.tastingCount??0)||a.name.localeCompare(b.name)).slice(0,LIMIT);
}

/** A flavour suggested as a variant belongs in the model name once Variant means only sugar-free. */
export function energyDrinkSuggestion(name:string,variant:string|null|undefined):{name:string;sugarfree:boolean}{
  const sugarfree=isSugarfree(variant),flavour=variant?.trim();
  if(!flavour||sugarfree||words(name).includes(words(flavour)))return {name,sugarfree};
  return {name:`${name} ${flavour}`.trim(),sugarfree};
}
