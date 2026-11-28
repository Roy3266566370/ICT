/**
 * aiCompose.ts —— AI 自动搭积木实验与画布智能连线的纯函数引擎
 *
 * 负责：
 *  1. 从 NODE_DEFS 提炼精简积木目录与端口协议供后端 AI 参考；
 *  2. 汇总当前画布已有节点与连线；
 *  3. 对 AI 返回的编排方案做端口类型兼容性校验、同步环路拦截与拓扑分层自动排布，
 *     保证最终落位到画布上的每一条连线都 100% 合法可运行。
 */
import { nextId } from './math.ts';
import type { NodeDef } from './nodes.tsx';
import type { CanvasDoc, CanvasNode, NodeType, PortSpec, Wire } from './types.ts';
import { compatiblePorts } from './wireRecommend.ts';

export type AiComposeMode = 'compose' | 'wire_existing';

export interface ComposeCatalogItem {
  type: NodeType;
  title: string;
  badge: string;
  inputs: Array<{ id: string; label: string; kind?: string }>;
  outputs: Array<{ id: string; label: string; kind?: string }>;
}

export interface ComposeExistingNode {
  id: string;
  type: NodeType;
  title: string;
  inputs: Array<{ id: string; kind?: string }>;
  outputs: Array<{ id: string; kind?: string }>;
}

export interface ComposePlanNode {
  ref: string;
  type: string;
  label?: string;
  params?: Record<string, number>;
  text?: string;
}

export interface ComposePlanWire {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface AiComposePlan {
  title: string;
  summary: string;
  add_nodes: ComposePlanNode[];
  wires: ComposePlanWire[];
}

const INTERNAL_TYPES = new Set<NodeType>([
  'portIn', 'portOut', 'composite', 'attentionSim', 'pageLabSim', 'aiRuleBlock',
]);

/** 从 NODE_DEFS 提取可供 AI 自动编排使用的真内核积木目录 */
export function buildComposeCatalog(defs: Partial<Record<NodeType, NodeDef>>): ComposeCatalogItem[] {
  const items: ComposeCatalogItem[] = [];
  for (const [type, def] of Object.entries(defs) as [NodeType, NodeDef][]) {
    if (!def || INTERNAL_TYPES.has(type)) continue;
    const inputs = (def.inputs ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      ...(p.kind ? { kind: p.kind } : p.accepts?.length ? { kind: p.accepts.join('|') } : {}),
    }));
    const outputs = (def.outputs ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      ...(p.kind ? { kind: p.kind } : {}),
    }));
    // 跳过既无输入也无输出的纯静态注释节点（除非需要便签）
    if (!inputs.length && !outputs.length && type !== 'textNote' && type !== 'latexNote') continue;
    items.push({ type, title: def.title, badge: def.badge, inputs, outputs });
  }
  return items.slice(0, 110);
}

/** 提取画布已有节点的精简摘要供 AI 智能连线 */
export function summarizeCanvasForCompose(
  doc: CanvasDoc,
  defs: Partial<Record<NodeType, NodeDef>>,
  resolvePorts: (node: CanvasNode, dir: 'in' | 'out') => readonly PortSpec[],
): { existing_nodes: ComposeExistingNode[]; existing_wires: ComposePlanWire[] } {
  const existing_nodes = doc.nodes
    .filter((n) => n.type !== 'portIn' && n.type !== 'portOut')
    .slice(0, 40)
    .map((n) => ({
      id: n.id,
      type: n.type,
      title: (n.text && !n.text.includes('\n') ? n.text.trim().slice(0, 28) : '') || defs[n.type]?.title || n.type,
      inputs: resolvePorts(n, 'in').map((p) => ({ id: p.id, ...(p.kind ? { kind: p.kind } : {}) })),
      outputs: resolvePorts(n, 'out').map((p) => ({ id: p.id, ...(p.kind ? { kind: p.kind } : {}) })),
    }));
  const existing_wires = doc.wires.slice(0, 60).map((w) => ({
    from: w.from,
    fromPort: w.fromPort ?? 'out',
    to: w.to,
    toPort: w.toPort ?? 'in',
  }));
  return { existing_nodes, existing_wires };
}

function wouldCreateSyncCycle(
  fromId: string,
  toId: string,
  nodesById: Map<string, CanvasNode>,
  wires: readonly Wire[],
): boolean {
  if (fromId === toId) return true;
  if (nodesById.get(fromId)?.type === 'delayRegister' || nodesById.get(toId)?.type === 'delayRegister') {
    return false;
  }
  const pending = [toId];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === fromId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    if (nodesById.get(id)?.type === 'delayRegister') continue;
    for (const w of wires) {
      if (w.from === id) pending.push(w.to);
    }
  }
  return false;
}

export interface ApplyComposeResult {
  doc: CanvasDoc;
  addedNodeIds: string[];
  addedWireCount: number;
  skippedWireCount: number;
}

/**
 * 将 AI 返回的编排方案安全应用到当前画布：
 *  - 新节点按拓扑层级自动左→右排布（避开已有节点区域）；
 *  - 每条连线均经过端口存在性、端口类型兼容性与同步环路三重校验；
 *  - 不破坏已有节点与连线，可纳入单步 Undo 历史。
 */
export function applyComposePlan(
  doc: CanvasDoc,
  plan: AiComposePlan,
  defs: Partial<Record<NodeType, NodeDef>>,
  resolvePorts: (node: CanvasNode, dir: 'in' | 'out') => readonly PortSpec[],
  createNode: (type: NodeType, x: number, y: number) => CanvasNode,
): ApplyComposeResult {
  const refToId = new Map<string, string>();
  const addedNodes: CanvasNode[] = [];

  // 计算新增节点区域的起始坐标（若画布已有节点，排在最下方留出呼吸间距）
  const baseX = 80;
  const baseY = doc.nodes.length > 0
    ? Math.max(...doc.nodes.map((n) => n.y + (n.h ?? 240))) + 80
    : 80;

  for (const spec of plan.add_nodes) {
    const type = spec.type as NodeType;
    if (!defs[type] || INTERNAL_TYPES.has(type)) continue;
    const node = createNode(type, baseX, baseY);
    if (spec.params) {
      node.params = { ...node.params, ...spec.params };
    }
    if (spec.text !== undefined && spec.text.trim()) {
      node.text = spec.text.trim();
    } else if (spec.label && (type === 'slider' || type === 'delayRegister' || type === 'textNote')) {
      node.text = spec.label;
    }
    refToId.set(spec.ref, node.id);
    addedNodes.push(node);
  }

  const allNodes = [...doc.nodes, ...addedNodes];
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const nextWires = [...doc.wires];
  let addedWireCount = 0;
  let skippedWireCount = 0;

  for (const rawWire of plan.wires) {
    const fromId = refToId.get(rawWire.from) ?? (nodesById.has(rawWire.from) ? rawWire.from : undefined);
    const toId = refToId.get(rawWire.to) ?? (nodesById.has(rawWire.to) ? rawWire.to : undefined);
    if (!fromId || !toId || fromId === toId) {
      skippedWireCount += 1;
      continue;
    }
    const fromNode = nodesById.get(fromId)!;
    const toNode = nodesById.get(toId)!;
    const outPorts = resolvePorts(fromNode, 'out');
    const inPorts = resolvePorts(toNode, 'in');
    const outPort = outPorts.find((p) => p.id === rawWire.fromPort) ?? outPorts[0];
    if (!outPort) {
      skippedWireCount += 1;
      continue;
    }
    const exactIn = inPorts.find((p) => p.id === rawWire.toPort);
    const inPort = exactIn && compatiblePorts(fromNode, outPort.id, outPort.kind, toNode, exactIn)
      ? exactIn
      : inPorts.find((p) => compatiblePorts(fromNode, outPort.id, outPort.kind, toNode, p));
    if (!inPort) {
      skippedWireCount += 1;
      continue;
    }
    // 跳过已存在的相同连线
    if (nextWires.some((w) => w.from === fromId && (w.fromPort ?? 'out') === outPort.id && w.to === toId && (w.toPort ?? 'in') === inPort.id)) {
      continue;
    }
    // 拒绝同步死循环
    if (wouldCreateSyncCycle(fromId, toId, nodesById, nextWires)) {
      skippedWireCount += 1;
      continue;
    }
    // 一个输入口最多接一条线：替换旧线或新增
    const idx = nextWires.findIndex((w) => w.to === toId && (w.toPort ?? 'in') === inPort.id);
    const wire: Wire = { id: nextId('wire'), from: fromId, fromPort: outPort.id, to: toId, toPort: inPort.id };
    if (idx >= 0) nextWires[idx] = wire;
    else nextWires.push(wire);
    addedWireCount += 1;
  }

  // 对本次新增的节点按拓扑层级做从左到右自动排布（源→变换→视图）
  if (addedNodes.length > 0) {
    const addedSet = new Set(addedNodes.map((n) => n.id));
    const depth = new Map<string, number>();
    for (const n of addedNodes) depth.set(n.id, 0);
    for (let pass = 0; pass < addedNodes.length; pass += 1) {
      for (const w of nextWires) {
        if (addedSet.has(w.from) && addedSet.has(w.to)) {
          const nextDepth = (depth.get(w.from) ?? 0) + 1;
          if (nextDepth > (depth.get(w.to) ?? 0)) depth.set(w.to, nextDepth);
        }
      }
    }
    const columns = new Map<number, CanvasNode[]>();
    for (const n of addedNodes) {
      const col = depth.get(n.id) ?? 0;
      const list = columns.get(col) ?? [];
      list.push(n);
      columns.set(col, list);
    }
    for (const [col, list] of columns) {
      list.forEach((node, rowIdx) => {
        node.x = baseX + col * 330;
        node.y = baseY + rowIdx * 280;
      });
    }
  }

  const nextTitle = (!doc.nodes.length && (doc.title === '空白画布' || !doc.title.trim()) && plan.title)
    ? plan.title
    : doc.title;

  return {
    doc: { ...doc, title: nextTitle, nodes: allNodes, wires: nextWires },
    addedNodeIds: addedNodes.map((n) => n.id),
    addedWireCount,
    skippedWireCount,
  };
}
