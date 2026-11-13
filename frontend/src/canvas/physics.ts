/**
 * physics.ts —— 力学实验台的闭式解（确定性：state = f(params, t)）
 *
 * 物理源节点不接 ODE 积分器，只用解析解：
 *  - 抛体：x=v0·cosθ·t, y=v0·sinθ·t−½g·t²
 *  - 弹簧振子：x=A·cos(ωt), ω=√(k/m)
 *  - 单摆（小角近似）：θ=θ0·cos(ωt), ω=√(g/L)
 *
 * t 为"周期内秒数"：节点自走钟由 CanvasBoard 的 rAF 按 `physCycle` 取模写入
 * live Map；外接标量（滑杆/ticker）时直接用输入值（ticker 0→1 会×周期换算）。
 * 解析解保证确定性——同样 (params,t) 永远得同样状态，轨迹可预测可验证。
 */

import type { NodeType, PortValue } from './types.ts';

export type PhysNodeType = Extract<NodeType, 'projectile' | 'springOsc' | 'pendulum'>;
export const PHYS_TYPES: ReadonlySet<string> = new Set(['projectile', 'springOsc', 'pendulum']);

const DEG = Math.PI / 180;

/** 节点自闭钟的一个周期（秒）——动画循环一轮的时长。 */
export function physCycle(type: PhysNodeType, params: Record<string, number>): number {
  if (type === 'projectile') {
    const v0 = Math.max(0.5, params.v0 ?? 8);
    const theta = (params.angle ?? 55) * DEG;
    const g = Math.max(0.1, params.g ?? 9.8);
    return Math.max(0.5, (2 * v0 * Math.sin(theta)) / g);
  }
  if (type === 'springOsc') {
    const k = Math.max(0.1, params.k ?? 6);
    const m = Math.max(0.05, params.m ?? 1);
    return Math.max(0.4, 2 * Math.PI * Math.sqrt(m / k));
  }
  // pendulum
  const L = Math.max(0.2, params.L ?? 1.5);
  const g = Math.max(0.1, params.g ?? 9.8);
  return Math.max(0.5, 2 * Math.PI * Math.sqrt(L / g));
}

/** f(params, t) → body 状态（含能量项，供能量表/记录仪消费）。 */
export function bodyAt(type: PhysNodeType, params: Record<string, number>, t: number): PortValue {
  if (type === 'projectile') {
    const v0 = params.v0 ?? 8;
    const theta = (params.angle ?? 55) * DEG;
    const g = params.g ?? 9.8;
    const m = params.m ?? 1;
    const x = v0 * Math.cos(theta) * t;
    const y = Math.max(0, v0 * Math.sin(theta) * t - 0.5 * g * t * t);
    const vx = v0 * Math.cos(theta);
    const vy = v0 * Math.sin(theta) - g * t;
    return {
      kind: 'body', x, y, vx, vy,
      ke: 0.5 * m * (vx * vx + vy * vy),
      pe: m * g * y,
    };
  }
  if (type === 'springOsc') {
    const k = params.k ?? 6;
    const m = params.m ?? 1;
    const A = params.x0 ?? 1;
    const w = Math.sqrt(k / m);
    const x = A * Math.cos(w * t);
    const vx = -A * w * Math.sin(w * t);
    return {
      kind: 'body', x, y: 0, vx, vy: 0,
      ke: 0.5 * m * vx * vx,
      pe: 0.5 * k * x * x,
    };
  }
  // pendulum（小角近似）
  const L = params.L ?? 1.5;
  const g = params.g ?? 9.8;
  const m = params.m ?? 1;
  const th0 = (params.theta0 ?? 25) * DEG;
  const w = Math.sqrt(g / L);
  const th = th0 * Math.cos(w * t);
  const thDot = -th0 * w * Math.sin(w * t);
  const x = L * Math.sin(th);
  const y = -L * Math.cos(th); // 悬点在原点，摆锤在下方
  const vx = L * Math.cos(th) * thDot;
  const vy = L * Math.sin(th) * thDot;
  return {
    kind: 'body', x, y, vx, vy,
    ke: 0.5 * m * (vx * vx + vy * vy),
    pe: m * g * L * (1 - Math.cos(th)),
  };
}

/** 采样整条轨迹（供节点自绘预览路径）。n 个点、t ∈ [0, tEnd]。 */
export function samplePath(
  type: PhysNodeType,
  params: Record<string, number>,
  tEnd: number,
  n = 60,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const b = bodyAt(type, params, (i / n) * tEnd);
    if (b.kind === 'body') pts.push([b.x, b.y]);
  }
  return pts;
}

export function speed(b: Extract<PortValue, { kind: 'body' }>): number {
  return Math.hypot(b.vx, b.vy);
}
