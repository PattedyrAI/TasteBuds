import {describe,expect,it} from 'vitest';
import {runInNewContext} from 'node:vm';
import {matthewModeBootScript,trackModeSecret} from '../src/components/matthew-mode';

function type(word:string){
  let buffer='',mode:string|null=null;
  for(const key of word){const result=trackModeSecret(buffer,key);buffer=result.buffer;if(result.mode)mode=result.mode;}
  return {buffer,mode};
}

describe('Bristian and Matthew secret modes',()=>{
  it('recognizes either name case-insensitively after unrelated letters',()=>{
    expect(type('xyzBrIsTiAn')).toEqual({buffer:'',mode:'bristian'});
    expect(type('xyzMaTtHeW')).toEqual({buffer:'',mode:'matthew'});
    expect(type('BRISBRISTIAN').mode).toBe('bristian');
  });
  it('does not complete a name across punctuation and ignores named keys',()=>{
    expect(type('BRIS TIAN').mode).toBeNull();
    expect(trackModeSecret('BRIS','Shift')).toEqual({buffer:'BRIS',mode:null});
    expect(trackModeSecret('BRISTIA','n')).toEqual({buffer:'',mode:'bristian'});
  });
  it.each([
    [{},undefined],
    [{'tastebuds-matthew-mode':'on'},'matthew'],
    [{'tastebuds-secret-mode':'bristian','tastebuds-matthew-mode':'off'},'bristian'],
    [{'tastebuds-secret-mode':'off','tastebuds-matthew-mode':'on'},undefined],
    [{'tastebuds-secret-mode':'invalid'},undefined],
  ])('restores a valid saved mode before paint (%j)',(storage,expected)=>{
    const root={dataset:{} as Record<string,string>};
    runInNewContext(matthewModeBootScript,{document:{documentElement:root},localStorage:{getItem:(key:string)=>(storage as Record<string,string>)[key]??null}});
    expect(root.dataset.theme).toBe(expected);
  });
  it('tolerates unavailable storage',()=>{
    expect(()=>runInNewContext(matthewModeBootScript,{localStorage:{getItem(){throw Error('blocked');}}})).not.toThrow();
  });
});
