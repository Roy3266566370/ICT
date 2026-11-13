/**
 * components/reader —— 以页为中心的工作台阅读层（rebuild-spec §5/§6）。
 */
export { PageCanvas } from './PageCanvas';
export type { PageCanvasProps } from './PageCanvas';
export { PageThumbnails } from './PageThumbnails';
export type { PageThumbnailItem, PageThumbnailsProps } from './PageThumbnails';
export { PageZoom } from './PageZoom';
export type { PageZoomProps } from './PageZoom';
export { ParamDrawer, deriveEditableScalars } from './ParamDrawer';
export type { EditableScalar, ParamDrawerProps } from './ParamDrawer';
export { PlayBar } from './PlayBar';
export type { PlayBarProps } from './PlayBar';
export { DetailsPanel } from './DetailsPanel';
export type { DetailsPanelProps } from './DetailsPanel';
export { LinkedTextLayer } from './LinkedTextLayer';
export type { LinkedTextLayerProps } from './LinkedTextLayer';
export {
  EXAMPLE_MATERIAL_IDS,
  PAGE_SIZE_INCHES,
  bboxToPercent,
  erasedImageFor,
  isExampleMaterial,
  isRegionChanged,
  mergeRegionParams,
  pageImageFor,
  parsePageRegion,
  parsePageRegions,
  resolveRegionAsset,
  usePageRegions,
} from './regionData';
export type { RegionDataSource, RegionRecognition, RegionsState } from './regionData';
export { useUnifiedSpecState } from './useUnifiedSpecState';
export type { UnifiedSpecState, UseUnifiedSpecStateOptions } from './useUnifiedSpecState';
export {
  applyRegionParamsToObject,
  applySpecValuesToObject,
  buildUnifiedRows,
  coerceParameterValue,
  formatUnifiedValue,
  matrixFromFlatParams,
  mergeAllRegionParams,
  sameUnifiedValue,
  sanitizeRegionOverrides,
  sanitizeSpecValues,
} from './unifiedSpecState';
export type {
  RegionOverrides,
  SpecValue,
  SpecValues,
  UnifiedParameterRow,
} from './unifiedSpecState';
export { pickSpecForPage, readEmbeddedSpecs, useMaterialSpecs } from './specData';
export type { MaterialSpecsState, SpecDataSource } from './specData';