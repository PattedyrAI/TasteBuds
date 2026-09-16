import {describe,it,expect} from 'vitest';
import {filterPersonalItems,brandSummary,categoryChoices,resolveCategoryName} from '../src/domain/personal-discovery';
import type {Item} from '../src/lib/contracts';
const item=(id:string,myScore:number|null,saved=false,brand:string|null='Monster',average:number|null=8):Item=>({id,myScore,saved,brand,average,name:id,groupId:'g',createdBy:'u',variant:null,type:'Energy drinks',broadCategory:null,photoId:'p',raterCount:3,tastingCount:4,lastRatedAt:null});
describe('personal discovery',()=>{
 it('separates untried and saved without changing group averages',()=>{const rows=[item('a',7),item('b',null,true),item('c',9,true)];expect(filterPersonalItems(rows,'untried').map(i=>i.id)).toEqual(['b']);expect(filterPersonalItems(rows,'saved').map(i=>i.id)).toEqual(['b','c']);expect(rows[0].average).toBe(8);});
 it('summarizes the complete brand independently of filters and selects personal favourite',()=>{const rows=[item('a',7,true),item('b',9,false,' monster '),item('c',null,true,'Monster',10),item('d',10,true,'Battery')];expect(brandSummary(rows,'Monster')).toMatchObject({total:3,tried:2,saved:2,favourite:{id:'b'}});});
 it('consolidates category choices and resolves new names to an existing broad category',()=>{expect(categoryChoices(['Cocktail','Cocktails','Energy drinks','energy drinks','Loaded fries',null])).toEqual(['Energy drinks','Fries & loaded fries','Spirits & cocktails']);expect(resolveCategoryName('  energy   DRINKS ',['Energy drinks'])).toBe('Energy drinks');expect(resolveCategoryName('Loaded fries',['Fries'])).toBe('Fries & loaded fries');expect(resolveCategoryName('   ',['Tea'])).toBe('');});
});
