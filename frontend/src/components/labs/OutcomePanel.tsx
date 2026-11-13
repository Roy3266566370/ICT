import type { ReactNode } from 'react';
import type { LabDocument, LabEvaluated, LabProblem, LabState } from '@/labs/types';
import styles from './labs.module.css';

const ENGINE_LABELS: Record<string, string> = {
  antiderivative_v1: '不定积分 · 原函数族',
  riemann_v1: '定积分 · 黎曼和',
  tangent_v1: '导数 · 切线',
  gradient_descent_v1: '梯度下降',
  bfs_v1: '广度优先搜索',
  mlp_v1: '小型全连接网络',
};

interface Props {
  open: boolean;
  lab: LabDocument;
  problem: LabProblem;
  state: LabState;
  saved: boolean;
  sharing: boolean;
  shareUrl: string | null;
  onClose: () => void;
  onShare: () => void;
}

function Item({ title, detail, count }: { title: string; detail: string; count?: string }): ReactNode {
  return (
    <div className={styles.outcomeItem}>
      <span className={styles.outcomeCheck} aria-hidden="true">
        ✓
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {count ? <span className={styles.outcomeCount}>{count}</span> : null}
    </div>
  );
}

function downloadJson(lab: LabDocument): void {
  const blob = new Blob([JSON.stringify(lab, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${lab.title.replace(/[\\/:*?"<>|]/g, '-') || '题目实验'}-学习成果.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function OutcomePanel({
  open,
  lab,
  problem,
  state,
  saved,
  sharing,
  shareUrl,
  onClose,
  onShare,
}: Props): ReactNode {
  if (!open) return null;
  const evaluated: LabEvaluated | null = state.evaluated;
  const traceCount = evaluated?.trace?.length ?? 0;
  const checks = problem.ai_solution?.computation?.checks ?? evaluated?.checks ?? [];
  const passed = checks.filter((item) => item.status === 'pass').length;
  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.outcomeDialog} role="dialog" aria-modal="true" aria-labelledby="lab-outcome-title">
        <header className={styles.modalHead}>
          <div>
            <span className={styles.eyebrow}>LEARNING RECORD</span>
            <h2 id="lab-outcome-title">本次学习成果</h2>
            <p>原题、识别条件、模型、解答、执行轨迹、探索情景与学生记录保存在同一份实验室文档中。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className={styles.outcomeBody}>
          <div className={styles.outcomeHero}>
            <span className={styles.outcomeIndex}>LAB / {lab.lab_id.slice(-8).toUpperCase()}</span>
            <strong>{problem.title}</strong>
            <p>
              {problem.subject_label} · 修订 {lab.revision} · {saved ? '已同步到服务端' : '有修改，正在保存或仅在本机'}
            </p>
          </div>
          <div className={styles.outcomeList}>
            <Item
              title="原题及来源"
              detail={`${problem.text.slice(0, 80)}${problem.text.length > 80 ? '…' : ''} 来源：${lab.source.citation}`}
            />
            <Item
              title="识别条件"
              detail={problem.ai_solution ? problem.ai_solution.conditions.join('；') : problem.recognition.conditions
                .slice(0, 5)
                .map((condition) => `${condition.label}=${String(condition.value)}`)
                .join('；')}
              count={`${problem.ai_solution?.conditions.length ?? problem.recognition.conditions.length} 项`}
            />
            <Item
              title={problem.ai_solution ? '解题结果来源' : '可操作模型'}
              detail={problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? 'AI 理解与建模，内核计算及模型回验。' : 'AI 参考解答，尚未通过内核独立核验。'
                : `${ENGINE_LABELS[problem.model.engine] ?? problem.model.engine} · 参数 ${problem.model.params.length} 个${
                problem.model.teaching ? ' · 含明确标注的教学示例' : ''
              }`}
            />
            <Item title="原题解答" detail={problem.ai_solution?.answer || problem.solution.answer || problem.solution.summary} />
            <Item
              title="执行轨迹"
              detail={
                problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? '内核计算与回验结果已随 AI 建模解答保存。' : 'AI 参考步骤已保存，不计入内核通过项。'
                  : evaluated?.status === 'ok'
                  ? `${evaluated.headline || '已保存执行记录'} · ${evaluated.stop_reason || '求解完成'}`
                  : evaluated?.status === 'blocked'
                    ? '关键条件尚未确认，暂不生成解答轨迹。'
                    : '等待保存后由确定性求解器生成轨迹。'
              }
              count={`${traceCount} 帧`}
            />
            <Item
              title="探索情景"
              detail={state.scenarios.map((scenario) => scenario.name).join('、') || '原题条件'}
              count={`${state.scenarios.length} 个`}
            />
            <Item
              title="学生记录"
              detail={`${state.notes ? `笔记 ${state.notes.length} 字 · ` : ''}${
                state.observations.length
              } 条观察 · ${state.attempts.length} 次尝试 · ${state.events.length} 条操作事件`}
            />
          </div>
          <div className={styles.outcomeChecks}>
            <span>校验摘要</span>
            <div>
              <strong>{passed}</strong> 项通过
              <span>·</span>
              <strong>{checks.length}</strong> 项检查
              {evaluated?.status === 'blocked' && (!problem.ai_solution || problem.ai_solution.verification === 'needs_review') ? <em>待核对条件</em> : null}
            </div>
          </div>
          {shareUrl ? (
            <div className={styles.shareResult}>
              <span>只读分享链接</span>
              <input readOnly value={`${window.location.origin}${shareUrl}`} onFocus={(event) => event.currentTarget.select()} />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}${shareUrl}`);
                }}
              >
                复制
              </button>
            </div>
          ) : null}
        </div>

        <footer className={styles.modalFooter}>
          <span>{problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? 'AI 建模结果由内核计算，题意条件请对照原题。' : '含 AI 参考解答，尚未经内核独立核验。'
            : '数值与轨迹来自确定性求解器；模型增强默认关闭。'}</span>
          <div>
            <button type="button" className={styles.textButton} onClick={() => downloadJson(lab)}>
              下载成果 JSON
            </button>
            <button type="button" className={styles.primaryButton} onClick={onShare} disabled={sharing}>
              {sharing ? '正在生成…' : shareUrl ? '重新生成分享' : '生成只读分享'}
            </button>
            <button type="button" className={styles.textButton} onClick={onClose}>
              关闭
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default OutcomePanel;
