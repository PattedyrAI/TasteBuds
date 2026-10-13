'use client';
import {useId,type CSSProperties} from 'react';
import {scoreBand,scoreBands,scoreLabel} from '../domain/score-scale';
/** Slider for the common half-point choice, a number field for an exact decimal, and words for what the score means. */
export function RatingInput({value,onChange,disabled=false}:{value:number|'';onChange:(value:number|'')=>void;disabled?:boolean}){
 const hint=useId(),sliderValue=value===''?7:Math.min(10,Math.max(1,Math.round(value*2)/2));
 const shown=value===''?null:value,band=shown==null?null:scoreBand(shown);
 return <fieldset className="rating-scale" disabled={disabled} data-tier={band?.tier}><legend>Your score</legend>
  <div className="rating-readout">
   <label className="rating-number"><span className="sr-only">Score from 1 to 10</span><input type="number" inputMode="decimal" required min={1} max={10} step={0.1} value={value} aria-describedby={hint} onChange={event=>onChange(Number.isFinite(event.target.valueAsNumber)?event.target.valueAsNumber:'')}/><span aria-hidden="true">/10</span></label>
   <div className="rating-meaning" aria-live="polite"><strong>{shown==null?'Pick a score':scoreLabel(shown)}</strong><span>{band?.description??'1 is the worst, 10 the best'}</span></div>
  </div>
  <input className="rating-slider" type="range" aria-label="Score slider" aria-valuetext={`${sliderValue} out of 10, ${scoreLabel(sliderValue)}`} min={1} max={10} step={0.5} value={sliderValue} onChange={event=>onChange(event.target.valueAsNumber)} style={{'--rating-fill':`${(sliderValue-1)/9*100}%`} as CSSProperties}/>
  <ol className="scale-bands" aria-hidden="true">{scoreBands.map((b,i)=><li key={b.tier} data-tier={b.tier} style={{'--band-start':`${(b.min-1)/9*100}%`,'--band-end':`${((scoreBands[i+1]?.min??10)-1)/9*100}%`} as CSSProperties}><span>{b.label}</span></li>)}</ol>
  <p id={hint} className="sr-only">Slide in half points, or type a score with one decimal.</p>
 </fieldset>;
}
