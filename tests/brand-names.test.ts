import {describe,expect,it} from 'vitest';
import {assertFrozenBrandPlanTarget,buildBrandNamePlan,normalizeLeadingBrand} from '../scripts/plan-brand-names';
import {identityKey} from '../src/domain/ratings';

function item(name:string,extra:Record<string,unknown>={}){
  const row={id:'item-1',groupId:'group-1',name,brand:null,brandId:null,variant:null,type:'Energy drinks',typeId:'type-1',createdAt:'2026-09-15T12:00:00.123456Z',manualEdit:false,artifact:false,...extra};
  return {...row,identityKey:identityKey(row.name,row.brand as string|null,row.variant as string|null)};
}
describe('literal brand/name dry planner',()=>{
  it('extracts a leading drink brand and preserves model words and exact guards',()=>{
    const original=item('Monster Ultra Peachy Keen',{variant:'500 ml'});
    const before=JSON.stringify(original);
    const plan=buildBrandNamePlan([original]);
    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0]).toMatchObject({itemId:original.id,groupId:original.groupId,guard:{name:original.name,brand:null,brandId:null,variant:'500 ml',identityKey:original.identityKey,type:original.type,typeId:original.typeId,createdAt:original.createdAt},proposed:{name:'Ultra Peachy Keen',brand:'Monster',identityKey:identityKey('Ultra Peachy Keen','Monster','500 ml')},provenance:{rule:'literal-prefix-v1',matchedPrefix:'Monster',typeContext:'Energy drinks',photoEvidence:false}});
    expect(JSON.stringify(original)).toBe(before);
  });
  it.each(['Redbull','Red Bull','RED BULL'])('recognizes the %s alias without changing the product spelling',prefix=>{
    const proposal=buildBrandNamePlan([item(`${prefix} Winter Edition Iced Gummy Bear`)]).proposals[0];
    expect(proposal?.proposed).toMatchObject({brand:'Red Bull',name:'Winter Edition Iced Gummy Bear'});
  });
  it('removes repeated known brands while preserving matching explicit brand and variant',()=>{
    const proposal=buildBrandNamePlan([item('Battery Fresh Exotic Fruit',{brand:'Battery',brandId:'brand-1',variant:'Zero sugar'})]).proposals[0];
    expect(proposal?.proposed).toEqual({name:'Fresh Exotic Fruit',brand:'Battery',identityKey:identityKey('Fresh Exotic Fruit','Battery','Zero sugar')});
  });
  it('does not overwrite conflicting explicit brands',()=>{
    const plan=buildBrandNamePlan([item('Monster Ultra Peachy Keen',{brand:'Another maker',brandId:'brand-2'})]);
    expect(plan.proposals).toEqual([]);
    expect(plan.review[0]?.reason).toBe('conflicting_explicit_brand');
  });
  it('extracts White Claw only in the observed Hard seltzer context',()=>{
    const plan=buildBrandNamePlan([item('White Claw Mango',{type:'Hard seltzer'})]);
    expect(plan.proposals[0]?.proposed).toEqual({name:'Mango',brand:'White Claw',identityKey:identityKey('Mango','White Claw',null)});
    expect(buildBrandNamePlan([item('White Claw Mango',{type:'Energy drinks'})]).proposals).toEqual([]);
    expect(buildBrandNamePlan([item('White Claw',{type:'Hard seltzer'})]).proposals).toEqual([]);
  });
  it.each(['Monster','Red Bull','Redbull','Battery'])('does not empty a brand-only title %s',name=>{
    const plan=buildBrandNamePlan([item(name)]);
    expect(plan.proposals).toEqual([]);expect(plan.review[0]?.reason).toBe('brand_only_name');
  });
  it('rejects nonleading substrings, lookalike words, unknown brands and generic first words',()=>{
    for(const name of ['budget white monster','Monsterish Ultra','Redbulldog Berry','C40 Cosmic Rainbow','Fully Charged Mango Coconut','Tropical Citrus Energy Drink Mix']){
      expect(buildBrandNamePlan([item(name)]).proposals).toEqual([]);
    }
  });
  it('rejects a drink prefix on a dish even with a mistaken Energy drinks type',()=>{
    expect(buildBrandNamePlan([item('Monster Burger',{type:'Burgers'})]).proposals).toEqual([]);
    expect(buildBrandNamePlan([item('Monster Burger')]).proposals).toEqual([]);
    expect(buildBrandNamePlan([item('Monster Hard Beast Peach Perfect',{brand:'Monster',type:'Hard seltzer'})]).proposals[0]?.proposed.name).toBe('Hard Beast Peach Perfect');
  });
  it('rejects flagged artifacts and manually edited items',()=>{
    for(const extra of [{artifact:true},{manualEdit:true}])expect(buildBrandNamePlan([item('Monster Ultra Sunrise',extra)]).proposals).toEqual([]);
    expect(buildBrandNamePlan([item('Ghost always cooks')]).proposals).toEqual([]);
  });
  it.each([
    ["Cheetos Mac 'N Cheese Flamin' Hot",'Cheetos',"Mac 'N Cheese Flamin' Hot"],
    ['Devour Cordon Bleu Mac and Cheese','Devour','Cordon Bleu Mac and Cheese'],
    ['M&S Macaroni Cheese','M&S','Macaroni Cheese'],
    ["Trader Joe's Shells and White Cheddar","Trader Joe's",'Shells and White Cheddar'],
    ['Velveeta Shells and Cheese','Velveeta','Shells and Cheese'],
    ['Cabot Seriously Sharp Shells and Cheese','Cabot','Seriously Sharp Shells and Cheese'],
    ['Kraft Mac and Cheese','Kraft','Mac and Cheese'],
  ])('extracts the vetted packaged food prefix in %s',(name,brand,remainder)=>{
    expect(buildBrandNamePlan([item(name,{type:'Mac and cheese'})]).proposals[0]?.proposed).toMatchObject({brand,name:remainder});
  });
  it('leaves ingredients, licensed characters and restaurant suffixes for image review',()=>{
    for(const name of ['Guinness Macaroni and Cheese',"Paw Patrol Mac N' Cheese",'Mac and Cheese Chicken Biscuit (Bojangles)'])expect(buildBrandNamePlan([item(name,{type:'Mac and cheese'})]).proposals).toEqual([]);
  });
  it('flags collisions with existing or other proposed identities without merging',()=>{
    const existing=item('Ultra Sunrise',{id:'item-2',brand:'Monster'});
    const plan=buildBrandNamePlan([item('Monster Ultra Sunrise'),existing]);
    expect(plan.proposals).toEqual([]);expect(plan.review.find((row:any)=>row.itemId==='item-1')?.reason).toBe('identity_collision');
    const repeated=buildBrandNamePlan([item('Redbull Winter'),item('Red Bull Winter',{id:'item-2'})]);
    expect(repeated.proposals).toEqual([]);expect(repeated.review.filter((row:any)=>row.reason==='identity_collision')).toHaveLength(2);
  });
  it('keeps independent identities in different groups and preserves rerun idempotence',()=>{
    const plan=buildBrandNamePlan([item('Monster Ultra Sunrise'),item('Ultra Sunrise',{id:'item-2',groupId:'group-2',brand:'Monster'})]);
    expect(plan.proposals).toHaveLength(1);
    const applied=item(plan.proposals[0].proposed.name,{brand:plan.proposals[0].proposed.brand});
    expect(buildBrandNamePlan([applied]).proposals).toEqual([]);
  });
  it('exposes a pure normalization helper and preserves separators inside product names',()=>{
    expect(normalizeLeadingBrand({name:'  Redbull: Winter Apple-Ginger  ',brand:'Red Bull',type:'Energy drinks'})).toMatchObject({ok:true,name:'Winter Apple-Ginger',brand:'Red Bull'});
  });
  it('restricts database access to the frozen local import target without URL overrides',()=>{
    expect(()=>assertFrozenBrandPlanTarget('postgresql://127.0.0.1:55439/everrate_import_test')).not.toThrow();
    for(const target of ['postgresql://example.com/everrate_import_test','postgresql://localhost/everrate_restore_test','postgresql://localhost/everrate_import_test?host=example.com','postgresql://localhost/everrate_import_test?dbname=production'])expect(()=>assertFrozenBrandPlanTarget(target)).toThrow();
  });
});
