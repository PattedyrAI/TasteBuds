import {canonicalItemType} from './item-types';

// Exact, category-scoped aliases only: a title containing “Monster” is not
// evidence of an energy brand unless it is classified as an energy drink.
const energyBrands=['Red Bull','Monster','Battery','Burn','Celsius','NOCCO','Rockstar','Reign','Ghost','Bang','C4','Prime','Cult','Faxe Kondi','G Fuel','NOS','3D','Alani Nu','Gorilla Mind','Powerking','Relentless','Raptor','VikingSnacks'];
const compact=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s-]+/g,'');
const canonical=new Map(energyBrands.map(name=>[compact(name),name]));
export function canonicalBrand(brand:string|null|undefined):string|null{
 const value=brand?.normalize('NFKC').trim().replace(/\s+/g,' ');
 return value?canonical.get(compact(value))??value:null;
}
function prefix(name:string,brand:string):number{
 // Allow spaces/hyphens between brand words, but require a token boundary.
 const pattern=brand.split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s-]*');
 return new RegExp('^'+pattern+'(?=$|[\\s:–—-])','i').exec(name)?.[0].length??0;
}
export function normalizeReviewIdentity<T extends {name?:string;brand?:string|null;type?:string|null}>(input:T):T{
 const brand=canonicalBrand(input.brand);
 const name=input.name?.trim();
 if(!name||canonicalItemType(input.type||'')!=='Energy drinks')return {...input,brand};
 const inferred=brand??energyBrands.find(candidate=>prefix(name,candidate)>0)??null;
 const length=inferred?prefix(name,inferred):0;
 const model=length?name.slice(length).replace(/^[\s:–—-]+/,''):name;
 return {...input,brand:inferred,name:model||name};
}
