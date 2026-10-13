'use client';
import {ArrowRight,Camera,Layers,Bookmark,Trophy} from 'lucide-react';
import type {FeedEntry,Item} from '@/lib/contracts';
import {Avatar,Photo,Score} from './ui';
import {groupFavourites,rankCategories} from './catalog-presentation';
import {sections,sectionFor,type Section} from '../domain/category-taxonomy';

/** Home answers three questions in order: what did you try, what is the group into, and where to look next. */
export function CollectionHome({items,feed,name,browse,open,add,showFeed,showInsights,showSaved}:{items:Item[];feed:FeedEntry[];name:string;browse:(type:string|null,section?:Section)=>void;open:(id:string)=>void;add:()=>void;showFeed:()=>void;showInsights:()=>void;showSaved:()=>void}){
  const favourites=groupFavourites(items).slice(0,3),saved=items.filter(i=>i.saved).slice(0,8);
  const bySection=sections.map(section=>({section,categories:rankCategories(items.filter(i=>sectionFor(i.type,i.broadCategory)===section))})).filter(s=>s.categories.length);
  const unsorted=items.filter(i=>!sectionFor(i.type,i.broadCategory)).length;
  return <div className="home">
    <button type="button" className="rate-prompt" onClick={add}>
      <span className="rate-prompt-icon" aria-hidden="true"><Camera size={26}/></span>
      <span className="rate-prompt-copy"><strong>What did you try{name?`, ${name}`:''}?</strong><span>Snap it, score it, share it with the group.</span></span>
      <ArrowRight className="rate-prompt-arrow" size={20} aria-hidden="true"/>
    </button>
    {items.length===0?<div className="empty-state"><Layers size={36}/><h2>Your collection starts with a photo.</h2><p>Categories and favourites appear here as your group rates things.</p></div>:<>
    {feed.length>0&&<section className="home-section"><div className="section-heading"><h2>Lately in the group</h2><button className="text-button" onClick={showFeed}>All activity <ArrowRight size={16}/></button></div>
      <ul className="rail">{latestPerItem(feed).slice(0,10).map(r=><li key={r.id}><button type="button" className="rail-card" onClick={()=>open(r.itemId)}>
        <Photo id={r.photoId} name={r.itemName}/><span className="rail-card-score"><Score value={r.score}/></span>
        <span className="rail-card-copy">{r.brand&&<small>{r.brand}</small>}<strong>{r.itemName}</strong><span className="rail-card-who"><Avatar name={r.author.displayName} url={r.author.avatarUrl}/>{r.author.displayName}</span></span>
      </button></li>)}</ul></section>}
    {favourites.length>0&&<section className="home-section"><div className="section-heading"><h2>Group favourites</h2><button className="text-button" onClick={showInsights}>See insights <ArrowRight size={16}/></button></div>
      <ol className="mini-ranking">{favourites.map((item,index)=><li key={item.id}><button type="button" onClick={()=>open(item.id)}><span className="rank" aria-label={`Number ${index+1}`}>{index===0?<Trophy size={16}/>:index+1}</span><Photo id={item.photoId} name={item.name}/><span className="mini-ranking-copy"><strong>{item.name}</strong><small>{[item.brand,`${item.raterCount} people`].filter(Boolean).join(' · ')}</small></span><Score value={item.average}/></button></li>)}</ol></section>}
    {bySection.map(({section,categories})=><section className="home-section" key={section}><div className="section-heading"><h2>{section}</h2><button className="text-button" onClick={()=>browse('',section)}>All {section.toLowerCase()} <ArrowRight size={16}/></button></div>
      <div className="category-tiles">{categories.slice(0,8).map(c=>{const cover=[...c.items].sort((a,b)=>(b.tastingCount-a.tastingCount))[0];const title=c.type??'Unsorted';
        return <button type="button" className="category-tile" key={title} onClick={()=>browse(c.type,section)}><Photo id={cover.photoId} name={title}/><span className="category-tile-copy"><strong>{title}</strong><small>{c.items.length} {c.items.length===1?'item':'items'}</small></span></button>;})}</div></section>)}
    {unsorted>0&&<button type="button" className="text-button unsorted-link" onClick={()=>browse(null)}>{unsorted} {unsorted===1?'item needs':'items need'} a category</button>}
    {saved.length>0&&<section className="home-section"><div className="section-heading"><h2><Bookmark size={18}/> Want to try</h2><button className="text-button" onClick={showSaved}>Your list <ArrowRight size={16}/></button></div>
      <ul className="rail">{saved.map(item=><li key={item.id}><button type="button" className="rail-card" onClick={()=>open(item.id)}><Photo id={item.photoId} name={item.name}/><span className="rail-card-score"><Score value={item.average}/></span><span className="rail-card-copy"><strong>{item.name}</strong><small>{item.brand}</small></span></button></li>)}</ul></section>}
    </>}
  </div>;
}

/** One card per item in the rail: the newest rating speaks for it. */
function latestPerItem(feed:FeedEntry[]){const seen=new Set<string>();return feed.filter(r=>!seen.has(r.itemId)&&!!seen.add(r.itemId));}
