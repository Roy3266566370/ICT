import { useState } from 'react';
import type { ValidationReport } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

interface Props {
  report: ValidationReport | null;
  busy: boolean;
  enabled: boolean;
  onRun: (autoRepair: boolean) => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  source: '来源与语义',
  math: '数学/程序',
  program: '程序/视图契约',
  interaction: '交互行为',
  visual: '浏览器与视觉',
};

const STATUS_LABEL: Record<string, string> = {
  pass: '通过',
  fail: '失败',
  warn: '告警',
  not_covered: '未覆盖',
};

export function ValidationPanel({ report, busy, enabled, onRun }: Props) {
  const [autoRepair, setAutoRepair] = useState(true);
  const grouped = new Map<string, NonNullable<ValidationReport['rules']>>();
  report?.rules.forEach((rule) => {
    const list = grouped.get(rule.category) ?? [];
    list.push(rule);
    grouped.set(rule.category, list);
  });
  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-validation-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-validation-title">4 · 自动验收与有限修复</h2>
          <p>来源、计算、程序、交互与浏览器证据分别记录。截图正常不代表结果正确；未执行浏览器试玩会明确标为未覆盖。</p>
        </div>
        {report ? <span className={styles.badge} data-status={report.status}>{report.status}</span> : <span className={styles.badge}>尚未验收</span>}
      </header>
      <div className={styles.panelBody}>
        {!enabled ? <p className={styles.empty}>验收需要先编译一个可执行 bundle。</p> : (
          <div className={styles.row}>
            <label className={styles.confirmLine}>
              <input type="checkbox" checked={autoRepair} onChange={(event) => setAutoRepair(event.target.checked)} />
              失败时允许一次有检查依据的自动修复（候选副本）
            </label>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => onRun(autoRepair)}>
              {busy ? '验收中…' : '运行验收'}
            </button>
          </div>
        )}
        {report ? (
          <>
            <div className={styles.metrics}>
              <div>通过<b>{report.summary.pass}</b></div>
              <div>失败<b>{report.summary.fail}</b></div>
              <div>告警<b>{report.summary.warn}</b></div>
              <div>未覆盖<b>{report.summary.not_covered}</b></div>
            </div>
            <p className={styles.source}>
              <b>报告 {report.report_id}</b>
              <span>bundle {report.bundle_hash.slice(0, 16)}… · branch {report.branch_hash ? `${report.branch_hash.slice(0, 16)}…` : '—'}</span>
              <span>kernel {report.kernel_version} · runtime {report.runtime_version}</span>
              <span>浏览器：{report.browser.status === 'skipped' ? '未执行（未覆盖）' : report.browser.status} {report.browser.note ?? ''}</span>
            </p>
            {[...grouped.entries()].map(([category, rules]) => (
              <div key={category}>
                <h3 className={styles.groupTitle}>{CATEGORY_LABEL[category] ?? category}</h3>
                <ul className={styles.checks}>
                  {rules.map((rule) => (
                    <li key={rule.rule_id} data-status={rule.status}>
                      <b>{rule.rule_id}</b>
                      <span>{rule.message}</span>
                      <span className={styles.badge} data-status={rule.status}>{STATUS_LABEL[rule.status] ?? rule.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {report.semantic_review.length > 0 ? (
              <>
                <h3 className={styles.groupTitle}>需要人工核对</h3>
                <ul className={styles.reviews}>
                  {report.semantic_review.map((item) => (
                    <li key={item.item_id} data-required={item.required ? 'true' : 'false'}>⚠ {item.prompt}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {report.repair ? (
              <p className={styles.source}>
                <b>有限修复记录</b>
                <span>{String(report.repair.status)} · {Array.isArray(report.repair.fixes) ? report.repair.fixes.join('；') : ''}</span>
                <span>{report.repair.after_status ? `修复后报告：${String(report.repair.after_status)}` : ''}</span>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

export default ValidationPanel;
