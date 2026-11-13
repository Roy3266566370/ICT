import type { ISpec, TrustLevel, TrustReport } from '@/ispec/types';
import styles from './TrustBadge.module.css';

export const LEVEL_ORDER: TrustLevel[] = ['green', 'yellow', 'red', 'gray'];

export const LEVEL_TEXT: Record<TrustLevel, string> = {
  green: '可信',
  yellow: '待确认',
  red: '校验失败',
  gray: '未独立校验',
};

export function TrustDot({ level }: { level: TrustLevel }) {
  return <span className={styles.dot} data-level={level} aria-hidden="true" />;
}

export function TrustBadge({
  trust,
  onClick,
  compact = false,
}: {
  trust: TrustReport | undefined;
  onClick?: () => void;
  compact?: boolean;
}) {
  const level = trust?.level ?? 'gray';
  const label = trust?.level_label ?? '未评估';
  const content = (
    <>
      <TrustDot level={level} />
      <span>{label}</span>
      {!compact && trust ? (
        <small>{trust.validation.status === 'not_covered' ? '无第二实现' : `校验${trust.validation.status === 'pass' ? '通过' : '失败'}`}</small>
      ) : null}
      {onClick ? <span className={styles.chevron} aria-hidden="true">⌄</span> : null}
    </>
  );
  if (!onClick) {
    return <span className={styles.badge} data-level={level} data-compact={compact ? 'true' : 'false'}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={styles.badge}
      data-level={level}
      data-compact={compact ? 'true' : 'false'}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      aria-label={`可信度：${label}，打开溯源面板`}
    >
      {content}
    </button>
  );
}

export function trustForSpec(spec: ISpec | undefined): TrustReport | undefined {
  return spec?.trust;
}

export default TrustBadge;
