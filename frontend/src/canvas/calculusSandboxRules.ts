/** Rules saved with the canvas and executed by the existing rule Worker. */

const finite = 'const valid = Number.isFinite;';
const missing = 'return { data: {}, frames: [{ title: "等待输入", summary: "请接入定义域内有有限值的函数源。" }] };';
const line = 'const line = (x1,y1,x2,y2,stroke,dashed=false) => ({ kind:"line", x1,y1,x2,y2,stroke,dashed,strokeWidth:1.6 });';
const dot = 'const dot = (cx,cy,fill,r=4) => ({ kind:"circle",cx,cy,r,fill });';
const label = 'const label = (x,y,text) => ({ kind:"text",x,y,text,fill:"#344153",size:11 });';
const arrow = 'const arrow = (x1,y1,x2,y2,stroke) => ({ ...line(x1,y1,x2,y2,stroke), kind:"arrow" });';

export { dot, label, line };

export const curvatureRule = `function run({ upstream }) {
  ${finite}
  ${line}
  ${dot}
  ${label}
  const s = upstream.find(v => v.kind === "function")?.samples;
  if (!s || !s.ys.some(valid)) { ${missing} }
  const x = upstream.find(v => v.kind === "scalar")?.v ?? 0;
  const index = Math.max(0, Math.min(100, Math.round((x + 2.5) * 20)));
  const y = s.ys[index], d = s.dy[index], dd = s.d2y[index];
  const defined = s.ys.filter(valid).sort((a,b) => a-b);
  const yMid = defined[Math.floor(defined.length/2)];
  const scale = Math.min(67, 71 / Math.max(1, ...defined.map(y => Math.abs(y-yMid))));
  const px = x => 200 + x*scale, py = y => 88 - (y-yMid)*scale;
  const items = [line(15,py(0),385,py(0),"#c6cfda"), line(200,12,200,167,"#c6cfda")];
  for (let i=1; i<s.xs.length; i++) {
    if (valid(s.ys[i-1]) && valid(s.ys[i])) items.push(line(px(s.xs[i-1]),py(s.ys[i-1]),px(s.xs[i]),py(s.ys[i]),"#285a96"));
  }
  const crossings = (vs, value) => {
    const hits = [];
    for (let i=1; i<vs.length; i++) {
      const a = vs[i-1], b = vs[i], next = vs[i+1];
      if (!valid(a) || !valid(b) || !valid(s.ys[i-1]) || !valid(s.ys[i])) continue;
      if ((a-value)*(b-value)<0) {
        const frac = (value-a)/(b-a);
        hits.push([s.xs[i-1]+frac*(s.xs[i]-s.xs[i-1]),s.ys[i-1]+frac*(s.ys[i]-s.ys[i-1])]);
      } else if (b===value && valid(next) && (a-value)*(next-value)<0) {
        hits.push([s.xs[i],s.ys[i]]);
      }
    }
    return hits;
  };
  const extrema = crossings(s.dy,0), inflections = crossings(s.d2y,0);
  for (let i=1; i<s.ys.length-1; i++) {
    if (valid(s.dy[i]) || ![s.ys[i-1],s.ys[i],s.ys[i+1]].every(valid)) continue;
    if ((s.ys[i-1]-s.ys[i])*(s.ys[i+1]-s.ys[i])>0) extrema.push([s.xs[i],s.ys[i]]);
  }
  for (const [x,y] of extrema.slice(0,12)) items.push(dot(px(x),py(y),"#be531a"));
  for (const [x,y] of inflections.slice(0,12)) items.push(dot(px(x),py(y),"#1c8066"));
  const meanValue = s.meanValue, candidate = meanValue?.point;
  if (meanValue) items.push(line(px(-2),py(meanValue.start),px(2),py(meanValue.end),"#7954a2",true));
  if (candidate) {
    const [x,y] = candidate, half=0.35, secant=meanValue.slope;
    items.push(line(px(x-half),py(y-half*secant),px(x+half),py(y+half*secant),"#7954a2"), dot(px(x),py(y),"#7954a2",3));
  }
  const xx = s.xs[index];
  const k = valid(d) && valid(dd) ? dd / (1+d*d)**1.5 : null;
  if (valid(y)) items.push(dot(px(xx),py(y),"#285a96",5));
  if (k && Math.abs(k) > 1e-6) {
    const r = 1/k, norm = Math.hypot(1,d);
    items.push({ kind:"circle",cx:px(xx-r*d/norm),cy:py(y+r/norm),r:Math.abs(r)*scale,
      fill:"none",stroke:"#be531a",strokeWidth:1.5,opacity:0.66 });
  }
  items.push(label(14,184,"橙点 极值 · 绿点 拐点 · 紫线 [-2, 2] 中值定理"));
  const summary = "x₀="+xx.toFixed(2)+" · "+(valid(k)
    ? "κ="+k.toFixed(3)+(Math.abs(k)>1e-6 ? "，R="+Math.abs(1/k).toFixed(3) : "，局部近似直线")
    : "该点无可用曲率")+" · "+(candidate ? "数值候选 ξ="+candidate[0].toFixed(3) : "未找到可核对的中值点");
  return { data:{ x:xx, value:k, extrema:extrema.length, inflections:inflections.length }, frames:[
    { title:"曲率圆与中值切线", summary, shapes:{ viewBox:[400,195], items } }
  ] };
}`;

export const taylorHeatRule = `function run({ upstream }) {
  ${finite}
  const s = upstream.find(v => v.kind === "function")?.samples;
  if (!s || !s.ys.some(valid)) { ${missing} }
  const x = upstream.find(v => v.kind === "scalar")?.v ?? 0;
  const index = Math.max(0, Math.min(100,Math.round((x+2.5)*20)));
  const center = s.xs[index], terms = s.series[index];
  const resolution = 21;
  const cells = Array.from({length:7}, (_,n) => Array.from({length:resolution}, (_,j) => {
    const i = j*5;
    if (!terms || terms.length<n+2 || !valid(s.ys[i])) return 2;
    let p = terms[n+1], dx = s.xs[i]-center;
    for (let k=n; k>=0; k--) p = p*dx+terms[k];
    return Math.max(-6, Math.min(1,Math.log10(Math.max(1e-6,Math.abs(s.ys[i]-p)))));
  }));
  const order = terms ? terms.length - 1 : 0;
  const summary = "中心 "+center.toFixed(2)+" · "+(order===7
    ? "横轴 x，纵轴阶数 · 绿→红为误差增大"
    : order ? "仅 1–"+order+" 阶可用，灰色为未定义" : "此点无可用泰勒展开，灰色为未定义");
  return { data:{x:center},frames:[{ title:"泰勒绝对误差（log₁₀）",summary,
    grid:{ cells, rowLabels:["1","2","3","4","5","6","7"],
      colLabels:Array.from({length:resolution},(_,i)=>i%5===0 ? String(s.xs[i*5]) : ""),
      palette:"error", min:-6,max:1,showValues:false,activeCell:[2,Math.round(index/5)] } }] };
}`;

export const oscillatorRule = `function run({ params, upstream }) {
  ${line}
  ${label}
  const z = Math.min(1.5,Math.max(0.02,upstream.find(v=>v.kind==="scalar")?.v ?? params.zeta));
  const omega = params.omega, force = params.force;
  const ds = (x,v,t) => force*Math.cos(omega*t)-2*z*v-x;
  const dt = 0.05, samples = [[1,0]];
  let x=1,v=0;
  for (let i=0;i<800;i++) {
    const t=i*dt, v1=v;
    const a=ds(x,v1,t), v2=v+dt*a/2;
    const b=ds(x+dt*v1/2,v2,t+dt/2), v3=v+dt*b/2;
    const c=ds(x+dt*v2/2,v3,t+dt/2), v4=v+dt*c;
    const d=ds(x+dt*v3,v4,t+dt);
    x += dt*(v1+2*v2+2*v3+v4)/6;
    v += dt*(a+2*b+2*c+d)/6;
    samples.push([x,v]);
  }
  const peak = Math.max(1,...samples.map(p=>Math.abs(p[0])));
  const vmax = Math.max(1,...samples.map(p=>Math.abs(p[1])));
  const massScale=Math.min(32,52/peak);
  const mode=z<1 ? "欠阻尼" : z>1 ? "过阻尼" : "临界阻尼";
  const phase = ([x,v]) => [298+77*x/peak,100-61*v/vmax];
  const frames = Array.from({length:41},(_,i)=>{
    const j=i*20, [x,v]=samples[j], mass=120+massScale*x;
    const items=[line(30,50,30,142,"#53657b"),line(30,135,196,135,"#a2acba"), line(219,100,377,100,"#a2acba"),
      line(298,36,298,164,"#a2acba"), label(306,32,"速度 v"), label(344,117,"位移 x")];
    const points = Array.from({length:13},(_,n)=>[30+(mass-46)*n/12,96+(n===0||n===12?0:n%2?7:-7)]);
    for(let n=1;n<points.length;n++) items.push(line(...points[n-1],...points[n],"#285a96"));
    items.push({kind:"rect",x:mass-16,y:80,w:32,h:32,rx:4,fill:"#307d83"});
    const begin=Math.max(0,j-250);
    for(let n=begin;n+4<=j;n+=4) items.push(line(...phase(samples[n]),...phase(samples[n+4]),"#7253a5"));
    const [cx,cy]=phase([x,v]);
    items.push({kind:"circle",cx,cy,r:4,fill:"#be531a"});
    return {title:"受迫阻尼振子",summary:"t="+i+" · "+mode+" ζ="+z.toFixed(2)+" · ω="+omega.toFixed(2)+
      " · 位移 "+x.toFixed(2)+" · 峰值 "+peak.toFixed(2),shapes:{viewBox:[400,170],items}};
  });
  return {data:{value:peak},frames};
}`;

export const odeArenaRule = `function run({ params, upstream }) {
  const h=Math.max(0.05,Math.min(0.8,upstream.find(v=>v.kind==="scalar")?.v ?? params.h)), rate=-3;
  const euler=[1], midpoint=[1], rk4=[1], exact=[1];
  const n=Math.ceil(4/h);
  for(let i=0;i<n;i++) {
    const dt=Math.min(h,4-i*h), r=rate*dt;
    euler.push(euler[i]*(1+r));
    midpoint.push(midpoint[i]*(1+r+r*r/2));
    rk4.push(rk4[i]*(1+r+r*r/2+r**3/6+r**4/24));
    exact.push(Math.exp(rate*Math.min(4,(i+1)*h)));
  }
  const errors=[euler,midpoint,rk4].map(v=>Math.abs(v.at(-1)-exact.at(-1)));
  const lines=[{label:"解析解",values:exact},{label:"Euler",values:euler},
    {label:"中点法",values:midpoint},{label:"RK4",values:rk4}];
  const summary="y′=−3y · h="+h.toFixed(2)+" · t=4 绝对误差 Euler / 中点 / RK4："+errors.map(v=>v.toExponential(1)).join(" / ");
  return { data:{value:errors[2],errors},frames:[
    {title:"同一初值的四条轨迹",summary,series:lines},
    {title:"各步绝对误差（log₁₀）",summary,series:lines.slice(1).map(v=>({
      label:v.label,values:v.values.map((x,i)=>Math.log10(Math.max(1e-14,Math.abs(x-exact[i]))))}))}
  ] };
}`;

const terrain = `const s = upstream.find(v => v.kind === "function2d")?.samples;
  if (!s || !s.values.some(row=>row.some(valid))) { ${missing} }
  const sample = (grid,x,y) => {
    if (Math.abs(x)>3 || Math.abs(y)>3) return null;
    const i=Math.min(29,Math.floor((x+3)*5)),j=Math.min(29,Math.floor((y+3)*5));
    const u=(x-s.xs[i])*5,v=(y-s.ys[j])*5;
    const [a,b,c,d]=[grid[j][i],grid[j][i+1],grid[j+1][i],grid[j+1][i+1]];
    return [a,b,c,d].every(valid) ? (1-v)*(a+(b-a)*u)+v*(c+(d-c)*u) : null;
  };`;

export const lagrangeRule = `function run({ params, upstream }) {
  ${finite}
  ${terrain}
  ${line}
  ${label}
  ${arrow}
  ${dot}
  const r=params.radius, scale=25;
  const px=x=>200+x*scale, py=y=>92-y*scale;
  const points=Array.from({length:240},(_,i)=>{
    const t=2*Math.PI*i/240,x=r*Math.cos(t),y=r*Math.sin(t);
    return {x,y,z:sample(s.values,x,y)};
  }).filter(p=>valid(p.z));
  if (!points.length) { ${missing} }
  const sorted=points.slice().sort((a,b)=>a.z-b.z);
  const min=sorted[0],max=sorted.at(-1);
  const background=[line(118,92,282,92,"#a7b3c1"),line(200,12,200,172,"#a7b3c1"), {
    kind:"circle",cx:200,cy:92,r:r*scale,fill:"none",stroke:"#7253a5",strokeWidth:2
  }, dot(px(min.x),py(min.y),"#285a96"),dot(px(max.x),py(max.y),"#be531a"),
  label(10,18,"蓝点 约束最小 · 橙点 约束最大")];
  const frames=[["最小",min],["最大",max]].map(([mode,p])=>{
    const items=background.slice();
    for(let j=0;j<30;j++) for(let i=0;i<30;i++){
      const corners=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
      const crossings=[];
      for(let k=0;k<4;k++){
        const [a,b]=corners[k],[c,d]=corners[(k+1)%4];
        const u=s.values[b][a],v=s.values[d][c];
        if(valid(u)&&valid(v)&&(u<p.z)!==(v<p.z)){
          const t=(p.z-u)/(v-u);
          crossings.push([px(s.xs[a]+t*(s.xs[c]-s.xs[a])),py(s.ys[b]+t*(s.ys[d]-s.ys[b]))]);
        }
      }
      if (items.length<145 && crossings.length>=2) items.push(line(...crossings[0],...crossings[1],"#539681"));
    }
    const fx=sample(s.dx,p.x,p.y),fy=sample(s.dy,p.x,p.y);
    const size=Math.hypot(fx??0,fy??0), x=px(p.x),y=py(p.y);
    items.push(arrow(x,y,x+30*p.x/r,y-30*p.y/r,"#7253a5"));
    if(valid(fx)&&valid(fy)&&size>1e-8) items.push(arrow(x,y,x+22*fx/size,y-22*fy/size,"#be531a"));
    const tangent = size>1e-8 ? (-fx*p.y+fy*p.x)/(r*size) : 0;
    items.push(label(10,180,"紫 ∇g · 橙 ∇f · 绿为目标等值线"));
    return {title:"约束"+mode+"候选",summary:"r="+r.toFixed(2)+" · 约束"+mode+" f≈"+p.z.toFixed(3)+
      " · "+(size>1e-8 ? "切向分量/‖∇f‖≈"+tangent.toFixed(3) : "∇f≈0，方向不定"),
      shapes:{viewBox:[400,190],items}};
  });
  return {data:{min:min.z,max:max.z},frames};
}`;

export const gradientDescentRule = `function run({ params, upstream }) {
  ${finite}
  ${terrain}
  ${line}
  ${dot}
  ${label}
  const eta=Math.max(0.02,Math.min(0.45,upstream.find(v=>v.kind==="scalar")?.v ?? params.eta));
  const trace=[];
  let x=params.startX,y=params.startY, status="达到迭代上限";
  for(let i=0;i<=24;i++) {
    const z=sample(s.values,x,y),dx=sample(s.dx,x,y),dy=sample(s.dy,x,y);
    if(![z,dx,dy].every(valid)){
      status=Math.max(Math.abs(x),Math.abs(y))>3 ? "越出可视范围" : "梯度不可用";
      break;
    }
    trace.push([x,y,z]);
    if(Math.hypot(dx,dy)<1e-5){ status=i===0?"起点梯度为零":"梯度已接近零"; break; }
    x-=eta*dx;
    y-=eta*dy;
  }
  const grid=s.values.filter((_,i)=>i%3===0).slice().reverse().map(row=>row.filter((_,i)=>i%3===0));
  const range=grid.flat().filter(valid), min=range.length?Math.min(...range):0, max=range.length?Math.max(...range):1;
  const cells=grid.map(row=>row.map(v=>v??max));
  const loss=trace.map(v=>v[2]), point=(p)=>[78+22*p[0],78-22*p[1]];
  const frames=(trace.length ? trace : [[params.startX,params.startY,0]]).map((p,i)=>{
    const items=[line(12,78,144,78,"#aebbd0"),line(78,12,78,144,"#aebbd0"),
      {kind:"rect",x:12,y:12,w:132,h:132,fill:"none",stroke:"#aebbd0"},
      label(146,82,"x"),label(80,12,"y")];
    for(let j=1;j<=i;j++) items.push(line(...point(trace[j-1]),...point(trace[j]),"#2f7488"));
    items.push(dot(...point(p),"#be531a",5));
    const col=Math.round((p[0]+3)/0.6),row=Math.round((3-p[1])/0.6);
    return {title:"梯度下降轨迹",summary:"η="+eta.toFixed(2)+" · 第 "+i+" 步 · "+
      (trace.length?"f≈"+p[2].toFixed(3):"起点超出有效域")+" · "+(i===trace.length-1||!trace.length?status:"沿负梯度更新"),
      shapes:{viewBox:[156,156],items},
      grid:{cells, min,max,showValues:false,activeCell:[row,col],palette:"heat"},
      series:loss.length?[{label:"完整 Loss",values:loss},{label:"已播放",values:loss.slice(0,i+1)}]:[]};
  });
  return {data:{value:trace.at(-1)?.[2]??null,steps:Math.max(0,trace.length-1),status},frames};
}`;

export const convergenceRule = `function run({ params, upstream }) {
  const N=Math.max(1,Math.min(25,Math.round(upstream.find(v=>v.kind==="scalar")?.v ?? params.count)));
  const geometric=[],harmonic=[],power=[],pSeries=[];
  let a=0,b=0,c=0,d=0;
  for(let k=1;k<=N;k++){
    a+=0.5**(k-1);
    b+=1/k;
    c+=params.x**(k-1);
    d+=1/k**params.p;
    geometric.push(a);
    harmonic.push(b);
    power.push(c);
    pSeries.push(d);
  }
  const summary="N="+N+" · x="+params.x.toFixed(2)+" · p="+params.p.toFixed(1)+
    " · 幂级数 Σxᵏ（从 k=0 起）："+(Math.abs(params.x)<1?"收敛":"发散");
  return {data:{value:c},frames:[{title:"四种部分和",summary,series:[
    {label:"等比 1/2",values:geometric},{label:"调和级数",values:harmonic},
    {label:"p-级数",values:pSeries},{label:"幂级数",values:power}]}]};
}`;

export const denoiseRule = `function run({ params, upstream, rand }) {
  const cutoff=Math.max(1,Math.min(25,Math.round(upstream.find(v=>v.kind==="scalar")?.v ?? params.count)));
  const L=80, t=Array.from({length:L},(_,i)=>i*2*Math.PI/L);
  const clean=t.map(x=>Math.sin(x)+0.45*Math.sin(3*x+0.2)+0.21*Math.cos(4*x));
  const noisy=t.map((x,i)=>clean[i]+params.noise*(0.75*Math.sin(18*x)+0.45*
    Math.sqrt(-2*Math.log(Math.max(1e-9,rand())))*Math.cos(2*Math.PI*rand())));
  const re=[],im=[];
  for(let k=0;k<=L/2;k++){
    re.push(noisy.reduce((sum,v,i)=>sum+v*Math.cos(k*t[i]),0)/L);
    im.push(noisy.reduce((sum,v,i)=>sum+v*Math.sin(k*t[i]),0)/L);
  }
  const filtered=t.map(x=>{
    let v=re[0];
    for(let k=1;k<=cutoff;k++) v+=2*(re[k]*Math.cos(k*x)+im[k]*Math.sin(k*x));
    return v;
  });
  const signal=clean.reduce((sum,v)=>sum+v*v,0);
  const snr=arr=>10*Math.log10(signal/Math.max(1e-12,arr.reduce((sum,v,i)=>sum+(v-clean[i])**2,0)));
  const before=snr(noisy),after=snr(filtered);
  const summary="保留 0–"+cutoff+" 阶 · 信噪比 "+before.toFixed(1)+" → "+after.toFixed(1)+" dB";
  const amplitude=re.map((v,k)=>Math.hypot(v,im[k])*(k===0||k===L/2?1:2));
  return {data:{value:after,snrBefore:before},frames:[
    {title:"时域波形",summary,series:[{label:"参考信号",values:clean},{label:"带噪信号",values:noisy},{label:"截断重建",values:filtered}]},
    {title:"频谱幅值",summary,series:[{label:"原频谱",values:amplitude},{label:"保留频谱",values:amplitude.map((v,k)=>k<=cutoff?v:0)}]}
  ]};
}`;
