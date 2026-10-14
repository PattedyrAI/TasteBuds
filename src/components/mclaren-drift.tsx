'use client';
import {useEffect,useRef} from 'react';
import {trackSecret} from './matthew-mode';

/** Sprite strip: 8 turntable frames of a ChatGPT-drawn McLaren P1, bottom-aligned on a shared ground line. */
const SHEET='/matthew/p1-frames.png';
const FRAMES=8;
const SCALE=2; // 110x50 sprite frames: about 220 CSS px of car
const CLOCK_KEY='tastebuds-p1-clock';
const FIRST_RUN_MS=5*60_000;
const SKID_LIFE_MS=12_000;
const deg=Math.PI/180;

type Vec={x:number;z:number};
export type Pose={x:number;z:number;heading:number;slip:number};
type Routine={name:string;duration:number;at:(u:number,w:number)=>Vec;slip:(u:number,w:number)=>number};

const smooth=(t:number)=>t<=0?0:t>=1?1:t*t*(3-2*t);
/** Piecewise-smooth keyframes: [[u, value], ...]. Zero slope at every key, so slip never jerks. */
function keys(points:[number,number][]){
  return (u:number)=>{
    if(u<=points[0][0])return points[0][1];
    for(let i=1;i<points.length;i++){const [u1,v1]=points[i],[u0,v0]=points[i-1];if(u<=u1)return v0+(v1-v0)*smooth((u-u0)/(u1-u0));}
    return points[points.length-1][1];
  };
}

/**
 * Donut: straight in along +x, two whole turns, straight out along +x. Whole turns keep the exit on the same
 * tangent as the entry; distance follows one smooth speed curve (fast at the edges, slowest mid-donut).
 */
function donut():Routine{
  const r=46,turns=2,ease=.3;
  const parts=(w:number)=>{const cx=w*.5,a=cx+130,b=2*Math.PI*r*turns,c=w+130-cx;return {cx,a,b,total:a+b+c};};
  // Speed 1+ease*cos(2πu - π): fastest at entry and exit, slowest in the middle; continuous everywhere.
  const dist=(u:number,total:number)=>total*(u+ease*Math.sin(2*Math.PI*u-Math.PI)/(2*Math.PI));
  const at=(u:number,w:number):Vec=>{
    const {cx,a,b,total}=parts(w),s=dist(u,total);
    if(s<=a)return {x:-130+s,z:0};
    if(s<=a+b){const t=(s-a)/r;return {x:cx+r*Math.sin(t),z:r*(1-Math.cos(t))};}
    return {x:cx+(s-a-b),z:0};
  };
  // Slip follows the loop itself: ramps in as the car enters it and out before it leaves.
  const slip=(u:number,w:number)=>{
    const {a,b,total}=parts(w),f=dist(u,total);
    const inLoop=smooth((f-(a-60))/90)*(1-smooth((f-(a+b-70))/110));
    return (76+6*Math.sin(f/18))*inLoop;
  };
  return {name:'donut',duration:9400,at,slip};
}

/** Each routine: a ground path (x across the page, z toward the viewer) and a slip angle (nose vs travel). */
export const ROUTINES:Routine[]=[
  {name:'slide',duration:6800,
    at:(u,w)=>({x:-130+(w+260)*(u+.05*Math.sin(2*Math.PI*u)/Math.PI),z:40*Math.sin(Math.PI*u)**2}),
    slip:keys([[0,0],[.14,0],[.24,-50],[.48,-58],[.58,-6],[.66,38],[.76,30],[.88,0],[1,0]])},
  donut(),
  {name:'s-curve',duration:6800,
    at:(u,w)=>({x:-130+(w+260)*u,z:44*Math.sin(Math.PI*u)**2*Math.sin(2*Math.PI*u)}),
    slip:keys([[0,0],[.1,0],[.2,42],[.36,46],[.46,0],[.56,-46],[.72,-50],[.86,0],[1,0]])},
];

/** Where the car is at progress u (0..1) on a page w units wide; mirror runs it right-to-left. */
export function pose(routine:Routine,u:number,w:number,mirror:boolean):Pose{
  const p=routine.at(u,w),e=.0015,a=routine.at(Math.max(0,u-e),w),b=routine.at(Math.min(1,u+e),w);
  let travel=Math.atan2(b.z-a.z,b.x-a.x),x=p.x;
  if(mirror){travel=Math.PI-travel;x=w-p.x;}
  const slip=routine.slip(u,w)*deg*(mirror?-1:1);
  return {x,z:p.z,heading:travel+slip,slip};
}

/** Nearest of the 8 turntable frames for a heading (0 = facing right, +90° = facing the viewer). */
export function frameFor(heading:number){
  const d=((heading/deg)%360+360)%360;
  return Math.round(d/45)%8;
}

// 4x4 Bayer matrix: pixels drop out in a fixed ordered pattern, the classic 8-bit dissolve.
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const visible=(x:number,y:number,keep:number)=>BAYER[(y&3)*4+(x&3)]<keep*16;
/** Packs #rrggbb into the little-endian RGBA word ImageData expects. */
const rgba=(hex:string)=>{const n=parseInt(hex.slice(1),16);return (255<<24|(n&255)<<16|(n>>8&255)<<8|n>>16)>>>0;};
const SKID=[rgba('#15110e'),rgba('#2e261f')],SHADOW=rgba('#0a0807');
const SMOKE={hi:rgba('#f7f4ef'),mid:rgba('#d6d0c7'),lo:rgba('#9d958a')};
const FIRE=[rgba('#fff3a0'),rgba('#ffb347'),rgba('#ff6a1f')];

type Puff={x:number;y:number;vx:number;vy:number;born:number;life:number;r:number;fire:boolean};

/** Runs one drift across the page. Resolves when the car has left and its skidmarks have worn off. */
function runDrift(canvas:HTMLCanvasElement,sheet:HTMLImageElement,signal:{stopped:boolean}){
  return new Promise<void>(resolve=>{
    const W=Math.ceil(window.innerWidth/SCALE),H=Math.ceil(window.innerHeight/SCALE);
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;
    // Ground (skids) and air (smoke) are raw pixel buffers composited under and over the car sprite.
    const layer=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d')!;const img=g.createImageData(W,H);return {c,g,img,px:new Uint32Array(img.data.buffer)};};
    const ground=layer(),air=layer();
    const fw=sheet.naturalWidth/FRAMES,fh=sheet.naturalHeight;
    const routine=ROUTINES[Math.floor(Math.random()*ROUTINES.length)];
    const mirror=Math.random()<.5;
    const baseY=Math.round(H*(.52+Math.random()*.22));
    const skids=new Map<number,number>(); // pixel index -> time laid
    const puffs:Puff[]=[];
    let last:{x:number;y:number}[]|null=null,lastSlip=0,start=0,shown=-1;
    const L=fw*.33,T=11;
    // Tyre track: a 3x2 stamp per Bresenham step, so marks read as rubber rather than hairlines.
    const stamp=(x:number,y:number,now:number)=>{for(let dy=0;dy<2;dy++)for(let dx=-1;dx<2;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<W&&Y<H)skids.set(Y*W+X,now);}};
    const track=(x0:number,y0:number,x1:number,y1:number,now:number)=>{
      x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
      const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let err=dx+dy;
      for(let i=0;i<200;i++){stamp(x0,y0,now);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
    };
    const emit=(x:number,y:number,now:number,r:number)=>puffs.push({x:x+(Math.random()-.5)*4,y:y-1,vx:(Math.random()-.5)*.35,vy:-.1-Math.random()*.22,born:now,life:900+Math.random()*900,r,fire:false});
    const tick=(now:number)=>{
      if(signal.stopped)return resolve();
      if(!start)start=now;
      const u=(now-start)/routine.duration;
      ctx.clearRect(0,0,W,H);
      // Ground: skidmarks dissolve in Bayer steps over their life; the lighter edge pixels go first.
      ground.px.fill(0);
      for(const [i,born] of skids){
        const age=(now-born)/SKID_LIFE_MS;if(age>=1){skids.delete(i);continue;}
        const x=i%W,y=(i/W)|0;if(visible(x,y,1-age))ground.px[i]=SKID[age>.45&&(x+y)&1?1:0];
      }
      const p=u<1?pose(routine,u,W,mirror):null;
      if(p){
        // Shadow: a dithered pixel oval under the car, half its pixels dropped like an old console shadow.
        const rx=fw*(.19+.15*Math.abs(Math.cos(p.heading))),ry=3.2,cx=Math.round(p.x),cy=Math.round(baseY+p.z*.45);
        for(let dy=-3;dy<=3;dy++)for(let dx=-Math.ceil(rx);dx<=Math.ceil(rx);dx++){
          if((dx/rx)**2+(dy/ry)**2>1)continue;const X=cx+dx,Y=cy+dy;
          if(X>=0&&Y>=0&&X<W&&Y<H&&visible(X,Y,.5))ground.px[Y*W+X]=SHADOW;
        }
      }
      ground.g.putImageData(ground.img,0,0);ctx.drawImage(ground.c,0,0);
      if(p){
        const sx=p.x,sy=baseY+p.z*.45,h=p.heading;
        const back={x:-Math.cos(h)*L,z:-Math.sin(h)*L},side={x:-Math.sin(h)*T,z:Math.cos(h)*T};
        const wheels=[1,-1].map(k=>({x:sx+back.x+side.x*k,y:sy+(back.z+side.z*k)*.45}));
        const slipDeg=Math.abs(p.slip)/deg;
        if(slipDeg>14){
          if(last)wheels.forEach((w,i)=>track(last![i].x,last![i].y,w.x,w.y,now));
          // Smoke scales with how hard the car is sliding.
          for(const w of wheels)if(Math.random()<Math.min(.95,slipDeg/60))emit(w.x,w.y,now,2+Math.random()*2.5+slipDeg/30);
        }
        last=wheels;
        // A flick (slip changing fast) throws big puffs and pops the exhaust.
        const flick=Math.abs(p.slip-lastSlip)/deg;lastSlip=p.slip;
        if(flick>1.2){
          for(const w of wheels)if(Math.random()<.6)emit(w.x,w.y,now,5+Math.random()*2);
          if(Math.random()<.5){const ex=sx+back.x*1.2,ey=sy-fh*.38+back.z*.5;for(let i=0;i<3;i++)puffs.push({x:ex,y:ey,vx:back.x*.03+(Math.random()-.5)*.35,vy:(Math.random()-.5)*.3,born:now,life:150+Math.random()*130,r:1+Math.random()*1.5,fire:true});}
        }
        // Hysteresis: switch frame only once the heading is clearly nearer the next one.
        const target=frameFor(h),off=Math.abs((((h/deg-shown*45)%360)+540)%360-180);
        if(shown<0||(target!==shown&&off>27))shown=target;
        // A one-pixel bounce while sliding sells the weight transfer.
        const bob=slipDeg>14&&((now/90)|0)%2?1:0;
        ctx.drawImage(sheet,shown*fw,0,fw,fh,Math.round(sx-fw/2),Math.round(sy-fh)-bob,fw,fh);
      }
      // Air: round pixel clouds lit from the top left that grow, then dissolve.
      air.px.fill(0);
      for(let n=puffs.length-1;n>=0;n--){
        const pf=puffs[n],age=(now-pf.born)/pf.life;if(age>=1){puffs.splice(n,1);continue;}
        pf.x+=pf.vx;pf.y+=pf.vy;pf.vx*=.985;
        const r=pf.fire?pf.r*(1-age*.5):pf.r*(.45+.55*Math.sqrt(age)),keep=pf.fire?1:Math.min(1,(1-age)*1.6);
        const cx=Math.round(pf.x),cy=Math.round(pf.y),R=Math.ceil(r);
        for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
          if(dx*dx+dy*dy>r*r)continue;const X=cx+dx,Y=cy+dy;if(X<0||Y<0||X>=W||Y>=H||!visible(X,Y,keep))continue;
          const light=(-dx-dy)/(r||1);
          air.px[Y*W+X]=pf.fire?FIRE[age<.3?0:age<.6?1:2]:light>.45?SMOKE.hi:light<-.35?SMOKE.lo:SMOKE.mid;
        }
      }
      air.g.putImageData(air.img,0,0);ctx.drawImage(air.c,0,0);
      if(u>=1&&!skids.size&&!puffs.length){ctx.clearRect(0,0,W,H);return resolve();}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Matthew mode's McLaren P1: after five minutes in Matthew mode it drifts across the page at random intervals,
 * in front of the cards, leaving skidmarks that wear off. Typing MCLAREN in Matthew mode sends it immediately.
 */
export function McLarenDrift(){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const signal={stopped:false};
    let sheet:HTMLImageElement|null=null,running=false,buffer='';
    const active=()=>document.documentElement.dataset.theme==='matthew';
    const load=()=>sheet??=Object.assign(new Image(),{src:SHEET});
    const go=async()=>{
      if(running||!active()||!canvas.current)return;
      const img=load();running=true;
      try{if(!img.complete)await img.decode();canvas.current.hidden=false;await runDrift(canvas.current,img,signal);}catch{}
      if(canvas.current)canvas.current.hidden=true;running=false;
    };
    const read=()=>{try{return JSON.parse(sessionStorage.getItem(CLOCK_KEY)||'')as {elapsed:number;next:number};}catch{return {elapsed:0,next:FIRST_RUN_MS+Math.random()*60_000};}};
    // Count only time spent in Matthew mode with the tab visible; the clock survives reloads within the session.
    const clock=setInterval(()=>{
      if(!active()||document.hidden)return;
      const c=read();c.elapsed+=1000;
      if(c.elapsed>=c.next){c.next=c.elapsed+FIRST_RUN_MS+Math.random()*4*60_000;void go();}
      try{sessionStorage.setItem(CLOCK_KEY,JSON.stringify(c));}catch{}
    },1000);
    const onKey=(event:KeyboardEvent)=>{
      if(!active()||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
      const t=event.target;if(t instanceof HTMLElement&&(t.isContentEditable||t.closest('input,textarea,select')))return;
      const r=trackSecret(buffer,event.key,'MCLAREN');buffer=r.buffer;if(r.matched)void go();
    };
    window.addEventListener('keydown',onKey);
    return()=>{signal.stopped=true;clearInterval(clock);window.removeEventListener('keydown',onKey);};
  },[]);
  return <canvas ref={canvas} className="mclaren-drift" hidden aria-hidden="true"/>;
}
