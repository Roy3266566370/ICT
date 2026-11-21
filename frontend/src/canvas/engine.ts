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
import { functionValue, compileFunction, derivativeAt, integrate, approachLimit, taylorPolynomial } from './calculus.ts';
import { DEEP_NODE_TYPES, validDeepValue } from './deepPorts.ts';
import { deepFirstOutput } from './deepFirst.ts';
import { deepCoreOutput } from './deepCore.ts';
import { deepAdvancedOutput } from './deepAdvanced.ts';

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
function subCtxOf(ctx: EvalCtx, node: CanvasNode): EvalCtx | null {
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

function compute(ctx: EvalCtx, node: CanvasNode, portId: string): PortValue | null {
  if (DEEP_NODE_TYPES.has(node.type)) {
    const runtime = ctx.live.get(`${node.id}|${portId}`);
    if (runtime && validDeepValue(runtime)) return runtime;
    const input = (port: string) => evalInput(ctx, node, port);
    try {
      const value = deepFirstOutput(node, input, portId) ?? deepCoreOutput(node, input, portId) ?? deepAdvancedOutput(node, input, portId);
      return validDeepValue(value) ? value : null;
    } catch {
      return null;
    }
  }
  switch (node.type) {
    case 'functionSource': {
      try { return functionValue(node.text ?? 'a*x^2+b*x+c', node.params); } catch { return null; }
    }
    case 'derivative':
    case 'integral':
    case 'limitProbe':
    case 'taylor': {
      const value = evalInput(ctx, node, 'in');
      if (value?.kind !== 'function') return null;
      const position = evalInput(ctx, node, 'x');
      const x = position?.kind === 'scalar' ? position.v : node.params.x ?? 0;
      try {
        const f = compileFunction(value);
        if (node.type === 'derivative') return { kind: 'scalar', v: derivativeAt(f, x) };
        if (node.type === 'integral') return { kind: 'scalar', v: integrate(f, node.params.lower ?? 0, node.params.upper ?? 1, node.params.n ?? 12, node.params.method ?? 1, !!node.params.area).reference };
        if (node.type === 'limitProbe') {
          const candidate = approachLimit(f, x, node.params.side ?? 0).candidate;
          return candidate === null ? null : { kind: 'scalar', v: candidate };
        }
        return taylorPolynomial(f, node.params.center ?? 0, node.params.degree ?? 3).value;
      } catch { return null; }
    }
    case 'matrixSource':
      return { kind: 'matrix2', ...paramsM(node.params) };
    case 'slider':
      return { kind: 'scalar', v: node.params.v ?? 0 };
    case 'ticker':
      return ctx.live.get(node.id) ?? { kind: 'scalar', v: 0 };
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
