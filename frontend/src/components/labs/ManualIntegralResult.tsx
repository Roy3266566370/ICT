import type { LabProblem } from '@/labs/types';
import { Formula } from '@/components/showcase/Formula';
import { MathText } from './ProblemText';
import styles from './ManualLabComposer.module.css';

export function ManualIntegralResult({ problem, params }: { problem: LabProblem; params: Record<string, unknown> }): JSX.Element | null {
  const input = problem.manual_input;
  if (!input) return null;
  const changed = (input.task === 'integral' ? ['lower', 'upper'] : ['c'])
    .some(key => params[key] !== problem.model.defaults[key]);
  return <section className={styles.confirmation} aria-label="原题计算结果与过程">
    <h3>原题计算结果与过程</h3>
    <p>用户已确认原题条件 · 本地内核计算</p>
    <div className={styles.formula}><Formula tex={`${input.latex}=${input.result_latex}`} block /></div>
    <p role="status">{changed ? '当前图形为修改后的实验，以下保留原题结果。点击“恢复原题”可返回已确认条件。'
      : '当前图形对应已确认的原题；演示参数可调，数值近似与原题结果分开显示。'}</p>
    <details open><summary>查看内核计算步骤</summary>
      <ol>{problem.solution.steps.map(step => <li key={step.id}>
        <strong>{step.title}</strong><p><MathText text={step.detail} /></p>
        {step.latex ? <div className={styles.formula}><Formula tex={step.latex} block /></div> : null}
      </li>)}</ol>
    </details>
    <p>步骤展示内核提供的计算摘要与核对依据；图形和数值近似用于辅助观察。</p>
  </section>;
}
