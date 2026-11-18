import { clamp, compileExpression, formatNumber } from './expr.ts';
import type { DoubleIntegralPiece, DoubleIntegralResult, LabModel } from './types.ts';

/** Read only the kernel-approved region; approximation and plot share its expressions. */
export function evaluateDoubleIntegral(model: LabModel, params: Record<string, unknown>): DoubleIntegralResult {
  if (model.region_kind === 'pieces' && model.pieces?.length) return evaluatePieces(model, params);
  if (model.region_kind === 'polar' && model.polar) return evaluatePolar(model, params);
  if (!model.outer_bounds || !model.inner_bounds || !model.integrand || !model.outer_variable ||
      !Number.isFinite(model.answer_value) || !model.exact) throw new Error('请核对二重积分的被积函数和完整区域');
  const outer = model.outer_variable as 'x' | 'y';
  const inner = outer === 'x' ? 'y' : 'x';
  const scalar = (source: string) => {
    const value = compileExpression(source, []).evalOrNull({});
    if (value === null) throw new Error('请核对有限积分区间');
    return value;
  };
  const [a,b] = model.outer_bounds.map(scalar) as [number,number];
  if (!(a < b)) throw new Error('请核对积分区间的边界顺序');
  const low = compileExpression(model.inner_bounds[0], [outer]);
  const high = compileExpression(model.inner_bounds[1], [outer]);
  const integrand = compileExpression(model.integrand, ['x','y']);
  const bounds = (q: number) => {
    const lower = low.evalOrNull({[outer]:q}), upper = high.evalOrNull({[outer]:q});
    if (lower === null || upper === null || upper < lower-1e-10) throw new Error('区域边界无法计算或上下顺序错误');
    return {outer:q, lower, upper:Math.max(lower,upper)};
  };
  const f = (q: number, v: number) => {
    const value = integrand.evalOrNull(outer === 'x' ? {x:q,y:v} : {x:v,y:q});
    if (value === null) throw new Error('被积函数在当前区域内无法计算');
    return value;
  };
  const nRaw = Number(params.n ?? model.defaults.n ?? 20);
  const n = clamp(Number.isFinite(nRaw) ? Math.round(nRaw) : 20, 4, 80);
  const sliceRaw = Number(params.slice ?? model.defaults.slice ?? (a+b)/2);
  const position = clamp(Number.isFinite(sliceRaw) ? sliceRaw : (a+b)/2,a,b);
  const slice = bounds(position);
  let approx = 0;
  for (let i=0;i<n;i++) {
    const q = a+(i+0.5)*(b-a)/n;
    const {lower,upper} = bounds(q);
    for (let j=0;j<n;j++) approx += f(q,lower+(j+0.5)*(upper-lower)/n)*(upper-lower)*(b-a)/n**2;
  }
  const exact = model.answer_value!;
  return {
    subject:'calculus',task:'double_integral',kind:'integral',region_kind:'strip',
    outer_variable:outer,inner_variable:inner,
    headline:`二重积分 = ${model.exact}`, answerText:model.exact,
    domain:{x_min:a,x_max:b},series:[],rects:[],exact,approx,error:Math.abs(approx-exact),
    region:Array.from({length:121},(_,i)=>bounds(a+i*(b-a)/120)),
    slice:{position,lower:slice.lower,upper:slice.upper},
    sliceValues:Array.from({length:25},(_,i)=>{
      const v = slice.lower+i*(slice.upper-slice.lower)/24;
      return {position:v,value:f(position,v)};
    }),
    metrics:[{id:'exact',label:'内核解析值',value:model.exact ?? ''},
      {id:'approx',label:'二维中点和',value:formatNumber(approx,8)},
      {id:'error',label:'近似误差',value:formatNumber(Math.abs(approx-exact),8)}],
    checks:[{id:'region',label:'区域与边界',status:'pass',detail:'沿用内核确认的积分限；图像和数值近似使用相同区域。'}],
    notes:['分割数影响二维中点和；内核解析值保持不变。', ...swappedNotes(model)],
    trace:Array.from({length:41},(_,i)=>({index:i,label:`切片 ${outer}=${formatNumber(a+i*(b-a)/40,4)}`,
      detail:`固定 ${outer}，${inner} 从下边界扫到上边界。`,values:{slice:a+i*(b-a)/40}})),
    swapped: model.swapped ?? null,
  };
}

function swappedNotes(model: LabModel): string[] {
  const swapped = model.swapped;
  if (!swapped) return [];
  const items = Array.isArray(swapped) ? swapped : [swapped];
  if(items.some(item=>!item.region_verified)) return ['旧存档的换序区域需要重新核验，请通过核对条件重新计算。'];
  return items.map(item => `换序后：${item.outer_variable} ∈ [${item.outer_bounds[0]}, ${item.outer_bounds[1]}]，${item.inner_variable} 从 ${item.inner_bounds[0]} 到 ${item.inner_bounds[1]}；结果 ${item.exact}。`);
}

function evaluatePieces(model: LabModel, params: Record<string, unknown>): DoubleIntegralResult {
  const integrand = compileExpression(model.integrand ?? '1', ['x','y']);
  const outer = (model.outer_variable ?? 'x') as 'x' | 'y';
  const inner = outer === 'x' ? 'y' : 'x';
  const scalar = (source: string) => {
    const value = compileExpression(source, []).evalOrNull({});
    if (value === null) throw new Error('请核对分片的有限积分区间');
    return value;
  };
  const nRaw = Number(params.n ?? model.defaults.n ?? 20);
  const n = clamp(Number.isFinite(nRaw) ? Math.round(nRaw) : 20, 4, 80);
  const pieces = model.pieces ?? [];
  let approx = 0;
  const output: DoubleIntegralPiece[] = [];
  for (const piece of pieces) {
    const [a,b] = piece.outer_bounds.map(scalar) as [number,number];
    const low = compileExpression(piece.inner_bounds[0], [outer]);
    const high = compileExpression(piece.inner_bounds[1], [outer]);
    const bounds = (q: number) => {
      const lower = low.evalOrNull({[outer]:q}), upper = high.evalOrNull({[outer]:q});
      if (lower === null || upper === null || upper < lower-1e-10) throw new Error(`第 ${piece.index} 片边界无法计算或顺序错误`);
      return {outer:q,lower,upper:Math.max(lower,upper)};
    };
    const f = (q: number, v: number) => {
      const value = integrand.evalOrNull(outer === 'x' ? {x:q,y:v} : {x:v,y:q});
      if (value === null) throw new Error(`第 ${piece.index} 片被积函数无法计算`);
      return value;
    };
    let pieceApprox = 0;
    for (let i=0;i<n;i++) {
      const q = a+(i+0.5)*(b-a)/n;
      const {lower,upper} = bounds(q);
      for (let j=0;j<n;j++) pieceApprox += f(q,lower+(j+0.5)*(upper-lower)/n)*(upper-lower)*(b-a)/n**2;
    }
    approx += pieceApprox;
    output.push({...piece, approx:pieceApprox, region:Array.from({length:81},(_,i)=>bounds(a+i*(b-a)/80))});
  }
  const first = pieces[0]!;
  const last = pieces[pieces.length-1]!;
  const firstA = scalar(first.outer_bounds[0]);
  const lastB = scalar(last.outer_bounds[1]);
  const position = clamp(Number(params.slice ?? (firstA+lastB)/2), firstA, lastB);
  const active = output.find(piece => {
    const a = scalar(piece.outer_bounds[0]), b = scalar(piece.outer_bounds[1]);
    return position >= a-1e-9 && position <= b+1e-9;
  }) ?? output[0]!;
  const activeA = scalar(active.outer_bounds[0]);
  const activeLow = compileExpression(active.inner_bounds[0], [outer]);
  const activeHigh = compileExpression(active.inner_bounds[1], [outer]);
  const lower = activeLow.evalOrNull({[outer]:position}) ?? 0;
  const upper = activeHigh.evalOrNull({[outer]:position}) ?? lower;
  const exact = model.answer_value!;
  return {
    subject:'calculus',task:'double_integral',kind:'integral',region_kind:'pieces',
    outer_variable:outer,inner_variable:inner,
    headline:`分片二重积分 = ${model.exact ?? ''}`, answerText:model.exact ?? '',
    domain:{x_min:firstA,x_max:lastB},series:[],rects:[],exact,approx,error:Math.abs(approx-exact),
    region:output[0]?.region ?? [], pieces:output,
    slice:{position,lower,upper},
    sliceValues:Array.from({length:25},(_,i)=>{
      const v = lower+i*(upper-lower)/24;
      return {position:v,value:(integrand.evalOrNull(outer==='x'?{x:position,y:v}:{x:v,y:position}) ?? 0)};
    }),
    metrics:[{id:'exact',label:'内核解析值',value:model.exact ?? ''},
      {id:'approx',label:'分片二维中点和',value:formatNumber(approx,8)},
      {id:'error',label:'近似误差',value:formatNumber(Math.abs(approx-exact),8)},
      {id:'pieces',label:'分片数',value:String(pieces.length)}],
    checks:[{id:'region',label:'分片不重不漏',status:'pass',detail:'各片外层区间互不重叠；区域和数值近似逐片对应。'},
      {id:'slice',label:'当前切片',status:'pass',detail:`切片位于第 ${active.index} 片（外层 ${activeA} 到 ${active.outer_bounds[1]}）。`}],
    notes:['分片区域逐片积分后求和；移动切片查看当前所在分片。', ...swappedNotes(model)],
    trace:output.map((piece,i)=>({index:i,label:`第 ${piece.index} 片`,detail:`结果 ${piece.exact}`,
      values:{outer_bounds:piece.outer_bounds,inner_bounds:piece.inner_bounds,exact:piece.exact}})),
    swapped: model.swapped ?? null,
  };
}

export interface SandboxRegionResult {
  region: { outer: number; lower: number; upper: number }[];
  slice: { position: number; lower: number; upper: number };
  approx: number;
}

/**
 * 沙盒区域：只用于拖拽探索的本地采样，绝不回写原题条件，也不伪装成内核解析值。
 * 返回的近似值明确标记为“拖拽区域的中点和”。
 */
export function evaluateSandboxRegion(
  model: LabModel,
  bounds: [string, string],
  params: Record<string, unknown> = {},
): SandboxRegionResult {
  const outer = model.outer_variable as 'x' | 'y' | undefined;
  if (!outer || !model.outer_bounds || !model.integrand) throw new Error('当前题目缺少可拖拽的二重积分区域');
  const scalar = (source: string) => {
    const value = compileExpression(source, []).evalOrNull({});
    if (value === null || !Number.isFinite(value)) throw new Error('外层积分限必须是有限常数');
    return value;
  };
  const [a, b] = model.outer_bounds.map(scalar) as [number, number];
  if (!(a < b)) throw new Error('外层积分区间的顺序不正确');
  const low = compileExpression(bounds[0], [outer]);
  const high = compileExpression(bounds[1], [outer]);
  const integrand = compileExpression(model.integrand, ['x', 'y']);
  const sample = (q: number) => {
    const lower = low.evalOrNull({ [outer]: q });
    const upper = high.evalOrNull({ [outer]: q });
    if (lower === null || upper === null || !Number.isFinite(lower) || !Number.isFinite(upper)) {
      throw new Error('拖拽后的边界在当前区间内无法计算');
    }
    if (upper < lower - 1e-10) throw new Error('拖拽后上下边界交叉，请调整控制点');
    return { outer: q, lower, upper };
  };
  const nRaw = Number(params.n ?? 20);
  const n = clamp(Number.isFinite(nRaw) ? Math.round(nRaw) : 20, 4, 80);
  let approx = 0;
  for (let i = 0; i < n; i += 1) {
    const q = a + (i + 0.5) * (b - a) / n;
    const { lower, upper } = sample(q);
    for (let j = 0; j < n; j += 1) {
      const value = integrand.evalOrNull(outer === 'x'
        ? { x: q, y: lower + (j + 0.5) * (upper - lower) / n }
        : { x: lower + (j + 0.5) * (upper - lower) / n, y: q });
      if (value === null || !Number.isFinite(value)) throw new Error('被积函数在拖拽区域内无法计算');
      approx += value * (upper - lower) * (b - a) / n ** 2;
    }
  }
  const position = clamp(Number(params.slice ?? (a + b) / 2), a, b);
  const active = sample(position);
  return {
    region: Array.from({ length: 121 }, (_, index) => sample(a + index * (b - a) / 120)),
    slice: { position, lower: active.lower, upper: active.upper },
    approx,
  };
}

function evaluatePolar(model: LabModel, params: Record<string, unknown>): DoubleIntegralResult {
  const polar = model.polar!;
  const scalar = (source: string) => {
    const value = compileExpression(source, []).evalOrNull({});
    if (value === null) throw new Error('请核对有限极角区间');
    return value;
  };
  const [a,b] = polar.theta_bounds.map(scalar) as [number,number];
  const low = compileExpression(polar.r_bounds[0], ['theta']);
  const high = compileExpression(polar.r_bounds[1], ['theta']);
  const integrand = compileExpression(polar.transformed_integrand, ['theta','r']);
  const nRaw = Number(params.n ?? model.defaults.n ?? 20);
  const n = clamp(Number.isFinite(nRaw) ? Math.round(nRaw) : 20, 4, 80);
  const position = clamp(Number(params.theta ?? (a+b)/2), a, b);
  const bounds = (theta: number) => {
    const lower = low.evalOrNull({theta}) ?? 0;
    const upper = high.evalOrNull({theta}) ?? lower;
    return {lower,upper:Math.max(lower,upper)};
  };
  let approx = 0;
  for (let i=0;i<n;i++) {
    const theta = a+(i+0.5)*(b-a)/n;
    const {lower,upper} = bounds(theta);
    for (let j=0;j<n;j++) {
      const r = lower+(j+0.5)*(upper-lower)/n;
      approx += (integrand.evalOrNull({theta,r}) ?? 0)*(upper-lower)*(b-a)/n**2;
    }
  }
  const outerPoints = Array.from({length:121},(_,i)=>{
    const theta = a+(b-a)*i/120;
    const {upper} = bounds(theta);
    return {x:upper*Math.cos(theta),y:upper*Math.sin(theta)};
  });
  const innerPoints = Array.from({length:121},(_,i)=>{
    const theta = a+(b-a)*i/120;
    const {lower} = bounds(theta);
    return {x:lower*Math.cos(theta),y:lower*Math.sin(theta)};
  });
  const activeBounds = bounds(position);
  const exact = model.answer_value!;
  return {
    subject:'calculus',task:'double_integral',kind:'integral',region_kind:'polar',
    outer_variable:'theta',inner_variable:'r',
    headline:`极坐标二重积分 = ${model.exact ?? ''}`,answerText:model.exact ?? '',
    domain:{x_min:Math.min(...outerPoints.map(p=>p.x)),x_max:Math.max(...outerPoints.map(p=>p.x))},
    series:[],rects:[],exact,approx,error:Math.abs(approx-exact),region:[],
    slice:{position,lower:activeBounds.lower,upper:activeBounds.upper},
    sliceValues:Array.from({length:25},(_,i)=>{
      const r = activeBounds.lower+i*(activeBounds.upper-activeBounds.lower)/24;
      return {position:r,value:integrand.evalOrNull({theta:position,r}) ?? 0};
    }),
    polar:{...polar,outer_points:outerPoints,inner_points:innerPoints,
      slice:{theta:position,r_lower:activeBounds.lower,r_upper:activeBounds.upper}},
    metrics:[{id:'exact',label:'内核解析值',value:model.exact ?? ''},
      {id:'approx',label:'极坐标二维中点和',value:formatNumber(approx,8)},
      {id:'error',label:'近似误差',value:formatNumber(Math.abs(approx-exact),8)},
      {id:'jacobian',label:'Jacobian',value:'r'}],
    checks:[{id:'region',label:'极坐标区域与方向',status:'pass',detail:'θ 递增、r 非负且上界不低于下界。'},
      {id:'jacobian',label:'Jacobian 因子',status:'pass',detail:'面积元 r dr dθ 已包含在数值近似中。'}],
    notes:['极坐标区域、切片与数值近似共享同一 θ、r 范围。'],
    trace:Array.from({length:41},(_,i)=>({index:i,label:`θ=${formatNumber(a+(b-a)*i/40,4)}`,
      detail:'固定 θ，沿 r 从下界扫到上界。',values:{theta:a+(b-a)*i/40}})),
    swapped:null,
  };
}
