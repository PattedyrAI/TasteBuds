import {describe,expect,it} from 'vitest';
import {trackSecret} from '../src/components/matthew-mode';

const type=(keys:string[])=>keys.reduce((s,k)=>{const r=trackSecret(s.buffer,k);return {buffer:r.buffer,matched:s.matched||r.matched};},{buffer:'',matched:false});

describe('Matthew mode secret',()=>{
  it('matches MATTHEW in any case, even after other letters',()=>{
    expect(type([...'MATTHEW']).matched).toBe(true);
    expect(type([...'matthew']).matched).toBe(true);
    expect(type([...'xyzMaTtHeW']).matched).toBe(true);
  });
  it('matches when the word starts again partway through',()=>{
    expect(type([...'MATTMATTHEW']).matched).toBe(true);
  });
  it('ignores named keys such as Shift between letters',()=>{
    expect(type(['Shift','M','Shift','A','T','CapsLock','T','H','E','W']).matched).toBe(true);
  });
  it('resets on typed non-letters and does not match other words',()=>{
    expect(type([...'MATT HEW']).matched).toBe(false);
    expect(type([...'MATHEW']).matched).toBe(false);
  });
  it('clears the buffer after a match so the next toggle needs the full word',()=>{
    const first=type([...'MATTHEW']);
    expect(first.buffer).toBe('');
    expect(trackSecret('ATTHEW','W').matched).toBe(false);
  });
});

describe('other secret words',()=>{
  it('matches a custom secret such as MCLAREN',()=>{
    const r=[...'mclaren'].reduce((s,k)=>{const n=trackSecret(s.buffer,k,'MCLAREN');return {buffer:n.buffer,matched:s.matched||n.matched};},{buffer:'',matched:false});
    expect(r.matched).toBe(true);
  });
});
