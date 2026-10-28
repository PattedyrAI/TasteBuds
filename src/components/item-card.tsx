'use client';
import {useState} from 'react';
import {ArrowUpRight,Expand} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {Avatar,Photo,Score} from './ui';
import {isMatthew} from '../domain/matthew';
import {isSugarfree} from '../domain/energy-drinks';
import {BrandLabel} from './brand-label';
import {SaveItemButton} from './discovery-actions';
import {ScoreBar,ScoreRowNote} from './score-bar';
import type {FriendScore} from './friend-compare';
import {PhotoViewer} from './photo-viewer';
export function ReviewerBubbles({item}:{item:Item}){
 const reviewers=item.reviewers??[],remaining=Math.max(0,item.raterCount-reviewers.length);
 return <span className="reviewer-bubbles" role="img" aria-label={`${item.raterCount} ${item.raterCount===1?'reviewer':'reviewers'}${reviewers.length?`: ${reviewers.map(r=>r.displayName).join(', ')}${remaining?` and ${remaining} more`:''}`:''}`}>
   {reviewers.map(r=><span className="reviewer-bubble" key={r.id} title={r.displayName} data-matthew={isMatthew(r.displayName)||undefined}><Avatar name={r.displayName} url={r.avatarUrl}/></span>)}
   {remaining>0&&<span className="reviewer-overflow">+{remaining}</span>}
   {item.raterCount===0&&<span className="reviewer-caption">No current reviewers</span>}
 </span>;
}
export function TastingScore({item}:{item:Item}){return <span className="tasting-score"><Score value={item.average}/><span className="score-tastings">{item.tastingCount} {item.tastingCount===1?'tasting':'tastings'}</span></span>;}
/** Photo and group score first, then what it is, then where you stand. */
export function ItemCard({item,open,friend}:{item:Item;open:(id:string)=>void;friend?:FriendScore}){
 const [enlarged,setEnlarged]=useState(false);
 // The photo enlarges over the list (a sibling, so the card's hover styles stay out of the dialog); the rest of the card opens the item.
 return <><article className={`item-card${item.myScore===10?' personal-perfect':''}`}><button type="button" className="card-open-hit" onClick={()=>open(item.id)} aria-label={`View ${item.name}`}/>
  <div className="card-image"><SaveItemButton item={item} compact/>{item.photoId?<button type="button" className="card-photo-open" aria-label={`Enlarge photo of ${item.name}`} onClick={()=>setEnlarged(true)}><Photo id={item.photoId} name={item.name}/><span className="card-photo-hint" aria-hidden="true"><Expand size={14}/></span></button>:<Photo id={item.photoId} name={item.name}/>}<span className="card-score"><Score value={item.average}/></span></div>
  <div className="card-body"><div className="card-title"><BrandLabel brand={item.brand}/><h2>{item.name}</h2></div>
  <p className="card-meta">{[item.type,item.variant&&(isSugarfree(item.variant)?'Sugar-free':item.variant)].filter(Boolean).map((part,index)=><span key={index}>{index>0&&' · '}{part}</span>)}</p>
  <footer><ReviewerBubbles item={item}/>{item.myScore==null?<span className="card-mine muted">Not tried</span>:<span className="card-mine">You <Score value={item.myScore}/></span>}</footer>
  {friend&&<div className="card-scores comparing">{friend.state==='ready'?<ScoreBar tone="friend" label={friend.name} score={friend.score} empty={`${friend.name} hasn’t rated this`}/>:<ScoreRowNote tone="friend" state={friend.state}>{friend.state==='loading'?`Checking ${friend.name}…`:`${friend.name}’s score didn’t load`}</ScoreRowNote>}</div>}
  </div>
 </article>
 {enlarged&&item.photoId&&<PhotoViewer ids={[item.photoId]} name={item.name} close={()=>setEnlarged(false)} details={()=>{setEnlarged(false);open(item.id);}}/>}</>;
}
