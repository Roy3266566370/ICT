import { useMemo } from 'react';
import type { HeapResult } from '../../labs/heap';
import { auditManualSiftDown, type SiftPick } from '../../labs/graphManual';
import { useManualState } from './manualState';
import type { LabSelection } from './LabCanvas';
import styles from './HeapCanvas.module.css';

interface Props {
  result: HeapResult;
  step: number;
  selected?: LabSelection | null;
  onSelect?: (selection: LabSelection | null) => void;
  /** 「我来 ✋」手动下滤轨迹的持久化切片（LabState.manual.heap）。 */
  saved?: { mode?: boolean; picks?: SiftPick[] };
  onSave?: (value: unknown) => void;
  /** 分享只读回放：展示学生轨迹与审计，不提供编辑。 */
  readOnly?: boolean;
}

interface HeapManual { mode: boolean; picks: SiftPick[] }

const PICK_LABEL: Record<SiftPick, string> = { left: '与左孩子交换', right: '与右孩子交换', stop: '停止下滤' };

export function HeapCanvas({ result, step, selected, onSelect, saved, onSave, readOnly }: Props) {
  const frame = result.frames[Math.max(0, Math.min(result.frames.length - 1, Math.round(step)))];
  const [hm, setHm] = useManualState<HeapManual>(
    saved as HeapManual | undefined, onSave, { mode: false, picks: [] });
  const ro = readOnly === true;
  const manualAvailable = result.status === 'ok' && result.initialHeap.length > 0 && result.deletionCount > 0;
  const manualMode = manualAvailable && (ro ? saved?.mode === true : hm.mode);
  const picks = hm.picks;
  const audit = useMemo(
    () => auditManualSiftDown(result.initialHeap, result.heapType, result.deletionCount, picks),
    [result.deletionCount, result.heapType, result.initialHeap, picks],
  );
  // 手动模式展示「下一个决策点」的数组：下滤中途即当前数组；删除间隙是已补位的预览。
  const displayArray = manualMode ? (audit.pending?.array ?? audit.array) : frame?.array ?? [];
  const displayDeleted = manualMode
    ? audit.deletions.filter((row) => row.finished).map((row) => row.deleted)
    : frame?.deleted ?? [];
  const activeIndex = manualMode ? audit.pending?.index ?? null : null;
  if (!frame && !manualMode) return <div className={styles.empty} role="status">{result.reason || '等待核对初始堆与删除次数。'}</div>;
  const levels = Math.max(1, Math.ceil(Math.log2(displayArray.length + 1)));
  const width = Math.max(680, 2 ** (levels - 1) * 70);
  const height = levels * 88 + 30;
  const position = (index: number) => {
    const level = Math.floor(Math.log2(index + 1));
    const offset = index - (2 ** level - 1);
    return { x: ((offset + 0.5) / 2 ** level) * width, y: 43 + level * 88 };
  };
  const isActive = (index: number) => manualMode ? index === activeIndex : (frame?.swapped_indices.includes(index) ?? false);
  const isChild = (index: number) =>
    manualMode && activeIndex !== null && (index === activeIndex * 2 + 1 || index === activeIndex * 2 + 2);
  const select = (index: number) => onSelect?.({ id: `heap-${index}`, label: `下标 ${index}：${displayArray[index]}`, kind: 'heap_node' });
  const heapValidNow = manualMode
    ? audit.deletions.length === 0 || audit.deletions[audit.deletions.length - 1]!.valid
    : frame?.heap_valid ?? false;
  const choose = (pick: SiftPick): void => setHm((m) => ({ ...m, picks: [...m.picks, pick] }));
  const matchesKernel = audit.complete && audit.array.join(',') === result.finalHeap.join(',');
  return (
    <section className={styles.canvas} aria-label="二叉堆删除堆顶实验">
      <div className={styles.heading}>
        <strong>{result.heapType === 'max' ? '大根堆' : '小根堆'} · 第 {manualMode ? Math.min(audit.deletions.length, result.deletionCount) : (frame?.deletion ?? 0)} / {result.deletionCount} 次删除</strong>
        <div className={styles.modeRow}>
          {manualAvailable && !ro ? (
            <>
              <button type="button" className={styles.modeBtn} data-current={!manualMode || undefined} onClick={() => setHm((m) => ({ ...m, mode: false }))}>内核推演</button>
              <button type="button" className={styles.modeBtn} data-current={manualMode || undefined} onClick={() => setHm((m) => ({ ...m, mode: true }))}>我来手动下滤 ✋</button>
            </>
          ) : null}
          <span className={heapValidNow ? styles.valid : styles.pending}>
            {manualMode ? (heapValidNow ? '当前堆序成立' : '堆序已破坏 · 观察后果') : (heapValidNow ? '堆序成立' : '筛选中 · 堆序待恢复')}
          </span>
        </div>
      </div>
      <div className={styles.tree}>
        {displayArray.length ? <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width > 1000 ? width : undefined }} role="img" aria-label={`当前堆的层序数组：${displayArray.join(', ')}`}>
          {displayArray.slice(1).map((_, offset) => {
            const child = offset + 1;
            const from = position(Math.floor((child - 1) / 2));
            const to = position(child);
            return <line key={`edge-${child}`} x1={from.x} y1={from.y + 23} x2={to.x} y2={to.y - 23} className={styles.edge} />;
          })}
          {displayArray.map((value, index) => {
            const { x, y } = position(index);
            return <g key={index} className={`${styles.node} ${isActive(index) ? styles.active : ''} ${isChild(index) ? styles.child : ''} ${selected?.id === `heap-${index}` ? styles.selected : ''}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`下标 ${index}，值 ${value}`} onClick={() => select(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(index); } }}>
              <circle r="24" /><text textAnchor="middle" dy="5">{value}</text><text className={styles.index} textAnchor="middle" y="42">[{index}]</text>
            </g>;
          })}
        </svg> : <p className={styles.empty}>空堆 · 所有元素已删除</p>}
      </div>
      <div className={styles.array} aria-label="当前层序数组">
        {displayArray.map((value, index) => <button key={index} type="button" className={isActive(index) ? styles.arrayActive : ''} aria-label={`数组下标 ${index}，值 ${value}`} onClick={() => select(index)}><small>{index}</small><strong>{value}</strong></button>)}
      </div>
      {manualMode ? (
        <div className={styles.manual}>
          <p className={styles.action}>
            {audit.pending ? (
              <strong>第 {audit.pending.deletion} 次删除 · 堆顶 {audit.pending.deleted} 已移除{audit.pending.index === 0 && audit.deletions.filter((row) => row.finished).length === audit.pending.deletion - 1 ? '，末位已补到根' : ''}——下标 {audit.pending.index} 的值 {audit.pending.array[audit.pending.index]} 下一步怎么办？</strong>
            ) : audit.complete ? (
              <strong>全部 {result.deletionCount} 次删除完成。</strong>
            ) : null}
          </p>
          {ro ? null : (
            <div className={styles.queue}>
              {(['left', 'right', 'stop'] as const).map((pick) => (
                <button key={pick} type="button" className={styles.pickBtn} disabled={!audit.pending}
                  onClick={() => choose(pick)}>
                  {PICK_LABEL[pick]}
                </button>
              ))}
              <button type="button" className={styles.pickBtn} disabled={!picks.length}
                onClick={() => setHm((m) => ({ ...m, picks: m.picks.slice(0, -1) }))}>撤销一步</button>
              <button type="button" className={styles.pickBtn} disabled={!picks.length}
                onClick={() => setHm((m) => ({ ...m, picks: [] }))}>重来</button>
            </div>
          )}
          {audit.steps.length ? (
            <div className={styles.stepList}>
              {audit.steps.map((item, index) => (
                <div key={index} data-ok={item.ok || undefined}>
                  第 {item.deletion} 次 · 下标 {item.index}：{PICK_LABEL[item.pick]}
                  {item.error ? <span>　{item.error}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          <ul className={styles.issues} role={audit.errors.length ? 'alert' : undefined}>
            {audit.errors.map((error, index) => <li key={index}>{error}</li>)}
            {audit.warnings.map((warning, index) => <li key={`w${index}`} className={styles.warn}>{warning}</li>)}
          </ul>
          {audit.complete ? (
            <p className={styles.summary}>
              {matchesKernel
                ? '你的手动删除过程与内核完全一致，堆序恢复。'
                : `完成，但你的堆 [${audit.array.join(', ')}] 与内核结果 [${result.finalHeap.join(', ')}] 不同——对照上面的标记找出分歧。`}
            </p>
          ) : null}
        </div>
      ) : frame ? (
        <p className={styles.action}><strong>{frame.label}</strong>　{frame.detail}</p>
      ) : null}
      <div className={styles.deleted}>已删除：{displayDeleted.join(' → ') || '暂无'}<span>数组下标从 0 开始，树与数组来自同一{manualMode ? '手动' : '执行'}轨迹。</span></div>
      <ol className={styles.code} aria-label="删除堆顶伪代码">{result.pseudocode.map((line, index) => <li key={line} className={!manualMode && frame?.pseudocodeLine === index + 1 ? styles.currentLine : ''}>{line}</li>)}</ol>
    </section>
  );
}
