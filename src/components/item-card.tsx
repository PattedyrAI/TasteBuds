'use client';
import {ArrowUpRight} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {Avatar,Photo,Score} from './ui';
import {categoryStyle} from './category-style';
import {BrandLabel} from './brand-label';
export function ReviewerBubbles({item}:{item:Item}){
 const reviewers=item.reviewers??[],remaining=Math.max(0,item.raterCount-reviewers.length);
 return <span className="reviewer-bubbles" role="img" aria-label={`${item.raterCount} ${item.raterCount===1?'reviewer':'reviewers'}${reviewers.length?`: ${reviewers.map(r=>r.displayName).join(', ')}${remaining?` and ${remaining} more`:''}`:''}`}>
   {reviewers.map(r=><span className="reviewer-bubble" key={r.id} title={r.displayName}><Avatar name={r.displayName} url={r.avatarUrl}/></span>)}
   {remaining>0&&<span className="reviewer-overflow">+{remaining}</span>}
   {item.raterCount===0&&<span className="reviewer-caption">No current reviewers</span>}
 </span>;
}
export function TastingScore({item}:{item:Item}){return <span className="tasting-score"><Score value={item.average}/><span className="score-tastings">{item.tastingCount} {item.tastingCount===1?'tasting':'tastings'}</span></span>;}
export function ItemCard({item,open}:{item:Item;open:(id:string)=>void}){
 return <button className="item-card" onClick={()=>open(item.id)} style={categoryStyle(item.type)}>
  <div className="card-image"><Photo id={item.photoId} name={item.name}/>{item.type&&<span className="image-tag category-colour">{item.type}</span>}<TastingScore item={item}/></div>
  <div className="card-body"><div className="card-title"><div><BrandLabel brand={item.brand}/><h2>{item.name}</h2>{item.variant&&<p>{item.variant}</p>}</div></div>
  <footer><ReviewerBubbles item={item}/><span className="card-open" aria-hidden="true"><ArrowUpRight size={18}/></span></footer></div>
 </button>;
}
