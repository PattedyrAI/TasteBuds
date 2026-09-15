import {describe,expect,it} from 'vitest';
import {menuPosition} from '../src/lib/menu-position';
describe('dropdown viewport placement',()=>{
 for(const [name,rect,viewport] of [
  ['desktop below',{left:100,top:510,bottom:560,width:200},{width:1440,height:900}],
  ['near bottom',{left:1250,top:820,bottom:868,width:190},{width:1440,height:900}],
  ['mobile right edge',{left:210,top:240,bottom:288,width:164},{width:390,height:844}],
  ['open mobile keyboard',{left:20,top:280,bottom:328,width:164},{width:390,height:390}],
  ['panned mobile keyboard',{left:20,top:280,bottom:328,width:164},{width:390,height:300,offsetTop:120}],
  ['horizontal zoom pan',{left:30,top:120,bottom:168,width:164},{width:230,height:350,offsetLeft:100,offsetTop:50}],
  ['anchor outside viewport',{left:20,top:800,bottom:848,width:164},{width:390,height:300}],
 ] as const){it(`keeps every edge reachable: ${name}`,()=>{const p=menuPosition(rect,viewport);const top=('offsetTop' in viewport?viewport.offsetTop:0)+16;const left=('offsetLeft' in viewport?viewport.offsetLeft:0)+16;expect(p.left).toBeGreaterThanOrEqual(left);expect(p.left+p.width).toBeLessThanOrEqual(left+viewport.width-32);expect(p.top).toBeGreaterThanOrEqual(top);expect(p.top+p.maxHeight).toBeLessThanOrEqual(top+viewport.height-32);expect(p.maxHeight).toBeGreaterThan(0);});}
});
