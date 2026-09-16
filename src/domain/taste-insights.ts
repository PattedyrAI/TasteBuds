import type {TasteInsights, TasteMatch} from '../lib/contracts';
export interface TasteObservation {
  userId: string; displayName: string; avatarUrl: string | null;
  itemId: string; itemName: string; brand: string | null; score: number;
}
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
    if(difference<=1)match.similarCount++;
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
  return {matches,divisive};
}
