/** Exam geometry and implicit normals share the verified symbolic model. */
import { compileExpression, formatNumber } from './expr.ts';
import type { CalculusPoint, CalculusResult, LabModel } from './types.ts';

type Quantity = { id: string; label: string; value: number; exact: string; latex?: string };
type ExamModel = LabModel & {
  reference_quantities?: Quantity[];
  point_x?: string;
  partial_y?: string;
  vertical_normal?: boolean;
  region_kind?: 'vertical_inequality' | 'between_axis';
  effective_intervals?: string[][];
};

// SymPy prints Euler's constant as E, while the shared whitelist uses e.
function expression(source: string) {
  return source.replace(/\bE\b/g, 'e').replace(/\bAbs\(/g, 'abs(');
}

function scalar(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    try {
      return compileExpression(expression(value), ['x']).evalOrNull({x: 0}) ?? fallback;
    } catch { return fallback; }
  }
  return fallback;
}

export function evaluateExamMath(model: LabModel, params: Record<string, unknown>): CalculusResult | null {
  if (!['geometric_area', 'area_volume', 'implicit_normal'].includes(model.task ?? '')) return null;
  const exam = model as ExamModel;
  if (model.task === 'implicit_normal') return normal(exam);
  if (!exam.reference_quantities?.length) throw new Error('请先核对区域函数与完整积分区间。');
  const compiled = compileExpression(expression(model.expression ?? ''), ['x']);
  const evaluate = (x: number) => {
    const value = compiled.evalOrNull({x});
    return exam.region_kind === 'vertical_inequality' && value !== null && value < 0 ? null : value;
  };
  const lower = scalar(model.defaults.lower, 0);
  const upper = scalar(model.defaults.upper, 1);
  const n = Math.max(2, Math.min(80, Math.round(scalar(params.n ?? model.defaults.n, 16))));
  const series = Array.from({length: 260}, (_,index) => {
    const x = lower+(upper-lower)*index/259;
    return {x, y:evaluate(x)};
  });
  const rects = Array.from({length:n}, (_,index) => {
    const x0 = lower+(upper-lower)*index/n;
    const x1 = lower+(upper-lower)*(index+1)/n;
    const mid = (x0+x1)/2;
    return {x0,x1,mid,height:evaluate(mid) ?? 0};
  });
  const quantities = exam.reference_quantities ?? [];
  const volumePreview = quantities[0]?.id === 'volume';
  const approximation = rects.reduce((sum,rect) => sum+(volumePreview ? Math.PI*rect.height**2 : Math.abs(rect.height))*(rect.x1-rect.x0),0);
  const reference = quantities[0]?.value ?? null;
  const answerText = quantities.map(q => `${q.label} = ${q.exact}`).join('；');
  const notes = [exam.region_kind === 'vertical_inequality'
    ? '不等式 0≤y≤f(x) 只在 f(x)≥0 时有非空纤维；负值区间不参与面积或旋转体积。'
    : '曲线与矩形展示几何区域；面积逐段取绝对值，旋转体积使用 πf(x)²。'];
  if (model.improper_upper) notes.push(`原题上界为 +∞，图形及矩形在 x=${formatNumber(upper)} 截断；面积与体积指标为原题完整解析值。`);
  return {
    subject:'calculus', kind:'integral', headline:answerText || '几何区域预览',
    metrics: quantities.map(q => ({id:q.id,label:`${q.label}解析值`,value:formatNumber(q.value)})),
    checks:[], notes,
    trace:quantities.map((q,index) => ({index,label:q.label,detail:q.exact,values:{[q.id]:q.value}})),
    domain:{x_min:lower,x_max:upper},series,rects,exact:reference,approx:approximation,
    error:reference === null ? null : Math.abs(reference-approximation),answerText,
  };
}

function normal(model: ExamModel): CalculusResult {
  if (model.point_y === undefined || model.point_y === null) throw new Error('请先核对曲线研究点与分支。');
  const implicit = compileExpression(expression(model.implicit_expression ?? model.expression ?? ''), ['x','y']);
  const fy = model.partial_y ? compileExpression(expression(model.partial_y), ['x','y']) : null;
  const px = scalar(model.point_x ?? model.defaults.point,0);
  const py = scalar(model.point_y,0);
  const vertical = model.vertical_normal === true;
  const slope = vertical ? null : scalar(model.normal_slope, NaN);
  const evaluate = (x:number,y:number) => implicit.evalOrNull({x,y});
  function branch(x:number,initial:number): number | null {
    let y = initial;
    for (let iteration=0; iteration<35; iteration+=1) {
      const value = evaluate(x,y);
      if (value === null) return null;
      if (Math.abs(value)<1e-10) return y;
      const epsilon = 1e-5;
      const left = evaluate(x,y-epsilon);
      const right = evaluate(x,y+epsilon);
      const derivative = fy?.evalOrNull({x,y}) ?? (left !== null && right !== null ? (right-left)/(2*epsilon) : null);
      if (derivative === null || Math.abs(derivative)<1e-12) return null;
      const next = y-value/derivative;
      if (!Number.isFinite(next) || Math.abs(next-initial)>1) return null;
      y=next;
    }
    return null;
  }
  const series:CalculusPoint[] = [];
  for (const direction of [-1,1]) {
    let current = py;
    const half:CalculusPoint[] = [];
    for (let i=1; i<=80; i+=1) {
      const x = px+direction*i/80;
      const y = branch(x,current);
      if (y !== null) current=y;
      half.push({x,y});
    }
    series.push(...(direction<0 ? half.reverse() : [{x:px,y:py},...half]));
  }
  const answerText = vertical ? `法线 x=${formatNumber(px)}` : `法线斜率 ${model.normal_slope}`;
  const validSlope = slope !== null && Number.isFinite(slope);
  return {
    subject:'calculus',kind:'derivative',headline:answerText,
    metrics:[{id:'normal_slope',label:'法线斜率',value:vertical ? '不存在（竖直法线）' : formatNumber(slope)}],
    checks:[],notes:['仅展示经过已核对研究点的局部隐式曲线分支；叠加直线为法线。'],
    trace:[{index:0,label:'曲线研究点',detail:answerText,values:{x:px,y:py,slope}}],
    domain:{x_min:px-1,x_max:px+1},series,rects:[],exact:validSlope ? slope : null,
    approx:validSlope ? slope : null,error:validSlope ? 0 : null,answerText,
    ...(validSlope ? {point:{x:px,y:py,slope,tangent:{m:slope,b:py-slope*px}}} : {}),
  };
}
