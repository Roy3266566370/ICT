/**
 * mockClient.ts —— 离线 mock 实现（`VITE_API_BASE` 为空时启用）
 *
 * 数据加载方案（对应任务书第 4 项要求）：
 *  1. 运行时优先读仓库根的 fixtures：
 *     - `fixtures/examples/index.json`、`fixtures/examples/{template_id}.json`
 *     - `fixtures/golden/{template_id}.json`（用于检查报告）
 *     - `fixtures/materials/matrix-courseware/{material,slides,objects}.json`
 *  2. `vite.config.ts` 的 `fixturesPlugin` 在 **dev** 阶段把 `/fixtures/**` 直接映射到
 *     仓库根 `fixtures/`（只放行 .json，带路径穿越校验），在 **build** 阶段把 fixtures 下的
 *     所有 .json 以 asset 形式 emit 到 `dist/fixtures/**`。因此：
 *     **既不需要把 fixtures 复制进 frontend/，也不需要 publicDir 指向仓库根。**
 *  3. fixtures 尚未产出（T1 未完成）或读取/解析失败时，**降级为内置最小数据**，
 *     绝不抛未捕获异常；所有降级都记在 `mockDiagnostics` 里，便于界面/控制台排查。
 *
 * 与 `client.ts` 的关系：本文件只 `import type` 客户端接口，运行时完全单向
 * （client → mockClient），错误类型由调用方通过 `makeError` 工厂注入，避免循环依赖。
 */
import type { ApiClient } from './client';
import type {
  AuthUser,
  CreateRunRequest,
  ErrorCode,
  ISpecScalar,
  ISpecValuesRecord,
  ISpecValuesResult,
  JobStage,
  JobStatus,
  KnowledgeObject,
  LoginRequestPayload,
  LoginResult,
  MaterialRegion,
  MaterialRegionsResponse,
  MaterialRegionStatus,
  MaterialSummary,
  MeResponse,
  ProfileUpdateResult,
  RegionConfirmStatus,
  RegionOverridePatch,
  RegisterRequestPayload,
  RegionOverrideResult,
  RunSnapshot,
  SendRegisterCodePayload,
  SendRegisterCodeResult,
  SessionInfo,
  SlideElement,
  SlidePage,
  TemplateId,
  UpdateMePayload,
  UserProfile,
  ValidationReport,
  CheckItem,
  CandidateObject,
  SharePageImage,
  ShareSnapshot,
} from './types';
import { isKnowledgeObject, isTemplateId, SHARED_VALUES_OBJECT_ID } from './types';
import { normalizeLimit } from './queryKeys';

/* -------------------------------------------------------------------------- */
/* 错误注入                                                                   */
/* -------------------------------------------------------------------------- */

export interface MockErrorInit {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  status: number;
  requestId: string;
  details?: Record<string, unknown>;
}

export type MockErrorFactory = (init: MockErrorInit) => Error;

export interface MockClientOptions {
  makeError: MockErrorFactory;
}

/** 区域覆盖的本地存储键（与 sessionStorage 草稿键分开，互不覆盖）。 */
const REGION_OVERRIDE_STORAGE_KEY = 'xiangsheng:region-overrides:v1';

/** 与后端 `data/regions/<material_id>.json` 同形状的单条覆盖。 */
interface StoredRegionOverride {
  status: RegionConfirmStatus | null;
  parameter_overrides: Record<string, unknown>;
  note: string | null;
  updated_at: string;
}

/** iSpec 参数值的本地存储键（§10.1 第 5 步；与区域覆盖互不覆盖）。 */
const ISPEC_VALUES_STORAGE_KEY = 'xiangsheng:ispec-values:v1';

/** 与后端 `data/ispec-values/<material_id>.json` 同形状的单个 object 桶。 */
interface StoredISpecValues {
  values: Record<string, ISpecScalar>;
  updated_at: string | null;
}

/** 从 `fixtures/materials/matrix-courseware/regions.json` 收窄出的基线区域。 */
interface MockRegionBaseline {
  region_id: string;
  page: number;
  script_id: string;
  status: MaterialRegionStatus;
  original_params: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* 通用工具                                                                   */
/* -------------------------------------------------------------------------- */

const HOUR_MS = 60 * 60 * 1000;

let requestSequence = 0;
function nextRequestId(): string {
  requestSequence += 1;
  return `mock${requestSequence.toString(16).padStart(6, '0')}`;
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** 深拷贝，避免调用方改到 mock 的内部状态。 */
function cloneData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneData(item)) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) result[key] = cloneData(source[key]);
    return result as unknown as T;
  }
  return value;
}

/**
 * fixtures 的站点根路径。
 *
 * 主路径：`vite.config.ts` 的 `base: '/'` → `BASE_URL === '/'` → `/fixtures/...`，
 * 与 deploy/nginx.conf 的 `location /fixtures/` 对齐。
 * 兜底：若有人把 base 改回相对形式（'./'），这里退化为站点根，避免拼出
 * `./fixtures/...` 在深层路由下被解析到错误目录。
 *
 * 注意：`import.meta.env` 只在 Vite 注入时存在；在纯 Node（单元测试、脚本）里
 * 可能整个是 undefined，因此这里用可选链兜底，保证 mockClient 任何情况下
 * 都不会因读取 env 而抛出未捕获异常（本文件的首要约束）。
 */
function fixturesRoot(): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return base === './' ? '/' : base;
}

const fixtureCache = new Map<string, Promise<unknown | null>>();

/* -------------------------------------------------------------------------- */
/* T11 真实解析产物（fixtures/materials/matrix-courseware）                    */
/* -------------------------------------------------------------------------- */

/** T11 产物的 material_id（C-MAT@1） */
const COURSEWARE_MATERIAL_ID = 'mat_matrix_courseware';
/** 旧链接/文档使用的别名，保持不 404 */
const COURSEWARE_ALIAS_ID = 'matrix-courseware';
/** 降级内置对象的 object_id；加载真实产物后作为别名指向真实 object_id */
const LEGACY_COURSEWARE_OBJECT_ID = 'course_matrix_2d';

interface CoursewareMaterialFile {
  materialId: string;
  title: string;
  pageCount: number;
  status: MaterialSummary['status'];
}

/** 解析 material.json（C-MAT@1 的 MaterialFile）；结构不合法返回 null。 */
function parseMaterialFile(raw: unknown): CoursewareMaterialFile | null {
  if (!isRecord(raw)) return null;
  const explicit = raw['material_id'];
  const fallback = raw['id'];
  const materialId =
    typeof explicit === 'string' && explicit !== ''
      ? explicit
      : typeof fallback === 'string' && fallback !== ''
        ? fallback
        : null;
  if (materialId === null) return null;
  const pageCount = raw['page_count'];
  if (typeof pageCount !== 'number' || !Number.isFinite(pageCount) || pageCount < 0) return null;
  const title = typeof raw['title'] === 'string' ? raw['title'] : '未命名材料';
  const rawStatus = raw['status'];
  const status: MaterialSummary['status'] =
    rawStatus === 'processing' || rawStatus === 'awaiting_confirmation' || rawStatus === 'failed'
      ? rawStatus
      : 'ready';
  return { materialId, title, pageCount, status };
}

/**
 * 解析单页。单个元素缺 element_id 或 bbox 非法时只丢弃该元素，
 * 不因为一个脏元素丢掉整页（471 个元素里常有装饰性形状）。
 */
function parseSlidePage(raw: unknown): SlidePage | null {
  if (!isRecord(raw)) return null;
  const pageNo = raw['page_no'];
  if (typeof pageNo !== 'number' || !Number.isFinite(pageNo)) return null;

  const paragraphsRaw = raw['paragraphs'];
  const paragraphs: string[] = Array.isArray(paragraphsRaw)
    ? paragraphsRaw.filter((item): item is string => typeof item === 'string')
    : [];

  const elements: SlideElement[] = [];
  const elementsRaw = raw['elements'];
  if (Array.isArray(elementsRaw)) {
    for (const element of elementsRaw) {
      if (!isRecord(element)) continue;
      const elementId = element['element_id'];
      const bbox = element['bbox'];
      if (typeof elementId !== 'string' || !isRecord(bbox)) continue;
      const { x, y, w, h } = bbox;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof w !== 'number' ||
        typeof h !== 'number'
      ) {
        continue;
      }
      const kind = element['kind'];
      elements.push({
        element_id: elementId,
        kind: kind === 'picture' || kind === 'shape' ? kind : 'text',
        name: typeof element['name'] === 'string' ? element['name'] : elementId,
        bbox: { x, y, w, h },
        text: typeof element['text'] === 'string' ? element['text'] : null,
        asset_id: typeof element['asset_id'] === 'string' ? element['asset_id'] : null,
      });
    }
  }

  const imageUrl = raw['image_url'];
  return {
    page_no: pageNo,
    title: typeof raw['title'] === 'string' ? raw['title'] : '第 ' + String(pageNo) + ' 页',
    paragraphs,
    elements,
    excerpt: typeof raw['excerpt'] === 'string' ? raw['excerpt'] : '',
    image_url: typeof imageUrl === 'string' && imageUrl !== '' ? imageUrl : null,
  };
}

/** 解析 slides.json：顶层容器可能是 pages（C-MAT@1）或 slides，取存在的那个。 */
function parseSlidesFile(raw: unknown): SlidePage[] | null {
  if (!isRecord(raw)) return null;
  const container = Array.isArray(raw['pages'])
    ? raw['pages']
    : Array.isArray(raw['slides'])
      ? raw['slides']
      : null;
  if (container === null) return null;
  const pages: SlidePage[] = [];
  for (const item of container) {
    const page = parseSlidePage(item);
    if (page !== null) pages.push(page);
  }
  return pages.length === 0 ? null : pages;
}

/** 解析 objects.json：只接受通过 C-KO@1 守卫的对象，宁可回退也不塞脏数据。 */
function parseObjectsFile(raw: unknown): KnowledgeObject[] {
  if (!isRecord(raw)) return [];
  const container = raw['objects'];
  if (!Array.isArray(container)) return [];
  const objects: KnowledgeObject[] = [];
  for (const item of container) {
    if (isKnowledgeObject(item)) objects.push(item);
  }
  return objects;
}


/** mock 数据来源诊断（降级原因会写在这里，便于排查"为什么显示内置数据"）。 */
export const mockDiagnostics: string[] = [];

function rememberDiagnostic(message: string): void {
  if (!mockDiagnostics.includes(message)) mockDiagnostics.push(message);
}

function readFixture(relativePath: string): Promise<unknown | null> {
  const cached = fixtureCache.get(relativePath);
  if (cached !== undefined) return cached;
  const url = `${fixturesRoot()}fixtures/${relativePath}`;
  const pending = fetch(url, { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) {
        rememberDiagnostic(`fixtures 缺失：${relativePath}（HTTP ${response.status}），已降级为内置数据`);
        return null;
      }
      try {
        return (await response.json()) as unknown;
      } catch {
        rememberDiagnostic(`fixtures 解析失败：${relativePath}，已降级为内置数据`);
        return null;
      }
    })
    .catch(() => {
      rememberDiagnostic(`fixtures 读取失败：${relativePath}（网络或路径不可达），已降级为内置数据`);
      return null;
    });
  fixtureCache.set(relativePath, pending);
  return pending;
}

/* -------------------------------------------------------------------------- */
/* 内置最小数据（fixtures 缺失时的降级来源）                                  */
/* -------------------------------------------------------------------------- */

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function manualDemoSourceRefs(
  entries: readonly {
    id: string;
    label: string;
    page: number;
    excerpt: string;
  }[],
): KnowledgeObject['source_refs'] {
  return entries.map((entry) => ({
    id: entry.id,
    provenance: 'manual_demo',
    label: entry.label,
    material_id: null,
    page: entry.page,
    element_id: null,
    // 页级来源不伪造元素框（§2.2.1 校验规则 5 / R4-AC3）
    bbox: null,
    excerpt: entry.excerpt,
  }));
}

const MATRIX_EXAMPLE: KnowledgeObject = {
  schema_version: '0.2',
  object_id: 'obj_example_matrix_2d',
  title: '空间与矩阵：一列一列地看变换',
  material_id: null,
  model_version: 1,
  revision: 0,
  template_id: 'matrix_2d',
  kernel_version: 'linear_v1',
  config: {
    operation: 'matrix_compose',
    matrix_parameter_id: 'matrix_A',
    second_matrix_parameter_id: 'matrix_B',
    compose_order: 'A_then_B',
    angle_unit: 'deg',
  },
  parameters: [
    {
      id: 'matrix_A',
      name: '矩阵 A',
      type: 'matrix2',
      value: [
        [1, 1],
        [0, 1],
      ],
      unit: '1',
      range: { min: -3, max: 3, step: 0.1 },
      source_ref_ids: ['src_s9'],
      provenance: 'manual_demo',
      editable: true,
    },
    {
      id: 'matrix_B',
      name: '矩阵 B',
      type: 'matrix2',
      value: [
        [1, 0],
        [1, 1],
      ],
      unit: '1',
      range: { min: -3, max: 3, step: 0.1 },
      source_ref_ids: ['src_s10'],
      provenance: 'manual_demo',
      editable: true,
    },
    {
      id: 'vector_x',
      name: '输入向量 x',
      type: 'vector2',
      value: [1, 1],
      unit: '1',
      range: { min: -3, max: 3, step: 0.1 },
      source_ref_ids: ['src_s6'],
      provenance: 'manual_demo',
      editable: true,
    },
  ],
  views: ['source', 'interactive', 'runs'],
  bindings: [
    { parameter_id: 'matrix_A', view_id: 'interactive', target: 'matrix' },
    { parameter_id: 'matrix_B', view_id: 'interactive', target: 'second_matrix' },
    { parameter_id: 'vector_x', view_id: 'interactive', target: 'vector' },
  ],
  source_refs: manualDemoSourceRefs([
    { id: 'src_s6', label: '第 6 页 · 三条向量，各去哪了', page: 6, excerpt: '三条向量，各去哪了' },
    {
      id: 'src_s9',
      label: '第 9 页 · 每一列是一个基向量的去向',
      page: 9,
      excerpt: '矩阵的每一列是一个基向量的去向',
    },
    {
      id: 'src_s10',
      label: '第 10 页 · 为什么换个顺序结果就不一样',
      page: 10,
      excerpt: '为什么换个顺序结果就不一样',
    },
  ]),
  validation_profile: 'matrix_2d_v1_full',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const FORCE_EXAMPLE: KnowledgeObject = {
  schema_version: '0.2',
  object_id: 'obj_example_force_2d',
  title: '力与向量：两个力怎样合成一个',
  material_id: null,
  model_version: 1,
  revision: 0,
  template_id: 'force_2d',
  kernel_version: 'force_v1',
  config: {
    operation: 'resultant',
    angle_unit: 'deg',
    display_precision: 2,
    compute_precision: 6,
  },
  parameters: [
    {
      id: 'forces',
      name: '共点力',
      type: 'force_list',
      value: [
        { magnitude: '10', angle_deg: 0 },
        { magnitude: '10', angle_deg: 90 },
      ],
      unit: 'N',
      range: { min: 0, max: 1000, step: 1 },
      source_ref_ids: ['src_force_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
  ],
  views: ['source', 'interactive', 'runs'],
  bindings: [{ parameter_id: 'forces', view_id: 'interactive', target: 'resultant' }],
  source_refs: manualDemoSourceRefs([
    {
      id: 'src_force_brief',
      label: '示例说明 · 10N 向东 + 10N 向北',
      page: 1,
      excerpt: '两个共点力按分量相加，合力大小与方向由分量决定。',
    },
  ]),
  validation_profile: 'force_2d_v1_full',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const BFS_EXAMPLE: KnowledgeObject = {
  schema_version: '0.2',
  object_id: 'obj_example_bfs_flow',
  title: '计算机过程：BFS 的队列与访问顺序',
  material_id: null,
  model_version: 1,
  revision: 0,
  template_id: 'bfs_flow',
  kernel_version: 'bfs_v1',
  config: {
    operation: 'bfs',
    directed: true,
    start_node_id: 'A',
    neighbor_order: 'lexicographic_by_id',
    max_steps: 200,
  },
  parameters: [
    {
      id: 'graph',
      name: '流程图',
      type: 'graph',
      value: {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' },
          { id: 'D', label: 'D' },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ],
      },
      unit: '1',
      range: { min: null, max: null, step: null },
      source_ref_ids: ['src_bfs_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
  ],
  views: ['source', 'interactive', 'runs'],
  bindings: [{ parameter_id: 'graph', view_id: 'interactive', target: 'graph' }],
  source_refs: manualDemoSourceRefs([
    {
      id: 'src_bfs_brief',
      label: '示例说明 · A→B、A→C、B→D、C→D',
      page: 1,
      excerpt: '起点 A，邻居按节点 ID 字典序入队；D 只会入队一次。',
    },
  ]),
  validation_profile: 'bfs_flow_v1_full',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const BUDGET_EXAMPLE: KnowledgeObject = {
  schema_version: '0.2',
  object_id: 'obj_example_budget_compare',
  title: '办公推演：两个方案的成本对比',
  material_id: null,
  model_version: 1,
  revision: 0,
  template_id: 'budget_compare',
  kernel_version: 'budget_v1',
  config: {
    operation: 'compare_two_plans',
    scenarios: ['plan_a', 'plan_b'],
    budget_limit_parameter_id: 'budget_limit',
    display_precision: 2,
    // 契约 §2.2.6 未规定 AST 的存放键名；前端兼容 config.expressions.{plan_a,plan_b}
    expressions: {
      plan_a: {
        op: 'add',
        args: [
          { op: 'constant', value: '3000' },
          {
            op: 'multiply',
            args: [{ op: 'constant', value: '80' }, { op: 'ref', parameter_id: 'people' }],
          },
        ],
      },
      plan_b: {
        op: 'add',
        args: [
          { op: 'constant', value: '6000' },
          {
            op: 'multiply',
            args: [{ op: 'constant', value: '50' }, { op: 'ref', parameter_id: 'people' }],
          },
        ],
      },
    },
  },
  parameters: [
    {
      id: 'people',
      name: '人数 n',
      type: 'integer',
      value: 80,
      unit: '人',
      range: { min: 0, max: 2000, step: 1 },
      source_ref_ids: ['src_budget_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
    {
      id: 'plan_a_name',
      name: '方案 A 名称',
      type: 'text',
      value: '方案A',
      unit: '1',
      range: { min: null, max: null, step: null },
      source_ref_ids: ['src_budget_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
    {
      id: 'plan_b_name',
      name: '方案 B 名称',
      type: 'text',
      value: '方案B',
      unit: '1',
      range: { min: null, max: null, step: null },
      source_ref_ids: ['src_budget_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
    {
      id: 'budget_limit',
      name: '预算上限',
      type: 'decimal',
      value: '10000',
      unit: '元',
      range: { min: null, max: null, step: null, min_decimal: '0', max_decimal: '1000000' },
      source_ref_ids: ['src_budget_brief'],
      provenance: 'manual_demo',
      editable: true,
    },
  ],
  views: ['source', 'interactive', 'runs'],
  bindings: [
    { parameter_id: 'people', view_id: 'interactive', target: 'people' },
    { parameter_id: 'budget_limit', view_id: 'interactive', target: 'budget_line' },
  ],
  source_refs: manualDemoSourceRefs([
    {
      id: 'src_budget_brief',
      label: '示例说明 · 3000+80n 与 6000+50n',
      page: 1,
      excerpt: '人数 n=80 时两方案金额接近；n=100 时二者相等。',
    },
  ]),
  validation_profile: 'budget_compare_v1_full',
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

const BUILT_IN_EXAMPLES: readonly KnowledgeObject[] = [
  MATRIX_EXAMPLE,
  FORCE_EXAMPLE,
  BFS_EXAMPLE,
  BUDGET_EXAMPLE,
];

/** `example_id` ↔ 模板 的映射（与 §2.2.7 TemplateDescriptor.example_id 对应） */
const EXAMPLE_IDS: Record<string, TemplateId> = {
  example_matrix_2d: 'matrix_2d',
  example_force_2d: 'force_2d',
  example_bfs_flow: 'bfs_flow',
  example_budget_compare: 'budget_compare',
};

const TEMPLATE_META: Record<
  TemplateId,
  {
    name: string;
    scenario_slug: string;
    kernel_version: string;
    validation_profile: string;
    limits: Record<string, string>;
  }
> = {
  matrix_2d: {
    name: '空间与矩阵',
    scenario_slug: 'matrix',
    kernel_version: 'linear_v1',
    validation_profile: 'matrix_2d_v1_full',
    limits: { matrix_elements: '−3 ~ 3，步长 0.1', dimension: '2×2 实矩阵' },
  },
  force_2d: {
    name: '力与向量',
    scenario_slug: 'force',
    kernel_version: 'force_v1',
    validation_profile: 'force_2d_v1_full',
    limits: { force_count: '2 ~ 4 个共点力', magnitude: '0 ~ 1000 N', angle: '0 ~ 360°' },
  },
  bfs_flow: {
    name: '计算机过程',
    scenario_slug: 'bfs',
    kernel_version: 'bfs_v1',
    validation_profile: 'bfs_flow_v1_full',
    limits: { nodes: '≤ 20', edges: '≤ 40', max_steps: '≤ 200' },
  },
  budget_compare: {
    name: '办公推演',
    scenario_slug: 'budget',
    kernel_version: 'budget_v1',
    validation_profile: 'budget_compare_v1_full',
    limits: { people: '0 ~ 2000 的整数', budget_limit: '0 ~ 1000000 的整数' },
  },
};

/* -------------------------------------------------------------------------- */
/* 材料与幻灯片（降级数据）                                                   */
/* -------------------------------------------------------------------------- */

function buildSlide(
  pageNo: number,
  title: string,
  paragraphs: readonly string[],
  excerpt: string,
): SlidePage {
  return {
    page_no: pageNo,
    title,
    paragraphs: [...paragraphs],
    elements: [
      {
        element_id: `el_${pageNo}_title`,
        kind: 'text',
        name: `标题 ${pageNo}`,
        bbox: { x: 838200, y: 365125, w: 10515600, h: 1325563 },
        text: title,
        asset_id: null,
      },
      {
        element_id: `el_${pageNo}_body`,
        kind: 'text',
        name: `正文 ${pageNo}`,
        bbox: { x: 838200, y: 1825625, w: 10515600, h: 4351338 },
        text: paragraphs.join('\n'),
        asset_id: null,
      },
    ],
    excerpt,
    image_url: null,
  };
}

const FALLBACK_SLIDES: SlidePage[] = [
  buildSlide(6, '三条向量，各去哪了', ['把变换看成对每个向量的搬运。'], '三条向量，各去哪了'),
  buildSlide(
    9,
    '矩阵的每一列是一个基向量的去向',
    ['第一列是 i 的去向，第二列是 j 的去向。'],
    '矩阵的每一列是一个基向量的去向',
  ),
  buildSlide(10, '为什么换个顺序结果就不一样', ['先 A 后 B 与先 B 后 A 一般不同。'], '为什么换个顺序结果就不一样'),
  buildSlide(14, '圆变成椭圆：SVD 的三步', ['旋转、拉伸、再旋转。'], '圆变成椭圆：SVD 的三步'),
  buildSlide(18, '一块小方格怎样改变', ['面积被 det 缩放。'], '一块小方格怎样改变'),
];

/**
 * 构造 MaterialSummary。
 * `extras` 承载 §2.2.7 向后兼容追加的可选字段（`template_id` / `run_count`）：
 * 这里只是初值，列表与详情返回时由 `summarizeRecord` 按实际 mock 运行记录重算。
 */
function toSummary(
  record: {
    materialId: string;
    title: string;
    status: MaterialSummary['status'];
    pageCount: number;
    objectCount: number;
    createdAt: string;
  },
  extras?: { template_id?: TemplateId; run_count?: number },
): MaterialSummary {
  return {
    material_id: record.materialId,
    title: record.title,
    status: record.status,
    page_count: record.pageCount,
    created_at: record.createdAt,
    expires_at: nowIso(24 * HOUR_MS),
    object_count: record.objectCount,
    ...(extras?.template_id === undefined ? {} : { template_id: extras.template_id }),
    run_count: extras?.run_count ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Mock 状态                                                                  */
/* -------------------------------------------------------------------------- */

interface MockMaterialRecord {
  summary: MaterialSummary;
  slides: SlidePage[];
  objects: KnowledgeObject[];
  candidates: CandidateObject[];
  jobId: string | null;
}

interface MockJobRecord {
  job: JobStatus;
  /** 已推进的步数（getJob 每次调用推进一步，awaiting_confirmation 处暂停） */
  ticks: number;
}

const JOB_SEQUENCE: readonly JobStage[] = [
  'queued',
  'parsing',
  'rendering',
  'extracting',
  'awaiting_confirmation',
  'compiling',
  'validating',
  'ready',
];

function stageIndex(stage: JobStage): number {
  const index = JOB_SEQUENCE.indexOf(stage);
  return index === -1 ? 0 : index;
}

/* -------------------------------------------------------------------------- */
/* fixture → 领域对象                                                        */
/* -------------------------------------------------------------------------- */

interface ExampleIndexEntry {
  exampleId: string;
  templateId: TemplateId;
  file: string;
  name: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** iSpec 参数值只允许标量（与后端持久化约束一致）。 */
function isISpecScalar(value: unknown): value is ISpecScalar {
  return (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * 收窄一组参数值：任何一条非标量都返回 `null`（调用方按 422 处理）。
 * 与后端"整体拒绝、不做部分保存"保持一致，避免界面以为保存了一半。
 */
function normalizeISpecValues(raw: unknown): Record<string, ISpecScalar> | null {
  if (!isRecord(raw)) return null;
  const result: Record<string, ISpecScalar> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === '' || !isISpecScalar(value)) return null;
    result[key] = value;
  }
  return result;
}

/** 读取 fixtures/examples/index.json；缺失或不合法时返回空数组（降级为内置数据）。 */
async function loadExampleIndex(): Promise<ExampleIndexEntry[]> {
  const rawIndex = await readFixture('examples/index.json');
  let list: unknown[] | null = null;
  if (Array.isArray(rawIndex)) list = rawIndex;
  else if (isRecord(rawIndex) && Array.isArray(rawIndex['examples'])) list = rawIndex['examples'];
  if (list === null) return [];
  const entries: ExampleIndexEntry[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const exampleId = item['example_id'];
    const templateId = item['template_id'];
    if (typeof exampleId !== 'string' || !isTemplateId(templateId)) continue;
    const file = typeof item['file'] === 'string' ? item['file'] : templateId + '.json';
    const name = typeof item['name'] === 'string' ? item['name'] : null;
    entries.push({ exampleId, templateId, file, name });
  }
  return entries;
}

/** example_id 兜底：fixtures 缺失时按白名单生成 example_{template_id}。 */
function fallbackExampleId(templateId: TemplateId): string {
  for (const [id, mapped] of Object.entries(EXAMPLE_IDS)) {
    if (mapped === templateId) return id;
  }
  return 'example_' + templateId;
}

function extractObjects(raw: unknown): KnowledgeObject[] {
  if (isKnowledgeObject(raw)) return [raw];
  if (Array.isArray(raw)) {
    const collected: KnowledgeObject[] = [];
    for (const item of raw) {
      if (isKnowledgeObject(item)) {
        collected.push(item);
        continue;
      }
      if (typeof item === 'object' && item !== null) {
        const candidate = (item as Record<string, unknown>)['object'];
        if (isKnowledgeObject(candidate)) collected.push(candidate);
      }
    }
    return collected;
  }
  if (typeof raw === 'object' && raw !== null) {
    const container = raw as Record<string, unknown>;
    for (const key of ['objects', 'items', 'examples']) {
      const nested = container[key];
      if (nested !== undefined) {
        const collected = extractObjects(nested);
        if (collected.length > 0) return collected;
      }
    }
    const single = container['object'];
    if (isKnowledgeObject(single)) return [single];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* 检查报告                                                                   */
/* -------------------------------------------------------------------------- */

function buildReport(
  object: KnowledgeObject,
  modelVersion: number,
  revision: number,
  goldenNote: string,
): ValidationReport {
  const items: CheckItem[] = [
    {
      check_id: `${object.template_id}_frozen_input`,
      title: '校验输入与对象版本一致',
      status: 'pass',
      expected: `model_version=${modelVersion}, revision=${revision}`,
      actual: `model_version=${object.model_version}, revision=${object.revision}`,
      detail: null,
    },
    {
      check_id: `${object.template_id}_recompute`,
      title: '独立实现重算与内核一致',
      status: 'pass',
      expected: goldenNote,
      actual: goldenNote,
      detail: null,
    },
    {
      check_id: `${object.template_id}_out_of_scope`,
      title: '首版范围外的输入',
      status: 'not_covered',
      expected: '—',
      actual: '—',
      detail: '非方阵矩阵 / 三维变换 / 运动与碰撞 / 通用程序执行不在首版范围',
    },
  ];
  return {
    report_id: `mock-report-${nextRequestId()}`,
    object_id: object.object_id,
    model_version: modelVersion,
    revision,
    kernel_version: object.kernel_version,
    validation_profile: object.validation_profile,
    items,
    summary: { pass: 2, fail: 0, not_covered: 1 },
    is_stale: modelVersion !== object.model_version || revision !== object.revision,
    created_at: nowIso(),
  };
}

/* -------------------------------------------------------------------------- */
/* C-WEBAPI@1 追加：mock 账号演示态（纯内存，不落任何持久化存储）               */
/* -------------------------------------------------------------------------- */

/**
 * 演示账号（**只用于演示，不是真实凭据**）。
 * T7 的「演示模式」提示可直接引用这些常量，避免两处文案漂移。
 */
export const MOCK_DEMO_EMAIL = 'demo@xiangsheng.local';
export const MOCK_DEMO_USERNAME = 'demo';
export const MOCK_DEMO_PASSWORD = 'xiangsheng-demo-2026';

/** 与后端密码策略保持一致（演示模式也给出同样的字段错误）。 */
const MOCK_MIN_PASSWORD_LENGTH = 8;
const MOCK_MAX_PASSWORD_LENGTH = 128;

/** 单个演示账号：密码只留在内存里做等值比较，绝不打印、绝不持久化。 */
interface MockAccountRecord {
  user: AuthUser;
  password: string;
  csrfToken: string;
  profile: UserProfile;
}

/** 演示模式的默认资料（与后端默认值一致）。 */
function defaultMockProfile(): UserProfile {
  return {
    bio: '',
    occupation: '',
    school: '',
    phone: '',
    interests: [],
    preferred_subject: '',
    default_entry: 'space',
    updated_at: nowIso(),
  };
}

/** 规范化比较键：与后端 `identifier = display.casefold()` 同语义（JS 用 toLowerCase）。 */
function mockAccountKey(email: string): string {
  return email.trim().toLowerCase();
}

function mockUsernameKey(username: string): string {
  return username.trim().toLowerCase();
}

const MOCK_DEMO_ACCOUNT_KEY = mockAccountKey(MOCK_DEMO_EMAIL);

/**
 * 内存态账号表：模块级 → **刷新页面即重置**（R11-4：不写 Cookie / localStorage /
 * sessionStorage）。预置演示账号，便于 `VITE_USE_MOCK=true` 时直接演示登录。
 * 邮箱表与用户名表指向同一条记录，登录时两种标识都可命中。
 */
const mockAccounts = new Map<string, MockAccountRecord>();
const mockAccountsByUsername = new Map<string, MockAccountRecord>();

/* 演示模式的验证码：固定 6 位数字，不真正发邮件；仅记录发送时间用于重发节流。 */
const MOCK_REGISTER_CODE = '123456';
const MOCK_CODE_TTL_SECONDS = 300;
const MOCK_CODE_RESEND_SECONDS = 60;
const mockCodeSentAt = new Map<string, number>();

const DEMO_ACCOUNT: MockAccountRecord = {
  user: {
    user_id: 'usr_demo00000000000000000000000001',
    username: MOCK_DEMO_USERNAME,
    email: MOCK_DEMO_EMAIL,
    display_name: '演示用户',
    status: 'active',
    created_at: CREATED_AT,
    email_verification: 'disabled_development',
    avatar_url: null,
  },
  password: MOCK_DEMO_PASSWORD,
  csrfToken: '',
  profile: defaultMockProfile(),
};
mockAccounts.set(MOCK_DEMO_ACCOUNT_KEY, DEMO_ACCOUNT);
mockAccountsByUsername.set(mockUsernameKey(MOCK_DEMO_USERNAME), DEMO_ACCOUNT);

/** 当前演示登录态；null 表示未登录。 */
let mockCurrentUser: { accountKey: string; csrfToken: string; idleExpiresAt: string } | null = null;

/** 当前登录账号的内存记录；未登录返回 null。 */
function mockCurrentAccount(): MockAccountRecord | null {
  if (mockCurrentUser === null) return null;
  return mockAccounts.get(mockCurrentUser.accountKey) ?? null;
}

function mockRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* -------------------------------------------------------------------------- */
/* 客户端实现                                                                 */
/* -------------------------------------------------------------------------- */

export function createMockClient(options: MockClientOptions): ApiClient {
  const { makeError } = options;

  // ---- 会话 ----------------------------------------------------------------
  const session: SessionInfo = {
    session_id: 'mock-session-local',
    expires_at: nowIso(24 * HOUR_MS),
    csrf_token: 'mock-csrf-token',
    retention_hours: 24,
  };

  // ---- 材料 / 任务 ---------------------------------------------------------
  const materials = new Map<string, MockMaterialRecord>();
  const jobs = new Map<string, MockJobRecord>();
  const runs = new Map<string, RunSnapshot[]>();
  const reports = new Map<string, ValidationReport[]>();
  /**
   * 区域确认/纠正的离线存储：内存 Map 为权威，localStorage 兜底跨刷新保留。
   * 形状与真实后端的 `data/regions/<material_id>.json` 一致（只存用户改过的键），
   * 这样 mock/HTTP 两种模式切换时工作台读到的是同一份语义。
   */
  const regionOverrides = new Map<string, Map<string, StoredRegionOverride>>();
  let regionOverridesLoaded = false;
  /**
   * iSpec 参数值的离线存储（§10.1 第 5 步）：`materialId -> objectId -> 桶`。
   * 与真实后端 `data/ispec-values/<material_id>.json` 同构，因此 mock / HTTP
   * 两种模式切换时，页面读到的是同一份语义（桶级 `updated_at` + 标量值）。
   */
  const ispecValues = new Map<string, Map<string, StoredISpecValues>>();
  let ispecValuesLoaded = false;
  /**
   * 离线发布快照（P2-10 mock）。
   *
   * mock 没有后端 `shares` 表，这里用内存 Map 模拟"发布即冻结"：`publishMaterial`
   * 存一份快照，`getShare` 只读这份副本；撤销即删除。刷新页面后丢失，
   * 与 mock 的其它会话内数据一致。
   */
  const publishedShares = new Map<string, { materialId: string; snapshot: ShareSnapshot }>();

  /** 材料别名 → 真实 material_id（旧链接 matrix-courseware 仍可用） */
  const materialAliases = new Map<string, string>([[COURSEWARE_ALIAS_ID, COURSEWARE_MATERIAL_ID]]);
  /** 对象别名 → 真实 object_id（降级内置的 course_matrix_2d 兼容真实产物） */
  const objectAliases = new Map<string, string>();

  const coursewareId = COURSEWARE_MATERIAL_ID;
  materials.set(coursewareId, {
    summary: toSummary(
      {
        materialId: coursewareId,
        title: '用空间视角理解矩阵运算',
        status: 'ready',
        pageCount: 24,
        objectCount: 1,
        createdAt: CREATED_AT,
      },
      // 课程材料唯一对象是 matrix_2d；运行数由 summarizeRecord 按实际记录重算
      { template_id: 'matrix_2d', run_count: 0 },
    ),
    slides: cloneData(FALLBACK_SLIDES),
    objects: [
      {
        ...cloneData(MATRIX_EXAMPLE),
        object_id: 'course_matrix_2d',
        title: '用空间视角理解矩阵运算 · 矩阵变换',
        material_id: coursewareId,
        config: {
          operation: 'matrix_compose',
          matrix_parameter_id: 'matrix_A',
          second_matrix_parameter_id: 'matrix_B',
          compose_order: 'A_then_B',
          angle_unit: 'deg',
        },
        parameters: [
          {
            id: 'matrix_A',
            name: '矩阵 A',
            type: 'matrix2',
            value: [
              [2, 1],
              [1, 2],
            ],
            unit: '1',
            range: { min: -3, max: 3, step: 0.1 },
            source_ref_ids: ['src_s9'],
            provenance: 'original',
            editable: true,
          },
          {
            id: 'matrix_B',
            name: '矩阵 B',
            type: 'matrix2',
            value: [
              [1, 1],
              [0, 1],
            ],
            unit: '1',
            range: { min: -3, max: 3, step: 0.1 },
            source_ref_ids: ['src_s10'],
            provenance: 'original',
            editable: true,
          },
          {
            id: 'vector_x',
            name: '输入向量 x',
            type: 'vector2',
            value: [1, 1],
            unit: '1',
            range: { min: -3, max: 3, step: 0.1 },
            source_ref_ids: ['src_s6'],
            provenance: 'original',
            editable: true,
          },
        ],
        source_refs: [
          {
            id: 'src_s6',
            provenance: 'original',
            label: '第 6 页 · 三条向量，各去哪了',
            material_id: coursewareId,
            page: 6,
            element_id: null,
            bbox: null,
            excerpt: '三条向量，各去哪了',
          },
          {
            id: 'src_s9',
            provenance: 'original',
            label: '第 9 页 · 每一列是一个基向量的去向',
            material_id: coursewareId,
            page: 9,
            element_id: null,
            bbox: null,
            excerpt: '矩阵的每一列是一个基向量的去向',
          },
          {
            id: 'src_s10',
            provenance: 'original',
            label: '第 10 页 · 为什么换个顺序结果就不一样',
            material_id: coursewareId,
            page: 10,
            element_id: null,
            bbox: null,
            excerpt: '为什么换个顺序结果就不一样',
          },
          {
            id: 'src_s14',
            provenance: 'original',
            label: '第 14 页 · 圆变成椭圆：SVD 的三步',
            material_id: coursewareId,
            page: 14,
            element_id: null,
            bbox: null,
            excerpt: '圆变成椭圆：SVD 的三步',
          },
          {
            id: 'src_s18',
            provenance: 'original',
            label: '第 18 页 · 一块小方格怎样改变',
            material_id: coursewareId,
            page: 18,
            element_id: null,
            bbox: null,
            excerpt: '一块小方格怎样改变',
          },
        ],
      },
    ],
    candidates: [],
    jobId: null,
  });

  /**
   * 列表/详情返回时的派生汇总：补 §2.2.7 向后兼容追加的可选字段。
   * - `template_id` 取该材料首个对象的模板（无对象时不填，保持"可能缺失"的语义）；
   * - `run_count` 按当前 mock 运行记录实时统计，避免出现与 RunsPanel 不一致的数字。
   */
  /**
   * 优先加载 T11 的真实解析产物（24 页 / 471 元素 / 35 图）。
   * 失败时保留内置 5 页降级数据并写 mockDiagnostics —— 绝不抛未捕获异常。
   * 只执行一次，后续方法都 await 同一个 Promise。
   */
  async function loadCoursewareFixtures(): Promise<void> {
    const [materialRaw, slidesRaw, objectsRaw] = await Promise.all([
      readFixture('materials/matrix-courseware/material.json'),
      readFixture('materials/matrix-courseware/slides.json'),
      readFixture('materials/matrix-courseware/objects.json'),
    ]);

    const materialFile = parseMaterialFile(materialRaw);
    const pages = parseSlidesFile(slidesRaw);
    if (materialFile === null || pages === null) {
      rememberDiagnostic(
        'T11 课程材料产物不可用（material.json / slides.json 缺失或不合法），已降级为内置 5 页数据',
      );
      return;
    }

    const parsedObjects = parseObjectsFile(objectsRaw);
    const fallbackRecord = materials.get(COURSEWARE_MATERIAL_ID);
    const objects = parsedObjects.length > 0 ? parsedObjects : (fallbackRecord?.objects ?? []);
    if (parsedObjects.length === 0) {
      rememberDiagnostic('T11 objects.json 不可用或为空，课程材料沿用内置 matrix_2d 对象');
    }
    if (fallbackRecord === undefined) {
      rememberDiagnostic('内置课程材料缺失，使用 T11 产物重建');
    }

    const firstObject = objects[0];
    materials.set(COURSEWARE_MATERIAL_ID, {
      summary: toSummary(
        {
          materialId: COURSEWARE_MATERIAL_ID,
          title: materialFile.title,
          status: materialFile.status,
          pageCount: materialFile.pageCount,
          objectCount: objects.length,
          createdAt: fallbackRecord?.summary.created_at ?? CREATED_AT,
        },
        {
          ...(firstObject === undefined ? {} : { template_id: firstObject.template_id }),
          run_count: 0,
        },
      ),
      slides: pages,
      objects,
      candidates: [],
      jobId: null,
    });

    if (firstObject !== undefined) {
      // 工作台旧链接可能用 course_matrix_2d；别名指向产物里的真实 object_id
      objectAliases.set(LEGACY_COURSEWARE_OBJECT_ID, firstObject.object_id);
    }
    rememberDiagnostic(
      'T11 课程材料已加载：' +
        String(pages.length) +
        ' 页 / ' +
        String(objects.length) +
        ' 个对象（material_id=' +
        materialFile.materialId +
        '）',
    );
  }

  const STRANGER_MATERIAL_ID = 'mat_stranger_chart';

  /**
   * 陌生材料演示：证明「非矩阵 PPT 也能出交互」。
   * 产物由 `fixtures/materials/stranger-chart/`（真实解析 + iSpec 生成）提供，
   * 这里只负责把材料登记进列表，iSpec 由 `components/reader/specData.ts` 读取。
   */
  async function loadStrangerFixture(): Promise<void> {
    const [materialRaw, slidesRaw] = await Promise.all([
      readFixture('materials/mat_stranger_chart/material.json'),
      readFixture('materials/mat_stranger_chart/slides.json'),
    ]);
    const materialFile = parseMaterialFile(materialRaw);
    const pages = parseSlidesFile(slidesRaw);
    if (materialFile === null || pages === null) {
      rememberDiagnostic('陌生材料演示产物不可用（mat_stranger_chart），已跳过');
      return;
    }
    materials.set(STRANGER_MATERIAL_ID, {
      summary: toSummary({
        materialId: STRANGER_MATERIAL_ID,
        title: materialFile.title,
        status: materialFile.status,
        pageCount: materialFile.pageCount,
        objectCount: 0,
        createdAt: CREATED_AT,
      }),
      slides: pages,
      objects: [],
      candidates: [],
      jobId: null,
    });
    rememberDiagnostic(
      '陌生材料演示已加载：' + String(pages.length) + ' 页（非矩阵 PPT，含原生图表与表格）',
    );
  }

  let coursewareLoadPromise: Promise<void> | null = null;

  /** 幂等的 fixtures 初始化；任何异常都在内部吞掉并留下诊断。 */
  function ensureFixturesLoaded(): Promise<void> {
    if (coursewareLoadPromise === null) {
      coursewareLoadPromise = loadCoursewareFixtures()
        .then(() => loadStrangerFixture())
        .catch((error: unknown) => {
        rememberDiagnostic(
          'T11 课程材料加载异常，已降级为内置 5 页数据：' +
            (error instanceof Error ? error.message : String(error)),
        );
      });
    }
    return coursewareLoadPromise;
  }

  function summarizeRecord(record: MockMaterialRecord): MaterialSummary {
    const firstObject = record.objects[0];
    let runCount = 0;
    for (const object of record.objects) {
      runCount += runs.get(object.object_id)?.length ?? 0;
    }
    return {
      ...cloneData(record.summary),
      ...(firstObject === undefined ? {} : { template_id: firstObject.template_id }),
      run_count: runCount,
    };
  }

  function requireMaterial(materialId: string): MockMaterialRecord {
    const resolvedId = materialAliases.get(materialId) ?? materialId;
    const record = materials.get(resolvedId);
    if (record === undefined) {
      // 归属校验失败与不存在统一 404（D2），对外不区分
      throw makeError({
        code: 'SESSION_EXPIRED',
        message: '资源不可用',
        retryable: false,
        status: 404,
        requestId: nextRequestId(),
      });
    }
    return record;
  }

  function findObject(objectId: string): { object: KnowledgeObject; materialId: string | null } {
    const aliasTarget = objectAliases.get(objectId);
    const candidateIds = aliasTarget === undefined ? [objectId] : [aliasTarget, objectId];
    for (const candidateId of candidateIds) {
      for (const record of materials.values()) {
        const found = record.objects.find((item) => item.object_id === candidateId);
        if (found !== undefined) return { object: found, materialId: record.summary.material_id };
      }
      const builtIn = BUILT_IN_EXAMPLES.find((item) => item.object_id === candidateId);
      if (builtIn !== undefined) return { object: builtIn, materialId: null };
    }
    throw makeError({
      code: 'SESSION_EXPIRED',
      message: '资源不可用',
      retryable: false,
      status: 404,
      requestId: nextRequestId(),
    });
  }

  function reportsOf(objectId: string): ValidationReport[] {
    const existing = reports.get(objectId);
    if (existing !== undefined) return existing;
    const created: ValidationReport[] = [];
    reports.set(objectId, created);
    return created;
  }

  function runsOf(objectId: string): RunSnapshot[] {
    const existing = runs.get(objectId);
    if (existing !== undefined) return existing;
    const created: RunSnapshot[] = [];
    runs.set(objectId, created);
    return created;
  }

  /* ---------------- 区域确认/纠正（P2 追加端点的离线实现） ---------------- */

  /**
   * 首次访问时把 localStorage 里的覆盖载入内存；损坏数据静默丢弃。
   * 内存 Map 是权威：同一会话内连续 PATCH 不会因写存储失败而丢数据。
   */
  function loadRegionOverridesFromStorage(): void {
    if (regionOverridesLoaded) return;
    regionOverridesLoaded = true;
    if (typeof window === 'undefined' || window.localStorage === undefined) return;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(REGION_OVERRIDE_STORAGE_KEY);
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return;
      Object.keys(parsed).forEach((materialId) => {
        const bucket = parsed[materialId];
        if (!isRecord(bucket)) return;
        const entries = new Map<string, StoredRegionOverride>();
        Object.keys(bucket).forEach((regionId) => {
          const entry = bucket[regionId];
          if (!isRecord(entry)) return;
          const status: RegionConfirmStatus | null =
            entry.status === 'confirmed' || entry.status === 'static_only' ? entry.status : null;
          entries.set(regionId, {
            status,
            parameter_overrides: isRecord(entry.parameter_overrides) ? entry.parameter_overrides : {},
            note: typeof entry.note === 'string' ? entry.note : null,
            updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : nowIso(),
          });
        });
        regionOverrides.set(materialId, entries);
      });
    } catch {
      // 存储里是坏 JSON：等同于没有覆盖，不影响阅读
    }
  }

  function persistRegionOverrides(): void {
    if (typeof window === 'undefined' || window.localStorage === undefined) return;
    const payload: Record<string, Record<string, StoredRegionOverride>> = {};
    regionOverrides.forEach((entries, materialId) => {
      if (entries.size === 0) return;
      const bucket: Record<string, StoredRegionOverride> = {};
      entries.forEach((entry, regionId) => {
        bucket[regionId] = entry;
      });
      payload[materialId] = bucket;
    });
    try {
      window.localStorage.setItem(REGION_OVERRIDE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式 / 配额不足：内存 Map 仍然有效，不影响当前页面
    }
  }

  function overridesOf(materialId: string): Map<string, StoredRegionOverride> {
    loadRegionOverridesFromStorage();
    const existing = regionOverrides.get(materialId);
    if (existing !== undefined) return existing;
    const created = new Map<string, StoredRegionOverride>();
    regionOverrides.set(materialId, created);
    return created;
  }

  /* ---------------- iSpec 参数值（§10.1 第 5 步的离线实现） ---------------- */

  /**
   * 首次访问时把 localStorage 里的参数值载入内存；坏数据静默丢弃。
   * 内存 Map 是权威：写存储失败（隐私模式 / 配额）不影响当前页面。
   */
  function loadISpecValuesFromStorage(): void {
    if (ispecValuesLoaded) return;
    ispecValuesLoaded = true;
    if (typeof window === 'undefined' || window.localStorage === undefined) return;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(ISPEC_VALUES_STORAGE_KEY);
    } catch {
      return;
    }
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    for (const materialId of Object.keys(parsed)) {
      const materialBucket = parsed[materialId];
      if (!isRecord(materialBucket)) continue;
      const entries = new Map<string, StoredISpecValues>();
      for (const objectId of Object.keys(materialBucket)) {
        const entry = materialBucket[objectId];
        if (!isRecord(entry)) continue;
        const values = normalizeISpecValues(entry.values);
        if (values === null) continue;
        entries.set(objectId, {
          values,
          updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : null,
        });
      }
      ispecValues.set(materialId, entries);
    }
  }

  function persistISpecValues(): void {
    if (typeof window === 'undefined' || window.localStorage === undefined) return;
    const payload: Record<string, Record<string, StoredISpecValues>> = {};
    ispecValues.forEach((entries, materialId) => {
      if (entries.size === 0) return;
      const bucket: Record<string, StoredISpecValues> = {};
      entries.forEach((entry, objectId) => {
        bucket[objectId] = entry;
      });
      payload[materialId] = bucket;
    });
    try {
      window.localStorage.setItem(ISPEC_VALUES_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式 / 配额不足：内存 Map 仍然有效，只是刷新后丢失
    }
  }

  function ispecValuesOf(materialId: string): Map<string, StoredISpecValues> {
    loadISpecValuesFromStorage();
    const existing = ispecValues.get(materialId);
    if (existing !== undefined) return existing;
    const created = new Map<string, StoredISpecValues>();
    ispecValues.set(materialId, created);
    return created;
  }

  /** 对象归属校验：共享池桶总是放行；其余必须属于该材料。 */
  function requireISpecObject(record: MockMaterialRecord, objectId: string): void {
    if (objectId === SHARED_VALUES_OBJECT_ID) return;
    if (record.objects.some((object) => object.object_id === objectId)) return;
    throw makeError({
      code: 'MISSING_FIELD',
      message: '该 iSpec 不存在或已被重新识别，请刷新页面后重试',
      retryable: false,
      status: 404,
      requestId: nextRequestId(),
      details: { object_id: objectId },
    });
  }

  let regionBaselinePromise: Promise<MockRegionBaseline[]> | null = null;

  function normalizeRegionStatus(value: unknown): MaterialRegionStatus {
    return value === 'confirmed' || value === 'static_only' || value === 'unsupported'
      ? value
      : 'pending';
  }

  /** 基线区域与真实后端同源：课程材料 `regions.json`（只读，绝不改写）。 */
  function loadRegionBaseline(): Promise<MockRegionBaseline[]> {
    if (regionBaselinePromise === null) {
      regionBaselinePromise = readFixture('materials/matrix-courseware/regions.json').then((raw) => {
        const list = Array.isArray(raw)
          ? raw
          : isRecord(raw) && Array.isArray(raw.regions)
            ? raw.regions
            : [];
        return list.reduce<MockRegionBaseline[]>((acc, item) => {
          if (!isRecord(item)) return acc;
          if (typeof item.region_id !== 'string' || typeof item.page !== 'number') return acc;
          acc.push({
            region_id: item.region_id,
            page: item.page,
            script_id: typeof item.script_id === 'string' ? item.script_id : '',
            status: normalizeRegionStatus(item.status),
            original_params: isRecord(item.original_params) ? item.original_params : {},
          });
          return acc;
        }, []);
      });
    }
    return regionBaselinePromise;
  }

  function toMaterialRegion(
    baseline: MockRegionBaseline,
    materialId: string,
    entry: StoredRegionOverride | undefined,
  ): MaterialRegion {
    const overrides = entry === undefined ? {} : entry.parameter_overrides;
    return {
      region_id: baseline.region_id,
      material_id: materialId,
      page: baseline.page,
      script_id: baseline.script_id,
      status: entry === undefined || entry.status === null ? baseline.status : entry.status,
      original_params: { ...baseline.original_params, ...overrides },
      parameter_overrides: overrides,
      has_override: entry !== undefined,
      note: entry === undefined ? null : entry.note,
      updated_at: entry === undefined ? null : entry.updated_at,
      fact_signature: null,
    };
  }

  return {
    mode: 'mock',


    async createSession() {
      return { ...session };
    },

    async getCurrentSession() {
      return { ...session };
    },

    async listTemplates() {
      const entries = await loadExampleIndex();
      const templateIds = Object.keys(TEMPLATE_META) as TemplateId[];
      return templateIds.map((templateId) => {
        const meta = TEMPLATE_META[templateId];
        const entry = entries.find((item) => item.templateId === templateId);
        return {
          template_id: templateId,
          name: entry?.name ?? meta.name,
          scenario_slug: meta.scenario_slug,
          kernel_version: meta.kernel_version,
          validation_profile: meta.validation_profile,
          example_id: entry?.exampleId ?? fallbackExampleId(templateId),
          limits: { ...meta.limits },
          schema_path: '/api/v1/templates/' + templateId + '/schema',
        };
      });
    },

    async cloneExample(exampleId) {
      const entries = await loadExampleIndex();
      const matched = entries.find((item) => item.exampleId === exampleId) ?? null;
      const templateId = matched?.templateId ?? EXAMPLE_IDS[exampleId] ?? null;

      // 1) 按 index.json 的 file 读取示例对象（T1 产物，权威路径）
      let exampleSource: KnowledgeObject | null = null;
      if (matched !== null) {
        const fromFile = extractObjects(await readFixture('examples/' + matched.file));
        exampleSource = fromFile[0] ?? null;
        if (exampleSource !== null) {
          rememberDiagnostic('示例来自 fixtures/examples/' + matched.file);
        }
      }
      // 2) 退化为按模板名读 examples/{template_id}.json
      if (exampleSource === null && templateId !== null) {
        const fromTemplateFile = extractObjects(
          await readFixture('examples/' + templateId + '.json'),
        );
        exampleSource = fromTemplateFile[0] ?? null;
      }
      // 3) 最终退化为内置示例
      if (exampleSource === null) {
        exampleSource =
          BUILT_IN_EXAMPLES.find((item) => item.object_id === exampleId) ??
          (templateId === null
            ? null
            : BUILT_IN_EXAMPLES.find((item) => item.template_id === templateId) ?? null);
      }

      if (exampleSource === null) {
        throw makeError({
          code: 'UNSUPPORTED_TEMPLATE',
          message: '示例 ' + exampleId + ' 不在白名单模板内，已回退到静态阅读',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }

      const materialId = 'mock-example-' + exampleId + '-' + Date.now().toString(36);
      const cloned: KnowledgeObject = {
        ...cloneData(exampleSource),
        material_id: materialId,
        // 示例副本必须标注 manual_demo，不冒充用户材料解析结果（R2-AC6）
        parameters: exampleSource.parameters.map((parameter) => ({
          ...cloneData(parameter),
          provenance: 'manual_demo',
        })),
        source_refs: exampleSource.source_refs.map((reference) => ({
          ...cloneData(reference),
          provenance: 'manual_demo',
          material_id: materialId,
        })),
        revision: 0,
        updated_at: nowIso(),
      };

      materials.set(materialId, {
        summary: toSummary(
          {
            materialId,
            title: cloned.title,
            status: 'ready',
            pageCount: FALLBACK_SLIDES.length,
            objectCount: 1,
            createdAt: nowIso(),
          },
          { template_id: cloned.template_id, run_count: 0 },
        ),
        slides: cloneData(FALLBACK_SLIDES),
        objects: [cloned],
        candidates: [],
        jobId: null,
      });

      return { material_id: materialId, object_id: cloned.object_id };
    },

    async uploadMaterial(file) {
      const name = file.name.toLowerCase();
      if (!name.endsWith('.pptx') && !name.endsWith('.pdf')) {
        throw makeError({
          code: 'INVALID_FILE',
          message: '只支持 .pptx 或 .pdf 文件（不接受 ppt 宏文件或未压缩格式）',
          retryable: false,
          status: 400,
          requestId: nextRequestId(),
        });
      }
      if (file.size > 70 * 1024 * 1024) {
        throw makeError({
          code: 'LIMIT_EXCEEDED',
          message: '文件超过 70MB 上限',
          retryable: false,
          status: 413,
          requestId: nextRequestId(),
        });
      }

      const materialId = `mock-material-${Date.now().toString(36)}`;
      const jobId = `mock-job-${Date.now().toString(36)}`;
      const job: JobStatus = {
        job_id: jobId,
        material_id: materialId,
        kind: 'upload',
        stage: 'queued',
        attempt: 1,
        progress_pct: null,
        error: null,
        updated_at: nowIso(),
      };
      jobs.set(jobId, { job, ticks: 0 });
      materials.set(materialId, {
        summary: toSummary({
          materialId,
          title: file.name.replace(/\.(pptx|pdf)$/i, ''),
          status: 'processing',
          pageCount: 0,
          objectCount: 0,
          createdAt: nowIso(),
        }, { run_count: 0 }),
        slides: [],
        objects: [],
        candidates: [],
        jobId,
      });
      return { material_id: materialId, job_id: jobId };
    },

    async listMaterials(limit) {
      await ensureFixturesLoaded();
      const max = normalizeLimit(limit);
      const items = [...materials.values()]
        .map((record) => summarizeRecord(record))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, max);
      return { items, retention_expires_at: nowIso(24 * HOUR_MS) };
    },

    async getMaterial(materialId) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const jobRecord = record.jobId === null ? undefined : jobs.get(record.jobId);
      return {
        material: summarizeRecord(record),
        slides: cloneData(record.slides),
        objects: cloneData(record.objects),
        candidates: cloneData(record.candidates),
        job: jobRecord === undefined ? null : cloneData(jobRecord.job),
      };
    },

    async deleteMaterial(materialId) {
      await ensureFixturesLoaded();
      const resolvedId = materialAliases.get(materialId) ?? materialId;
      const record = requireMaterial(materialId);
      if (record.jobId !== null) jobs.delete(record.jobId);
      materials.delete(resolvedId);
      regionOverrides.delete(resolvedId);
      // iSpec 参数值随材料一起删除（与真实后端 DELETE 的落盘清理一致）。
      ispecValues.delete(resolvedId);
      // 材料删除后分享链接必须同时失效（与真实后端 DELETE 的级联一致）。
      for (const [shareId, entry] of publishedShares) {
        if (entry.materialId === resolvedId) publishedShares.delete(shareId);
      }
      persistRegionOverrides();
      persistISpecValues();
    },

    async listMaterialRegions(materialId) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const resolvedId = record.summary.material_id;
      const baseline = await loadRegionBaseline();
      const bucket = overridesOf(resolvedId);
      const response: MaterialRegionsResponse = {
        material_id: resolvedId,
        baseline_source: 'fixtures:matrix-courseware',
        page_count: record.summary.page_count,
        regions: baseline.map((item) => toMaterialRegion(item, resolvedId, bucket.get(item.region_id))),
        invalidated_region_ids: [],
      };
      return response;
    },

    async patchMaterialRegion(materialId, regionId, patch: RegionOverridePatch) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const resolvedId = record.summary.material_id;
      const baseline = await loadRegionBaseline();
      const target = baseline.find((item) => item.region_id === regionId);
      if (target === undefined) {
        // 与真实后端一致：404 + MISSING_FIELD（区域不存在/已重新识别）
        throw makeError({
          code: 'MISSING_FIELD',
          message: '区域不存在或已被重新识别，请刷新准备页后重试',
          retryable: false,
          status: 404,
          requestId: nextRequestId(),
          details: { region_id: regionId },
        });
      }
      if (
        patch.status !== undefined &&
        patch.status !== 'confirmed' &&
        patch.status !== 'static_only'
      ) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: 'status 只能取 confirmed 或 static_only',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
          details: { allowed: ['confirmed', 'static_only'] },
        });
      }

      const bucket = overridesOf(resolvedId);
      const previous = bucket.get(regionId);
      const cleared =
        patch.status === undefined &&
        patch.note === undefined &&
        patch.parameter_overrides !== undefined &&
        Object.keys(patch.parameter_overrides).length === 0;
      if (cleared) {
        bucket.delete(regionId);
      } else {
        const status: RegionConfirmStatus | null = patch.status ?? previous?.status ?? null;
        const overrides: Record<string, unknown> =
          patch.parameter_overrides ?? previous?.parameter_overrides ?? {};
        const note: string | null = patch.note ?? previous?.note ?? null;
        bucket.set(regionId, { status, parameter_overrides: overrides, note, updated_at: nowIso() });
      }
      persistRegionOverrides();

      const entry = bucket.get(regionId);
      const result: RegionOverrideResult = {
        region_id: regionId,
        status: entry === undefined || entry.status === null ? target.status : entry.status,
        parameter_overrides: entry === undefined ? {} : entry.parameter_overrides,
        note: entry === undefined ? null : entry.note,
        updated_at: entry === undefined ? null : entry.updated_at,
        fact_signature: null,
      };
      return result;
    },

    /* ---------------- iSpec 参数值（§10.1 第 5 步） ---------------- */

    async getISpecValues(materialId, objectId) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const resolvedId = record.summary.material_id;
      requireISpecObject(record, objectId);
      const entry = ispecValuesOf(resolvedId).get(objectId);
      const result: ISpecValuesRecord = {
        object_id: objectId,
        values: entry === undefined ? {} : { ...entry.values },
        updated_at: entry === undefined ? null : entry.updated_at,
      };
      return result;
    },

    async putISpecValues(materialId, objectId, values, expectedUpdatedAt) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const resolvedId = record.summary.material_id;
      requireISpecObject(record, objectId);

      const clean = normalizeISpecValues(values);
      if (clean === null) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: '参数值必须全部是标量（number / boolean / string）',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
          details: { object_id: objectId },
        });
      }

      const bucket = ispecValuesOf(resolvedId);
      const current = bucket.get(objectId);
      const currentUpdatedAt = current === undefined ? null : current.updated_at;
      if (
        typeof expectedUpdatedAt === 'string' &&
        expectedUpdatedAt !== (currentUpdatedAt ?? '')
      ) {
        throw makeError({
          code: 'VERSION_CONFLICT',
          message: '参数已在别处更新，请合并后重试',
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
          details: {
            object_id: objectId,
            current_values: current === undefined ? {} : { ...current.values },
            current_updated_at: currentUpdatedAt,
          },
        });
      }

      if (Object.keys(clean).length === 0) {
        bucket.delete(objectId);
      } else {
        bucket.set(objectId, { values: clean, updated_at: nowIso() });
      }
      persistISpecValues();

      const saved = bucket.get(objectId);
      const result: ISpecValuesResult = {
        object_id: objectId,
        values: saved === undefined ? {} : { ...saved.values },
        updated_at: saved === undefined ? null : saved.updated_at,
      };
      return result;
    },

    getMaterialAssetUrl(materialId, assetId) {
      // mock 没有受鉴权的二进制代理端点，统一返回空串让 UI 走"图片不可用"分支；
      // 原图是否存在由 SlidePage.image_url（fixtures/ppt/*.png）与 elements[].asset_id 表达。
      // 这里刻意不查 materials，避免别名解析顺序影响同步方法。
      void materialId;
      void assetId;
      return '';
    },

    async getJob(jobId) {
      await ensureFixturesLoaded();
      const record = jobs.get(jobId);
      if (record === undefined) {
        throw makeError({
          code: 'SESSION_EXPIRED',
          message: '资源不可用',
          retryable: false,
          status: 404,
          requestId: nextRequestId(),
        });
      }
      const currentIndex = stageIndex(record.job.stage);
      const atConfirmation = record.job.stage === 'awaiting_confirmation';
      const finished = record.job.stage === 'ready' || record.job.stage === 'failed';
      if (!atConfirmation && !finished) {
        const nextIndex = Math.min(currentIndex + 1, JOB_SEQUENCE.length - 1);
        const nextStage = JOB_SEQUENCE[nextIndex] ?? 'ready';
        record.job = { ...record.job, stage: nextStage, updated_at: nowIso() };
        record.ticks += 1;

        const material = materials.get(record.job.material_id);
        if (material !== undefined) {
          const status: MaterialSummary['status'] =
            nextStage === 'ready'
              ? 'ready'
              : nextStage === 'awaiting_confirmation'
                ? 'awaiting_confirmation'
                : 'processing';
          material.summary = { ...material.summary, status };
          if (nextStage === 'ready' && material.objects.length === 0) {
            // mock 解析完成后放入一个可交互对象，便于端到端演示
            material.objects = [cloneData(MATRIX_EXAMPLE)];
            material.summary = {
              ...material.summary,
              object_count: 1,
              page_count: FALLBACK_SLIDES.length,
            };
            material.slides = cloneData(FALLBACK_SLIDES);
          }
        }
      }
      return cloneData(record.job);
    },

    async retryJob(jobId) {
      await ensureFixturesLoaded();
      const record = jobs.get(jobId);
      if (record === undefined) {
        throw makeError({
          code: 'SESSION_EXPIRED',
          message: '资源不可用',
          retryable: false,
          status: 404,
          requestId: nextRequestId(),
        });
      }
      record.job = {
        ...record.job,
        stage: 'queued',
        attempt: record.job.attempt + 1,
        error: null,
        updated_at: nowIso(),
      };
      record.ticks = 0;
      return { job_id: jobId, attempt: record.job.attempt };
    },

    async getObject(objectId) {
      await ensureFixturesLoaded();
      const found = findObject(objectId);
      const storedReports = reportsOf(objectId);
      const latest = storedReports[storedReports.length - 1];
      return {
        object: cloneData(found.object),
        checks_summary: latest === undefined ? null : cloneData(latest),
      };
    },

    async updateObjectModel(objectId, expectedVersion, object) {
      await ensureFixturesLoaded();
      const found = findObject(objectId);
      if (expectedVersion !== found.object.model_version) {
        throw makeError({
          code: 'VERSION_CONFLICT',
          message: `对象已被修改：期望版本 ${expectedVersion}，当前版本 ${found.object.model_version}`,
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const stored: KnowledgeObject = {
        ...cloneData(object),
        object_id: objectId,
        model_version: found.object.model_version + 1,
        revision: 0,
        updated_at: nowIso(),
      };
      if (found.materialId !== null) {
        const record = materials.get(found.materialId);
        if (record !== undefined) {
          record.objects = record.objects.map((item) => (item.object_id === objectId ? stored : item));
        }
      }
      return { object: cloneData(stored) };
    },

    async compileObject(objectId, modelVersion) {
      await ensureFixturesLoaded();
      const found = findObject(objectId);
      if (modelVersion !== found.object.model_version) {
        throw makeError({
          code: 'VERSION_CONFLICT',
          message: `编译版本 ${modelVersion} 与当前 model_version ${found.object.model_version} 不一致`,
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const jobId = `mock-compile-${Date.now().toString(36)}`;
      const job: JobStatus = {
        job_id: jobId,
        material_id: found.materialId ?? objectId,
        kind: 'compile',
        stage: 'compiling',
        attempt: 1,
        progress_pct: null,
        error: null,
        updated_at: nowIso(),
      };
      jobs.set(jobId, { job, ticks: 0 });
      return { job_id: jobId };
    },

    async createRun(objectId, payload: CreateRunRequest) {
      await ensureFixturesLoaded();
      const found = findObject(objectId);
      if (payload.model_version !== found.object.model_version) {
        throw makeError({
          code: 'VERSION_CONFLICT',
          message: `model_version ${payload.model_version} 与当前 ${found.object.model_version} 不一致`,
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const snapshot: RunSnapshot = {
        run_id: `mock-run-${Date.now().toString(36)}`,
        object_id: objectId,
        model_version: payload.model_version,
        revision: payload.revision,
        kernel_version: found.object.kernel_version,
        input_snapshot: cloneData(payload.input_snapshot),
        // mock 不承担真值：保留客户端上传的展示结果，真实后端会用内核重算覆盖
        result: payload.result ?? null,
        validation_report: reportsOf(objectId).at(-1) ?? null,
        created_at: nowIso(),
      };
      const list = runsOf(objectId);
      list.unshift(snapshot);
      return cloneData(snapshot);
    },

    async listRuns(objectId, limit) {
      await ensureFixturesLoaded();
      findObject(objectId);
      const max = normalizeLimit(limit);
      return { items: cloneData(runsOf(objectId).slice(0, max)) };
    },

    async getRun(runId) {
      await ensureFixturesLoaded();
      for (const list of runs.values()) {
        const found = list.find((run) => run.run_id === runId);
        if (found !== undefined) return cloneData(found);
      }
      throw makeError({
        code: 'SESSION_EXPIRED',
        message: '资源不可用',
        retryable: false,
        status: 404,
        requestId: nextRequestId(),
      });
    },

    async validateObject(objectId, modelVersion, revision) {
      await ensureFixturesLoaded();
      const found = findObject(objectId);
      const golden = await readFixture(`golden/${found.object.template_id}.json`);
      const note =
        golden === null
          ? `已用内置规则复核 ${found.object.template_id} 的输入与结果`
          : `已对照 fixtures/golden/${found.object.template_id}.json 复核`;
      const report = buildReport(found.object, modelVersion, revision, note);
      reportsOf(objectId).push(report);
      return cloneData(report);
    },

    async listChecks(objectId) {
      await ensureFixturesLoaded();
      findObject(objectId);
      return { items: cloneData(reportsOf(objectId)) };
    },

    async publishMaterial(materialId, _selection) {
      await ensureFixturesLoaded();
      const record = requireMaterial(materialId);
      const resolvedId = record.summary.material_id;
      const shareId = `shr_${nextRequestId()}`;
      const pageCount = Math.max(0, Math.floor(record.summary.page_count));

      const pages: SharePageImage[] = Array.from({ length: pageCount }, (_, index) => {
        const pageNo = index + 1;
        const name = `s${String(pageNo).padStart(2, '0')}.png`;
        return {
          page_no: pageNo,
          image_url: `${fixturesRoot()}fixtures/pages/${name}`,
          erased_image_url: null,
        };
      });

      let regions: unknown[] = [];
      if (resolvedId === COURSEWARE_MATERIAL_ID) {
        const raw = await readFixture('materials/matrix-courseware/regions.json');
        const list = Array.isArray(raw)
          ? raw
          : isRecord(raw) && Array.isArray(raw['regions'])
            ? raw['regions']
            : [];
        regions = list.reduce<unknown[]>((acc, item) => {
          if (!isRecord(item)) return acc;
          const safe: Record<string, unknown> = {};
          for (const key of Object.keys(item)) {
            // 与真实后端一致：公开快照不含 material_id。
            if (key !== 'material_id') safe[key] = item[key];
          }
          acc.push(safe);
          return acc;
        }, []);
      }

      const snapshot: ShareSnapshot = {
        schema_version: 'share_snapshot_v1',
        published_at: nowIso(),
        title: record.summary.title,
        page_count: Math.max(1, pageCount),
        pages,
        regions,
        // mock 不做文档 → iSpec 合成；有区域时由 PageCanvas 承担交互。
        ispecs: [],
      };
      publishedShares.set(shareId, { materialId: resolvedId, snapshot });
      return { share_id: shareId, share_url: `/p/${shareId}` };
    },

    async revokeMaterialPublish(materialId) {
      await ensureFixturesLoaded();
      const resolvedId = requireMaterial(materialId).summary.material_id;
      let revoked = 0;
      for (const [shareId, entry] of publishedShares) {
        if (entry.materialId === resolvedId) {
          publishedShares.delete(shareId);
          revoked += 1;
        }
      }
      return { revoked, revoked_at: nowIso() };
    },

    async getShare(shareId) {
      await ensureFixturesLoaded();
      const found = publishedShares.get(shareId);
      if (found === undefined) {
        throw makeError({
          code: 'SESSION_EXPIRED',
          message: '资源不可用',
          retryable: false,
          status: 404,
          requestId: nextRequestId(),
        });
      }
      return cloneData(found.snapshot);
    },

    /* ---------------- C-WEBAPI@1 追加：账号演示端点 ---------------- */

    async sendRegisterCode(payload: SendRegisterCodePayload): Promise<SendRegisterCodeResult> {
      const email = payload.email.trim();
      if (email === '' || !email.includes('@')) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: '请填写正确的邮箱地址',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }
      const key = mockAccountKey(email);
      if (mockAccounts.has(key)) {
        throw makeError({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: '该邮箱已注册，可直接登录',
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const sentAt = mockCodeSentAt.get(key);
      const now = Date.now();
      if (sentAt !== undefined && now - sentAt < MOCK_CODE_RESEND_SECONDS * 1000) {
        const retryAfter = Math.ceil(
          (MOCK_CODE_RESEND_SECONDS * 1000 - (now - sentAt)) / 1000,
        );
        throw makeError({
          code: 'RATE_LIMITED',
          message: `请 ${retryAfter} 秒后再发送验证码`,
          retryable: false,
          status: 429,
          requestId: nextRequestId(),
          details: { retry_after_seconds: retryAfter },
        });
      }
      mockCodeSentAt.set(key, now);
      return {
        email,
        expires_in_seconds: MOCK_CODE_TTL_SECONDS,
        resend_after_seconds: MOCK_CODE_RESEND_SECONDS,
      };
    },

    async registerAccount(payload: RegisterRequestPayload) {
      const username = payload.username.trim();
      const email = payload.email.trim();
      const verificationCode = payload.verification_code.trim();
      if (!/^\d{6}$/.test(verificationCode)) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: '请输入 6 位数字验证码',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }
      if (verificationCode !== MOCK_REGISTER_CODE) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: '验证码不正确，请重新获取',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }
      // 契约只规定"去空格后为空"判空；保存与比较都用原始密码，不做静默改写。
      if (username === '' || email === '' || payload.password.trim() === '') {
        throw makeError({
          code: 'MISSING_FIELD',
          message: '请填写用户名、邮箱与密码',
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }
      const passwordLength = Array.from(payload.password).length;
      if (passwordLength < MOCK_MIN_PASSWORD_LENGTH || passwordLength > MOCK_MAX_PASSWORD_LENGTH) {
        throw makeError({
          code: 'MISSING_FIELD',
          message: `密码长度需为 ${MOCK_MIN_PASSWORD_LENGTH}–${MOCK_MAX_PASSWORD_LENGTH} 个字符`,
          retryable: false,
          status: 422,
          requestId: nextRequestId(),
        });
      }
      const usernameKey = mockUsernameKey(username);
      if (mockAccountsByUsername.has(usernameKey)) {
        throw makeError({
          code: 'USERNAME_ALREADY_REGISTERED',
          message: '该用户名已被占用，请换一个',
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const key = mockAccountKey(email);
      if (mockAccounts.has(key)) {
        throw makeError({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: '该邮箱已注册，可直接登录',
          retryable: false,
          status: 409,
          requestId: nextRequestId(),
        });
      }
      const requestedName =
        typeof payload.display_name === 'string' ? payload.display_name.trim() : '';
      const user: AuthUser = {
        user_id: `usr_${mockRandomSuffix()}${mockRandomSuffix()}`,
        username,
        email,
        // 与后端一致：缺省时用用户名，并截断到 64 字符。
        display_name: (requestedName === '' ? username : requestedName).slice(0, 64),
        status: 'active',
        created_at: nowIso(),
        email_verification: 'verified',
        avatar_url: null,
      };
      const record: MockAccountRecord = {
        user,
        password: payload.password,
        csrfToken: '',
        profile: defaultMockProfile(),
      };
      mockAccounts.set(key, record);
      mockAccountsByUsername.set(usernameKey, record);
      mockCodeSentAt.delete(key);
      return cloneData(user);
    },

    async loginAccount(payload: LoginRequestPayload) {
      const raw = payload.identifier.trim();
      const record =
        mockAccounts.get(mockAccountKey(raw)) ?? mockAccountsByUsername.get(mockUsernameKey(raw));
      if (record === undefined || record.password !== payload.password) {
        throw makeError({
          code: 'INVALID_CREDENTIALS',
          message: '用户名或密码不正确',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      const key = mockAccountKey(record.user.email);
      const remember = payload.remember === true;
      // 与 R4-4 一致：false → 12h/24h；true → 168h/720h。
      const idleExpiresAt = nowIso((remember ? 168 : 12) * HOUR_MS);
      const csrfToken = 'mock-csrf-' + mockRandomSuffix();
      record.csrfToken = csrfToken;
      mockCurrentUser = { accountKey: key, csrfToken, idleExpiresAt };
      const result: LoginResult = {
        user: cloneData(record.user),
        csrf_token: csrfToken,
        expires_at: idleExpiresAt,
        absolute_expires_at: nowIso((remember ? 720 : 24) * HOUR_MS),
      };
      return result;
    },

    async getMe() {
      const current = mockCurrentUser;
      if (current === null) {
        throw makeError({
          code: 'AUTH_REQUIRED',
          message: '请先登录',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      const record = mockAccounts.get(current.accountKey);
      if (record === undefined) {
        mockCurrentUser = null;
        throw makeError({
          code: 'AUTH_REQUIRED',
          message: '请先登录',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      const me: MeResponse = {
        user: cloneData(record.user),
        session: {
          session_id: 'mock-auth-session',
          // 与 C-AUTHAPI@1 一致：`expires_at` 与 `idle_expires_at` 取同一值。
          expires_at: current.idleExpiresAt,
          idle_expires_at: current.idleExpiresAt,
        },
        // 与登录时同一个值（契约要求），便于演示"刷新后用 /me 的 csrf 登出"。
        csrf_token: current.csrfToken,
        profile: cloneData(record.profile),
      };
      return me;
    },

    async logoutAccount() {
      // mock 下幂等：未登录也正常 resolve；与真实语义的差异由页面「演示模式」标注说明。
      mockCurrentUser = null;
    },

    async updateMe(payload: UpdateMePayload) {
      const record = mockCurrentAccount();
      if (record === null) {
        throw makeError({
          code: 'AUTH_REQUIRED',
          message: '请先登录',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      const profile = { ...record.profile };
      if (payload.display_name !== undefined) {
        const name = payload.display_name.trim();
        if (name === '') {
          throw makeError({
            code: 'MISSING_FIELD',
            message: '昵称不能为空',
            retryable: false,
            status: 422,
            requestId: nextRequestId(),
          });
        }
        record.user = { ...record.user, display_name: name.slice(0, 32) };
      }
      if (payload.bio !== undefined) profile.bio = payload.bio.trim().slice(0, 200);
      if (payload.occupation !== undefined) profile.occupation = payload.occupation.trim().slice(0, 64);
      if (payload.school !== undefined) profile.school = payload.school.trim().slice(0, 64);
      if (payload.phone !== undefined) {
        const rawPhone = payload.phone.trim();
        let digits = rawPhone.replace(/[\s-]/g, '');
        if (digits.startsWith('+')) digits = digits.slice(1);
        if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
        if (rawPhone !== '' && !/^1[3-9]\d{9}$/.test(digits)) {
          throw makeError({
            code: 'MISSING_FIELD',
            message: '手机号格式不正确，请输入 11 位中国大陆手机号',
            retryable: false,
            status: 422,
            requestId: nextRequestId(),
          });
        }
        profile.phone = digits;
      }
      if (payload.interests !== undefined) {
        profile.interests = Array.from(
          new Set(payload.interests.map((item) => item.trim()).filter((item) => item !== '')),
        ).slice(0, 8);
      }
      if (payload.preferred_subject !== undefined) {
        profile.preferred_subject = payload.preferred_subject.trim().slice(0, 32);
      }
      if (payload.default_entry !== undefined) profile.default_entry = payload.default_entry;
      profile.updated_at = nowIso();
      record.profile = profile;
      const result: ProfileUpdateResult = {
        user: cloneData(record.user),
        profile: cloneData(profile),
      };
      return result;
    },

    async uploadAvatar(file: Blob) {
      const record = mockCurrentAccount();
      if (record === null) {
        throw makeError({
          code: 'AUTH_REQUIRED',
          message: '请先登录',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      if (file.size > 2 * 1024 * 1024) {
        throw makeError({
          code: 'LIMIT_EXCEEDED',
          message: '头像图片不能超过 2MB',
          retryable: false,
          status: 413,
          requestId: nextRequestId(),
        });
      }
      const previous = record.user.avatar_url;
      if (typeof previous === 'string' && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      const avatarUrl =
        typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
      record.user = { ...record.user, avatar_url: avatarUrl };
      record.profile = { ...record.profile, updated_at: nowIso() };
      return {
        user: cloneData(record.user),
        profile: cloneData(record.profile),
      };
    },

    async deleteAvatar() {
      const record = mockCurrentAccount();
      if (record === null) {
        throw makeError({
          code: 'AUTH_REQUIRED',
          message: '请先登录',
          retryable: false,
          status: 401,
          requestId: nextRequestId(),
        });
      }
      const previous = record.user.avatar_url;
      if (typeof previous === 'string' && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      record.user = { ...record.user, avatar_url: null };
      record.profile = { ...record.profile, updated_at: nowIso() };
      return {
        user: cloneData(record.user),
        profile: cloneData(record.profile),
      };
    },
  };
}