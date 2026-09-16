import {describe,expect,it} from 'vitest';
import {filterRestaurantPins} from '../src/domain/restaurant-filters';
import type {RestaurantPin} from '../src/lib/contracts';
const pins=[
  {placeId:'a',location:{lat:1,lng:2},item:{id:'1',name:'Lille Napoli',brand:null,type:'Restaurant',customFields:{cuisine:'Italiensk',price:200},average:8}},
  {placeId:'b',location:null,item:{id:'2',name:'Oslo curry',brand:'Sentrum',type:'Restaurant',customFields:{cuisine:'Indisk',price:300},average:6}},
  {placeId:'c',location:{lat:3,lng:4},item:{id:'3',name:'Kaffehuset',brand:null,type:'Kafé',customFields:{},average:null}},
] as RestaurantPin[];
describe('kartfiltre',()=>{
  it('kombinerer kategori, cuisine, navn og gruppescore uten å endre kilde',()=>{
    expect(filterRestaurantPins(pins,{search:' NAPOLI ',category:'Restaurant',fields:{cuisine:{value:'italiensk'},price:{max:250}},minimumScore:7})).toEqual([pins[0]]);
    expect(pins).toHaveLength(3);
  });
  it('beholder steder uten posisjon i listen og utelater uvurderte fra scorefilter',()=>{
    expect(filterRestaurantPins(pins,{search:'sentrum'})).toEqual([pins[1]]);
    expect(filterRestaurantPins(pins,{minimumScore:1})).toHaveLength(2);
    expect(filterRestaurantPins(pins,{})).toHaveLength(3);
  });
});
