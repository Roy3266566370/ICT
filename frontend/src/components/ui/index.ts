/**
 * components/ui/index.ts —— C-UI@1 共享原子组件出口
 *
 * Props 类型统一从 `@/api/types` 重导出，保证"契约只有一份定义"。
 */
export { ParamControl } from './ParamControl';
export { SourcePanel } from './SourcePanel';
export { ChecksPanel, NOT_RUN_NOTICE, STALE_NOTICE } from './ChecksPanel';
export { RunsPanel } from './RunsPanel';
export { StatusBadge, ProvenanceBadge } from './StatusBadge';
export type { ProvenanceBadgeProps } from './StatusBadge';

export type {
  ChecksPanelProps,
  ParamControlProps,
  RunsPanelProps,
  SourcePanelProps,
  StatusBadgeProps,
} from '@/api/types';