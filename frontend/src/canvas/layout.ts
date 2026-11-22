/**
 * layout.ts —— 画布 DAG 拓扑自动分层排版引擎
 *
 * 按连线方向将非便签节点从左到右分成整齐列（Layer），同列垂直居中、等距排布。
 * 彻底解决节点高矮不一、坐标松散或重叠的问题；支持有环图与孤立节点兜底。
 */
import type { CanvasNode, Wire } from './types.ts';

export const COMPACT_CARD_WIDTH = 176;
export const COMPACT_CARD_HEIGHT = 116;

export interface AutoLayoutOptions {
  cardWidth?: number;
  cardHeight?: number;
  gapX?: number;
  gapY?: number;
  padX?: number;
  padY?: number;
  /** 隐藏便签时不参与主图占位，放到画布底部备用位置 */
  excludeNotes?: boolean;
}

/**
 * 计算每个节点的规整坐标映射（nodeId -> { x, y }）。
 * 不修改原数组，纯函数，确定性输出。
 */
export function computeAutoLayout(
  nodes: readonly CanvasNode[],
  wires: readonly Wire[],
  options: AutoLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const cardW = options.cardWidth ?? COMPACT_CARD_WIDTH;
  const cardH = options.cardHeight ?? COMPACT_CARD_HEIGHT;
  const gapX = options.gapX ?? 68;
  const gapY = options.gapY ?? 34;
  const padX = options.padX ?? 44;
  const padY = options.padY ?? 48;
  const excludeNotes = options.excludeNotes ?? true;

  const active = excludeNotes ? nodes.filter((n) => n.type !== 'textNote') : [...nodes];
  const activeIds = new Set(active.map((n) => n.id));
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of active) {
    outEdges.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const w of wires) {
    if (!activeIds.has(w.from) || !activeIds.has(w.to) || w.from === w.to) continue;
    const list = outEdges.get(w.from)!;
    if (!list.includes(w.to)) {
      list.push(w.to);
      inDegree.set(w.to, (inDegree.get(w.to) ?? 0) + 1);
    }
  }

  // 按 Kahn 拓扑排序计算最长路径深度作为列号（防环兜底）
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const n of active) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      layer.set(n.id, 0);
    }
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor++]!;
    const curLayer = layer.get(id) ?? 0;
    for (const next of outEdges.get(id) ?? []) {
      const prev = layer.get(next) ?? 0;
      if (curLayer + 1 > prev) layer.set(next, curLayer + 1);
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  // 环上残留节点兜底排到第 0 列
  for (const n of active) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // 同列按原 y 坐标排序（保留模板原本的上下分支意图）
  const columns = new Map<number, CanvasNode[]>();
  for (const n of active) {
    const col = layer.get(n.id) ?? 0;
    const bucket = columns.get(col) ?? [];
    bucket.push(n);
    columns.set(col, bucket);
  }
  const sortedCols = [...columns.keys()].sort((a, b) => a - b);
  let maxRows = 1;
  for (const col of sortedCols) {
    const bucket = columns.get(col)!;
    bucket.sort((a, b) => a.y - b.y || a.x - b.x);
    if (bucket.length > maxRows) maxRows = bucket.length;
  }

  const totalH = maxRows * cardH + (maxRows - 1) * gapY;
  const positions = new Map<string, { x: number; y: number }>();

  sortedCols.forEach((col, colIndex) => {
    const bucket = columns.get(col)!;
    const colH = bucket.length * cardH + (bucket.length - 1) * gapY;
    const startY = padY + Math.round((totalH - colH) / 2);
    const x = padX + colIndex * (cardW + gapX);
    bucket.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x,
        y: startY + rowIndex * (cardH + gapY),
      });
    });
  });

  // 便签若存在，保留或放到下方安全位置
  let noteX = padX;
  for (const n of nodes) {
    if (positions.has(n.id)) continue;
    positions.set(n.id, { x: noteX, y: padY + totalH + gapY + 24 });
    noteX += 260;
  }

  return positions;
}

export function applyAutoLayout(
  nodes: readonly CanvasNode[],
  wires: readonly Wire[],
  options?: AutoLayoutOptions,
): CanvasNode[] {
  const pos = computeAutoLayout(nodes, wires, options);
  return nodes.map((n) => {
    const p = pos.get(n.id);
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}
