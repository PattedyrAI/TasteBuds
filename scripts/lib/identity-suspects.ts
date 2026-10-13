import {canonicalBrand,normalizeReviewIdentity} from '../../src/domain/brand-identity';
import {canonicalItemType} from '../../src/domain/item-types';
import type {PhotoIdentity} from '../analyze-photo-identities';

export const IDENTITY_CONFIDENCE_THRESHOLD=.9;
export type IdentityInput={name:string;brand:string|null;type:string|null};
export type IdentityReason='first_name_token'|'non_product_token'|'member_name_collision'|'energy_brand_unrecognized'|'photo_brand_missing'|'photo_brand_disagreement'|'photo_name_disagreement'|'photo_evidence_incomplete'|'photo_evidence_conflicting'|'photo_evidence_unverified';
export type IdentityFlag={code:IdentityReason;severity:'high'|'medium'|'low'};
/** Same punctuation/token normalization used by the photo evidence grouper; no fuzzy matching. */
export const identityToken=(value:string|null|undefined)=>value?.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()||'';
const firstNames=new Set('lena bob anna anne ben tom john jane sara sarah emma oliver noah liam max leo lucas oscar erik ole per patrick alex sam mike maria nina lisa eva ida mia'.split(' '));
const foodWords=new Set(('gnocchi tostones cheesesteak burrito burritos pho taco tacos ramen ramyeon pizza burger burgers hamburger cheeseburger pasta spaghetti macaroni noodles noodle soup soups salad salads sandwich sandwiches gyro gyros dumpling dumplings cake cakes donut donuts doughnut pretzel crepe calzone pastry pastries egg eggs milkshake refresher wings chicken cheese fries chips crisps coffee tea beer soda cola drink drinks energy ice cream chocolate candy protein bar bars biscuit cookie cookies bread rice sushi kebab falafel curry steak fish beef pork bacon sausage juice water milk yogurt yoghurt smoothie lemon lime orange apple mango peach vanilla strawberry raspberry blueberry cherry caramel salt sugar salted sjokolade brus energidrikk kaffe øl is kake ost pølse saft vann potetgull bolle boller kvikk lunsj pepsi monster').split(' '));

/** Remove only an exact leading brand token sequence. Never compare brands by edit distance. */
export function normalizedStoredIdentity(item:IdentityInput):IdentityInput{
  const value=normalizeReviewIdentity(item);
  const name=identityToken(value.name),brand=identityToken(value.brand);
  return {...value,name:brand&&name.startsWith(brand+' ')?name.slice(brand.length+1):name};
}
export function identitySuspectFlags(item:IdentityInput,options:{memberNames?:readonly string[];knownTypeNames?:readonly string[];analysis?:PhotoIdentity|null}={}):IdentityFlag[]{
  const flags:IdentityFlag[]=[],add=(code:IdentityReason,severity:IdentityFlag['severity'])=>flags.push({code,severity});
  const name=identityToken(item.name),tokens=name.split(' '),hasFood=tokens.some(word=>foodWords.has(word));
  // A short unknown word is weak evidence, especially in a multilingual catalog.
  // A name that is just its own category ("Burrito" filed under Burritos) is generic, not a mismatch.
  const knownType=[...(options.knownTypeNames||[]),item.type||''].some(type=>!!type&&identityToken(canonicalItemType(type))===identityToken(canonicalItemType(item.name)));
  if(!canonicalBrand(item.brand)&&!hasFood&&!knownType&&tokens.length===1&&name.length>0&&name.length<=12){
    if(firstNames.has(name))add('first_name_token','medium');
    add('non_product_token','medium');
  }
  if(name&&(options.memberNames||[]).some(member=>identityToken(member)===name))add('member_name_collision','high');
  const normalized=normalizeReviewIdentity(item);
  if(canonicalItemType(item.type||'')==='Energy drinks'){
    // Infer using the existing category-scoped energy-brand list, including aliases.
    const inferred=normalizeReviewIdentity({name:(canonicalBrand(item.brand)||'')+' Product',brand:null,type:'Energy drinks'}).brand;
    const titleBrand=normalizeReviewIdentity({...item,brand:null}).brand;
    // Real but unlisted brands (Ryse, Rip It…) are fine; only a drink with no brand anywhere is suspect.
    if(!inferred&&!titleBrand&&!canonicalBrand(item.brand))add('energy_brand_unrecognized','medium');
  }
  const analysis=options.analysis;
  if(analysis&&!analysis.multipleProducts&&!analysis.ambiguity){
    const stored=normalizedStoredIdentity(normalized);
    const analysed=normalizedStoredIdentity({name:analysis.name||'',brand:analysis.brand,type:analysis.type});
    if(analysis.brand&&analysis.brandConfidence>=IDENTITY_CONFIDENCE_THRESHOLD){
      if(!canonicalBrand(item.brand))add('photo_brand_missing','high');
      else if(identityToken(canonicalBrand(normalized.brand))!==identityToken(canonicalBrand(analysis.brand)))add('photo_brand_disagreement','high');
    }
    if(analysis.name&&analysis.nameConfidence>=IDENTITY_CONFIDENCE_THRESHOLD&&stored.name!==analysed.name)add('photo_name_disagreement','high');
  }
  return flags;
}
