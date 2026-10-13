import {browseCategory} from './browse-categories';
import {broadReviewKind,kindForType} from './review-categories';
import {canonicalItemType} from './item-types';

/** The two browsing levels people see: a section (Food, Drinks, Other) and a category inside it. */
export type Section='Food'|'Drinks'|'Other';
export const sections:readonly Section[]=['Food','Drinks','Other'];
const sectionForKind={Food:'Food',Drink:'Drinks',Other:'Other'} as const;
export function sectionFor(type:string|null|undefined,broadCategory?:string|null):Section|null{
  const kind=kindForType(type)??kindForType(browseCategory(type??null))??broadReviewKind(broadCategory);
  return kind?sectionForKind[kind]:null;
}
export function sectionKind(section:Section){return section==='Drinks'?'Drink':section;}
/** Distinct stored labels that read the same ("Cocktail", "cocktails ") collapse to one choice. */
export function distinctTypes(types:readonly (string|null|undefined)[]):string[]{
  const seen=new Map<string,string>();
  for(const raw of types){
    if(!raw?.trim())continue;
    const label=canonicalItemType(raw),key=label.toLocaleLowerCase('en');
    if(!seen.has(key))seen.set(key,label);
  }
  return [...seen.values()];
}
