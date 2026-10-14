/**
 * The 720S cursor's burnout: door frames that open toward a target, a spinning rear wheel painted over the sprite,
 * a 1-pixel launch shake and 8-bit tyre smoke. Pure canvas drawing so the cursor and design previews share it.
 */
export type CarSpec={
  frames:number;w:number;h:number;
  /** Nose tip in sprite pixels: the point that clicks. */
  hot:{x:number;y:number};
  /** Rear wheel ellipse in sprite pixels, as seen from above. */
  wheel:{x:number;y:number;rx:number;ry:number};
  /** Unit vector from the nose toward the tail: the way the smoke blows. */
  back:{x:number;y:number};
};

export const DOOR_FRAME_MS=26;
const SPIN_RAD_PER_MS=.045;
const SHAKE_MS=45;

// 4x4 Bayer matrix: pixels drop out in a fixed ordered pattern, the classic 8-bit dissolve.
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const visible=(x:number,y:number,keep:number)=>BAYER[(y&3)*4+(x&3)]<keep*16;
/** Packs #rrggbb into the little-endian RGBA word ImageData expects. */
const rgba=(hex:string)=>{const n=parseInt(hex.slice(1),16);return (255<<24|(n&255)<<16|(n>>8&255)<<8|n>>16)>>>0;};
const SMOKE={hi:rgba('#f7f4ef'),mid:rgba('#d6d0c7'),lo:rgba('#9d958a')};
const TYRE='#121212',RIM='#5b605d',SPOKE='#e4e6e2',BLUR='#9a9e9b';

type Puff={x:number;y:number;vx:number;vy:number;r:number;born:number;life:number};

export class Burnout{
  frame=0;target=0;
  private stepAt=0;private spinFrom=0;private shakeAt=0;private emitAt=0;
  shake={x:0,y:0};
  private puffs:Puff[]=[];
  constructor(readonly spec:CarSpec,private reduced=false){}

  /** Doors open on hover; the burnout starts once they are fully up. */
  hover(on:boolean,now:number){
    const next=on?this.spec.frames-1:0;
    if(next===this.target)return;
    this.target=next;this.stepAt=now;
    if(this.reduced)this.frame=next;
  }
  get spinning(){return this.target>0&&this.frame===this.target&&!this.reduced;}
  get busy(){return this.frame!==this.target||this.spinning||this.puffs.length>0;}

  /** Advances doors, wheel, shake and smoke. `origin` is the sprite's top-left in smoke-buffer pixels / `scale`. */
  update(now:number,origin:{x:number;y:number}){
    while(this.frame!==this.target&&now-this.stepAt>=DOOR_FRAME_MS){
      this.frame+=this.frame<this.target?1:-1;this.stepAt+=DOOR_FRAME_MS;
      if(this.spinning)this.spinFrom=this.emitAt=now;
    }
    if(this.frame===this.target)this.stepAt=now;
    if(!this.spinning){this.shake={x:0,y:0};return;}
    if(now-this.shakeAt>=SHAKE_MS){this.shakeAt=now;this.shake={x:Math.random()<.5?0:1,y:Math.random()<.35?1:0};}
    // Big puffs as the tyres first break loose, then a steady stream.
    const launch=now-this.spinFrom<260;
    const {wheel,back}=this.spec,cx=origin.x+wheel.x+back.x*wheel.rx,cy=origin.y+wheel.y+wheel.ry*.8;
    while(now-this.emitAt>=(launch?14:32)){
      this.emitAt+=launch?14:32;
      const speed=.018+Math.random()*.03,side=(Math.random()-.5)*.03;
      this.puffs.push({x:cx+(Math.random()-.5)*3,y:cy+(Math.random()-.5)*2,vx:back.x*speed-back.y*side,vy:back.y*speed+back.x*side-.006,r:launch?3+Math.random()*2:1.6+Math.random()*1.6,born:now,life:700+Math.random()*600});
    }
  }

  /** Draws the current door frame, with the rear wheel spinning during a burnout. */
  drawCar(ctx:CanvasRenderingContext2D,sheet:CanvasImageSource,now:number){
    const {w,h,wheel}=this.spec,{x:sx,y:sy}=this.shake;
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.drawImage(sheet,this.frame*w,0,w,h,sx,sy,w,h);
    if(!this.spinning)return;
    const cx=wheel.x+sx,cy=wheel.y+sy,a=(now-this.spinFrom)*SPIN_RAD_PER_MS;
    const dot=(c:string,x:number,y:number)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),1,1);};
    for(let y=-wheel.ry;y<=wheel.ry;y++)for(let x=-wheel.rx;x<=wheel.rx;x++){
      const d=(x/wheel.rx)**2+(y/wheel.ry)**2;if(d>1)continue;
      dot(d>.55?TYRE:RIM,cx+x,cy+y);
    }
    // Two spokes plus a motion-blur trail, rotating faster than the eye can count.
    for(const k of [0,Math.PI]){
      dot(BLUR,cx+Math.cos(a+k-.7)*wheel.rx*.5,cy+Math.sin(a+k-.7)*wheel.ry*.5);
      dot(SPOKE,cx+Math.cos(a+k)*wheel.rx*.5,cy+Math.sin(a+k)*wheel.ry*.5);
    }
  }

  /** Paints dithered smoke into a Uint32 RGBA buffer of size W x H; lit from the top left like the P1's. */
  drawSmoke(px:Uint32Array,W:number,H:number,now:number,scale:number){
    for(let n=this.puffs.length-1;n>=0;n--){
      const pf=this.puffs[n],age=(now-pf.born)/pf.life;
      if(age>=1){this.puffs.splice(n,1);continue;}
      const x=pf.x+pf.vx*(now-pf.born),y=pf.y+pf.vy*(now-pf.born);
      const r=pf.r*(.5+1.1*Math.sqrt(age))/scale,keep=Math.min(1,(1-age)*1.5);
      const cx=Math.round(x/scale),cy=Math.round(y/scale),R=Math.ceil(r);
      for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
        if(dx*dx+dy*dy>r*r)continue;const X=cx+dx,Y=cy+dy;
        if(X<0||Y<0||X>=W||Y>=H||!visible(X,Y,keep))continue;
        const light=(-dx-dy)/(r||1);
        px[Y*W+X]=light>.45?SMOKE.hi:light<-.35?SMOKE.lo:SMOKE.mid;
      }
    }
  }
}
