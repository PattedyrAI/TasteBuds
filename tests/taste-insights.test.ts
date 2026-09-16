import {describe,expect,it} from 'vitest';
import {tasteInsights,type TasteObservation} from '../src/domain/taste-insights';
import {createRatingSchema} from '../src/domain/validation';
function row(userId:string,itemId:string,score:number):TasteObservation{return {userId,itemId,score,displayName:userId,avatarUrl:null,itemName:itemId,brand:null};}
describe('transparent taste comparisons',()=>{
  it('caps sorted matches, divisive items and disagreements',()=>{
    const rows:TasteObservation[]=[];
    for(let i=0;i<7;i++){
      rows.push(row('me','item'+i,8));
      for(let j=0;j<7;j++)rows.push(row('friend'+j,'item'+i,Math.max(1,8-j-i/10)));
    }
    const insights=tasteInsights('me',rows);
    expect(insights.matches).toHaveLength(5);expect(insights.divisive).toHaveLength(5);
    expect(insights.matches.map(m=>m.person.id)).toEqual(['friend0','friend1','friend2','friend3','friend4']);
    expect(insights.matches.every(m=>m.sharedCount===7&&m.disagreements.length===3)).toBe(true);
    expect(insights.matches[0].disagreements.map(d=>d.itemId)).toEqual(['item6','item5','item4']);
    expect(insights.divisive[0]).toMatchObject({itemId:'item6',highScore:8,lowScore:1.4,raterCount:8});
  });
  it('orders equal mean differences by evidence count and only counts gaps up to one as similar',()=>{
    const rows=[row('me','a',8),row('me','b',8),row('me','c',8),row('me','d',8),row('three','a',7),row('three','b',7),row('three','c',7),row('four','a',7),row('four','b',7),row('four','c',7),row('four','d',7),row('mixed','a',6),row('mixed','b',9),row('mixed','c',8)];
    const result=tasteInsights('me',rows);expect(result.matches.map(m=>m.person.id)).toEqual(['four','mixed','three']);
    expect(result.matches[1]).toMatchObject({meanDifference:1,similarCount:2});
    expect(result.matches[1].disagreements.map(d=>d.difference)).toEqual([2,1]);
  });
  it('validates rereview UUID and requires an explicit existing item',()=>{
    const value={groupId:'11111111-1111-4111-8111-111111111111',photoId:'22222222-2222-4222-8222-222222222222',score:5,name:'Tea'};
    expect(createRatingSchema.safeParse({...value,rereviewOf:'invalid'}).success).toBe(false);
    expect(createRatingSchema.safeParse({...value,rereviewOf:value.photoId}).success).toBe(false);
    expect(createRatingSchema.safeParse({...value,rereviewOf:value.photoId,itemId:value.groupId}).success).toBe(true);
  });
});
