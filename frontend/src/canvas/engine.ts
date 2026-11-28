/**
 * engine.ts —— 画布对象图求值器
 *
 * 端口上的值不是存出来的，是**沿连线向源回溯算出来的**：
 * 源节点产 PortValue → 变换节点（rotor/matmul）先取输入再求输出 → 视图只消费。
 * 支持任意深度的 源→变换→…→视图 链；`cache` 按渲染周期去重，`visiting` 防环。
 *
 * 活动值通道 `live`：ticker / 物理自闭钟每帧产新值但不写 doc（否则每秒几十次
 * 落盘），由 CanvasBoard 的 rAF 写进 live Map，求值器从这里取。
 *
 * 自制积木（composite）：边界由 portIn/portOut 节点表达——portOut 的 id 就是
 * 外层端口 id，`evalOutput(ctx, id, portId)` 按端口求值（普通节点只有 'out'，
 * 行为不变）；求值时把外层输入注入 `boundary` 建一个子 ctx，内部照常回溯。
 * 子 ctx 与父级共享 `visiting`，跨层环同样被截断。
 */
import type { CanvasDoc, CanvasNode, PortValue } from './types.ts';
import { mul2, paramsM, rot2, IDENT } from './math.ts';
import { PHYS_TYPES, bodyAt, physCycle, type PhysNodeType } from './physics.ts';
import { functionValue, function2dValue, compileFunction, derivativeAt, integrate, approachLimit, taylorPolynomial } from './calculus.ts';
import { sampleDiskDensity } from './calculusDisk.ts';
import { vectorFieldValue } from './calculusField.ts';
import { DEEP_NODE_TYPES, validDeepValue } from './deepPorts.ts';
import { isStudyStage, studyOutput } from './studyStages.ts';
import { deepFirstOutput } from './deepFirst.ts';
import { deepCoreOutput, mlpSetup } from './deepCore.ts';
import { deepAdvancedOutput } from './deepAdvanced.ts';
import { evaluate408Stage } from './lab408Pipeline.ts';
import { evaluatePhysicsStage } from './physicsPipeline.ts';
import { evaluateCalculusStage } from './calculusPipeline.ts';
import { evaluateBusinessStage } from './businessPipeline.ts';
import { evaluateDeepStage, evaluateDeepStageMetric } from './deepPipeline.ts';
import {
  businessTableSeries,
  discountSeries,
  growthSeries,
  scenarioSeries,
  weightedDecision,
} from './officeBlocks.ts';
import { emFieldFromParams, opticsField, rlcWaveform, thermoCycle } from './physicsBlocks.ts';
import { combineFunctions, probabilitySeries, svd2x2 } from './calculusBlocks.ts';
import { arrayFromParams, graphFromText, memoryAddressStream, pageRefStream } from './lab408Blocks.ts';
import {
  DEFAULT_LORA_MATRIX,
  DEFAULT_LOSS_PREDICTIONS,
  DEFAULT_QUANT_MATRIX,
  loraApprox,
  lossProbe,
  probabilityVector,
  quantizeMatrix,
  sanitizeMatrix,
} from './deepModernBlocks.ts';

export interface EvalCtx {
  doc: CanvasDoc;
  live: Map<string, PortValue>;
  /** portIn 节点 id → 外层注入的值（仅子 ctx 使用） */
  boundary: Map<string, PortValue>;
  /** 复合节点 id → 其子求值上下文（同一次渲染周期内复用） */
  subs: Map<string, EvalCtx>;
  cache: Map<string, PortValue | null>;
  visiting: Set<string>;
}

export function makeCtx(doc: CanvasDoc, live: Map<string, PortValue>): EvalCtx {
  return { doc, live, boundary: new Map(), subs: new Map(), cache: new Map(), visiting: new Set() };
}

/** 求某节点输出端口的当前值；`portId` 缺省 'out'（普通节点唯一输出口） */
export function evalOutput(ctx: EvalCtx, nodeId: string, portId = 'out'): PortValue | null {
  const key = `${nodeId}|${portId}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key) ?? null;
  if (ctx.visiting.has(key)) return null; // 成环：该路径没有值
  const node = ctx.doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  ctx.visiting.add(key);
  const out = compute(ctx, node, portId);
  ctx.visiting.delete(key);
  ctx.cache.set(key, out);
  return out;
}

function evalInput(ctx: EvalCtx, node: CanvasNode, portId: string): PortValue | null {
  const w = ctx.doc.wires.find(
    (x) => x.to === node.id && (x.toPort ?? 'in') === portId,
  );
  if (!w) return null;
  return evalOutput(ctx, w.from, w.fromPort ?? 'out');
}

/** 复合节点的子求值上下文：外层输入经 boundary 注入，同一 ctx 周期内复用 */
export function getSubCtx(ctx: EvalCtx, node: CanvasNode): EvalCtx | null {
  const sub = node.sub;
  if (!sub) return null;
  const hit = ctx.subs.get(node.id);
  if (hit) return hit;
  const boundary = new Map<string, PortValue>();
  for (const p of sub.ports) {
    if (p.dir !== 'in') continue;
    const v = evalInput(ctx, node, p.id);
    if (v) boundary.set(p.id, v);
  }
  const c: EvalCtx = {
    doc: { version: 1, title: '', nodes: sub.nodes, wires: sub.wires, strokes: [], zoom: 1 },
    live: ctx.live,
    boundary,
    cache: new Map(),
    visiting: ctx.visiting,
    subs: new Map(),
  };
  ctx.subs.set(node.id, c);
  return c;
}

const subCtxOf = getSubCtx;

function compute(ctx: EvalCtx, node: CanvasNode, portId: string): PortValue | null {
  if (isStudyStage(node.type)) {
    const input = (port: string) => evalInput(ctx, node, port);
    if (node.type === 'studyOptim' && ['地形', '起点 x', '起点 y', '学习率', '步数'].every((id) => input(id)?.kind === 'scalar')) {
      const live = ctx.live.get(`${node.id}|step`);
      if (live?.kind === 'scalar' && live.v >= 0) {
        return studyOutput(node, (id) => id === '步数' ? live : input(id), portId);
      }
    }
    return studyOutput(node, input, portId);
  }
  if (DEEP_NODE_TYPES.has(node.type)) {
    const input = (port: string) => evalInput(ctx, node, port);
    if (node.params.wired) {
      if (node.type === 'mlpTrainer' && (input('in')?.kind !== 'dataset2d' || !mlpSetup(node, input))) return null;
      if (node.type === 'svmLab' && (input('in')?.kind !== 'dataset2d' || input('control')?.kind !== 'scalar')) return null;
      if (node.type === 'qLearningLab') {
        const env = input('environment');
        if (env?.kind !== 'tensor2d' || env.data.length !== 6 || !env.data.every((row) => row.length === 6)
          || ['control', 'mode', 'gamma', 'alpha'].some((id) => input(id)?.kind !== 'scalar')) return null;
      }
    }
    const runtime = ctx.live.get(`${node.id}|${portId}`);
    if (runtime && validDeepValue(runtime)) return runtime;
    try {
      const value = deepFirstOutput(node, input, portId) ?? deepCoreOutput(node, input, portId) ?? deepAdvancedOutput(node, input, portId);
      return validDeepValue(value) ? value : null;
    } catch {
      return null;
    }
  }
  switch (node.type) {
    case 'lab408Stage':
      return portId === 'out' ? evaluate408Stage(node, (id) => evalInput(ctx, node, id)) : null;
    case 'physicsStage':
      return portId === 'out' ? evaluatePhysicsStage(node, (id) => evalInput(ctx, node, id)) : null;
    case 'calculusStage':
      return portId === 'out' ? evaluateCalculusStage(node, (id) => evalInput(ctx, node, id)) : null;
    case 'businessStage':
      return portId === 'out' ? evaluateBusinessStage(node, (id) => evalInput(ctx, node, id)) : null;
    case 'deepStage': {
      const liveValue = ctx.live.get(`${node.id}|${portId}`);
      if (liveValue?.kind === 'deepData' && portId === 'out') return liveValue;
      return portId === 'out'
        ? evaluateDeepStage(node, (id) => evalInput(ctx, node, id))
        : evaluateDeepStageMetric(node, (id) => evalInput(ctx, node, id), portId);
    }
    case 'functionSource': {
      try { return functionValue(node.text ?? 'a*x^2+b*x+c', node.params); } catch { return null; }
    }
    case 'func2dSource': {
      const a = evalInput(ctx, node, 'a');
      const params = a?.kind === 'scalar' ? { ...node.params, a: a.v } : node.params;
      try { return function2dValue(node.text ?? 'a*x^2+b*y^2', params); } catch { return null; }
    }
    case 'vectorFieldSource':
      try { return vectorFieldValue(node.text); } catch { return null; }
    case 'doubleIntegralView': {
      const value = evalInput(ctx, node, 'in');
      if (value?.kind !== 'function2d') return null;
      const result = sampleDiskDensity(value);
      return result.mass === undefined ? null : { kind: 'scalar', v: result.mass };
    }
    case 'derivative':
    case 'integral':
    case 'limitProbe':
    case 'ftcView':
    case 'taylor': {
      const value = evalInput(ctx, node, 'in');
      if (value?.kind !== 'function') return null;
      const position = evalInput(ctx, node, 'x');
      const x = position?.kind === 'scalar' ? position.v : node.params.x ?? 0;
      try {
        const f = compileFunction(value);
        if (node.type === 'derivative') return { kind: 'scalar', v: derivativeAt(f, x) };
        if (node.type === 'integral') {
          const divisions = evalInput(ctx, node, 'n');
          const n = divisions?.kind === 'scalar' ? divisions.v : node.params.n ?? 12;
          return { kind: 'scalar', v: integrate(f, node.params.lower ?? 0, node.params.upper ?? 1, n, node.params.method ?? 1, !!node.params.area).reference };
        }
        if (node.type === 'ftcView') {
          return { kind: 'scalar', v: integrate(f, node.params.a ?? 0, node.params.x ?? 1, 128).sum };
        }
        if (node.type === 'limitProbe') {
          const candidate = approachLimit(f, x, node.params.side ?? 0).candidate;
          return candidate === null ? null : { kind: 'scalar', v: candidate };
        }
        const center = evalInput(ctx, node, 'center');
        return taylorPolynomial(f, center?.kind === 'scalar' ? center.v : node.params.center ?? 0, node.params.degree ?? 3).value;
      } catch { return null; }
    }
    case 'bizTableSource':
      try { return businessTableSeries(node.text ?? '', node.params.sample ?? 0); } catch { return null; }
    case 'bizGrowthSource': {
      const growth = evalInput(ctx, node, 'growth');
      try {
        return growthSeries({
          initial: node.params.initial ?? 100,
          monthlyRate: node.params.rate ?? 0.06,
          months: node.params.months ?? 12,
          seasonality: node.params.seasonality ?? 0.08,
          overrideRate: growth?.kind === 'scalar' ? growth.v : undefined,
        });
      } catch { return null; }
    }
    case 'bizScenarioFork': {
      const input = evalInput(ctx, node, 'in');
      if (input?.kind !== 'series') return null;
      try {
        return scenarioSeries(input, { spread: node.params.spread ?? 0.2, drift: node.params.drift ?? 0.02 });
      } catch { return null; }
    }
    case 'bizDiscountOp': {
      const input = evalInput(ctx, node, 'in');
      if (input?.kind !== 'series') return null;
      const rate = evalInput(ctx, node, 'rate');
      try {
        const result = discountSeries(input, {
          annualRate: rate?.kind === 'scalar' ? rate.v : node.params.rate ?? 0.08,
          initialInvestment: node.params.investment ?? 0,
        });
        if (portId === 'npv') return { kind: 'scalar', v: result.npv };
        return portId === 'out' ? result.series : null;
      } catch { return null; }
    }
    case 'bizDecisionMatrix': {
      const weight = (id: string, fallback: number): number => {
        const value = evalInput(ctx, node, id);
        return value?.kind === 'scalar' && Number.isFinite(value.v) ? value.v : fallback;
      };
      try {
        return weightedDecision([
          weight('cost', node.params.costWeight ?? 0.25),
          weight('time', node.params.timeWeight ?? 0.25),
          weight('risk', node.params.riskWeight ?? 0.25),
          weight('benefit', node.params.benefitWeight ?? 0.25),
        ]).series;
      } catch { return null; }
    }
    case 'emFieldSource':
      try { return emFieldFromParams(node.params); } catch { return null; }
    case 'opticsBench':
      try { return opticsField(node.params); } catch { return null; }
    case 'rlcCircuitLab': {
      const frequency = evalInput(ctx, node, 'freq');
      try {
        return rlcWaveform(node.params, frequency?.kind === 'scalar' ? frequency.v : undefined).series;
      } catch { return null; }
    }
    case 'thermoCycle':
      try { return thermoCycle(node.params).series; } catch { return null; }
    case 'funcCombineOp': {
      const f = evalInput(ctx, node, 'f');
      if (f?.kind !== 'function') return null;
      const wiredG = evalInput(ctx, node, 'g');
      try {
        const g = wiredG?.kind === 'function' ? wiredG : functionValue(node.text ?? 'sin(x)', node.params);
        return combineFunctions(f, g, node.params.op ?? 0);
      } catch { return null; }
    }
    case 'svdDecomposeOp': {
      const input = evalInput(ctx, node, 'in');
      if (input?.kind !== 'matrix2') return null;
      try {
        const result = svd2x2({ a: input.a, b: input.b, c: input.c, d: input.d });
        if (portId === 'u') return { kind: 'matrix2', ...result.u };
        if (portId === 'sigma') return { kind: 'matrix2', ...result.sigma };
        if (portId === 'vt') return { kind: 'matrix2', ...result.vt };
        return null;
      } catch { return null; }
    }
    case 'probDistSource':
      try {
        return probabilitySeries({
          distribution: node.params.distribution ?? 0,
          samples: node.params.samples ?? 400,
          bins: node.params.bins ?? 24,
          seed: node.params.seed ?? 7,
        }).series;
      } catch { return null; }
    case 'arraySource':
      try { return arrayFromParams(node.params, node.text ?? ''); } catch { return null; }
    case 'graphSource':
      try { return graphFromText(node.text ?? ''); } catch { return null; }
    case 'memAddrSource':
      try { return memoryAddressStream(node.params, node.text ?? ''); } catch { return null; }
    case 'pageRefSource':
      try { return pageRefStream(node.params, node.text ?? ''); } catch { return null; }
    case 'lossProbeOp': {
      const input = evalInput(ctx, node, 'in');
      const matrix = input?.kind === 'tensor2d' ? sanitizeMatrix(input.data) : null;
      const probabilities = probabilityVector(matrix ?? [DEFAULT_LOSS_PREDICTIONS]);
      try {
        const result = lossProbe(probabilities, node.params.target ?? 0, node.params.gamma ?? 2);
        if (portId === 'loss') {
          const metric = Math.round(node.params.metric ?? 1);
          return { kind: 'scalar', v: metric === 0 ? result.losses.mse : metric === 2 ? result.losses.focal : result.losses.ce };
        }
        return { kind: 'tensor2d', data: [[result.losses.mse, result.losses.ce, result.losses.focal]] };
      } catch { return null; }
    }
    case 'loraAdapterOp': {
      const input = evalInput(ctx, node, 'in');
      const matrix = input?.kind === 'tensor2d' ? sanitizeMatrix(input.data) : null;
      try {
        return { kind: 'tensor2d', data: loraApprox(matrix ?? DEFAULT_LORA_MATRIX, node.params.rank ?? 2).approx };
      } catch { return null; }
    }
    case 'quantProbeOp': {
      const input = evalInput(ctx, node, 'in');
      const matrix = input?.kind === 'tensor2d' ? sanitizeMatrix(input.data) : null;
      try {
        return { kind: 'tensor2d', data: quantizeMatrix(matrix ?? DEFAULT_QUANT_MATRIX, node.params.precision ?? 2).quantized };
      } catch { return null; }
    }
    case 'aiRuleBlock':
      return ctx.live.get(`${node.id}|${portId}`) ?? null;
    case 'matrixSource':
      return { kind: 'matrix2', ...paramsM(node.params) };
    case 'slider':
      return { kind: 'scalar', v: node.params.v ?? 0 };
    case 'ticker':
      return ctx.live.get(node.id) ?? { kind: 'scalar', v: 0 };
    case 'delayRegister':
      return ctx.live.get(node.id) ?? { kind: 'scalar', v: node.params.init ?? 0 };
    case 'portIn':
      return ctx.boundary.get(node.id) ?? null;
    case 'portOut':
      return evalInput(ctx, node, 'in');
    case 'composite': {
      const port = node.sub?.ports.find((p) => p.id === portId && p.dir === 'out');
      if (!port) return null;
      const sub = subCtxOf(ctx, node);
      return sub ? evalOutput(sub, port.id) : null;
    }
    case 'rotor': {
      const inp = evalInput(ctx, node, 'in');
      const t = inp && inp.kind === 'scalar' ? inp.v : node.params.theta ?? 0;
      return { kind: 'matrix2', ...rot2(t) };
    }
    case 'matmul': {
      const A = evalInput(ctx, node, 'A');
      const B = evalInput(ctx, node, 'B');
      if (!A && !B) return null;
      const a = A && A.kind === 'matrix2' ? A : IDENT;
      const b = B && B.kind === 'matrix2' ? B : IDENT;
      return { kind: 'matrix2', ...mul2(a, b) };
    }
    default: {
      if (PHYS_TYPES.has(node.type)) {
        const type = node.type as PhysNodeType;
        const wire = ctx.doc.wires.find((w) => w.to === node.id && (w.toPort ?? 'in') === 't');
        const srcType = wire ? ctx.doc.nodes.find((n) => n.id === wire.from)?.type : undefined;
        const inp = evalInput(ctx, node, 't');
        const liveT = ctx.live.get(node.id);
        // 外接标量优先（ticker 0→1 按周期换算；滑杆=t 秒）；无接线走自闭钟；再退回手动 t
        const t =
          inp && inp.kind === 'scalar'
            ? srcType === 'ticker' ? inp.v * physCycle(type, node.params) : inp.v
            : liveT && liveT.kind === 'scalar'
              ? liveT.v
              : node.params.t ?? 0;
        return bodyAt(type, node.params, t);
      }
      return null;
    }
  }
}

/** 视图/变换节点各输入端口的当前值，键 = 端口 id（线驱动，不依赖节点注册表） */
export function inputValues(ctx: EvalCtx, node: CanvasNode): Record<string, PortValue | null> {
  const out: Record<string, PortValue | null> = {};
  for (const w of ctx.doc.wires) {
    if (w.to !== node.id) continue;
    out[w.toPort ?? 'in'] = evalOutput(ctx, w.from, w.fromPort ?? 'out');
  }
  return out;
}


// Rules inside composite blocks need the same boundary values as synchronous nodes.
export function* aiRuleInputs(ctx: EvalCtx): Generator<{ node: CanvasNode; values: ReturnType<typeof inputValues> }> {
  function* visit(nodes: CanvasNode[], parents: CanvasNode[]): Generator<{ node: CanvasNode; values: ReturnType<typeof inputValues> }> {
    for (const node of nodes) {
      if (node.type === 'aiRuleBlock') {
        const scope = parents.reduce((parent, composite) => subCtxOf(parent, composite)!, ctx);
        yield { node, values: inputValues(scope, node) };
      } else if (node.sub) {
        yield* visit(node.sub.nodes, [...parents, node]);
      }
    }
  }
  yield* visit(ctx.doc.nodes, []);
}

/** 原子收集全图（含复合积木内部）所有 delayRegister 的下一拍输入值，不立即修改 live */
export function collectNextDelayStates(ctx: EvalCtx): Map<string, PortValue> {
  const nextStates = new Map<string, PortValue>();
  function visit(nodes: CanvasNode[], scope: EvalCtx): void {
    for (const node of nodes) {
      if (node.type === 'delayRegister') {
        const incoming = evalInput(scope, node, 'next') ?? evalInput(scope, node, 'in');
        if (incoming) {
          nextStates.set(node.id, incoming);
        }
      } else if (node.type === 'composite' && node.sub) {
        const childCtx = subCtxOf(scope, node);
        if (childCtx) visit(node.sub.nodes, childCtx);
      }
    }
  }
  visit(ctx.doc.nodes, ctx);
  return nextStates;
}

/** 收集全图（含复合积木内部）所有 delayRegister 节点 ID */
export function listDelayRegisterIds(nodes: readonly CanvasNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type === 'delayRegister') ids.push(node.id);
    if (node.sub) ids.push(...listDelayRegisterIds(node.sub.nodes));
  }
  return ids;
}
