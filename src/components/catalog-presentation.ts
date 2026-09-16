import type {Item} from '@/lib/contracts';
import {browseCategory} from '../domain/browse-categories';
export type CategorySummary={type:string|null;items:Item[];tastingCount:number};
export function rankCategories(items:Item[]):CategorySummary[]{
  const groups=new Map<string|null,CategorySummary>();
  for(const item of items){const type=browseCategory(item.type);let category=groups.get(type);if(!category){category={type,items:[],tastingCount:0};groups.set(type,category);}category.items.push(item);category.tastingCount+=item.tastingCount;}
  return [...groups.values()].sort((a,b)=>b.tastingCount-a.tastingCount||(a.type??'Unsorted').localeCompare(b.type??'Unsorted')||(a.type===null?-1:b.type===null?1:0));
}
export function visibleCategories(categories:CategorySummary[],expanded:boolean,selected:string|null=''):CategorySummary[]{
  if(expanded)return categories;
  const visible=categories.slice(0,5),active=categories.find(c=>c.type===selected);
  return active&&!visible.includes(active)?[...visible,active]:visible;
}
export function groupFavourites(items:Item[]):Item[]{
  return items.filter(i=>i.raterCount>=3&&i.average!==null).sort((a,b)=>b.average!-a.average!||a.name.localeCompare(b.name)).slice(0,10);
}
export const FEATURED_BRAND_MIN_ITEMS=3;
export const brandKey=(brand:string|null)=>brand?.trim().replace(/\s+/g,' ').toLocaleLowerCase('en')??'';
/** Count distinct rated products, not repeat tastings of the same product. */
export function featuredBrands(items:Item[]):{key:string;name:string;itemCount:number}[]{
  const brands=new Map<string,{name:string;ids:Set<string>}>();
  for(const item of items){
    const key=brandKey(item.brand);
    if(!key||item.tastingCount<1||item.average===null)continue;
    let entry=brands.get(key);
    if(!entry){entry={name:item.brand!.trim().replace(/\s+/g,' '),ids:new Set()};brands.set(key,entry);}
    entry.ids.add(item.id);
  }
  return [...brands].filter(([,entry])=>entry.ids.size>=FEATURED_BRAND_MIN_ITEMS)
    .map(([key,entry])=>({key,name:entry.name,itemCount:entry.ids.size}))
    .sort((a,b)=>b.itemCount-a.itemCount||a.name.localeCompare(b.name));
}
/** Provider profile data is display data, so only load Discord's avatar image paths. */
export function discordAvatarUrl(value:string|null):string|null{
  if(!value)return null;
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))return null;
    return /^\/(?:avatars\/\d+\/[a-zA-Z0-9_]+\.(?:png|webp|gif|jpe?g)|embed\/avatars\/\d+\.png)$/.test(url.pathname)?url.href:null;
  }catch{return null;}
}
