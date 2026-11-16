import type { ReactNode } from 'react';
import type { NetworkResult, NetworkResultFrame } from '@/labs/network';
import styles from './LabCanvas.module.css';

function bitRows(frame: NetworkResultFrame): { label: string; bits: string }[] {
  const rows: { label: string; bits: string }[] = [];
  for (const [key, value] of Object.entries(frame.values ?? {})) {
    if (typeof value !== 'string') continue;
    const compact = value.replace(/[\s_]/g, '');
    if (/^[01]{4,128}$/.test(compact)) rows.push({ label: key, bits: compact });
  }
  return rows.slice(0, 5);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function genericText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' · ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
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

/** 计算机网络回放：分层/窗口/位串 + 当前帧状态 + 伪代码。 */
export function NetworkCanvas({ result, step }: { result: NetworkResult; step: number }): ReactNode {
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame = result.frames[index] ?? result.frames[0]!;
  const values = frame.values ?? {};
  const layers = stringList(values.layers);
  const tcpip = stringList(values.tcpip);
  const rows = bitRows(frame);
  const stateEntries = Object.entries(values).filter(([key]) => key !== 'layers' && key !== 'tcpip');
  return (
    <div className={styles.bfsState} data-net-kind={result.netKind}>
      {layers.length ? (
        <div className={styles.stateBlock}>
          <span className={styles.stateTitle}>分层结构</span>
          <div className={styles.chipRow}>
            {layers.map((layer, layerIndex) => (
              <span key={`${layer}-${layerIndex}`} className={styles.visitedChip}>{layerIndex + 1}. {layer}</span>
            ))}
          </div>
          {tcpip.length ? (
            <div className={styles.chipRow}>
              {tcpip.map((layer) => <span key={layer} className={styles.visitedChip}>{layer}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length ? (
        <div className={styles.coBitPanel}>
          <span className={styles.stateTitle}>码字 / 位串</span>
          {rows.map((row) => <BitRegister key={row.label} label={row.label} bits={row.bits} />)}
        </div>
      ) : null}
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}>{frame.label}</span>
        <p className={styles.orderText}>{frame.detail}</p>
        <div className={styles.chipRow}>
          {stateEntries.map(([key, value]) => (
            <span key={key} className={styles.visitedChip}>{key}：{genericText(value)}</span>
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

export default NetworkCanvas;
