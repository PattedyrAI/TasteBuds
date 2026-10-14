import {describe,expect,it} from 'vitest';
import {Burnout,DOOR_FRAME_MS,type CarSpec} from '../src/components/burnout';

const CAR:CarSpec={frames:8,w:56,h:53,hot:{x:2,y:47},wheel:{x:52,y:24,rx:2.5,ry:5},back:{x:.79,y:-.62}};
const origin={x:100,y:100};
/** Runs the engine at 60 fps from `from` to `to` ms. */
const run=(b:Burnout,from:number,to:number)=>{for(let t=from;t<=to;t+=16)b.update(t,origin);};
const smokeCount=(b:Burnout,now:number)=>{const W=200,H=200,px=new Uint32Array(W*H);b.drawSmoke(px,W,H,now,1);return px.reduce((n,v)=>n+(v?1:0),0);};

describe('720S cursor burnout',()=>{
  it('opens the doors one frame at a time, then spins only once they are fully up',()=>{
    const b=new Burnout(CAR);
    b.hover(true,0);
    b.update(DOOR_FRAME_MS*3+1,origin);
    expect(b.frame).toBe(3);
    expect(b.spinning).toBe(false);
    run(b,DOOR_FRAME_MS*3+1,DOOR_FRAME_MS*7+20);
    expect(b.frame).toBe(7);
    expect(b.spinning).toBe(true);
  });

  it('blows smoke behind the car (toward the tail) and lets it fade after leaving',()=>{
    const b=new Burnout(CAR);
    b.hover(true,0);run(b,0,1000);
    expect(smokeCount(b,1000)).toBeGreaterThan(0);
    b.hover(false,1000);run(b,1000,1100);
    expect(b.spinning).toBe(false);
    // Every puff that exists has drifted from the rear wheel along the back vector (right and up on screen).
    const wheelX=origin.x+CAR.wheel.x,wheelY=origin.y+CAR.wheel.y;
    const W=300,H=300,px=new Uint32Array(W*H);b.drawSmoke(px,W,H,1100,1);
    let sx=0,sy=0,n=0;px.forEach((v,i)=>{if(v){sx+=i%W;sy+=Math.floor(i/W);n++;}});
    expect(sx/n).toBeGreaterThan(wheelX);expect(sy/n).toBeLessThan(wheelY+CAR.wheel.ry);
    run(b,1100,3000);
    expect(smokeCount(b,3000)).toBe(0);
    expect(b.frame).toBe(0);
    expect(b.busy).toBe(false);
  });

  it('closes the doors from wherever they were when the pointer leaves mid-opening',()=>{
    const b=new Burnout(CAR);
    b.hover(true,0);b.update(DOOR_FRAME_MS*4+1,origin);
    b.hover(false,DOOR_FRAME_MS*4+1);run(b,DOOR_FRAME_MS*4+1,DOOR_FRAME_MS*10);
    expect(b.frame).toBe(0);
    expect(smokeCount(b,DOOR_FRAME_MS*10)).toBe(0);
  });

  it('snaps the doors and skips the burnout for reduced motion',()=>{
    const b=new Burnout(CAR,true);
    b.hover(true,0);
    expect(b.frame).toBe(7);
    run(b,0,1000);
    expect(b.spinning).toBe(false);
    expect(smokeCount(b,1000)).toBe(0);
  });
});
