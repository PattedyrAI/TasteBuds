import {describe,it,expect} from 'vitest';
import {energyDrinkBrands,energyDrinkModels,energyDrinkSuggestion,isEnergyDrinkCategory,isSugarfree} from '../src/domain/energy-drinks';

const drink=(id:string,name:string,brand:string|null,extra:{variant?:string|null;type?:string|null;tastingCount?:number}={})=>({id,name,brand,variant:extra.variant??null,type:extra.type===undefined?'Energy drinks':extra.type,tastingCount:extra.tastingCount??1});
const items=[
  drink('1','Ultra White','Monster',{tastingCount:5}),
  drink('2','Mango Loco','Monster',{tastingCount:2}),
  drink('3','Zero Sugar','Monster',{variant:'Sugarfree'}),
  drink('4','Juneberry','Red Bull',{tastingCount:3}),
  drink('5','Winter Edition','Redbull',{variant:'Iced Vanilla Berry'}),
  drink('6','Red Bull Watermelon',null),
  drink('7','Monster Burger','Monster Diner',{type:'Burgers'}),
  drink('8','Pipeline Punch','Monster',{type:'Soft drinks'}),
];

describe('energy drink category',()=>{
  it('recognises every spelling of the category and nothing else',()=>{
    for(const type of ['Energy drinks','energy drink','  Energy Drinks '])expect(isEnergyDrinkCategory(type)).toBe(true);
    for(const type of ['Soft drinks','',null,undefined])expect(isEnergyDrinkCategory(type)).toBe(false);
  });
  it('treats sugar-free labels as the one variant toggle',()=>{
    for(const variant of ['Sugarfree','Sugar-free','sugar free','Zero','Zero Sugar','No sugar','Sukkerfri'])expect(isSugarfree(variant)).toBe(true);
    for(const variant of ['Mango','Original','Zeroed In',null,''])expect(isSugarfree(variant)).toBe(false);
  });
});

describe('brand lookup',()=>{
  it('lists only energy drink brands, most tried first, merging spelling variants',()=>{
    expect(energyDrinkBrands(items,'')).toEqual(['Monster','Red Bull']);
  });
  it('filters as you type, ignoring case and spaces',()=>{
    expect(energyDrinkBrands(items,'mon')).toEqual(['Monster']);
    expect(energyDrinkBrands(items,'redb')).toEqual(['Red Bull']);
    expect(energyDrinkBrands(items,'celsius')).toEqual([]);
  });
  it('stops suggesting once a known brand is typed exactly',()=>{
    expect(energyDrinkBrands(items,'monster')).toEqual([]);
    expect(energyDrinkBrands(items,'Redbull')).toEqual([]);
  });
});

describe('model lookup',()=>{
  it('lists the chosen brand’s energy drinks only',()=>{
    expect(energyDrinkModels(items,'Monster','').map(i=>i.id)).toEqual(['1','2','3']);
  });
  it('merges brand spellings and includes older items whose brand is only in the name',()=>{
    expect(energyDrinkModels(items,'red bull','').map(i=>i.id)).toEqual(['4','6','5']);
  });
  it('narrows by every typed word across model and variant',()=>{
    expect(energyDrinkModels(items,'Monster','loco').map(i=>i.id)).toEqual(['2']);
    expect(energyDrinkModels(items,'Red Bull','vanilla').map(i=>i.id)).toEqual(['5']);
    expect(energyDrinkModels(items,'Monster','ultra mango')).toEqual([]);
  });
  it('needs a brand first',()=>{
    expect(energyDrinkModels(items,'  ','ultra')).toEqual([]);
  });
});

describe('AI suggestion mapping',()=>{
  it('keeps a flavour by moving it into the model name',()=>{
    expect(energyDrinkSuggestion('Juiced','Mango Loco')).toEqual({name:'Juiced Mango Loco',sugarfree:false});
  });
  it('turns a sugar-free variant into the toggle without renaming',()=>{
    expect(energyDrinkSuggestion('Ultra','Zero Sugar')).toEqual({name:'Ultra',sugarfree:true});
  });
  it('does not repeat a flavour already in the name',()=>{
    expect(energyDrinkSuggestion('Mango Loco','mango loco')).toEqual({name:'Mango Loco',sugarfree:false});
    expect(energyDrinkSuggestion('Ultra White',null)).toEqual({name:'Ultra White',sugarfree:false});
  });
});
