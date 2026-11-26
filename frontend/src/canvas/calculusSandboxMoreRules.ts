/** Rules visualize the bounded results of the expression parser, never evaluate expression text. */
import { dot, label, line } from './calculusSandboxRules.ts';

const waitFrame = 'return { data: {}, frames: [{ title: "等待函数源", summary: "接入有效的函数源后开始计算。" }] };';
const findSamples = 'const s = upstream.find(v => v.kind === "function")?.samples;';

export const infinitesimalRaceRule = `function run({ upstream }) {
  ${findSamples}
  if (!s?.approaches) { ${waitFrame} }
  const hs = s.approaches.map(r=>r.h);
  const log = n => Math.log10(Math.max(1e-15,Math.abs(n)));
  const series = [
    {label:"|h| · 一阶",values:hs.map(log)},
    {label:"h² · 二阶",values:hs.map(h=>log(h*h))},
    {label:"1−cos(h) · 二阶",values:hs.map(h=>log(2*Math.sin(h/2)**2))},
  ];
  if (Number.isFinite(s.level) && s.approaches.every(r=>Number.isFinite(r.right))) {
    if (Number.isFinite(s.atZero)) {
      series.push({label:"当前 |f(h)−f(0)|",values:s.approaches.map(r=>log(r.right-s.atZero))});
    } else {
      const last=s.approaches.at(-1);
      const uncertainty=4*Math.max(Math.abs(last.left-s.level),Math.abs(last.right-s.level));
      const distances=s.approaches.map(r=>Math.abs(r.right-s.level));
      const stop=distances.findIndex(v=>v<=uncertainty);
      const supported=stop<0?distances:distances.slice(0,stop);
      if (supported.length) series.push({label:"当前 |f(h)−L估计|",values:supported.map(log)});
    }
  }
  const summary = "h 从 10⁻¹ 缩到 10⁻⁶ · 对数图中二阶每步约下降 2。 ε="+s.eps+"，δ="+(s.delta??"无稳定候选");
  return { data:{delta:s.delta}, frames:[{title:"无穷小阶数对照（log₁₀）",summary,series}] };
}`;

export const discontinuityRule = `function run({ upstream }) {
  ${findSamples}
  if (!s?.xs) { ${waitFrame} }
  ${line}
  ${dot}
  ${label}
  const valid = Number.isFinite, blue="#285a96", muted="#bbc6d3", green="#21816a", orange="#bd571e";
  const fmt = v => valid(v) ? Number(v.toPrecision(6)).toString() : "—";
  let status;
  if (valid(s.level)) {
    status = !valid(s.atZero)||Math.abs(s.atZero-s.level)>0.002*Math.max(1,Math.abs(s.level))
      ? "可去间断迹象" : "函数值与双侧候选一致";
  } else {
    status = valid(s.left)&&valid(s.right) ? "左右不同，跳跃间断迹象" : "振荡、发散或单侧样本尚未稳定";
  }
  const center = s.level ?? 0;
  const extent = Math.max(0.7,s.eps*1.3,...s.ys.filter(valid).map(y=>Math.min(3,Math.abs(y-center))));
  const px = x => 205+x*96, py = y => 96-(Math.max(-extent,Math.min(extent,y-center)))*69/extent;
  const items = [line(31,py(0),378,py(0),muted),line(205,21,205,167,muted)];
  if (valid(s.level)) {
    const ya=py(center+s.eps),yb=py(center-s.eps);
    items.push({kind:"rect",x:32,y:ya,w:345,h:yb-ya,fill:"#d5eee4"});
    if (valid(s.delta)) {
      const a=px(-s.delta),b=px(s.delta);
      items.push({kind:"rect",x:a,y:21,w:b-a,h:146,fill:"#a5ddc9",opacity:0.45},
        line(a,22,a,166,green,true),line(b,22,b,166,green,true));
    }
  }
  for (let i=1;i<s.xs.length;i++) {
    if (s.xs[i-1]<0&&s.xs[i]>=0 || s.xs[i-1]===0) continue;
    if (valid(s.ys[i-1])&&valid(s.ys[i])) items.push(line(px(s.xs[i-1]),py(s.ys[i-1]),px(s.xs[i]),py(s.ys[i]),blue));
  }
  if (valid(s.level)) items.push({kind:"circle",cx:px(0),cy:py(s.level),r:4,fill:"#fff",stroke:blue,strokeWidth:1.5});
  if (valid(s.atZero)) items.push(dot(px(0),py(s.atZero),orange,3.5));
  items.push(label(25,187,"横带 L±ε · 竖带 |x|<δ · 空心点表示极限候选"));
  const title="x₀=0 附近的间断与 ε–δ 邻域";
  const summary=status+" · L₋="+fmt(s.left)+" · L₊="+fmt(s.right)+" · f(0)="+fmt(s.atZero)+
    " · ε="+fmt(s.eps)+" · δ="+fmt(s.delta)+"（有限采样）";
  const frames = [{title,summary,shapes:{viewBox:[400,200],items}}];
  const xMark = x => 32+(x+1.5)*272;
  const {root,frames:brackets,issue} = s.brackets;
  const selected = brackets.filter((_,i)=>i<10 || i%3===0 || i===brackets.length-1);
  if (!selected.length) selected.push(null);
  for (const bracket of selected) {
    const hints=[line(32,96,372,96,muted),label(21,124,"−1.5"),label(345,124,"−0.25")];
    const end = bracket === selected.at(-1);
    if (bracket) {
      hints.push(line(xMark(bracket.left),96,xMark(bracket.right),96,green),
        dot(xMark(bracket.middle),96,orange,4),label(20,37,"绿色：当前夹逼区间 · 橙点：本步中点"),
        label(20,158,"区间宽度："+fmt(bracket.right-bracket.left)));
    }
    const detail = bracket
      ? "m="+fmt(bracket.middle)+" · "+(valid(bracket.value)?"f(m)="+fmt(bracket.value):"中点无定义，停止夹逼")+
        (end && root===null && valid(bracket.value)?" · 未核到有限零点":"")
      : valid(root)?"端点 m="+fmt(root)+" 为零点":issue??"端点未形成异号夹逼";
    frames.push({title:"二分法夹逼独立区间内的零点",summary:detail+"（夹逼需函数连续）",shapes:{viewBox:[400,180],items:hints}});
  }
  return {data:{delta:s.delta,root},frames};
}`;

export const chainRule = `function run({ upstream }) {
  ${findSamples}
  if (!s || !("innerStep" in s)) { ${waitFrame} }
  ${line}
  ${label}
  const fmt = v => Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : "—";
  const product = s.derivative===null ? null : s.derivative*s.innerDerivative;
  const increment = [s.composedStep,s.atZero].every(Number.isFinite) ? s.composedStep-s.atZero : null;
  const blue="#285a96", green="#21816a";
  const box = (x,name,val) => [
    {kind:"rect",x,y:41,w:102,h:66,rx:6,fill:"#e6eff9",stroke:blue},
    label(x+8,66,name),label(x+8,90,val)
  ];
  const items=[
    ...box(15,"第一步  Δx","h="+fmt(s.h)),
    ...box(149,"内层  Δg","g(h)="+fmt(s.innerStep)),
    ...box(283,"外层  Δ(f∘g)",fmt(increment)),
    {...line(122,74,142,74,green),kind:"arrow"},{...line(254,74,275,74,green),kind:"arrow"},
    label(16,132,"g(x)=2x+x²，g′(0)="+s.innerDerivative+"  ·  外层函数 f 取自上游"),
    label(16,157,"局部倍率：g′(0) × f′(g(0)) = "+fmt(product)),
  ];
  const summary = product===null ? "外层导数不可用；可观察实际复合增量。"
    : "复合差商 "+fmt(increment===null?null:increment/s.h)+" · 链式法则的导数乘积 "+fmt(product);
  return {data:{derivative:product,increment},frames:[{title:"链式法则两级放大器",summary,shapes:{viewBox:[400,174],items}}]};
}`;

export const differentialRule = `function run({ upstream }) {
  ${findSamples}
  if (!s?.ys) { ${waitFrame} }
  ${line}
  ${dot}
  ${label}
  const fmt = v=>Number.isFinite(v)?Number(v.toPrecision(5)).toString():"—";
  const valid=Number.isFinite;
  const actual = valid(s.atStep)&&valid(s.atZero)?s.atStep-s.atZero:null;
  const linear = valid(s.derivative)?s.derivative*s.h:null;
  const residual = valid(actual)&&valid(linear)?actual-linear:null;
  const ys=s.ys.map(y=>valid(y)&&valid(s.atZero)?y-s.atZero:null);
  const scale=Math.max(1e-12,...ys.filter(valid).map(Math.abs),Math.abs(linear??0));
  const px=i=>31+300*i/20, py=y=>86-59*y/scale;
  const items=[line(31,86,365,86,"#bbc6d3"),line(31,16,31,154,"#bbc6d3")];
  for(let i=1;i<ys.length;i++) if(valid(ys[i-1])&&valid(ys[i]))
    items.push(line(px(i-1),py(ys[i-1]),px(i),py(ys[i]),"#285a96"));
  if(valid(linear)) items.push(line(31,86,331,py(linear),"#21816a",true),dot(331,py(linear),"#21816a"));
  if(valid(actual)) items.push(dot(331,py(actual),"#285a96"));
  if(valid(residual)) items.push(line(331,py(linear),331,py(actual),"#bd571e"));
  items.push(label(31,175,"蓝 Δy · 绿 dy · 橙 Δy−dy（纵轴随图缩放）"));
  const summary="h="+fmt(s.h)+" · Δy="+fmt(actual)+" · dy="+fmt(linear)+" · |Δy−dy|="+fmt(valid(residual)?Math.abs(residual):null)+
    " · |余差|/h²="+fmt(valid(residual)?Math.abs(residual)/(s.h*s.h):null);
  return {data:{delta:actual,linear,error:valid(residual)?Math.abs(residual):null},
    frames:[{title:"微分余差放大镜",summary,shapes:{viewBox:[400,189],items}}]};
}`;

export const quadratureRule = `function run({ upstream }) {
  ${findSamples}
  if (!s?.meshes) { ${waitFrame} }
  const estimates=s.meshes.filter(m=>m.values.every(Number.isFinite)).map(({n,values})=>{
    let left=0,mid=0,trapezoid=0,simpson=0;
    for(let i=0;i<n;i++){
      const a=values[2*i], b=values[2*i+1], c=values[2*i+2];
      left+=a; mid+=b; trapezoid+=(a+c)/2;
      if(i%2===0) simpson+=a+4*c+values[2*i+4];
    }
    return {n,left:left/n,mid:mid/n,trapezoid:trapezoid/n,simpson:simpson/(3*n)};
  });
  const current=estimates.find(m=>m.n===s.selected);
  if(!current||!Number.isFinite(s.reference)) return {data:{},frames:[
    {title:"求积参考不可用",summary:"在 [0,1] 的采样中遇到无定义值或超出有限范围。"}
  ]};
  const methods=[["左端点","left"],["中点","mid"],["梯形","trapezoid"],["Simpson","simpson"]];
  const series=methods.map(([label,key])=>({label, values:estimates.map(row=>Math.log10(Math.max(1e-15,Math.abs(row[key]-s.reference))))}));
  const summary="n="+current.n+" · 参考 "+s.reference.toPrecision(6)+" · 绝对误差（依图例） "+
    methods.map(([,k])=>Math.abs(current[k]-s.reference).toExponential(2)).join(" / ");
  return {data:{...current,reference:s.reference},
    frames:[{title:"求积误差（log₁₀），n = "+estimates.map(row=>row.n).join(" / "),summary,series}]};
}`;

export const improperIntegralRule = `function run({ params, upstream }) {
  const p=Math.max(0.5,Math.min(2,upstream.find(v=>v.kind==="scalar")?.v??params.power));
  const critical=p===1, converges=p>1, limit=converges?1/(p-1):null;
  const logs=Array.from({length:81},(_,i)=>i*Math.log(10000)/80);
  const integral=logs.map(t=>critical?t:Math.expm1((1-p)*t)/(1-p));
  const series=[{label:"从 1 到 R 的积分",values:integral}];
  if (converges && limit<=5*integral.at(-1)) series.push({label:"无穷上限的积分值",values:logs.map(()=>limit)});
  const summary="p="+p.toFixed(2)+" · R=10⁴ 时累积 "+integral.at(-1).toFixed(3)+" · "+
    (converges?"收敛至 "+limit.toFixed(3):critical?"发散，按 ln(R) 增长":"发散，按 R^(1−p) 阶增长");
  return {data:{converges,limit,total:integral.at(-1)},frames:[
    {title:"p=1 临界线 · 横轴 log(R)",summary,series},
    {title:"被积函数 R⁻ᵖ · 横轴 log(R)",summary,series:[{label:"R⁻ᵖ",values:logs.map(t=>Math.exp(-p*t))}]}
  ]};
}`;
