import type { HeapResult } from '../../labs/heap';
import type { LabSelection } from './LabCanvas';
import styles from './HeapCanvas.module.css';

interface Props {
  result: HeapResult;
  step: number;
  selected?: LabSelection | null;
  onSelect?: (selection: LabSelection | null) => void;
}

export function HeapCanvas({ result, step, selected, onSelect }: Props) {
  const frame = result.frames[Math.max(0, Math.min(result.frames.length - 1, Math.round(step)))];
  if (!frame) return <div className={styles.empty} role="status">{result.reason || '等待核对初始堆与删除次数。'}</div>;
  const levels = Math.max(1, Math.ceil(Math.log2(frame.array.length + 1)));
  const width = Math.max(680, 2 ** (levels - 1) * 70);
  const height = levels * 88 + 30;
  const position = (index: number) => {
    const level = Math.floor(Math.log2(index + 1));
    const offset = index - (2 ** level - 1);
    return { x: ((offset + 0.5) / 2 ** level) * width, y: 43 + level * 88 };
  };
  const isActive = (index: number) => frame.swapped_indices.includes(index);
  const select = (index: number) => onSelect?.({ id: `heap-${index}`, label: `下标 ${index}：${frame.array[index]}`, kind: 'heap_node' });
  return (
    <section className={styles.canvas} aria-label="二叉堆删除堆顶实验">
      <div className={styles.heading}>
        <strong>{result.heapType === 'max' ? '大根堆' : '小根堆'} · 第 {frame.deletion} / {result.deletionCount} 次删除</strong>
        <span className={frame.heap_valid ? styles.valid : styles.pending}>{frame.heap_valid ? '堆序成立' : '筛选中 · 堆序待恢复'}</span>
      </div>
      <div className={styles.tree}>
        {frame.array.length ? <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width > 1000 ? width : undefined }} role="img" aria-label={`当前堆的层序数组：${frame.array.join(', ')}`}>
          {frame.array.slice(1).map((_, offset) => {
            const child = offset + 1;
            const from = position(Math.floor((child - 1) / 2));
            const to = position(child);
            return <line key={`edge-${child}`} x1={from.x} y1={from.y + 23} x2={to.x} y2={to.y - 23} className={styles.edge} />;
          })}
          {frame.array.map((value, index) => {
            const { x, y } = position(index);
            return <g key={index} className={`${styles.node} ${isActive(index) ? styles.active : ''} ${selected?.id === `heap-${index}` ? styles.selected : ''}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`下标 ${index}，值 ${value}`} onClick={() => select(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(index); } }}>
              <circle r="24" /><text textAnchor="middle" dy="5">{value}</text><text className={styles.index} textAnchor="middle" y="42">[{index}]</text>
            </g>;
          })}
        </svg> : <p className={styles.empty}>空堆 · 所有元素已删除</p>}
      </div>
      <div className={styles.array} aria-label="当前层序数组">
        {frame.array.map((value, index) => <button key={index} type="button" className={isActive(index) ? styles.arrayActive : ''} aria-label={`数组下标 ${index}，值 ${value}`} onClick={() => select(index)}><small>{index}</small><strong>{value}</strong></button>)}
      </div>
      <p className={styles.action}><strong>{frame.label}</strong>　{frame.detail}</p>
      <div className={styles.deleted}>已删除：{frame.deleted.join(' → ') || '暂无'}<span>数组下标从 0 开始，树与数组来自同一执行帧。</span></div>
      <ol className={styles.code} aria-label="删除堆顶伪代码">{result.pseudocode.map((line, index) => <li key={line} className={frame.pseudocodeLine === index + 1 ? styles.currentLine : ''}>{line}</li>)}</ol>
    </section>
  );
}
