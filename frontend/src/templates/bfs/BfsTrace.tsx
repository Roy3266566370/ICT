/**
 * BfsTrace.tsx —— bfs_flow 的逐步轨迹表（R8-AC5）
 *
 * 列：步骤号 / 动作 / 节点 / 队列快照。
 *  - 队列快照取契约的 `queue_after`；`skip` 步没有 queue_after，沿用上一步的队列并注明"队列不变"。
 *  - 当前游标所在行高亮（同时有 aria-current 与左侧色条，不只靠颜色）。
 *  - 每行可点击跳到该步，与「单步 / 连续播放」共用同一个游标。
 */
import type { BfsStep } from '@/api/types';
import styles from './bfs.module.css';

export interface BfsTraceProps {
  trace: readonly BfsStep[];
  startNodeId: string;
  /** 已完成的步数（0 = 尚未开始） */
  cursor: number;
  onSeek: (cursorAfterStep: number) => void;
}

interface Row {
  step: BfsStep;
  /** 该步执行后的队列快照 */
  queue: string[];
  /** skip 步队列不变 */
  queueUnchanged: boolean;
}

function buildRows(trace: readonly BfsStep[], startNodeId: string): Row[] {
  let queue: string[] = startNodeId === '' ? [] : [startNodeId];
  return trace.map((step) => {
    const queueUnchanged = step.kind === 'skip';
    if (step.kind === 'dequeue' || step.kind === 'enqueue') {
      queue = [...step.queue_after];
    }
    return { step, queue, queueUnchanged };
  });
}

function actionLabel(step: BfsStep): string {
  if (step.kind === 'dequeue') return '出队';
  if (step.kind === 'enqueue') return '入队';
  return `跳过 · ${step.reason}`;
}

function actionDetail(step: BfsStep): string {
  if (step.kind === 'dequeue') return '此刻标记 visited';
  if (step.kind === 'enqueue') return `触发者 ${step.from}`;
  return `触发者 ${step.from}，不入队`;
}

export default function BfsTrace({ trace, startNodeId, cursor, onSeek }: BfsTraceProps) {
  const rows = buildRows(trace, startNodeId);

  if (rows.length === 0) {
    return (
      <p className={styles.emptyNote} role="status">
        轨迹为空：没有可执行的节点（请检查起点是否存在、图中是否有节点）。
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.tableCaption}>
          逐步轨迹：每一步的动作、节点与执行后的队列快照（队列长度递减说明 BFS 正在推进）
        </caption>
        <thead>
          <tr>
            <th scope="col">步骤</th>
            <th scope="col">动作</th>
            <th scope="col">节点</th>
            <th scope="col">队列快照（执行后）</th>
            <th scope="col">定位</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const active = index === cursor - 1;
            return (
              <tr
                key={`trace-${row.step.index}-${index}`}
                className={active ? styles.traceRowActive : undefined}
                aria-current={active ? 'step' : undefined}
              >
                <td className={styles.mono}>#{row.step.index}</td>
                <td>
                  <span className={[styles.actionBadge, actionClass(row.step)].filter(Boolean).join(' ')}>
                    {actionLabel(row.step)}
                  </span>
                  <span className={styles.actionDetail}>{actionDetail(row.step)}</span>
                </td>
                <td className={styles.mono}>{row.step.node}</td>
                <td>
                  {row.queue.length === 0 ? (
                    <span className={styles.queueEmptyInline}>（空）</span>
                  ) : (
                    <span className={styles.mono}>{row.queue.join(' → ')}</span>
                  )}
                  {row.queueUnchanged ? <span className={styles.actionDetail}>队列不变</span> : null}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.seekButton}
                    onClick={() => onSeek(index + 1)}
                    aria-label={`跳到第 ${index + 1} 步（${actionLabel(row.step)} ${row.step.node}）`}
                  >
                    {active ? '当前' : `跳到 ${index + 1}`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 三种动作各用一种徽标：出队=靛蓝、入队=绿、跳过=橙（文字已写明，颜色只作辅助）。 */
function actionClass(step: BfsStep): string | undefined {
  if (step.kind === 'dequeue') return styles.actionDequeue;
  if (step.kind === 'enqueue') return styles.actionEnqueue;
  return styles.actionSkip;
}