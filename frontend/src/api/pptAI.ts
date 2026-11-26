/** PPT AI HTTP 客户端（独立于材料 ApiClient，便于按功能懒加载）。 */

import { requestDownload, requestJson } from './client';
import type {
  BranchState,
  CanonicalValue,
  Experiment,
  GeneratedViewArtifact,
  InteractionBundle,
  InteractionPlan,
  PptAiActive,
  PptAiOverview,
  PptAITask,
  TargetResult,
  ValidationReport,
} from '@/ppt-ai/types';
import type {
  LearningContext,
  LearningPage,
  LearningPractice,
  LearningPreviewResult,
  LearningPublishSelection,
  LearningReply,
  LearningResultCard,
  LearningTaskStart,
} from '@/ppt-ai/learning/types';

const P = '/api/v1';
const materialPath = (id: string) => `${P}/materials/${encodeURIComponent(id)}`;

function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function getPptAiOverview(materialId: string): Promise<PptAiOverview> {
  return requestJson<PptAiOverview>(`${materialPath(materialId)}/ai-overview`);
}

export async function getPptAiActive(materialId: string): Promise<PptAiActive> {
  return requestJson<PptAiActive>(`${materialPath(materialId)}/ai-active`);
}

export async function createPptAiPlan(
  materialId: string,
  body: { expected_document_revision?: number; operation_id: string; region_ids?: string[]; purpose?: string },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-plans`, body);
}

export async function getPptAiTask(materialId: string, taskId: string, signal?: AbortSignal): Promise<PptAITask> {
  return requestJson<PptAITask>(`${materialPath(materialId)}/ai-tasks/${encodeURIComponent(taskId)}`, signal ? {signal} : undefined);
}

export async function waitForPptAiTask(
  materialId: string,
  taskId: string,
  onUpdate?: (task: PptAITask) => void,
  timeoutMs = 360_000,
  signal?: AbortSignal,
): Promise<PptAITask> {
  const deadline = Date.now() + timeoutMs;
  let last: PptAITask | null = null;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const task = await getPptAiTask(materialId, taskId, signal);
    last = task;
    onUpdate?.(task);
    if (['succeeded', 'needs_review', 'failed', 'cancelled', 'superseded'].includes(task.status)) return task;
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
  throw new Error(last?.error_message || '任务等待超时，可稍后在总览中查看状态');
}

export async function getPptAiPlan(materialId: string, planId: string): Promise<InteractionPlan> {
  return requestJson<InteractionPlan>(`${materialPath(materialId)}/ai-plans/${encodeURIComponent(planId)}`);
}

export async function applyPptAiPlan(
  materialId: string,
  planId: string,
  body: {
    expected_plan_revision: number;
    expected_document_revision?: number;
    operation_id: string;
    selected_option_ids: string[];
    confirmed_option_ids?: string[];
    parameter_overrides: Record<string, Record<string, CanonicalValue | { value: CanonicalValue; min?: number | null; max?: number | null; step?: number | null }>>;
  },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-plans/${encodeURIComponent(planId)}/apply`, body);
}

export async function retryPptAiRegion(
  materialId: string,
  regionId: string,
  body: { expected_document_revision?: number; operation_id: string; note?: string },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-regions/${encodeURIComponent(regionId)}/retry`, body);
}

export async function getPptAiBundle(materialId: string, bundleId: string): Promise<InteractionBundle> {
  return requestJson<InteractionBundle>(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}`);
}

export interface LinkPreviewResult {
  ok: boolean;
  cycles: string[][];
  cycle_nodes: { node_id: string; title: string }[];
  conflicts: { candidate_id: string; relation_type: string; note: string }[];
  diagnostics: { candidate_id: string; relation_type: string; notes: string[]; conflict: boolean }[];
  affected_nodes: {
    node_id: string; title: string; page: number;
    changes: { key: string; concept_id: string; label: string; before: unknown; after: unknown }[];
  }[];
  affected_pages: number[];
  before: { evaluation_hash: string; values: Record<string, unknown>; derived_values: Record<string, unknown> };
  after: { evaluation_hash: string; values: Record<string, unknown>; derived_values: Record<string, unknown> };
}

export async function previewPptAiLinks(
  materialId: string,
  bundleId: string,
  body: {
    decisions: {
      candidate_id: string;
      decision: 'confirm' | 'reject' | 'split';
      concept_id?: string;
      value?: unknown;
      value_concept_id?: string;
      expected_graph_revision?: number;
      note?: string;
    }[];
    values?: Record<string, unknown> | null;
    overrides?: Record<string, Record<string, unknown>> | null;
  },
): Promise<LinkPreviewResult> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/links/preview`, body);
}

export async function confirmPptAiLinks(
  materialId: string,
  bundleId: string,
  body: {
    expected_bundle_revision: number;
    operation_id: string;
    decisions: {
      candidate_id: string;
      decision: 'confirm' | 'reject' | 'split';
      concept_id?: string;
      value?: unknown;
      value_concept_id?: string;
      expected_graph_revision?: number;
      note?: string;
    }[];
    /** 值来源分支：确认时把该分支的值迁移到新分支 */
    branch_id?: string | null;
    /** 工作区实时值/局部覆盖（可能未保存）；服务端迁移到新分支 */
    values?: Record<string, unknown> | null;
    overrides?: Record<string, Record<string, unknown>> | null;
  },
): Promise<{ bundle_id: string; bundle_revision: number; branch_id: string | null; content_hash: string; notes?: string[] }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/links`, body);
}

export async function unlinkPptAiRelation(
  materialId: string,
  bundleId: string,
  body: {
    expected_bundle_revision: number;
    operation_id: string;
    relation_id: string;
    branch_id?: string | null;
    values?: Record<string, unknown> | null;
    overrides?: Record<string, Record<string, unknown>> | null;
  },
): Promise<{ bundle_id: string; bundle_revision: number; branch_id: string | null; content_hash: string; notes?: string[] }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/links/unlink`, body);
}

export async function revertPptAiBundle(
  materialId: string,
  bundleId: string,
  body: { expected_bundle_revision: number; operation_id: string; target_bundle_id: string },
): Promise<{ bundle_id: string; bundle_revision: number }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/revert`, body);
}

export async function createPptAiExperiment(
  materialId: string,
  bundleId: string,
  body: {
    branch_id: string;
    expected_branch_revision: number;
    operation_id: string;
    question: string;
    recipe_hint?: 'compare' | 'counterexample' | 'boundary' | 'sensitivity' | null;
    selection?: Record<string, unknown>;
    allowed_variables?: string[];
    ranges?: Record<string, [number, number]>;
  },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/experiments`, body);
}

export async function getPptAiExperiment(materialId: string, experimentId: string): Promise<Experiment> {
  return requestJson<Experiment>(`${materialPath(materialId)}/ai-experiments/${encodeURIComponent(experimentId)}`);
}

export async function searchPptAiTarget(
  materialId: string,
  bundleId: string,
  body: {
    branch_id: string;
    expected_branch_revision: number;
    operation_id: string;
    node_id: string;
    output: string;
    target_value: number;
    target_vector?: number[] | null;
    variables: string[];
    fixed?: Record<string, CanonicalValue>;
    constraints?: Record<string, unknown>[];
    ranges?: Record<string, [number, number]>;
    tolerance?: number;
    max_iterations?: number;
  },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/target-search`, body);
}

export async function getPptAiBranch(materialId: string, branchId: string): Promise<BranchState> {
  return requestJson<BranchState>(`${materialPath(materialId)}/ai-branches/${encodeURIComponent(branchId)}`);
}

export async function patchPptAiBranch(
  materialId: string,
  branchId: string,
  body: {
    expected_revision: number;
    operation_id: string;
    values?: Record<string, CanonicalValue>;
    overrides?: Record<string, Record<string, CanonicalValue>> | null;
  },
): Promise<BranchState> {
  return requestJson<BranchState>(`${materialPath(materialId)}/ai-branches/${encodeURIComponent(branchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function validatePptAiBundle(
  materialId: string,
  bundleId: string,
  body: {
    branch_id?: string | null;
    expected_branch_revision?: number | null;
    operation_id: string;
    cases?: Record<string, unknown>[];
    auto_repair?: boolean;
    browser?: Record<string, unknown> | null;
  },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/validate`, body);
}

export async function getPptAiReport(materialId: string, reportId: string): Promise<ValidationReport> {
  return requestJson<ValidationReport>(`${materialPath(materialId)}/ai-reports/${encodeURIComponent(reportId)}`);
}

export async function createPptAiGeneratedView(
  materialId: string,
  bundleId: string,
  body: { branch_id: string; node_id: string; requirement: string; operation_id: string },
): Promise<{ task_id: string; status: string; stage: string; status_url: string }> {
  return post(`${materialPath(materialId)}/ai-bundles/${encodeURIComponent(bundleId)}/generated-views`, body);
}

export async function getPptAiArtifact(materialId: string, artifactId: string): Promise<GeneratedViewArtifact> {
  return requestJson<GeneratedViewArtifact>(`${materialPath(materialId)}/ai-artifacts/${encodeURIComponent(artifactId)}`);
}

export async function recordPptAiArtifactAcceptance(
  materialId: string,
  artifactId: string,
  body: { status: 'accepted' | 'rejected'; evidence: Record<string, unknown> },
): Promise<{ artifact_id: string; acceptance_status: string; offline_supported: boolean }> {
  return post(`${materialPath(materialId)}/ai-artifacts/${encodeURIComponent(artifactId)}/acceptance`, body);
}

export type { PageLabParam, PageLab } from '../ppt-ai/pageLabTypes';
import type { PageLab } from '../ppt-ai/pageLabTypes';

export async function getPageLab(materialId: string, pageNo: number): Promise<{ lab: PageLab | null }> {
  return requestJson(`${materialPath(materialId)}/pages/${pageNo}/ai-lab`);
}

export async function createPageLab(
  materialId: string,
  pageNo: number,
  force = false,
): Promise<{ lab: PageLab; cached: boolean }> {
  return post(`${materialPath(materialId)}/pages/${pageNo}/ai-lab`, { force });
}

export async function getPptAiCapabilities(): Promise<{
  enabled: boolean;
  generated_views_enabled: boolean;
  registry: Record<string, unknown>[];
  model: Record<string, unknown>;
}> {
  return requestJson(`${P}/ppt-ai/capabilities`);
}

// ---------------------------------------------------------------------------
// 原页学习（ppt-learning.1）
// ---------------------------------------------------------------------------

export function getLearningPage(
  materialId: string,
  pageNo: number,
  nodeId?: string,
): Promise<LearningPage> {
  const query = new URLSearchParams({ page_no: String(pageNo) });
  if (nodeId) query.set('node_id', nodeId);
  return requestJson<LearningPage>(`${materialPath(materialId)}/ai-learning?${query.toString()}`);
}

export function prepareLearning(
  materialId: string,
  body: { expected_document_revision?: number; region_ids?: string[]; purpose?: string; operation_id: string },
): Promise<LearningTaskStart> {
  return post(`${materialPath(materialId)}/ai-learning/prepare`, body);
}

export function createLearningExplanation(
  materialId: string,
  body: { context: LearningContext; mode?: 'concept' | 'change'; operation_id: string },
): Promise<LearningTaskStart> {
  return post(`${materialPath(materialId)}/ai-learning/explanations`, body);
}

export function createLearningQuestion(
  materialId: string,
  body: {
    context: LearningContext;
    question: string;
    suggested_action?: 'explain' | 'run_experiment' | 'solve_target' | 'compare' | 'counterexample' | null;
    operation_id: string;
  },
): Promise<LearningTaskStart> {
  return post(`${materialPath(materialId)}/ai-learning/questions`, body);
}

export function executeLearningAction(
  materialId: string,
  actionId: string,
  body: { context: LearningContext; operation_id: string },
): Promise<LearningTaskStart> {
  return post(
    `${materialPath(materialId)}/ai-learning/actions/${encodeURIComponent(actionId)}/execute`,
    body,
  );
}

export function createLearningPractice(
  materialId: string,
  body: { context: LearningContext; title?: string; operation_id: string },
): Promise<LearningTaskStart> {
  return post(`${materialPath(materialId)}/ai-learning/practices`, body);
}

export function getLearningPractices(
  materialId: string,
  bundleId?: string,
): Promise<{ items: LearningPractice[]; count: number }> {
  const suffix = bundleId ? `?bundle_id=${encodeURIComponent(bundleId)}` : '';
  return requestJson(`${materialPath(materialId)}/ai-learning/practices${suffix}`);
}

export function verifyLearningRuntime(
  materialId: string,
  body: {
    bundle_id: string;
    expected_bundle_revision: number;
    branch_id: string;
    expected_branch_revision: number;
    expected_document_revision?: number | null;
    selected_learning_item_ids: string[];
    operation_id: string;
  },
): Promise<LearningTaskStart> {
  return post(`${materialPath(materialId)}/ai-learning/validate`, body);
}

export function previewLearningPublication(
  materialId: string,
  selection: LearningPublishSelection,
): Promise<LearningPreviewResult> {
  return post(`${materialPath(materialId)}/ai-learning/preview`, { selection });
}

export async function exportPptAiLearningHtml(
  materialId: string,
  selection: LearningPublishSelection,
): Promise<Blob> {
  return requestDownload(`${materialPath(materialId)}/export-html`, selection);
}

export function getLearningHealth(
  materialId: string,
): Promise<{ pp_enabled: boolean; learning_enabled: boolean; material_id: string; checked_at: string }> {
  return requestJson(`${materialPath(materialId)}/ai-learning/health`);
}

export function learningReplyFromTask(task: PptAITask): LearningReply | null {
  const reply = task.result?.reply;
  return typeof reply === 'object' && reply !== null ? (reply as unknown as LearningReply) : null;
}

export function learningCardFromTask(task: PptAITask): LearningResultCard | null {
  const card = task.result?.card;
  return typeof card === 'object' && card !== null ? (card as unknown as LearningResultCard) : null;
}

export function taskResultNumber(task: PptAITask, key: string): number | null {
  const value = task.result?.[key];
  return typeof value === 'number' ? value : null;
}

export function taskResultString(task: PptAITask, key: string): string | null {
  const value = task.result?.[key];
  return typeof value === 'string' ? value : null;
}

export type { TargetResult };
