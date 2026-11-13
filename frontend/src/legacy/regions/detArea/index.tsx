/**
 * det_area_2d 区域组件出口。
 *
 * `registry.ts` 按 `script_id` 装载本模块：
 *   `det_area_2d` → `DetArea2D`（默认导出，注册表可直接 `import DetArea2D from './detArea'`）
 *
 * 同时导出纯模型，供准备页生成参数编辑控件与自检脚本复用。
 */
export { default, DetArea2D } from './DetArea2D';
export type { CellId, CellSpec, CellState, DetAreaParams, Mat2, Orientation, ParamMeta } from './model';
export {
  CELL_SPECS,
  DEFAULT_PARAMS,
  DEGENERATE_NOTE,
  FALLBACK_TEXT_TEMPLATES,
  PARAM_METAS,
  SINGULAR_EPSILON,
  buildCells,
  buildLinkedTextValues,
  defaultParams,
  determinant,
  formatArea,
  formatSigned,
  interpolateMatrix,
  matrixOf,
  orientationOf,
  orientationText,
  readNumericParam,
  resolveParams,
  textValues,
  visibleCellIds,
} from './model';
export { MATH_BOUNDS, computeCellRects, computeLayout } from './layout';
export type { CellLayout, LayoutResult, Rect } from './layout';

/** 与 PageRegion.script_id 白名单一致的注册名。 */
export const DET_AREA_SCRIPT_ID = 'det_area_2d' as const;