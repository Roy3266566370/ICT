import type { BranchState, Experiment } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

interface Props {
  current: BranchState | null;
  branches: Record<string, unknown>[];
  experiments: Experiment[];
  onOpenBranch: (branchId: string) => void;
  onOpenExperiment: (experimentId: string) => void;
  busy?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  found: '找到结果',
  not_found_in_scope: '范围内未发现',
  unknown: '未知',
  timeout: '超时',
  infeasible_proven: '已证无解',
};

export function ExperimentBranches({ current, branches, experiments, onOpenBranch, onOpenExperiment, busy }: Props) {
  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-branches-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-branches-title">3 · 分支与实验历史</h2>
          <p>原稿基线、当前探索与补充实验分开保存。打开分支只读取它的权威 revision；应用候选必须由你显式操作。</p>
        </div>
        {current ? <span className={styles.badge}>当前 revision {current.revision}</span> : null}
      </header>
      <div className={styles.panelBody}>
        <h3 className={styles.groupTitle}>分支</h3>
        <ul className={styles.list}>
          {branches.map((branch) => {
            const id = String(branch.branch_id ?? '');
            const isCurrent = id === current?.branch_id;
            const kind = String(branch.kind ?? 'candidate');
            const kindLabel = kind === 'baseline' ? '课件基准' : kind === 'practice' ? '个人练习' : '候选分支';
            return (
              <li key={id} className={styles.listItem}>
                <div>
                  <b>{isCurrent ? '当前分支' : kindLabel} · {String(branch.title || id).slice(0, 28)}</b>
                  <small>{kindLabel} · revision {String(branch.revision ?? '—')} · {String(branch.status ?? '')} · {String(branch.updated_at ?? '')}</small>
                </div>
                <button type="button" className={styles.button} disabled={busy || isCurrent} onClick={() => onOpenBranch(id)}>
                  {isCurrent ? '已打开' : '打开'}
                </button>
              </li>
            );
          })}
          {branches.length === 0 ? <li className={styles.empty}>还没有分支。</li> : null}
        </ul>
        <h3 className={styles.groupTitle}>补充实验</h3>
        <ul className={styles.list}>
          {experiments.map((experiment) => (
            <li key={experiment.experiment_id} className={styles.listItem}>
              <div>
                <b>{experiment.question}</b>
                <small>
                  {experiment.recipe_id} · {experiment.result ? STATUS_LABEL[experiment.result.status] ?? experiment.result.status : experiment.status}
                  {experiment.result ? ` · 候选 ${experiment.result.candidate_count}` : ''}
                </small>
                {experiment.result?.result_hash ? <small>result hash {experiment.result.result_hash.slice(0, 12)}…</small> : null}
              </div>
              <div className={styles.candidateActions}>
                <button type="button" className={styles.button} onClick={() => onOpenExperiment(experiment.experiment_id)}>详情</button>
                {experiment.result?.branch_id ? (
                  <button type="button" className={styles.button} onClick={() => onOpenBranch(experiment.result!.branch_id!)}>打开分支</button>
                ) : null}
              </div>
            </li>
          ))}
          {experiments.length === 0 ? <li className={styles.empty}>还没有补充实验。</li> : null}
        </ul>
      </div>
    </section>
  );
}

export default ExperimentBranches;
