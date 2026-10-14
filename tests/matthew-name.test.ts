import {describe,expect,it} from 'vitest';
import {isMatthew} from '../src/domain/matthew';

describe('isMatthew',()=>{
  it('matches Matthew in any case or position',()=>{
    for(const name of ['Matthew','matthew','MATTHEW','Matthew R','xXmatthewXx'])expect(isMatthew(name)).toBe(true);
  });
  it('does not match other names, including other Matts',()=>{
    for(const name of ['Matt','Mattias','Matteo','Mathew','Pat','bristiaan','',null,undefined])expect(isMatthew(name)).toBe(false);
  });
});
