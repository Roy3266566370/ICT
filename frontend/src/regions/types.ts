/**
 * `frontend/src/regions/types.ts` —— 区域交互**冻结契约**（v0.3 rebuild-spec §5）。
 *
 * 其他任务（`regions/matrixEigen|matrixColumns|matrixOrder|svdSteps|detArea`）按本文件 import，
 * 宿主（`components/reader/**`、`pages/WorkbenchPage.tsx`）只通过本文件的形状消费组件。
 *
 * 单位约定：
 * - `bbox` 为**英寸**，相对 13.333in × 7.5in 的 16:9 页面（见 rebuild-spec §4 示例 `{x:0.58,y:1.27,w:6.67,h:4.69}`）；
 * - `coordinate_system.view_box` 为动态层 SVG 的 viewBox（如 `[1920,1350]`），`origin` 为数学原点在 SVG 中的像素位置，
 *   `unit` 为"1 个数学单位 = 多少 SVG 像素"，`y_axis` 指示数学 y 轴方向（`up` 时 SVG y = origin.y − y·unit）。
 */
import type { ComponentType } from 'react';

/** 屏幕上的一块矩形（英寸，绝对坐标，相对页面左上角）。 */
export interface RegionBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 区域内部坐标系。
 * - `view_box`：SVG `viewBox` 的宽高（`[width, height]`）；
 * - `origin`：数学原点在 SVG 坐标中的位置；
 * - `unit`：1 个数学单位对应的 SVG 像素数；
 * - `y_axis`：数学 y 轴方向；`up` 表示 SVG 中 y 减小。
 */
export interface RegionCoordinateSystem {
  view_box: [number, number];
  origin: [number, number];
  unit: number;
  y_axis: 'up' | 'down';
}

/** 需要跟随参数变化、在原位覆盖显示的文字。 */
export interface RegionLinkedText {
  element_id: string;
  bbox: RegionBBox;
  /** 占位符模板，如 `"({x0}, {y0}) → ({x1}, {y1})"`；数值由组件回调给出。 */
  template: string;
  /**
   * `result`：当前参数的计算结果（偏离原始值时才覆盖）；
   * `hint`：只在原始参数下成立的结论（参数变化后必须标注"原页参数下"）。
   */
  kind: 'result' | 'hint';
}

/** 底图资源（相对 renders 目录，形如 `pages/s06.png`；宿主负责解析为可访问 URL）。 */
export interface RegionAssets {
  page_image: string;
  erased_image: string;
}

/**
 * 区域状态：
 * - `pending`：识别候选，等待用户确认；
 * - `confirmed`：已确认，可交互；
 * - `static_only`：不可分离/不可重建，保持静态阅读（**禁止硬盖**）；
 * - `unsupported`：识别到但无对应渲染组件。
 */
export type RegionStatus = 'pending' | 'confirmed' | 'static_only' | 'unsupported';

/** 一页中的一个可交互（或明确不可交互）区域。 */
export interface PageRegion {
  region_id: string;
  material_id: string;
  /** 1-based 页码。 */
  page: number;
  bbox: RegionBBox;
  coordinate_system: RegionCoordinateSystem;
  /** 前端动态组件注册名（白名单见 `regions/registry.ts`）。 */
  script_id: string;
  status: RegionStatus;
  /** 原始参数；运行时 `params` = 本对象与用户改动合并后的结果。 */
  original_params: Record<string, unknown>;
  linked_texts: RegionLinkedText[];
  assets: RegionAssets;
  notes?: string;
}

/** 组件回调给宿主的"原位文字"：宿主负责定位、覆盖与"当前值"标识（spec §8）。 */
export interface LinkedTextRuntime {
  element_id: string;
  /** 已渲染的文本；若仍含未替换占位符（`{...}`），宿主不会覆盖原页。 */
  text: string;
  /** 是否偏离了原始参数（决定是否显示橙色描边与"当前值"标签）。 */
  changed: boolean;
}

/** 区域动态组件的 props（冻结）。 */
export interface RegionRendererProps {
  region: PageRegion;
  /** 已合并 `original_params` 与用户改动后的参数。 */
  params: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  /** 0 原像 / 1 变换中 / 2 完成。 */
  stage: 0 | 1 | 2;
  reducedMotion: boolean;
  /** 把"当前计算结果"回传给宿主，用于原位替换 `linked_texts`。 */
  onLinkedTexts: (texts: LinkedTextRuntime[]) => void;
}

export type RegionComponent = ComponentType<RegionRendererProps>;