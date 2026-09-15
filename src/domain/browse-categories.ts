import {canonicalItemType} from './item-types';

/** Broader browsing groups preserve each item's specific dish label and identity. */
const groups:Record<string,readonly string[]>={
  'Desserts & pastries':['Desserts','Cakes','Cheesecake','Cookies','Donuts','Pastries','Ice cream','Pancakes','Crepes','Sticky Toffee Pudding'],
  Snacks:['Snacks','Chips','Pretzels','Jerky','Salami','Protein bars'],
  'Sandwiches & wraps':['Sandwiches','Wraps','Gyros','Lobster roll','Fajitas','Burritos','Quesadilla','Quesadillas'],
  'Chicken dishes':['Chicken wings','Chicken and Waffles','Fried chicken','Sesame Chicken','Sweet and Sour Chicken'],
  'Pizza & calzones':['Pizza','Calzones'],
  'Fries & loaded fries':['Fries','Loaded fries','Poutine','Tater tots'],
  'Soft drinks & shakes':['Soft drinks','Lemonade','Refreshers','Milkshakes'],
  'Spirits & cocktails':['Cocktail','Cocktails','Peppermint liqueur','Spirits','Liqueurs'],
  Seafood:['Seafood','Fish and chips'],
  'Rice dishes':['Rice dishes','Jambalaya'],
  Nicotine:['Nicotine','Cigarettes','Nicotine pouches'],
};
const parents=new Map(Object.entries(groups).flatMap(([parent,children])=>[parent,...children].map(child=>[canonicalItemType(child).toLowerCase(),parent] as const)));

export function browseCategory(type:string|null):string|null{
  if(!type?.trim())return null;
  const canonical=canonicalItemType(type);
  return parents.get(canonical.toLowerCase())??canonical;
}

/** Empty string means everything; null selects items without a category. */
export function matchesBrowseCategory(type:string|null,selected:string|null):boolean{
  return selected===''||browseCategory(type)===browseCategory(selected);
}
