/**
 * relations.ts —— 万象活页纯函数关系求值引擎（M4）。
 *
 * 设计要点：
 * 1. 纯函数、无副作用：输入 `(nodes, relations, liveDrafts, options)`，输出派生后的 `nodes`、`patches`、
 *    兼容悬浮层 `overlays` 以及逐条关系诊断 `diagnostics`。
 * 2. 安全白名单表达式：完全复用 `ispec/expr.ts` 的 `parseExpression` 与 `evaluateAst`，严禁 `eval` / `Function`。
 *    支持在表达式中直接书写 `b2.length` / `b2.dx`（预处理将属性点号等长替换为下划线，1-based 报错列号完全不变），
 *    也支持通过 `bindings` 映射任意复杂节点 ID。
 * 3. 缓存与防环拓扑求值：借鉴 `canvas/engine.ts` 的 `cache + visiting` 回溯思想，按依赖边自动先求值上游关系，
 *    发现循环依赖、缺失节点、退化共线或非有限数值时只记录该条关系的 `diagnostics`，不中断同页其余关系。
 * 4. 向后兼容：自动将历史 `node.basis: BasisOverlay` 归一化为虚拟 `basis_decompose` 关系。
 */

import { basisComposition } from './basisComposition.ts';
import type {
  BasisDecomposeRelation,
  ExprBindingSource,
  ExprRelation,
  GuideAnchor,
  GuideBindRelation,
  LinearComboRelation,
  NodePatch,
  RelationSourceProperty,
  RelationTargetProperty,
  SceneNode,
  SceneRelation,
  ViewerParameter,
} from './types.ts';
import { resizeVector, vectorEndpoints, vectorGeometry } from './vectorGeometry.ts';
import { evaluateAst, FUNCTION_NAMES, parseExpression, type ExprValue } from '../ispec/expr.ts';

type Point = [number, number];

export const RELATION_SOURCE_PROPERTIES: readonly RelationSourceProperty[] = [
  'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'length', 'angle',
  'x', 'y', 'width', 'height', 'rotation', 'opacity',
];

export const RELATION_TARGET_PROPERTIES: readonly RelationTargetProperty[] = [
  'length', 'angle', 'x', 'y', 'width', 'height', 'rotation', 'opacity',
  'text', 'x1', 'y1', 'x2', 'y2',
];

const SOURCE_PROP_SET = new Set<string>(RELATION_SOURCE_PROPERTIES);
const TARGET_PROP_SET = new Set<string>(RELATION_TARGET_PROPERTIES);
const FUNCTION_NAME_SET = new Set<string>(FUNCTION_NAMES);
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface RelationDiagnostic {
  relationId: string;
  status: 'ok' | 'degenerate' | 'error' | 'cycle' | 'disabled';
  message?: string;
}

export interface BasisOverlayEvaluation {
  relationId: string;
  firstId: string;
  secondId: string;
  resultId: string;
  origin: Point;
  corner: Point | null;
  target: Point;
  coefficients: [number, number] | null;
  degenerate: boolean;
  label: string;
  title?: [number, number];
  fontSize?: number;
  hasBoundLabel: boolean;
  hasBoundGuides: boolean;
}

export interface PageRelationEvaluation {
  /** 应用 liveDrafts 与所有已生效关系派生后的节点列表 */
  nodes: SceneNode[];
  /** 仅由关系求值产生的派生节点增量（不含用户主动拖动的源节点 liveDrafts） */
  derivedPatches: Record<string, NodePatch>;
  /** 换基关系的几何求值结果（供悬浮层或分步动画使用） */
  overlays: BasisOverlayEvaluation[];
  /** 逐条关系的求值状态与错误信息 */
  diagnostics: Record<string, RelationDiagnostic>;
}

export interface EvaluateRelationsOptions {
  /** 换基分步播放进度（0..2，默认 2 表示完整显示两条辅助边） */
  basisProgress?: number;
}

function mergePatch(node: SceneNode, patch: NodePatch | undefined): SceneNode {
  if (!patch) return node;
  return {
    ...node,
    ...patch,
    style: patch.style ? { ...node.style, ...patch.style } : node.style,
  };
}

function mergeNodePatches(a: NodePatch | undefined, b: NodePatch): NodePatch {
  if (!a) return b;
  return {
    ...a,
    ...b,
    style: b.style ? { ...a.style, ...b.style } : a.style,
  };
}

function formatNumberClean(value: number, precision = 2): string {
  if (!Number.isFinite(value)) return '0';
  const factor = Math.pow(10, Math.max(0, Math.min(6, precision)));
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(Number(normalized.toFixed(precision)));
}

/** 提取节点的只读几何标量属性。 */
export function extractNodeMetrics(node: SceneNode): Record<RelationSourceProperty, number> {
  const [start, end] = vectorEndpoints(node);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = node.type === 'vector' ? node.width : Math.hypot(dx, dy);
  return {
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
    dx,
    dy,
    length,
    angle: node.rotation,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
  };
}

/** 计算给定锚点的页面坐标。 */
export function resolveGuideAnchor(node: SceneNode, anchor: GuideAnchor): Point {
  const [start, end] = vectorEndpoints(node);
  if (anchor === 'start') return start;
  if (anchor === 'end') return end;
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

/** 将计算出的单个目标属性值转换为 NodePatch。 */
export function applyTargetProperty(
  node: SceneNode,
  property: RelationTargetProperty,
  value: number | string,
): NodePatch | null {
  if (property === 'text') {
    return { text: String(value) };
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;

  switch (property) {
    case 'x':
      if (num < -20000 || num > 20000) return null;
      return { x: num };
    case 'y':
      if (num < -20000 || num > 20000) return null;
      return { y: num };
    case 'width':
      if (num < 0.1 || num > 20000) return null;
      return { width: num };
    case 'height':
      if (num < 0.1 || num > 20000) return null;
      return { height: num };
    case 'rotation':
    case 'angle':
      if (num < -36000 || num > 36000) return null;
      if (node.type === 'vector') {
        return resizeVector(node, node.width, num);
      }
      return { rotation: num };
    case 'length':
      if (num < 0.1 || num > 20000) return null;
      if (node.type === 'vector') {
        return resizeVector(node, num, node.rotation);
      }
      return { width: num };
    case 'opacity':
      return { opacity: Math.max(0, Math.min(1, num)) };
    case 'x1':
    case 'y1':
    case 'x2':
    case 'y2': {
      const [start, end] = vectorEndpoints(node);
      const nextStart: Point = [
        property === 'x1' ? num : start[0],
        property === 'y1' ? num : start[1],
      ];
      const nextEnd: Point = [
        property === 'x2' ? num : end[0],
        property === 'y2' ? num : end[1],
      ];
      return vectorGeometry(nextStart, nextEnd, node.height);
    }
    default:
      return null;
  }
}

interface PreprocessedExpression {
  normalized: string;
  implicitBindings: Record<string, ExprBindingSource>;
}

/**
 * 在字符串字面量之外，将 `<nodeId>.<prop>` 的点号等长替换为 `<nodeId>_<prop>`。
 * 由于 `.` 与 `_` 均为单字符，词法分析器的 0-based `position` 与 1-based 列号完全保持不变。
 */
export function preprocessRelationExpression(source: string): PreprocessedExpression {
  const implicitBindings: Record<string, ExprBindingSource> = {};
  let result = '';
  let index = 0;

  while (index < source.length) {
    const ch = source[index]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      result += ch;
      index += 1;
      while (index < source.length) {
        const cur = source[index]!;
        result += cur;
        index += 1;
        if (cur === '\\' && index < source.length) {
          result += source[index]!;
          index += 1;
          continue;
        }
        if (cur === quote) break;
      }
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end += 1;
      const ident = source.slice(index, end);
      if (source[end] === '.') {
        let propEnd = end + 1;
        while (propEnd < source.length && /[A-Za-z0-9_]/.test(source[propEnd]!)) propEnd += 1;
        const prop = source.slice(end + 1, propEnd);
        if (SOURCE_PROP_SET.has(prop)) {
          const alias = `${ident}_${prop}`;
          implicitBindings[alias] = { nodeId: ident, property: prop as RelationSourceProperty };
          result += alias;
          index = propEnd;
          continue;
        }
      }
      result += ident;
      index = end;
      continue;
    }

    result += ch;
    index += 1;
  }

  return { normalized: result, implicitBindings };
}

function resolveIdentifierBinding(
  identifier: string,
  explicitBindings: Readonly<Record<string, ExprBindingSource>> | undefined,
  implicitBindings: Readonly<Record<string, ExprBindingSource>>,
): ExprBindingSource | null {
  if (explicitBindings && explicitBindings[identifier]) {
    return explicitBindings[identifier]!;
  }
  if (implicitBindings[identifier]) {
    return implicitBindings[identifier]!;
  }
  for (const prop of RELATION_SOURCE_PROPERTIES) {
    const suffix = `_${prop}`;
    if (identifier.endsWith(suffix) && identifier.length > suffix.length) {
      return {
        nodeId: identifier.slice(0, -suffix.length),
        property: prop,
      };
    }
  }
  return null;
}

/** 将页面显式 relations 与历史 `node.basis` 合并归一化。 */
export function normalizePageRelations(
  nodes: readonly SceneNode[],
  relations?: readonly SceneRelation[],
): SceneRelation[] {
  const list: SceneRelation[] = relations ? [...relations] : [];
  const coveredTriples = new Set<string>();
  for (const rel of list) {
    if (rel.kind === 'basis_decompose') {
      coveredTriples.add(`${rel.firstId}|${rel.secondId}|${rel.resultId}`);
    }
  }
  for (const node of nodes) {
    if (node.deleted || node.hidden || node.type !== 'vector' || !node.basis) continue;
    const { firstId, secondId, resultId, title, fontSize } = node.basis;
    const tripleKey = `${firstId}|${secondId}|${resultId}`;
    if (coveredTriples.has(tripleKey)) continue;
    coveredTriples.add(tripleKey);
    list.push({
      id: `legacy_basis_${node.id}`,
      kind: 'basis_decompose',
      enabled: true,
      provenance: 'legacy',
      firstId,
      secondId,
      resultId,
      title,
      fontSize,
    });
  }
  return list;
}

/** 提取单条关系的输入节点集合与输出节点集合。 */
export function relationDependencies(relation: SceneRelation): {
  inputs: Set<string>;
  outputs: Set<string>;
  error?: string;
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();

  if (relation.kind === 'basis_decompose') {
    inputs.add(relation.firstId);
    inputs.add(relation.secondId);
    inputs.add(relation.resultId);
    for (const guideId of relation.guideIds ?? []) outputs.add(guideId);
    if (relation.labelId) outputs.add(relation.labelId);
    return { inputs, outputs };
  }

  if (relation.kind === 'linear_combo') {
    inputs.add(relation.firstId);
    inputs.add(relation.secondId);
    outputs.add(relation.targetId);
    for (const guideId of relation.guideIds ?? []) outputs.add(guideId);
    for (const coeff of [relation.a, relation.b]) {
      if (typeof coeff === 'string') {
        const pre = preprocessRelationExpression(coeff);
        const parsed = parseExpression(pre.normalized);
        if (!parsed.ok) return { inputs, outputs, error: parsed.error };
        for (const ident of parsed.identifiers) {
          const binding = resolveIdentifierBinding(ident, undefined, pre.implicitBindings);
          if (!binding) return { inputs, outputs, error: `未知变量或属性引用：${ident}` };
          inputs.add(binding.nodeId);
        }
      }
    }
    return { inputs, outputs };
  }

  if (relation.kind === 'guide_bind') {
    inputs.add(relation.from.nodeId);
    inputs.add(relation.to.nodeId);
    outputs.add(relation.targetId);
    return { inputs, outputs };
  }

  // relation.kind === 'expr'
  outputs.add(relation.targetId);
  const pre = preprocessRelationExpression(relation.expression);
  const parsed = parseExpression(pre.normalized);
  if (!parsed.ok) return { inputs, outputs, error: parsed.error };
  for (const ident of parsed.identifiers) {
    const binding = resolveIdentifierBinding(ident, relation.bindings, pre.implicitBindings);
    if (!binding) return { inputs, outputs, error: `未知变量或属性引用：${ident}` };
    inputs.add(binding.nodeId);
  }
  return { inputs, outputs };
}

/** 校验单条关系的静态合法性；合法返回 `null`，否则返回中文错误原因。 */
export function validateRelation(
  relation: SceneRelation,
  nodes?: readonly SceneNode[],
): string | null {
  if (!relation.id || !/^[A-Za-z0-9_-]{1,96}$/.test(relation.id)) {
    return '关系标识不合法';
  }
  const knownIds = nodes
    ? new Set(nodes.filter((n) => !n.deleted).map((n) => n.id))
    : null;

  if (relation.kind === 'basis_decompose') {
    const core = new Set([relation.firstId, relation.secondId, relation.resultId]);
    if (core.size !== 3) return '换基关系的两个基向量与目标向量必须互不相同';
    const guides = relation.guideIds ?? [];
    if (new Set(guides).size !== guides.length) return '辅助线标识不能重复';
    for (const g of guides) {
      if (core.has(g)) return '辅助线不能与基向量或目标向量相同';
    }
    if (relation.labelId && (core.has(relation.labelId) || guides.includes(relation.labelId))) {
      return '坐标文字节点不能与向量或辅助线节点相同';
    }
  } else if (relation.kind === 'linear_combo') {
    if (new Set([relation.firstId, relation.secondId, relation.targetId]).size !== 3) {
      return '线性组合的基向量与目标向量必须互不相同';
    }
    for (const coeff of [relation.a, relation.b]) {
      if (typeof coeff === 'number') {
        if (!Number.isFinite(coeff) || Math.abs(coeff) > 10000) return '线性组合系数必须为有限数值';
      }
    }
  } else if (relation.kind === 'guide_bind') {
    if (relation.targetId === relation.from.nodeId || relation.targetId === relation.to.nodeId) {
      return '辅助线绑定不能引用自身作为端点来源';
    }
    if (relation.from.nodeId === relation.to.nodeId && relation.from.anchor === relation.to.anchor) {
      return '辅助线起止绑定不能指向同一锚点';
    }
  } else if (relation.kind === 'expr') {
    if (!TARGET_PROP_SET.has(relation.targetProperty)) {
      return `不支持的目标属性：${relation.targetProperty}`;
    }
    if (!relation.expression || !relation.expression.trim()) {
      return '关系表达式不能为空';
    }
    if (relation.bindings) {
      for (const [alias, binding] of Object.entries(relation.bindings)) {
        if (!IDENT_RE.test(alias) || FUNCTION_NAME_SET.has(alias)) {
          return `绑定变量名不合法：${alias}`;
        }
        if (!SOURCE_PROP_SET.has(binding.property)) {
          return `不支持的源属性：${binding.property}`;
        }
      }
    }
  }

  const { inputs, outputs, error } = relationDependencies(relation);
  if (error) return error;
  for (const outId of outputs) {
    if (inputs.has(outId)) return '关系不能自引用目标节点';
  }
  if (knownIds) {
    for (const id of [...inputs, ...outputs]) {
      if (!knownIds.has(id)) return `引用了不存在的节点：${id}`;
    }
  }
  return null;
}

/** 检测一组关系中的循环依赖，返回处于环路上或依赖环路的关系 ID 集合。 */
export function detectRelationCycles(relations: readonly SceneRelation[]): Set<string> {
  const active = relations.filter((r) => r.enabled !== false);
  const ioMap = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
  const producers = new Map<string, string[]>();

  for (const rel of active) {
    const { inputs, outputs } = relationDependencies(rel);
    ioMap.set(rel.id, { inputs, outputs });
    for (const outId of outputs) {
      const list = producers.get(outId) ?? [];
      list.push(rel.id);
      producers.set(outId, list);
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const [relId, { inputs }] of ioMap.entries()) {
    const deps = new Set<string>();
    for (const inNode of inputs) {
      for (const upstream of producers.get(inNode) ?? []) {
        deps.add(upstream);
      }
    }
    adj.set(relId, deps);
  }

  const state = new Map<string, 1 | 2>();
  const cyclic = new Set<string>();

  const dfs = (id: string, stack: string[]): boolean => {
    state.set(id, 1);
    stack.push(id);
    let inCycle = false;
    for (const dep of adj.get(id) ?? []) {
      const st = state.get(dep);
      if (st === 1) {
        inCycle = true;
        const idx = stack.indexOf(dep);
        for (let i = idx >= 0 ? idx : 0; i < stack.length; i += 1) {
          cyclic.add(stack[i]!);
        }
      } else if (st === undefined) {
        if (dfs(dep, stack)) {
          inCycle = true;
          cyclic.add(id);
        }
      } else if (cyclic.has(dep)) {
        inCycle = true;
        cyclic.add(id);
      }
    }
    stack.pop();
    state.set(id, 2);
    return inCycle;
  };

  for (const relId of adj.keys()) {
    if (!state.has(relId)) dfs(relId, []);
  }
  return cyclic;
}

function interpolatePoint(a: Point, b: Point, fraction: number): Point {
  if (fraction >= 1) return b;
  if (fraction <= 0) return a;
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

function formatBasisLabel(
  template: string | undefined,
  a: number,
  b: number,
): string {
  const aText = formatNumberClean(a, 2);
  const bText = formatNumberClean(b, 2);
  if (template && template.trim()) {
    return template
      .replace(/\{a\}/g, aText)
      .replace(/\{b\}/g, bText)
      .replace(/\{0\}/g, aText)
      .replace(/\{1\}/g, bText);
  }
  return `斜基：坐标 (${aText}, ${bText})`;
}

function evaluateScalarInput(
  raw: number | string,
  bindings: Readonly<Record<string, ExprBindingSource>> | undefined,
  getNode: (nodeId: string) => SceneNode | undefined,
): { ok: true; value: ExprValue } | { ok: false; error: string } {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: '系数不是有限数值' };
    return { ok: true, value: raw };
  }
  const pre = preprocessRelationExpression(raw);
  const parsed = parseExpression(pre.normalized);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const scope: Record<string, ExprValue> = {};
  for (const ident of parsed.identifiers) {
    const binding = resolveIdentifierBinding(ident, bindings, pre.implicitBindings);
    if (!binding) {
      return { ok: false, error: `未知变量或属性引用：${ident}` };
    }
    const sourceNode = getNode(binding.nodeId);
    if (!sourceNode) {
      return { ok: false, error: `源节点不存在：${binding.nodeId}` };
    }
    const metrics = extractNodeMetrics(sourceNode);
    scope[ident] = metrics[binding.property];
  }
  const evaluated = evaluateAst(parsed.ast, scope, true);
  if (!evaluated.ok) return { ok: false, error: evaluated.error };
  return { ok: true, value: evaluated.value };
}

/**
 * 求值单页的全部关系。
 *
 * - 支持传入 `liveDrafts`（例如拖动 `VectorLine` 时 `onPreview` 产生的临时几何补丁），
 *   使得受影响的虚线、合成向量和坐标文字以 60fps 同步更新。
 * - 使用 `cache + visiting` 按拓扑依赖顺序求值，不受 `relations` 数组先后顺序限制。
 */
export function evaluatePageRelations(
  nodes: readonly SceneNode[],
  relations?: readonly SceneRelation[],
  liveDrafts?: Readonly<Record<string, NodePatch | null | undefined>>,
  options?: EvaluateRelationsOptions,
): PageRelationEvaluation {
  const basisProgress = options?.basisProgress ?? 2;
  const normalizedRelations = normalizePageRelations(nodes, relations);

  const baseMap = new Map<string, SceneNode>();
  for (const node of nodes) {
    if (node.deleted) continue;
    const draft = liveDrafts?.[node.id] ?? undefined;
    baseMap.set(node.id, draft ? mergePatch(node, draft) : node);
  }

  const derivedPatches: Record<string, NodePatch> = {};
  const overlays: BasisOverlayEvaluation[] = [];
  const diagnostics: Record<string, RelationDiagnostic> = {};

  if (normalizedRelations.length === 0) {
    return {
      nodes: nodes.map((n) => (liveDrafts?.[n.id] ? mergePatch(n, liveDrafts[n.id]!) : n)),
      derivedPatches,
      overlays,
      diagnostics,
    };
  }

  const cyclicIds = detectRelationCycles(normalizedRelations);
  const relById = new Map<string, SceneRelation>();
  const producers = new Map<string, string[]>();

  for (const rel of normalizedRelations) {
    relById.set(rel.id, rel);
    if (rel.enabled === false) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'disabled' };
      continue;
    }
    const staticError = validateRelation(rel);
    if (staticError) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: staticError };
      continue;
    }
    if (cyclicIds.has(rel.id)) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'cycle', message: '关系之间存在循环依赖' };
      continue;
    }
    const { outputs } = relationDependencies(rel);
    for (const outId of outputs) {
      const list = producers.get(outId) ?? [];
      list.push(rel.id);
      producers.set(outId, list);
    }
  }

  const evaluatedRel = new Set<string>();
  const visitingRel = new Set<string>();

  const commitDerived = (nodeId: string, patch: NodePatch | null) => {
    if (!patch) return;
    const current = baseMap.get(nodeId);
    if (!current) return;
    baseMap.set(nodeId, mergePatch(current, patch));
    derivedPatches[nodeId] = mergeNodePatches(derivedPatches[nodeId], patch);
  };

  const resolveNode = (nodeId: string): SceneNode | undefined => {
    for (const producerId of producers.get(nodeId) ?? []) {
      if (!evaluatedRel.has(producerId) && !visitingRel.has(producerId)) {
        evalRelation(producerId);
      }
    }
    return baseMap.get(nodeId);
  };

  const applyGuideSegments = (
    guideIds: readonly string[] | undefined,
    segments: ReadonlyArray<[Point, Point, number]>,
  ) => {
    if (!guideIds?.length) return;
    guideIds.forEach((guideId, idx) => {
      const guideNode = baseMap.get(guideId);
      const seg = segments[idx];
      if (!guideNode || !seg) return;
      const [fromPt, toPt, fraction] = seg;
      if (fraction <= 0) {
        commitDerived(guideId, { opacity: 0 });
        return;
      }
      const endPt = interpolatePoint(fromPt, toPt, fraction);
      const geom = vectorGeometry(fromPt, endPt, guideNode.height);
      if (geom) {
        commitDerived(guideId, { ...geom, opacity: 1 });
      }
    });
  };

  const evalBasisDecompose = (rel: BasisDecomposeRelation) => {
    const first = resolveNode(rel.firstId);
    const second = resolveNode(rel.secondId);
    const result = resolveNode(rel.resultId);
    if (!first || !second || !result) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: '换基关系引用的向量节点不存在' };
      return;
    }
    const [origin, firstTip] = vectorEndpoints(first);
    const [secondStart, secondTip] = vectorEndpoints(second);
    const [, target] = vectorEndpoints(result);
    const comp = basisComposition(
      origin,
      [firstTip[0] - origin[0], firstTip[1] - origin[1]],
      [secondTip[0] - secondStart[0], secondTip[1] - secondStart[1]],
      target,
    );
    const degenerateText = rel.degenerateText ?? '斜基退化：坐标不唯一';
    const coeffA = comp?.coefficients[0] ?? 0;
    const coeffB = comp?.coefficients[1] ?? 0;
    const label = comp
      ? formatBasisLabel(rel.labelTemplate, coeffA, coeffB)
      : degenerateText;

    if (rel.labelId) {
      if (!baseMap.has(rel.labelId)) {
        diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: `坐标文字节点不存在：${rel.labelId}` };
        return;
      }
      commitDerived(rel.labelId, { text: label });
    }

    if (rel.guideIds?.length) {
      for (const gid of rel.guideIds) {
        if (!baseMap.has(gid)) {
          diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: `辅助线节点不存在：${gid}` };
          return;
        }
      }
      if (comp) {
        const seg1Frac = Math.min(basisProgress, 1);
        const seg2Frac = Math.max(0, Math.min(1, basisProgress - 1));
        const segments: Array<[Point, Point, number]> =
          rel.guideIds.length === 1
            ? [[comp.corner, comp.target, seg2Frac]]
            : [
                [origin, comp.corner, seg1Frac],
                [comp.corner, comp.target, seg2Frac],
              ];
        applyGuideSegments(rel.guideIds, segments);
      } else {
        for (const gid of rel.guideIds) {
          commitDerived(gid, { opacity: 0 });
        }
      }
    }

    overlays.push({
      relationId: rel.id,
      firstId: rel.firstId,
      secondId: rel.secondId,
      resultId: rel.resultId,
      origin,
      corner: comp ? comp.corner : null,
      target,
      coefficients: comp ? [coeffA, coeffB] : null,
      degenerate: !comp,
      label,
      title: rel.title,
      fontSize: rel.fontSize,
      hasBoundLabel: Boolean(rel.labelId && baseMap.has(rel.labelId)),
      hasBoundGuides: Boolean(rel.guideIds?.length && rel.guideIds.every((id) => baseMap.has(id))),
    });

    diagnostics[rel.id] = comp
      ? { relationId: rel.id, status: 'ok' }
      : { relationId: rel.id, status: 'degenerate', message: degenerateText };
  };

  const evalLinearCombo = (rel: LinearComboRelation) => {
    const first = resolveNode(rel.firstId);
    const second = resolveNode(rel.secondId);
    const target = baseMap.get(rel.targetId);
    if (!first || !second || !target) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: '线性组合引用的向量节点不存在' };
      return;
    }
    const aEval = evaluateScalarInput(rel.a, undefined, resolveNode);
    if (!aEval.ok || typeof aEval.value !== 'number') {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: aEval.ok ? '系数 a 必须为数值' : aEval.error };
      return;
    }
    const bEval = evaluateScalarInput(rel.b, undefined, resolveNode);
    if (!bEval.ok || typeof bEval.value !== 'number') {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: bEval.ok ? '系数 b 必须为数值' : bEval.error };
      return;
    }
    const [origin, firstTip] = vectorEndpoints(first);
    const [secondStart, secondTip] = vectorEndpoints(second);
    const d1: Point = [firstTip[0] - origin[0], firstTip[1] - origin[1]];
    const d2: Point = [secondTip[0] - secondStart[0], secondTip[1] - secondStart[1]];
    const corner: Point = [origin[0] + aEval.value * d1[0], origin[1] + aEval.value * d1[1]];
    const endPt: Point = [corner[0] + bEval.value * d2[0], corner[1] + bEval.value * d2[1]];
    const geom = vectorGeometry(origin, endPt, target.height);
    if (!geom) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'degenerate', message: '合成向量长度过小或越界' };
      return;
    }
    commitDerived(rel.targetId, geom);
    if (rel.guideIds?.length) {
      const segments: Array<[Point, Point, number]> =
        rel.guideIds.length === 1
          ? [[corner, endPt, 1]]
          : [
              [origin, corner, 1],
              [corner, endPt, 1],
            ];
      applyGuideSegments(rel.guideIds, segments);
    }
    diagnostics[rel.id] = { relationId: rel.id, status: 'ok' };
  };

  const evalGuideBind = (rel: GuideBindRelation) => {
    const fromNode = resolveNode(rel.from.nodeId);
    const toNode = resolveNode(rel.to.nodeId);
    const target = baseMap.get(rel.targetId);
    if (!fromNode || !toNode || !target) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: '辅助线绑定引用的节点不存在' };
      return;
    }
    const startPt = resolveGuideAnchor(fromNode, rel.from.anchor);
    const endPt = resolveGuideAnchor(toNode, rel.to.anchor);
    const geom = vectorGeometry(startPt, endPt, target.height);
    if (!geom) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'degenerate', message: '辅助线端点重合或越界' };
      return;
    }
    commitDerived(rel.targetId, geom);
    diagnostics[rel.id] = { relationId: rel.id, status: 'ok' };
  };

  const evalExprRelation = (rel: ExprRelation) => {
    const target = baseMap.get(rel.targetId);
    if (!target) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: `目标节点不存在：${rel.targetId}` };
      return;
    }
    const evaluated = evaluateScalarInput(rel.expression, rel.bindings, resolveNode);
    if (!evaluated.ok) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: evaluated.error };
      return;
    }
    let finalValue: number | string;
    if (rel.targetProperty === 'text') {
      const precision = rel.precision ?? 2;
      const formatted =
        typeof evaluated.value === 'number'
          ? formatNumberClean(evaluated.value, precision)
          : String(evaluated.value);
      finalValue = rel.formatTemplate
        ? rel.formatTemplate.replace(/\{value\}/g, formatted).replace(/\{0\}/g, formatted)
        : formatted;
    } else {
      if (typeof evaluated.value !== 'number' || !Number.isFinite(evaluated.value)) {
        diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: '目标数值属性需要有限数值结果' };
        return;
      }
      finalValue = evaluated.value;
    }

    const patch = applyTargetProperty(target, rel.targetProperty, finalValue);
    if (!patch) {
      diagnostics[rel.id] = { relationId: rel.id, status: 'error', message: '求值结果超出目标属性允许范围' };
      return;
    }
    commitDerived(rel.targetId, patch);
    diagnostics[rel.id] = { relationId: rel.id, status: 'ok' };
  };

  const evalRelation = (relId: string) => {
    if (evaluatedRel.has(relId) || visitingRel.has(relId)) return;
    if (diagnostics[relId]) {
      evaluatedRel.add(relId);
      return;
    }
    const rel = relById.get(relId);
    if (!rel) return;
    visitingRel.add(relId);
    try {
      if (rel.kind === 'basis_decompose') {
        evalBasisDecompose(rel);
      } else if (rel.kind === 'linear_combo') {
        evalLinearCombo(rel);
      } else if (rel.kind === 'guide_bind') {
        evalGuideBind(rel);
      } else {
        evalExprRelation(rel);
      }
    } finally {
      visitingRel.delete(relId);
      evaluatedRel.add(relId);
    }
  };

  for (const rel of normalizedRelations) {
    evalRelation(rel.id);
  }

  const resolvedNodes = nodes.map((node) => {
    if (node.deleted) return node;
    return baseMap.get(node.id) ?? node;
  });

  return {
    nodes: resolvedNodes,
    derivedPatches,
    overlays,
    diagnostics,
  };
}

/**
 * 辅助判断：在观众/放映态下，某节点是否允许調整指定的细粒度参数。
 * 向后兼容粗粒度 `'geometry' | 'style' | 'flow'` 与细粒度 `'start' | 'end' | 'length' | 'angle' | 'color' | 'line_style' | 'stroke_width'`。
 */
export function allowsViewerParameter(
  node: SceneNode,
  parameter: ViewerParameter,
  author = false,
): boolean {
  if (node.locked) return false;
  if (author) return true;
  if (node.viewer_editable === false) return false;
  const list = node.viewer_parameters;
  if (!list) return true;
  if (list.includes(parameter)) return true;

  const hasFineGeometry = list.some((k) => k === 'start' || k === 'end' || k === 'length' || k === 'angle');
  if (!hasFineGeometry && list.includes('geometry')) {
    if (parameter === 'start' || parameter === 'end' || parameter === 'length' || parameter === 'angle') {
      return true;
    }
  }
  if (parameter === 'geometry') {
    return list.includes('geometry') || hasFineGeometry;
  }

  const hasFineStyle = list.some((k) => k === 'color' || k === 'line_style' || k === 'stroke_width');
  if (!hasFineStyle && list.includes('style')) {
    if (parameter === 'color' || parameter === 'line_style' || parameter === 'stroke_width') {
      return true;
    }
  }
  if (parameter === 'style') {
    return list.includes('style') || hasFineStyle;
  }
  return false;
}
