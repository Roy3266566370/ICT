/** 学习呈现契约（与 backend/app/ppt_ai/learning_types.py 对齐）。 */

import type { BBox, BranchKind, OriginType, TargetSolution } from '@/ppt-ai/types';

export const LEARNING_CONTRACT_VERSION = 'ppt-learning.1';

export type LearningGoal =
  | 'eigen_direction'
  | 'change_of_basis'
  | 'inverse_mapping'
  | 'registered_exploration'
  | 'explain';
export type LearningTemplate =
  | 'matrix.eigen_probe'
  | 'matrix.change_of_basis'
  | 'matrix.inverse'
  | 'generic.registered'
  | 'text.explain';
export type LearningState =
  | 'unprepared'
  | 'preparing'
  | 'ready'
  | 'needs_review'
  | 'explanation_only'
  | 'unsupported'
  | 'failed'
  | 'stale';
export type LearningReplyState =
  | 'answered'
  | 'needs_clarification'
  | 'action_ready'
  | 'unsupported'
  | 'stale';

export interface LearningContext {
  contract_version: typeof LEARNING_CONTRACT_VERSION;
  document_revision: number;
  source_hash: string;
  bundle_id: string;
  bundle_revision: number;
  page_no: number;
  node_id: string;
  region_id: string;
  branch_id: string;
  branch_revision: number;
  draft_revision: number;
  client_request_id: string;
  input_values: Record<string, unknown>;
  input_hash: string | null;
}

export interface LearningSourceRef {
  material_id: string;
  page_no: number;
  node_id: string | null;
  region_id: string | null;
  element_id: string | null;
  bbox: BBox;
  excerpt: string;
  semantic_content_hash: string;
  origin_type: OriginType;
}

export interface LearningControl {
  concept_id: string;
  label: string;
  role: 'fixed' | 'editable';
  min: number | null;
  max: number | null;
  step: number | null;
  precision: number;
  unit: string;
  reason: string;
}

export interface LearningSuggestedAction {
  action_type: 'explain' | 'run_experiment' | 'solve_target' | 'compare' | 'counterexample';
  label: string;
  question: string;
}

export interface LearningReviewItem {
  item_id: string;
  field: string;
  prompt: string;
  current_value: string;
  basis: string;
  required: boolean;
  resolved: boolean;
}

export interface LearningDescriptor {
  contract_version: typeof LEARNING_CONTRACT_VERSION;
  goal_id: LearningGoal;
  title: string;
  objective: string;
  source_refs: LearningSourceRef[];
  template_id: LearningTemplate;
  bindings: Record<string, string>;
  fixed_roles: string[];
  editable_roles: string[];
  controls: LearningControl[];
  suggested_actions: LearningSuggestedAction[];
  review_items: LearningReviewItem[];
  notes: string[];
}

export interface LearningCapabilities {
  can_explain_online: boolean;
  can_ask_online: boolean;
  can_explore_locally: boolean;
  can_save_cloud: boolean;
  can_manage: boolean;
}

export interface LearningItem {
  item_id: string;
  node_id: string;
  region_id: string;
  title: string;
  state: LearningState;
  support_status: string;
  descriptor: LearningDescriptor;
  baseline_values: Record<string, number | boolean | string>;
  explanation_ready: boolean;
  experiment_ready: boolean;
  manual_review_reason: string;
  packaged_explanation?: LearningResultCard | null;
}

export interface LearningPage {
  contract_version: typeof LEARNING_CONTRACT_VERSION;
  material_id: string;
  page_no: number;
  document_revision: number;
  source_hash: string;
  bundle_id: string | null;
  bundle_revision: number | null;
  branch_id: string | null;
  branch_revision: number | null;
  branch_kind: BranchKind | null;
  state: LearningState;
  items: LearningItem[];
  pending_task_id: string | null;
  capabilities: LearningCapabilities;
  note: string;
  generated_at: string;
}

export interface LearningCondition {
  concept_id: string;
  label: string;
  value: unknown;
  origin_type: OriginType;
  note: string;
}

export interface LearningActionDraft {
  action_id: string;
  kind: 'run_experiment' | 'solve_target';
  context: LearningContext;
  summary: string;
  conditions: LearningCondition[];
  added_conditions: LearningCondition[];
  execution_payload: Record<string, unknown>;
  created_at: string;
}

export interface LearningVerification {
  label: string;
  expected: string;
  actual: string;
  residual: number | null;
  status: 'pass' | 'fail' | 'not_checked';
}

export interface LearningResultCard {
  card_id: string;
  title: string;
  conclusion: string;
  solution: TargetSolution | null;
  steps: string[];
  verification: LearningVerification[];
  source_refs: LearningSourceRef[];
  scope: Record<string, unknown>;
  limitations: string[];
  next_actions: string[];
  input_hash: string;
  request_hash: string;
  task_id: string;
  result_kind: 'explanation' | 'experiment' | 'target';
  stale: boolean;
}

export interface LearningReply {
  reply_id: string;
  material_id: string;
  page_no: number;
  node_id: string;
  branch_id: string;
  client_request_id: string;
  draft_revision: number;
  input_hash: string;
  request_hash: string;
  state: LearningReplyState;
  answer_card: LearningResultCard | null;
  clarification: string;
  action_draft: LearningActionDraft | null;
  task_id: string;
}

export interface LearningPractice {
  practice_id: string;
  branch_id: string;
  title: string;
  bundle_id: string;
  node_id: string;
  page_no: number;
  revision: number;
  values: Record<string, unknown>;
  context_input_hash: string;
  created_at: string;
  updated_at: string;
  branch_state: Record<string, unknown>;
}

export interface LearningPublishSelection {
  mode: 'baseline' | 'practice' | 'original_only';
  bundle_id: string | null;
  expected_bundle_revision: number | null;
  branch_id: string | null;
  expected_branch_revision: number | null;
  expected_document_revision: number | null;
  selected_learning_item_ids: string[];
  selected_experiment_ids: string[];
}

export interface LearningPreviewResult {
  selection: LearningPublishSelection;
  checks: { id: string; status: string; message: string }[];
  can_publish: boolean;
  blocked_reason?: string;
  snapshot: Record<string, unknown> | null;
  content_hash: string;
  previewed_at: string;
  public_item_count?: number;
  public_experiment_count?: number;
}

export interface LearningPageResponse extends LearningPage {}

export interface LearningTaskStart {
  task_id: string;
  status: string;
  stage: string;
  status_url: string;
}
