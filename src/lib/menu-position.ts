export function menuPosition(rect:{left:number;top:number;bottom:number;width:number},viewport:{width:number;height:number;offsetTop?:number;offsetLeft?:number}){
  const left=(viewport.offsetLeft??0)+16;
  const start=(viewport.offsetTop??0)+16,end=start+viewport.height-32;
  const width=Math.min(Math.max(rect.width,240),Math.max(0,viewport.width-32));
  const below=Math.max(0,end-rect.bottom-8),above=Math.max(0,rect.top-start-8);
  const opensAbove=below<220&&above>below;
  const available=opensAbove?above:below;
  const maxHeight=Math.min(360,Math.max(0,viewport.height-32),available<120?viewport.height-32:available);
  const wanted=opensAbove?rect.top-maxHeight-8:rect.bottom+8;
  return {left:Math.max(left,Math.min(rect.left,left+viewport.width-width-32)),top:Math.max(start,Math.min(wanted,end-maxHeight)),width,maxHeight};
}
