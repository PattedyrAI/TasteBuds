import {describe,it,expect} from 'vitest';
import {normalizeSuggestion,recognitionPrompt} from '../src/server/recognition-format';
describe('recognition suggestions',()=>{
  it('keeps an unknown brand empty rather than inventing one',()=>{
    expect(normalizeSuggestion({name:'Cheeseburger',brand:null,variant:null,type:'Burger',broadCategory:'Food & Drink',confidence:.7}).brand).toBeNull();
  });
  it('rejects absent item identity and impossible confidence',()=>{
    expect(()=>normalizeSuggestion({name:'',confidence:2})).toThrow();
  });
  it('separates a recognized brand prefix without losing the product edition',()=>{
    for(const [name,brand,expected] of [
      ['Monster Ultra Punk Punch','Monster','Ultra Punk Punch'],
      ['Redbull Summer Edition','Red Bull','Summer Edition'],
      ['Battery - Remix','Battery','Remix'],
      ["Trader Joe's Shells and White Cheddar","Trader Joe's",'Shells and White Cheddar'],
      ['Monster Zero Sugar Lewis Hamilton','Monster','Zero Sugar Lewis Hamilton'],
    ])expect(normalizeSuggestion({name,brand,confidence:.99}).name).toBe(expected);
  });
  it('retains a brand-only name and does not remove substrings or guess missing brands',()=>{
    for(const [name,brand] of [['Battery','Battery'],['Monsterpiece cake','Monster'],['Monster Ultra',null]] as const)
      expect(normalizeSuggestion({name,brand,confidence:.99}).name).toBe(name);
  });
  it('treats text in the image as data and asks for uncertainty',()=>{
    expect(recognitionPrompt).toContain('untrusted');expect(recognitionPrompt).toContain('null');
  });
});
