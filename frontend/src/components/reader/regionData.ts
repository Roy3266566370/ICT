/**
 * 区域数据的读取与解析（宿主内部使用，不是跨任务契约）。
 *
 * 数据来源优先级：
 * 1. `/fixtures/materials/<material_id>/regions.json` 或 `/fixtures/regions/<material_id>.json`
 *    （后端/渲染任务的正式产物，形如 `PageRegion[]` 或 `{ regions: [...] }`）；
 * 2. 内置演示区域 —— **仅示例材料白名单**（P0-01）：用户上传材料识别为空时必须返回空，
 *    由 UI 显示"未识别到交互区域"，绝不复用课程材料的演示热点/参数；
 * 3. 空数组 —— 页面退化为"仅阅读"，这是 spec §0 要求的必备能力（无区域也要能读原文）。
 *
 * 每次加载都会返回 `recognition`，供准备页/工作台显示"未识别到交互区域（原因：…）"。
 */
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { MaterialRegion } from '@/api/types';
import type { PageRegion, RegionBBox, RegionStatus } from '@/regions/types';

/** 16:9 页面尺寸（英寸）：12192000 / 914400 = 13.3333，6858000 / 914400 = 7.5。 */
export const PAGE_SIZE_INCHES = { width: 13.3333, height: 7.5 } as const;

/**
 * 示例材料白名单（P0-01）。
 *
 * 只有这些 material_id 才允许使用下面的 `DEMO_REGIONS`；用户上传的材料
 * （任意其他 id）在区域产物缺失/为空时一律返回空数组，不允许"借"示例区域。
 */
export const EXAMPLE_MATERIAL_IDS = ['mat_matrix_courseware', 'matrix-courseware'] as const;

/** 材料是否为示例材料（演示区域的唯一启用条件）。 */
export function isExampleMaterial(materialId: string | null): boolean {
  return materialId !== null && (EXAMPLE_MATERIAL_IDS as readonly string[]).includes(materialId);
}

/**
 * 材料 id → fixtures 目录名的别名。
 *
 * 只对示例材料登记：课程材料的 material_id 是 `mat_matrix_courseware`，
 * 而产物目录是 `matrix-courseware`。**不得**把该目录用作其他材料的兜底，
 * 否则任意上传材料都会读到课程材料的 regions.json（P0-01 的根因）。
 */
const MATERIAL_DIR_ALIASES: Readonly<Record<string, string>> = {
  mat_matrix_courseware: 'matrix-courseware',
};

/**
 * S6「矩阵作用在三条向量上」的演示区域。
 * bbox / 坐标系 / linked_texts 与 spec §4、原型 `prototype/s06.html` 一一对应；
 * `element_id` 采自 spec 示例（p06_e03）与相邻形状序号，标注为演示数据，正式产物会覆盖。
 */
const DEMO_S6_REGION: PageRegion = {
  region_id: 'rgn_s06_vectors',
  material_id: 'mat_matrix_courseware',
  page: 6,
  bbox: { x: 0.58, y: 1.27, w: 6.67, h: 4.69 },
  coordinate_system: { view_box: [1920, 1350], origin: [640, 770], unit: 150, y_axis: 'up' },
  script_id: 'matrix_eigen_2d',
  status: 'confirmed',
  original_params: {
    a11: 2,
    a12: 1,
    a21: 1,
    a22: 2,
    vectors: [
      [1, 0],
      [1, 1],
      [1, -1],
    ],
  },
  linked_texts: [
    {
      element_id: 'p06_e03',
      bbox: { x: 7.67, y: 2.9, w: 1.75, h: 0.26 },
      template: '({x0}, {y0}) → ({x1}, {y1})',
      kind: 'result',
    },
    {
      element_id: 'p06_e04',
      bbox: { x: 7.67, y: 3.94, w: 1.75, h: 0.26 },
      template: '({x0}, {y0}) → ({x1}, {y1})',
      kind: 'result',
    },
    {
      element_id: 'p06_e05',
      bbox: { x: 7.67, y: 4.98, w: 1.75, h: 0.26 },
      template: '({x0}, {y0}) → ({x1}, {y1})',
      kind: 'result',
    },
  ],
  assets: { page_image: 'pages/s06.png', erased_image: 'pages/s06_erased.png' },
  notes: 'S6 左图：圆变椭圆与三条向量的去向。原矩阵由三条映射反解（provenance=inferred）。',
};

const DEMO_REGIONS: PageRegion[] = [DEMO_S6_REGION];

/* ------------------------------------------------------------------ */
/* 资源 URL                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把区域产物里的相对路径解析成可访问 URL。
 * - `pages/s06.png` → `/fixtures/pages/s06.png`（渲染产物目录映射到前端 fixtures）
 * - `fixtures/pages/s06.png` → `/fixtures/pages/s06.png`
 * - 以 `/` 或协议开头的原样返回
 */
export function resolveRegionAsset(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  if (trimmed.startsWith('fixtures/')) return `/${trimmed}`;
  return `/fixtures/${trimmed.replace(/^\.?\//, '')}`;
}

/**
 * 整页图 URL。
 *
 * spec §0 明确批评过"把页面第一张插图当页面图"：旧产物里 `slides[].image_url` 指向
 * `fixtures/ppt/s06_3.png`（元素图），因此这里跳过含 `/ppt/` 的路径，改用整页图
 * `fixtures/pages/sNN.png`（由渲染任务产出，24 页齐全）。
 */
export function pageImageFor(page: number, slideImageUrl: string | null | undefined, region: PageRegion | null): string {
  const regionImage = region === null ? '' : resolveRegionAsset(region.assets.page_image);
  const slideUrl = (slideImageUrl ?? '').trim();
  if (slideUrl.length > 0 && !slideUrl.includes('/ppt/')) {
    return resolveRegionAsset(slideUrl);
  }
  if (regionImage.length > 0) return regionImage;
  return `/fixtures/pages/s${String(page).padStart(2, '0')}.png`;
}

export function erasedImageFor(region: PageRegion | null): string {
  if (region === null) return '';
  return resolveRegionAsset(region.assets.erased_image);
}

/** bbox（英寸）→ 页面百分比定位（只改容器尺寸，不改内部坐标，spec §5）。 */
export function bboxToPercent(bbox: RegionBBox): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(bbox.x / PAGE_SIZE_INCHES.width) * 100}%`,
    top: `${(bbox.y / PAGE_SIZE_INCHES.height) * 100}%`,
    width: `${(bbox.w / PAGE_SIZE_INCHES.width) * 100}%`,
    height: `${(bbox.h / PAGE_SIZE_INCHES.height) * 100}%`,
  };
}

/* ------------------------------------------------------------------ */
/* 解析外部 JSON                                                       */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBBox(value: unknown): RegionBBox | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  return { x, y, w, h };
}

function readPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [first, second] = value;
  if (typeof first !== 'number' || typeof second !== 'number') return null;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return [first, second];
}

/** 宽松但严格的校验：任一必需字段缺失即丢弃该区域（宁可退化也不渲染半成品）。 */
export function parsePageRegion(value: unknown): PageRegion | null {
  if (!isRecord(value)) return null;
  const bbox = readBBox(value.bbox);
  const viewBox = readPair(isRecord(value.coordinate_system) ? value.coordinate_system.view_box : null);
  const origin = readPair(isRecord(value.coordinate_system) ? value.coordinate_system.origin : null);
  const assets = isRecord(value.assets) ? value.assets : null;

  if (bbox === null || viewBox === null || origin === null || assets === null) return null;
  if (typeof value.region_id !== 'string' || typeof value.material_id !== 'string') return null;
  if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 1) return null;
  if (typeof value.script_id !== 'string') return null;
  if (!isRecord(value.original_params)) return null;
  if (typeof assets.page_image !== 'string' || typeof assets.erased_image !== 'string') return null;

  const unit = isRecord(value.coordinate_system) ? value.coordinate_system.unit : undefined;
  const yAxis = isRecord(value.coordinate_system) ? value.coordinate_system.y_axis : undefined;
  const rawStatus = value.status;
  const status: RegionStatus =
    rawStatus === 'confirmed' || rawStatus === 'static_only' || rawStatus === 'unsupported'
      ? rawStatus
      : 'pending';

  return {
    region_id: value.region_id,
    material_id: value.material_id,
    page: value.page,
    bbox,
    coordinate_system: {
      view_box: viewBox,
      origin,
      unit: typeof unit === 'number' && unit > 0 ? unit : 1,
      y_axis: yAxis === 'down' ? 'down' : 'up',
    },
    script_id: value.script_id,
    status,
    original_params: value.original_params,
    linked_texts: Array.isArray(value.linked_texts)
      ? value.linked_texts.flatMap((item) => {
          if (!isRecord(item)) return [];
          const textBBox = readBBox(item.bbox);
          if (textBBox === null || typeof item.element_id !== 'string' || typeof item.template !== 'string') return [];
          return [
            {
              element_id: item.element_id,
              bbox: textBBox,
              template: item.template,
              kind: item.kind === 'hint' ? ('hint' as const) : ('result' as const),
            },
          ];
        })
      : [],
    assets: { page_image: assets.page_image, erased_image: assets.erased_image },
    ...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
  };
}

export function parsePageRegions(value: unknown): PageRegion[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.regions) ? value.regions : [];
  return list.flatMap((item) => {
    const parsed = parsePageRegion(item);
    return parsed === null ? [] : [parsed];
  });
}

/* ------------------------------------------------------------------ */
/* 合并准备页的确认/纠正（服务端持久化覆盖）                            */
/* ------------------------------------------------------------------ */

const STATUS_TEXT: Record<RegionStatus, string> = {
  pending: '待确认',
  confirmed: '可交互',
  static_only: '仅静态阅读',
  unsupported: '不支持交互',
};

/**
 * 把"准备页已确认"的来源写进 `notes`，由详情面板（`DetailsPanel` 的"识别说明"）
 * 展示——main 阅读区不新增任何 UI（spec §6：实现信息只能出现在"详情"里）。
 */
function overrideSourceNote(
  originalNotes: string | undefined,
  overriddenKeys: string[],
  baseStatus: RegionStatus,
  status: RegionStatus,
): string | undefined {
  const parts: string[] = [];
  if (overriddenKeys.length > 0) {
    parts.push(`参数来源：准备页确认（已覆盖 ${overriddenKeys.join('、')}）`);
  }
  if (status !== baseStatus) {
    parts.push(`状态来源：准备页改为「${STATUS_TEXT[status]}」`);
  }
  if (parts.length === 0) return originalNotes;
  const prefix = originalNotes === undefined || originalNotes.length === 0 ? '' : `${originalNotes}；`;
  return `${prefix}${parts.join('；')}`;
}

/**
 * 基线 `regions.json` + 服务端覆盖 → 工作台实际使用的区域。
 *
 * 合并规则（spec §2 第 5 条）：
 *  - `parameter_overrides` 只含用户改过的键，覆盖到 `original_params`；
 *  - `status` 覆盖识别状态（如"仅静态阅读"）；
 *  - 因此工作台"恢复原稿"恢复的是**确认后的值**，而不是识别出的旧值。
 */
export function mergeMaterialRegionOverrides(
  regions: PageRegion[],
  materialRegions: MaterialRegion[],
): PageRegion[] {
  if (materialRegions.length === 0) return regions;
  const byId = new Map<string, MaterialRegion>();
  materialRegions.forEach((item) => byId.set(item.region_id, item));
  return regions.map((region) => {
    const override = byId.get(region.region_id);
    if (override === undefined || !override.has_override) return region;
    const overriddenKeys = Object.keys(override.parameter_overrides);
    const status: RegionStatus = override.status;
    const notes = overrideSourceNote(region.notes, overriddenKeys, region.status, status);
    if (overriddenKeys.length === 0 && status === region.status) return region;
    return {
      ...region,
      status,
      original_params:
        overriddenKeys.length === 0
          ? region.original_params
          : { ...region.original_params, ...override.parameter_overrides },
      ...(notes === undefined ? {} : { notes }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 加载                                                                */
/* ------------------------------------------------------------------ */

export type RegionDataSource = 'fixtures' | 'demo' | 'none';

/** 识别结论：`found=false` 时 UI 必须显示"未识别到交互区域（原因：…）"，不显示任何热点/参数。 */
export interface RegionRecognition {
  found: boolean;
  reason: string;
}

export interface RegionsState {
  regions: PageRegion[];
  loading: boolean;
  source: RegionDataSource;
  detail: string;
  recognition: RegionRecognition;
}

/**
 * 演示区域仅对示例材料生效。
 *
 * P0-01：这里是演示数据的**唯一开关**。用户上传材料即使 regions.json 缺失或为空，
 * 也返回空数组——不得把 S6 的 `rgn_s06_vectors` 热点与矩阵参数挂到别人的 PPT 上。
 */
function demoRegionsFor(materialId: string | null): PageRegion[] {
  if (!isExampleMaterial(materialId)) return [];
  return DEMO_REGIONS;
}

/** 材料可读取的 fixtures 目录（示例材料额外登记别名，其余材料只用自身 id）。 */
function fixtureDirsFor(materialId: string): string[] {
  const dirs = [materialId];
  const alias = MATERIAL_DIR_ALIASES[materialId];
  if (alias !== undefined && !dirs.includes(alias)) dirs.push(alias);
  return dirs;
}

/** 允许出现的 region.material_id：真实材料只认自身 id；示例材料额外接受白名单里的别名。 */
function acceptedRegionMaterialIds(materialId: string): ReadonlySet<string> {
  const ids = new Set<string>([materialId]);
  if (isExampleMaterial(materialId)) {
    EXAMPLE_MATERIAL_IDS.forEach((id) => ids.add(id));
  }
  return ids;
}

function noneState(reason: string, loading = false): RegionsState {
  return {
    regions: [],
    loading,
    source: 'none',
    detail: loading ? '正在读取区域数据…' : '区域数据：未提供（本页仅阅读）',
    recognition: { found: false, reason },
  };
}

export function usePageRegions(materialId: string | null): RegionsState {
  const [state, setState] = useState<RegionsState>(() =>
    materialId === null
      ? noneState('缺少材料编号，无法读取区域数据。')
      : noneState('正在识别交互区域…', true),
  );

  useEffect(() => {
    if (materialId === null) {
      setState(noneState('缺少材料编号，无法读取区域数据。'));
      return undefined;
    }

    const controller = new AbortController();
    const demo = demoRegionsFor(materialId);
    if (!controller.signal.aborted) {
      setState(noneState('正在识别交互区域…', true));
    }

    /**
     * 区域数据的真实来源是「渲染产物」：
     *   <material 目录>/regions.json（由 backend/scripts/render_courseware.py 生成）
     * 历史路径 `/fixtures/regions/<material_id>.json` 仅作兼容兜底。
     *
     * 注意（P0-01）：这里**只探测当前 material_id 自己的目录**。此前把
     * `/fixtures/materials/matrix-courseware/regions.json` 写成全局兜底，
     * 导致任意上传材料都读到课程材料的区域，界面出现别人的热点与参数。
     */
    const candidateUrls = fixtureDirsFor(materialId).flatMap((dir) => [
      `/fixtures/materials/${encodeURIComponent(dir)}/regions.json`,
      `/fixtures/regions/${encodeURIComponent(dir)}.json`,
    ]);

    const tryLoad = async (): Promise<PageRegion[]> => {
      for (const url of candidateUrls) {
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) continue;
          const json: unknown = await response.json();
          const acceptedIds = acceptedRegionMaterialIds(materialId);
          const parsed = parsePageRegions(json).filter((region) => acceptedIds.has(region.material_id));
          if (parsed.length > 0) return parsed;
        } catch {
          if (controller.signal.aborted) return [];
        }
      }
      return [];
    };

    void tryLoad()
      .then(async (parsed) => {
        if (controller.signal.aborted) return;
        if (parsed.length === 0) {
          if (demo.length > 0) {
            setState({
              regions: demo,
              loading: false,
              source: 'demo',
              detail: '区域数据：本地示例（示例材料，后端产物未就绪时使用）',
              recognition: { found: true, reason: '示例材料内置演示区域（并非用户上传材料的识别结果）' },
            });
          } else {
            setState(
              noneState(
                '材料未生成区域产物（regions.json 不存在或为空）；未启用任何示例/演示区域。',
              ),
            );
          }
          return;
        }

        // 准备页的确认/纠正存在服务端（data/regions/<material_id>.json）；
        // 拉取失败时静默回退基线，绝不因为"确认没读到"而阻断阅读。
        let merged = parsed;
        let appliedCount = 0;
        try {
          const payload = await api.listMaterialRegions(materialId);
          merged = mergeMaterialRegionOverrides(parsed, payload.regions);
          appliedCount = merged.reduce(
            (sum, region, index) => (region === parsed[index] ? sum : sum + 1),
            0,
          );
        } catch {
          merged = parsed;
        }
        if (controller.signal.aborted) return;
        setState({
          regions: merged,
          loading: false,
          source: 'fixtures',
          detail:
            `区域数据：${merged.length} 个` +
            (appliedCount > 0 ? `；已合并准备页确认 ${appliedCount} 项` : ''),
          recognition: {
            found: true,
            reason: `已识别 ${merged.length} 个交互区域（来自材料区域产物）`,
          },
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (demo.length > 0) {
          setState({
            regions: demo,
            loading: false,
            source: 'demo',
            detail: '区域数据：本地示例（示例材料，后端产物未就绪时使用）',
            recognition: { found: true, reason: '示例材料内置演示区域（并非用户上传材料的识别结果）' },
          });
        } else {
          setState(
            noneState('读取区域数据失败（网络或产物格式异常）；未启用任何示例/演示区域。'),
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [materialId]);

  return state;
}

/* ------------------------------------------------------------------ */
/* 参数合并与变化判定                                                   */
/* ------------------------------------------------------------------ */

export function mergeRegionParams(
  region: PageRegion | null,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (region === null) return {};
  return { ...region.original_params, ...(overrides ?? {}) };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => sameValue(left[key], right[key]));
  }
  return left === right;
}

/** 当前参数是否已偏离原始参数（决定"当前值"标识与"恢复原稿"的可用性）。 */
export function isRegionChanged(region: PageRegion | null, params: Record<string, unknown>): boolean {
  if (region === null) return false;
  return Object.keys(region.original_params).some(
    (key) => !sameValue(region.original_params[key], params[key]),
  );
}

/** 从平铺参数里读出 2×2 矩阵（供同步到知识对象使用）；缺字段返回 null。 */
export function matrixFromParams(params: Record<string, unknown>): [number, number][] | null {
  const { a11, a12, a21, a22 } = params;
  if (
    typeof a11 !== 'number' ||
    typeof a12 !== 'number' ||
    typeof a21 !== 'number' ||
    typeof a22 !== 'number' ||
    ![a11, a12, a21, a22].every((value) => Number.isFinite(value))
  ) {
    return null;
  }
  return [
    [a11, a12],
    [a21, a22],
  ];
}