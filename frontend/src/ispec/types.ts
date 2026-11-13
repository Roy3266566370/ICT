/**
 * 交互规格 iSpec v1.0 的 TypeScript 契约。
 * 权威定义：`contracts/spec/ispec.schema.json`（JSON Schema 2020-12）。
 *
 * 设计约束（不可违反）：
 * - 新增知识类型只能新增一份 iSpec，不得新增宿主组件或专用内核；
 * - `expr` 是**受限表达式**，只能由 `ispec/expr` 的解析器求值，禁止 `eval` / `new Function`；
 * - 每个参数必须带 `source`（页码 + 状态 + 原文片段），**无证据不出结论**。
 */

export type SpecVersion = '1.0';

export type PrimitiveKind = 'parametric' | 'filter' | 'step' | 'geometric' | 'branch';

export type ParameterType = 'number' | 'integer' | 'boolean' | 'enum' | 'string';

export type ProvenanceStatus = 'original' | 'inferred' | 'confirmed' | 'manual_demo';

export interface SourceRef {
  page: number;
  element_id: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  status: ProvenanceStatus;
  /** 必须来自原文，不允许改写 */
  excerpt: string;
  user_checks?: Array<{
    check_id?: string;
    decision?: 'confirm' | 'edit';
    note?: string;
    checked_at?: string;
    before_hash?: string;
    after_hash?: string;
  }>;
}

export type TrustLevel = 'green' | 'yellow' | 'red' | 'gray';
export type TrustValidationStatus = 'pass' | 'fail' | 'not_covered';

export interface TrustParameter {
  id: string;
  label: string;
  status: 'original' | 'inferred' | 'default' | 'confirmed';
  status_label: string;
  value: number | boolean | string | null;
  unit: string;
  anchor: {
    page: number | null;
    element_id: string | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
    excerpt: string;
  };
  anchor_checked: boolean;
  anchor_verified: boolean;
  anchor_errors: string[];
  user_checks: Array<Record<string, unknown>>;
}

export interface TrustComparison {
  check_id: string;
  title: string;
  status: TrustValidationStatus;
  expected: string;
  actual: string | null;
  delta: number | null;
  detail: string;
}

export interface TrustReport {
  version: 'trust.1';
  generated_at: string;
  level: TrustLevel;
  level_label: string;
  reason: string;
  parameters: TrustParameter[];
  validation: {
    status: TrustValidationStatus;
    profile: string | null;
    reason: string;
    comparisons: TrustComparison[];
  };
  declarations: Array<{
    id: string;
    claim: string;
    status: 'pass' | 'fail';
    expected: number;
    actual: number | null;
    detail: string;
  }>;
  model: {
    used: boolean;
    confidence: number | null;
    provider: string;
    note: string;
  };
  anchor_failures: number;
  anchor_unavailable: number;
  report_hash: string;
}

export interface SpecParameter {
  id: string;
  label: string;
  type?: ParameterType;
  unit?: string;
  /**
   * 跨 iSpec 共享标识（§9-4）：同一变量在多页出现时取同一值。
   * 由识别层分配（`backend/app/ispec/shared.py`），前端据此跨页同步取值。
   */
  shared_key?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | string;
  /** 原稿/已确认基准；有保存值时 default 为当前值，重置回到这里。 */
  source_default?: number | boolean | string;
  options?: string[];
  source: SourceRef;
}

/** 共享组的一个成员：某条 iSpec 里的某个参数。 */
export interface SharedGroupMember {
  object_id: string;
  parameter_id: string;
  /** 参数来源页码（`parameters[].source.page`）。 */
  page?: number;
}

/**
 * 跨 iSpec 共享组（§9-4）：同一变量在多页出现时的汇总。
 *
 * `conflict` 为真表示各页默认值不一致——**不自动统一**，由用户在详情面板确认一个值。
 */
export interface SharedGroup {
  shared_key: string;
  label: string;
  unit?: string;
  members: SharedGroupMember[];
  conflict?: boolean;
  /** 冲突时各页的默认值原文（字符串化，便于直接展示）。 */
  defaults?: string[];
}

/** 内联数据集：图表/表格视图的数据通道（不依赖 slides.json）。 */
export interface SpecDataset {
  id: string;
  columns: string[];
  rows: Array<Array<number | string | boolean | null>>;
  source?: Record<string, unknown>;
}

export interface SpecExpression {
  id: string;
  expr: string;
  unit?: string;
  label?: string;
}

export interface VegaView {
  type: 'vega';
  spec_ref: 'line' | 'bar' | 'scatter' | 'heatmap' | 'grid_and_transform';
  x?: string;
  y?: string;
  /** 引用 ISpec.datasets[].id */
  dataset?: string;
  title?: string;
}

export interface TableView {
  type: 'table';
  columns: string[];
  /** 引用 ISpec.datasets[].id */
  dataset?: string;
  title?: string;
}

export interface TextView {
  type: 'text';
  template: string;
  title?: string;
}

export interface FigureView {
  type: 'figure';
  spec_ref:
    | 'vectors'
    | 'circle_ellipse'
    | 'grid_transform'
    | 'step_diagram'
    | 'det_area'
    | 'eigen_probe'
    | 'basis_change'
    | 'singular_compare'
    | 'rank_map'
    | 'inverse_map';
  title?: string;
}

export type SpecView = VegaView | TableView | TextView | FigureView;

export interface SpecConstraint {
  expr: string;
  message?: string;
  severity?: 'error' | 'warn';
}

export type CheckType = 'consistency' | 'source_match' | 'range';

export interface SpecCheck {
  id: string;
  type: CheckType;
  expr?: string;
  page?: number;
  expect?: string;
}

export interface SceneDefinition {
  scene_type: string;
  version: string;
  title?: string;
  condition_note?: string;
  controls?: string[];
  stages?: Array<{id: string; label: string; [key: string]: unknown}>;
  supports_overlay?: boolean;
  source_status?: string;
  source_excerpt?: string;
  [key: string]: unknown;
}

export interface ISpec {
  model?: {
    used: boolean;
    confidence: number | null;
    provider: string;
    note: string;
  };
  trust?: TrustReport;
  scene?: SceneDefinition;
  anchor?: {page: number; element_id: string; bbox: {x: number; y: number; w: number; h: number}; node_id?: string};
  node_id?: string;
  availability?: 'active' | 'needs_review';
  availability_reason?: string;
  generated_by?: 'auto' | 'user' | 'native';
  spec_version: SpecVersion;
  object_id: string;
  title?: string;
  kind: PrimitiveKind;
  parameters: SpecParameter[];
  expressions?: SpecExpression[];
  datasets?: SpecDataset[];
  views: SpecView[];
  constraints?: SpecConstraint[];
  checks?: SpecCheck[];
  notes?: string;
}

/** 位图读图场景 IR（`spec.scene.figure_scenes`，补充数据，不改冻结 schema）。 */
export interface FigureSceneCheck {
  id: string;
  title: string;
  expected?: unknown;
  actual?: unknown;
  pass: boolean;
}

export interface FigureSceneRun {
  text: string;
  color?: string;
  size_pt?: number;
  font?: string;
}

export interface FigureSceneCaption {
  element_id: string;
  bbox_emu: { x: number; y: number; w: number; h: number };
  text: string;
  runs?: FigureSceneRun[];
  align?: string | null;
  /** 原文写法模板：scale/shear/collapse/unit；用于按当前值重写同一句式。 */
  template?: string | null;
  accent?: string;
}

export interface FigureSceneLabel {
  text: string;
  /** 原图像素坐标 [x0, y0, x1, y1]。 */
  box: [number, number, number, number];
  color?: [number, number, number];
  height?: number;
  /** 该标签跟踪的量：height_d（高度/纵向分量）等。 */
  binding?: string;
  anchor?: string;
  score?: number;
}

export interface FigureSceneBind {
  a: string;
  b: string;
  c: string;
  d: string;
  label?: string;
}

export interface FigureScene {
  v: number;
  page: number;
  element_id: string;
  bbox_emu: { x: number; y: number; w: number; h: number };
  /** 原图像素尺寸 [w, h]；场景内全部坐标都是这套像素坐标。 */
  image_px: [number, number];
  /** 坐标原点（像素）。 */
  origin: [number, number];
  /** 单位向量 1 对应的像素长度。 */
  unit_px: number;
  calibration?: string;
  axes?: {
    h?: { y: number; x0: number; x1: number; width?: number };
    v?: { x: number; y0: number; y1: number; width?: number };
    color?: [number, number, number];
    alpha?: number;
  } | null;
  shape?: {
    kind: string;
    /** 基线形状顶点（原图像素坐标）。 */
    vertices: Array<[number, number]>;
    stroke_color?: [number, number, number];
    stroke_width?: number;
    fill?: [number, number, number, number];
  } | null;
  labels?: FigureSceneLabel[];
  dashed?: {
    orientation: 'h' | 'v';
    x?: number;
    y?: number;
    x0?: number;
    x1?: number;
    y0?: number;
    y1?: number;
    dash?: number;
    gap?: number;
    width?: number;
    color?: [number, number, number];
    alpha?: number;
  } | null;
  caption?: FigureSceneCaption | null;
  /** 读图原值（测量值，未取整）。 */
  matrix?: { a: number; b: number; c: number; d: number; e2_inferred?: boolean };
  /** 校验后的基线矩阵 [a, b, c, d]，即 M = [[a,b],[c,d]]。 */
  baseline: [number, number, number, number];
  /** 场景绑定的 iSpec 参数 id。 */
  bind?: FigureSceneBind;
  checks?: FigureSceneCheck[];
  confidence?: 'high' | 'medium' | 'low';
}

/** 读取挂到 spec 上的读图场景；无则返回空数组。 */
export function figureScenesOf(spec: ISpec): FigureScene[] {
  const raw = spec.scene?.['figure_scenes'];
  return Array.isArray(raw) ? (raw as FigureScene[]) : [];
}

/** 一次求值的结果：参数值 + 派生量 + 约束状态。 */
export interface SpecEvaluation {
  values: Record<string, number | boolean | string>;
  derived: Record<string, number | boolean | string>;
  /** 约束不通过时的消息（空数组表示全部通过） */
  violations: Array<{ expr: string; message: string; severity: 'error' | 'warn' }>;
}

/** 初始化参数值：取 default，并按 min/max/step 归一。 */
export function initialValues(spec: ISpec): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const p of spec.parameters) {
    out[p.id] = clampToSpec(p, p.default);
  }
  return out;
}

/** 按参数定义做类型与范围归一；越界时夹紧并返回夹紧后的值。 */
export function clampToSpec(
  p: SpecParameter,
  raw: number | boolean | string,
): number | boolean | string {
  if (p.type === 'boolean') return Boolean(raw);
  if (p.type === 'string' || p.type === 'enum') {
    const s = String(raw);
    if (p.options && p.options.length > 0 && !p.options.includes(s)) {
      return p.options[0] ?? s;
    }
    return s;
  }
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = typeof p.default === 'number' ? p.default : 0;
  if (p.type === 'integer') n = Math.round(n);
  if (typeof p.min === 'number' && n < p.min) n = p.min;
  if (typeof p.max === 'number' && n > p.max) n = p.max;
  if (typeof p.step === 'number' && p.step > 0) {
    const base = typeof p.min === 'number' ? p.min : 0;
    n = base + Math.round((n - base) / p.step) * p.step;
    // 消除浮点尾差
    const digits = (String(p.step).split('.')[1] ?? '').length;
    n = Number(n.toFixed(Math.min(digits + 2, 8)));
  }
  return n;
}

/** 参数是否偏离默认值（用于"当前值"标记；文档要求参数未偏离时不覆盖原文字）。 */
export function isOffDefault(spec: ISpec, values: Record<string, number | boolean | string>): boolean {
  return spec.parameters.some((p) => {
    const current = values[p.id];
    if (typeof p.default === 'number' && typeof current === 'number') {
      return Math.abs(current - p.default) > 1e-9;
    }
    return current !== p.default;
  });
}

/** 校验 iSpec 的最小结构（不替代 JSON Schema，用于运行时快速失败并给出可读原因）。 */
export interface SpecValidationIssue {
  path: string;
  message: string;
}

export function validateISpecLite(spec: unknown): SpecValidationIssue[] {
  const issues: SpecValidationIssue[] = [];
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (!isRecord(spec)) {
    return [{ path: '', message: 'iSpec 必须是对象' }];
  }
  if (spec['spec_version'] !== '1.0') {
    issues.push({ path: 'spec_version', message: 'spec_version 必须为 "1.0"' });
  }
  if (typeof spec['object_id'] !== 'string' || spec['object_id'].length === 0) {
    issues.push({ path: 'object_id', message: 'object_id 不能为空' });
  }
  const kinds: ReadonlyArray<string> = ['parametric', 'filter', 'step', 'geometric', 'branch'];
  if (typeof spec['kind'] !== 'string' || !kinds.includes(spec['kind'])) {
    issues.push({ path: 'kind', message: 'kind 必须是五类原语之一' });
  }

  const params = spec['parameters'];
  if (!Array.isArray(params) || params.length === 0) {
    issues.push({ path: 'parameters', message: '至少需要一个参数' });
  } else {
    params.forEach((p, i) => {
      if (!isRecord(p)) {
        issues.push({ path: `parameters[${i}]`, message: '参数必须是对象' });
        return;
      }
      const src = p['source'];
      if (!isRecord(src)) {
        issues.push({ path: `parameters[${i}].source`, message: '缺少来源（页码/状态/原文片段）' });
        return;
      }
      if (typeof src['page'] !== 'number') {
        issues.push({ path: `parameters[${i}].source.page`, message: '缺少页码' });
      }
      const statuses: ReadonlyArray<string> = ['original', 'inferred', 'confirmed', 'manual_demo'];
      if (typeof src['status'] !== 'string' || !statuses.includes(src['status'])) {
        issues.push({ path: `parameters[${i}].source.status`, message: '来源状态非法' });
      }
      if (typeof src['excerpt'] !== 'string' || src['excerpt'].trim().length === 0) {
        issues.push({ path: `parameters[${i}].source.excerpt`, message: '缺少原文片段（无证据不出结论）' });
      }
    });
  }

  const views = spec['views'];
  if (!Array.isArray(views) || views.length === 0) {
    issues.push({ path: 'views', message: '至少需要一个视图' });
  }
  return issues;
}
