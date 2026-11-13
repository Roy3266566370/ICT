/**
 * QueuePanel.tsx —— bfs_flow 的队列 / 访问序列 / 跳过判定 / 不可达节点（R8-AC2 / R8-AC4 / R8-AC5）
 *
 * 关键约束：
 *  - `skip` 轨迹逐条列出（含枚举原因 already_visited / already_queued / not_adjacent），
 *    D 的第二次入队尝试必须能看到一条 `skip / already_queued` 记录，不能静默（R8-AC2）。
 *  - `rejected_edges` 的中文原因与 skip 轨迹并排展示：枚举给机器，reason 给人读。
 *  - 不可达节点单独成块；`unvisited` 为空时明确写"全部节点可达"，不与"无数据"混同（§2.3.6）。
 *  - 有环只提示、不报错：BFS 靠 visited / 队列判定自然终止（R8-AC3、R8-AC7）。
 */
import type { BfsRejectedEdge, BfsStep } from '@/api/types';
import styles from './bfs.module.css';

export interface QueuePanelProps {
  /** 当前步之后的队列内容（来自契约的 queue_after） */
  queue: readonly string[];
  /** 当前进度下的已访问（出队）序列 */
  visited: readonly string[];
  /** 全程入队序列（同一节点只出现一次） */
  enqueueOrder: readonly string[];
  /** 内核最终访问序列 */
  order: readonly string[];
  unvisited: readonly string[];
  trace: readonly BfsStep[];
  rejectedEdges: readonly BfsRejectedEdge[];
  hasCycle: boolean;
  terminatedReason: 'completed' | 'max_steps_reached';
  maxSteps: number;
}

const SKIP_REASON_TEXT: Record<'already_visited' | 'already_queued' | 'not_adjacent', string> = {
  already_visited: '节点已访问（visited 中已存在）',
  already_queued: '节点已在队列中（不重复入队）',
  not_adjacent: '不是当前节点的邻居',
};

/** 访问 / 入队序列用逗号展示，与验收描述的「访问序列 A,B,C,D」逐字可核对。 */
function listText(values: readonly string[], emptyText: string): string {
  return values.length === 0 ? emptyText : values.join(', ');
}

export default function QueuePanel(props: QueuePanelProps) {
  const {
    queue,
    visited,
    enqueueOrder,
    order,
    unvisited,
    trace,
    rejectedEdges,
    hasCycle,
    terminatedReason,
    maxSteps,
  } = props;

  const skipSteps = trace.filter((step) => step.kind === 'skip');

  return (
    <section className={styles.card} aria-label="队列与访问序列">
      <h3 className={styles.cardTitle}>
        队列与访问
        <span className={styles.cardTitleMeta}>队列快照来自内核的 queue_after</span>
      </h3>

      <div className={styles.queueBlock}>
        <h4 className={styles.subTitle}>当前队列（先进先出）</h4>
        {queue.length === 0 ? (
          <p className={styles.emptyNote} role="status">
            队列为空（BFS 已结束，或尚未入队任何节点）。
          </p>
        ) : (
          <ol className={styles.queueList} aria-label="当前队列内容">
            {queue.map((node, index) => (
              <li key={`${node}-${index}`} className={styles.queueItem}>
                <span className={styles.queueIndex}>{index + 1}</span>
                <span className={styles.queueNode}>{node}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <dl className={styles.statsList}>
        <div className={styles.statsRow}>
          <dt>当前已访问</dt>
          <dd>{listText(visited, '尚未出队任何节点')}</dd>
        </div>
        <div className={styles.statsRow}>
          <dt>最终访问序列</dt>
          <dd className={styles.statsStrong}>{listText(order, '（空）')}</dd>
        </div>
        <div className={styles.statsRow}>
          <dt>入队序列</dt>
          <dd>{listText(enqueueOrder, '（空）')}</dd>
        </div>
        <div className={styles.statsRow}>
          <dt>终止原因</dt>
          <dd>
            {terminatedReason === 'completed' ? 'completed（正常执行完毕）' : `max_steps_reached（命中防御上限 ${maxSteps} 步）`}
          </dd>
        </div>
      </dl>

      {terminatedReason === 'max_steps_reached' ? (
        <p className={styles.warnNote} role="alert">
          ⚠ 轨迹因命中防御性步数上限 {maxSteps} 被截断——这不是环导致的死循环；
          有环图同样会因 visited / 队列判定而自然终止。
        </p>
      ) : null}

      <div className={styles.queueBlock}>
        <h4 className={styles.subTitle}>跳过判定（skip 轨迹，逐条列出）</h4>
        {skipSteps.length === 0 ? (
          <p className={styles.emptyNote} role="status">
            本次遍历没有出现跳过判定。
          </p>
        ) : (
          <ul className={styles.skipList}>
            {skipSteps.map((step) => {
              if (step.kind !== 'skip') return null;
              return (
                <li key={`skip-${step.index}`} className={styles.skipItem}>
                  <span className={styles.skipIndex}>#{step.index}</span>
                  <span className={styles.skipKind}>skip / {step.reason}</span>
                  <span className={styles.skipText}>
                    节点 <strong>{step.node}</strong>（来自 {step.from}）——
                    {SKIP_REASON_TEXT[step.reason]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {rejectedEdges.length === 0 ? null : (
          <ul className={styles.rejectedList} aria-label="被拒绝的边及原因">
            {rejectedEdges.map((edge, index) => (
              <li key={`rejected-${index}`} className={styles.rejectedItem}>
                <span className={styles.mono}>
                  {edge.from} → {edge.to}
                </span>
                <span>{edge.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.queueBlock}>
        <h4 className={styles.subTitle}>不可达节点</h4>
        {unvisited.length === 0 ? (
          <p className={styles.okNote} role="status">
            ✓ 全部节点可达（unvisited 为空，不是"无数据"）。
          </p>
        ) : (
          <p className={styles.warnNote} role="status">
            ⚠ 以下节点不可达，保持未访问状态：{unvisited.join('、')}
          </p>
        )}
      </div>

      {hasCycle ? (
        <p className={styles.cycleNote} role="status">
          <span aria-hidden="true">⟲</span>
          检测到环：BFS 允许访问已访问节点，仅跳过（不阻止执行，也不会死循环）。
        </p>
      ) : null}
    </section>
  );
}