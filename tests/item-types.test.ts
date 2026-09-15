import {describe,expect,it} from 'vitest';
import {canonicalItemType} from '../src/domain/item-types';
import {normalizeSuggestion} from '../src/server/recognition-format';

describe('shared subcategories',()=>{
  it('groups equivalent dish and drink names',()=>{
    expect(['Energy drink','energy drinks'].map(canonicalItemType)).toEqual(['Energy drinks','Energy drinks']);
    expect(['Burger','Cheeseburgers'].map(canonicalItemType)).toEqual(['Burgers','Burgers']);
    expect(['Mac & cheese','Macaroni and cheese'].map(canonicalItemType)).toEqual(['Mac and cheese','Mac and cheese']);
    expect(['Sandwich','Sandwiches'].map(canonicalItemType)).toEqual(['Sandwiches','Sandwiches']);
    expect(canonicalItemType('Ramen')).toBe('Noodles');
    expect(canonicalItemType('Buffalo wings')).toBe('Chicken wings');
    expect(['Gyro','Gyros'].map(canonicalItemType)).toEqual(['Gyros','Gyros']);
    expect(['Protein bar','Protein bars'].map(canonicalItemType)).toEqual(['Protein bars','Protein bars']);
    expect(canonicalItemType('Soup Dumplings')).toBe('Dumplings');
    expect(canonicalItemType('Veggie burgers')).toBe('Burgers');
  });
  it('preserves custom categories and distinct dishes',()=>{
    expect(canonicalItemType('  Schnitzel  ')).toBe('Schnitzel');
    expect(canonicalItemType('Pasta')).toBe('Pasta');
    expect(canonicalItemType('constructor')).toBe('constructor');
    expect(canonicalItemType('Constructor')).toBe('Constructor');
  });
  it('allows category recognition with no brand or restaurant',()=>{
    expect(normalizeSuggestion({name:'Cheeseburger',brand:null,variant:null,type:'Burger',broadCategory:'Food & Drink',confidence:.97})).toMatchObject({brand:null,type:'Burgers'});
  });
});
