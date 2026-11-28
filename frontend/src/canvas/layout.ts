/**
 * layout.ts —— 智能画布拓扑自动排版与最优视口适配引擎
 *
 * 相比旧版固定网格排版的核心升级：
 *  1. 真实宽高感知：按每个节点自身的实际宽高（nodeSizes）独立计算每列宽度与每行高度，
 *     彻底消除「大视图撑爆小滑杆间距」的巨大空洞；
 *  2. 连通分量分泳道（Swimlane）：多组独立实验自动纵向分泳道排布，互不穿插；
 *  3. 反馈环感知分层：忽略指向 delayRegister 的回边，环上节点按前向数据流自然展开；
 *  4. Sugiyama 重心法（Barycenter）双遍减交叉 + 单子节点垂直吸附上游质心，让连线更平直少交叉；
 *  5. 安全区最优视口（computeOptimalViewport）：扣除工具坞、顶栏与右侧抽屉遮挡，将全图（含墨迹）
 *     精确居中至真正可见区域的几何中心。
 */
import { clamp } from './math.ts';
import type { CanvasNode, InkStroke, Wire } from './types.ts';

export const COMPACT_CARD_WIDTH = 220;
export const COMPACT_CARD_HEIGHT = 132;

export interface NodeBoxSize {
  w: number;
  h: number;
}

export interface AutoLayoutOptions {
  /** 按节点 id 提供的真实 DOM 渲染宽高 */
  nodeSizes?: ReadonlyMap<string, NodeBoxSize>;
  cardWidth?: number;
  cardHeight?: number;
  gapX?: number;
  gapY?: number;
  laneGap?: number;
  padX?: number;
  padY?: number;
  /** 隐藏便签时不参与主图占位，放到画布底部整齐排布 */
  excludeNotes?: boolean;
}

function sizeOf(node: CanvasNode, options: AutoLayoutOptions): NodeBoxSize {
  const measured = options.nodeSizes?.get(node.id);
  if (measured && measured.w > 20 && measured.h > 20) return measured;
  return {
    w: node.w && node.w > 20 ? node.w : (options.cardWidth ?? COMPACT_CARD_WIDTH),
    h: node.h && node.h > 20 ? node.h : (options.cardHeight ?? COMPACT_CARD_HEIGHT),
  };
}

/** 将节点集合按无向连通性拆分为多个独立实验泳道 */
function splitConnectedComponents(
  nodes: readonly CanvasNode[],
  wires: readonly Wire[],
): CanvasNode[][] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const w of wires) {
    if (!byId.has(w.from) || !byId.has(w.to) || w.from === w.to) continue;
    adj.get(w.from)!.push(w.to);
    adj.get(w.to)!.push(w.from);
  }
  const visited = new Set<string>();
  const comps: CanvasNode[][] = [];
  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const stack = [n.id];
    const group: CanvasNode[] = [];
    visited.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(byId.get(id)!);
      for (const next of adj.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    comps.push(group);
  }
  // 泳道排序：优先按原顶部 y 坐标从上到下，孤立单节点统一归到后方
  comps.sort((a, b) => {
    const aMulti = a.length > 1 ? 0 : 1;
    const bMulti = b.length > 1 ? 0 : 1;
    if (aMulti !== bMulti) return aMulti - bMulti;
    const ay = Math.min(...a.map((n) => n.y));
    const by = Math.min(...b.map((n) => n.y));
    return ay - by || (Math.min(...a.map((n) => n.x)) - Math.min(...b.map((n) => n.x)));
  });
  return comps;
}

/** 对单个连通分量做反馈环感知分层 + 重心减交叉 + 变宽高紧凑排布 */
function layoutComponent(
  compNodes: readonly CanvasNode[],
  allWires: readonly Wire[],
  options: AutoLayoutOptions,
  originX: number,
  originY: number,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const gapX = options.gapX ?? 72;
  const gapY = options.gapY ?? 28;
  const idSet = new Set(compNodes.map((n) => n.id));
  const byId = new Map(compNodes.map((n) => [n.id, n]));

  // 构建前向边：若构成反馈环，优先将指向 delayRegister 的回边暂不计入拓扑入度
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of compNodes) {
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  const compWires = allWires.filter((w) => idSet.has(w.from) && idSet.has(w.to) && w.from !== w.to);
  // 先判断每条指向 delayRegister 的边是否能回溯到源头形成环
  const forwardWires: Wire[] = [];
  for (const w of compWires) {
    const toNode = byId.get(w.to);
    const isFeedbackToDelay = toNode?.type === 'delayRegister' && compWires.some((other) => other.from === w.to);
    if (isFeedbackToDelay) continue;
    forwardWires.push(w);
  }

  for (const w of forwardWires) {
    const outs = outEdges.get(w.from)!;
    if (!outs.includes(w.to)) {
      outs.push(w.to);
      inEdges.get(w.to)!.push(w.from);
      inDegree.set(w.to, (inDegree.get(w.to) ?? 0) + 1);
    }
  }

  // Kahn 最长路径分层 + 任意环最小入度破环
  const layer = new Map<string, number>();
  const remIn = new Map(inDegree);
  const processed = new Set<string>();
  const queue: string[] = [];

  for (const n of compNodes) {
    if ((remIn.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      layer.set(n.id, 0);
    }
  }

  while (processed.size < compNodes.length) {
    if (queue.length === 0) {
      // 存在纯同步环：选入度最小、且最靠左的未处理节点破环
      const remaining = compNodes
        .filter((n) => !processed.has(n.id))
        .sort((a, b) => (remIn.get(a.id) ?? 0) - (remIn.get(b.id) ?? 0) || a.x - b.x || a.y - b.y);
      const pick = remaining[0]!;
      queue.push(pick.id);
      if (!layer.has(pick.id)) layer.set(pick.id, 0);
    }
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const curL = layer.get(id) ?? 0;
    for (const next of outEdges.get(id) ?? []) {
      if (processed.has(next)) continue;
      layer.set(next, Math.max(layer.get(next) ?? 0, curL + 1));
      const deg = Math.max(0, (remIn.get(next) ?? 1) - 1);
      remIn.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // 拉紧源节点：若某源节点（无入边）的所有下游都在更高层，将其右移到 min(childLayer) - 1，避免跨越多列的超长飞线
  for (const n of compNodes) {
    if ((inEdges.get(n.id)?.length ?? 0) === 0) {
      const children = outEdges.get(n.id) ?? [];
      if (children.length > 0) {
        const minChildLayer = Math.min(...children.map((cid) => layer.get(cid) ?? 1));
        if (minChildLayer > 1) {
          layer.set(n.id, minChildLayer - 1);
        }
      }
    }
  }

  // 按层分桶
  const colMap = new Map<number, CanvasNode[]>();
  for (const n of compNodes) {
    const col = layer.get(n.id) ?? 0;
    const list = colMap.get(col) ?? [];
    list.push(n);
    colMap.set(col, list);
  }
  const cols = [...colMap.keys()].sort((a, b) => a - b);
  for (const c of cols) {
    colMap.get(c)!.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // Sugiyama 重心法（Barycenter）双遍扫描：最大限度减少连线交叉
  const orderOf = (): Map<string, number> => {
    const map = new Map<string, number>();
    for (const c of cols) {
      colMap.get(c)!.forEach((node, idx) => map.set(node.id, idx));
    }
    return map;
  };
  for (let sweep = 0; sweep < 2; sweep += 1) {
    // 正向：按上游父节点的平均序号排序
    for (let ci = 1; ci < cols.length; ci += 1) {
      const ord = orderOf();
      const bucket = colMap.get(cols[ci]!)!;
      bucket.sort((a, b) => {
        const pa = inEdges.get(a.id) ?? [];
        const pb = inEdges.get(b.id) ?? [];
        const ba = pa.length ? pa.reduce((s, id) => s + (ord.get(id) ?? 0), 0) / pa.length : (ord.get(a.id) ?? 0);
        const bb = pb.length ? pb.reduce((s, id) => s + (ord.get(id) ?? 0), 0) / pb.length : (ord.get(b.id) ?? 0);
        return ba - bb || a.y - b.y;
      });
    }
    // 反向：按子节点平均序号微调
    for (let ci = cols.length - 2; ci >= 0; ci -= 1) {
      const ord = orderOf();
      const bucket = colMap.get(cols[ci]!)!;
      bucket.sort((a, b) => {
        const ca = outEdges.get(a.id) ?? [];
        const cb = outEdges.get(b.id) ?? [];
        const ba = ca.length ? ca.reduce((s, id) => s + (ord.get(id) ?? 0), 0) / ca.length : (ord.get(a.id) ?? 0);
        const bb = cb.length ? cb.reduce((s, id) => s + (ord.get(id) ?? 0), 0) / cb.length : (ord.get(b.id) ?? 0);
        return ba - bb || a.y - b.y;
      });
    }
  }

  // 计算每列的真实最大宽度与真实总高度
  const colWidths = cols.map((c) => Math.max(...colMap.get(c)!.map((n) => sizeOf(n, options).w)));
  const colHeights = cols.map((c) => {
    const list = colMap.get(c)!;
    return list.reduce((sum, n) => sum + sizeOf(n, options).h, 0) + Math.max(0, list.length - 1) * gapY;
  });
  const maxColH = Math.max(1, ...colHeights);

  // 逐列放置节点：先垂直居中，再在有上游父节点时尽量朝父节点中心 y 柔和吸附（防重叠）
  const positions = new Map<string, { x: number; y: number }>();
  let curX = originX;
  cols.forEach((c, ci) => {
    const list = colMap.get(c)!;
    const colH = colHeights[ci]!;
    let curY = originY + Math.round((maxColH - colH) / 2);

    // 若本列只有 1~2 个节点且已有上游位置，尝试让每个节点贴近其父节点的平均中心 y
    const desiredYs = list.map((node) => {
      const h = sizeOf(node, options).h;
      const parents = (inEdges.get(node.id) ?? []).filter((pid) => positions.has(pid));
      if (parents.length === 0) return null;
      const avgCenter = parents.reduce((sum, pid) => {
        const pNode = byId.get(pid)!;
        const pPos = positions.get(pid)!;
        return sum + pPos.y + sizeOf(pNode, options).h / 2;
      }, 0) / parents.length;
      return Math.round(avgCenter - h / 2);
    });

    const minBound = originY;
    const maxBound = originY + maxColH;

    list.forEach((node, idx) => {
      const h = sizeOf(node, options).h;
      let y = curY;
      const desired = desiredYs[idx];
      if (desired !== null && desired !== undefined) {
        y = Math.max(curY, Math.min(desired, maxBound - h));
        // 若吸附后下方剩余节点放不下，回退到紧凑位置
        const remainingH = list.slice(idx + 1).reduce((sum, r) => sum + sizeOf(r, options).h + gapY, 0);
        if (y + h + remainingH > maxBound) {
          y = Math.max(curY, maxBound - h - remainingH);
        }
        y = Math.max(minBound, y);
      }
      positions.set(node.id, { x: Math.round(curX), y: Math.round(y) });
      curY = y + h + gapY;
    });

    curX += colWidths[ci]! + gapX;
  });

  // 归一化本泳道顶部到 originY，并计算实际占用的宽和高
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = originX;
  for (const n of compNodes) {
    const p = positions.get(n.id)!;
    const sz = sizeOf(n, options);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + sz.h);
    maxX = Math.max(maxX, p.x + sz.w);
  }
  const shiftY = Number.isFinite(minY) ? originY - minY : 0;
  if (shiftY !== 0) {
    for (const [id, p] of positions) {
      positions.set(id, { x: p.x, y: p.y + shiftY });
    }
  }
  return {
    positions,
    width: Math.max(0, maxX - originX),
    height: Number.isFinite(minY) ? Math.max(0, maxY - minY) : 0,
  };
}

/**
 * 计算每个节点的智能规整坐标映射（nodeId -> { x, y }）。
 * 不修改原数组，纯函数，确定性输出。
 */
export function computeAutoLayout(
  nodes: readonly CanvasNode[],
  wires: readonly Wire[],
  options: AutoLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const padX = options.padX ?? 48;
  const padY = options.padY ?? 48;
  const gapX = options.gapX ?? 72;
  const gapY = options.gapY ?? 28;
  const laneGap = options.laneGap ?? 56;
  const excludeNotes = options.excludeNotes ?? false;

  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  // 便签与公式卡单独归类，避免插入连线拓扑中间
  const notes = nodes.filter((n) => n.type === 'textNote' || n.type === 'latexNote');
  const mainNodes = nodes.filter((n) => n.type !== 'textNote' && n.type !== 'latexNote');

  const components = splitConnectedComponents(mainNodes, wires);
  const multiComps = components.filter((c) => c.length > 1);
  const singles = components.filter((c) => c.length === 1).map((c) => c[0]!);

  let curY = padY;
  // 1) 多节点连通实验组：各自成独立泳道，纵向依次排布
  for (const comp of multiComps) {
    const res = layoutComponent(comp, wires, options, padX, curY);
    for (const [id, pos] of res.positions) positions.set(id, pos);
    curY += res.height + laneGap;
  }

  // 2) 孤立非便签积木：按每行最多 4 个整齐网格排在主实验下方
  if (singles.length > 0) {
    const colsPerRow = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(singles.length))));
    let rowX = padX;
    let rowMaxH = 0;
    singles.forEach((node, idx) => {
      const sz = sizeOf(node, options);
      if (idx > 0 && idx % colsPerRow === 0) {
        curY += rowMaxH + gapY;
        rowX = padX;
        rowMaxH = 0;
      }
      positions.set(node.id, { x: Math.round(rowX), y: Math.round(curY) });
      rowX += sz.w + Math.min(gapX, 44);
      rowMaxH = Math.max(rowMaxH, sz.h);
    });
    curY += rowMaxH + laneGap;
  }

  // 3) 便签 / 公式卡：放在最下方整齐横向排开（或在 excludeNotes=true 时同样安全归位）
  if (notes.length > 0 && (!excludeNotes || mainNodes.length === 0)) {
    let noteX = padX;
    let rowMaxH = 0;
    const maxRowW = 1120;
    for (const note of notes) {
      const sz = sizeOf(note, options);
      if (noteX > padX && noteX + sz.w > padX + maxRowW) {
        curY += rowMaxH + gapY;
        noteX = padX;
        rowMaxH = 0;
      }
      positions.set(note.id, { x: Math.round(noteX), y: Math.round(curY) });
      noteX += sz.w + 32;
      rowMaxH = Math.max(rowMaxH, sz.h);
    }
  } else if (notes.length > 0) {
    let noteX = padX;
    for (const note of notes) {
      const sz = sizeOf(note, options);
      positions.set(note.id, { x: Math.round(noteX), y: Math.round(curY) });
      noteX += sz.w + 32;
    }
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

export interface ViewportSafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 合并节点框与手写墨迹包围盒 */
export function computeContentBounds(
  nodeBoxes: readonly BoundingBox[],
  strokes: readonly InkStroke[] = [],
): BoundingBox | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const b of nodeBoxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  for (const s of strokes) {
    for (const [px, py] of s.points) {
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, right, bottom };
}

/**
 * 计算最优「适应全图」视口参数（zoom 与 pan）：
 *  - 严格扣除顶部浮条、底部工具坞/公式键盘、右侧检查器抽屉的安全区；
 *  - 内容在可见安全区内居中对齐，留出舒适呼吸感；
 *  - 小画布不过度放大（上限 1.05），超大画布平滑缩小（下限 0.12）。
 */
export function computeOptimalViewport(
  bounds: BoundingBox,
  viewportW: number,
  viewportH: number,
  insets: ViewportSafeInsets,
  options?: { minZoom?: number; maxZoom?: number },
): { zoom: number; pan: { x: number; y: number } } {
  const minZoom = options?.minZoom ?? 0.12;
  const maxZoom = options?.maxZoom ?? 1.05;
  const safeW = Math.max(120, viewportW - insets.left - insets.right);
  const safeH = Math.max(120, viewportH - insets.top - insets.bottom);
  const contentW = Math.max(1, bounds.right - bounds.left);
  const contentH = Math.max(1, bounds.bottom - bounds.top);

  const rawZoom = Math.min(safeW / contentW, safeH / contentH);
  const zoom = Math.floor(clamp(rawZoom, minZoom, maxZoom) * 100) / 100;

  const centerX = insets.left + safeW / 2;
  const centerY = insets.top + safeH / 2;
  const contentCenterX = (bounds.left + bounds.right) / 2;
  const contentCenterY = (bounds.top + bounds.bottom) / 2;

  return {
    zoom,
    pan: {
      x: Math.round(centerX - contentCenterX * zoom),
      y: Math.round(centerY - contentCenterY * zoom),
    },
  };
}
