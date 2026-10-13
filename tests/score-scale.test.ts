import {describe,it,expect} from 'vitest';
import {scoreBand,scoreLabel,scoreAgreement} from '../src/domain/score-scale';
import {sectionFor,distinctTypes} from '../src/domain/category-taxonomy';
describe('score scale',()=>{
 it('places boundaries in the higher band and keeps 10 special',()=>{
  expect([1,3.9,4,5.9,6,7.4,7.5,8.9,9,9.9].map(s=>scoreBand(s).tier)).toEqual(['skip','skip','meh','meh','good','good','great','great','outstanding','outstanding']);
  expect(scoreLabel(10)).toBe('All-time favourite');expect(scoreLabel(9.9)).toBe('Outstanding');
 });
 it('describes agreement only when at least two people scored',()=>{
  expect(scoreAgreement([8])).toBeNull();
  expect(scoreAgreement([8,9]))?.toEqual({spread:1,label:'Everyone agrees'});
  expect(scoreAgreement([3,9])?.label).toBe('Divided opinions');
 });
});
describe('category taxonomy',()=>{
 it('puts known types, grouped types and placeholder labels in a section',()=>{
  expect(sectionFor('Burgers')).toBe('Food');expect(sectionFor('Energy drinks')).toBe('Drinks');
  expect(sectionFor('Sticky Toffee Pudding')).toBe('Food');expect(sectionFor('Nicotine pouches')).toBe('Other');
  expect(sectionFor('Restaurants')).toBe('Food');expect(sectionFor('Drinks')).toBe('Drinks');
 });
 it('falls back to the stored broad kind for custom types and never guesses',()=>{
  expect(sectionFor('Board games','Other')).toBe('Other');expect(sectionFor('Switchel','Drink')).toBe('Drinks');
  expect(sectionFor('Switchel',null)).toBeNull();expect(sectionFor(null,'Food & Drink')).toBeNull();
 });
 it('collapses spellings without inventing types',()=>{
  expect(distinctTypes(['Burger','Burgers',' burgers','Pizza',null,'',undefined,'My thing'])).toEqual(['Burgers','Pizza','My thing']);
 });
});
