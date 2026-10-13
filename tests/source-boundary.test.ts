import {describe,it,expect} from 'vitest';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';

/** The production image contains only src/ and public/. Anything src imports from elsewhere breaks the release build. */
const root=resolve(__dirname,'..'),src=join(root,'src');
const files=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?files(path):/\.(ts|tsx)$/.test(name)?[path]:[];});
describe('source boundary',()=>{
  it('keeps every relative import inside src',()=>{
    const escapes=files(src).flatMap(file=>[...readFileSync(file,'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map(match=>resolve(file,'..',match[1])).filter(target=>relative(src,target).startsWith('..')).map(target=>`${relative(root,file)} -> ${relative(root,target)}`));
    expect(escapes).toEqual([]);
  });
});
