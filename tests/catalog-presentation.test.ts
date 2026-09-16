import {describe,it,expect} from 'vitest';
import {categoryStyle,categoryTone} from '../src/components/category-style';
import type {Item} from '../src/lib/contracts';
import {brandKey,featuredBrands,rankCategories,visibleCategories,groupFavourites,discordAvatarUrl} from '../src/components/catalog-presentation';
const item=(id:string,type:string|null,tastingCount:number,raterCount=1,average:number|null=8):Item=>({id,name:id,type,tastingCount,raterCount,average,groupId:'g',createdBy:'u',brand:null,variant:null,broadCategory:null,photoId:null,lastRatedAt:null});
describe('collection presentation',()=>{
 it('ranks categories by summed tastings rather than item count and breaks ties by name',()=>{
  const ranked=rankCategories([item('1','Tea',9),item('2','Tea',8),item('3','Coffee',16),item('4','Apple',16),item('5',null,2),item('6','Unsorted',1)]);
  expect(ranked.map(c=>[c.type,c.tastingCount,c.items.length])).toEqual([['Tea',17,2],['Apple',16,1],['Coffee',16,1],[null,2,1],['Unsorted',1,1]]);
 });
 it('shows five, retains a selected lower category including null, and expands every category',()=>{
  const ranked=rankCategories(['A','B','C','D','E','F',null].map((t,n)=>item(String(n),t,10-n)));
  expect(visibleCategories(ranked,false,'').length).toBe(5);
  expect(visibleCategories(ranked,false,'F').map(c=>c.type)).toEqual(['A','B','C','D','E','F']);
  expect(visibleCategories(ranked,false,null).at(-1)?.type).toBe(null);
  expect(visibleCategories(ranked,true,'').length).toBe(7);
 });
 it('requires three distinct raters, regardless of repeats or score, without changing averages',()=>{
  expect(groupFavourites([item('Solo','Tea',50,1,10),item('Two','Tea',20,2,9.9),item('Three','Tea',3,3,7.25),item('Four','Tea',4,4,8),item('No score','Tea',3,3,null)]).map(i=>[i.id,i.average])).toEqual([['Four',8],['Three',7.25]]);
 });
});
describe('Discord avatar URL policy',()=>{
 it('accepts Discord avatar and default avatar images',()=>{
  expect(discordAvatarUrl('https://cdn.discordapp.com/avatars/123/abc.png?size=128')).toBeTruthy();
  expect(discordAvatarUrl('https://media.discordapp.net/avatars/123/a_abc.gif')).toBeTruthy();
  expect(discordAvatarUrl('https://cdn.discordapp.com/embed/avatars/2.png')).toBeTruthy();
 });
 it('rejects arbitrary hosts, credentials, ports, unsafe schemes and other Discord paths',()=>{
  for(const url of [null,'','http://cdn.discordapp.com/avatars/123/a.png','https://evil.example/a.png','https://cdn.discordapp.com.evil.example/avatars/1/a.png','https://u@cdn.discordapp.com/avatars/1/a.png','https://cdn.discordapp.com:444/avatars/1/a.png','https://cdn.discordapp.com/attachments/123/a.png','data:image/svg+xml,test'])expect(discordAvatarUrl(url)).toBeNull();
 });
});

describe('category colours',()=>{
 it('keeps category colours stable across case and fallback labels',()=>{
  expect(categoryTone('Energy drinks')).toBe('lime');
  expect(categoryStyle(' energy DRINKS ')).toEqual(categoryStyle('Energy drinks'));
  expect(categoryTone('Mac and cheese')).toBe('amber');
  expect(categoryStyle('Unknown dish')).toEqual(categoryStyle('Unknown dish'));
  expect(categoryTone(null)).toBe('slate');
 });
 it('can rank a category independently from the overall top ten',()=>{
  const foods=[...Array.from({length:12},(_,n)=>item('Drink '+n,'Energy drinks',3,3,9)),item('Mac','Mac and cheese',3,3,7)];
  expect(groupFavourites(foods).some(i=>i.id==='Mac')).toBe(false);
  expect(groupFavourites(foods.filter(i=>i.type==='Mac and cheese'))[0].id).toBe('Mac');
 });
});

describe('featured brand filters',()=>{
 const branded=(id:string,brand:string|null,type='Energy drinks',count=1,average:number|null=8)=>({...item(id,type,count,1,average),brand});
 it('requires three distinct rated products and ignores repeats, blank brands and unrated items',()=>{
  const one=branded('one','Monster','Energy drinks',50);
  expect(featuredBrands([one,one,branded('two','Monster')])).toEqual([]);
  expect(featuredBrands([one,branded('two','Monster'),branded('three','Monster'),branded('unrated','Battery','Energy drinks',0),branded('blank','  '),branded('none',null)])).toEqual([{key:'monster',name:'Monster',itemCount:3}]);
 });
 it('combines case and spacing differences and orders brands by product count',()=>{
  const items=[branded('a','Red Bull'),branded('b',' red  bull '),branded('c','RED BULL'),...Array.from({length:4},(_,i)=>branded('m'+i,'Monster'))];
  expect(featuredBrands(items).map(b=>[b.name,b.itemCount])).toEqual([['Monster',4],['Red Bull',3]]);
  expect(items.filter(i=>brandKey(i.brand)==='red bull')).toHaveLength(3);
 });
 it('uses the selected category for qualification and keeps the three-person podium rule',()=>{
  const items=[branded('a','Battery'),branded('b','Battery'),branded('c','Battery','Candy')];
  expect(featuredBrands(items)).toHaveLength(1);
  expect(featuredBrands(items.filter(i=>i.type==='Energy drinks'))).toEqual([]);
  expect(groupFavourites(items)).toEqual([]);
  expect(groupFavourites([{...items[0],raterCount:3},...items.slice(1)]).map(i=>i.id)).toEqual(['a']);
 });
});
