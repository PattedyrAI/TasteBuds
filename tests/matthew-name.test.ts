import {describe,expect,it} from 'vitest';
import {isMatthew} from '../src/domain/matthew';

describe('isMatthew',()=>{
  it('matches Matthew and Matt',()=>{
    for(const name of ['Matthew','matthew','MATTHEW','Matthew R','xXmatthewXx','Matt','matt b'])expect(isMatthew(name)).toBe(true);
  });
  it('does not match other names',()=>{
    for(const name of ['Mattias','Matteo','Pat','bristiaan','',null,undefined])expect(isMatthew(name)).toBe(false);
  });
});
