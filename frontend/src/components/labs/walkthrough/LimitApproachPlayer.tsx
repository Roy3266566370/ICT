import { useId, useMemo, useState } from 'react';
import { clamp, formatNumber } from '../../../labs/expr';
import {
  createLimitApproachModel,
  type LimitApproachWalkthrough,
  type WalkthroughVerificationStatus,
} from '../../../labs/walkthrough';
import { MathText } from '../ProblemText';
import { Formula } from '../primitives/Formula';
import { ZoomCurveCanvas } from '../primitives/ZoomCurveCanvas';
import { LabSlider, Stat } from '../primitives/controls';
import styles from './WalkthroughPlayer.module.css';

function Verification({ status, detail }: { status: WalkthroughVerificationStatus; detail?: string }) {
  return (
    <span className={styles.verification} data-status={status} title={detail}>
      {status === 'verified' ? '内核已验证' : '尚未通过验算'}
    </span>
  );
}

/** 极限与导数逼近（limit_approach）独立播放器，复用 Walkthrough 统一壳层样式。 */
export function LimitApproachPlayer({ walkthrough }: { walkthrough: LimitApproachWalkthrough }) {
  const { approach, params, steps, strategy, verification } = walkthrough;
  const titleId = useId();
  const checkpointId = useId();
  const deltaParam = params.find((item) => item.id === 'delta');
  const zoomParam = params.find((item) => item.id === 'zoom');
  const minDelta = Math.max(0.005, deltaParam?.min ?? 0.005);
  const maxDelta = Math.max(minDelta, deltaParam?.max ?? 1.0);
  const minZoom = Math.max(1, zoomParam?.min ?? 1);
  const maxZoom = Math.max(minZoom, zoomParam?.max ?? 40);

  const model = useMemo(() => createLimitApproachModel(approach), [approach]);
  const [delta, setDelta] = useState(clamp(deltaParam?.default ?? 0.35, minDelta, maxDelta));
  const [zoom, setZoom] = useState(clamp(zoomParam?.default ?? 2, minZoom, maxZoom));
  const [index, setIndex] = useState(0);
  const [predictions, setPredictions] = useState<Record<string, number>>({});

  const step = steps[index];
  if (!model || !step) {
    return <p role="status" className={styles.notice}>当前逼近过程无法绘制，可在「结果」查看解题内容。</p>;
  }

  const checks = new Map(verification.checks.map((check) => [check.id, check]));
  const isDeriv = approach.kind === 'derivative';
  const currentSample = model.sampleAtDelta(delta);
  const canAdjustDelta = step.controls.includes('delta');
  const canAdjustZoom = step.controls.includes('zoom');
  const showPrincipal = step.formulas.some(({ check }) => check === 'principal_part');
  const checkpoint = step.checkpoint;
  const prediction = predictions[step.id];

  return (
    <section className={styles.player} aria-label={isDeriv ? '导数定义逼近过程' : '极限逼近过程'}>
      <header className={styles.header}>
        <div>
          <h2>{isDeriv ? '割线逼近切线' : '局部缩放逼近'}</h2>
          <p><MathText text={strategy.why} /></p>
          {strategy.alternatives.length > 0 && (
            <details className={styles.alternatives}>
              <summary>其他解法</summary>
              <ul>{strategy.alternatives.map((alternative, item) => <li key={item}><MathText text={alternative} /></li>)}</ul>
            </details>
          )}
        </div>
        <div className={styles.provenance}>
          <span>{walkthrough.source === 'authored' ? '教学脚本' : '模型推断解题思路'}</span>
          <span>{walkthrough.conditions_source === 'problem' ? '条件由题面给出' : '条件由模型推断'}</span>
          <Verification status={verification.status} />
        </div>
      </header>

      <nav className={styles.stepNav} aria-label="解题步骤">
        <ol>
          {steps.map((option, position) => (
            <li key={option.id}>
              <button type="button" aria-current={index === position ? 'step' : undefined} onClick={() => setIndex(position)}>
                <span aria-hidden="true">{position + 1}</span>
                {option.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.layout}>
        <div className={styles.stage}>
          <ZoomCurveCanvas
            model={model}
            delta={delta}
            zoom={zoom}
            showPrincipal={showPrincipal}
            onChangeDelta={canAdjustDelta ? (next) => setDelta(clamp(next, minDelta, maxDelta)) : undefined}
          />
          <div className={styles.metrics}>
            <Stat
              compact
              label="左逼近 f(x₀−δ)"
              value={currentSample.leftValue !== null ? formatNumber(currentSample.leftValue, 5) : '—'}
            />
            <Stat
              compact
              label="右逼近 f(x₀+δ)"
              value={currentSample.rightValue !== null ? formatNumber(currentSample.rightValue, 5) : '—'}
              tone="accent"
            />
            <Stat
              compact
              label="当前误差 |Δ|"
              value={
                currentSample.rightError !== null
                  ? formatNumber(currentSample.rightError, 5)
                  : currentSample.leftError !== null
                    ? formatNumber(currentSample.leftError, 5)
                    : '—'
              }
            />
          </div>
        </div>

        <section className={styles.lesson} aria-labelledby={titleId}>
          <div>
            <h3 id={titleId}>{step.title}</h3>
            <p><MathText text={step.explain} /></p>
          </div>

          {step.controls.length > 0 && (
            <div className={styles.controls}>
              {canAdjustDelta && (
                <LabSlider
                  label={`${deltaParam?.label ?? '逼近步长 δ'}`}
                  value={delta}
                  min={minDelta}
                  max={maxDelta}
                  step={0.005}
                  onChange={(value) => setDelta(clamp(value, minDelta, maxDelta))}
                  format={(value) => formatNumber(value, 3)}
                />
              )}
              {canAdjustZoom && (
                <LabSlider
                  label={`${zoomParam?.label ?? '局部放大倍率'}`}
                  value={zoom}
                  min={minZoom}
                  max={maxZoom}
                  step={0.5}
                  onChange={(value) => setZoom(clamp(value, minZoom, maxZoom))}
                  format={(value) => `${formatNumber(value, 1)}×`}
                />
              )}
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

          {checkpoint && (
            <fieldset className={styles.checkpoint} aria-labelledby={checkpointId}>
              <legend id={checkpointId}>{checkpoint.prompt}</legend>
              <div className={styles.options}>
                {checkpoint.options.map((option, optionIndex) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={prediction === optionIndex}
                    data-correct={prediction !== undefined && optionIndex === checkpoint.answer ? 'true' : undefined}
                    onClick={() => setPredictions((prev) => ({ ...prev, [step.id]: optionIndex }))}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {prediction !== undefined && (
                <p role="status">
                  {prediction === checkpoint.answer
                    ? '判断正确！拖动步长滑块可直观看到误差迅速衰减。'
                    : `再试一次：正确答案是「${checkpoint.options[checkpoint.answer]}」。`}
                </p>
              )}
            </fieldset>
          )}

          <div className={styles.pager}>
            <button type="button" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>上一步</button>
            <span>{index + 1} / {steps.length}</span>
            <button type="button" disabled={index === steps.length - 1} onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}>下一步</button>
          </div>
        </section>
      </div>
    </section>
  );
}
