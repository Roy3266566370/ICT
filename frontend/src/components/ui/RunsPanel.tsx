/**
 * RunsPanel.tsx —— 运行记录面板（C-UI@1，R10-AC4/AC5）
 *
 * 只负责展示与两个事件上抛：
 *  - `onSelect(run_id)`：查看快照详情（只读）；
 *  - `onRestore(run)`：回放当时的输入（由宿主读取 `input_snapshot`，
 *    **不得**用它覆盖当前参数，也不得用当前参数覆盖历史）。
 */
import type { ReactElement } from 'react';
import type { RunSnapshot, RunsPanelProps } from '@/api/types';
import { formatDateTime, percentOf } from '@/domain/format';
import { StatusBadge } from './StatusBadge';
import styles from './RunsPanel.module.css';

function resultSummary(result: unknown): string {
  if (result === null || result === undefined) return '无结果（未计算）';
  if (typeof result === 'object') {
    const keys = Object.keys(result as Record<string, unknown>);
    return keys.length === 0 ? '空结果' : `结果字段：${keys.slice(0, 6).join('、')}`;
  }
  return String(result);
}

function validationSummary(run: RunSnapshot): string {
  const report = run.validation_report;
  if (report === null) return '未校验';
  const suffix = report.is_stale ? '（已过期）' : '';
  return `通过 ${report.summary.pass} · 失败 ${report.summary.fail} · 未覆盖 ${report.summary.not_covered}${suffix}`;
}

export function RunsPanel(props: RunsPanelProps): ReactElement {
  const { runs, activeRunId, onSelect, onRestore } = props;

  if (runs.length === 0) {
    return (
      <p className={styles.empty} role="status">
        还没有保存的运行。调整参数后点"保存运行"，会冻结当时的输入与结果。
      </p>
    );
  }

  return (
    <ul className={styles.list} aria-label="运行记录">
      {runs.map((run) => {
        const active = run.run_id === activeRunId;
        const coverage = percentOf(run.revision, Math.max(run.revision, 1));
        return (
          <li key={run.run_id} className={`${styles.item} ${active ? styles.active : ''}`}>
            <button
              type="button"
              className={styles.trigger}
              onClick={() => onSelect(run.run_id)}
              aria-current={active ? 'true' : undefined}
            >
              <span className={styles.head}>
                <span className={styles.runId}>{run.run_id.slice(0, 12)}</span>
                <span className={styles.time}>{formatDateTime(run.created_at)}</span>
              </span>
              <span className={styles.meta}>
                <span>
                  model_version <code>{run.model_version}</code> · revision{' '}
                  <code>{run.revision}</code>
                </span>
                <span className={styles.kernel}>{run.kernel_version}</span>
              </span>
              <span className={styles.result}>{resultSummary(run.result)}</span>
              <span className={styles.validation}>
                {run.validation_report === null ? (
                  <StatusBadge status="not_covered" label="未校验" />
                ) : run.validation_report.is_stale ? (
                  <StatusBadge status="stale" />
                ) : run.validation_report.summary.fail > 0 ? (
                  <StatusBadge status="fail" label="校验未通过" />
                ) : (
                  <StatusBadge status="pass" label="校验通过" />
                )}
                <span className={styles.validationText}>{validationSummary(run)}</span>
              </span>
              {coverage === null ? null : (
                <span className={styles.coverage} aria-hidden="true">
                  修订 {run.revision}
                </span>
              )}
            </button>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.restore}
                onClick={() => onRestore(run)}
                title="回放当时的 input_snapshot，不覆盖当前参数"
              >
                回放此输入
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}