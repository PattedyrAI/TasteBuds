import {describe,expect,it} from 'vitest';
import {kindForType,typesForKind} from '../src/domain/review-categories';

describe('simple review categories',()=>{
 it.each(['Pizza','pizza','Burgers','Mac and cheese','Pasta','Barbecue ribs','Salads','Food'])('recognizes %s as Food',type=>{
  expect(kindForType(type)).toBe('Food');
 });
 it.each(['Bubble tea','Energy drink','Energy drinks','Coffee','Water','Milkshakes','Beer'])('recognizes %s as Drink',type=>{
  expect(kindForType(type)).toBe('Drink');
 });
 it.each(['Cigarettes','Nicotine pouches'])('recognizes %s as Other',type=>{
  expect(kindForType(type)).toBe('Other');
 });
 it('does not invent a broad category for an unknown custom type or no type',()=>{
  expect(kindForType('My custom category')).toBeNull();expect(kindForType(null)).toBeNull();
 });
 it('hides incompatible known types while keeping custom templates available',()=>{
  const types=['Pizza','Bubble tea','Cigarettes','Our cantine'];
  expect(typesForKind(types,'Food')).toEqual(['Pizza','Our cantine']);
  expect(typesForKind(types,'Drink')).toEqual(['Bubble tea','Our cantine']);
  expect(typesForKind(types,'Other')).toEqual(['Cigarettes','Our cantine']);
 });
});

import {createRatingSchema} from '../src/domain/validation';
describe('new review classification boundary',()=>{
 const base={groupId:'11111111-1111-4111-8111-111111111111',photoId:'22222222-2222-4222-8222-222222222222',name:'Lunch',brand:'Cantine',score:8};
 it('accepts generic Food with no detailed type',()=>{expect(createRatingSchema.parse({...base,broadCategory:' food '}).broadCategory).toBe('Food');});
 it('rejects an explicit contradictory type',()=>{expect(createRatingSchema.safeParse({...base,broadCategory:'Food',type:'Bubble tea'}).success).toBe(false);});
 it('preserves old clients and authoritative linked items',()=>{expect(createRatingSchema.safeParse(base).success).toBe(true);expect(createRatingSchema.safeParse({...base,itemId:'33333333-3333-4333-8333-333333333333',broadCategory:'Food',type:'Bubble tea'}).success).toBe(true);});
});
