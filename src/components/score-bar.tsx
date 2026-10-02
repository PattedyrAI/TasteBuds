'use client';
/** One person's score on a continuously filled 0–10 panel. Unrated never draws a bar, so "not tried" can't be read as a zero. */
export function ScoreBar({label,score,tone,empty}:{label:string;score:number|null;tone:'mine'|'friend';empty:string}){
 if(score==null)return <div className={`score-row ${tone} is-empty`}><span className="score-row-label">{empty}</span></div>;
 const value=Math.min(10,Math.max(0,score));
 return <div className={`score-row ${tone}`}>
  <span className="score-row-label">{label}</span>
  <strong className="score-row-value">{score.toFixed(1)}<small>/10</small></strong>
  <span className="score-fill" aria-hidden="true" style={{width:`${value*10}%`}}/>
 </div>;
}
/** A pending or failed friend score: shaped like a row, worded so it is never mistaken for "not rated". */
export function ScoreRowNote({tone,children,state}:{tone:'friend';state:'loading'|'error';children:React.ReactNode}){
 return <div className={`score-row ${tone} is-${state}`}><span className="score-row-label">{children}</span></div>;
}
