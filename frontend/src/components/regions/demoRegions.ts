/**
 * 演示区域（仅课程材料，且后端区域产物未就绪时使用）。
 *
 * 为什么需要：准备页必须能演示"确认 / 纠正"流程与 S18 四格，否则验收时只能看到空态。
 * 三条自律：
 *  1. 只对课程材料生效，**绝不**挂到用户上传的材料上（避免把演示数据当成识别结果）；
 *  2. 界面一律标注"演示数据"（见 RegionConfirmationPanel 的 sourceNote）；
 *  3. 后端正式产物（`/fixtures/regions/<id>.json`）一旦就绪即完全替换，不做合并。
 */
import type { PageRegion } from '@/regions/types';
import { DEFAULT_PARAMS, FALLBACK_TEXT_TEMPLATES } from '@/legacy/regions/detArea/model';

const COURSEWARE_MATERIAL_IDS = ['mat_matrix_courseware', 'matrix-courseware'];

export const DEMO_S18_REGION: PageRegion = {
  region_id: 'rgn_s18_det_area',
  material_id: 'mat_matrix_courseware',
  page: 18,
  // 四格原图 bbox 的并集：(0.79,1.38)+(2.96,1.98) 与 (4.25,4.02)+(2.96,1.98)
  bbox: { x: 0.79, y: 1.38, w: 6.42, h: 4.62 },
  // 924 × 666 ≈ 6.42 × 4.62 英寸 @144ppi；四格布局由组件按 viewBox 自算
  coordinate_system: { view_box: [924, 666], origin: [0, 0], unit: 1, y_axis: 'up' },
  script_id: 'det_area_2d',
  status: 'pending',
  original_params: { ...DEFAULT_PARAMS },
  linked_texts: FALLBACK_TEXT_TEMPLATES.map((text) => ({ ...text, bbox: { ...text.bbox } })),
  assets: { page_image: 'pages/s18.png', erased_image: 'pages/s18_erased.png' },
  notes: 'S18 四格：单位 / 拉伸 / 剪切 / 压缩；参数由语义参数驱动（provenance=inferred）。',
};

/** 是否课程材料（按 material_id 的两种写法匹配）。 */
export function isCoursewareMaterial(materialId: string | null): boolean {
  return materialId !== null && COURSEWARE_MATERIAL_IDS.includes(materialId);
}

/**
 * 补充演示区域：仅当材料是课程材料、且没有第 18 页的 det_area_2d 区域时追加一条。
 * 后端产物存在时不追加，保证"有真数据就不掺演示数据"。
 */
export function extraDemoRegions(materialId: string | null, regions: PageRegion[]): PageRegion[] {
  if (!isCoursewareMaterial(materialId)) return [];
  const hasS18 = regions.some((region) => region.page === 18 && region.script_id === 'det_area_2d');
  if (hasS18) return [];
  return [{ ...DEMO_S18_REGION, material_id: materialId ?? DEMO_S18_REGION.material_id }];
}