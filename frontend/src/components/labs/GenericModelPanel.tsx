import type { ReactNode } from 'react';
import type { CalculusResult, LabProblem } from '@/labs/types';
import { formatNumber } from '@/labs/expr';
import { LabFormula as Formula, MathText } from './ProblemText';
import styles from './GenericModelPanel.module.css';

interface Props {
  problem: LabProblem;
  result: CalculusResult;
  params: Record<string, unknown>;
  onChange: (key: string, value: number) => void;
  onReset: () => void;
}

function numberValue(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function curvePath(points: CalculusResult['series'], width: number, height: number): { path: string; min: number; max: number } {
  const finite = points.filter((point) => point.y !== null && Number.isFinite(point.y));
  if (finite.length < 2) return { path: '', min: 0, max: 1 };
  const ys = finite.map((point) => point.y as number);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const xMin = points[0]?.x ?? -1;
  const xMax = points[points.length - 1]?.x ?? 1;
  const xScale = (x: number) => ((x - xMin) / (xMax - xMin)) * width;
  const yScale = (y: number) => height - ((y - min) / (max - min)) * height;
  const segments: string[] = [];
  let running = '';
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      if (running) segments.push(running);
      running = '';
      continue;
    }
    running += `${running ? 'L' : 'M'}${xScale(point.x).toFixed(2)},${yScale(point.y).toFixed(2)}`;
  }
  if (running) segments.push(running);
  return { path: segments.join(' '), min, max };
}

export function GenericModelPanel({ problem, result, params, onChange, onReset }: Props): ReactNode {
  const model = problem.model;
  const constants = model.params ?? [];
  const plot = model.plot;
  const width = 640;
  const height = 320;
  const { path, min, max } = curvePath(result.series, width, height);
  const steps = problem.solution.steps ?? [];
  const answer = result.answerText || problem.solution.answer || '—';
  return (
    <section className={styles.panel} aria-label="通用符号实验">
      <header className={styles.head}>
        <div>
          <span className={styles.kicker}>GENERIC SYMBOLIC MODEL</span>
          <h3>通用符号实验</h3>
          <p>AI 只声明步骤；滑杆变化后由受限 sympy 内核重新执行并核验。</p>
        </div>
        <span className={styles.badge}>{model.subject === 'general' ? '通用' : problem.subject_label}</span>
      </header>

      <div className={styles.formula}>
        {model.formula_tex ? <Formula tex={model.formula_tex} block /> : <MathText text={plot?.expr ?? '—'} />}
      </div>

      <div className={styles.grid}>
        <aside className={styles.controls} aria-label="参数滑杆">
          <div className={styles.controlsHead}>
            <span>可调参数</span>
            <button type="button" onClick={onReset}>恢复原题</button>
          </div>
          {constants.length === 0 ? <p className={styles.empty}>本题没有需要调节的数值参数。</p> : null}
          {constants.map((item) => {
            const value = numberValue(params, item.id, Number(item.value) || 0);
            const minValue = Number(item.min);
            const maxValue = Number(item.max);
            const step = Number(item.step) || (maxValue - minValue) / 100 || 0.1;
            const id = `generic-${item.id}`;
            return (
              <label className={styles.control} key={item.id} htmlFor={id}>
                <span className={styles.controlHead}>
                  <span><MathText text={item.label} /></span>
                  <output htmlFor={id}>{formatNumber(value, step < 0.01 ? 4 : step < 1 ? 2 : 0)}</output>
                </span>
                <input
                  type="range"
                  min={minValue}
                  max={maxValue}
                  step={step}
                  value={Math.max(minValue, Math.min(maxValue, value))}
                  aria-label={`${item.label} 滑杆`}
                  onChange={(event) => onChange(item.id, Number(event.target.value))}
                />
                {item.note ? <small><MathText text={item.note} /></small> : null}
              </label>
            );
          })}
        </aside>

        <div className={styles.plotWrap} aria-label="函数曲线">
          {path ? (
            <svg viewBox={`0 0 ${width} ${height}`} className={styles.plot} role="img" aria-label="通用模型曲线">
              <line x1="0" y1={height} x2={width} y2={height} className={styles.axis} />
              <line x1="0" y1="0" x2="0" y2={height} className={styles.axis} />
              <path d={path} className={styles.curve} />
              <text x="8" y="16" className={styles.tick}>{formatNumber(max, 4)}</text>
              <text x="8" y={height - 8} className={styles.tick}>{formatNumber(min, 4)}</text>
              <text x={width - 8} y={height - 8} textAnchor="end" className={styles.tick}>
                {plot ? `${plot.var} ∈ [${formatNumber(plot.range[0], 4)}, ${formatNumber(plot.range[1], 4)}]` : ''}
              </text>
            </svg>
          ) : <p className={styles.empty}>本题没有可绘制曲线。</p>}
        </div>

        <aside className={styles.resultPanel} aria-label="当前答案与步骤">
          <span className={styles.answerLabel}>当前答案</span>
          <p className={styles.answer}><MathText text={answer} /></p>
          {result.checks.length ? (
            <div className={styles.checks}>
              {result.checks.map((check) => (
                <p key={check.id} data-status={check.status}>
                  <strong>{check.status === 'pass' ? '✓' : check.status === 'fail' ? '✕' : '!'}</strong>
                  <span><MathText text={check.label} />：<MathText text={check.detail} /></span>
                </p>
              ))}
            </div>
          ) : null}
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li key={step.id}>
                <strong><MathText text={step.title} /></strong>
                <p><MathText text={step.detail} /></p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

export default GenericModelPanel;