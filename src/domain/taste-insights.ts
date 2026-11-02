import type {TasteInsights, TasteMatch, TasteRecommendation} from '../lib/contracts';
import {sectionFor} from './category-taxonomy';
export interface TasteObservation {
  userId: string; displayName: string; avatarUrl: string | null;
  itemId: string; itemName: string; brand: string | null; score: number;
  type?:string|null; broadCategory?:string|null;
}
// Scores use tenths; tolerate binary floating-point noise at the one-point boundary.
const withinOnePoint=(difference:number)=>difference<=1+1e-9;
export const isCloseTasteMatch=(match:Pick<TasteMatch,'sharedCount'|'meanDifference'>)=>match.sharedCount>=3&&withinOnePoint(match.meanDifference);
/** Input contains exactly one current score per current member and item. */
export function tasteInsights(userId: string, rows: TasteObservation[]): TasteInsights {
  const mine=new Map(rows.filter(row=>row.userId===userId).map(row=>[row.itemId,row]));
  const people=new Map<string,TasteMatch>();
  const items=new Map<string,TasteObservation[]>();
  for (const row of rows) {
    const group=items.get(row.itemId)??[];group.push(row);items.set(row.itemId,group);
    const my=mine.get(row.itemId);
    if(row.userId===userId||!my)continue;
    let match=people.get(row.userId);
    if(!match){match={person:{id:row.userId,displayName:row.displayName,avatarUrl:row.avatarUrl},sharedCount:0,meanDifference:0,similarCount:0,disagreements:[]};people.set(row.userId,match);}
    const difference=Math.abs(my.score-row.score);
    match.sharedCount++;match.meanDifference+=difference;
    if(withinOnePoint(difference))match.similarCount++;
    if(difference>0)match.disagreements.push({itemId:row.itemId,itemName:row.itemName,myScore:my.score,theirScore:row.score,difference});
  }
  const matches=[...people.values()].filter(match=>match.sharedCount>=3).map(match=>({...match,
    meanDifference:match.meanDifference/match.sharedCount,
    disagreements:match.disagreements.sort((a,b)=>b.difference-a.difference||a.itemId.localeCompare(b.itemId)).slice(0,3),
  })).sort((a,b)=>a.meanDifference-b.meanDifference||b.sharedCount-a.sharedCount||a.person.id.localeCompare(b.person.id)).slice(0,5);
  const divisive=[...items.values()].filter(group=>group.length>=3).map(group=>({
    itemId:group[0].itemId,itemName:group[0].itemName,brand:group[0].brand,
    lowScore:Math.min(...group.map(row=>row.score)),highScore:Math.max(...group.map(row=>row.score)),raterCount:group.length,
  })).sort((a,b)=>(b.highScore-b.lowScore)-(a.highScore-a.lowScore)||b.raterCount-a.raterCount||a.itemId.localeCompare(b.itemId)).slice(0,5);
  const sources=matches.filter(isCloseTasteMatch);
  const sourceRows=sources.map(match=>({match,rows:rows.filter(row=>row.userId===match.person.id&&!mine.has(row.itemId)&&row.score>=8&&sectionFor(row.type,row.broadCategory)==='Drinks').sort((a,b)=>b.score-a.score||a.itemId.localeCompare(b.itemId))}));
  // Keep every displayed profile's top five before combining: a profile filter must not lose its best picks.
  const candidates=new Set(sourceRows.flatMap(source=>source.rows.slice(0,5).map(row=>row.itemId)));
  const suggestions=new Map<string,TasteRecommendation>();
  for(const {match,rows:ratings} of sourceRows)for(const row of ratings){
    if(!candidates.has(row.itemId))continue;
    let suggestion=suggestions.get(row.itemId);
    if(!suggestion){suggestion={itemId:row.itemId,itemName:row.itemName,brand:row.brand,type:row.type??null,sources:[]};suggestions.set(row.itemId,suggestion);}
    suggestion.sources.push({person:match.person,score:row.score,sharedCount:match.sharedCount,meanDifference:match.meanDifference});
  }
  const support=(item:TasteRecommendation)=>item.sources.reduce((sum,source)=>sum+1/(1+source.meanDifference),0);
  const recommendations=[...suggestions.values()].sort((a,b)=>support(b)-support(a)||Math.max(...b.sources.map(s=>s.score))-Math.max(...a.sources.map(s=>s.score))||a.itemId.localeCompare(b.itemId));
  return {matches,divisive,recommendations};
}
