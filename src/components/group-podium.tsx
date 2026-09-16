'use client';
import {useState} from 'react';
import {matchesBrowseCategory} from '../domain/browse-categories';
import {Crown,ArrowUpRight,Trophy} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {Photo} from './ui';
import {ReviewerBubbles,TastingScore} from './item-card';
import {SelectMenu} from './select-menu';
import {brandKey,featuredBrands,FEATURED_BRAND_MIN_ITEMS,groupFavourites,rankCategories} from './catalog-presentation';
import {categoryStyle} from './category-style';
import {BrandLabel} from './brand-label';
export function GroupPodium({items,open,browse}:{items:Item[];open:(id:string)=>void;browse:()=>void}){
 const [category,setCategory]=useState('all'),[brand,setBrand]=useState(''),categories=rankCategories(items);
 const eligible=items.filter(i=>category==='all'||matchesBrowseCategory(i.type,category==='unassigned'?null:category.slice(5)));
 const brands=featuredBrands(eligible),selectedBrand=brands.find(b=>b.key===brand),activeBrand=selectedBrand?.key??'';
 const ranked=groupFavourites(eligible.filter(i=>!activeBrand||brandKey(i.brand)===activeBrand));
 return <section className="favourites-section"><div className="podium-heading"><div><h2><Trophy size={24}/> Group favourites</h2><p>Three or more people. One shared verdict.</p></div><div className="podium-filters"><SelectMenu label="Favourites category" value={category} onChange={value=>{setCategory(value);setBrand('');}} options={[{value:'all',label:'All categories'},...categories.map(c=>({value:c.type===null?'unassigned':`type:${c.type}`,label:c.type??'Unsorted'}))]}/><SelectMenu label="Favourites brand" value={activeBrand} onChange={setBrand} searchable options={[{value:'',label:'All brands'},...brands.map(b=>({value:b.key,label:`${b.name} · ${b.itemCount} items`}))]}/><small>Brands with {FEATURED_BRAND_MIN_ITEMS}+ rated items in this category.</small></div></div>
 {ranked.length?<><div className="podium" key={`${category}-${activeBrand}`} aria-label="Top three group favourites">{ranked.slice(0,3).map((item,index)=><button key={item.id} className={`podium-place place-${index+1}`} onClick={()=>open(item.id)} style={categoryStyle(item.type)}>
 <span className="sr-only">{index+1}{index===0?'st':index===1?'nd':'rd'} place</span><div className="podium-product"><span className="podium-medal">{index===0?<Crown size={20}/>:index+1}<span className="sr-only">{index===0?'First place':''}</span></span><Photo id={item.photoId} name={item.name}/></div>
 <div className="podium-step"><span className="podium-category category-colour">{item.type??'Unsorted'}</span><BrandLabel brand={item.brand}/><h3>{item.name}</h3><TastingScore item={item}/><ReviewerBubbles item={item}/><span className="podium-rank" aria-hidden="true">{index+1}</span></div>
 </button>)}</div>{ranked.length>3&&<div className="runners-up" aria-label="More group favourites">{ranked.slice(3).map((item,index)=><button className="ranking" key={item.id} onClick={()=>open(item.id)}><span className="rank">{index+4}</span><Photo id={item.photoId} name={item.name}/><div className="ranking-copy"><strong>{item.name}</strong><BrandLabel brand={item.brand}/>{!item.brand&&<small>{item.type}</small>}</div><TastingScore item={item}/><ArrowUpRight size={16}/></button>)}</div>}</>:<div className="podium-empty"><Trophy size={36}/><h3>The podium is waiting.</h3><p>{selectedBrand?`No ${selectedBrand.name} items in this category have ratings from three people yet.`:category==='all'?'An item needs ratings from at least three people to earn a place.':'No items in this category have ratings from three people yet.'}</p><button className="button secondary" onClick={browse}>Explore the collection</button></div>}
 </section>;
}
