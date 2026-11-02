'use client';
import {useEffect,useState} from 'react';
import type {TasteInsights,TasteMatch} from '../lib/contracts';
import {isCloseTasteMatch} from '../domain/taste-insights';
import {Avatar,request} from './ui';
import {SelectMenu} from './select-menu';

export function TasteProfiles({matches,person,recommend}:{matches:TasteMatch[];person:(id:string)=>void;recommend:(id:string)=>void}){
 return <section className="personal-taste-profiles"><h2>Similar profiles</h2><p className="hint">Your five closest comparisons, based on all shared items in this group. Lower score differences mean closer tastes.</p>
  <div className="taste-matches">{matches.length?matches.map(match=><article className="taste-match" key={match.person.id}>
   <button className="taste-person" onClick={()=>person(match.person.id)}><Avatar name={match.person.displayName} url={match.person.avatarUrl}/><strong>{match.person.displayName}</strong></button>
   <p><b>{match.meanDifference.toFixed(1)}</b><span>/10 average score difference</span></p><small>{match.sharedCount} shared items · {match.similarCount} within 1 point</small>
   {isCloseTasteMatch(match)?<button type="button" className="button secondary taste-recommend-button" onClick={()=>recommend(match.person.id)}>See recommendations</button>:<p className="hint">Not a close enough match for recommendations yet.</p>}
  </article>):<p className="taste-empty">Rate at least three of the same items as someone else to discover your closest tastes. Only your latest scores count.</p>}</div>
 </section>;
}

export function RecommendationList({insights,profile,choose,open}:{insights:TasteInsights;profile:string;choose:(id:string)=>void;open:(id:string)=>void}){
 const eligible=insights.matches.filter(isCloseTasteMatch);
 profile=eligible.some(match=>match.person.id===profile)?profile:'';
 const selected=eligible.find(match=>match.person.id===profile);
 const recommendations=(insights.recommendations??[]).filter(item=>!profile||item.sources.some(source=>source.person.id===profile));
 if(profile)recommendations.sort((a,b)=>b.sources.find(source=>source.person.id===profile)!.score-a.sources.find(source=>source.person.id===profile)!.score||a.itemId.localeCompare(b.itemId));
 return <section className="personal-recommendations"><h2>Recommendations</h2><p className="hint">Drinks you haven’t rated, scored at least 8/10 by a close taste match. You must share at least three rated items and differ by no more than one point on average.</p>
  <SelectMenu label="Recommend drinks from" value={profile} onChange={choose} options={[{value:'',label:'All close matches'},...eligible.map(match=>({value:match.person.id,label:match.person.displayName}))]}/>
  {selected&&<p className="recommendation-match">You and <strong>{selected.person.displayName}</strong>: {selected.sharedCount} shared items · {selected.meanDifference.toFixed(1)} points average difference.</p>}
  {recommendations.length?<div className="recommendation-list">{recommendations.map(item=><article className="recommendation-card" key={item.itemId}>
   <button type="button" className="recommendation-item" onClick={()=>open(item.itemId)}><strong>{item.itemName}</strong><small>{[item.brand,item.type].filter(Boolean).join(' · ')}</small></button>
   <div className="recommendation-reasons">{item.sources.filter(source=>!profile||source.person.id===profile).map(source=><p key={source.person.id}><strong>{source.person.displayName} rated it {source.score.toFixed(1)}/10</strong><small>{source.sharedCount} shared items · {source.meanDifference.toFixed(1)} points average difference</small></p>)}</div>
  </article>)}</div>:<p className="taste-empty" role="status">{eligible.length?'No unseen drinks rated 8/10 or higher from close matches yet. Try another profile, or rate more shared items to improve your matches.':insights.matches.length?'No close taste matches yet. Recommendations need scores within one point on average across at least three shared items.':'Rate at least three shared items with someone else to unlock personalized recommendations.'}</p>}
  <p className="hint recommendation-method">Matched on all shared items, across categories. These are your matches’ actual ratings, not a score forecast for you. All close matches prioritizes drinks backed by more and closer matches; selecting a person shows their highest scores first.</p>
 </section>;
}

export function PersonalTaste({groupId,open,person,recommend,showRecommendations=false,initialProfile=''}:{groupId:string;open:(id:string)=>void;person:(id:string)=>void;recommend:(id:string)=>void;showRecommendations?:boolean;initialProfile?:string}){
 const [data,setData]=useState<TasteInsights|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[profile,setProfile]=useState(initialProfile);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');void request<TasteInsights>(`/api/groups/${groupId}/taste`,'GET',undefined,controller.signal).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not load your taste matches.');});return()=>controller.abort();},[groupId,retry]);
 if(error)return <section className="personal-taste"><p className="error" role="alert">{error}</p><button className="button secondary" onClick={()=>setRetry(value=>value+1)}>Try again</button></section>;
 if(!data)return <section className="personal-taste" role="status">Finding your closest tastes…</section>;
 return <div className="personal-taste">{showRecommendations?<RecommendationList insights={data} profile={data.matches.some(match=>match.person.id===profile)?profile:''} choose={setProfile} open={open}/>:<TasteProfiles matches={data.matches} person={person} recommend={recommend}/>}</div>;
}
