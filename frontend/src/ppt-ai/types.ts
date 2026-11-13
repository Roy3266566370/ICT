/**
 * PPT AI 前端类型（与 backend/app/ppt_ai/types.py、contracts/ppt-ai 对齐）。
 * 只描述网络/运行时需要的字段；未知扩展字段不会进入渲染逻辑。
 */

export type PlanSupportStatus = 'supported' | 'needs_review' | 'explanation_only' | 'unsupported';
export type OriginType = 'native' | 'ocr' | 'model_inference' | 'user_input' | 'supplement' | 'teaching';
export type ExperimentRecipe = 'compare' | 'counterexample' | 'boundary' | 'sensitivity';
export type ExperimentStatus = 'found' | 'not_found_in_scope' | 'unknown' | 'timeout' | 'infeasible_proven';
/** 目标反求的真实状态集合与实验不同：实验的 not_found_in_scope ≠ 目标的 none_in_scope。 */
export type TargetStatus = 'found' | 'multiple' | 'none_in_scope' | 'unknown' | 'timeout' | 'infeasible_proven';
export type BranchKind = 'baseline' | 'practice' | 'candidate';
export type CanonicalValue = number | boolean | string | number[] | number[][];
export type CanonicalValues = Record<string, CanonicalValue>;

export interface BBox { x: number; y: number; w: number; h: number }
export interface UserCheck {
  check_id: string; decision: 'confirm' | 'edit' | 'reject'; note: string;
  checked_at: string; before_hash: string; after_hash: string;
}
export interface Provenance {
  origin_type: OriginType; evidence: string; inference: string;
  user_checks: UserCheck[]; method: string;
}
export interface SourceAnchor {
  material_id: string; page: number; node_id: string | null; element_id: string | null;
  bbox: BBox; excerpt: string; source_version: number; semantic_content_hash: string;
}
export interface RegionIssue { code: string; message: string; severity: 'info' | 'warn' | 'error' }
export interface CoverageEntry {
  page_no: number; native: string[]; ocr: string[]; visual: string[]; manual_review: string[]; skipped: string[];
}
export interface ParameterBinding {
  mode: 'free' | 'linked';
  concept_id: string;
  factor?: number;
}
export interface PlanParameter {
  concept_id: string; id: string; label: string;
  type: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'matrix2' | 'vector2' | 'number_list' | 'number_matrix';
  unit: string; default: CanonicalValue;
  min: number | null; max: number | null; step: number | null;
  options: string[]; shape: number[]; source: SourceAnchor; provenance: Provenance;
  binding?: ParameterBinding;
}
export interface PlanView { view_id: string; type: string; title: string; binding: string; description: string }
export interface PlanReviewItem {
  item_id: string; kind: string; prompt: string; required: boolean; blocking?: boolean; answer: string;
}
export interface InteractionOption {
  option_id: string; region_id: string; title: string; question: string; purpose: string;
  operator_id: string; support_status: PlanSupportStatus; support_reason: string;
  parameters: PlanParameter[]; views: PlanView[]; bindings: Record<string, string>[];
  review_items: PlanReviewItem[]; provider: Record<string, unknown>;
  source: SourceAnchor; offline_supported: boolean;
  learning?: Record<string, unknown> | null;
}
export interface InteractionPlan {
  plan_id: string; plan_revision: number; material_id: string;
  source_revision: number; source_hash: string;
  options: InteractionOption[]; coverage: CoverageEntry[]; issues: RegionIssue[];
  budget: Record<string, unknown>; created_at: string;
}
export interface OutputSpec {
  key: string; concept_id: string; name: string;
  type: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'matrix2' | 'vector2' | 'number_list' | 'number_matrix';
  unit: string;
}
export interface CompiledNode {
  node_id: string; option_id: string; region_id: string; operator_id: string; title: string;
  parameters: PlanParameter[]; outputs?: OutputSpec[];
  views: Record<string, unknown>[]; provider: Record<string, unknown>;
  checks: Record<string, unknown>[]; offline_supported: boolean; source: SourceAnchor;
  learning?: Record<string, unknown> | null;
}
export interface CompiledPayload {
  nodes: CompiledNode[]; order: string[]; ispecs: Record<string, unknown>[];
  checks: Record<string, unknown>[]; resources: Record<string, unknown>[];
  view_contract_version: string;
}
export interface ModelNode {
  concept_id: string; name: string; type: string; unit: string; dimension: string;
  domain: Record<string, number | null>; default: CanonicalValue;
  source: SourceAnchor; semantic_role: string; provenance: Provenance;
}
export interface LinkOccurrence {
  concept_id: string; name: string; page: number; excerpt: string;
  default: CanonicalValue; unit: string; type: string; shape: number[];
  node_id?: string | null;
}
export interface LinkCandidate {
  candidate_id: string; left_concept_id: string; right_concept_id: string;
  relation_type: string; reason: string; confidence: number; conflict: boolean; conflict_note: string;
  concept_ids?: string[]; occurrences?: LinkOccurrence[]; normalized_name?: string;
  source_node_id?: string | null; source_output?: string | null;
  target_node_id?: string | null; target_parameter_id?: string | null;
  declared_value?: number | null;
}
export interface ModelRelation {
  relation_id: string; type: string; inputs: string[]; outputs: string[]; expression: string | null;
  operator_id: string | null; source: SourceAnchor[]; review_status: string; note: string;
}
export interface SemanticGraph {
  nodes: ModelNode[]; relations: ModelRelation[]; candidates: LinkCandidate[];
  conflicts: Record<string, unknown>[]; graph_revision: number;
  dependency_order?: string[];
}
export interface InteractionBundle {
  bundle_id: string; bundle_revision: number; schema_version: string; material_id?: string;
  source_revision: number; source_hash: string; registry_version: string;
  status: string; content_hash: string; plans: InteractionPlan[]; graph: SemanticGraph;
  compiled: CompiledPayload; seed_values: CanonicalValues;
  created_at: string;
}
export interface EvaluationSnapshot {
  input_hash: string; evaluation_hash: string; branch_revision: number;
  values: CanonicalValues;
  derived: Record<string, Record<string, unknown>>;
  derived_values?: CanonicalValues;
  trace: Record<string, unknown>[]; checks: Record<string, unknown>[];
  violations: Record<string, unknown>[]; stop_reason: string; kernel_version: string;
}
export interface BranchState {
  branch_id: string; bundle_id: string; material_id: string; revision: number;
  status: 'active' | 'candidate' | 'archived'; kind: BranchKind; title: string;
  parent_branch_id: string | null;
  canonical_values: CanonicalValues;
  overrides?: Record<string, CanonicalValues>;
  evaluation: EvaluationSnapshot | null;
  learning?: Record<string, unknown>;
  updated_at: string;
}
export interface ExperimentCondition {
  concept_id: string; label: string; value: CanonicalValue;
  origin_type: OriginType; note: string;
}
export interface ExperimentCandidate {
  path_id: string; label: string; values: CanonicalValues;
  output_value: number | null; result: Record<string, unknown>;
  checks: Record<string, unknown>[]; witness: Record<string, unknown> | null;
}
export interface ExperimentResult {
  status: ExperimentStatus; recipe_id: ExperimentRecipe;
  used_scope: Record<string, [number, number]>; candidate_count: number;
  paths: ExperimentCandidate[]; checks: Record<string, unknown>[];
  result_hash: string; branch_id: string | null; explanation: string[]; stop_reason: string;
}
export interface Experiment {
  experiment_id: string; material_id: string; bundle_id: string;
  branch_id: string | null; parent_branch_id: string | null;
  question: string; recipe_id: string;
  draft: Record<string, unknown>; result: ExperimentResult | null;
  status: string; created_at: string;
}
export interface TargetSolution {
  unknowns: string[]; values: number[];
  classification: 'unique' | 'particular' | 'scalar_candidate';
  exact_values: string[];
  free_variables: string[]; nullspace_basis: number[][];
  equations: string[];
  verification: { label: string; expected: string; actual: string; residual: number | null; status: 'pass' | 'fail' | 'not_checked' }[];
}
export interface TargetCandidate {
  values: CanonicalValues;
  output_value: number | null; residual: number | null; method: string;
  solution?: TargetSolution | null;
}
export interface TargetResult {
  status: TargetStatus; output: string; target_value: number;
  candidates: TargetCandidate[]; method: string; tolerance: number;
  atol: number; rtol: number; residual: number | null;
  search_scope: Record<string, [number, number]>; iterations: number;
  stop_reason: string; checks: Record<string, unknown>[];
  candidate_branch_id: string | null;
}
export interface ValidationRule {
  rule_id: string; category: 'source' | 'math' | 'program' | 'interaction' | 'visual';
  status: 'pass' | 'fail' | 'not_covered' | 'warn';
  message: string; evidence?: Record<string, unknown> | null;
}
export interface ValidationReport {
  report_id: string; material_id: string; bundle_id: string;
  branch_id: string | null; artifact_id: string | null;
  bundle_hash: string; branch_hash: string; kernel_version: string; runtime_version: string;
  status: 'passed' | 'needs_review' | 'failed' | 'stale';
  summary: { pass: number; fail: number; not_covered: number; warn: number };
  rules: ValidationRule[]; semantic_review: PlanReviewItem[];
  browser: { status: 'passed' | 'failed' | 'skipped'; checks: Record<string, unknown>[]; screenshots?: string[]; viewport?: string | null; note?: string };
  repair: Record<string, unknown> | null; created_at: string; stale: boolean;
}
export interface GeneratedViewArtifact {
  artifact_id: string; material_id: string; bundle_id: string; content_hash: string;
  view_contract_version: string; program: string;
  ast: Record<string, unknown>; resources: Record<string, unknown>[];
  supported_interactions: string[]; offline_supported: boolean;
  acceptance_status: 'pending' | 'accepted' | 'rejected';
  isolation: Record<string, unknown>; created_at: string;
}
export interface PptAITask {
  task_id: string; material_id: string; kind: string; status: string; stage: string;
  operation_id: string; input_version: number; input_hash: string; budget_used: number;
  result: Record<string, unknown> | null; error_code: string | null; error_message: string | null;
  attempt: number; created_at: string; updated_at: string;
}
export interface PptAiOverview {
  ai_enabled: boolean; generated_views_enabled: boolean;
  model: { available: boolean; provider: string; model: string; base_url: string; max_calls: number; max_tokens: number };
  document_revision: number;
  plan: InteractionPlan | null; plan_created_at: string | null;
  bundle: InteractionBundle | null;
  bundle_summaries: Record<string, unknown>[];
  branch: BranchState | null;
  branches: Record<string, unknown>[];
  report: ValidationReport | null;
  experiments: Experiment[];
  artifacts: GeneratedViewArtifact[];
  frozen: Record<string, unknown> | null;
  capabilities: Record<string, unknown>[];
}
export interface PptAiActive {
  enabled: boolean;
  generated_views_enabled: boolean;
  learning_enabled?: boolean;
  bundle: InteractionBundle | null;
  branch: BranchState | null;
  artifacts: GeneratedViewArtifact[];
}
