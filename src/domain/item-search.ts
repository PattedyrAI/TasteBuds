import type {Item} from '../lib/contracts';
import {browseCategory} from './browse-categories';

const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

/** Every search word can match any item field, including its separate brand. */
export function matchesItemSearch(item:Pick<Item,'name'|'brand'|'variant'|'type'>,query:string):boolean{
  const words=normalize(query).split(/\s+/).filter(Boolean);
  const fields=[item.name,item.brand,item.variant,item.type,browseCategory(item.type)].filter((value):value is string=>Boolean(value)).map(normalize);
  // Common brand spelling such as Redbull also matches the stored "Red Bull".
  if(item.brand)fields.push(normalize(item.brand).replace(/\s+/g,''));
  return words.every(word=>fields.some(field=>field.includes(word)));
}
