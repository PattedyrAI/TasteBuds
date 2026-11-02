import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ratingDistribution} from '../src/domain/rating-distribution';
import {RatingDistribution} from '../src/components/rating-distribution';
import type {Item} from '../src/lib/contracts';

const item=(id:string,myScore:number|null,average:number|null,raterCount:number,type:string|null='Energy drinks')=>({id,name:id,myScore,average,raterCount,type,brand:null,variant:null}) as Item;
describe('personal rating distribution',()=>{
 it('weights the group mean by raters rather than averaging item averages',()=>{
  const result=ratingDistribution([item('a',8,8,1),item('b',null,4,3)]);
  expect(result.groupAverage).toBe(5);
  expect(result.groupCount).toBe(4);
  expect(result.myAverage).toBe(8);
  expect(result.myCount).toBe(1);
 });
 it('puts decimal scores in the right bin and includes exactly 10 once',()=>{
  const result=ratingDistribution([item('low',1,1,1),item('decimal',7.9,7.9,1),item('high',10,10,1),item('nine',9,9,1)]);
  expect(result.bins.map(b=>b.items.map(i=>i.id))).toEqual([['low'],[],[],[],[],[],['decimal'],[],['high','nine']]);
  expect(result.myAverage).toBeCloseTo(6.975);
  expect(result.bins.reduce((n,b)=>n+b.items.length,0)).toBe(4);
 });
 it('filters personal and server scores to the same category, including uncategorized',()=>{
  const items=[item('drink',8,7,2),item('food',3,4,3,'Burgers'),item('other',6,6,1,null)];
  expect(ratingDistribution(items,'Burgers')).toMatchObject({myAverage:3,groupAverage:4,myCount:1,groupCount:3});
  expect(ratingDistribution(items,null)).toMatchObject({myAverage:6,groupAverage:6,myCount:1});
 });
 it('does not turn missing personal or server ratings into zero scores',()=>{
  expect(ratingDistribution([item('saved',null,null,0)])).toMatchObject({myAverage:null,groupAverage:null,myCount:0,groupCount:0});
  expect(ratingDistribution([item('friend',null,9,2)])).toMatchObject({myAverage:null,groupAverage:9});
 });
 it('renders an accessible chart with personal counts and server mean',()=>{
  const html=renderToStaticMarkup(<RatingDistribution items={[item('drink',8,7,2)]} open={()=>{}}/>);
  expect(html).toContain('Your rating distribution');
  expect(html).toContain('Server average 7.00');
  expect(html).toContain('8–9: 1 rating. Show items');
  expect(html).toContain('Filter rating statistics by category');
  expect(html).toContain('latest score per person');
 });
 it('still shows the server average when you have not rated anything',()=>{
  const html=renderToStaticMarkup(<RatingDistribution items={[item('friend',null,9,2)]} open={()=>{}}/>);
  expect(html).toContain('No ratings from you');
  expect(html).toContain('Server average 9.00');
  expect(html).not.toContain('NaN');
 });
});
