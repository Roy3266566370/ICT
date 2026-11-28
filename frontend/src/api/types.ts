/**
 * types.ts —— C-KO@1 / C-RUN@1 / C-API@1 / C-ERR@1 的 TypeScript 权威形状，
 * 以及 C-MX@1 / C-FC@1 / C-BFS@1 / C-BUD@1 / C-UI@1 的模板与组件契约。
 *
 * 规则（来自 plan §2.2.1 与 §2.2.11）：
 *  1. 字段名与 plan 的 TS 声明**逐字一致**（camelCase 与 snake_case 混用时保持原样，
 *     前后端不做自动命名转换）。不要"顺手改成驼峰"。
 *  2. 禁止 `any`。外部数据一律先按 `unknown` 接收，再用本文件的类型守卫收窄。
 *  3. 本文件是纯类型 + 常量 + 守卫，不依赖 React / DOM，可在任意层复用。
 */

/* ==========================================================================
 * C-KO@1 统一对象模型（§2.2.1）
 * ========================================================================== */

export type TemplateId = 'matrix_2d' | 'force_2d' | 'bfs_flow' | 'budget_compare';

/** 模板白名单（C-REG@1）：只有这 4 个 id 允许装载模板组件。 */
export const TEMPLATE_IDS: readonly TemplateId[] = [
  'matrix_2d',
  'force_2d',
  'bfs_flow',
  'budget_compare',
] as const;

export type Provenance = 'original' | 'inferred' | 'user_confirmed' | 'manual_demo';

/** 来源状态展示优先级（§2.2.1）：user_confirmed > original > inferred > manual_demo */
export const PROVENANCE_PRIORITY: readonly Provenance[] = [
  'user_confirmed',
  'original',
  'inferred',
  'manual_demo',
] as const;

export type ParameterType =
  | 'matrix2'
  | 'vector2'
  | 'force_list'
  | 'graph'
  | 'integer'
  | 'decimal'
  | 'enum'
  | 'text';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceRef {
  /** 对象内唯一，前缀 src_ */
  id: string;
  provenance: Provenance;
  /** 界面可显示的中文短标签 */
  label: string;
  /** 手工示例为 null */
  material_id: string | null;
  /** 1-based；无页码为 null */
  page: number | null;
  /** 无元素级来源为 null */
  element_id: string | null;
  /** EMU 绝对坐标；页级来源必须为 null（禁止伪造元素框） */
  bbox: BBox | null;
  /** ≤ 160 字原文摘录 */
  excerpt: string | null;
}

export interface ParameterRange {
  min: number | null;
  max: number | null;
  step: number | null;
  /** 金额类参数的十进制边界用字符串，避免浮点误差 */
  min_decimal?: string;
  max_decimal?: string;
}

export interface Parameter {
  /** 对象内唯一，如 matrix_A / vector_x */
  id: string;
  /** 界面显示名，中文 */
  name: string;
  type: ParameterType;
  /** 形状由 type 决定，见各模板契约 */
  value: unknown;
  /** 无量纲固定为 "1" */
  unit: string;
  range: ParameterRange;
  /** 至少 1 个 */
  source_ref_ids: string[];
  /** 参数级来源状态 */
  provenance: Provenance;
  editable: boolean;
}

/** 契约名（§2.2.1：ViewBinding）；同时以 `Binding` 对外导出以兼容任务书命名。 */
export interface ViewBinding {
  parameter_id: string;
  /** 与 views 中的字符串一致 */
  view_id: string;
  /** 视图内的消费点，见各模板契约 */
  target: string;
}

export type Binding = ViewBinding;

/**
 * 工作台顶层视图。对应路由 `/materials/:id/work?view=source|interactive|runs`
 * （§3.1 T4）；`KnowledgeObject.views` 仍是 `string[]`，不因此收窄契约。
 */
export type ViewId = 'source' | 'interactive' | 'runs';

export interface KnowledgeObject {
  schema_version: '0.2';
  object_id: string;
  title: string;
  material_id: string | null;
  /** ≥ 1 */
  model_version: number;
  /** ≥ 0，数值调整递增 */
  revision: number;
  template_id: TemplateId;
  /** linear_v1 | force_v1 | bfs_v1 | budget_v1 */
  kernel_version: string;
  /** 各模板专属，见 C-MX / C-FC / C-BFS / C-BUD */
  config: Record<string, unknown>;
  parameters: Parameter[];
  views: string[];
  bindings: ViewBinding[];
  source_refs: SourceRef[];
  validation_profile: string;
  /** ISO 8601 UTC */
  created_at: string;
  updated_at: string;
}

/* ==========================================================================
 * C-RUN@1 运行快照与检查（§2.2.2）
 * ========================================================================== */

export type CheckStatus = 'pass' | 'fail' | 'not_covered' | 'stale';

export interface CheckItem {
  /** 稳定标识，如 mx_ax_value */
  check_id: string;
  /** 中文标题 */
  title: string;
  status: CheckStatus;
  /** 人类可读期望，如 "Ax = (2, 1)" */
  expected: string;
  /** 人类可读实际 */
  actual: string;
  /** 失败原因 */
  detail: string | null;
}

export interface ValidationReport {
  report_id: string;
  object_id: string;
  model_version: number;
  revision: number;
  kernel_version: string;
  validation_profile: string;
  items: CheckItem[];
  summary: { pass: number; fail: number; not_covered: number };
  /** model_version 或 revision 落后于对象当前值时置 true */
  is_stale: boolean;
  created_at: string;
}

export interface RunSnapshot {
  run_id: string;
  object_id: string;
  model_version: number;
  revision: number;
  kernel_version: string;
  /** 冻结的完整对象副本 */
  input_snapshot: KnowledgeObject;
  /** 该模板 Result，见各模板契约 */
  result: unknown;
  /** 未校验时为 null */
  validation_report: ValidationReport | null;
  created_at: string;
}

/* ==========================================================================
 * C-API@1 通用封装与端点结构（§2.2.7）
 * ========================================================================== */

export interface ApiSuccess<T> {
  data: T;
  request_id: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ApiError {
  error: ApiErrorBody;
  request_id: string;
}

export interface SessionInfo {
  session_id: string;
  expires_at: string;
  csrf_token: string;
  retention_hours: number;
}

export interface TemplateDescriptor {
  template_id: TemplateId;
  name: string;
  /** matrix | force | bfs | budget */
  scenario_slug: string;
  kernel_version: string;
  validation_profile: string;
  /** 供示例卡使用 */
  example_id: string;
  /** 面向用户的限制说明 */
  limits: Record<string, string>;
  /** 仅供调试展示 */
  schema_path: string;
}

export type MaterialStatus = 'processing' | 'awaiting_confirmation' | 'ready' | 'failed';

export interface MaterialSummary {
  material_id: string;
  title: string;
  status: MaterialStatus;
  page_count: number;
  created_at: string;
  expires_at: string;
  object_count: number;
  /**
   * **可选（向后兼容追加）**：材料首个知识对象的模板。
   * §2.2.7 原始契约未定义该字段，后端可能不返回；前端必须按"可能缺失"处理，
   * 缺失时展示"未标注"，不得据此推断模板。
   */
  template_id?: TemplateId;
  /**
   * **可选（向后兼容追加）**：该材料下所有对象的已保存运行总数。
   * 后端可能不返回；缺失时展示"未标注"而不是显示 0（0 表示"确实没有运行"）。
   */
  run_count?: number;
}

export interface SlideElement {
  element_id: string;
  kind: 'text' | 'picture' | 'shape' | 'chart' | 'table' | 'group';
  name: string;
  bbox: BBox;
  text: string | null;
  asset_id: string | null;
}

export interface SlidePage {
  page_no: number;
  title: string;
  paragraphs: string[];
  elements: SlideElement[];
  excerpt: string;
  /** 相对路径，前端拼 /api/v1/materials/{id}/assets/{asset_id} */
  image_url: string | null;
  /** 整页图字节数；前端用作 ?v= 的不可变缓存版本。 */
  render_bytes?: number | null;
  width?: number;
  height?: number;
}

export interface CandidateObject {
  candidate_id: string;
  template_id: TemplateId;
  confidence_hint: 'low' | 'medium';
  fields: { parameter_id: string; name: string; status: 'present' | 'missing' | 'inferred' }[];
}

export type JobStage =
  | 'queued'
  | 'parsing'
  | 'rendering'
  | 'extracting'
  | 'awaiting_confirmation'
  | 'compiling'
  | 'validating'
  | 'ready'
  | 'failed';

export interface JobStatus {
  job_id: string;
  material_id: string;
  kind: 'upload' | 'compile' | 'validate';
  stage: JobStage;
  attempt: number;
  progress_pct: number | null;
  error: { code: ErrorCode; message: string } | null;
  updated_at: string;
}

export interface MaterialDetail {
  forked_ppt_ai?: unknown;
  formula_reviews?: Record<string, {page_no: number; math_text: string; reason: string}>;
  scene_document?: import('../document/types').SceneDocument|null;
  edit_revision?: number;
  ispecs?: unknown[];
  render?: { fidelity?: string; render_engine?: string; errors?: string[] };
  material: MaterialSummary;
  slides: SlidePage[];
  objects: KnowledgeObject[];
  candidates: CandidateObject[];
  job: JobStatus | null;
}

export interface MaterialsListResponse {
  items: MaterialSummary[];
  retention_expires_at: string;
}

/* --------------------------------------------------------------------------
 * C-API@1 P2 追加：区域确认/纠正的持久化（snake_case，与后端逐字一致）
 *
 * 为什么是追加：同一 region 的识别事实（页码、bbox、script_id、基线参数）来自
 * `regions.json`，用户在准备页的确认/纠正必须跨页面、跨重启保留，但契约里的
 * 9 张共享表没有承载它的位置。这里新增两个端点（见 contracts/README.md §3.8.2），
 * 不改任何既有端点与 schema。
 * ------------------------------------------------------------------------ */

/** 区域状态（与 `regions/types.ts` 的 `RegionStatus` 取值一致，避免跨层依赖）。 */
export type MaterialRegionStatus = 'pending' | 'confirmed' | 'static_only' | 'unsupported';

/** PATCH 允许写入的"人工结论"：pending 表示尚未确认，不落盘。 */
export type RegionConfirmStatus = Extract<MaterialRegionStatus, 'confirmed' | 'static_only'>;

/** 覆盖记录：只保存用户改过的键，不复制整份 `original_params`。 */
export interface RegionOverride {
  /** 未确认过状态时为 null（只覆盖了参数）。 */
  status: RegionConfirmStatus | null;
  parameter_overrides: Record<string, unknown>;
  note: string | null;
  updated_at: string | null;
  /** 写入时的识别事实指纹；与当前基线不一致即视为失效。 */
  fact_signature: string;
}

/** 后端返回的单个区域（基线 + 有效覆盖后的值）。 */
export interface MaterialRegion {
  region_id: string;
  material_id: string;
  page: number;
  script_id: string;
  status: MaterialRegionStatus;
  /** 已合并用户覆盖的参数（缺覆盖时等于基线 `original_params`）。 */
  original_params: Record<string, unknown>;
  /** 只含用户改过的键，用于合并到前端基线。 */
  parameter_overrides: Record<string, unknown>;
  has_override: boolean;
  note: string | null;
  updated_at: string | null;
  fact_signature: string | null;
}

export interface MaterialRegionsResponse {
  material_id: string;
  /** renders | fixtures | fixtures:matrix-courseware | none */
  baseline_source: string;
  page_count: number;
  regions: MaterialRegion[];
  /** 因重新解析导致指纹不符、已被忽略的覆盖。 */
  invalidated_region_ids: string[];
}

/** PATCH 请求体；未提供的字段表示"保持不变"，`parameter_overrides: {}` 表示清空。 */
export interface RegionOverridePatch {
  status?: RegionConfirmStatus;
  parameter_overrides?: Record<string, unknown>;
  note?: string;
}

/** PATCH 成功响应。 */
export interface RegionOverrideResult {
  region_id: string;
  status: MaterialRegionStatus;
  parameter_overrides: Record<string, unknown>;
  note: string | null;
  updated_at: string | null;
  fact_signature: string | null;
}

/* --------------------------------------------------------------------------
 * C-API@1 P2 追加：iSpec 参数值的跨会话持久化（整改文件 §10.1 第 5 步）
 *
 * 与区域覆盖同构：`data/ispec-values/<material_id>.json` 按 object 分桶，
 * 每桶带一个桶级 `updated_at` 作为乐观锁版本号。共享池（`shared_key` 的池值）
 * 存在保留桶 `__shared__` 下（与后端 `SHARED_OBJECT_ID` 一致）。
 * ------------------------------------------------------------------------ */

/** iSpec 参数值只允许标量（与后端持久化约束一致，禁止嵌套对象）。 */
export type ISpecScalar = number | boolean | string;

/** 共享池桶的保留 object_id；不对应任何真实 iSpec。 */
export const SHARED_VALUES_OBJECT_ID = '__shared__';

/** 一个 object（iSpec 或共享池）已保存的参数值。 */
export interface ISpecValuesRecord {
  object_id: string;
  /** 参数 id → 标量值；从未保存过时为空对象。 */
  values: Record<string, ISpecScalar>;
  /** 桶级版本号；清除后为 null。 */
  updated_at: string | null;
}

/** PUT 成功响应与 GET 同形状，单独命名便于调用方表达意图。 */
export type ISpecValuesResult = ISpecValuesRecord;

export interface CloneExampleResponse {
  material_id: string;
  object_id: string;
}

export interface UploadMaterialResponse {
  material_id: string;
  job_id: string;
}

export interface RetryJobResponse {
  job_id: string;
  attempt: number;
}

export interface ObjectBundleResponse {
  object: KnowledgeObject;
  checks_summary: ValidationReport | null;
}

export interface UpdateModelRequest {
  expected_version: number;
  object: KnowledgeObject;
}

export interface UpdateModelResponse {
  object: KnowledgeObject;
}

export interface CompileResponse {
  job_id: string;
}

export interface CreateRunRequest {
  model_version: number;
  revision: number;
  input_snapshot: KnowledgeObject;
  /** 客户端本地结果仅用于对比；服务端必须重算覆盖 */
  result?: unknown;
}

export interface RunsListResponse {
  items: RunSnapshot[];
}

export interface ChecksListResponse {
  items: ValidationReport[];
}

export interface ValidateRequest {
  model_version: number;
  revision: number;
}

/* ==========================================================================
 * C-ERR@1 错误码（§2.2.8）
 * ========================================================================== */

export type ErrorCode =
  | 'INVALID_FILE'
  | 'LIMIT_EXCEEDED'
  | 'PARSE_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'UNSUPPORTED_TEMPLATE'
  | 'MISSING_FIELD'
  | 'VERSION_CONFLICT'
  | 'SESSION_EXPIRED'
  /* C-ERR@2 追加：账号相关错误码。既有 8 个成员的取值与顺序保持不变，新码一律在末尾。 */
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'FORBIDDEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'RATE_LIMITED'
  /* C-ERR@3 追加：用户名唯一约束 */
  | 'USERNAME_ALREADY_REGISTERED';

/** 运行时白名单：用于把外部 `unknown` 错误码收窄（不要用 as 硬转）。 */
export const ERROR_CODES: readonly ErrorCode[] = [
  'INVALID_FILE',
  'LIMIT_EXCEEDED',
  'PARSE_FAILED',
  'MODEL_UNAVAILABLE',
  'UNSUPPORTED_TEMPLATE',
  'MISSING_FIELD',
  'VERSION_CONFLICT',
  'SESSION_EXPIRED',
  /* C-ERR@2 追加：白名单末尾追加 6 个账号错误码，前 8 项保持不变。 */
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'EMAIL_ALREADY_REGISTERED',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'RATE_LIMITED',
  /* C-ERR@3 追加 */
  'USERNAME_ALREADY_REGISTERED',
] as const;

export const ERROR_CODE_META: Record<
  ErrorCode,
  { http: number; retryable: boolean; message: string }
> = {
  INVALID_FILE: { http: 400, retryable: false, message: '文件无法解析（非 pptx / 损坏 / 含宏 / 加密）' },
  LIMIT_EXCEEDED: { http: 413, retryable: false, message: '超出限制（70MB / 100 页 / 解压 200MB）' },
  PARSE_FAILED: { http: 422, retryable: true, message: '解析失败，可重试' },
  MODEL_UNAVAILABLE: { http: 503, retryable: true, message: '规则化候选生成暂不可用' },
  UNSUPPORTED_TEMPLATE: { http: 422, retryable: false, message: '不支持该模板' },
  MISSING_FIELD: { http: 422, retryable: false, message: '缺少字段或取值越界' },
  VERSION_CONFLICT: { http: 409, retryable: false, message: '版本不一致，请重新载入后确认' },
  SESSION_EXPIRED: { http: 401, retryable: false, message: '会话已过期，请重新进入工作空间' },
  /* C-ERR@2 追加：http / retryable / message 与 §2.2 C-ERR@2 表逐字一致。
   * EMAIL_NOT_VERIFIED 与 RATE_LIMITED 在本版本不产生（保留值），前端只做兜底展示。 */
  AUTH_REQUIRED: { http: 401, retryable: false, message: '请先登录' },
  INVALID_CREDENTIALS: { http: 401, retryable: false, message: '用户名或密码不正确' },
  EMAIL_ALREADY_REGISTERED: { http: 409, retryable: false, message: '该邮箱已注册，可直接登录' },
  FORBIDDEN: { http: 403, retryable: false, message: '账号不可用，请联系管理员' },
  EMAIL_NOT_VERIFIED: { http: 403, retryable: false, message: '请先完成邮箱验证' },
  RATE_LIMITED: { http: 429, retryable: false, message: '请求过于频繁，请稍后再试' },
  USERNAME_ALREADY_REGISTERED: { http: 409, retryable: false, message: '该用户名已被占用，请换一个' },
};

/* ==========================================================================
 * C-MX@1 matrix_2d（§2.2.3）
 * ========================================================================== */

/** 2×2 矩阵，行优先。 */
export type Matrix2 = [[number, number], [number, number]];
/** 二维向量。 */
export type Vector2 = [number, number];

export interface Matrix2dConfig {
  operation: 'matrix_apply' | 'matrix_compose';
  /** 必填，如 "matrix_A" */
  matrix_parameter_id: string;
  /** operation=matrix_compose 时必填 */
  second_matrix_parameter_id: string | null;
  /** 界面当前展示顺序 */
  compose_order: 'A_then_B' | 'B_then_A' | null;
  /** 固定，仅供展示 */
  angle_unit: 'deg';
}

export interface MatrixStepTerm {
  coefficient: number;
  column_index: 0 | 1;
  column: Vector2;
}

export interface MatrixStep1 {
  step: 1;
  title: '取输入坐标当倍数';
  terms: MatrixStepTerm[];
}

export interface MatrixStep2 {
  step: 2;
  title: '组合各列';
  partial: Vector2;
  result: Vector2;
}

export type MatrixEigenvalues =
  | { real: true; values: [number, number] }
  | { real: false; reason: string };

export interface MatrixComposition {
  order: 'A_then_B' | 'B_then_A';
  ab: Matrix2;
  ba: Matrix2;
  abx: Vector2;
  bax: Vector2;
  /** ABx 与 BAx 是否数值相等（容差 1e-9） */
  commutes: boolean;
}

export interface Matrix2dResult {
  ax: Vector2;
  /** 两列去向，等于 A 的两列 */
  columns: [Vector2, Vector2];
  det: number;
  trace: number;
  rank: 0 | 1 | 2;
  eigenvalues: MatrixEigenvalues;
  invertible: boolean;
  inverse: Matrix2 | null;
  /** invertible=false 时非空 */
  singular_reason: string | null;
  steps: [MatrixStep1, MatrixStep2];
  composition: MatrixComposition | null;
  /** 单位圆像的半轴长；奇异时为 null */
  ellipse: { a: number; b: number } | null;
}

/* ==========================================================================
 * C-FC@1 force_2d（§2.2.4）
 * ========================================================================== */

export interface Force2dConfig {
  operation: 'resultant';
  angle_unit: 'deg';
  /** 界面舍入位数，默认 2 */
  display_precision: number;
  /** 计算精度说明位数，默认 6 */
  compute_precision: number;
}

/** type="force_list" 的 value：长度 2..4；magnitude 为十进制字符串（N）。 */
export interface ForceInput {
  magnitude: string;
  angle_deg: number;
}

export interface ForceComponent {
  magnitude: string;
  angle_deg: number;
  fx: number;
  fy: number;
}

export interface Force2dResult {
  forces: ForceComponent[];
  fx: number;
  fy: number;
  magnitude: number;
  /** 按 display_precision 格式化 */
  magnitude_rounded: string;
  /** 保留 compute_precision 位 */
  magnitude_exact: string;
  /** 合力≈0 时为 null */
  direction_deg: number | null;
  direction_rounded: string | null;
  direction_defined: boolean;
  /** 合力 < 1e-9 */
  cancel: boolean;
  /** 如 "合力为零，方向未定义" */
  note: string;
  tolerance: number;
}

/* ==========================================================================
 * C-BFS@1 bfs_flow（§2.2.5）
 * ========================================================================== */

export interface BfsFlowConfig {
  operation: 'bfs';
  directed: boolean;
  /** 必须存在于 nodes[].id */
  start_node_id: string;
  /** 首版唯一允许值 */
  neighbor_order: 'lexicographic_by_id';
  /** 上限 200 */
  max_steps: number;
}

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

/** type="graph" 的 value。 */
export interface GraphValue {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type BfsStep =
  | {
      index: number;
      kind: 'dequeue';
      node: string;
      queue_after: string[];
      visited_after: string[];
    }
  | {
      index: number;
      kind: 'enqueue';
      node: string;
      from: string;
      queue_after: string[];
    }
  | {
      index: number;
      kind: 'skip';
      node: string;
      from: string;
      reason: 'already_visited' | 'already_queued' | 'not_adjacent';
    };

export interface BfsRejectedEdge {
  from: string;
  to: string;
  reason: string;
}

export interface BfsFlowResult {
  /** 访问（出队）序列 */
  order: string[];
  enqueue_order: string[];
  visited: string[];
  unvisited: string[];
  parent: Record<string, string | null>;
  level: Record<string, number>;
  edges_of_spanning_tree: { from: string; to: string }[];
  /** 如 "D 已在队列中" */
  rejected_edges: BfsRejectedEdge[];
  trace: BfsStep[];
  terminated_reason: 'completed' | 'max_steps_reached';
  has_cycle: boolean;
}

/* ==========================================================================
 * C-BUD@1 budget_compare（§2.2.6）
 * ========================================================================== */

export interface BudgetCompareConfig {
  operation: 'compare_two_plans';
  /** 固定两个方案 id */
  scenarios: [string, string];
  /** null 表示未设上限 */
  budget_limit_parameter_id: string | null;
}

export type AstNode =
  | { op: 'constant'; value: string }
  | { op: 'ref'; parameter_id: string }
  | { op: 'add'; args: AstNode[] }
  | { op: 'multiply'; args: AstNode[] };

export type ScenarioId = 'plan_a' | 'plan_b';

export interface BudgetScenario {
  scenario_id: ScenarioId;
  name: string;
  /** 十进制字符串，2 位小数 */
  total: string;
  per_person: string;
  fixed: string;
}

export interface LineSeries {
  scenario_id: ScenarioId;
  at_zero: string;
  at_max: string;
  slope: string;
}

export interface BudgetCompareResult {
  inputs: { people: number };
  scenarios: [BudgetScenario, BudgetScenario];
  /** plan_a − plan_b，带符号十进制字符串 */
  difference: string;
  equal: boolean;
  budget_limit: string | null;
  /** 与 scenarios 对应；未设上限时为 null */
  remaining: [string, string] | null;
  over_budget: [boolean, boolean] | null;
  /** 供界面画直线，n ∈ [0, 2000] */
  lines: [LineSeries, LineSeries];
  /** 金额展示小数位，默认 2 */
  display_precision: number;
}

/* ==========================================================================
 * C-UI@1 共享组件与模板契约（§2.2.11）
 * ========================================================================== */

export interface TemplateProps {
  object: KnowledgeObject;
  revision: number;
  onParameterChange: (parameterId: string, value: unknown) => void;
  onReset: () => void;
  onFocusSource: (sourceRefId: string) => void;
  /** 对应模板 Result；由 domain 纯函数计算 */
  result: unknown;
  /** 越界等错误文案 */
  resultError: string | null;
  reducedMotion: boolean;
  /** 仅 matrix 模板使用，其余忽略 */
  display: 'original' | 'transformed' | 'overlay';
}

export interface ParamControlProps {
  parameter: Parameter;
  value: unknown;
  onChange: (value: unknown) => void;
  error: string | null;
  disabled: boolean;
}

export interface SourcePanelProps {
  sources: SourceRef[];
  activeSourceId: string | null;
  onSelect: (sourceRefId: string) => void;
}

export interface ChecksPanelProps {
  report: ValidationReport | null;
  isStale: boolean;
  onRun: () => void;
  running: boolean;
}

export interface RunsPanelProps {
  runs: RunSnapshot[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
  onRestore: (run: RunSnapshot) => void;
}

export interface StatusBadgeProps {
  status: CheckStatus | MaterialStatus | JobStage;
  label?: string;
}

/* ==========================================================================
 * 模板 → 结果类型映射（供 registry / hooks 泛化使用）
 * ========================================================================== */

export interface TemplateResultMap {
  matrix_2d: Matrix2dResult;
  force_2d: Force2dResult;
  bfs_flow: BfsFlowResult;
  budget_compare: BudgetCompareResult;
}

/* ==========================================================================
 * 类型守卫：所有外部 JSON 都先按 unknown 进入，逐一收窄，禁止 any
 * ========================================================================== */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isMatrix2(value: unknown): value is Matrix2 {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [row0, row1] = value;
  if (!Array.isArray(row0) || !Array.isArray(row1)) return false;
  if (row0.length !== 2 || row1.length !== 2) return false;
  return (
    isFiniteNumber(row0[0]) &&
    isFiniteNumber(row0[1]) &&
    isFiniteNumber(row1[0]) &&
    isFiniteNumber(row1[1])
  );
}

export function isVector2(value: unknown): value is Vector2 {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

export function isForceInputList(value: unknown): value is ForceInput[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return false;
  return value.every(
    (item) =>
      isPlainObject(item) &&
      typeof item['magnitude'] === 'string' &&
      isFiniteNumber(item['angle_deg']),
  );
}

export function isGraphValue(value: unknown): value is GraphValue {
  if (!isPlainObject(value)) return false;
  const nodes = value['nodes'];
  const edges = value['edges'];
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
  const nodesOk = nodes.every(
    (node) =>
      isPlainObject(node) && typeof node['id'] === 'string' && typeof node['label'] === 'string',
  );
  const edgesOk = edges.every(
    (edge) => isPlainObject(edge) && typeof edge['from'] === 'string' && typeof edge['to'] === 'string',
  );
  return nodesOk && edgesOk;
}

export function isProvenance(value: unknown): value is Provenance {
  return (
    value === 'original' ||
    value === 'inferred' ||
    value === 'user_confirmed' ||
    value === 'manual_demo'
  );
}

export function isParameterType(value: unknown): value is ParameterType {
  return (
    value === 'matrix2' ||
    value === 'vector2' ||
    value === 'force_list' ||
    value === 'graph' ||
    value === 'integer' ||
    value === 'decimal' ||
    value === 'enum' ||
    value === 'text'
  );
}

export function isTemplateId(value: unknown): value is TemplateId {
  return (
    value === 'matrix_2d' ||
    value === 'force_2d' ||
    value === 'bfs_flow' ||
    value === 'budget_compare'
  );
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!isPlainObject(value)) return false;
  const bbox = value['bbox'];
  const bboxOk =
    bbox === null ||
    (isPlainObject(bbox) &&
      isFiniteNumber(bbox['x']) &&
      isFiniteNumber(bbox['y']) &&
      isFiniteNumber(bbox['w']) &&
      isFiniteNumber(bbox['h']));
  return (
    typeof value['id'] === 'string' &&
    isProvenance(value['provenance']) &&
    typeof value['label'] === 'string' &&
    (value['material_id'] === null || typeof value['material_id'] === 'string') &&
    (value['page'] === null || isFiniteNumber(value['page'])) &&
    (value['element_id'] === null || typeof value['element_id'] === 'string') &&
    bboxOk &&
    (value['excerpt'] === null || typeof value['excerpt'] === 'string')
  );
}

export function isKnowledgeObject(value: unknown): value is KnowledgeObject {
  if (!isPlainObject(value)) return false;
  const parameters = value['parameters'];
  const sourceRefs = value['source_refs'];
  const bindings = value['bindings'];
  const config = value['config'];
  return (
    value['schema_version'] === '0.2' &&
    typeof value['object_id'] === 'string' &&
    typeof value['title'] === 'string' &&
    (value['material_id'] === null || typeof value['material_id'] === 'string') &&
    isFiniteNumber(value['model_version']) &&
    isFiniteNumber(value['revision']) &&
    isTemplateId(value['template_id']) &&
    typeof value['kernel_version'] === 'string' &&
    isPlainObject(config) &&
    Array.isArray(parameters) &&
    parameters.every(
      (p) => isPlainObject(p) && typeof p['id'] === 'string' && isParameterType(p['type']),
    ) &&
    isStringArray(value['views']) &&
    Array.isArray(bindings) &&
    Array.isArray(sourceRefs) &&
    sourceRefs.every(isSourceRef) &&
    typeof value['validation_profile'] === 'string' &&
    typeof value['created_at'] === 'string' &&
    typeof value['updated_at'] === 'string'
  );
}

export function isValidationReport(value: unknown): value is ValidationReport {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['report_id'] === 'string' &&
    typeof value['object_id'] === 'string' &&
    isFiniteNumber(value['model_version']) &&
    isFiniteNumber(value['revision']) &&
    Array.isArray(value['items']) &&
    isPlainObject(value['summary']) &&
    typeof value['is_stale'] === 'boolean'
  );
}

export function isRunSnapshot(value: unknown): value is RunSnapshot {
  return (
    isPlainObject(value) &&
    typeof value['run_id'] === 'string' &&
    typeof value['object_id'] === 'string' &&
    isFiniteNumber(value['model_version']) &&
    isFiniteNumber(value['revision']) &&
    isKnowledgeObject(value['input_snapshot'])
  );
}

/* ==========================================================================
 * 取值辅助：把 Parameter.value 的 unknown 收窄为具体形状
 * ========================================================================== */

/** 数值型参数取值；非有限数返回 null（调用方负责给出错误文案）。 */
export function readNumberValue(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/** 十进制字符串参数取值（如金额、力的大小）；非法格式返回 null。 */
export function readDecimalStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : null;
}

/** 读取 config 中的字符串字段（config 是 Record<string, unknown>）。 */
export function readConfigString(config: Record<string, unknown>, key: string): string | null {
  const raw = config[key];
  return typeof raw === 'string' ? raw : null;
}

export function readConfigNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const raw = config[key];
  return isFiniteNumber(raw) ? raw : fallback;
}

export function readConfigBoolean(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = config[key];
  return typeof raw === 'boolean' ? raw : fallback;
}
/* ==========================================================================
 * P2 追加：发布 / 只读分享（P2-10 / P2-11）
 * ========================================================================== */

/** 发布结果：`share_url` 是学生端前端路由（`/p/<share_id>`）。 */
export interface PublishResult {
  share_id: string;
  share_url: string;
}

/** 撤销结果：`revoked` 是本次被撤销的链接数（幂等，可重复调用）。 */
export interface RevokePublishResult {
  revoked: number;
  revoked_at: string;
}

/** 公开页图：URL 由后端按 share_id 生成，不是 `data/renders` 的静态地址。 */
export interface SharePageImage {
  title?: string | null;
  width?: number;
  height?: number;
  elements?: SlideElement[];
  page_no: number;
  image_url: string | null;
  erased_image_url: string | null;
}

/**
 * 公开发布快照。
 *
 * `regions` / `ispecs` 用 `unknown[]`：后端已做白名单裁剪，前端再分别用
 * `parsePageRegions` 与 `parseShareSpecs` 收窄。这里不引入 `any`，也不把
 * 后端内部形状（material_id / session_id）写进可访问类型。
 */
export interface ShareSnapshot {
  scene_document?: import('../document/types').SceneDocument|null;
  schema_version: string;
  published_at: string | null;
  title: string;
  page_count: number;
  pages: SharePageImage[];
  regions: unknown[];
  ispecs: unknown[];
  /** PPT AI 冻结投影（ppt-ai.frozen.1）；旧快照可能没有该字段。 */
  ppt_ai?: unknown;
}

function isSharePageImage(value: unknown): value is SharePageImage {
  if (!isPlainObject(value)) return false;
  return (
    isFiniteNumber(value['page_no']) &&
    (value['image_url'] === null || typeof value['image_url'] === 'string') &&
    (value['erased_image_url'] === null || typeof value['erased_image_url'] === 'string')
  );
}

/** 运行时收窄：公开端点返回的形状不符合预期时，让调用方显式报错而不是崩溃在白屏里。 */
export function isShareSnapshot(value: unknown): value is ShareSnapshot {
  if (!isPlainObject(value)) return false;
  return (
typeof value['schema_version'] === 'string' &&
    (value['published_at'] === null || typeof value['published_at'] === 'string') &&
    typeof value['title'] === 'string' &&
    isFiniteNumber(value['page_count']) &&
    value['page_count'] >= 0 &&
    Array.isArray(value['pages']) &&
    value['pages'].every(isSharePageImage) &&
    Array.isArray(value['regions']) &&
    Array.isArray(value['ispecs'])
  );
}
/* ==========================================================================
 * C-AUTHAPI@1 / C-WEBAPI@1 追加：账号类型（字段与后端 snake_case 逐字一致）
 *
 * 追加而非修改：既有 19 端点与 mock 演示链路不受影响。账号端点的 Cookie
 * （`xs_auth`）由服务端 HttpOnly 下发，前端不读取、不保存任何令牌。
 * ========================================================================== */

/**
 * 邮箱验证状态：
 *  - `verified`：注册时已通过 6 位邮箱验证码校验；
 *  - `disabled_development`：邮箱验证上线前的历史账号（开发期降级标记）。
 */
export type EmailVerificationState = 'disabled_development' | 'verified';

export interface AuthUser {
  user_id: string;
  /** 用户名的展示值（大小写与注册时一致）；老账号回退为邮箱本地部分 */
  username: string;
  /** 展示值（`login_identities.display_identifier`），大小写与注册时原样一致 */
  email: string;
  display_name: string;
  status: 'active';
  /** ISO 8601 UTC，如 2026-11-07T05:00:00Z */
  created_at: string;
  email_verification: EmailVerificationState;
  /**
   * 头像 URL（后端相对路径，带 `v=<avatar_id>` 版本参数）。
   * 未上传时为 null / 缺省；前端一律回退昵称首字。
   */
  avatar_url?: string | null;
}

/** 登录后的默认落地入口：个人主页或题目实验室。 */
export type AccountDefaultEntry = 'space' | 'labs';

/** 账号资料与偏好（`GET /me` 的 `profile`，字段与后端 snake_case 逐字一致）。 */
export interface UserProfile {
  bio: string;
  occupation: string;
  school: string;
  /** 选填；服务端只返回规范化后的 11 位号码，空串表示未填写 */
  phone: string;
  interests: string[];
  preferred_subject: string;
  default_entry: AccountDefaultEntry;
  /** ISO 8601 UTC */
  updated_at: string;
}

/** `PATCH /me` 请求体：省略的字段表示保持不变。 */
export interface UpdateMePayload {
  display_name?: string;
  bio?: string;
  occupation?: string;
  school?: string;
  phone?: string;
  interests?: string[];
  preferred_subject?: string;
  default_entry?: AccountDefaultEntry;
}

/** `PATCH /me` 与头像上传/删除的统一响应（最新账号 + 最新资料）。 */
export interface ProfileUpdateResult {
  user: AuthUser;
  profile: UserProfile;
}

export interface LoginRequestPayload {
  /** 用户名或邮箱 */
  identifier: string;
  password: string;
  /** 省略等价于 false（对应 12h/24h；true 对应 168h/720h） */
  remember?: boolean;
}

export interface RegisterRequestPayload {
  username: string;
  email: string;
  password: string;
  /** 6 位邮箱验证码（由 `POST /auth/register/code` 下发，一次性使用） */
  verification_code: string;
  /** 省略或 null 时由服务端用用户名填充 */
  display_name?: string | null;
}

/** `POST /api/v1/auth/register/code` 请求体（匿名）。 */
export interface SendRegisterCodePayload {
  email: string;
}

/** `POST /api/v1/auth/register/code` 响应。 */
export interface SendRegisterCodeResult {
  /** 服务端规范化后的邮箱展示值 */
  email: string;
  /** 验证码有效期（秒） */
  expires_in_seconds: number;
  /** 允许重发前需等待的秒数 */
  resend_after_seconds: number;
}

export interface LoginResult {
  user: AuthUser;
  /** 43 字符原始 CSRF；只用于 X-CSRF-Token，不写入 URL / localStorage */
  csrf_token: string;
  /** 空闲到期（与 `MeResponse.session.idle_expires_at` 同语义） */
  expires_at: string;
  absolute_expires_at: string;
}

export interface AuthSessionSummary {
  session_id: string;
  expires_at: string;
  idle_expires_at: string;
}

export interface MeResponse {
  user: AuthUser;
  session: AuthSessionSummary;
  csrf_token: string;
  profile: UserProfile;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** 运行时收窄：外部 JSON 先按 unknown 进入（禁止 any / as 硬转）。 */
export function isAuthUser(value: unknown): value is AuthUser {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value['user_id']) &&
    isNonEmptyString(value['username']) &&
    isNonEmptyString(value['email']) &&
    isNonEmptyString(value['display_name']) &&
    value['status'] === 'active' &&
    isNonEmptyString(value['created_at']) &&
    (value['email_verification'] === 'disabled_development' ||
      value['email_verification'] === 'verified') &&
    (value['avatar_url'] === undefined ||
      value['avatar_url'] === null ||
      typeof value['avatar_url'] === 'string')
  );
}

/** 运行时收窄：`POST /auth/register/code` 的响应形状。 */
export function isSendRegisterCodeResult(value: unknown): value is SendRegisterCodeResult {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value['email']) &&
    typeof value['expires_in_seconds'] === 'number' &&
    typeof value['resend_after_seconds'] === 'number'
  );
}

/** 运行时收窄：账号资料与偏好。 */
export function isUserProfile(value: unknown): value is UserProfile {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['bio'] === 'string' &&
    typeof value['occupation'] === 'string' &&
    typeof value['school'] === 'string' &&
    typeof value['phone'] === 'string' &&
    isStringArray(value['interests']) &&
    typeof value['preferred_subject'] === 'string' &&
    (value['default_entry'] === 'space' || value['default_entry'] === 'labs') &&
    isNonEmptyString(value['updated_at'])
  );
}

/** 运行时收窄：`GET /api/v1/me` 的 data 形状。 */
export function isMeResponse(value: unknown): value is MeResponse {
  if (!isPlainObject(value)) return false;
  const session = value['session'];
  if (!isPlainObject(session)) return false;
  return (
    isAuthUser(value['user']) &&
    isNonEmptyString(session['session_id']) &&
    isNonEmptyString(session['expires_at']) &&
    isNonEmptyString(session['idle_expires_at']) &&
    isNonEmptyString(value['csrf_token']) &&
    isUserProfile(value['profile'])
  );
}
