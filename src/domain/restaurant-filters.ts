import type {Item,RestaurantPin} from '../lib/contracts';
export type FieldFilters=Record<string,{value?:string;min?:number;max?:number}>;
export interface RestaurantFilters {search?:string;category?:string;minimumScore?:number;fields?:FieldFilters}
const normal=(value:string)=>value.trim().toLocaleLowerCase();
export function matchesFieldFilters(item:Item,filters:FieldFilters){
  return Object.entries(filters).every(([id,filter])=>{
    const value=item.customFields?.[id];
    if(filter.value!==undefined&&filter.value!==''&&normal(String(value??''))!==normal(filter.value))return false;
    if(filter.min!==undefined&&(typeof value!=='number'||value<filter.min))return false;
    if(filter.max!==undefined&&(typeof value!=='number'||value>filter.max))return false;
    return true;
  });
}
export function filterRestaurantPins(pins:RestaurantPin[],filters:RestaurantFilters){
  const words=normal(filters.search||'').split(/\s+/).filter(Boolean);
  return pins.filter(({item})=>(!filters.category||item.type===filters.category)
    &&(!filters.minimumScore||(item.average!==null&&item.average>=filters.minimumScore))
    &&matchesFieldFilters(item,filters.fields||{})
    &&words.every(word=>normal([item.name,item.brand,item.type,...Object.values(item.customFields||{})].filter(Boolean).join(' ')).includes(word)));
}
