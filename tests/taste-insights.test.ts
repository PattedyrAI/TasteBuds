import {describe,expect,it} from 'vitest';
import {tasteInsights,type TasteObservation} from '../src/domain/taste-insights';
import {createRatingSchema} from '../src/domain/validation';
function row(userId:string,itemId:string,score:number):TasteObservation{return {userId,itemId,score,displayName:userId,avatarUrl:null,itemName:itemId,brand:null};}
describe('transparent taste comparisons',()=>{
  const drink=(userId:string,itemId:string,score:number)=>({...row(userId,itemId,score),type:'Energy drinks'});
  const shared=(friend='friend',difference=0)=>[1,2,3].flatMap(n=>[drink('me','shared'+n,7),drink(friend,'shared'+n,7+difference)]);
  it('recommends only unseen 8+ drinks from a close profile with at least three shared items',()=>{
    const rows=[...shared(),drink('friend','pick',9),drink('friend','low',7.9),{...row('friend','food',10),type:'Burgers'},drink('friend','tried',10),drink('me','tried',8),drink('stranger','unknown',10)];
    const result=tasteInsights('me',rows);
    expect(result.recommendations.map(r=>r.itemId)).toEqual(['pick']);
    expect(result.recommendations[0].sources[0]).toMatchObject({person:{id:'friend'},score:9,sharedCount:4,meanDifference:.5});
    expect(tasteInsights('me',[...shared().slice(0,4),drink('friend','pick',10)]).recommendations).toEqual([]);
    expect(tasteInsights('me',[...shared('friend',1.1),drink('friend','pick',10)]).recommendations).toEqual([]);
    expect(tasteInsights('me',[...shared('friend',1),drink('friend','boundary',8)]).recommendations.map(r=>r.itemId)).toEqual(['boundary']);
  });
  it('merges matched sources, preserves each profile’s top five and uses stable support ordering',()=>{
    const mine=shared().filter(r=>r.userId==='me');
    const rows=[...mine,...shared().filter(r=>r.userId==='friend'),...shared('other',.5).filter(r=>r.userId==='other'),drink('friend','both',9),drink('other','both',8.5),...Array.from({length:7},(_,i)=>drink('friend','pick'+i,10-i*.1))];
    const before=structuredClone(rows),result=tasteInsights('me',rows);
    expect(result.recommendations.map(r=>r.itemId)).not.toContain('pick6');
    expect(result.recommendations.find(r=>r.itemId==='both')?.sources.map(s=>s.person.id)).toEqual(['friend','other']);
    expect(result.recommendations[0].itemId).toBe('both');
    expect(tasteInsights('me',[...rows].reverse()).recommendations).toEqual(result.recommendations);
    expect(rows).toEqual(before);
  });
  it('uses broad drink metadata for custom categories and ignores unclassified items',()=>{
    const result=tasteInsights('me',[...shared(),{...row('friend','custom',9),type:'House special',broadCategory:'Drink'},row('friend','unknown',10)]);
    expect(result.recommendations.map(r=>r.itemId)).toEqual(['custom']);
  });
  it('includes decimal scores exactly one point apart at both similarity boundaries',()=>{
    const rows=[1,2,3].flatMap(n=>[drink('me','decimal'+n,7.3),drink('friend','decimal'+n,8.3)]);
    const result=tasteInsights('me',[...rows,drink('friend','pick',9)]);
    expect(result.matches[0].similarCount).toBe(3);
    expect(result.recommendations.map(r=>r.itemId)).toEqual(['pick']);
  });
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
