import {describe,it,expect} from 'vitest';
import {matchesItemSearch} from '../src/domain/item-search';
const drink={name:'Winter Edition',brand:'Red Bull',variant:'Iced Vanilla Berry',type:'Energy drinks'};
describe('collection search',()=>{
 it('matches brand plus model plus variant across separate fields in any order',()=>{
  for(const query of ['red bull winter edition','winter edition red bull','RED BULL vanilla','redbull winter','  winter   berry  '])expect(matchesItemSearch(drink,query)).toBe(true);
 });
 it('requires every word and does not include a different brand or edition',()=>{
  expect(matchesItemSearch({...drink,name:'Summer Edition'},'red bull winter edition')).toBe(false);
  expect(matchesItemSearch({...drink,brand:'Monster'},'red bull winter edition')).toBe(false);
  expect(matchesItemSearch(drink,'red bull mango')).toBe(false);
 });
 it('normalizes punctuation and accents while retaining category searches',()=>{
  const food={name:'Jalapeño Mac & Cheese',brand:null,variant:null,type:'Mac and cheese'};
  expect(matchesItemSearch(food,'jalapeno mac-and-cheese')).toBe(true);
  expect(matchesItemSearch(drink,'energy winter')).toBe(true);
  expect(matchesItemSearch({name:'Chocolate cookie',brand:null,variant:null,type:'Cookies'},'desserts chocolate')).toBe(true);
 });
 it('allows an empty query and handles absent optional fields',()=>{
  expect(matchesItemSearch(drink,'  ')).toBe(true);
  expect(matchesItemSearch({name:'Pasta',brand:null,variant:null,type:null},'pasta')).toBe(true);
  expect(matchesItemSearch({name:'Pasta',brand:null,variant:null,type:null},'missing pasta')).toBe(false);
 });
});
