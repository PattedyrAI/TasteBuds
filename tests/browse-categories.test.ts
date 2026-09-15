import {describe,it,expect} from 'vitest';
import {browseCategory,matchesBrowseCategory} from '../src/domain/browse-categories';
import {rankCategories,groupFavourites} from '../src/components/catalog-presentation';
import {categoryStyle} from '../src/components/category-style';
import type {Item} from '../src/lib/contracts';

const item=(id:string,type:string,tastingCount:number,raterCount:number,average:number):Item=>({id,type,tastingCount,raterCount,average,name:id,groupId:'g',createdBy:'u',brand:null,variant:null,broadCategory:null,photoId:null,lastRatedAt:null});
describe('broader browsing categories',()=>{
 it('combines small related categories and duplicate spellings',()=>{
  expect(['Cocktail','Cocktails','Peppermint liqueur'].map(browseCategory)).toEqual(Array(3).fill('Spirits & cocktails'));
  expect(['Chicken wings','Sesame Chicken','Sweet and Sour Chicken'].map(browseCategory)).toEqual(Array(3).fill('Chicken dishes'));
  expect(['Calzones','Pizza'].map(browseCategory)).toEqual(Array(2).fill('Pizza & calzones'));
  expect(['Cookies','Ice cream','Sticky Toffee Pudding'].map(browseCategory)).toEqual(Array(3).fill('Desserts & pastries'));
  expect(browseCategory('Loaded fries')).toBe('Fries & loaded fries');
  expect(browseCategory('Lobster roll')).toBe('Sandwiches & wraps');
 });
 it('keeps popular categories, custom labels and unassigned items distinct',()=>{
  for(const type of ['Energy drinks','Mac and cheese','Noodles','Pasta','Tea','Bubble tea','My custom category','constructor','Unsorted'])expect(browseCategory(type)).toBe(type);
  expect(browseCategory(null)).toBeNull();expect(browseCategory(' ')).toBeNull();
  expect(matchesBrowseCategory('Unsorted',null)).toBe(false);
 });
 it('combines tasting counts without merging items or changing their labels or averages',()=>{
  const first=item('Wings','Chicken wings',2,1,9),second=item('Sesame','Sesame Chicken',3,3,7),food=[first,second],before=structuredClone(food);
  const ranked=rankCategories(food);
  expect(ranked).toEqual([{type:'Chicken dishes',tastingCount:5,items:food}]);
  expect(food).toEqual(before);expect(ranked[0].items[0]).toBe(first);
 });
 it('selects every child for collection and podium but never combines their distinct reviewers',()=>{
  const food=[item('Wings','Chicken wings',30,1,10),item('Sesame','Sesame Chicken',3,3,8),item('Sweet and sour','Sweet and Sour Chicken',3,3,7),item('Fries','Fries',3,3,9)];
  const selected=food.filter(i=>matchesBrowseCategory(i.type,'Chicken dishes'));
  expect(selected.map(i=>i.id)).toEqual(['Wings','Sesame','Sweet and sour']);
  expect(groupFavourites(selected).map(i=>i.id)).toEqual(['Sesame','Sweet and sour']);
  expect(matchesBrowseCategory(null,'')).toBe(true);
  expect(matchesBrowseCategory(null,null)).toBe(true);
 });
 it('uses stable parent labels and matching colours for each child',()=>{
  for(const type of ['Sesame Chicken','Cocktail','Pastries','Calzones','Loaded fries','Protein bars']){
   const parent=browseCategory(type);expect(browseCategory(parent)).toBe(parent);
   expect(categoryStyle(type)).toEqual(categoryStyle(parent));
  }
 });
});
