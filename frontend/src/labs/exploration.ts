import { compileExpression, formatNumber } from './expr.ts';
import type { LabProblem, LabResult } from './types.ts';

export function observe(problem: LabProblem, params: Record<string, unknown>, result: LabResult): LabResult {
  if (result.subject === 'calculus' && result.space && problem.model.params?.some(p => p.id === 'view_yaw')) {
    return {...result,space:{...result.space,view_yaw:Number(params.view_yaw ?? 0),view_zoom:Number(params.view_zoom ?? 1)}};
  }
  if (!problem.model.params?.some(p => p.id === 'view_radius')) return result;
  if (result.subject === 'optimization' && result.kind === 'constrained_extrema') {
    const x = Number(params.probe_x ?? 0), y = Number(params.probe_y ?? 0);
    const radius = Number(params.view_radius ?? 3);
    const value = compileExpression(problem.model.expression ?? '0', ['x','y']).evalOrNull({x,y});
    return { ...result, domain: {x_min:x-radius,x_max:x+radius,y_min:y-radius,y_max:y+radius}, metrics: [...result.metrics, {id:'probe',label:'观察点函数值（未必满足约束）',value:formatNumber(value)}] };
  }
  if (result.subject !== 'calculus') return result;
  const model = problem.model;
  const radius = Math.max(0.1, Math.min(10, Number(params.view_radius ?? 3)));
  if (model.modeling_task === 'continuity') {
    const point = Number(model.limit_point_value ?? 0);
    const value = Number(params.point_value ?? model.defaults.point_value ?? 0);
    const continuity = problem.solution.continuity;
    const read = (source?: string) => { try { return compileExpression(source ?? '', []).evalOrNull({}); } catch { return null; } };
    const left = read(continuity?.left.text), right = read(continuity?.right.text);
    const equal = left !== null && right !== null && Math.abs(left - right) < 1e-8 && Math.abs(left - value) < 1e-8;
    const f = compileExpression(model.expression ?? '0', [model.variable ?? 'x']);
    const series = Array.from({length:201},(_,i) => { const x=point-radius+2*radius*i/200;return {x,y:Math.abs(x-point)<1e-12?null:f.evalOrNull({[model.variable ?? 'x']:x})}; });
    return { ...result, series, domain: { x_min: point - radius, x_max: point + radius },
      metrics: [...result.metrics, { id: 'point_value', label: '实验点值 f(a)', value: formatNumber(value) },
        { id: 'continuity', label: '实验点连续性', value: equal ? '点值与有限双侧极限相等' : '点值与有限双侧极限不相等' }],
      overlays: [{ id: 'point_value', label: '实验点值', series: [{ x: point, y: value }] }],
      notes: [...result.notes, '点值滑杆仅改变实验中的 f(a)，原题结论保持不变。'] };
  }
  const variables = model.variables?.length ? model.variables : [model.variable ?? 'x'];
  const source = model.task === 'power_series' ? model.observation_expression ?? problem.solution.sum_function ?? problem.solution.polynomial ?? model.expression : model.expression;
  if (!source) return result;
  const point = Object.fromEntries(variables.map(v => [v, Number(params[`probe_${v}`] ?? 0)]));
  const axis = variables[0]!;
  try {
    const compiled = compileExpression(source, variables);
    const series = Array.from({ length: 201 }, (_, i) => {
      const x = point[axis]! - radius + 2 * radius * i / 200;
      return { x, y: compiled.evalOrNull({ ...point, [axis]: x }) };
    });
    return { ...result, series, domain: { x_min: point[axis]! - radius, x_max: point[axis]! + radius },
      metrics: [...result.metrics, { id: 'probe', label: '观察点函数值', value: formatNumber(compiled.evalOrNull(point)) }],
      notes: [...result.notes, ...(model.observation_partial ? ['曲线是前20项有限部分和；不代表收敛区间外存在和函数，也不替代端点判别。'] : []), `沿 ${axis} 轴的函数切片；其余坐标固定为滑杆值。观察不替代极值或约束证明。`] };
  } catch { return { ...result, notes: [...result.notes, '该表达式暂不能数值绘图，符号结论见原题结果。'] }; }
}
