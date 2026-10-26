'use client';
import {useState} from 'react';
import type {Item} from '../lib/contracts';
import {ratingDistribution} from '../domain/rating-distribution';
import {BrandLabel} from './brand-label';
import {Score} from './ui';

export function RatingDistribution({items,open}:{items:Item[];open:(id:string)=>void}){
 const [category,setCategory]=useState('all'),[selected,setSelected]=useState<number|null>(null);
 const categories=[...new Set(items.map(item=>item.type))].sort((a,b)=>(a??'').localeCompare(b??''));
 const stats=ratingDistribution(items,category==='all'?undefined:category==='none'?null:category.slice(5));
 const max=Math.max(1,...stats.bins.map(bin=>bin.items.length));
 const bin=selected===null?null:stats.bins[selected];
 return <section className="rating-distribution" aria-labelledby="distribution-heading">
  <header className="distribution-heading"><div><h2 id="distribution-heading">Your rating distribution</h2><p>Your scores, with the server average for comparison.</p></div>
   <label>Category<select aria-label="Filter rating statistics by category" value={category} onChange={event=>{setCategory(event.target.value);setSelected(null);}}>
    <option value="all">All categories</option>{categories.map(value=><option key={value===null?'none':`type:${value}`} value={value===null?'none':`type:${value}`}>{value??'Uncategorized'}</option>)}
   </select></label>
  </header>
  <dl className="distribution-summary"><div><dt>Your average</dt><dd>{stats.myAverage===null?'—':stats.myAverage.toFixed(2)}<small>/10</small></dd></div><div><dt>Your rated items</dt><dd>{stats.myCount}</dd></div><div><dt>Server average</dt><dd>{stats.groupAverage===null?'—':stats.groupAverage.toFixed(2)}<small>/10</small></dd></div></dl>
  <div className="distribution-plot" role="group" aria-label="Your rating counts by score range">
   <div className="distribution-bars">{stats.bins.map((bucket,index)=><button type="button" key={bucket.low} className={`distribution-bin${selected===index?' selected':''}`} aria-pressed={selected===index} aria-controls="distribution-examples" aria-label={`${bucket.low}–${bucket.high}: ${bucket.items.length} ${bucket.items.length===1?'rating':'ratings'}. Show items`} onClick={()=>setSelected(index)}>
    <span className="distribution-column"><span className="distribution-bar" style={{height:`${bucket.items.length/max*100}%`}}><span className="distribution-count">{bucket.items.length}</span></span></span><span className="distribution-label">{bucket.low}–{bucket.high}</span>
   </button>)}</div>
   {stats.groupAverage!==null&&<div className="distribution-mean" style={{left:`${(stats.groupAverage-1)/9*100}%`}}><span style={{transform:stats.groupAverage>7.5?'translateX(-100%)':stats.groupAverage<3.5?'none':'translateX(-50%)'}}>Server average {stats.groupAverage.toFixed(2)}</span></div>}
  </div>
  <p className="distribution-legend"><span>Bars: your rating counts</span><span>Dashed line: server average</span></p>
  <p className="distribution-method">Uses the latest score per person for each item, including yours in the server average. {stats.groupCount} server {stats.groupCount===1?'score':'scores'} in this category. Score ranges include their lower bound; the final range includes 10.</p>
  {stats.myCount===0&&<p className="distribution-empty">No ratings from you in this category yet. Rate something to start your chart.</p>}
  <div id="distribution-examples" className="distribution-examples" aria-live="polite">{bin?<><h3>Your {bin.low}–{bin.high} ratings</h3>{bin.items.length?<div className="distribution-items">{bin.items.map(item=><button key={item.id} type="button" className="ranking" onClick={()=>open(item.id)}><div><strong>{item.name}</strong><BrandLabel brand={item.brand}/></div><Score value={item.myScore}/></button>)}</div>:<p>You haven’t used this score range in this category.</p>}</>:<p>Choose a bar to see the items you rated.</p>}</div>
 </section>;
}
