'use client';
import {useId,useState} from 'react';
import {rankCategories,visibleCategories} from './catalog-presentation';
import {ArrowUpRight,Layers,Plus} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {Photo,Score} from './ui';

export function CollectionHome({items,browse,open,add}:{items:Item[];browse:(type:string|null)=>void;open:(id:string)=>void;add:()=>void}){
  const [expanded,setExpanded]=useState(false),categoriesId=useId();
  const categories=rankCategories(items),visible=visibleCategories(categories,expanded);
  return <div className="collection-home">
    <div className="home-section-heading"><div><h2>Explore the collection</h2><p className="muted">Your most-tried categories, all in one place.</p></div><button className="text-button" onClick={()=>browse('')}>View all {items.length} items <ArrowUpRight size={16}/></button></div>
    {categories.length?<><div className="subcategory-grid" key={expanded?"expanded":"collapsed"} id={categoriesId}>{visible.map(({type:label,items:rows,tastingCount})=>{
      const cover=rows.find(i=>i.photoId)||rows[0];
      const title=label===null?'Unsorted':label;
      return <button className="subcategory-card" key={label===null?'unassigned':`type:${label}`} onClick={()=>browse(label)}>
        <Photo id={cover.photoId} name={title}/><div><h3>{title}</h3><p>{rows.length} {rows.length===1?'item':'items'} · {tastingCount} {tastingCount===1?'tasting':'tastings'}</p></div><ArrowUpRight size={19}/>
      </button>;
    })}</div>{categories.length>5&&<button className="text-button category-toggle" aria-expanded={expanded} aria-controls={categoriesId} onClick={()=>setExpanded(v=>!v)}>{expanded?'Show less':`Show more (${categories.length-5} more categories)`}</button>}</>:<div className="empty-state"><Layers size={36}/><h2>Your collection starts with a photo.</h2><p>Subcategories appear here as your group adds ratings.</p><button className="button primary" onClick={add}><Plus size={17}/> Add the first rating</button></div>}
    {!!items.length&&<section className="home-recent"><div className="home-section-heading"><div><h2>Recently tried</h2><p className="muted">Fresh additions to your shared notebook.</p></div></div><div className="item-grid">{[...items].sort((a,b)=>new Date(b.lastRatedAt||0).getTime()-new Date(a.lastRatedAt||0).getTime()).slice(0,6).map(i=><button className="item-card" key={i.id} onClick={()=>open(i.id)}><div className="card-image"><Photo id={i.photoId} name={i.name}/>{i.type&&<span className="image-tag">{i.type}</span>}</div><div className="card-body"><div className="card-title"><div><h2>{i.name}</h2><p>{[i.brand,i.variant].filter(Boolean).join(' · ')||'Brand not added'}</p></div><Score value={i.average}/></div><footer>{i.tastingCount} tastings <ArrowUpRight size={17}/></footer></div></button>)}</div></section>}
  </div>;
}
