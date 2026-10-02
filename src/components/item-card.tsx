'use client';
import {ArrowUpRight} from 'lucide-react';
import type {Item} from '@/lib/contracts';
import {Avatar,Photo,Score} from './ui';
import {categoryStyle} from './category-style';
import {BrandLabel} from './brand-label';
import {SaveItemButton} from './discovery-actions';
import {ScoreBar,ScoreRowNote} from './score-bar';
import type {FriendScore} from './friend-compare';
export function ReviewerBubbles({item}:{item:Item}){
 const reviewers=item.reviewers??[],remaining=Math.max(0,item.raterCount-reviewers.length);
 return <span className="reviewer-bubbles" role="img" aria-label={`${item.raterCount} ${item.raterCount===1?'reviewer':'reviewers'}${reviewers.length?`: ${reviewers.map(r=>r.displayName).join(', ')}${remaining?` and ${remaining} more`:''}`:''}`}>
   {reviewers.map(r=><span className="reviewer-bubble" key={r.id} title={r.displayName}><Avatar name={r.displayName} url={r.avatarUrl}/></span>)}
   {remaining>0&&<span className="reviewer-overflow">+{remaining}</span>}
   {item.raterCount===0&&<span className="reviewer-caption">No current reviewers</span>}
 </span>;
}
export function TastingScore({item}:{item:Item}){return <span className="tasting-score"><Score value={item.average}/><span className="score-tastings">{item.tastingCount} {item.tastingCount===1?'tasting':'tastings'}</span></span>;}
/** Photo first, then who made it, what it is, and how you (and one friend) scored it. */
export function ItemCard({item,open,friend}:{item:Item;open:(id:string)=>void;friend?:FriendScore}){
 return <article className={`item-card${item.myScore===10?' personal-perfect':''}`} style={categoryStyle(item.type)}><button type="button" className="card-open-hit" onClick={()=>open(item.id)} aria-label={`View ${item.name}`}/>
  <div className="card-image"><SaveItemButton item={item} compact/><Photo id={item.photoId} name={item.name}/>{item.type&&<span className="image-tag category-colour">{item.type}</span>}</div>
  <div className="card-body"><div className="card-title"><BrandLabel brand={item.brand} interactive/><h2>{item.name}</h2>{item.variant&&<p>{item.variant}</p>}</div>
  <div className={`card-scores${friend?' comparing':''}`}><ScoreBar tone="mine" label={friend?'You':'You rated it'} score={item.myScore??null} empty="You haven’t tried this"/>{friend&&(friend.state==='ready'?<ScoreBar tone="friend" label={friend.name} score={friend.score} empty={`${friend.name} hasn’t rated this`}/>:<ScoreRowNote tone="friend" state={friend.state}>{friend.state==='loading'?`Checking ${friend.name}…`:`${friend.name}’s score didn’t load`}</ScoreRowNote>)}</div>
  <footer><div className="card-community"><span className="card-community-score"><Score value={item.average}/><small>group · {item.tastingCount} {item.tastingCount===1?'tasting':'tastings'}</small></span><ReviewerBubbles item={item}/></div><span className="card-open" aria-hidden="true"><ArrowUpRight size={18}/></span></footer></div>
 </article>;
}
