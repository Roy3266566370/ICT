/**
 * 区域确认/纠正面板的可复用组件（准备页使用）。
 *
 * 只做展示与回调，不直接请求接口：数据由页面注入，便于工作台"详情"面板复用同一套控件。
 */
export { default as RegionCard, scriptLabel } from './RegionCard';
export type { RegionCardActions, RegionCardProps } from './RegionCard';
export { default as RegionParamTable, pickProvenance, provenanceText, valueToText } from './RegionParamTable';
export type { RegionParamRow, RegionParamTableProps } from './RegionParamTable';
export { default as RegionMappingList } from './RegionMappingList';
export type { RegionMappingRow, RegionMappingListProps } from './RegionMappingList';
export { default as RegionStatusBadge, regionStatusText } from './RegionStatusBadge';
export type { RegionStatusBadgeProps } from './RegionStatusBadge';
export { default as RegionConfirmationPanel } from './RegionConfirmationPanel';
export type { RegionConfirmationPanelProps } from './RegionConfirmationPanel';
export { DEMO_S18_REGION, extraDemoRegions, isCoursewareMaterial } from './demoRegions';
export { default as useRegionDrafts } from './useRegionDrafts';
export type { RegionDraftsState } from './useRegionDrafts';
export * from './regionDrafts';
