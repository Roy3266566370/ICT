import type { LabProblem } from '@/labs/types';
import { Formula } from '@/components/showcase/Formula';
import { MathText } from './ProblemText';
import styles from './ManualLabComposer.module.css';

export function ManualIntegralResult({ problem, params }: { problem: LabProblem; params: Record<string, unknown> }): JSX.Element | null {
  const input = problem.manual_input;
  if (!input) return null;
  const status = input.result_status ?? 'complete';
  const changed = status === 'complete' && (input.task === 'integral' ? ['lower', 'upper'] : ['c'])
    .some(key => params[key] !== problem.model.defaults[key]);
  const formula = status === 'complete' && input.result_latex
    ? `${input.latex}=${input.result_latex}` : input.latex;
  const approx = input.result_approx && input.result_approx !== '—' ? input.result_approx : '';
  const verification = input.verification ?? problem.solution.verification ?? null;
  const verificationClass = verification ? {
    symbolic: styles.verificationSymbolic,
    numeric: styles.verificationNumeric,
    unconfirmed: styles.verificationUnconfirmed,
  }[verification.level] : '';
  return <section className={styles.confirmation} aria-label="原题计算结果与过程">
    <h3>原题计算结果与过程</h3>
    <p>用户已确认原题条件 · 本地内核计算</p>
    <div className={styles.formula}><Formula tex={formula} block /></div>
    {verification ? <p className={`${styles.verification} ${verificationClass}`} data-verification={verification.level} aria-label={verification.label}>
      <strong>{verification.label}</strong>
      {verification.level !== 'unconfirmed' ? <span>{verification.detail}</span> : null}
    </p> : null}
    {status === 'divergent' ? <p role="status">该定积分发散，不存在有限实数结果；不把柯西主值或原函数端点差当作积分值。</p> : null}
    {status === 'unsupported' ? <>
      <p role="status">{input.task === 'antiderivative'
        ? '当前内核未能给出可核验的闭式原函数，不把符号积分形式当作原题答案。'
        : '当前内核未能给出可信的闭式结果，不把数值参考当作原题答案。'}</p>
      {approx ? <p>数值参考：≈ {approx}</p> : null}
      {input.result_note ? <p>{input.result_note}</p> : null}
    </> : null}
    {status === 'complete' ? <p role="status">{changed ? '当前图形为修改后的实验，以下保留原题结果。点击“恢复原题”可返回已确认条件。'
      : '当前图形对应已确认的原题；演示参数可调，数值近似与原题结果分开显示。'}</p> : null}
    <details open><summary>查看内核计算步骤</summary>
      <ol>{problem.solution.steps.map(step => <li key={step.id}>
        <strong>{step.title}</strong><p><MathText text={step.detail} /></p>
        {step.latex ? <div className={styles.formula}><Formula tex={step.latex} block /></div> : null}
      </li>)}</ol>
    </details>
    <p>步骤展示内核提供的计算摘要与核对依据；图形和数值近似用于辅助观察。</p>
  </section>;
}
