/** 流程图（diagram）文档契约与纯函数工具。
 *
 * ``DiagramDoc`` 与后端 ``living.diagram`` 校验契约一致：节点 x/y 为 0..1
 * 归一化中心坐标，edges 引用节点 id。React Flow 像素坐标通过
 * ``DIAGRAM_W``/``DIAGRAM_H`` 换算，拖拽停顿时再写回归一化。
 */

export type DiagramShape = 'rect' | 'rounded' | 'diamond' | 'oval' | 'text';

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  shape: DiagramShape;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramDoc {
  version: 1;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  order: string[];
  confidence: number;
  warnings: string[];
  cache_key?: string;
  original_positions?: Record<string, { x: number; y: number }>;
}

export const DIAGRAM_W = 860;
export const DIAGRAM_H = 520;
export const NODE_W = 150;
export const NODE_H = 56;

/** 上下游高亮：以某节点为源，BFS 求祖先（上游）与后继（下游）集合。 */
export function reachSets(doc: DiagramDoc, nodeId: string): { up: Set<string>; down: Set<string> } {
  const walk = (forward: boolean): Set<string> => {
    const out = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.pop()!;
      for (const edge of doc.edges) {
        const from = forward ? edge.from : edge.to;
        const to = forward ? edge.to : edge.from;
        if (from === current && !out.has(to) && to !== nodeId) {
          out.add(to);
          queue.push(to);
        }
      }
    }
    return out;
  };
  return { up: walk(false), down: walk(true) };
}

/** 单步演示顺序：doc.order 覆盖全部节点时优先，否则按 (y,x) 排序兜底。 */
export function stepOrder(doc: DiagramDoc): string[] {
  const valid = doc.order.filter((id) => doc.nodes.some((n) => n.id === id));
  if (valid.length === doc.nodes.length) return valid;
  return [...doc.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id);
}

/** 自动布局：按边做分层（拓扑深度 → 列，层内索引 → 行），成环时按 order 回退。
 *  返回 ``id → 归一化中心坐标``；孤立节点排到最右列。 */
export function layeredLayout(doc: DiagramDoc): Record<string, { x: number; y: number }> {
  const ids = doc.nodes.map((n) => n.id);
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  // 逐轮松弛求最长入度路径深度；超过节点数的轮次说明有环，剩余按 0 处理。
  for (let round = 0; round < ids.length; round += 1) {
    let changed = false;
    for (const edge of doc.edges) {
      const from = depth.get(edge.from) ?? 0;
      if ((depth.get(edge.to) ?? 0) < from + 1) {
        depth.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const maxDepth = Math.max(0, ...depth.values());
  const isolated = ids.filter((id) => (depth.get(id) ?? 0) === 0
    && !doc.edges.some((e) => e.from === id || e.to === id));
  const columns = maxDepth + 1 + (isolated.length ? 1 : 0);
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    let layer = depth.get(id) ?? 0;
    if (isolated.includes(id)) layer = columns - 1;
    const bucket = layers.get(layer) ?? [];
    bucket.push(id);
    layers.set(layer, bucket);
  }
  const order = stepOrder(doc);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [layer, bucket] of layers) {
    bucket.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    bucket.forEach((id, index) => {
      out[id] = {
        x: columns <= 1 ? 0.5 : (0.10 + (0.80 * layer) / (columns - 1)),
        y: bucket.length <= 1 ? 0.5 : (0.14 + (0.72 * index) / (bucket.length - 1)),
      };
    });
  }
  return out;
}

/** 归一化中心坐标 → React Flow 节点左上像素位置。 */
export function toXY(node: DiagramNode): { x: number; y: number } {
  return { x: node.x * DIAGRAM_W - NODE_W / 2, y: node.y * DIAGRAM_H - NODE_H / 2 };
}

/** React Flow 节点左上像素 → 归一化中心坐标（0..1 内收敛）。 */
export function fromXY(x: number, y: number): { x: number; y: number } {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return {
    x: clamp((x + NODE_W / 2) / DIAGRAM_W),
    y: clamp((y + NODE_H / 2) / DIAGRAM_H),
  };
}
