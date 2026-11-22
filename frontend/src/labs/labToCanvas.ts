/** 把已核对完成的实验室题目编译成万象工坊积木；不可映射的题型明确返回 null。 */
import { build408Pipeline, find408Stage } from '../canvas/lab408Pipeline.ts';
import { isOsPageLabel, osPageAlgorithms, osPageCapacity } from '../canvas/lab408PipelineOs.ts';
import { nextId } from '../canvas/math.ts';
import type { CanvasDoc, CanvasNode, NodeType, Wire } from '../canvas/types.ts';
import { compileExpression } from './expr.ts';
import { MANUAL_408_SUBJECTS } from './manual408.ts';
import type { LabProblem, LabState } from './types.ts';

export interface LabCanvasCompile {
  doc: CanvasDoc;
  summary: string;
}

function expression(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numeric(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const matches = value.match(/-?\d+(?:\.\d+)?/g);
    const last = matches?.at(-1);
    if (last !== undefined) {
      const parsed = Number(last);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function textNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function matrixParams(matrix: number[][] | null | undefined): Record<string, number> | null {
  if (!Array.isArray(matrix) || matrix.length !== 2) return null;
  const [first, second] = matrix;
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 2 || second.length !== 2) return null;
  const values = [first[0], first[1], second[0], second[1]].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return { a: values[0]!, b: values[1]!, c: values[2]!, d: values[3]! };
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}][\p{L}\d_-]*$/u.test(value);
}

function originalOsPipeline(problem: LabProblem, seed: Record<string, unknown>, title: string, note: string): LabCanvasCompile | null {
  const model = problem.model;
  const defaults = model.defaults;
  const missing = (id: string) => problem.recognition.conditions.some(condition => condition.id === id && condition.provenance === 'supplement');

  if (model.os_kind === 'page_replace') {
    const caseIndex = (value: unknown) => osPageAlgorithms.findIndex(algorithm => algorithm === String(value).toLowerCase());
    const originalAlgorithm = caseIndex(defaults.algorithm);
    const algorithm = caseIndex(seed.algorithm ?? defaults.algorithm);
    const originalCapacity = boundedInteger(defaults.frames, 1, osPageCapacity);
    const capacity = boundedInteger(seed.frames ?? defaults.frames, 1, osPageCapacity);
    const windowValue = seed.window ?? defaults.window;
    const window = windowValue === undefined ? null : boundedInteger(windowValue, 1, 60);
    const reference = model.reference;
    const initial = model.initial_frames === undefined ? [] : model.initial_frames;
    if (originalAlgorithm < 0 || algorithm < 0 || originalCapacity === null || capacity === null || missing('frames') || missing('algorithm')
      || (windowValue !== undefined && window === null)
      || !Array.isArray(reference) || !reference.length || reference.length > 60 || !reference.every(isOsPageLabel)
      || !Array.isArray(initial) || !initial.every(isOsPageLabel) || new Set(initial).size !== initial.length
      || initial.length > Math.min(originalCapacity, capacity)) return null;
    const originalLabel = `${osPageAlgorithms[originalAlgorithm]!.toUpperCase()} · ${originalCapacity} 块`;
    const doc = build408Pipeline('pageReplaceOriginal', `${title} · 页面置换实验`,
      `${note}\n\n题设置换条件 ${originalLabel}。对照分支从空块开始，用相同访问序列观察不同算法与容量。`);
    doc.nodes.find(node => node.payload === 'pageReplaceOriginal/references')!.text = reference.join(',');
    const branch = doc.nodes.find(node => node.payload === 'pageReplaceOriginal/original')!;
    branch.text = initial.join(',');
    branch.params = { ...branch.params, algorithm, capacity, ...(window === null ? {} : { window }) };
    return { doc, summary: '已生成页面置换对照与题设支路' };
  }

  if (model.os_kind === 'cpu_schedule') {
    const supported = ['fcfs', 'sjf', 'srtf', 'rr'];
    const original = String(defaults.algorithm ?? '').toLowerCase();
    const algorithm = String(seed.algorithm ?? original).toLowerCase();
    const quantumValue = seed.quantum ?? defaults.quantum;
    const quantum = boundedInteger(quantumValue, 1, 10);
    const originalQuantum = boundedInteger(defaults.quantum, 1, 10);
    const processes = model.processes;
    if (!supported.includes(original) || !supported.includes(algorithm) || missing('algorithm') || model.has_priority
      || (original === 'rr' && (originalQuantum === null || missing('quantum')))
      || (quantumValue !== undefined && quantum === null) || (algorithm === 'rr' && quantum === null)
      || !Array.isArray(processes) || !processes.length || processes.some(process => !process || !identifier(process.id)
        || (process.priority !== undefined && process.priority !== null)
        || !Number.isSafeInteger(process.arrival) || !Number.isSafeInteger(process.burst))) return null;
    const label = `${original.toUpperCase()}${original === 'rr' ? `（时间片 ${originalQuantum}）` : ''}`;
    const doc = build408Pipeline('cpuScheduleLab', `${title} · CPU 调度实验`, `${note}\n\n题设调度算法 ${label}。`);
    const source = doc.nodes.find(node => node.payload === 'cpuScheduleLab/processes')!;
    source.text = processes.map(({ id, arrival, burst }) => `${id} ${arrival} ${burst}`).join('\n');
    if (!find408Stage(source)?.stage.run({ text: source.text, params: {}, upstream: [] }).data.processes) return null;
    if (quantum !== null) doc.nodes.find(node => node.payload === 'cpuScheduleLab/rr')!.params.quantum = quantum;
    const focused = doc.nodes.find(node => node.payload === `cpuScheduleLab/${algorithm}`)!;
    doc.panel?.view_node_ids.unshift(focused.id);
    return { doc, summary: '已生成 CPU 调度对照与题设进程表' };
  }

  if (model.os_kind === 'banker') {
    const { names, resources, available, allocation, request } = model;
    if (!Array.isArray(names) || !names.length || !names.every(identifier) || new Set(names).size !== names.length
      || !Array.isArray(available) || !available.length || !Array.isArray(allocation) || allocation.length !== names.length) return null;
    const width = available.length;
    const vector = (value: unknown, max = 999): value is number[] => Array.isArray(value) && value.length === width
      && value.every(item => typeof item === 'number' && boundedInteger(item, 0, max) !== null);
    const matrix = (value: unknown, max = 999): value is number[][] => Array.isArray(value) && value.length === names.length
      && value.every(row => vector(row, max));
    if (!vector(available) || !matrix(allocation)) return null;
    if (resources !== undefined && (!Array.isArray(resources) || resources.length !== width || !resources.every(isOsPageLabel)
      || new Set(resources).size !== resources.length)) return null;
    const maximum = 'max' in model ? model.max : undefined;
    if (maximum != null && !matrix(maximum, 1998)) return null;
    const computedNeed = maximum?.map((row, index) => row.map((value, dimension) => value - allocation[index]![dimension]!));
    const need = model.need ?? computedNeed;
    if (!matrix(need) || (computedNeed && need.some((row, index) => row.some((value, dimension) => value !== computedNeed[index]![dimension])))) return null;
    const mode = seed.request_mode ?? defaults.request_mode ?? (request ? 'apply' : 'ignore');
    if ((mode !== 'apply' && mode !== 'ignore') || (request && (!names.includes(request.process) || !vector(request.vector)))
      || (mode === 'apply' && !request)) return null;
    const doc = build408Pipeline('bankerLab', `${title} · 银行家算法实验`, note);
    const source = doc.nodes.find(node => node.payload === 'bankerLab/resources')!;
    source.text = [
      ...(resources ? [`Resources: ${resources.join(',')}`] : []),
      `Available: ${available.join(',')}`,
      ...names.map((name, index) => `${name} ${allocation[index]!.join(',')} | ${need[index]!.join(',')}`),
    ].join('\n');
    if (!find408Stage(source)?.stage.run({ text: source.text, params: {}, upstream: [] }).data.resources) return null;
    const requestNode = doc.nodes.find(node => node.payload === 'bankerLab/request')!;
    requestNode.text = request ? `${request.process}: ${request.vector.join(',')}` : '';
    requestNode.params.requestEnabled = mode === 'apply' || !request ? 1 : 0;
    return { doc, summary: '已生成银行家算法的题设资源表与安全性检查' };
  }
  return null;
}

/**
 * 只编译能逐项对应的题型：
 * - 高数：导数/函数研究、积分、极限、泰勒；
 * - 线代：2×2 矩阵；
 * - 408：完整结构化操作系统题接入专题管线，其余预填原题文字。
 * 其余题型返回 null，由调用方提示“该题型暂不支持一键拆解”。
 */
export function compileLabToCanvas(
  problem: LabProblem,
  state?: Pick<LabState, 'params'> | null,
): LabCanvasCompile | null {
  if (problem.status !== 'ready') return null;
  const model = problem.model;
  const seed = state?.params ?? {};
  const title = problem.title || '真题拆解';
  const nodes: CanvasNode[] = [];
  const wires: Wire[] = [];
  const add = (type: NodeType, x: number, y: number, params: Record<string, number> = {}, text?: string): string => {
    const id = nextId('n');
    nodes.push({ id, type, x, y, params, ...(text !== undefined ? { text } : {}) });
    return id;
  };
  const connect = (from: string, to: string, toPort = 'in'): void => {
    wires.push({ id: nextId('w'), from, to, toPort });
  };
  const answer = problem.solution.answer || problem.solution.summary || '见原题计算结果';
  const source = problem.source?.label ? `\n来源：${problem.source.label}` : '';
  const note = `${title}\n原题：${problem.text}\n${source}\n\n内核答案（冻结）：${answer}\n\n下面的积木是原题的沙盒拆解，可自由改参数；原题文字与答案不会被覆盖。`;
  if (problem.subject === 'operating_system') {
    const compiled = originalOsPipeline(problem, seed, title, note);
    if (compiled) return compiled;
  }
  add('textNote', 30, 24, {}, note);

  if (problem.subject === 'calculus') {
    const kind = model.kind;
    const task = model.task;
    if ((kind === 'integral' || kind === 'antiderivative' || task === 'taylor') && expression(model.expression ?? model.integrand)) {
      const formula = expression(model.expression ?? model.integrand)!;
      try {
        compileExpression(formula, ['x']);
      } catch {
        return null;
      }
      const sourceId = add('functionSource', 40, 250, { a: 1, b: 0, c: 0 }, formula);
      const lower = numeric(seed.lower ?? model.defaults.lower, 0);
      const upper = numeric(seed.upper ?? model.defaults.upper, 1);
      const n = Math.max(4, Math.round(numeric(seed.n ?? model.defaults.n, 12)));
      connect(sourceId, add('integral', 400, 250, { lower, upper, n, method: 1, area: 0 }));
      const center = numeric(seed.point ?? model.taylor_point_value ?? model.defaults.center, 0);
      const degree = Math.max(1, Math.round(numeric(seed.order ?? model.order ?? model.defaults.order, 3)));
      const taylorId = add('taylor', 400, 640, { center, degree, x: center + 0.5, span: 2 });
      connect(sourceId, taylorId);
      connect(taylorId, add('integral', 850, 640, { lower, upper, n, method: 1, area: 0 }));
      if (kind === 'taylor') {
        connect(taylorId, add('functionPlot', 850, 250, { min: lower - 1, max: upper + 1, x: center + 0.5 }));
        add('textNote', 1250, 640, {}, '双路对照\n同一区间上比较原函数积分与泰勒多项式积分，并移动图像观察局部近似范围。');
      } else {
        add('textNote', 850, 250, {}, '进阶彩蛋\n把函数源改成 |f(x)| 或交换上下限，观察定积分与几何面积的区别；再对照泰勒多项式的积分。');
      }
    } else if (kind === 'derivative' || kind === 'function_study' || kind === 'higher_derivative') {
      const formula = expression(model.expression);
      if (!formula) return null;
      try {
        compileExpression(formula, ['x']);
      } catch {
        return null;
      }
      const sourceId = add('functionSource', 40, 250, { a: 1, b: 0, c: 0 }, formula);
      const point = numeric(seed.point ?? model.derivative_point ?? model.defaults.x0, 1);
      const sliderId = add('slider', 40, 650, { v: point, min: -5, max: 5 });
      const derivativeId = add('derivative', 400, 250, { x: point, h: numeric(seed.h ?? model.defaults.h, 0.5) });
      connect(sourceId, derivativeId);
      connect(sliderId, derivativeId, 'x');
      connect(sourceId, add('functionPlot', 850, 250, { min: point - 3, max: point + 3, x: point }));
      connect(derivativeId, add('spark', 1250, 250));
    } else if (kind === 'limit') {
      const formula = expression(model.expression);
      if (!formula) return null;
      try {
        compileExpression(formula, ['x']);
      } catch {
        return null;
      }
      const sourceId = add('functionSource', 40, 250, { a: 1, b: 0, c: 0 }, formula);
      const point = numeric(seed.point ?? model.limit_point_value ?? model.limit_point ?? model.defaults.x0, 0);
      const sliderId = add('slider', 40, 650, { v: point, min: -5, max: 5 });
      connect(sourceId, add('functionPlot', 400, 250, { min: point - 3, max: point + 3, x: point }));
      const probeId = add('limitProbe', 850, 250, { x: point, side: 0 });
      connect(sourceId, probeId);
      connect(sliderId, probeId, 'x');
      if (model.modeling_task === 'parameter_limit') {
        add('textNote', 1250, 250, {}, `参数解：${model.parameter ?? 'a'}=${model.parameter_value ?? '?'}
移动滑块观察 x 趋近 ${point} 时的函数值，核对是否等于题给极限 ${model.target_value ?? ''}。
图像使用的是代回参数后的函数；原式与参数方程见“原稿对照”。`);
      }
    } else {
      return null;
    }
    add('textNote', 30, 980, {}, '我的观察记录\n我改了哪些参数：\n我先预测：\n实际观察到：\n哪些结论仍需回到原题核验：');
    return {
      doc: { version: 1, title: `${title} · 工坊实验`, zoom: 0.8, nodes, wires, strokes: [] },
      summary: '已生成高数探究积木链',
    };
  }

  if (problem.subject === 'linear_algebra' && model.la_kind) {
    const first = matrixParams(model.matrix_a);
    if (!first) return null;
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      if (typeof seed[key] === 'number' && Number.isFinite(seed[key])) first[key] = seed[key] as number;
    }
    const matrixA = add('matrixSource', 40, 250, first);
    let output = matrixA;
    if (model.la_kind === 'matmul') {
      const second = matrixParams(model.matrix_b);
      if (!second) return null;
      const matrixB = add('matrixSource', 40, 560, second);
      const matmul = add('matmul', 360, 380, {});
      connect(matrixA, matmul, 'A');
      connect(matrixB, matmul, 'B');
      output = matmul;
    }
    connect(output, add('transformView', 700, 120, {}));
    connect(output, add('detGauge', 1180, 120, {}));
    connect(output, add('eigRead', 1180, 360, {}));
    connect(output, add('squareView', 700, 580, {}));
    connect(output, add('quiz', 1180, 600, {}));
    add('textNote', 40, 860, {}, '进阶彩蛋\n修改矩阵元素，观察面积缩放 |det|、特征向量方向与单位正方形的像。预测闸门会先让你猜 |det| 再揭示。');
    return {
      doc: { version: 1, title: `${title} · 矩阵实验`, zoom: 0.8, nodes, wires, strokes: [] },
      summary: '已生成 2×2 矩阵几何积木',
    };
  }

  if (['algorithm', 'computer_organization', 'operating_system', 'computer_network'].includes(problem.subject)) {
    const subjectIndex = MANUAL_408_SUBJECTS.findIndex((subject) => subject.id === problem.subject);
    if (subjectIndex < 0) return null;
    add('lab408Workbench', 40, 300, { subjectIndex, typeIndex: 0 }, problem.text);
    add('textNote', 560, 300, {}, '408 探究说明\n原题文字已预填进工作台；如题型识别不匹配，可在工作台内切换题型后再运行本地内核。专有积木只在能完整承载原题数据时启用，避免用固定示例覆盖原题。');
    return {
      doc: { version: 1, title: `${title} · 408 实验`, zoom: 0.85, nodes, wires, strokes: [] },
      summary: '已生成 408 全题型工作台积木',
    };
  }

  if (problem.subject === 'physics') {
    const kind = String(model.physics_kind ?? '');
    const mode = String(model.physics_mode ?? '');
    const defaults = model.defaults ?? {};
    let sourceType: NodeType | null = null;
    let params: Record<string, number> = {};
    if (kind === 'kinematics' && /projectile|抛/.test(`${mode} ${problem.text}`)) {
      const angle = numeric(
        seed.angle ?? defaults.angle ?? textNumber(problem.text, /(?:抛射角|仰角|角度)\s*[=为]?\s*(-?\d+(?:\.\d+)?)\s*°/),
        NaN,
      );
      const height = numeric(
        seed.h0 ?? defaults.h0 ?? textNumber(problem.text, /(?:初始高度|抛出高度|h0)\s*[=为]?\s*(-?\d+(?:\.\d+)?)/),
        0,
      );
      // 工坊抛体节点没有初始高度参数，且角度滑杆为 5°–85°；
      // 平抛/带初始高度题直接返回 null，避免把原题改成另一道题。
      if (!Number.isFinite(angle) || angle < 5 || angle > 85 || Math.abs(height) > 1e-9) return null;
      sourceType = 'projectile';
      params = {
        v0: numeric(seed.v0 ?? defaults.v0 ?? textNumber(problem.text, /(?:初速度|v0)\s*[=为]?\s*(-?\d+(?:\.\d+)?)/), 8),
        angle,
        g: numeric(seed.g ?? defaults.g, 9.8),
        m: numeric(seed.m ?? defaults.m, 1),
        running: numeric(seed.running, 1),
      };
    } else if (kind === 'oscillation' && /弹簧|spring/.test(`${mode} ${problem.text}`)) {
      sourceType = 'springOsc';
      params = {
        k: numeric(seed.k ?? defaults.k, 6),
        m: numeric(seed.m ?? defaults.m, 1),
        x0: numeric(
          seed.x0 ?? defaults.x0 ?? textNumber(problem.text, /(?:初始位移|振幅|x0)\s*[=为]?\s*(-?\d+(?:\.\d+)?)/),
          1,
        ),
        running: numeric(seed.running, 1),
      };
    } else if (kind === 'oscillation' && /单摆|pendulum/.test(`${mode} ${problem.text}`)) {
      sourceType = 'pendulum';
      params = {
        L: numeric(seed.L ?? defaults.L, 1.5),
        theta0: numeric(
          seed.theta0 ?? defaults.theta0 ?? textNumber(problem.text, /(?:初始角|摆角|θ0|theta0)\s*[=为]?\s*(-?\d+(?:\.\d+)?)/),
          25,
        ),
        g: numeric(seed.g ?? defaults.g, 9.8),
        m: numeric(seed.m ?? defaults.m, 1),
        running: numeric(seed.running, 1),
      };
    }
    if (!sourceType) return null;
    const sourceId = add(sourceType, 40, 250, params);
    connect(sourceId, add('trailView', 400, 250, {}));
    connect(sourceId, add('energyMeter', 660, 250, {}));
    add('textNote', 40, 620, {}, `物理实验积木\n原题：${problem.text}\n\n内核答案（冻结）：${answer}\n\n拖动源节点参数观察运动、轨迹与能量变化；工坊结果不替代原题核验。`);
    return {
      doc: { version: 1, title: `${title} · 物理实验`, zoom: 0.85, nodes, wires, strokes: [] },
      summary: '已生成力学实验积木',
    };
  }

  if (problem.subject === 'optimization') {
    const variables = model.variables ?? [];
    const formula = expression(model.expression);
    if (variables.length !== 1 || variables[0] !== 'x' || !formula) return null;
    try {
      compileExpression(formula, ['x']);
    } catch {
      return null;
    }
    const sourceId = add('functionSource', 40, 250, { a: 1, b: 0, c: 0 }, formula);
    const start = numeric(seed.x0 ?? defaultsValue(model.defaults, 'x0'), 0);
    const xMin = numeric(model.domain?.x_min, -5);
    const xMax = numeric(model.domain?.x_max, 5);
    const sliderId = add('slider', 40, 650, { v: start, min: xMin, max: xMax });
    const plotId = add('functionPlot', 400, 250, { min: xMin, max: xMax, x: start });
    connect(sourceId, plotId);
    connect(sliderId, plotId, 'x');
    connect(sourceId, add('spark', 850, 250));
    add('textNote', 400, 620, {}, `一维最优化积木\n原题：${problem.text}\n\n内核答案（冻结）：${answer}\n\n拖动滑杆改变起点，观察函数值与局部形态；这不是原题梯度轨迹的替代。`);
    return {
      doc: { version: 1, title: `${title} · 最优化实验`, zoom: 0.85, nodes, wires, strokes: [] },
      summary: '已生成一维优化积木',
    };
  }

  return null;
}

function defaultsValue(defaults: Record<string, unknown> | undefined, key: string): unknown {
  return defaults?.[key];
}

export function canCompileLabToCanvas(problem: LabProblem): boolean {
  return compileLabToCanvas(problem) !== null;
}
