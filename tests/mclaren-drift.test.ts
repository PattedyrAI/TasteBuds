import {describe,expect,it} from 'vitest';
import {ROUTINES,frameFor,pose} from '../src/components/mclaren-drift';

const d=Math.PI/180;
const wrap=(a:number)=>((a%(2*Math.PI))+3*Math.PI)%(2*Math.PI)-Math.PI;

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

describe('drift routines are continuous',()=>{
  for(const routine of ROUTINES)for(const mirror of [false,true])for(const w of [195,720])
    it(`${routine.name}, ${mirror?'right to left':'left to right'}, ${w} wide`,()=>{
      let prev=pose(routine,0,w,mirror),worstTurn=0,worstFrameStep=0;
      for(let i=1;i<=1000;i++){
        const p=pose(routine,i/1000,w,mirror);
        worstTurn=Math.max(worstTurn,Math.abs(wrap(p.heading-prev.heading))/d);
        const step=Math.abs(frameFor(p.heading)-frameFor(prev.heading));
        worstFrameStep=Math.max(worstFrameStep,Math.min(step,8-step));
        prev=p;
      }
      // The car never snaps round: no jump bigger than 6° between samples, and never skips an angle.
      expect(worstTurn).toBeLessThan(6);
      expect(worstFrameStep).toBeLessThanOrEqual(1);
      // It enters and leaves straight, nose along the direction it is driving, fully off-screen.
      const facing=mirror?Math.PI:0;
      for(const u of [0,1]){
        const p=pose(routine,u,w,mirror);
        expect(Math.abs(p.slip)/d).toBeLessThan(.5);
        expect(Math.abs(wrap(p.heading-facing))/d).toBeLessThan(3);
      }
      const enter=pose(routine,0,w,mirror).x,exit=pose(routine,1,w,mirror).x;
      expect(mirror?enter>w+55&&exit<-55:enter<-55&&exit>w+55).toBe(true);
    });
});
