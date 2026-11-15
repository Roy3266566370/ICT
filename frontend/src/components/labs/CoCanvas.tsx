import type { ReactNode } from 'react';
import type { CoResult, CoResultFrame } from '@/labs/compOrg';
import styles from './LabCanvas.module.css';

function bitRows(frame: CoResultFrame): { label: string; bits: string }[] {
  const rows: { label: string; bits: string }[] = [];
  for (const [key, value] of Object.entries(frame.values ?? {})) {
    if (typeof value !== 'string') continue;
    const compact = value.replace(/[\s_]/g, '');
    if (/^[01]{4,64}$/.test(compact)) rows.push({ label: key, bits: compact });
  }
  return rows.slice(0, 4);
}

function BitRegister({ label, bits }: { label: string; bits: string }): ReactNode {
  return (
    <div className={styles.coBitRow}>
      <span className={styles.coBitLabel}>{label}</span>
      <div className={styles.coBits}>
        {bits.split('').map((bit, index) => (
          <span key={`${label}-${index}`} className={styles.coBit} data-on={bit === '1' || undefined}>{bit}</span>
        ))}
      </div>
    </div>
  );
}

/** 计算机组成原理回放：位串/编码网格 + 帧状态 + 伪代码。 */
export function CoCanvas({ result, step }: { result: CoResult; step: number }): ReactNode {
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame = result.frames[index] ?? result.frames[0]!;
  const stateEntries = Object.entries(frame.values ?? {});
  const rows = bitRows(frame);
  return (
    <div className={styles.bfsState} data-co-kind={result.coKind}>
      {rows.length ? <div className={styles.coBitPanel}>
        <span className={styles.stateTitle}>位串 / 编码</span>
        {rows.map((row) => <BitRegister key={row.label} label={row.label} bits={row.bits} />)}
      </div> : null}
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}>{frame.label}</span>
        <p className={styles.orderText}>{frame.detail}</p>
        <div className={styles.chipRow}>
          {stateEntries.map(([key, value]) => (
            <span key={key} className={styles.visitedChip}>
              {key}：{String(value)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}>结论</span>
        <p className={styles.orderText}>{result.answer || result.headline}</p>
      </div>
      <div className={styles.pseudocode} aria-label="伪代码">
        {result.pseudocode.map((line, lineIndex) => (
          <code key={lineIndex} data-active={frame.pseudocodeLine === lineIndex + 1 || undefined}>
            <i>{lineIndex + 1}</i>
            {line}
          </code>
        ))}
      </div>
    </div>
  );
}
