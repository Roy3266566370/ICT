/**
 * 区域状态徽章：文字 + 符号双编码（不只靠颜色区分，符合无障碍底线）。
 * 状态语义取自 rebuild-spec §4（pending / confirmed / static_only / unsupported）。
 */
import type { ReactElement } from 'react';
import type { RegionStatus } from '@/regions/types';
import styles from './RegionStatusBadge.module.css';

export interface RegionStatusBadgeProps {
  status: RegionStatus;
  /** 覆盖默认中文文案（如"仅静态阅读（已标记）"） */
  label?: string;
}

interface StatusMeta {
  text: string;
  symbol: string;
}

const STATUS_META: Record<RegionStatus, StatusMeta> = {
  pending: { text: '待确认', symbol: '?' },
  confirmed: { text: '可交互', symbol: '✓' },
  static_only: { text: '仅静态阅读', symbol: '▤' },
  unsupported: { text: '不支持交互', symbol: '⊘' },
};

export function RegionStatusBadge(props: RegionStatusBadgeProps): ReactElement {
  const { status, label } = props;
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={styles.badge} data-status={status}>
      <span className={styles.symbol} aria-hidden="true">
        {meta.symbol}
      </span>
      <span>{label ?? meta.text}</span>
    </span>
  );
}

/** 状态 → 中文短名（供文案拼接复用，避免各处硬编码）。 */
export function regionStatusText(status: RegionStatus): string {
  return (STATUS_META[status] ?? STATUS_META.pending).text;
}

export default RegionStatusBadge;