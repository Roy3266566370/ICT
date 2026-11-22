import { useMemo, useState, type ReactNode } from 'react';
import { MathText } from './ProblemText';
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

const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
const STAGE_COLORS: Record<string, string> = {
  IF: '#4f46e5',
  ID: '#0d9488',
  EX: '#d97706',
  MEM: '#7c3aed',
  WB: '#15803d',
  STALL: '#dc2626',
};

/** 借鉴 cpu-pipeline-simulator 的五级流水线时空甘特图（含冒险阻塞与前递开关）。 */
function PipelineGanttPanel({ frame, step }: { frame: CoResultFrame; step: number }): ReactNode {
  const [forwarding, setForwarding] = useState(true);
  const values = frame.values ?? {};
  const hasHazard =
    /冒险|hazard|stall|阻塞|气泡|冲突/i.test(`${frame.label ?? ''} ${frame.detail ?? ''} ${JSON.stringify(values)}`);
  const stallCycles = hasHazard ? (forwarding ? 1 : 2) : 0;
  const instructions = ['I1 (LOAD/ADD)', 'I2 (相关指令)', 'I3 (后续指令)', 'I4 (后续指令)'];
  const totalCycles = 8 + stallCycles;
  const activeCycle = Math.min(totalCycles, Math.max(1, step + 1));

  const stageAt = (instIdx: number, cycle: number): string | null => {
    const start = instIdx + 1 + (instIdx >= 1 ? stallCycles : 0);
    if (instIdx === 1 && stallCycles > 0 && cycle >= 2 && cycle < 2 + stallCycles) {
      return 'STALL';
    }
    const offset = cycle - start;
    if (offset >= 0 && offset < STAGES.length) return STAGES[offset]!;
    return null;
  };

  return (
    <div className={styles.coBitPanel} aria-label="流水线时空图">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className={styles.stateTitle}>五级流水线时空图（当前周期 T{activeCycle}）</span>
        {hasHazard ? (
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={forwarding}
              onChange={(e) => setForwarding(e.target.checked)}
            />
            启用数据前递（Forwarding）
          </label>
        ) : null}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-family-mono)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid rgba(15,23,42,0.12)' }}>指令</th>
              {Array.from({ length: totalCycles }, (_, i) => (
                <th
                  key={i}
                  style={{
                    padding: '4px 5px',
                    textAlign: 'center',
                    borderBottom: '1px solid rgba(15,23,42,0.12)',
                    background: i + 1 === activeCycle ? 'rgba(79,70,229,0.14)' : undefined,
                    color: i + 1 === activeCycle ? '#4f46e5' : undefined,
                  }}
                >
                  T{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instructions.map((inst, instIdx) => (
              <tr key={inst}>
                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>{inst}</td>
                {Array.from({ length: totalCycles }, (_, cIdx) => {
                  const stage = stageAt(instIdx, cIdx + 1);
                  const isCurrent = cIdx + 1 === activeCycle;
                  return (
                    <td
                      key={cIdx}
                      style={{
                        padding: '3px 4px',
                        textAlign: 'center',
                        borderBottom: '1px solid rgba(15,23,42,0.06)',
                        background: isCurrent ? 'rgba(79,70,229,0.08)' : undefined,
                      }}
                    >
                      {stage ? (
                        <span
                          style={{
                            display: 'inline-block',
                            minWidth: 32,
                            padding: '1px 5px',
                            borderRadius: 4,
                            color: '#fff',
                            fontWeight: 600,
                            background: STAGE_COLORS[stage] ?? '#475569',
                            opacity: isCurrent ? 1 : 0.78,
                          }}
                        >
                          {stage}
                        </span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 借鉴 Cache-Simulator 的地址位段拆解沙盒（Tag | Index | Offset）。 */
function CacheAddressInspector({ frame }: { frame: CoResultFrame }): ReactNode {
  const [addrInput, setAddrInput] = useState('0x1A4C');
  const widths = useMemo(() => {
    const raw = JSON.stringify(frame.values ?? {});
    const pick = (pattern: RegExp, fallback: number): number => {
      const m = raw.match(pattern);
      const val = m ? Number(m[1]) : NaN;
      return Number.isFinite(val) && val > 0 && val <= 32 ? Math.round(val) : fallback;
    };
    const offset = pick(/(?:offset|块内|字内|页内)[^0-9]{0,8}(\d{1,2})/i, 6);
    const index = pick(/(?:index|组号|行号|索引)[^0-9]{0,8}(\d{1,2})/i, 6);
    const tag = pick(/(?:tag|标记|标志)[^0-9]{0,8}(\d{1,2})/i, 20);
    return { tag, index, offset, total: Math.min(32, tag + index + offset) };
  }, [frame.values]);

  const parsed = useMemo(() => {
    const cleaned = addrInput.trim();
    if (!cleaned) return null;
    const num = /^0x/i.test(cleaned) ? Number.parseInt(cleaned, 16) : Number.parseInt(cleaned, 10);
    if (!Number.isFinite(num) || num < 0) return null;
    const bin = (num >>> 0).toString(2).padStart(widths.total, '0').slice(-widths.total);
    const tagBits = bin.slice(0, widths.tag);
    const indexBits = bin.slice(widths.tag, widths.tag + widths.index);
    const offsetBits = bin.slice(widths.tag + widths.index);
    return {
      bin,
      tagBits,
      indexBits,
      offsetBits,
      tagVal: Number.parseInt(tagBits || '0', 2),
      indexVal: Number.parseInt(indexBits || '0', 2),
      offsetVal: Number.parseInt(offsetBits || '0', 2),
    };
  }, [addrInput, widths]);

  return (
    <div className={styles.coBitPanel} aria-label="Cache 地址位段拆解">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className={styles.stateTitle}>
          地址位段拆解（Tag {widths.tag}b · Index {widths.index}b · Offset {widths.offset}b）
        </span>
        <input
          value={addrInput}
          onChange={(e) => setAddrInput(e.target.value)}
          aria-label="试算访存地址"
          placeholder="如 0x1A4C 或 6732"
          style={{
            width: 120,
            padding: '2px 6px',
            fontSize: 11,
            fontFamily: 'var(--font-family-mono)',
            border: '1px solid rgba(15,23,42,0.2)',
            borderRadius: 4,
          }}
        />
      </div>
      {parsed ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, fontFamily: 'var(--font-family-mono)' }}>
          <span style={{ padding: '3px 7px', borderRadius: 5, background: 'rgba(79,70,229,0.12)', color: '#3730a3' }}>
            Tag = {parsed.tagBits} (0x{parsed.tagVal.toString(16).toUpperCase()})
          </span>
          <span style={{ padding: '3px 7px', borderRadius: 5, background: 'rgba(13,148,136,0.12)', color: '#115e59' }}>
            Index/组号 = {parsed.indexBits} (第 {parsed.indexVal} 组)
          </span>
          <span style={{ padding: '3px 7px', borderRadius: 5, background: 'rgba(217,119,6,0.12)', color: '#92400e' }}>
            Offset/块内 = {parsed.offsetBits} (+{parsed.offsetVal} B)
          </span>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>输入十进制或 0x 十六进制地址即可实时拆分位段。</p>
      )}
    </div>
  );
}

/** 计算机组成原理回放：位串/编码网格 + 流水线时空图 / Cache 地址拆解 + 帧状态 + 伪代码。 */
export function CoCanvas({ result, step }: { result: CoResult; step: number }): ReactNode {
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame = result.frames[index] ?? result.frames[0]!;
  const stateEntries = Object.entries(frame.values ?? {});
  const rows = bitRows(frame);
  return (
    <div className={styles.bfsState} data-co-kind={result.coKind}>
      {result.coKind === 'pipeline' ? <PipelineGanttPanel frame={frame} step={index} /> : null}
      {result.coKind === 'cache' || result.coKind === 'virtual_memory' ? (
        <CacheAddressInspector frame={frame} />
      ) : null}
      {rows.length ? <div className={styles.coBitPanel}>
        <span className={styles.stateTitle}>位串 / 编码</span>
        {rows.map((row) => <BitRegister key={row.label} label={row.label} bits={row.bits} />)}
      </div> : null}
      <div className={styles.stateBlock}>
        <span className={styles.stateTitle}><MathText text={String(frame.label ?? '')} /></span>
        <p className={styles.orderText}><MathText text={String(frame.detail ?? '')} /></p>
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
