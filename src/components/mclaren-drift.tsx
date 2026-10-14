'use client';
import {useEffect,useRef} from 'react';
import {trackSecret} from './matthew-mode';

/** Sprite strip: 8 turntable frames of a ChatGPT-drawn McLaren P1, bottom-aligned on a shared ground line. */
const SHEET='/matthew/p1-frames.png';
const FRAMES=8;
const CLOCK_KEY='tastebuds-p1-clock';
const FIRST_RUN_MS=5*60_000;
const SKID_LIFE_MS=12_000;

type Vec={x:number;z:number};
type Routine={duration:number;path:(u:number,w:number)=>Vec;slip:(u:number)=>number};
type Skid={x0:number;y0:number;x1:number;y1:number;born:number};
type Puff={x:number;y:number;vx:number;vy:number;born:number;life:number;size:number;fire:boolean};

const deg=Math.PI/180;
const smooth=(t:number)=>t<=0?0:t>=1?1:t*t*(3-2*t);
/** Piecewise-smooth keyframes: [[u, value], ...]. */
function keys(points:[number,number][]){
  return (u:number)=>{
    if(u<=points[0][0])return points[0][1];
    for(let i=1;i<points.length;i++){const [u1,v1]=points[i],[u0,v0]=points[i-1];if(u<=u1)return v0+(v1-v0)*smooth((u-u0)/(u1-u0));}
    return points[points.length-1][1];
  };
}

/**
 * Each routine is a ground path (x across the page, z toward the viewer) plus a slip angle: how far the nose
 * points away from the direction of travel. Positive slip turns the nose toward the viewer.
 */
const ROUTINES:Routine[]=[
  { // Long sideways slide with a counter-flick.
    duration:6800,
    path:(u,w)=>({x:-130+(w+260)*(u+.05*Math.sin(2*Math.PI*u)),z:40*Math.sin(Math.PI*u)}),
    slip:keys([[0,0],[.16,0],[.24,-48],[.5,-58],[.6,-10],[.68,40],[.8,34],[.9,0],[1,0]]),
  },
  { // Donut in the middle of the page: the car spins through every angle.
    duration:8200,
    path:(u,w)=>{
      const cx=w*.5,r=46;
      if(u<.3)return {x:-130+(cx+130)*smooth(u/.3*.85+.15*u/.3),z:0};
      if(u<.72){const a=2*Math.PI*1.25*(u-.3)/.42;return {x:cx+r*Math.sin(a),z:r*(1-Math.cos(a))};}
      const a=2*Math.PI*1.25,sx=cx+r*Math.sin(a),sz=r*(1-Math.cos(a));
      const k=(u-.72)/.28;return {x:sx+(w+130-sx)*k,z:sz*(1-smooth(k))};
    },
    slip:keys([[0,0],[.24,0],[.32,72],[.7,78],[.78,20],[.86,0],[1,0]]),
  },
  { // S-curve with alternating drifts.
    duration:6600,
    path:(u,w)=>({x:-130+(w+260)*u,z:44*Math.sin(2*Math.PI*u)}),
    slip:keys([[0,0],[.1,0],[.2,42],[.36,46],[.46,0],[.56,-46],[.74,-50],[.86,0],[1,0]]),
  },
];

/** Nearest of the 8 turntable frames for a heading (0 = facing right, +90° = facing the viewer). */
export function frameFor(heading:number){
  const d=((heading/deg)%360+360)%360;
  return Math.round(d/45)%8;
}

function drawLine(ctx:CanvasRenderingContext2D,x0:number,y0:number,x1:number,y1:number,size:number){
  // Bresenham on whole pixels keeps skidmarks as crisp as the sprites.
  x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let err=dx+dy;
  for(let i=0;i<400;i++){ctx.fillRect(x0,y0,size,size);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
}

/** Runs one drift across the page. Resolves when the car has left and its skidmarks have worn off. */
function runDrift(canvas:HTMLCanvasElement,sheet:HTMLImageElement,signal:{stopped:boolean}){
  return new Promise<void>(resolve=>{
    const scale=2; // 110x50 sprite frames: about 220 CSS px of car
    const W=Math.ceil(window.innerWidth/scale),H=Math.ceil(window.innerHeight/scale);
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;
    const fw=sheet.naturalWidth/FRAMES,fh=sheet.naturalHeight;
    const routine=ROUTINES[Math.floor(Math.random()*ROUTINES.length)];
    const mirror=Math.random()<.5;
    const baseY=Math.round(H*(.5+Math.random()*.25));
    const project=(p:Vec)=>({x:mirror?W-p.x:p.x,y:baseY+p.z*.45});
    const skids:Skid[]=[],puffs:Puff[]=[];
    let lastWheels:{x:number;y:number}[]|null=null,lastSlip=0,start=0,frame=0,shownFrame=0;
    const L=fw*.33,T=11; // half wheelbase-ish and half track, in ground units
    const tick=(now:number)=>{
      if(signal.stopped)return resolve();
      if(!start)start=now;
      const u=(now-start)/routine.duration;
      ctx.clearRect(0,0,W,H);
      // Skidmarks: stepped retro fade.
      for(let i=skids.length-1;i>=0;i--){
        const age=(now-skids[i].born)/SKID_LIFE_MS;if(age>=1){skids.splice(i,1);continue;}
        ctx.globalAlpha=[.55,.4,.26,.12][Math.floor(age*4)];ctx.fillStyle='#0b0908';
        drawLine(ctx,skids[i].x0,skids[i].y0,skids[i].x1,skids[i].y1,2);
      }
      ctx.globalAlpha=1;
      if(u<1){
        const p=routine.path(u,W),q=routine.path(Math.min(1,u+.002),W);
        let travel=Math.atan2(q.z-p.z,q.x-p.x);if(mirror)travel=Math.PI-travel;
        const slip=routine.slip(u)*deg*(mirror?-1:1);
        const heading=travel+slip;
        const s=project(p);
        // Rear wheels sit behind the centre along the heading; z is foreshortened like the path.
        const back={x:-Math.cos(heading)*L,z:-Math.sin(heading)*L},side={x:-Math.sin(heading)*T,z:Math.cos(heading)*T};
        const wheels=[1,-1].map(k=>({x:s.x+back.x+side.x*k,y:s.y+(back.z+side.z*k)*.45}));
        const drifting=Math.abs(slip)>16*deg;
        if(drifting&&lastWheels)wheels.forEach((w,i)=>skids.push({x0:lastWheels![i].x,y0:lastWheels![i].y,x1:w.x,y1:w.y,born:now}));
        lastWheels=wheels;
        if(drifting)for(const w of wheels)if(Math.random()<.7)puffs.push({x:w.x,y:w.y-1,vx:(Math.random()-.5)*.25,vy:-.12-Math.random()*.18,born:now,life:700+Math.random()*700,size:1+Math.random()*1.5,fire:false});
        // A flick (slip changing fast) pops the exhaust.
        if(Math.abs(slip-lastSlip)>1.4*deg&&Math.random()<.5){const ex=s.x+back.x*1.25,ey=s.y-fh*.35+back.z*.56;for(let i=0;i<3;i++)puffs.push({x:ex,y:ey,vx:back.x*.02+(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,born:now,life:160+Math.random()*120,size:1+Math.random(),fire:true});}
        lastSlip=slip;
        // Hysteresis: only change frame once the heading is clearly closer to the next one.
        frame=frameFor(heading);
        const shownCentre=shownFrame*45,diff=Math.abs((((heading/deg-shownCentre)%360)+540)%360-180);
        if(frame!==shownFrame&&diff>27)shownFrame=frame;
        // Shadow, then the car anchored bottom-centre on its ground point.
        const shadow=Math.round(fw*(.38+.3*Math.abs(Math.cos(heading))));ctx.globalAlpha=.35;ctx.fillStyle='#000';ctx.fillRect(Math.round(s.x-shadow/2),Math.round(s.y-1),shadow,3);ctx.globalAlpha=1;
        ctx.drawImage(sheet,shownFrame*fw,0,fw,fh,Math.round(s.x-fw/2),Math.round(s.y-fh),fw,fh);
      }
      // Smoke and exhaust fire.
      for(let i=puffs.length-1;i>=0;i--){
        const pf=puffs[i],age=(now-pf.born)/pf.life;if(age>=1){puffs.splice(i,1);continue;}
        pf.x+=pf.vx;pf.y+=pf.vy;const size=Math.round(pf.size+age*(pf.fire?0:3));
        ctx.globalAlpha=pf.fire?1:[.7,.5,.32,.16][Math.floor(age*4)];
        ctx.fillStyle=pf.fire?(age<.4?'#fff3a0':'#ff8a3d'):(age<.3?'#e9e4dd':age<.6?'#bdb6ad':'#8d867d');
        ctx.fillRect(Math.round(pf.x-size/2),Math.round(pf.y-size/2),size,size);
      }
      ctx.globalAlpha=1;
      if(u>=1&&!skids.length&&!puffs.length){ctx.clearRect(0,0,W,H);return resolve();}
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
