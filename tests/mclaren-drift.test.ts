import {describe,expect,it} from 'vitest';
import {frameFor} from '../src/components/mclaren-drift';

const d=Math.PI/180;
describe('McLaren turntable frame',()=>{
  it('maps headings to the 8 turntable frames',()=>{
    expect(frameFor(0)).toBe(0);          // side, facing right
    expect(frameFor(45*d)).toBe(1);       // three-quarter front right
    expect(frameFor(90*d)).toBe(2);       // front
    expect(frameFor(180*d)).toBe(4);      // side, facing left
    expect(frameFor(270*d)).toBe(6);      // rear
    expect(frameFor(-45*d)).toBe(7);      // three-quarter rear right
    expect(frameFor(-22*d)).toBe(0);
    expect(frameFor(-23*d)).toBe(7);
    expect(frameFor(725*d)).toBe(0);
  });
});
