import type {Item} from '../lib/contracts';

/** Item scores already contain each current member's latest nondeleted rating. */
export function ratingDistribution(items:readonly Item[],category?:string|null){
 const filtered=category===undefined?items:items.filter(item=>item.type===category);
 const mine=filtered.filter((item):item is Item&{myScore:number}=>item.myScore!=null);
 const group=filtered.filter(item=>item.average!=null&&item.raterCount>0);
 const groupCount=group.reduce((sum,item)=>sum+item.raterCount,0);
 return {
  myCount:mine.length,
  myAverage:mine.length?mine.reduce((sum,item)=>sum+item.myScore,0)/mine.length:null,
  groupCount,
  groupAverage:groupCount?group.reduce((sum,item)=>sum+item.average!*item.raterCount,0)/groupCount:null,
  bins:Array.from({length:9},(_,index)=>({
   low:index+1,high:index+2,
   items:mine.filter(item=>Math.min(8,Math.floor(item.myScore)-1)===index),
  })),
 };
}
