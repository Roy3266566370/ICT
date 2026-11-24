export interface Box { x:number; y:number; width:number; height:number }
interface Geometry extends Box { rotation:number }
export interface GapGuide { axis:'x'|'y';from:number;to:number;cross:number }
const radians = (degrees:number) => degrees * Math.PI / 180;
const round = (value:number) => Math.round(value*100)/100 || 0;
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(value,max));

export function rotatedBox(node:Geometry):Box {
  const angle=radians(node.rotation),cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle));
  const width=node.width*cos+node.height*sin,height=node.width*sin+node.height*cos;
  return {x:node.x+(node.width-width)/2,y:node.y+(node.height-height)/2,width,height};
}

export function rotatedBounds(nodes:Geometry[]):Box {
  const boxes=nodes.map(rotatedBox);
  const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
  return {x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.y+box.height))-y};
}

export function intersects(a:Box,b:Box):boolean {
  return a.x<=b.x+b.width&&b.x<=a.x+a.width&&a.y<=b.y+b.height&&b.y<=a.y+a.height;
}

export function rotateSelection(node:Geometry,box:Box,degrees:number):Pick<Geometry,'x'|'y'|'rotation'> {
  const angle=radians(degrees),cos=Math.cos(angle),sin=Math.sin(angle);
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  const x=node.x+node.width/2-cx,y=node.y+node.height/2-cy;
  return {x:round(clamp(cx+x*cos-y*sin-node.width/2,-20000,20000)),
    y:round(clamp(cy+x*sin+y*cos-node.height/2,-20000,20000)),rotation:round((node.rotation+degrees)%360)};
}

export function groupResize(nodes:Geometry[],box:Box,handle:string,dx:number,dy:number,keepRatio:boolean):Box[] {
  const horizontal=handle.includes('w')?-1:handle.includes('e')?1:0;
  const vertical=handle.includes('n')?-1:handle.includes('s')?1:0;
  let sx=1+dx*horizontal/box.width,sy=1+dy*vertical/box.height;
  const cardinal=nodes.every(node=>Math.abs(node.rotation%90)<.001);
  const swapped=(node:Geometry)=>Math.abs(Math.round(node.rotation/90)%2)===1;
  const limits=(sizes:number[])=>[Math.max(...sizes.map(size=>Math.min(5,size)/size)),
    Math.min(...sizes.map(size=>20000/size))] as const;
  if (keepRatio||!cardinal) {
    // Uniform scaling keeps rotated rectangles representable without shear.
    const factor=!horizontal?sy:!vertical?sx:Math.abs(sx-1)>=Math.abs(sy-1)?sx:sy;
    sx=sy=clamp(factor,...limits(nodes.flatMap(node=>[node.width,node.height])));
  } else {
    if(horizontal)sx=clamp(sx,...limits(nodes.map(node=>swapped(node)?node.height:node.width)));
    if(vertical)sy=clamp(sy,...limits(nodes.map(node=>swapped(node)?node.width:node.height)));
  }
  const anchorX=box.x+box.width*(1-horizontal)/2,anchorY=box.y+box.height*(1-vertical)/2;
  return nodes.map(node=>{
    const width=node.width*(swapped(node)?sy:sx),height=node.height*(swapped(node)?sx:sy);
    const cx=anchorX+(node.x+node.width/2-anchorX)*sx,cy=anchorY+(node.y+node.height/2-anchorY)*sy;
    return {width:round(width),height:round(height),x:round(clamp(cx-width/2,-20000,20000)),y:round(clamp(cy-height/2,-20000,20000))};
  });
}

export function snapAxis(axis:'x'|'y',moving:Box,offset:number,crossOffset:number,others:Box[],extent:number,threshold:number) {
  const cross=axis==='x'?'y':'x',size=axis==='x'?'width':'height',crossSize=axis==='x'?'height':'width';
  const length=moving[size],start=moving[axis]+offset,crossStart=moving[cross]+crossOffset;
  const crossEnd=crossStart+moving[crossSize];
  const lane=others.filter(box=>box[cross]<crossEnd&&box[cross]+box[crossSize]>crossStart);
  const end=(box:Box)=>box[axis]+box[size];
  let best=threshold,next=offset,line:number|undefined,gaps:GapGuide[]|undefined;
  const consider=(position:number,target?:number,markers?:GapGuide[])=>{
    const delta=position-start,distance=Math.abs(delta);
    if(distance<best){best=distance;next=offset+delta;line=target;gaps=markers;}
  };
  const mark=(position:number,gap:number,a:Box,b:Box,spans:number[][])=>{
    if(gap<=0)return;
    const top=Math.max(crossStart,a[cross],b[cross]),bottom=Math.min(crossEnd,a[cross]+a[crossSize],b[cross]+b[crossSize]);
    if(bottom<=top)return;
    consider(position,undefined,spans.map(([from,to])=>({axis,from:from!,to:to!,cross:(top+bottom)/2})));
  };
  const before=lane.filter(box=>end(box)<=start+threshold).sort((a,b)=>end(b)-end(a));
  const after=lane.filter(box=>box[axis]>=start+length-threshold).sort((a,b)=>a[axis]-b[axis]);
  const left=before[0],right=after[0];
  if(left&&right){
    const gap=(right[axis]-end(left)-length)/2,position=end(left)+gap;
    mark(position,gap,left,right,[[end(left),position],[position+length,right[axis]]]);
  }
  if(left){
    const prior=before.find(box=>end(box)<=left[axis]);
    if(prior){const gap=left[axis]-end(prior),position=end(left)+gap;
      mark(position,gap,prior,left,[[end(prior),left[axis]],[end(left),position]]);}
  }
  if(right){
    const following=after.find(box=>box[axis]>=end(right));
    if(following){const gap=following[axis]-end(right),position=right[axis]-gap-length;
      mark(position,gap,right,following,[[position+length,right[axis]],[end(right),following[axis]]]);}
  }
  for(const target of [0,extent/2,extent,...others.flatMap(box=>[box[axis],box[axis]+box[size]/2,end(box)])]){
    for(const anchor of [0,length/2,length])consider(target-anchor,target);
  }
  return {offset:next,line,gaps};
}
