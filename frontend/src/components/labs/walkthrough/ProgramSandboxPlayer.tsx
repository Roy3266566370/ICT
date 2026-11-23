import { useId, useMemo, useState } from 'react';
import type { PageLab } from '@/api/pptAI';
import { LabCanvas } from '@/components/ppt-ai/PageLabPanel';
import { formatNumber } from '../../../labs/expr';
import type { ProgramSandboxWalkthrough, WalkthroughVerificationStatus } from '../../../labs/walkthrough';
import { MathText } from '../ProblemText';
import { Formula } from '../primitives/Formula';
import { LabSlider } from '../primitives/controls';
import styles from './WalkthroughPlayer.module.css';

function Verification({ status, detail }: { status: WalkthroughVerificationStatus; detail?: string }) {
  return (
    <span className={styles.verification} data-status={status} title={detail}>
      {status === 'verified' ? '内核已验证' : '尚未通过验算'}
    </span>
  );
}

/** 实验室长尾题型沙箱视图播放器：复用 opaque-origin sandbox iframe + Worker + ViewAstRenderer。 */
export function ProgramSandboxPlayer({ walkthrough }: { walkthrough: ProgramSandboxWalkthrough }) {
  const { sandbox, steps, strategy, verification, title } = walkthrough;
  const titleId = useId();
  const [index, setIndex] = useState(0);

  const defaults = useMemo(
    () => Object.fromEntries(sandbox.params.map((item) => [item.id, item.default])),
    [sandbox.params],
  );
  const [values, setValues] = useState<Record<string, number>>(defaults);

  const syntheticLab = useMemo<PageLab>(
    () => ({
      version: 'ppt-ai.page-lab.3',
      page_no: 1,
      title,
      summary: strategy.why,
      explain: [],
      params: sandbox.params.map((item) => ({
        id: item.id,
        label: item.label,
        min: item.min,
        max: item.max,
        step: item.step,
        default: item.default,
        unit: item.unit ?? '',
      })),
      public_params: sandbox.params.map((item) => item.id),
      program: sandbox.program,
      content_hash: sandbox.content_hash,
      generator: { model: 'walkthrough-sandbox', attempts: 1 },
      created_at: '',
    }),
    [sandbox, strategy.why, title],
  );

  const step = steps[index];
  if (!step) {
    return <p role="status" className={styles.notice}>当前沙箱过程无法绘制，可在「结果」查看解题内容。</p>;
  }

  const checks = new Map(verification.checks.map((check) => [check.id, check]));

  const selectStep = (nextIndex: number) => {
    setIndex(nextIndex);
    const target = steps[nextIndex];
    if (target?.preset && Object.keys(target.preset).length > 0) {
      setValues((prev) => ({ ...prev, ...target.preset }));
    }
  };

  return (
    <section className={styles.player} aria-label={`${title} 交互过程`}>
      <header className={styles.header}>
        <div>
          <h2>{title}</h2>
          <p><MathText text={strategy.why} /></p>
          {strategy.alternatives.length > 0 && (
            <details className={styles.alternatives}>
              <summary>其他解法</summary>
              <ul>{strategy.alternatives.map((alternative, item) => <li key={item}><MathText text={alternative} /></li>)}</ul>
            </details>
          )}
        </div>
        <div className={styles.provenance}>
          <span>隔离沙箱交互视图</span>
          <Verification status={verification.status} />
        </div>
      </header>

      <nav className={styles.stepNav} aria-label="解题步骤">
        <ol>
          {steps.map((option, position) => (
            <li key={option.id}>
              <button type="button" aria-current={index === position ? 'step' : undefined} onClick={() => selectStep(position)}>
                <span aria-hidden="true">{position + 1}</span>
                {option.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.layout}>
        <div className={styles.stage} data-lab-program-sandbox>
          <LabCanvas
            key={`lab-sandbox-${sandbox.content_hash}`}
            lab={syntheticLab}
            values={values}
            identity={`lab-sandbox-${sandbox.content_hash}`}
            editable
            onParamChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        <section className={styles.lesson} aria-labelledby={titleId}>
          <div>
            <h3 id={titleId}>{step.title}</h3>
            <p><MathText text={step.explain} /></p>
          </div>

          {sandbox.params.length > 0 && (
            <div className={styles.controls}>
              {sandbox.params.map((param) => (
                <LabSlider
                  key={param.id}
                  label={param.label}
                  value={values[param.id] ?? param.default}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(value) => setValues((prev) => ({ ...prev, [param.id]: value }))}
                  format={(value) => `${formatNumber(value, 3)}${param.unit ?? ''}`}
                />
              ))}
            </div>
          )}

          {step.formulas.length > 0 && (
            <ul className={styles.formulas}>
              {step.formulas.map(({ tex, check }, item) => (
                <li key={item}>
                  <div className={styles.formula}><Formula tex={tex} block /></div>
                  {check && <Verification status={checks.get(check)?.status ?? 'unverified'} detail={checks.get(check)?.detail} />}
                </li>
              ))}
            </ul>
          )}

          <div className={styles.pager}>
            <button type="button" disabled={index === 0} onClick={() => selectStep(Math.max(0, index - 1))}>上一步</button>
            <span>{index + 1} / {steps.length}</span>
            <button type="button" disabled={index === steps.length - 1} onClick={() => selectStep(Math.min(steps.length - 1, index + 1))}>下一步</button>
          </div>
        </section>
      </div>
    </section>
  );
}
