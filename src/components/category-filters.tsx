'use client';
import type {Item} from '@/lib/contracts';
import {rankCategories} from './catalog-presentation';
import {sections,sectionFor,type Section} from '../domain/category-taxonomy';

/** Two levels, always in the same place: Food / Drinks / Other, then that section's categories by popularity. */
export function CategoryFilters({items,section,onSection,value,onChange}:{items:Item[];section:Section|'';onSection:(value:Section|'')=>void;value:string|null;onChange:(value:string|null)=>void}){
 const counts=new Map(sections.map(s=>[s,items.filter(i=>sectionFor(i.type,i.broadCategory)===s).length]));
 const inSection=section?items.filter(i=>sectionFor(i.type,i.broadCategory)===section):items;
 const categories=rankCategories(inSection);
 return <div className="category-filters">
  <div className="segmented-control" role="group" aria-label="Section">
   <button type="button" aria-pressed={section===''} className={section===''?'selected':''} onClick={()=>{onSection('');onChange('');}}>All</button>
   {sections.filter(s=>counts.get(s)).map(s=><button type="button" key={s} aria-pressed={section===s} className={section===s?'selected':''} onClick={()=>{onSection(s);onChange('');}}>{s}</button>)}
  </div>
  {categories.length>0&&<div className="chip-row scroll" role="group" aria-label="Category">
   <button type="button" aria-pressed={value===''} className={`chip${value===''?' selected':''}`} onClick={()=>onChange('')}>All {section?section.toLowerCase():'categories'} <span className="chip-count">{inSection.length}</span></button>
   {categories.map(c=><button type="button" key={c.type??'unsorted'} aria-pressed={value===c.type} className={`chip${value===c.type?' selected':''}`} onClick={()=>onChange(value===c.type?'':c.type)}>{c.type??'Unsorted'} <span className="chip-count">{c.items.length}</span></button>)}
  </div>}
 </div>;
}
