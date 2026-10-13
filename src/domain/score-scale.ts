/** One shared reading of a 1–10 score, so every badge, slider and summary speaks the same language. */
export type ScoreTier='skip'|'meh'|'good'|'great'|'outstanding';
export interface ScoreBand{tier:ScoreTier;label:string;min:number;description:string}
// Lower bounds are inclusive; a score belongs to the highest band whose min it reaches.
export const scoreBands:readonly ScoreBand[]=[
  {tier:'skip',label:'Skip it',min:1,description:'Wouldn’t have it again'},
  {tier:'meh',label:'Meh',min:4,description:'Fine if there’s nothing else'},
  {tier:'good',label:'Good',min:6,description:'Happy to have it again'},
  {tier:'great',label:'Great',min:7.5,description:'Worth going out of your way for'},
  {tier:'outstanding',label:'Outstanding',min:9,description:'One of the best'},
];
export function scoreBand(score:number):ScoreBand{
  let band=scoreBands[0];
  for(const candidate of scoreBands)if(score>=candidate.min)band=candidate;
  return band;
}
/** 10/10 keeps its own words; it is the one score people mean literally. */
export function scoreLabel(score:number):string{
  return score>=10?'All-time favourite':scoreBand(score).label;
}
/** Spread of the latest score per person: how much the group agrees about one item. */
export function scoreAgreement(scores:readonly number[]):{spread:number;label:string}|null{
  if(scores.length<2)return null;
  const spread=Math.max(...scores)-Math.min(...scores);
  return {spread,label:spread<=1.5?'Everyone agrees':spread<=3?'Mostly agree':'Divided opinions'};
}
