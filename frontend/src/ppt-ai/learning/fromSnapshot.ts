/** 冻结/离线快照 → 只读学习页；不发起联网问答，也不写入作者空间。 */

import type { PptAiRuntimeSnapshot } from '@/ppt-ai/runtime/snapshot';
import type { LearningValues } from './controller.ts';
import type {
  LearningCapabilities,
  LearningDescriptor,
  LearningItem,
  LearningPage,
} from './types';

function baselineFor(snapshot: PptAiRuntimeSnapshot, nodeId: string): LearningValues {
  const node = snapshot.bundle?.compiled.nodes.find((entry) => entry.node_id === nodeId);
  if (!node) return {};
  const result: LearningValues = {};
  node.parameters.forEach((parameter) => {
    const value = snapshot.branch?.canonical_values?.[parameter.concept_id] ?? parameter.default;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      result[parameter.concept_id] = value;
    }
  });
  return result;
}

function stateFor(nodeId: string, snapshot: PptAiRuntimeSnapshot): LearningItem['state'] {
  const node = snapshot.bundle?.compiled.nodes.find((entry) => entry.node_id === nodeId);
  if (!node) return 'unsupported';
  if (node.checks.some((check) => check.status === 'fail')) return 'unsupported';
  if (node.operator_id === 'explain.text') return 'explanation_only';
  return 'ready';
}

export function learningPageFromFrozen(
  snapshot: PptAiRuntimeSnapshot | null | undefined,
  pageNo: number,
): LearningPage | null {
  if (!snapshot?.frozen || !snapshot.bundle || !snapshot.branch || !snapshot.learning?.length) return null;
  const nodes = snapshot.bundle.compiled.nodes;
  const descriptors: LearningDescriptor[] = snapshot.learning.filter((descriptor) => {
    const item = descriptor as LearningDescriptor & { node_id?: string };
    const node = nodes.find((entry) => entry.node_id === item.node_id);
    return node?.source.page === pageNo;
  });
  if (!descriptors.length) return null;
  const items: LearningItem[] = descriptors.map((descriptor) => {
    const entry = descriptor as LearningDescriptor & { node_id?: string; region_id?: string };
    const nodeId = String(entry.node_id ?? '');
    const node = nodes.find((item) => item.node_id === nodeId);
    const state = stateFor(nodeId, snapshot);
    return {
      item_id: nodeId,
      node_id: nodeId,
      region_id: String(entry.region_id ?? node?.region_id ?? ''),
      title: descriptor.title,
      state,
      support_status: state,
      descriptor,
      baseline_values: baselineFor(snapshot, nodeId),
      explanation_ready: true,
      experiment_ready: state === 'ready',
      manual_review_reason: '',
      packaged_explanation:
        (descriptor as LearningDescriptor & { packaged_explanation?: LearningItem['packaged_explanation'] })
          .packaged_explanation ?? null,
    };
  });
  const capabilities: LearningCapabilities = {
    can_explain_online: false,
    can_ask_online: false,
    can_explore_locally: snapshot.capabilities?.can_explore_locally ?? true,
    can_save_cloud: false,
    can_manage: false,
  };
  const pageState = items.some((item) => item.state === 'ready')
    ? 'ready'
    : items.every((item) => item.state === 'explanation_only')
      ? 'explanation_only'
      : 'unsupported';
  return {
    contract_version: 'ppt-learning.1',
    material_id: '',
    page_no: pageNo,
    document_revision: snapshot.bundle.source_revision,
    source_hash: snapshot.bundle.source_hash,
    bundle_id: snapshot.bundle.bundle_id ?? null,
    bundle_revision: snapshot.bundle.bundle_revision ?? null,
    branch_id: snapshot.branch.branch_id,
    branch_revision: snapshot.branch.revision,
    branch_kind: (snapshot.branch.kind as LearningPage['branch_kind']) ?? 'baseline',
    state: pageState,
    items,
    pending_task_id: null,
    capabilities,
    note: '已打包内容；本地调参保留在本机，不发起联网问答。',
    generated_at: new Date().toISOString(),
  };
}
