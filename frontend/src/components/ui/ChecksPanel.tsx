/**
 * ChecksPanel.tsx —— 独立校验报告面板（C-UI@1）
 *
 * 硬约束（验收第 4 条，R10-AC7 / R11-AC3）：
 * `report === null` 或 `isStale === true` 时**不得出现"通过"文案**，
 * 且必须显示「检查已过期，请重新运行」这一可操作提示。
 * 报告自身的 `is_stale` 也视同过期（服务端按当前版本动态计算）。
 */
import type { ReactElement } from 'react';
import type { ChecksPanelProps } from '@/api/types';
import { StatusBadge } from './StatusBadge';
import styles from './ChecksPanel.module.css';

export const STALE_NOTICE = '检查已过期，请重新运行';
export const NOT_RUN_NOTICE = '尚未运行检查，请先运行';

export function ChecksPanel(props: ChecksPanelProps): ReactElement {
  const { report, isStale, onRun, running } = props;
  const reportIsStale = report?.is_stale === true;
  const effectiveStale = isStale || reportIsStale;
  const showResult = report !== null && !effectiveStale;

  return (
    <section className={styles.root} aria-label="独立校验">
      <header className={styles.header}>
        <h3 className={styles.title}>独立校验</h3>
        <button
          type="button"
          className={styles.runButton}
          onClick={onRun}
          disabled={running}
          aria-busy={running}
        >
          {running ? '检查中…' : '运行检查'}
        </button>
      </header>

      {report === null ? (
        <p className={styles.notice} role="status" aria-live="polite">
          <span aria-hidden="true">↻</span> {NOT_RUN_NOTICE}
        </p>
      ) : null}

      {report !== null && effectiveStale ? (
        <div className={styles.staleBox} role="status" aria-live="polite">
          <p className={styles.staleTitle}>
            <span aria-hidden="true">↻</span> {STALE_NOTICE}
          </p>
          <p className={styles.staleDetail}>
            该报告绑定 model_version {report.model_version} / revision {report.revision}，
            已落后于当前对象版本，不作为通过依据。
          </p>
        </div>
      ) : null}

      {showResult && report !== null ? (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryItem}>
              通过 <strong className="numeric">{report.summary.pass}</strong>
            </span>
            <span className={styles.summaryItem}>
              失败 <strong className="numeric">{report.summary.fail}</strong>
            </span>
            <span className={styles.summaryItem}>
              未覆盖 <strong className="numeric">{report.summary.not_covered}</strong>
            </span>
            <span className={styles.summaryMeta}>
              {report.kernel_version} · {report.validation_profile}
            </span>
          </div>

          {report.summary.fail > 0 ? (
            <p className={styles.failWarning} role="alert">
              <span aria-hidden="true">✕</span> 存在失败项，不能判定为通过。
            </p>
          ) : null}

          <ul className={styles.items}>
            {report.items.map((item) => (
              <li key={item.check_id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <StatusBadge status={item.status} />
                </div>
                <dl className={styles.compare}>
                  <div>
                    <dt>期望</dt>
                    <dd>{item.expected}</dd>
                  </div>
                  <div>
                    <dt>实际</dt>
                    <dd>{item.actual}</dd>
                  </div>
                </dl>
                {item.detail === null ? null : <p className={styles.detail}>{item.detail}</p>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}