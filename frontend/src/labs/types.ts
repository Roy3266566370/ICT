/** 题目实验室的前端权威类型（与后端 `lab.1` 文档逐字对应）。 */
import type { HeapResult } from './heap.ts';
import type { LinAlgResult } from './linalg.ts';
import type { OsResult } from './opsys.ts';
import type { CoResult } from './compOrg.ts';

export type LabSubject =
  | 'calculus' | 'optimization' | 'algorithm' | 'deep_learning' | 'linear_algebra' | 'operating_system'
  | 'computer_organization' | 'computer_network' | 'unknown';
export type LabStatus = 'ready' | 'needs_review' | 'unsupported';
export type LabMode = 'explore' | 'guided' | 'solution';
export type LabProvenance = 'original' | 'inferred' | 'user_confirmed' | 'supplement' | 'teaching';
export type LabScalar = number | string | boolean;

export const SUBJECT_LABELS: Record<LabSubject, string> = {
  calculus: '微积分',
  optimization: '最优化',
  algorithm: '数据结构与算法',
  deep_learning: '深度学习',
  linear_algebra: '线性代数',
  operating_system: '操作系统',
  computer_organization: '计算机组成原理',
  computer_network: '计算机网络',
  unknown: '待确认',
};

export const SUBJECT_SHORT: Record<LabSubject, string> = {
  calculus: 'CALCULUS',
  optimization: 'OPTIMIZATION',
  algorithm: 'ALGORITHM',
  deep_learning: 'DEEP LEARNING',
  linear_algebra: 'LINEAR ALGEBRA',
  operating_system: 'OPERATING SYSTEM',
  computer_organization: 'COMPUTER ORGANIZATION',
  computer_network: 'NETWORK',
  unknown: 'UNKNOWN',
};

export const PROVENANCE_LABELS: Record<LabProvenance, string> = {
  original: '原题',
  inferred: '推断',
  user_confirmed: '已核对',
  supplement: '补充条件',
  teaching: '教学示例',
};

export const MODE_LABELS: Record<LabMode, { title: string; hint: string }> = {
  explore: { title: '自主探索', hint: '自己操作模型，需要时再要提示' },
  guided: { title: '引导解题', hint: '按当前步骤给提示、组织实验' },
  solution: { title: '完整讲解', hint: '查看分步解答与完整执行过程' },
};

export interface LabSourcePage {
  file_id: string;
  page: number;
  text: string;
  method: string;
  image_key: string | null;
}

export interface LabSourceFile {
  file_id: string;
  name: string;
  role: 'problem' | 'data' | 'attempt' | 'reference' | 'courseware';
  role_label: string;
  kind: string;
  pages: number;
  chars: number;
  methods: string[];
  stored_name?: string | null;
}

export interface LabSourceRef {
  file_id?: string;
  page?: number;
  excerpt?: string;
}

export interface LabCondition {
  id: string;
  label: string;
  value: unknown;
  kind: string;
  unit: string;
  provenance: LabProvenance;
  source: LabSourceRef;
  editable: boolean;
  options: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  note?: string;
}

export interface LabAmbiguity {
  id: string;
  field: string;
  question: string;
  severity: 'blocking' | 'notice';
  options: { value: string; label: string }[];
  resolved: boolean;
  answer: string | null;
}

export interface LabFormula {
  id: string;
  tex: string;
  plain: string;
  role: string;
}

export interface LabRecognition {
  method: string;
  raw_text: string;
  conditions: LabCondition[];
  ambiguities: LabAmbiguity[];
  formulas: LabFormula[];
  recognized_subject: LabSubject;
  ai_used?: boolean;
  reference_answer_text?: string;
}

export interface LabModelParam {
  id: string;
  label: string;
  kind: string;
  min: number | null;
  max: number | null;
  step: number | null;
  options: string[];
  note?: string;
}

export interface LabModel {
  modeling_task?: string;
  goal?: 'extrema' | 'gradient_descent' | 'radius' | 'sum' | 'expand';
  engine: string;
  subject: LabSubject;
  kind?: 'integral' | 'derivative' | 'antiderivative' | 'limit' | 'taylor' | 'higher_derivative' | 'function_study' | 'ode' | 'series_convergence' | 'power_series' | 'fourier_series' | 'space' | 'proof' | 'multivariable' | 'multivariable_extrema';
  task?: 'geometric_area' | 'area_volume' | 'implicit_normal' | 'double_integral' | 'limit' | 'taylor' | 'higher_derivative' | 'function_study' | 'ode' | 'constrained_extrema' | 'series_convergence' | 'power_series' | 'fourier_series' | 'triple_integral' | 'line_integral' | 'surface_integral' | 'green' | 'gauss' | 'stokes' | 'space_geometry' | 'proof' | 'multivariable' | 'multivariable_extrema';
  analysis_kind?: 'limit' | 'taylor' | 'higher_derivative' | 'function_study';
  side?: 'both' | 'left' | 'right';
  limit_point?: string;
  limit_point_value?: number | null;
  taylor_point?: string;
  taylor_point_value?: number;
  order?: number;
  derivative_point?: string;
  study_lower?: number | null;
  study_upper?: number | null;
  equation?: string;
  initial_conditions?: string[];
  independent_variable?: string;
  dependent_variable?: string;
  target_kind?: string;
  target_point?: string | null;
  target_lower?: string | null;
  target_upper?: string | null;
  constraint?: string;
  constraint_expression?: string;
  proof_kind?: string;
  lower?: string;
  upper?: string;
  statement?: string;
  steps?: string[];
  left?: string;
  right?: string;
  relation?: string;
  term?: string;
  coefficient?: string;
  center?: string;
  index_start?: number;
  integrand?: string;
  outer_variable?: 'x' | 'y' | 'theta';
  inner_variable?: 'x' | 'y' | 'r';
  outer_bounds?: [string, string];
  inner_bounds?: [string, string];
  region_kind?: 'strip' | 'pieces' | 'polar' | 'improper' | 'polar_improper' | 'strip_improper' | 'affine' | 'change_variables';
  pieces?: DoubleIntegralPiece[];
  polar?: DoubleIntegralPolar;
  swapped?: DoubleIntegralSwapped | DoubleIntegralSwapped[] | null;
  swap_order?: boolean;
  inner_bounds_tex?: [string, string];
  exact?: string;
  answer_value?: number;
  lower_bound?: string;
  upper_bound?: string;
  boundary_roots?: string[];
  requested_quantities?: string[];
  implicit_expression?: string;
  point_x?: string;
  point_y?: string;
  normal_slope?: string | null;
  vertical_normal?: boolean;
  partial_x?: string;
  partial_y?: string;
  reference_quantities?: { id: string; label: string; exact: string; value: number; latex?: string }[];
  solved_quantities?: { id: string; label: string; exact: string; value: number; latex?: string }[];
  variable?: string;
  expression?: string;
  defaults: Record<string, unknown>;
  params: LabModelParam[];
  teaching?: boolean;
  provenance_note?: string | null;
  formula_tex?: string;
  /** 原题上限为 +∞：图像使用有限截断区间，解析值仍按无穷积分计算 */
  improper_upper?: boolean;
  original_upper?: string;
  visual_upper?: number;
  /** 不定积分：被积函数与后端算出的原函数，前端据此绘制 F(x)+C 一族 */
  indefinite?: boolean;
  antiderivative_expression?: string | null;
  plot_domain?: [number, number];
  // optimization
  variables?: string[];
  grad_exprs?: string[];
  gradient_tex?: string;
  objective_tex?: string;
  bounds?: Record<string, [number | null, number | null]>;
  domain?: Record<string, number>;
  // algorithm
  nodes?: { id: string; label: string }[];
  edges?: { from: string; to: string }[];
  directed?: boolean;
  start?: string;
  neighbor_order?: string;
  // deep learning
  layers?: { size: number; activation: string }[];
  weights?: number[][][];
  biases?: number[][];
  input?: number[];
  target?: number[];
  weight_source?: string;
  activation?: string;
  seed?: number;
  algorithm?: 'bfs' | 'heap';
  heap_type?: 'max' | 'min';
  initial_heap?: number[];
  // linear algebra
  la_kind?: 'linear_system' | 'determinant' | 'inverse' | 'matmul';
  op?: 'mul' | 'add' | 'sub' | 'scalar' | null;
  matrix_a?: number[][] | null;
  matrix_b?: number[][] | null;
  vector_b?: number[] | null;
  // operating system
  os_kind?: 'cpu_schedule' | 'page_replace' | 'disk_schedule' | 'banker'
    | 'os_basics' | 'process_thread' | 'sync' | 'deadlock' | 'memory_alloc';
  os_result?: Record<string, unknown>;
  // computer organization
  co_kind?: 'performance' | 'data_repr' | 'fixed_point' | 'floating' | 'datapath'
    | 'memory' | 'cache' | 'virtual_memory' | 'instruction' | 'cpu_control' | 'pipeline' | 'bus_io';
  co_result?: Record<string, unknown>;
  processes?: { id: string; arrival: number; burst: number; priority: number | null }[];
  has_priority?: boolean;
  reference?: string[];
  requests?: number[];
  head?: number | null;
  max_track?: number;
  names?: string[];
  resources?: string[];
  allocation?: number[][] | null;
  need?: number[][] | null;
  available?: number[] | null;
  request?: { process: string; vector: number[] } | null;
}

export interface LabSolutionStep {
  id: string;
  title: string;
  latex?: string;
  detail: string;
}

export interface LabVerification {
  level: 'symbolic' | 'numeric' | 'unconfirmed';
  label: string;
  detail: string;
}

export interface LabCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface LabSolution {
  summary: string;
  answer: string;
  answer_value?: number | null;
  answer_point?: number[] | null;
  answer_order?: string[];
  answer_vector?: number[] | null;
  exact?: string;
  approx?: string;
  steps: LabSolutionStep[];
  conditions?: string[];
  limitations?: string[];
  global_note?: string;
  tangent_tex?: string | null;
  quantities?: { id: string; label: string; exact: string; value: number; latex?: string }[];
  stationary_points?: { coordinates: string[]; classification: string; value: string; hessian_determinant: string; latex?: string }[];
  stationary_complete?: boolean;
  solution_status?: 'complete' | 'incomplete' | 'undetermined' | 'divergent' | 'unsupported' | 'undefined';
  solution_complete?: boolean;
  incomplete_reason?: string;
  verification?: LabVerification | null;
  convergence?: 'finite' | 'divergent' | 'undefined' | 'undetermined' | 'numeric_only';
  singularities?: { point: string; kind: 'interior' | 'endpoint' | 'isolated' }[];
  global_minimum?: { exists: boolean | null; value: string | null; points: string[][] | 'all'; reason: string };
  global_maximum?: { exists: boolean | null; value: string | null; points: string[][] | 'all'; reason: string };
  limit_status?: 'finite' | 'infinite' | 'does_not_exist' | 'undetermined';
  left?: { kind: string; value: number | null; text: string } | null;
  right?: { kind: string; value: number | null; text: string } | null;
  two_sided?: { kind: string; value: number | null; text: string };
  taylor_point_value?: number;
  order?: number;
  coefficients?: { order: number; value: string }[];
  polynomial?: string;
  remainder_order?: number;
  derivative_order?: number;
  derivative_expression?: string;
  derivative_point?: string | null;
  derivative_value?: number | null;
  study?: CalculusResult['study'];
  multi_details?: MultivariableDetails;
  extrema_details?: ExtremaDetails;
  ode_order?: number;
  ode_hints?: string[];
  ode_equation?: string;
  initial_conditions?: string[];
  general_solution?: string | null;
  particular_solution?: string | null;
  plot_expression?: string | null;
  plot_window?: {x_min:number;x_max:number} | null;
  residual_verified?: boolean;
  initial_conditions_verified?: boolean;
  target?: { status: string; kind?: string; value?: string; text?: string; lower?: string; upper?: string; reason?: string } | null;
  candidates?: { point: string[]; point_values?: (number | null)[]; value: string; lambda: string; classification: string; evidence: string }[];
  constraint_tex?: string;
  power_goal?: string;
  center?: string;
  radius_method?: string;
  radius?: string | null;
  interval?: string | null;
  endpoint_status?: { label: string; point: string; status: string; included: boolean }[];
  sum_function?: string | null;
  fourier?: CalculusResult['fourier'];
  series_status?: string;
  series_method?: string;
  series_sum?: string | null;
  proof_kind?: string;
  proof_status?: string;
  verification_level?: string;
  obligations?: { id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[];
  certificate?: Record<string, unknown>;
  space?: CalculusResult['space'];
  space_integral_details?: SpaceIntegralDetails;
  answer_choice?: string | null;
}

export interface LabTraceFrame {
  index: number;
  label: string;
  detail?: string;
  values?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LabScenario {
  id: string;
  name: string;
  params: Record<string, unknown>;
  created_at: string | null;
  kind: string;
  summary: string;
}

export interface LabAttemptRecord {
  id: string;
  answer: string;
  correct: boolean;
  feedback: string;
  field: string;
  created_at: string | null;
}

export interface LabObservation {
  id: string;
  text: string;
  created_at: string | null;
}

export interface LabEvent {
  id: string;
  kind: string;
  text: string;
  created_at: string | null;
}

export interface LabEvaluated {
  status: 'ok' | 'blocked' | 'unavailable';
  reason?: string;
  computed_at?: string;
  headline?: string;
  metrics?: { id: string; label: string; value: string }[];
  checks?: LabCheck[];
  stop_reason?: string;
  trace?: LabTraceFrame[];
  trace_count?: number;
  answer?: string;
}

export interface LabState {
  params: Record<string, unknown>;
  step: number;
  mode: LabMode;
  notes: string;
  observations: LabObservation[];
  events: LabEvent[];
  scenarios: LabScenario[];
  active_scenario_id: string;
  attempts: LabAttemptRecord[];
  evaluated: LabEvaluated | null;
}

export interface MultivariableDetails {
  operation: string; variables: string[]; point: string[] | null;
  partials: {variable:string;expression:string;latex:string;value:string | null}[];
  smooth_conditions: string[]; differentiability: string; method:string; result_latex:string; note:string;
  direction: {raw:string[];unit:string[];norm:string;convention:string} | null;
}

export interface ExtremaDetails {
  operation: 'unconstrained' | 'constrained';
  variables: string[];
  constraint: string | null;
  stationary_complete: boolean;
  classification_complete: boolean;
  singular_complete: boolean | null;
  scope_note: string;
  result_latex: string;
  candidates: {point:string[];value:string;kind:'stationary'|'regular'|'singular';multiplier:string|null;
    classification:'minimum'|'maximum'|'saddle'|'undetermined';evidence:string;residual_verified:boolean;constraint_verified:boolean|null}[];
}

export interface TripleDetails {
  region_mode: 'box' | 'z_simple' | 'cylindrical' | 'spherical';
  outer_variable: 'x' | 'theta';
  middle_variable: 'y' | 'r' | 'phi';
  inner_variable: 'z' | 'rho';
  outer_bounds: string[];
  middle_bounds: string[];
  inner_bounds: string[];
  region_description: string;
  region_verified: boolean;
  continuous_verified: boolean;
  jacobian: string;
  jacobian_latex: string;
  numeric_value?: number;
  note: string;
}

export interface SeriesDetails {
  term: string;
  index_start: number;
  status: string;
  status_label: string;
  method: string | null;
  sum_value: string | null;
  note: string;
}

export interface PowerSeriesDetails {
  goal: 'radius' | 'sum' | 'expand';
  center: string;
  index_start: number;
  coefficient: string;
  radius: string | null;
  radius_method: string | null;
  interval: string | null;
  endpoints: { label: string; point: string; status: string; method?: string | null; included: boolean }[];
  sum_function: string | null;
  note: string;
}

export interface FourierDetails {
  a0: string;
  coefficients: { n: number; an: string; bn: string }[];
  partial: string;
  order: number;
  lower: string;
  upper: string;
  period: string;
  discontinuities: string[];
  endpoint_jump: boolean;
  convergence_note: string;
  note: string;
}

export interface DoubleIntegralExtension {
  kind: 'affine' | 'applications' | 'polar_improper' | 'strip_improper';
  title: string;
  facts: {label:string;latex:string}[];
  values: {id:string;label:string;latex:string;value:number|null}[];
  notes: string[];
  region_points?: {x:number;y:number}[];
}

export interface SpaceGeometryDetails {
  kind: string;
  label: string;
  relation?: string | null;
  angle?: string | null;
  distance?: string | null;
  intersection?: string | null;
  equations?: { label: string; latex: string }[];
  standard_form?: string | null;
  classification?: string | null;
  center?: string | null;
  facts: { label: string; latex?: string; text?: string }[];
  notes?: string[];
}

export interface SpaceIntegralDetails {
  kind: string;
  label: string;
  facts: { label: string; latex?: string; text?: string }[];
  equations?: { label: string; latex: string }[];
  orientation?: string | null;
  notes?: string[];
}

export interface ProofDetails {
  label: string;
  proof_kind: string;
  proof_status: string;
  verification_level: string;
  obligations: { id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[];
  certificate: Record<string, unknown>;
  certificate_facts?: { label: string; text: string }[];
  statement: string;
  reason?: string | null;
}

export interface LabProblem {
  manual_input?: {
    task: 'integral' | 'antiderivative' | 'derivative' | 'limit' | 'higher_derivative' | 'continuity' | 'implicit_normal' | 'function_study' | 'taylor' | 'geometric_area' | 'rotation_volume' | 'ode' | 'multivariable' | 'multivariable_extrema' | 'double_integral' | 'triple_integral' | 'series_convergence' | 'power_series' | 'fourier_series' | 'space_geometry' | 'curve_surface_integral' | 'proof';
    conditions: Record<string, string>;
    confirmed: boolean;
    latex: string;
    result_latex: string;
    result_status?: 'complete' | 'divergent' | 'unsupported';
    multi_details?: MultivariableDetails | null;
    extrema_details?: ExtremaDetails | null;
    double_extension?: DoubleIntegralExtension | null;
    double_details?: {region_kind?:'strip'|'pieces'|'polar'|'improper';region_description?:string;outer_variable:'x'|'y'|'theta';inner_variable:'x'|'y'|'r';outer_bounds:string[];inner_bounds:string[];region_verified:boolean;continuous_verified:boolean;inner_integral_latex:string;zero_area:boolean;note:string} | null;
    triple_details?: TripleDetails | null;
    series_details?: SeriesDetails | null;
    space_details?: SpaceGeometryDetails | null;
    space_integral_details?: SpaceIntegralDetails | null;
    proof_details?: ProofDetails | null;
    power_details?: PowerSeriesDetails | null;
    fourier_details?: FourierDetails | null;
    ode_details?: { ode_order?:number; ode_hints?:string[]; solution_latex?:string; initial_conditions?:string[]; residual_verified?:boolean; initial_conditions_verified?:boolean; free_constants?:boolean; solution_domain?:string | null; scope_note?:string } | null;
    geometry_details?: { region_kind: string; rotation_axis: string | null; quantities: { id:string; label:string; exact:string; latex:string }[]; zero_points:string[]; effective_intervals:string[][] | null } | null;
    taylor_details?: { point: string; order: number; coefficients: { order: number; value: string; latex: string }[]; polynomial_latex: string; remainder_kind: string; remainder_latex: string; relation_latex: string; window_lower: string; window_upper: string; error_bound: string | null; range_note: string } | null;
    study?: CalculusResult['study'];
    line_geometry?: { tangent: string; normal: string; tangent_direction: string; normal_direction: string; point_x: string; point_y: string } | null;
    continuity?: { classification: string; label: string; value: { text: string }; left: { text: string }; right: { text: string } } | null;
    result_answer?: string;
    result_approx?: string;
    result_note?: string;
    verification?: LabVerification | null;
  };
  ai_solution?: LabAISolution;
  problem_id: string;
  number: string | null;
  title: string;
  text: string;
  subject: LabSubject;
  subject_label: string;
  confidence: number;
  status: LabStatus;
  source: {
    page_from: number;
    page_to: number;
    file_names: string[];
    label: string;
    excerpt: string;
  };
  source_pages: { file_id: string; page: number; image_key: string | null; method: string }[];
  recognition: LabRecognition;
  model: LabModel;
  solution: LabSolution;
  states: LabState;
}

export interface LabAISolution {
  failure_stage?: 'task_support' | 'source_coverage' | 'model_mapping' | string;
  source_review_required?: boolean;
  agent_understanding?: {
    question: string; subquestions: string[]; relations: string[]; target: string;
    conditions: { id: string; value: string; unit: string; excerpt: string; page_key: string | null; bbox: number[] | null }[];
    uncertainties: string[]; unsupported_reason: string;
  };
  model_task_label?: string;
  model_condition_labels?: Record<string,string>;
  verification: 'kernel' | 'ai_reference' | 'needs_review';
  checkable: boolean;
  interpretation: string;
  conditions: string[];
  missing_conditions: string[];
  proposed_model: Record<string, unknown>;
  computation: { exact: string; answer: string; checks: LabCheck[]; steps: LabSolutionStep[] } | null;
  options: { label: string; text: string }[];
  answer: string;
  answer_choices: string[];
  steps: LabSolutionStep[];
  reference_answer: string;
  reference_steps: LabSolutionStep[];
  limitations: string[];
  model_name: string;
  created_at: string;
}

export interface LabOrchestrationProvenance {
  step: string;
  item: string;
  detail: string;
  source: string;
}

export interface LabOrchestrationAdjustment {
  step: string;
  from?: string;
  to?: string;
  attempt?: number;
  reason?: string;
  rejected?: string[];
  result?: string;
  error?: string;
  from_inputs?: Record<string, unknown>;
  to_inputs?: Record<string, unknown>;
}

export interface LabOrchestrationPlanStep {
  id: string;
  goal?: string;
  capability?: string;
  subquestion?: string | null;
}

export interface LabOrchestration {
  problem: { text: string; version: string };
  status: string;
  stale?: boolean;
  note?: string;
  planner?: { mode?: string; error?: string | null; understanding_source?: string };
  plan_check?: {
    ok?: boolean;
    errors?: string[];
    warnings?: string[];
    provenance?: LabOrchestrationProvenance[];
  };
  understanding?: {
    source?: string;
    ai_error?: string;
    ai_warnings?: string[];
    ambiguities?: string[];
    asked?: { id: string; goal: string }[];
  };
  plan?: { steps?: LabOrchestrationPlanStep[] };
  answers: { subquestion: string; goal?: string; answer?: string; state?: string; value?: number | null }[];
  solve: {
    steps: { id: string; goal: string; state: string; detail?: string; capability?: string }[];
    provenance?: LabOrchestrationProvenance[];
    adjustments?: LabOrchestrationAdjustment[];
  };
  previous_summary?: { version: string; answers: { goal?: string; answer?: string }[] };
}

export interface LabDocument {
  orchestration?: LabOrchestration;
  schema_version: string;
  lab_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  revision: number;
  source: {
    files: LabSourceFile[];
    pages: LabSourcePage[];
    method: string;
    citation: string;
  };
  problems: LabProblem[];
  selected_problem_id: string;
  status: LabStatus;
  subject: LabSubject;
  problem_count: number;
  capabilities?: {
    ai_solver_configured?: boolean;
    ai_configured?: boolean;
    ai_note?: string;
  };
  share_id?: string;
  published_at?: string;
}

export interface LabSummary {
  ai_verification?: 'kernel' | 'ai_reference' | 'needs_review' | null;
  lab_id: string;
  title: string;
  subject: LabSubject;
  subject_label: string;
  status: LabStatus;
  problem_count: number;
  created_at: string;
  updated_at: string;
}

export interface LabCapabilities {
  modeling_tasks?: Record<string,{label:string;subject:LabSubject;required:string[];optional:string[];notes:string}>;
  formats: string[];
  roles: { id: string; label: string }[];
  subjects: { id: LabSubject; label: string }[];
  max_files: number;
  max_pages: number;
  max_text_chars: number;
  max_upload_bytes: number;
  ai_configured: boolean;
  ai_enabled: boolean;
  ai_default: boolean;
  note: string;
}

export interface LabAssistantResponse {
  answer: string;
  local: boolean;
  notice?: string;
  provider?: string;
  model?: string;
  selected?: { id?: string; label?: string } | null;
  context: Record<string, unknown> & {
    blocked?: boolean;
    step?: number;
    frame?: { label?: string; detail?: string; values?: Record<string, unknown> } | null;
    metrics?: { label: string; value: string }[];
    checks?: LabCheck[];
  };
}

export interface LabAttemptResponse {
  attempt: LabAttemptRecord;
  checked: {
    correct: boolean;
    expected: string;
    actual: string;
    field: string;
    kind: string;
    feedback: string;
  };
  document: LabDocument;
}

export interface LabSaveResponse {
  revision: number;
  document: LabDocument;
  state: LabState;
}

export interface LabShareResult {
  share_id: string;
  share_url: string;
  published_at: string;
}

/* ------------------------------------------------------------------ */
/* 本地计算结果的公共类型                                              */
/* ------------------------------------------------------------------ */

export interface LabResultMetric {
  id: string;
  label: string;
  value: string;
  tone?: 'default' | 'accent' | 'good' | 'bad';
}

export interface LabResultFrame extends LabTraceFrame {
  label: string;
  detail: string;
  values: Record<string, unknown>;
}

export interface LabResultBase {
  subject: LabSubject;
  headline: string;
  metrics: LabResultMetric[];
  checks: LabCheck[];
  notes: string[];
  trace: LabResultFrame[];
}

export interface CalculusPoint {
  x: number;
  y: number | null;
}

export interface CalculusRect {
  x0: number;
  x1: number;
  mid: number;
  height: number;
}

export interface CalculusResult extends LabResultBase {
  subject: 'calculus';
  task?: LabModel['task'];
  kind: 'integral' | 'derivative' | 'antiderivative' | 'limit' | 'taylor' | 'higher_derivative' | 'function_study' | 'ode' | 'constrained_extrema' | 'series_convergence' | 'power_series' | 'fourier_series' | 'space' | 'proof' | 'multivariable' | 'multivariable_extrema';
  domain: { x_min: number; x_max: number };
  series: CalculusPoint[];
  rects: CalculusRect[];
  exact: number | null;
  approx: number | null;
  error: number | null;
  point?: {
    x: number;
    y: number | null;
    slope: number;
    tangent: { m: number; b: number };
  };
  answerText: string;
  limit?: {
    point: number | null;
    side: 'both' | 'left' | 'right';
    left: { kind: string; value: number | null; text: string } | null;
    right: { kind: string; value: number | null; text: string } | null;
    value: { kind: string; value: number | null; text: string };
    status: string;
  };
  taylor?: {
    point: number;
    order: number;
    coefficients: (number | null)[];
    polynomial: string;
    overlay: CalculusPoint[];
    max_error: number | null;
  };
  higher?: {
    order: number;
    point: number | null;
    value: number | null;
    expression: string;
  };
  ode?: { order?: number; hints: string[]; solution: string; initial_conditions: string[]; target?: LabSolution['target'] };
  space?: {
    kind?: string; curves?: { id: string; label: string; points: { x: number; y: number; z: number }[] }[];
    points?: { id?: string; x: number; y: number; z: number }[]; grid?: { x: number; y: number; z: number }[][];
    edges?: { x: number; y: number; z: number }[][]; line?: { x: number; y: number; z: number }[];
    x?: number[]; y?: number[]; z?: number[]; theta?: number[]; phi?: number[]; rho?: number[];
  };
  proof?: {
    proof_kind?: string; status?: string; verification_level?: string;
    obligations: { id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string }[];
    certificate?: Record<string, unknown>; statement?: string;
  };
  power?: {
    goal?: string; center?: string | number | null; radius?: string | null; interval?: string | null;
    endpoints?: { label: string; point: string; status: string; included: boolean }[];
    sum_function?: string | null; polynomial?: string | null;
    coefficients?: { order: number; value: string }[];
  };
  fourier?: {
    a0: string; coefficients: { n: number; an: string; bn: string }[]; partial: string;
    order: number; lower: string; upper: string; period: string;
    discontinuities: string[]; endpoint_jump: boolean; convergence_note: string;
  };
  seriesPartial?: CalculusPoint[];
  overlays?: { id: string; label: string; series: CalculusPoint[] }[];
  series_status?: string;
  series_method?: string;
  study?: {
    absolute?: { minimum: { value: string; attained: boolean; points: string[] }; maximum: { value: string; attained: boolean; points: string[] } };
    critical_points?: { point: string; value: string }[];
    endpoints?: { point: string; included: boolean; value: string }[];
    monotonic: { kind: 'increasing' | 'decreasing' | 'constant'; label: string; interval: string; from: number | null; to: number | null }[];
    concavity: { kind: 'concave_up' | 'concave_down' | 'linear'; label: string; interval: string }[];
    extrema: { point: string; value: string; classification: string; label: string }[];
    inflections: { point: string; value: string }[];
    asymptotes: {
      vertical: string[];
      horizontal: string[];
      oblique: string[];
      vertical_values?: number[];
      horizontal_values?: number[];
    };
    domain: { from: string; to: string; left_open: boolean; right_open: boolean }[];
  };
}

export interface DoubleIntegralPiece {
  index: number;
  outer_bounds: [string, string];
  inner_bounds: [string, string];
  inner_bounds_tex?: [string, string];
  inner_integral?: string;
  exact: string;
  answer_value: number;
  numeric_value?: number;
  formula_tex?: string;
  region?: { outer: number; lower: number; upper: number }[];
  approx?: number;
}

export interface DoubleIntegralPolar {
  theta_bounds: [string, string];
  r_bounds: [string, string];
  r_bounds_tex?: [string, string];
  jacobian: string;
  transformed_integrand: string;
  inner_integral: string;
  exact: string;
  answer_value: number;
  numeric_value?: number;
  outer_points?: { x: number; y: number }[];
  inner_points?: { x: number; y: number }[];
  slice?: { theta: number; r_lower: number; r_upper: number };
}

export interface DoubleIntegralSwapped {
  region_verified?: boolean;
  numeric_verified?: boolean;
  outer_variable: 'x' | 'y';
  inner_variable: 'x' | 'y';
  outer_bounds: [string, string];
  inner_bounds: [string, string];
  inner_bounds_tex?: [string, string];
  formula_tex: string;
  exact: string;
  answer_value: number;
}

export interface DoubleIntegralResult extends CalculusResult {
  task: 'double_integral';
  region_kind?: 'strip' | 'pieces' | 'polar';
  outer_variable: 'x' | 'y' | 'theta';
  inner_variable: 'x' | 'y' | 'r';
  region: { outer: number; lower: number; upper: number }[];
  slice: { position: number; lower: number; upper: number };
  sliceValues: { position: number; value: number }[];
  pieces?: DoubleIntegralPiece[];
  polar?: DoubleIntegralPolar;
  swapped?: DoubleIntegralSwapped | DoubleIntegralSwapped[] | null;
}

export interface OptimizationPointFrame {
  index: number;
  point: number[];
  f: number;
  gradient: number[];
  gradNorm: number;
}

export interface OptimizationResult extends LabResultBase {
  subject: 'optimization';
  kind?: 'constrained_extrema';
  variables: string[];
  constraint?: string;
  constraint_tex?: string;
  candidates?: { point: string[]; point_values?: (number | null)[]; value: string; lambda: string; classification: string; evidence: string }[];
  series: CalculusPoint[];
  grid: { x: number[]; y: number[]; z: (number | null)[][] } | null;
  domain: Record<string, number>;
  trajectory: OptimizationPointFrame[];
  current: OptimizationPointFrame | null;
  /** 注册表声明的派生输出键；与后端 solvers 顶层键同口径。 */
  loss: number | null;
  grad_norm: number | null;
  stopReason: string;
  converged: boolean;
  diverged: boolean;
  exactPoint: number[] | null;
  exactValue: number | null;
  globalNote: string;
  bounds: Record<string, [number | null, number | null]>;
}

export interface BfsResultFrame extends LabResultFrame {
  action: string;
  current: string | null;
  queue: string[];
  /** DFS 轨迹使用栈；BFS 使用队列。渲染层按 result.algorithm 选择字段。 */
  stack?: string[];
  visited: string[];
  order: string[];
  parent: Record<string, string | null>;
  level: Record<string, number>;
  pseudocodeLine: number;
  neighbor?: string;
}

export interface BfsResult extends LabResultBase {
  subject: 'algorithm';
  algorithm?: 'bfs' | 'dfs';
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string }[];
  directed: boolean;
  adjacency: Record<string, string[]>;
  order: string[];
  visited: string[];
  unvisited: string[];
  parent: Record<string, string | null>;
  level: Record<string, number>;
  treeEdges: { from: string; to: string }[];
  rejectedEdges: { from: string; to: string; reason: string }[];
  pseudocode: string[];
  start: string;
  frames: BfsResultFrame[];
  trace: BfsResultFrame[];
}

export interface DsTreeVisual {
  type: 'tree';
  nodes: { id: string; label: string; x: number; y: number }[];
  edges: { from: string; to: string }[];
  highlight?: string | null;
}

export interface DsResultFrame extends LabResultFrame {
  pseudocodeLine?: number;
  /** 后端按帧生成的结构化画面：树形、散列表或其它可绘制状态。 */
  visual?: DsTreeVisual;
}

/** 数据结构题型（ds_* 引擎）：执行记录由后端确定性内核生成，前端直接回放。 */
export interface DsResult extends LabResultBase {
  subject: 'algorithm';
  algorithm?: 'data_structure';
  dsKind: string;
  answer: string;
  answer_value?: number;
  answer_order?: string[];
  pseudocode: string[];
  frames: DsResultFrame[];
}

export interface DlFrame extends LabResultFrame {
  loss: number;
  lossBefore: number;
  output: number[];
  weightNorm: number;
  gradNorm: number;
  weights: number[][][];
  biases: number[][];
  activations: { activation: string; z: number[]; a: number[] }[];
}

export interface DlResult extends LabResultBase {
  subject: 'deep_learning';
  layers: { size: number; activation: string }[];
  activation: string;
  weights: number[][][];
  target: number[];
  lossHistory: number[];
  initialLoss: number;
  frames: DlFrame[];
  trace: DlFrame[];
  gradientCheck: number | null;
  finalWeights: number[][][];
  finalBiases: number[][];
  gradients: { weights: number[][][]; biases: number[][] };
}

export interface UnknownResult extends LabResultBase {
  subject: 'unknown';
}

export type LabResult =
  CalculusResult | OptimizationResult | BfsResult | DsResult | HeapResult | DlResult | LinAlgResult | OsResult | CoResult | UnknownResult;

/* ------------------------------------------------------------------ */
/* 边界守卫                                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLabDocument(value: unknown): LabDocument {
  if (!isRecord(value) || typeof value.lab_id !== 'string' || !Array.isArray(value.problems)) {
    throw new Error('实验室数据格式不正确');
  }
  const problems = value.problems.filter(
    (item): item is LabProblem =>
      isRecord(item) &&
      typeof item.problem_id === 'string' &&
      typeof item.text === 'string' &&
      isRecord(item.model) &&
      isRecord(item.solution) &&
      isRecord(item.recognition),
  );
  if (!problems.length) throw new Error('实验室没有可用题目');
  return {
    ...(value as unknown as LabDocument),
    problems,
  };
}

export function isBlocking(ambiguities: LabAmbiguity[]): boolean {
  return ambiguities.some((item) => item.severity === 'blocking' && !item.resolved);
}

export function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function readArrayNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
    .filter((item): item is number => item !== null);
}
