'use client';
import {useId,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {rankCategories,visibleCategories,type CategorySummary} from './catalog-presentation';
import {categoryStyle} from './category-style';
export function CategoryFilters({items,value,onChange}:{items:Item[];value:string|null;onChange:(value:string|null)=>void}){
 const [expanded,setExpanded]=useState(false),id=useId(),categories=rankCategories(items);
 // Keep five slots when collapsed, including the selected category. Extra buttons stay put while expanded.
 const choices=visibleCategories(categories,false,expanded?'':value),visible=choices.length>5?[...choices.slice(0,4),choices[5]]:choices,extra=categories.filter(c=>!visible.includes(c));
 const chip=(category:CategorySummary)=><button key={category.type===null?'unassigned':`type:${category.type}`} aria-pressed={value===category.type} className={`category-chip ${value===category.type?'selected':''}`} style={categoryStyle(category.type)} onClick={()=>onChange(category.type)}><span className="category-dot" aria-hidden="true"/>{category.type??'Unsorted'} <span>{category.tastingCount} {category.tastingCount===1?'tasting':'tastings'}</span></button>;
 return <div className="category-filters"><div className="category-filter-top"><div className="type-tabs" role="group" aria-label="Filter by category"><button aria-pressed={value===''} className={value===''?'selected':''} onClick={()=>onChange('')}>Everything <span>{items.length} items</span></button>{visible.map(chip)}</div>{extra.length>0&&<button className="text-button category-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>{expanded?'Show less':`Show more (${extra.length})`}<ChevronDown size={16}/></button>}</div><div className={`category-expansion ${expanded?'is-expanded':''}`} aria-hidden={!expanded} inert={!expanded} id={id}><div><div className="type-tabs category-extra" role="group" aria-label="More categories">{extra.map(chip)}</div></div></div></div>;
}
