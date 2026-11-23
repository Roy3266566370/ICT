import { useId, useMemo, useState } from 'react';
import { clamp, formatNumber } from '../../../labs/expr';
import { createSliceModel, type Walkthrough, type WalkthroughVerificationStatus } from '../../../labs/walkthrough';
import { MathText } from '../ProblemText';
import { CumulativeChart } from '../primitives/CumulativeChart';
import { Formula } from '../primitives/Formula';
import { SurfaceCanvas } from '../primitives/SurfaceCanvas';
import { LabSlider, Stat } from '../primitives/controls';
import styles from './WalkthroughPlayer.module.css';

function Verification({ status, detail }: { status: WalkthroughVerificationStatus; detail?: string }) {
  return (
    <span className={styles.verification} data-status={status} title={detail}>
      {status === 'verified' ? '内核已验证' : '尚未通过验算'}
    </span>
  );
}

export function WalkthroughPlayer({ walkthrough }: { walkthrough: Walkthrough }) {
  const { geometry, params, steps, strategy, verification } = walkthrough;
  const titleId = useId();
  const checkpointId = useId();
  const hParam = params.find((item) => item.id === 'h');
  const nParam = params.find((item) => item.id === 'n');
  const minH = Math.max(geometry.lower, hParam?.min ?? geometry.lower);
  const maxH = Math.min(geometry.upper, hParam?.max ?? geometry.upper);
  const minN = clamp(Math.ceil(nParam?.min ?? 4), 1, 240);
  const maxN = Math.max(minN, Math.min(240, Math.floor(nParam?.max ?? 96)));
  const initialH = clamp(hParam?.default ?? (minH + maxH) / 2, minH, maxH);
  const initialN = clamp(Math.round(nParam?.default ?? 12), minN, maxN);
  const model = useMemo(() => createSliceModel(geometry), [geometry]);
  const [height, setHeight] = useState(initialH);
  const [count, setCount] = useState(initialN);
  const [index, setIndex] = useState(0);
  const [predictions, setPredictions] = useState<Record<string, number>>({});
  const h = clamp(height, minH, maxH);
  const n = clamp(count, minN, maxN);
  const bands = useMemo(() => model?.bands(n) ?? [], [model, n]);
  const current = model?.at(bands, h);
  const step = steps[index];

  if (!model || !step || !current) {
    return <p role="status" className={styles.notice}>当前过程无法绘制，可在「结果」查看解题内容。</p>;
  }

  const checks = new Map(verification.checks.map((check) => [check.id, check]));
  const chartVerified = checks.get('primitive')?.status === 'verified';
  const bandVerified = checks.get('density')?.status === 'verified';
  const canMoveSlice = step.controls.includes('h');
  const moveSlice = (next: number) => {
    if (canMoveSlice) setHeight(clamp(next, minH, maxH));
  };
  const { band, exact, approx } = current;
  const checkpoint = step.checkpoint;
  const prediction = predictions[step.id];
  const final = index === steps.length - 1 && step.final;
  const revealCumulative = !!final || h < geometry.upper;
  const wholeApprox = bands[bands.length - 1]!.cumulative;
  const wholeExact = model.exactPoints[model.exactPoints.length - 1]!.value;
  const deltaZ = band.upper - band.lower;
  const showingArea = step.formulas.some(({ check }) => check === 'metric');

  return (
    <section className={styles.player} aria-label="曲面积分解题过程">
      <header className={styles.header}>
        <div>
          <h2>沿高度切片</h2>
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

      {walkthrough.conditions_source === 'model' && (
        <p className={styles.notice}>请将模型推断的曲面和积分边界与原题核对。</p>
      )}

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
          <SurfaceCanvas model={model} bands={bands} band={band} h={h} showAreaElement={showingArea} onMoveSlice={canMoveSlice ? moveSlice : undefined} />
          <div className={styles.metrics}>
            <Stat compact label="截面半径 r" value={formatNumber(model.radius(h), 4)} />
            <Stat compact label="环带贡献 ΔI" value={formatNumber(band.contribution, 4)} tone={bandVerified ? 'accent' : 'bad'} />
            {revealCumulative && <Stat compact label="累加至 h" value={formatNumber(approx, 4)} />}
          </div>
          {step.view.name === 'cumulative_chart' && (
            <div className={styles.chart}>
              <CumulativeChart exactPoints={model.exactPoints} bands={bands} band={band} h={h} exact={exact} approx={approx}
                verified={chartVerified} revealValue={revealCumulative} />
            </div>
          )}
        </div>

        <section className={styles.lesson} aria-labelledby={titleId}>
          <div>
            <h3 id={titleId}>{step.title}</h3>
            <p><MathText text={step.explain} /></p>
          </div>

          {step.controls.length > 0 && (
            <div className={styles.controls}>
              {canMoveSlice && (
                <LabSlider label={`${hParam?.label ?? '截面高度'} h`} value={h} min={minH} max={maxH} step={(maxH - minH) / 200}
                  onChange={moveSlice} format={(value) => formatNumber(value, 3)} />
              )}
              {step.controls.includes('n') && (
                <LabSlider label={`${nParam?.label ?? '环带数'} n`} value={n} min={minN} max={maxN} step={1} onChange={setCount} />
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

          {showingArea && (
            <div className={styles.currentBand}>
              <div>第 {band.index + 1} 个环带 · 高度差 {formatNumber(deltaZ, 4)}</div>
              <div className={styles.formula}>
                <Formula tex={`\\Delta S\\approx ${formatNumber(model.bandArea(band), 5)}`} />
              </div>
            </div>
          )}

          {!final && !showingArea && step.controls.includes('n') && (
            <div className={styles.currentBand}>
              <div>第 {band.index + 1} 个环带 · 中点 {formatNumber(band.midpoint, 4)}</div>
              <div className={styles.formula}>
                <Formula tex={`\\Delta I\\approx (${formatNumber(band.density, 5)})\\times ${formatNumber(deltaZ, 5)}\\approx ${formatNumber(band.contribution, 5)}`} />
              </div>
            </div>
          )}

          {checkpoint && (
            <fieldset className={styles.checkpoint}>
              <legend><MathText text={checkpoint.prompt} /></legend>
              {checkpoint.options.map((option, item) => (
                <label key={item}>
                  <input type="radio" name={checkpointId} checked={prediction === item}
                    onChange={() => setPredictions((current) => ({ ...current, [step.id]: item }))} />
                  <MathText text={option} />
                </label>
              ))}
              <p className={styles.feedback} role="status">
                {prediction !== undefined && (prediction === checkpoint.answer ? '预测正确。' : '试着移动截面，观察微元面积后再选一次。')}
              </p>
            </fieldset>
          )}

          {final && (
            <dl className={styles.result}>
              <div><dt>{checks.get('exact')?.status === 'verified' ? '精确值' : '待验算值'}</dt><dd>{formatNumber(wholeExact, 6)}</dd></div>
              <div><dt>{n} 个环带的中点和</dt><dd>{formatNumber(wholeApprox, 6)}</dd></div>
              <div><dt>绝对误差</dt><dd>{formatNumber(Math.abs(wholeExact - wholeApprox), 6)}</dd></div>
            </dl>
          )}

          <div className={styles.stepActions}>
            <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一步</button>
            <button type="button" disabled={index === steps.length - 1} onClick={() => setIndex(index + 1)}>下一步</button>
          </div>
        </section>
      </div>
    </section>
  );
}
