import { dot, label, line } from './calculusSandboxRules.ts';

const fmt = 'const fmt = v => !Number.isFinite(v) ? "—" : Math.abs(v)<1e-10 ? "0" : Number(v.toPrecision(5)).toString();';
const density = `const s=upstream.find(v=>v.kind==="function2d")?.samples;
  if (!s?.grid) return {data:{},frames:[{title:"等待有效密度",summary:s?.error??"接入二元密度函数。"}]};`;
const field = `const s=upstream.find(v=>v.kind==="vectorFunction2d")?.samples;
  if (!s?.levels) return {data:{},frames:[{title:"等待有效向量场",summary:s?.error??"接入可计算的二维向量场。"}]};`;
const maskGrid = `const maskGrid=(rows,min,max,palette)=>({
    cells:rows.map(row=>row.map(v=>v??0)),mask:rows.map(row=>row.map(v=>v===null)),min,max,palette,showValues:false
  });`;

export const jacobianRule = `function run({ upstream }) {
  ${density}
  ${line}
  ${label}
  ${fmt}
  const blue="#285a96", orange="#c27643", muted="#a7b7c6";
  const items=[label(27,22,"参数平面 (r, θ)"),label(253,22,"实际圆盘 (x, y)"),
    line(28,35,28,155,muted),line(28,155,148,155,muted),label(145,170,"r"),label(12,42,"θ")];
  for(let i=0;i<=6;i++){
    items.push(line(28+20*i,35,28+20*i,155,muted),line(28,35+20*i,148,35+20*i,muted));
  }
  items.push({kind:"rect",x:48,y:95,w:20,h:20,fill:"#b5d3ec",stroke:blue,strokeWidth:1},
    {kind:"rect",x:108,y:95,w:20,h:20,fill:"#f7d7b7",stroke:orange,strokeWidth:1},
    {...line(168,92,204,92,muted),kind:"arrow"});
  const pt=(r,a)=>[300+65*r*Math.cos(a),95-65*r*Math.sin(a)];
  for(let i=1;i<=6;i++) items.push({kind:"circle",cx:300,cy:95,r:65*i/6,fill:"none",stroke:muted,strokeWidth:0.9});
  for(let i=0;i<6;i++) items.push(line(300,95,...pt(1,2*Math.PI*i/6),muted));
  for(const [i,fill,stroke] of [[1,"#b5d3ec",blue],[4,"#f7d7b7",orange]]){
    const arc=r=>Array.from({length:8},(_,j)=>pt(r,4*Math.PI/6+j*Math.PI/21));
    items.push({kind:"polygon",points:[...arc(i/6),...arc((i+1)/6).reverse()],fill,stroke,strokeWidth:1});
  }
  items.push(label(17,187,"同样大小的 Δr·Δθ，映到外圈时对应更大的面积。"));
  return {data:{mass:s.mass,withoutJacobian:s.withoutJacobian},frames:[
    {title:"极坐标网格与面积权重",summary:"乘 r：积分 ≈ "+fmt(s.mass)+" · 漏乘 r："+fmt(s.withoutJacobian)+
      " · 差 "+fmt(s.withoutJacobian-s.mass),shapes:{viewBox:[400,200],items}}
  ]};
}`;

export const diskCentroidRule = `function run({ upstream }) {
  ${density}
  ${maskGrid}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const values=s.grid.flat().filter(Number.isFinite), min=Math.min(...values),max=Math.max(...values);
  const grid=maskGrid(s.grid,min,max,"heat"), scale=61,c=76;
  const items=[{kind:"circle",cx:c,cy:c,r:scale,fill:"#edf4fa",stroke:"#9bb4ca",strokeWidth:1.4},
    line(12,c,140,c,"#94a6b7"),line(c,12,c,140,"#94a6b7")];
  const hasCentroid=Number.isFinite(s.cx)&&Number.isFinite(s.cy);
  if(hasCentroid){
    const x=c+s.cx*scale,y=c-s.cy*scale;
    items.push(line(c,c,x,y,"#bc552c",true),line(x-6,y,x+6,y,"#bc552c"),line(x,y-6,x,y+6,"#bc552c"),dot(x,y,"#bc552c",4));
    grid.activeCell=[Math.round((1-s.cy)*8),Math.round((1+s.cx)*8)];
  }
  items.push(label(25,149,hasCentroid?"橙标：质心":"质心未定义"));
  const summary=s.negative?"采到负密度，显示带符号积分 "+fmt(s.mass)+"；薄板质心无物理意义。"
    : "质量 "+fmt(s.mass)+(hasCentroid?" · 质心 ("+fmt(s.cx)+", "+fmt(s.cy)+")":" · 零质量，质心未定义");
  return {data:{mass:s.mass,cx:s.cx,cy:s.cy},frames:[
    {title:"密度热图与质心标靶",summary,grid,shapes:{viewBox:[152,155],items}}
  ]};
}`;

export const fieldPathRule = `function run({ upstream }) {
  ${field}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const px=x=>200+x*72/s.radius,py=y=>99-y*72/s.radius;
  const lengthMax=Math.max(1e-12,...s.arrows.map(({p,q})=>Math.hypot(p,q)));
  const items=[{kind:"circle",cx:200,cy:99,r:72,fill:"#f5f9fc",stroke:"#5587ac",strokeWidth:1.6},
    line(118,99,282,99,"#b0bfcc"),line(200,17,200,181,"#b0bfcc"),
    label(280,106,"x"),label(206,21,"y"),label(14,188,"箭头为 (P,Q)，质点沿圆周逆时针运动")];
  for(const {x,y,p,q} of s.arrows){
    const fromX=px(x),fromY=py(y);
    if(p!==0||q!==0) items.push({...line(fromX,fromY,fromX+13*p/lengthMax,fromY-13*q/lengthMax,"#437a92"),kind:"arrow"});
  }
  const total=s.levels.at(-1).circulation;
  const frames=s.trace.map(({angle,work},index)=>{
    const trace=items.slice();
    for(let i=1;i<=index;i++){
      const a=s.trace[i-1].angle,b=s.trace[i].angle;
      trace.push(line(px(s.radius*Math.cos(a)),py(s.radius*Math.sin(a)),px(s.radius*Math.cos(b)),py(s.radius*Math.sin(b)),"#c76836"));
    }
    trace.push(dot(px(s.radius*Math.cos(angle)),py(s.radius*Math.sin(angle)),"#af431e",5));
    return {title:"质点沿圆周做功",summary:"R="+fmt(s.radius)+" · 累计做功 "+fmt(work)+" · 一周环量 "+fmt(total),
      shapes:{viewBox:[400,201],items:trace}};
  });
  return {data:{circulation:total},frames};
}`;

export const differentialHeatRule = `function run({ upstream }) {
  ${field}
  ${maskGrid}
  ${fmt}
  const frames=[["旋度 ∂Q/∂x−∂P/∂y",s.curl],["散度 ∂P/∂x+∂Q/∂y",s.divergence]].map(([title,rows])=>{
    const values=rows.flat().filter(Number.isFinite),extent=Math.max(1,...values.map(Math.abs));
    return {title,summary:title+" · R="+fmt(s.radius)+" · 采样范围 ["+fmt(Math.min(...values))+", "+fmt(Math.max(...values))+
      "] · 蓝负、红正、白色接近零",grid:maskGrid(rows,-extent,extent,"diverging")};
  });
  return {data:{radius:s.radius},frames};
}`;

export const fieldTheoremsRule = `function run({ upstream }) {
  ${field}
  ${fmt}
  const result=s.levels.at(-1);
  const graph=(title,left,right,boundary,inside)=>({
    title,summary:"R="+fmt(s.radius)+" · "+left+" "+fmt(result[boundary])+" · "+right+" "+fmt(result[inside])+
      " · 差 "+fmt(Math.abs(result[boundary]-result[inside]))+"（数值核对）",
    series:[{label:left,values:s.levels.map(v=>v[boundary])},{label:right,values:s.levels.map(v=>v[inside])}]
  });
  const cylinder=graph("单位高圆柱：曲面通量与体积分","侧面通量","体内散度积分","flux","divergenceIntegral");
  cylinder.summary+="。延拓为 (P,Q,0)，上下端面的通量为零。";
  return {data:{...result},frames:[
    graph("格林公式：环量与旋度积分","逆时针环量","旋度面积分","circulation","curlIntegral"),
    graph("平面散度定理：外向通量与散度积分","外向通量","散度面积分","flux","divergenceIntegral"),
    cylinder,
  ]};
}`;
