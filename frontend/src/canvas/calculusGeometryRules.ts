import { dot, label, line } from './calculusSandboxRules.ts';

const mesh = `const s=upstream.find(v=>v.kind==="function")?.samples;
  if (s?.undefinedSample || !s?.radii?.every(Number.isFinite) || !s.profile?.every(Number.isFinite)) return {data:{},frames:[
    {title:"等待有效轮廓",summary:"接入在 [0,1] 可取有限值的函数，半径或宽度取 |f|。"}
  ]};`;
const fmt = 'const fmt = (v, digits=5) => Number.isFinite(v) ? Number(v.toPrecision(digits)).toString() : "—";';
const arrow = 'const arrow = (x1,y1,x2,y2,stroke) => ({...line(x1,y1,x2,y2,stroke),kind:"arrow",strokeWidth:2.5});';

export const diskSlicesRule = `function run({ upstream }) {
  ${mesh}
  ${line}
  ${label}
  ${fmt}
  const volume=Math.PI*s.radii.reduce((sum,r)=>sum+r*r,0)/s.n;
  if(!Number.isFinite(volume)) return {data:{},frames:[
    {title:"体积超出数值范围",summary:"请缩小旋转半径。"}
  ]};
  const error=Number.isFinite(s.volume) ? Math.abs(volume-s.volume) : null;
  const radius=Math.max(Number.MIN_VALUE,...s.radii,...s.profile.filter(Number.isFinite));
  const px=x=>38+323*x, py=r=>63*(r/radius), axis=100;
  const items=[];
  for(let i=0;i<s.n;i++){
    const x=px(i/s.n), width=px((i+1)/s.n)-x, height=py(s.radii[i]);
    items.push({kind:"rect",x,y:axis-height,w:width,h:2*height,
      fill:i%2===0?"#b2dce6":"#c7e8ef",stroke:"#558aa2",strokeWidth:.75});
  }
  for(let i=1;i<s.profile.length;i++){
    const a=s.profile[i-1],b=s.profile[i];
    if(!Number.isFinite(a)||!Number.isFinite(b)) continue;
    for(const side of [-1,1]) items.push(line(px((i-1)/32),axis+side*py(a),px(i/32),axis+side*py(b),"#1b5f75"));
  }
  items.push(line(23,axis,380,axis,"#8296aa",true),label(30,186,"0"),label(339,186,"x=1"),
    label(31,204,"实线是旋转轮廓，阶梯是圆盘的轴向投影"));
  const summary="N="+s.n+" · 中点圆盘和 "+fmt(volume)+" 立方单位 · 数值参考 "+fmt(s.volume)+
    " · 误差 "+fmt(error,3);
  return {data:{volume,reference:s.volume,error},frames:[
    {title:"绕 x 轴旋转的圆盘切片",summary,shapes:{viewBox:[400,215],items}}
  ]};
}`;

export const damWorkRule = `function run({ params, upstream }) {
  ${mesh}
  ${line}
  ${label}
  ${fmt}
  const rhoG=9810, H=params.depth, B=params.width, L=params.length, rise=params.rise, dd=H/s.n;
  const pressure=[0], forceCurve=[0], workCurve=[0];
  for(let i=0;i<s.n;i++){
    const d=(i+0.5)*dd, b=B*s.radii[i], p=rhoG*d;
    pressure.push(rhoG*(i+1)*dd/1000);
    forceCurve.push(forceCurve.at(-1)+p*b*dd);
    workCurve.push(workCurve.at(-1)+rhoG*b*L*dd*(d+rise));
  }
  const force=forceCurve.at(-1), work=workCurve.at(-1);
  if(![force,work].every(Number.isFinite)) return {data:{},frames:[
    {title:"结果超出数值范围",summary:"请缩小轮廓或水坝尺寸。"}
  ]};
  const radius=Math.max(Number.MIN_VALUE,...s.radii), bar=115/s.n;
  const items=[line(18,39,383,39,"#68a5ba"),line(234,39,234,154,"#849caf"),label(20,24,"水面 d=0"),
    label(26,173,"坝面条带宽 b(d)"),label(233,173,"压强 p(d)=ρgd")];
  for(let i=0;i<s.n;i++){
    const y=39+bar*i, width=139*(s.radii[i]/radius);
    items.push({kind:"rect",x:98-width/2,y,w:width,h:bar,
      fill:i%2===0?"#c9e7f1":"#b1dbe8",stroke:"#578ca3",strokeWidth:.6});
    const d=(i+.5)/s.n;
    items.push(line(235,y+bar/2,235+126*d,y+bar/2,"#286890"));
  }
  items.push(line(234,39,362,154,"#245f80"),label(14,192,"坝面合力：∫ p(d)b(d) dd"),
    label(225,192,"抽水提升距离：d + 出口高度"));
  const summary="N="+s.n+" · 坝底 "+fmt(rhoG*H/1000)+" kPa · 合力 "+fmt(force/1000)+" kN · 抽水功 "+fmt(work/1e6)+" MJ";
  return {data:{force,work,pressureMax:rhoG*H},frames:[
    {title:"静水压强与抽水做功",summary,shapes:{viewBox:[400,205],items},
      series:[{label:"由水面到坝底的压强（kPa）",values:pressure}]},
    {title:"从水面累积到各层的坝面合力",summary,series:[{label:"合力（kN）",values:forceCurve.map(v=>v/1000)}]},
    {title:"把各层水抽至出口的累计做功",summary,series:[{label:"抽水功（MJ）",values:workCurve.map(v=>v/1e6)}]},
  ]};
}`;

const surfaces = `const level=Math.max(-3,Math.min(3,upstream.find(v=>v.port==="aux" && v.kind==="scalar")?.v ?? 0.8));
  const surface=Math.max(0,Math.min(2,Math.round(upstream.find(v=>v.port!=="aux" && v.kind==="scalar")?.v ?? params.surface)));
  const domain=2.25;
  const names=["马鞍面 z=x²−y²","上开抛物面 z=x²+y²","下开抛物面 z=2−x²−y²"];
  const height=(x,y)=>[x*x-y*y,x*x+y*y,2-x*x-y*y][surface];`;

export const vectorGeometryRule = `function run({ params, upstream }) {
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const c=Math.max(-3,Math.min(3,upstream.find(v=>v.kind==="scalar")?.v ?? params.level));
  const a=[params.ax,params.ay,c], b=[params.bx,params.by,params.bz];
  const ab=a.reduce((sum,x,i)=>sum+x*b[i],0), bb=b.reduce((sum,x)=>sum+x*x,0);
  const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const area=Math.hypot(...cross), proj=bb>0 ? b.map(x=>x*ab/bb) : null;
  const sum=a.map((x,i)=>x+b[i]);
  const raw = ([x,y,z])=>[0.82*x-0.65*y,z+0.36*(x+y)];
  const extent=Math.max(1,...[a,b,sum,proj??[0,0,0]].flatMap(v=>raw(v).map(Math.abs)));
  const origin=[200,101];
  const screen=v=>raw(v).map((x,i)=>origin[i]+(i===0?1:-1)*x*74/extent);
  const A=screen(a), B=screen(b), AB=screen(sum);
  const items=[
    {kind:"polygon",points:[origin,A,AB,B],fill:"#dceaf9",stroke:"#86a4c4",opacity:.8},
    arrow(...origin,...A,"#265c9b"),arrow(...origin,...B,"#21806b"),
    label(A[0]+6,A[1]-5,"a"),label(B[0]+6,B[1]+13,"b"),
  ];
  if(proj){
    const P=screen(proj);
    items.push(arrow(...origin,...P,"#b55b25"),line(...P,...A,"#b55b25",true),dot(...P,"#b55b25",3),
      label(P[0]+5,P[1]+15,"proj"));
  }
  items.push(label(12,200,"蓝 a · 绿 b · 橙 a 在 b 上的投影"),
    label(12,218,"浅蓝平行四边形的空间面积为 ‖a×b‖"));
  const summary="a=(" + a.map(v=>fmt(v,3)).join(",") + ") · a·b="+fmt(ab)+
    " · 有向投影长度 "+fmt(bb>0?ab/Math.sqrt(bb):null)+" · 叉积面积 "+fmt(area)+
    (bb===0?" · b 为零向量，投影未定义":"");
  return {data:{dot:ab,area,projection:bb>0?ab/Math.sqrt(bb):null,cross},frames:[
    {title:"点积投影与叉积面积（空间示意）",summary,shapes:{viewBox:[400,230],items}}
  ]};
}`;

export const surfaceTracesRule = `function run({ params, upstream }) {
  ${surfaces}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const blue="#285a96", green="#21816a", orange="#b45e28", muted="#a9b8c5";
  const centers=[69,200,331], axis=93, xy=50/domain, vertical=10;
  const items=centers.flatMap((cx,i)=>[
    {kind:"rect",x:cx-58,y:33,w:116,h:116,fill:"#f8fafd",stroke:"#d2dce7",strokeWidth:.8},
    line(cx-50,axis,cx+50,axis,muted),line(cx,42,cx,144,muted),
    label(cx-34,22,["xy · z=c","xz · y=0","yz · x=0"][i]),
    label(cx+49,108,i===2?"y":"x"),label(cx+4,47,i===0?"y":"z"),
  ]);
  const xyPt=(x,y)=>[centers[0]+x*xy,axis-y*xy];
  let opensAlong, note;
  if(surface===0){
    opensAlong=level>0?"x":level<0?"y":"cross";
    note=level>0?"双曲线朝 x 轴开口":level<0?"双曲线朝 y 轴开口":"退化成 y=x 与 y=−x";
    if(level===0){
      items.push(line(...xyPt(-domain,-domain),...xyPt(domain,domain),green),
        line(...xyPt(-domain,domain),...xyPt(domain,-domain),green));
    }else{
      const span=Math.sqrt(domain*domain-Math.abs(level));
      for(const sign of [-1,1]){
        const branch=t=>level>0?xyPt(sign*Math.sqrt(t*t+level),t):xyPt(t,sign*Math.sqrt(t*t-level));
        for(let i=1;i<=24;i++) items.push(line(...branch(-span+2*span*(i-1)/24),...branch(-span+2*span*i/24),green));
      }
    }
  }else{
    const radiusSquared=surface===1?level:2-level;
    opensAlong=radiusSquared<0?"none":radiusSquared===0?"point":"circle";
    note=opensAlong==="none"?"xy 截面无实点":opensAlong==="point"?"xy 截面退化为原点":"xy 截面为圆，半径 "+fmt(Math.sqrt(radiusSquared));
    if(radiusSquared===0) items.push(dot(centers[0],axis,green));
    if(radiusSquared>0) items.push({kind:"circle",cx:centers[0],cy:axis,r:Math.sqrt(radiusSquared)*xy,
      fill:"none",stroke:green,strokeWidth:1.6});
  }
  for(let k=1;k<=2;k++){
    const point=t=>[centers[k]+xy*t,axis-vertical*(k===1?height(t,0):height(0,t))];
    const cutY=axis-vertical*level;
    items.push(line(centers[k]-51,cutY,centers[k]+51,cutY,orange,true));
    for(let i=1;i<=24;i++) items.push(line(...point(domain*((i-1)/12-1)),...point(domain*(i/12-1)),blue));
  }
  items.push(label(13,168,"绿线：水平截痕；蓝线：侧面截痕；橙虚线：z=c"));
  return {data:{surface,level,opensAlong},frames:[
    {title:"二次曲面三视图",summary:names[surface]+" · z="+fmt(level,3)+" · "+note,shapes:{viewBox:[400,180],items}}
  ]};
}`;

export const heightFieldRule = `function run({ params, upstream }) {
  ${surfaces}
  ${fmt}
  const cells=Array.from({length:17},(_,i)=>Array.from({length:17},(_,j)=>height((j-8)*domain/8,(8-i)*domain/8)-level));
  const center=cells[8][8], extent=surface===0?domain*domain+3:14;
  return {data:{surface,level,center},frames:[
    {title:"高度热图 z−c（平面为零）",summary:names[surface]+" · c="+fmt(level,3)+
      " · 原点 z−c="+fmt(center,3)+" · 蓝色在平面下，红色在平面上",
      grid:{cells,palette:"diverging",min:-extent,max:extent,showValues:false}}
  ]};
}`;
