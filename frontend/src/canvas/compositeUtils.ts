/**
 * compositeUtils.ts —— Composite 2.0 复合积木纯函数工具集
 *
 * 负责：
 *  - 自动扫描子图内部可透出参数（默认勾选前 3 个源/滑块/控件参数）
 *  - 自动挑选封面预览节点（优先最后一个视图/实验节点）
 *  - 嵌套深度统计（软限制 6 层）
 *  - 基于 viewPath 的子画布读取与不可变更新（配合顶层 Undo/Redo 栈）
 *  - 外壳直接调参写回 sub.nodes
 */
import type { CanvasDoc, CanvasNode, CompositeSub, ExposedParam, NodeType, Wire } from './types.ts';
import { parseAiRulePayload } from './aiRuleBlock.ts';

/** 复合积木推荐最大嵌套深度（软限制） */
export const MAX_COMPOSITE_DEPTH = 6;

const INTERNAL_PARAM_KEYS = new Set(['running', 'wired', 'min', 'max', 'step']);

const NON_PREVIEW_TYPES = new Set<NodeType>([
  'portIn', 'portOut', 'slider', 'ticker', 'delayRegister', 'textNote', 'latexNote',
]);

const PREFERRED_VIEW_TYPES = new Set<NodeType>([
  'aiRuleBlock', 'universalStageView', 'transformView', 'fieldView', 'detGauge', 'eigRead',
  'squareView', 'functionPlot', 'trailView', 'energyMeter', 'spark', 'cobweb',
  'boundaryView', 'matrixHeatmapView', 'gradFlowMeter', 'bizWaterfallView', 'emFieldView',
  'sortCompareView', 'shortestPathView', 'addrTranslateView', 'cacheMapView', 'composite',
]);

/** 根据当前数值推导安全的滑杆范围 */
function inferRange(current: number): { min: number; max: number; step: number } {
  if (!Number.isFinite(current)) return { min: 0, max: 1, step: 0.01 };
  if (current >= 0 && current <= 1) return { min: 0, max: 1, step: 0.01 };
  if (current > 1) {
    const max = Math.ceil(current * 2);
    const step = max >= 50 ? 1 : max >= 10 ? 0.1 : 0.05;
    return { min: 0, max, step };
  }
  const bound = Math.ceil(Math.abs(current) * 2);
  const step = bound >= 25 ? 1 : bound >= 5 ? 0.1 : 0.05;
  return { min: -bound, max: bound, step };
}

/** 收集子图内部所有可透出到外壳卡片的参数候选项 */
export function collectCandidateExposedParams(
  nodes: readonly CanvasNode[],
  resolveTitle?: (node: CanvasNode) => string,
): ExposedParam[] {
  const candidates: ExposedParam[] = [];
  const labelOf = (node: CanvasNode): string => {
    if (node.text && node.type !== 'textNote' && node.type !== 'latexNote' && !node.text.includes('\n')) {
      return node.text.trim().slice(0, 24);
    }
    if (node.type === 'aiRuleBlock') {
      const title = parseAiRulePayload(node.payload)?.title;
      if (title) return title.slice(0, 24);
    }
    return resolveTitle ? resolveTitle(node) : node.type;
  };

  // 按优先级排序：滑杆/延迟寄存器/矩阵源/AI 积木优先于其他节点
  const priority = (type: NodeType): number => {
    if (type === 'slider') return 0;
    if (type === 'delayRegister') return 1;
    if (type === 'aiRuleBlock') return 2;
    if (type === 'matrixSource' || type === 'functionSource' || type === 'func2dSource') return 3;
    return 4;
  };
  const ordered = nodes
    .filter((n) => n.type !== 'portIn' && n.type !== 'portOut')
    .slice()
    .sort((a, b) => priority(a.type) - priority(b.type));

  for (const node of ordered) {
    if (node.type === 'slider') {
      const min: number = typeof node.params.min === 'number' && Number.isFinite(node.params.min) ? node.params.min : 0;
      const max: number = typeof node.params.max === 'number' && Number.isFinite(node.params.max) ? node.params.max : 1;
      const step: number = typeof node.params.step === 'number' && Number.isFinite(node.params.step) && node.params.step > 0 ? node.params.step : 0.01;
      candidates.push({
        nodeId: node.id,
        paramKey: 'v',
        label: node.text?.trim() ? node.text.trim().slice(0, 24) : '滑杆值',
        min,
        max: max > min ? max : min + 1,
        step,
      });
      continue;
    }
    if (node.type === 'delayRegister') {
      const current = node.params.init ?? 0;
      const range = inferRange(current);
      candidates.push({
        nodeId: node.id,
        paramKey: 'init',
        label: `${labelOf(node)}·初值`,
        ...range,
      });
      continue;
    }
    if (node.type === 'aiRuleBlock') {
      const payload = parseAiRulePayload(node.payload);
      if (payload?.controls.length) {
        for (const ctrl of payload.controls) {
          if (ctrl.options?.length) continue;
          const range = inferRange(node.params[ctrl.key] ?? ctrl.value);
          candidates.push({
            nodeId: node.id,
            paramKey: ctrl.key,
            label: ctrl.label.slice(0, 24),
            min: ctrl.min ?? range.min,
            max: ctrl.max ?? range.max,
            step: ctrl.step ?? range.step,
          });
        }
        continue;
      }
    }
    for (const [key, value] of Object.entries(node.params)) {
      if (INTERNAL_PARAM_KEYS.has(key) || !Number.isFinite(value)) continue;
      const range = inferRange(value);
      candidates.push({
        nodeId: node.id,
        paramKey: key,
        label: `${labelOf(node)}·${key}`.slice(0, 32),
        ...range,
      });
    }
  }
  return candidates;
}

/** 自动挑选默认透出的关键参数（默认最多 3 个） */
export function pickDefaultExposedParams(
  nodes: readonly CanvasNode[],
  resolveTitle?: (node: CanvasNode) => string,
  limit = 3,
): ExposedParam[] {
  return collectCandidateExposedParams(nodes, resolveTitle).slice(0, limit);
}

/** 自动挑选最后一个适合做封面的内部可视化节点 */
export function pickDefaultPreviewNodeId(nodes: readonly CanvasNode[]): string | undefined {
  const candidates = nodes.filter((n) => !NON_PREVIEW_TYPES.has(n.type));
  if (!candidates.length) return undefined;
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (PREFERRED_VIEW_TYPES.has(candidates[i]!.type)) return candidates[i]!.id;
  }
  return candidates[candidates.length - 1]!.id;
}

/** 计算节点自身的复合嵌套深度（普通节点为 0，单层 composite 为 1） */
export function compositeNodeDepth(node: CanvasNode): number {
  if (node.type !== 'composite' || !node.sub) return 0;
  let maxChild = 0;
  for (const child of node.sub.nodes) {
    maxChild = Math.max(maxChild, compositeNodeDepth(child));
  }
  return 1 + maxChild;
}

/** 校验封装一组节点后的总嵌套深度是否超过软限制 */
export function wouldExceedDepthLimit(
  currentPathDepth: number,
  selectedNodes: readonly CanvasNode[],
  limit = MAX_COMPOSITE_DEPTH,
): boolean {
  const innerMax = selectedNodes.reduce((acc, n) => Math.max(acc, compositeNodeDepth(n)), 0);
  return currentPathDepth + 1 + innerMax > limit;
}

/** 在外壳调节透出参数时，直接写回 sub.nodes 对应节点参数 */
export function updateSubNodeParams(
  sub: CompositeSub,
  nodeId: string,
  patch: Record<string, number>,
): CompositeSub {
  let changed = false;
  const nextNodes = sub.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    return { ...node, params: { ...node.params, ...patch } };
  });
  return changed ? { ...sub, nodes: nextNodes } : sub;
}

/** 清洗 CompositeSub 中的 exposedParams / previewNodeId，去掉已删除节点的引用 */
export function sanitizeCompositeSub(sub: CompositeSub): CompositeSub {
  const nodeIds = new Set(sub.nodes.map((n) => n.id));
  const exposedParams = sub.exposedParams?.filter((p) => nodeIds.has(p.nodeId));
  const previewNodeId = sub.previewNodeId && nodeIds.has(sub.previewNodeId) ? sub.previewNodeId : undefined;
  return {
    ...sub,
    ...(exposedParams?.length ? { exposedParams } : { exposedParams: undefined }),
    ...(previewNodeId ? { previewNodeId } : { previewNodeId: undefined }),
  };
}

export interface LayerView {
  nodes: CanvasNode[];
  wires: Wire[];
  breadcrumbs: Array<{ id: string; title: string }>;
  compositeNode: CanvasNode | null;
}

/** 沿着 viewPath 读取当前层级的节点、连线与面包屑 */
export function getLayerAtPath(
  doc: CanvasDoc,
  viewPath: readonly string[],
  resolveTitle?: (node: CanvasNode) => string,
): LayerView {
  let nodes = doc.nodes;
  let wires = doc.wires;
  const breadcrumbs: Array<{ id: string; title: string }> = [];
  let compositeNode: CanvasNode | null = null;
  for (const id of viewPath) {
    const found = nodes.find((n) => n.id === id && n.type === 'composite' && n.sub);
    if (!found || !found.sub) break;
    compositeNode = found;
    breadcrumbs.push({
      id: found.id,
      title: found.text?.trim() || (resolveTitle ? resolveTitle(found) : '自制积木'),
    });
    nodes = found.sub.nodes;
    wires = found.sub.wires;
  }
  return { nodes, wires, breadcrumbs, compositeNode };
}

/** 沿 viewPath 不可变地更新某一层的 nodes 和 wires（自动保留外层结构与 Undo 历史） */
export function updateLayerAtPath(
  doc: CanvasDoc,
  viewPath: readonly string[],
  updater: (nodes: CanvasNode[], wires: Wire[]) => { nodes: CanvasNode[]; wires: Wire[] },
): CanvasDoc {
  if (viewPath.length === 0) {
    const next = updater(doc.nodes, doc.wires);
    if (next.nodes === doc.nodes && next.wires === doc.wires) return doc;
    return { ...doc, nodes: next.nodes, wires: next.wires };
  }

  function walk(nodes: CanvasNode[], depth: number): CanvasNode[] {
    const targetId = viewPath[depth]!;
    let changed = false;
    const mapped = nodes.map((node) => {
      if (node.id !== targetId || node.type !== 'composite' || !node.sub) return node;
      if (depth === viewPath.length - 1) {
        const next = updater(node.sub.nodes, node.sub.wires);
        if (next.nodes === node.sub.nodes && next.wires === node.sub.wires) return node;
        changed = true;
        const innerIds = new Set(next.nodes.map((n) => n.id));
        const nextSub = sanitizeCompositeSub({
          ...node.sub,
          nodes: next.nodes,
          wires: next.wires.filter((w) => innerIds.has(w.from) && innerIds.has(w.to)),
          ports: node.sub.ports.filter((p) => innerIds.has(p.id)),
        });
        return { ...node, sub: nextSub };
      }
      const nextInnerNodes = walk(node.sub.nodes, depth + 1);
      if (nextInnerNodes === node.sub.nodes) return node;
      changed = true;
      return { ...node, sub: { ...node.sub, nodes: nextInnerNodes } };
    });
    return changed ? mapped : nodes;
  }

  const nextNodes = walk(doc.nodes, 0);
  return nextNodes === doc.nodes ? doc : { ...doc, nodes: nextNodes };
}
