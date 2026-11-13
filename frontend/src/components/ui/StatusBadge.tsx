/**
 * StatusBadge.tsx —— 状态徽标（C-UI@1）
 *
 * 可访问性要求（R14-AC5）：状态**不只依赖颜色**，每个徽标同时输出
 * 「图形符号 + 中文文案」，符号对读屏隐藏，文案对读屏可见。
 */
import type { ReactElement } from 'react';
import type { CheckStatus, JobStage, MaterialStatus, Provenance, StatusBadgeProps } from '@/api/types';
import styles from './StatusBadge.module.css';

type Tone = 'pass' | 'fail' | 'warn' | 'info' | 'neutral';

interface StatusVisual {
  label: string;
  tone: Tone;
  symbol: string;
}

const CHECK_STATUS_VISUALS: Record<CheckStatus, StatusVisual> = {
  pass: { label: '通过', tone: 'pass', symbol: '✓' },
  fail: { label: '未通过', tone: 'fail', symbol: '✕' },
  not_covered: { label: '未覆盖', tone: 'neutral', symbol: '–' },
  stale: { label: '已过期', tone: 'warn', symbol: '↻' },
};

const MATERIAL_STATUS_VISUALS: Record<MaterialStatus, StatusVisual> = {
  processing: { label: '处理中', tone: 'info', symbol: '◐' },
  awaiting_confirmation: { label: '待确认', tone: 'warn', symbol: '?' },
  ready: { label: '可交互', tone: 'pass', symbol: '✓' },
  failed: { label: '失败', tone: 'fail', symbol: '✕' },
};

const JOB_STAGE_VISUALS: Record<JobStage, StatusVisual> = {
  queued: { label: '排队中', tone: 'neutral', symbol: '·' },
  parsing: { label: '解析中', tone: 'info', symbol: '◐' },
  rendering: { label: '渲染中', tone: 'info', symbol: '◐' },
  extracting: { label: '提取中', tone: 'info', symbol: '◐' },
  awaiting_confirmation: { label: '待确认', tone: 'warn', symbol: '?' },
  compiling: { label: '编译中', tone: 'info', symbol: '◐' },
  validating: { label: '校验中', tone: 'info', symbol: '◐' },
  ready: { label: '就绪', tone: 'pass', symbol: '✓' },
  failed: { label: '失败', tone: 'fail', symbol: '✕' },
};

const PROVENANCE_VISUALS: Record<Provenance, StatusVisual> = {
  original: { label: '原文提取', tone: 'info', symbol: '❝' },
  inferred: { label: '系统推断', tone: 'warn', symbol: '~' },
  user_confirmed: { label: '用户确认', tone: 'pass', symbol: '✓' },
  manual_demo: { label: '示例预置', tone: 'neutral', symbol: '◇' },
};

function resolveVisual(status: StatusBadgeProps['status']): StatusVisual {
  if (status in CHECK_STATUS_VISUALS) {
    return CHECK_STATUS_VISUALS[status as CheckStatus];
  }
  if (status in MATERIAL_STATUS_VISUALS) {
    return MATERIAL_STATUS_VISUALS[status as MaterialStatus];
  }
  if (status in JOB_STAGE_VISUALS) {
    return JOB_STAGE_VISUALS[status as JobStage];
  }
  // 未知状态：不猜语义，明确显示原值，便于定位契约外的取值
  return { label: `未知状态（${status}）`, tone: 'neutral', symbol: '?' };
}

export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const visual = resolveVisual(props.status);
  const label = props.label ?? visual.label;
  return (
    <span className={`${styles.badge} ${styles[visual.tone]}`} title={label}>
      <span className={styles.symbol} aria-hidden="true">
        {visual.symbol}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}

export interface ProvenanceBadgeProps {
  provenance: Provenance;
  label?: string;
}

/** 来源状态徽标（参数级与来源级各一份，§2.2.1 校验规则 6）。 */
export function ProvenanceBadge(props: ProvenanceBadgeProps): ReactElement {
  const visual = PROVENANCE_VISUALS[props.provenance];
  const label = props.label ?? visual.label;
  return (
    <span className={`${styles.badge} ${styles[visual.tone]}`} title={label}>
      <span className={styles.symbol} aria-hidden="true">
        {visual.symbol}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}