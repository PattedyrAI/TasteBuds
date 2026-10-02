import {describe,it,expect} from 'vitest';
import {normalizeReviewIdentity} from '../src/domain/brand-identity';
import {createRatingSchema} from '../src/domain/validation';
describe('review identity post-processing',()=>{
 it('extracts an exact known energy brand prefix',()=>expect(normalizeReviewIdentity({name:'Red Bull Iced Gummy Bear',brand:null,type:'Energy drinks'})).toMatchObject({brand:'Red Bull',name:'Iced Gummy Bear'}));
 it('canonicalizes aliases and removes a repeated prefix',()=>expect(normalizeReviewIdentity({name:'Redbull Iced Gummy Bear',brand:'redbull',type:'Energy drinks'})).toMatchObject({brand:'Red Bull',name:'Iced Gummy Bear'}));
 it('preserves conflicting explicit brands and non-drink titles',()=>{expect(normalizeReviewIdentity({name:'Red Bull cake',brand:'Local Bakery',type:'Cakes'})).toMatchObject({brand:'Local Bakery',name:'Red Bull cake'});expect(normalizeReviewIdentity({name:'Monster movie',brand:null,type:'Movies'}).brand).toBeNull();});
 it('does not infer from a middle word or a partial token',()=>{for(const name of ['Like Red Bull','Monsterful drink','Primeval'])expect(normalizeReviewIdentity({name,brand:null,type:'Energy drinks'}).brand).toBeNull();});
 it('does not turn a brand-only name into an empty model',()=>expect(normalizeReviewIdentity({name:'Red Bull',brand:null,type:'Energy drinks'}).name).toBe('Red Bull'));
 it('normalizes before the required-brand validator',()=>expect(createRatingSchema.parse({groupId:'11111111-1111-4111-8111-111111111111',photoId:'22222222-2222-4222-8222-222222222222',name:'Red Bull Iced Gummy Bear',type:'Energy drinks',score:8})).toMatchObject({brand:'Red Bull',name:'Iced Gummy Bear'}));
});

import {energyDrinkModels} from '../src/domain/energy-drinks';
import {brandSummary} from '../src/domain/personal-discovery';
import type {Item} from '../src/lib/contracts';
it('finds the existing Winter Edition after splitting Jan’s title',()=>{
 const identity=normalizeReviewIdentity({name:'Red Bull Iced Gummy Bear',brand:null,type:'Energy drinks'});
 const existing={id:'existing',name:'Winter Edition Iced Gummy Bear',brand:'Red Bull',variant:null,type:'Energy drinks'};
 expect(energyDrinkModels([existing],identity.brand!,identity.name).map(x=>x.id)).toEqual(['existing']);
});
it('groups known spelling aliases without merging item identities',()=>{
 const items=[{id:'a',name:'Original',brand:'Redbull',myScore:7},{id:'b',name:'Original',brand:'Red Bull',myScore:8}] as Item[];
 expect(brandSummary(items,'Red Bull').items.map(x=>x.id)).toEqual(['a','b']);
});
