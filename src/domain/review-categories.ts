import {canonicalItemType} from './item-types';

export type ReviewKind='Food'|'Drink'|'Other';
export const reviewKinds:readonly ReviewKind[]=['Food','Drink','Other'];
// Known type labels only. Custom templates need the reviewer's broad choice.
const types:Record<ReviewKind,readonly string[]>={
 Food:['Food','Restaurants','Restaurant','Meals','Lunch','Barbecue ribs','Burgers','Burritos','Cakes','Calzones','Candy','Cheesecake','Chicken and Waffles','Chicken wings','Chips','Cookies','Crepes','Desserts','Donuts','Dumplings','Egg dishes','Fajitas','Fish and chips','Fried chicken','Fried plantains','Fries','Gyros','Ice cream','Jambalaya','Jerky','Loaded fries','Lobster roll','Mac and cheese','Noodles','Pancakes','Pasta','Pastries','Pizza','Poutine','Pretzels','Protein bars','Quesadilla','Quesadillas','Rice dishes','Salads','Salami','Sandwiches','Schnitzel','Seafood','Sesame Chicken','Snacks','Soups','Sticky Toffee Pudding','Sweet and Sour Chicken','Tater tots','Wraps'],
 Drink:['Drink','Drinks','Beer','Bubble tea','Cocktail','Cocktails','Coffee','Energy drinks','Hard seltzer','Lemonade','Liqueurs','Milkshakes','Peppermint liqueur','Refreshers','Soft drinks','Spirits','Tea','Water'],
 Other:['Other','Cigarettes','Nicotine','Nicotine pouches'],
};
const known=new Map(reviewKinds.flatMap(kind=>types[kind].map(type=>[canonicalItemType(type).toLowerCase(),kind] as const)));
export function kindForType(type:string|null|undefined):ReviewKind|null{
 return type?.trim()?known.get(canonicalItemType(type).toLowerCase())??null:null;
}
export function typesForKind(categories:readonly string[],kind:ReviewKind):string[]{
 return categories.filter(type=>{const knownKind=kindForType(type);return knownKind===null||knownKind===kind;});
}
export function broadReviewKind(value:string|null|undefined):ReviewKind|null{
 return reviewKinds.find(kind=>kind.toLowerCase()===value?.trim().toLowerCase())??null;
}
