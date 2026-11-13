/** 全表联动的展示层工具：概念目录、影响页面与结论变化摘要。 */

import type {
  CanonicalValue,
  CanonicalValues,
  InteractionBundle,
  ModelNode,
} from '@/ppt-ai/types';
import type { BundleEvaluation, PptAiEvaluation } from './evaluate.ts';
import { formatValue, outputValue, scaleValue } from './evaluate.ts';

export type ConceptRole = 'input' | 'derived' | 'declaration';

export interface ConceptOccurrence {
  page: number;
  excerpt: string;
  node_id: string | null;
}

export interface ConceptEntry {
  concept_id: string;
  name: string;
  type: string;
  unit: string;
  role: ConceptRole;
  value: CanonicalValue | null;
  min: number | null;
  max: number | null;
  occurrences: ConceptOccurrence[];
  nodes: string[];
  editable: boolean;
}

export interface ConclusionChange {
  node_id: string;
  title: string;
  page: number;
  label: string;
  before: string;
  after: string;
}

function roleOf(node: ModelNode): ConceptRole {
  if (node.semantic_role === 'derived_output') return 'derived';
  if (node.semantic_role === 'declaration') return 'declaration';
  return 'input';
}

export function nodeConcepts(bundle: InteractionBundle | null): Map<string, string[]> {
  const result = new Map<string, string[]>();
  bundle?.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      const current = result.get(parameter.concept_id) ?? [];
      if (!current.includes(node.node_id)) current.push(node.node_id);
      result.set(parameter.concept_id, current);
    });
  });
  return result;
}

/** 概念 → 派生绑定（linked 参数的本地概念由派生值喂给，不可手改）。 */
function linkedBindings(bundle: InteractionBundle | null): Map<string, { concept_id: string; factor: number }> {
  const result = new Map<string, { concept_id: string; factor: number }>();
  bundle?.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      if (parameter.binding?.mode !== 'linked' || !parameter.binding.concept_id) return;
      if (!result.has(parameter.concept_id)) {
        result.set(parameter.concept_id, {
          concept_id: parameter.binding.concept_id,
          factor: parameter.binding.factor ?? 1,
        });
      }
    });
  });
  return result;
}

/**
 * 取“该节点读到的概念当前生效值”：linked 参数用派生值（含换算比例），
 * 其余用共享值/种子值兜底。开启“本页保持独立”时必须以它为基准，
 * 否则 linked 参数会瞬间跳回被忽略的本地旧值。
 */
export function effectiveConceptValue(
  bundle: InteractionBundle | null,
  evaluation: BundleEvaluation | null,
  values: CanonicalValues,
  nodeId: string,
  conceptId: string,
): CanonicalValue | null {
  if (!bundle) return null;
  const node = bundle.compiled.nodes.find((item) => item.node_id === nodeId) ?? null;
  const parameter = node?.parameters.find((item) => item.concept_id === conceptId) ?? null;
  if (parameter?.binding?.mode === 'linked' && parameter.binding.concept_id) {
    const derived = evaluation?.derivedValues[parameter.binding.concept_id];
    if (derived !== undefined) return scaleValue(derived, parameter.binding.factor ?? 1);
    return parameter.default;
  }
  if (values[conceptId] !== undefined) return values[conceptId];
  if (bundle.seed_values[conceptId] !== undefined) return bundle.seed_values[conceptId];
  return parameter?.default ?? null;
}

export function conceptCatalog(
  bundle: InteractionBundle | null,
  evaluation: BundleEvaluation | null,
  values: CanonicalValues,
): ConceptEntry[] {
  if (!bundle) return [];
  const consumers = nodeConcepts(bundle);
  const linked = linkedBindings(bundle);
  const entries = new Map<string, ConceptEntry>();
  const add = (node: ModelNode) => {
    const role = roleOf(node);
    const existing = entries.get(node.concept_id);
    const occurrence: ConceptOccurrence = {
      page: node.source.page,
      excerpt: node.source.excerpt || node.name,
      node_id: node.source.node_id ?? null,
    };
    if (existing) {
      if (!existing.occurrences.some((item) => item.page === occurrence.page && item.excerpt === occurrence.excerpt)) {
        existing.occurrences.push(occurrence);
      }
      if (node.domain.min !== null && node.domain.min !== undefined) {
        existing.min = existing.min === null ? Number(node.domain.min) : Math.max(existing.min, Number(node.domain.min));
      }
      if (node.domain.max !== null && node.domain.max !== undefined) {
        existing.max = existing.max === null ? Number(node.domain.max) : Math.min(existing.max, Number(node.domain.max));
      }
      return;
    }
    // linked 参数的本地概念读的是派生值：只读展示，不能在面板里改本地值
    // （改了也只写入 values[本地id]，实际渲染仍走派生值，等于“看似生效实际无效”）。
    const binding = linked.get(node.concept_id) ?? null;
    let value: CanonicalValue | null = null;
    if (binding) {
      const derived = evaluation?.derivedValues[binding.concept_id];
      value = derived !== undefined
        ? scaleValue(derived, binding.factor)
        : node.default;
    } else if (role === 'derived') value = evaluation?.derivedValues[node.concept_id] ?? node.default;
    else if (role === 'declaration') value = node.default;
    else value = values[node.concept_id] ?? node.default;
    const nodeIds = consumers.get(node.concept_id) ?? [];
    entries.set(node.concept_id, {
      concept_id: node.concept_id,
      name: node.name,
      type: node.type,
      unit: node.unit,
      role,
      value,
      min: node.domain.min !== null && node.domain.min !== undefined ? Number(node.domain.min) : null,
      max: node.domain.max !== null && node.domain.max !== undefined ? Number(node.domain.max) : null,
      occurrences: [occurrence],
      nodes: nodeIds,
      editable: role === 'input' && nodeIds.length > 0 && binding === null,
    });
  };
  bundle.graph.nodes.forEach(add);
  // 编译节点里出现但图里漏掉的概念（旧 bundle / 派生输出）也补进目录。
  bundle.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      if (entries.has(parameter.concept_id)) return;
      add({
        concept_id: parameter.concept_id,
        name: parameter.label,
        type: parameter.type,
        unit: parameter.unit,
        dimension: 'scalar',
        domain: { min: parameter.min, max: parameter.max },
        default: parameter.default,
        source: parameter.source,
        semantic_role: 'parameter',
        provenance: parameter.provenance,
      });
    });
    (node.outputs ?? []).forEach((output) => {
      if (entries.has(output.concept_id)) return;
      add({
        concept_id: output.concept_id,
        name: output.name,
        type: output.type,
        unit: output.unit,
        dimension: 'scalar',
        domain: {},
        default: output.type === 'number' || output.type === 'integer'
          ? 0
          : output.type === 'boolean'
            ? false
            : output.type === 'string' || output.type === 'enum'
              ? ''
              : [],
        source: node.source,
        semantic_role: 'derived_output',
        provenance: node.parameters[0]?.provenance ?? {
          origin_type: 'model_inference', evidence: '', inference: '', user_checks: [], method: '',
        },
      });
    });
  });
  const roleRank: Record<ConceptRole, number> = { input: 0, derived: 1, declaration: 2 };
  return [...entries.values()].sort((left, right) =>
    roleRank[left.role] - roleRank[right.role] || left.name.localeCompare(right.name, 'zh-Hans-CN'),
  );
}

function changedOutputs(
  before: PptAiEvaluation | undefined,
  after: PptAiEvaluation | undefined,
  bundle: InteractionBundle,
  nodeId: string,
): { label: string; before: string; after: string }[] {
  if (!before || !after) return [];
  const node = bundle.compiled.nodes.find((item) => item.node_id === nodeId);
  if (!node) return [];
  const changes: { label: string; before: string; after: string }[] = [];
  (node.outputs ?? []).forEach((output) => {
    const left = outputValue(before, output);
    const right = outputValue(after, output);
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    changes.push({ label: output.name, before: formatValue(left), after: formatValue(right) });
  });
  if (changes.length) return changes;
  const beforeMetrics = new Map(before.metrics.map((metric) => [metric.id, metric.value]));
  const afterMetrics = new Map(after.metrics.map((metric) => [metric.id, metric.value]));
  [...new Set([...beforeMetrics.keys(), ...afterMetrics.keys()])].forEach((key) => {
    const left = beforeMetrics.get(key);
    const right = afterMetrics.get(key);
    if (left === right) return;
    changes.push({
      label: after.metrics.find((metric) => metric.id === key)?.label ?? key,
      before: left ?? '—',
      after: right ?? '—',
    });
  });
  return changes.slice(0, 4);
}

export function conclusionChanges(
  bundle: InteractionBundle | null,
  previous: BundleEvaluation | null,
  next: BundleEvaluation | null,
  changedNodeIds: Iterable<string>,
): ConclusionChange[] {
  if (!bundle || !previous || !next) return [];
  const result: ConclusionChange[] = [];
  [...changedNodeIds].forEach((nodeId) => {
    const node = bundle.compiled.nodes.find((item) => item.node_id === nodeId);
    if (!node) return;
    const changes = changedOutputs(previous.nodes[nodeId], next.nodes[nodeId], bundle, nodeId);
    changes.slice(0, 2).forEach((change) => {
      result.push({
        node_id: nodeId,
        title: node.title,
        page: node.source.page,
        label: change.label,
        before: change.before,
        after: change.after,
      });
    });
  });
  return result;
}

export function pagesForNodes(bundle: InteractionBundle | null, nodeIds: Iterable<string>): number[] {
  if (!bundle) return [];
  const wanted = new Set(nodeIds);
  const pages = new Set<number>();
  bundle.compiled.nodes.forEach((node) => {
    if (wanted.has(node.node_id)) pages.add(node.source.page);
  });
  return [...pages].sort((left, right) => left - right);
}

export function baselineValues(bundle: InteractionBundle | null): CanonicalValues {
  const values: CanonicalValues = {};
  bundle?.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      if (parameter.binding?.mode === 'linked') return;
      if (!(parameter.concept_id in values)) values[parameter.concept_id] = parameter.default;
    });
  });
  return values;
}

export function freeConcepts(bundle: InteractionBundle | null): Set<string> {
  const result = new Set<string>();
  bundle?.compiled.nodes.forEach((node) => {
    node.parameters.forEach((parameter) => {
      if (parameter.binding?.mode !== 'linked') result.add(parameter.concept_id);
    });
  });
  return result;
}
