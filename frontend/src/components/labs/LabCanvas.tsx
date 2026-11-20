import { MathText } from './ProblemText';
import { useMemo, type ReactNode } from 'react';
import {LabFormula as Formula} from './ProblemText';
import { auditManualTraversal } from '@/labs/graphManual';
import { useManualState } from './manualState';
import {
  clampBox,
  contourLevels,
  contourSegments,
  formatTick,
  invertLinearScale,
  linearScale,
  niceTicks,
  normalize,
  seriesPath,
  snapToStep,
} from './charts';
import type {
  BfsResult,
  BfsResultFrame,
  DsResult,
  CalculusResult,
  DoubleIntegralResult,
  DlFrame,
  DlResult,
  LabProblem,
  LabResult,
  OptimizationResult,
} from '@/labs/types';
import type { LinAlgResult } from '@/labs/linalg';
import { formatNumber } from '@/labs/expr';
import styles from './LabCanvas.module.css';
import { HeapCanvas } from './HeapCanvas';
import { DsCanvas } from './DsCanvas';
import { OsCanvas } from './OsCanvas';
import { CoCanvas } from './CoCanvas';
import { NetworkCanvas } from './NetworkCanvas';
import { PhysicsCanvas } from './PhysicsCanvas';
import { DoubleIntegralCanvas } from './DoubleIntegralCanvas';

export interface LabSelection {
  id: string;
  label: string;
  kind?: string;
}

interface Props {
  problem: LabProblem;
  result: LabResult;
  step: number;
  mode: 'explore' | 'guided' | 'solution';
  compare?: LabResult | null;
  compareLabel?: string;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  onStepChange?: (step: number) => void;
  readOnly?: boolean;
  /** 二重积分沙盒换序预览需要实验室 id（共享/嵌入视图可不传）。 */
  labId?: string;
  /** 拖动画布上的几何参数时回写滑杆值；不传则画布只读。 */
  onParamDrag?: (patch: Record<string, number>) => void;
  /** 「我来 ✋」手动轨迹切片（LabState.manual）与回写；分享页只传 manual 做只读回放。 */
  manual?: Record<string, unknown>;
  onManualChange?: (key: string, value: unknown) => void;
}

const WIDTH = 760;
const HEIGHT = 420;
const MARGIN = { left: 58, right: 22, top: 24, bottom: 42 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

function PlotAxes({
  xScale,
  yScale,
  xTicks,
  yTicks,
  xLabel,
  yLabel,
}: {
  xScale: (value: number) => number;
  yScale: (value: number) => number;
  xTicks: number[];
  yTicks: number[];
  xLabel: string;
  yLabel: string;
}): ReactNode {
  return (
    <g className={styles.axes} aria-hidden="true">
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={xScale(tick)} y1={MARGIN.top} x2={xScale(tick)} y2={MARGIN.top + PLOT_H} className={styles.gridLine} />
          <text x={xScale(tick)} y={MARGIN.top + PLOT_H + 18} textAnchor="middle" className={styles.tick}>
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={MARGIN.left} y1={yScale(tick)} x2={MARGIN.left + PLOT_W} y2={yScale(tick)} className={styles.gridLine} />
          <text x={MARGIN.left - 10} y={yScale(tick) + 4} textAnchor="end" className={styles.tick}>
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <line x1={MARGIN.left} y1={MARGIN.top + PLOT_H} x2={MARGIN.left + PLOT_W} y2={MARGIN.top + PLOT_H} className={styles.axis} />
      <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + PLOT_H} className={styles.axis} />
      <text x={MARGIN.left + PLOT_W} y={MARGIN.top + PLOT_H + 34} textAnchor="end" className={styles.axisLabel}>
        {xLabel}
      </text>
      <text x={MARGIN.left - 38} y={MARGIN.top + 2} className={styles.axisLabel}>
        {yLabel}
      </text>
    </g>
  );
}

function boundsOfWork(series: { x: number; y: number | null }[], domain: Record<string, number>) {
  const ys = series.map((point) => point.y).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax - yMin < 1e-9) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.12;
  return { xMin: domain.x_min ?? -6, xMax: domain.x_max ?? 6, yMin: yMin - pad, yMax: yMax + pad };
}

/* -------------------------------------------------------------------------- */
/* 微积分                                                                     */
/* -------------------------------------------------------------------------- */

function CalculusCanvas({
  result,
  isNormal = false,
  verticalNormal = false,
  compare,
  selected,
  onSelect,
  onParamDrag,
  readOnly,
  boundsDraggable = false,
}: {
  result: CalculusResult;
  isNormal?: boolean;
  verticalNormal?: boolean;
  compare?: LabResult | null;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  onParamDrag?: (patch: Record<string, number>) => void;
  readOnly?: boolean;
  /** 仅普通定积分（computeCalculus 分支）允许拖 a/b；几何面积/旋转体的区间来自 model.defaults。 */
  boundsDraggable?: boolean;
}): ReactNode {
  const bounds = useMemo(
    () => boundsOfWork(
      [
        ...result.series,
        ...(result.kind === 'taylor' && result.taylor ? result.taylor.overlay : []),
        ...(result.overlays ?? []).flatMap(item => item.series),
      ],
      result.domain,
    ),
    [result],
  );
  const xScale = linearScale([bounds.xMin, bounds.xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
  const yScale = linearScale([bounds.yMin, bounds.yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
  const xTicks = niceTicks(bounds.xMin, bounds.xMax, 7);
  const yTicks = niceTicks(bounds.yMin, bounds.yMax, 5);
  const canDrag = Boolean(onParamDrag) && !readOnly && !isNormal;
  const beginAxisDrag = (write: (value: number) => void) =>
    (event: React.PointerEvent<SVGCircleElement>): void => {
      if (!onParamDrag || readOnly || isNormal) return;
      event.preventDefault();
      event.stopPropagation();
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      const inverse = invertLinearScale([bounds.xMin, bounds.xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
      const move = (moveEvent: PointerEvent): void => {
        const rect = svg.getBoundingClientRect();
        const viewX = ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH;
        const value = clampBox(snapToStep(inverse(viewX), 0.05), bounds.xMin, bounds.xMax);
        if (Number.isFinite(value)) write(value);
      };
      const cancel = (): void => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
      };
      const up = (): void => cancel();
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
    };
  const beginPointDrag = beginAxisDrag((value) => onParamDrag?.({ point: value }));
  /** 定积分：上下限 a/b 端点可拖，回写 params.lower / params.upper 触发内核重算。 */
  const integralBounds = result.kind === 'integral' && boundsDraggable && result.rects.length >= 2
    ? { lower: result.rects[0]!.x0, upper: result.rects[result.rects.length - 1]!.x1 }
    : null;
  const boundKeyDown = (key: 'lower' | 'upper', current: number) =>
    (event: React.KeyboardEvent<SVGCircleElement>): void => {
      if (!onParamDrag || readOnly) return;
      const step = event.shiftKey ? 0.5 : 0.05;
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0;
      if (!delta) return;
      event.preventDefault();
      onParamDrag({ [key]: Number((current + delta).toFixed(6)) });
    };
  const path = seriesPath(result.series, xScale, yScale);
  const comparePath =
    compare && compare.subject === 'calculus' ? seriesPath(compare.series, xScale, yScale) : '';
  const zeroY = yScale(0);
  const yLabel =
    result.kind === 'antiderivative'
      ? 'F(x)+C'
      : result.kind === 'integral'
        ? 'f(x)'
        : isNormal
          ? '曲线 / 切线 / 法线'
          : 'f(x) / 切线';
  const emphasis = selected?.kind === 'solution-step' ? selected.id : selected?.id;

  const pointCandidate = result.point;
  const linePoint = result.trace[0]?.values ?? {};
  const curveX = Number(linePoint.x), curveY = Number(linePoint.y);
  const normalSlope = pointCandidate?.slope;
  const tangentSlope = verticalNormal ? 0 : typeof normalSlope === 'number' && normalSlope !== 0 ? -1 / normalSlope : null;
  const extraTangent = isNormal && Number.isFinite(curveX) && Number.isFinite(curveY) ? <g aria-label="切线">
    {tangentSlope === null ? <line x1={xScale(curveX)} x2={xScale(curveX)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className={styles.compareCurve} />
      : <line x1={xScale(result.domain.x_min)} x2={xScale(result.domain.x_max)} y1={yScale(curveY + tangentSlope * (result.domain.x_min - curveX))} y2={yScale(curveY + tangentSlope * (result.domain.x_max - curveX))} className={styles.compareCurve} />}
    <text x={MARGIN.left + 16} y={MARGIN.top + PLOT_H - 12} className={styles.canvasNote}>切线与法线方程见原题计算结果</text>
  </g> : null;

  if (isNormal && verticalNormal) {
    const values = result.trace[0]?.values ?? {};
    const px = Number(values.x), py = Number(values.y);
    return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="隐式曲线与竖直法线">
      <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel={yLabel} />
      <path d={path} className={styles.curve} />
      {extraTangent}
      <line x1={xScale(px)} x2={xScale(px)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className={styles.tangent} />
      <circle cx={xScale(px)} cy={yScale(py)} r="7" className={styles.currentPoint} />
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>法线 x = {formatNumber(px)}，斜率不存在</text>
    </svg>;
  }
  if (result.kind === 'multivariable' || result.kind === 'multivariable_extrema') {
    return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="多元函数观察切片">
      <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="切片坐标" yLabel="f" />
      <path d={path} className={styles.curve} />
      {comparePath ? <path d={comparePath} className={styles.compareCurve} /> : null}
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>目标函数切片 · 观察点函数值 {result.metrics.find(m => m.id === 'probe')?.value ?? '—'}</text>
      <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>固定坐标由观察滑杆控制；切片不替代偏导或极值的符号结论。</text>
    </svg>;
  }

  if (result.kind === 'derivative' && pointCandidate && typeof pointCandidate.y === 'number') {
    const point = pointCandidate;
    const pointY = point.y as number;
    const left = result.domain.x_min;
    const right = result.domain.x_max;
    const tangentY = (x: number) => point.tangent.m * x + point.tangent.b;
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label={isNormal ? '隐式曲线、研究点与法线' : '函数、切线与差商'}>
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel={yLabel} />
        {comparePath ? <path d={comparePath} className={styles.compareCurve} /> : null}
        {extraTangent}
        <path d={path} className={emphasis === 'derivative' ? `${styles.curve} ${styles.curveStrong}` : styles.curve} />
        <line
          x1={xScale(left)}
          y1={yScale(tangentY(left))}
          x2={xScale(right)}
          y2={yScale(tangentY(right))}
          className={emphasis === 'slope' || emphasis === 'derivative' ? `${styles.tangent} ${styles.tangentStrong}` : styles.tangent}
        />
        <line
          x1={xScale(point.x - 1)}
          y1={yScale(pointY + point.tangent.m * -1)}
          x2={xScale(point.x + 1)}
          y2={yScale(pointY + point.tangent.m * 1)}
          className={styles.tangentSoft}
        />
        <g
          className={styles.hotspot}
          onClick={() => onSelect({ id: 'tangent', label: isNormal ? '研究点与法线' : '切线与导数', kind: 'tangent' })}
          role="button"
          tabIndex={0}
          aria-label={isNormal ? '查看法线' : '查看切线'}
        >
          <circle cx={xScale(point.x)} cy={yScale(pointY)} r="7" className={styles.currentPoint} />
          <circle cx={xScale(point.x)} cy={yScale(pointY)} r="15" className={styles.pointHalo} />
        </g>
        {canDrag ? (
          <circle
            cx={xScale(point.x)}
            cy={yScale(pointY)}
            r="14"
            className={styles.dragHandle}
            data-testid="calculus-point-handle"
            onPointerDown={beginPointDrag}
          >
            <title>拖动研究点，沿曲线实时重算切线</title>
          </circle>
        ) : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          {isNormal ? '法线斜率 ' : '切线斜率 '}{formatNumber(point.slope)}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          {isNormal ? `研究点 P(${formatNumber(point.x)}, ${formatNumber(pointY)})` : `差商 ${formatNumber(result.approx)} → 导数 ${formatNumber(result.exact)}`}
        </text>
      </svg>
    );
  }

  if (result.kind === 'antiderivative') {
    const familyEmphasis = emphasis === 'antiderivative' || emphasis === 'integration';
    return (
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svg}
        role="img"
        aria-label="原函数族 F(x)+C"
      >
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel={yLabel} />
        {comparePath ? <path d={comparePath} className={styles.compareCurve} /> : null}
        <path
          d={path}
          className={familyEmphasis ? `${styles.curve} ${styles.curveStrong}` : styles.curve}
        />
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          F(x)+C · 拖动积分常数观察整体平移
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          原题结论与公式见图下说明
        </text>
        {compare && compare.subject === 'calculus' ? (
          <text x={MARGIN.left + 16} y={MARGIN.top + 56} className={styles.compareNote}>
            虚线：对照情景的另一条原函数
          </text>
        ) : null}
      </svg>
    );
  }

  if (result.kind === 'limit') {
    const limitPoint = result.limit?.point ?? null;
    const leftText = result.limit?.left?.text ?? '—';
    const rightText = result.limit?.right?.text ?? '—';
    const bothText = result.limit?.value?.text ?? '—';
    const marker = limitPoint === null ? null : (() => {
      let best: { x: number; y: number } | null = null;
      for (const point of result.series) {
        if (point.y === null) continue;
        if (!best || Math.abs(point.x - limitPoint) < Math.abs(best.x - limitPoint)) best = { x: point.x, y: point.y };
      }
      return best;
    })();
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="函数曲线与左右极限">
        {result.overlays?.filter(o => o.id === 'point_value').flatMap(o => o.series).map((p, i) => p.y === null ? null : <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r="6" className={styles.currentPoint} aria-label="实验点值" />)}
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="f(x)" />
        <path d={path} className={styles.curve} />
        {limitPoint !== null ? (
          <line x1={xScale(limitPoint)} x2={xScale(limitPoint)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className={styles.tangentSoft} />
        ) : null}
        {marker ? <circle cx={xScale(marker.x)} cy={yScale(marker.y)} r="6" className={styles.currentPoint} /> : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          左极限 {leftText} · 右极限 {rightText}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          双侧结论：{bothText}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 56} className={styles.canvasNote}>
          竖虚线标出研究点；左右逼近读取同一函数图像。
        </text>
      </svg>
    );
  }

  if (result.kind === 'taylor') {
    const taylor = result.taylor;
    const centerY = (() => {
      if (!taylor) return null;
      let best: { x: number; y: number } | null = null;
      for (const point of result.series) {
        if (point.y === null) continue;
        if (!best || Math.abs(point.x - taylor.point) < Math.abs(best.x - taylor.point)) best = { x: point.x, y: point.y };
      }
      return best;
    })();
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="原函数与泰勒多项式">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="f(x) / Pₙ(x)" />
        <path d={path} className={styles.curve} />
        {taylor ? <path d={seriesPath(taylor.overlay, xScale, yScale)} className={styles.compareCurve} /> : null}
        {centerY ? <circle cx={xScale(centerY.x)} cy={yScale(centerY.y)} r="6" className={styles.currentPoint} /> : null}
        {canDrag && centerY ? (
          <circle
            cx={xScale(centerY.x)}
            cy={yScale(centerY.y)}
            r="14"
            className={styles.dragHandle}
            data-testid="taylor-center-handle"
            onPointerDown={beginPointDrag}
          >
            <title>拖动展开中心，实时重算泰勒多项式</title>
          </circle>
        ) : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          虚线：P{taylor?.order ?? 'n'}(x) 在 x={formatNumber(taylor?.point ?? 0)} 处展开
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          附近最大偏差 {formatNumber(taylor?.max_error ?? null)}{canDrag ? ' · 拖动橙色圆环改变展开中心' : ''}
        </text>
      </svg>
    );
  }

  if (result.kind === 'higher_derivative') {
    const higher = result.higher;
    const pointValue = (() => {
      if (!higher || higher.point === null) return null;
      let best: { x: number; y: number } | null = null;
      for (const point of result.series) {
        if (point.y === null) continue;
        if (!best || Math.abs(point.x - higher.point) < Math.abs(best.x - higher.point)) best = { x: point.x, y: point.y };
      }
      return best;
    })();
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="原函数与高阶导数研究点">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="f(x)" />
        <path d={path} className={styles.curve} />
        {pointValue ? <circle cx={xScale(pointValue.x)} cy={yScale(pointValue.y)} r="6" className={styles.currentPoint} /> : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          f^({higher?.order ?? 1}) 的指定点值 {formatNumber(higher?.value ?? null)}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          曲线为原函数；高阶导数值由符号求导或数值差分核对。
        </text>
      </svg>
    );
  }

  if (result.kind === 'function_study') {
    const study = result.study;
    const bands = study?.monotonic ?? [];
    const vertical = study?.asymptotes.vertical_values ?? [];
    const horizontal = study?.asymptotes.horizontal_values ?? [];
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="函数单调区间与渐近线">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="f(x)" />
        {bands.map((band, index) => {
          const from = Math.max(bounds.xMin, band.from ?? bounds.xMin);
          const to = Math.min(bounds.xMax, band.to ?? bounds.xMax);
          if (!(to > from)) return null;
          return (
            <rect
              key={index}
              x={xScale(from)}
              y={MARGIN.top}
              width={Math.max(1, xScale(to) - xScale(from))}
              height={PLOT_H}
              fill={band.kind === 'increasing' ? '#16a34a' : band.kind === 'constant' ? '#64748b' : '#dc2626'}
              opacity={0.08}
            />
          );
        })}
        {vertical.map((value, index) => (
          <line key={`v${index}`} x1={xScale(value)} x2={xScale(value)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} className={styles.tangentSoft} />
        ))}
        {horizontal.map((value, index) => (
          <line key={`h${index}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={yScale(value)} y2={yScale(value)} className={styles.tangentSoft} />
        ))}
        <path d={path} className={styles.curve} />
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          绿：递增 · 红：递减 · 细线：渐近线
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          原题结论与公式见图下说明
        </text>
      </svg>
    );
  }

  if (result.kind === 'series_convergence') {
    const points = result.series.filter(point => point.y !== null);
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="数项级数部分和">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="n" yLabel="S_n" />
        {points.length > 1 ? <path d={seriesPath(points, xScale, yScale)} className={styles.curve} /> : null}
        {points.map((point, index) => <circle key={index} cx={xScale(point.x)} cy={yScale(point.y!)} r="3" className={styles.currentPoint} />)}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          部分和 Sₙ（完整表达式见图下说明）
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          {result.series_status ?? ''} · 部分和观察不替代符号判别
        </text>
      </svg>
    );
  }

  if (result.kind === 'power_series') {
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="幂级数与收敛区间">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="S(x)" />
        {result.series.length ? <path d={path} className={styles.curve} /> : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          收敛区间：{result.power?.interval ?? '—'}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          {result.power?.sum_function ? `S(x)=${result.power.sum_function}` : result.power?.polynomial ?? '端点需单独代入原级数判断'}
        </text>
      </svg>
    );
  }

  if (result.kind === 'fourier_series') {
    const overlay = result.overlays?.[0]?.series ?? [];
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="函数与傅里叶部分和">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="f(x) / 部分和" />
        <path d={path} className={styles.curve} />
        {overlay.length ? <path d={seriesPath(overlay, xScale, yScale)} className={styles.compareCurve} /> : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          实线：原函数 · 虚线：傅里叶部分和
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          {result.fourier?.convergence_note ?? ''}
        </text>
      </svg>
    );
  }

  if (result.kind === 'ode') {
    const ode = result.ode;
    const target = ode?.target;
    const lower = target?.lower ? Number(target.lower) : result.domain.x_min;
    const upper = target?.upper ? Number(target.upper) : result.domain.x_max;
    const shade = Number.isFinite(lower) && Number.isFinite(upper) && upper > lower &&
      (target?.kind === 'area' || target?.kind === 'integral' || target?.kind === 'volume_x');
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="微分方程解曲线与组合量">
        <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel="y(x)" />
        {shade ? <rect x={xScale(lower)} y={MARGIN.top} width={Math.max(1, xScale(upper) - xScale(lower))} height={PLOT_H} fill="#4f46e5" opacity={0.08} /> : null}
        <path d={path} className={styles.curve} />
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
          {ode?.order ? `${ode.order} 阶微分方程` : '微分方程'} · {ode?.hints.join('、') || '待核对'}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
          解曲线（完整表达式见图下说明）
        </text>
        {shade ? <text x={MARGIN.left + 16} y={MARGIN.top + 56} className={styles.canvasNote}>
          组合量区间 [{formatNumber(lower)}, {formatNumber(upper)}]
        </text> : null}
      </svg>
    );
  }

  const inside = result.series.filter(
    (point) => point.x >= result.domain.x_min + 0.000001 && point.x <= result.domain.x_max - 0.000001,
  );
  const lowerInside = (result.lowerSeries ?? []).filter(
    (point) => point.x >= result.domain.x_min + 0.000001 && point.x <= result.domain.x_max - 0.000001,
  );
  let areaPath = '';
  if (inside.length > 1) {
    const points = inside.filter((point) => point.y !== null);
    const lowerPoints = lowerInside.filter((point) => point.y !== null);
    if (points.length > 1) {
      if (lowerPoints.length > 1) {
        areaPath = `M${xScale(points[0]!.x)},${yScale(points[0]!.y!)}`;
        for (const point of points) areaPath += `L${xScale(point.x)},${yScale(point.y!)}`;
        for (const point of [...lowerPoints].reverse()) areaPath += `L${xScale(point.x)},${yScale(point.y!)}`;
        areaPath += 'Z';
      } else {
        areaPath = `M${xScale(points[0]!.x)},${zeroY}`;
        for (const point of points) areaPath += `L${xScale(point.x)},${yScale(point.y!)}`;
        areaPath += `L${xScale(points[points.length - 1]!.x)},${zeroY}Z`;
      }
    }
  }
  const lowerPoints = lowerInside.filter((point) => point.y !== null);
  const lowerPath = lowerPoints.length > 1
    ? lowerPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale(point.x)},${yScale(point.y!)}`).join('')
    : '';
  const highlight = emphasis === 'integral_area' || emphasis === 'limits' || emphasis === 'evaluate' || emphasis === 'approx';
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="函数曲线、积分区域与黎曼矩形">
      <PlotAxes xScale={xScale} yScale={yScale} xTicks={xTicks} yTicks={yTicks} xLabel="x" yLabel={yLabel} />
      <g
        className={styles.hotspot}
        onClick={() => onSelect({ id: 'integral_area', label: '积分区域与黎曼和', kind: 'area' })}
        role="button"
        tabIndex={0}
        aria-label="查看积分区域"
      >
        {areaPath ? <path d={areaPath} className={highlight ? styles.areaStrong : styles.area} /> : null}
        {result.rects.map((rect, index) => {
          const bottom = rect.base !== undefined ? yScale(rect.base) : zeroY;
          const top = Math.min(yScale(rect.height), bottom);
          const height = Math.abs(bottom - yScale(rect.height));
          return (
            <rect
              key={index}
              x={Math.min(xScale(rect.x0), xScale(rect.x1))}
              y={top}
              width={Math.max(1, Math.abs(xScale(rect.x1) - xScale(rect.x0)) - 0.8)}
              height={Math.max(0, height)}
              className={emphasis === 'approx' ? styles.rectStrong : styles.rect}
            />
          );
        })}
      </g>
      {comparePath ? <path d={comparePath} className={styles.compareCurve} /> : null}
      {lowerPath ? <path d={lowerPath} className={styles.compareCurve} /> : null}
      <path d={path} className={emphasis === 'antiderivative' ? `${styles.curve} ${styles.curveStrong}` : styles.curve} />
      {integralBounds && canDrag ? (
        <g aria-label="拖动端点改变积分区间">
          {(['lower', 'upper'] as const).map((key) => {
            const value = integralBounds[key];
            const name = key === 'lower' ? 'a' : 'b';
            return (
              <g key={key}>
                <line
                  x1={xScale(value)} x2={xScale(value)}
                  y1={MARGIN.top} y2={MARGIN.top + PLOT_H}
                  className={styles.boundLine}
                />
                <circle
                  cx={xScale(value)}
                  cy={MARGIN.top + PLOT_H}
                  r="7"
                  className={styles.dragHandle}
                  data-testid={`integral-bound-${key}`}
                  onPointerDown={beginAxisDrag((next) => onParamDrag?.({ [key]: next }))}
                  onKeyDown={boundKeyDown(key, value)}
                  tabIndex={0}
                  role="slider"
                  aria-label={`积分${key === 'lower' ? '下' : '上'}限 ${name}`}
                  aria-valuemin={bounds.xMin}
                  aria-valuemax={bounds.xMax}
                  aria-valuenow={value}
                >
                  <title>拖动改变积分{key === 'lower' ? '下' : '上'}限 {name}（方向键微调，Shift 大步）</title>
                </circle>
                <text x={xScale(value)} y={MARGIN.top + PLOT_H + 32} textAnchor="middle" className={styles.boundLabel}>
                  {name}={formatNumber(value)}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
        黎曼和 {formatNumber(result.approx)}
      </text>
      <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
        {result.exact !== null ? `解析/参照 ${formatNumber(result.exact)}` : '等待可计算表达式'} · 误差{' '}
        {formatNumber(result.error)}{integralBounds && canDrag ? ' · 可拖动 a/b 端点改区间' : ''}
      </text>
      {lowerPath ? (
        <text x={MARGIN.left + 16} y={MARGIN.top + 56} className={styles.compareNote}>
          虚线：区域下边界
        </text>
      ) : null}
      {compare && compare.subject === 'calculus' ? (
        <text x={MARGIN.left + 16} y={MARGIN.top + (lowerPath ? 74 : 56)} className={styles.compareNote}>
          虚线：对照情景
        </text>
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 最优化                                                                     */
/* -------------------------------------------------------------------------- */

function OptimizationCanvas({
  result,
  compare,
  step,
  selected,
  onSelect,
  onStepChange,
  onParamDrag,
  readOnly,
}: {
  result: OptimizationResult;
  compare?: LabResult | null;
  step: number;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  onStepChange?: (step: number) => void;
  onParamDrag?: (patch: Record<string, number>) => void;
  readOnly?: boolean;
}): ReactNode {
  const currentIndex = Math.max(0, Math.min(step, result.trajectory.length - 1));
  const current = result.trajectory[currentIndex] ?? result.current;
  const emphasis = selected?.kind === 'solution-step' ? selected.id : null;
  const canDrag = Boolean(onParamDrag) && !readOnly && result.trajectory.length > 0;
  const beginParamDrag = (
    event: React.PointerEvent<SVGCircleElement>,
    maps: (clientX: number, clientY: number) => Record<string, number>,
  ): void => {
    if (!canDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const move = (moveEvent: PointerEvent): void => {
      const px = ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH;
      const py = ((moveEvent.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT;
      const patch = maps(px, py);
      if (Object.values(patch).every((value) => Number.isFinite(value))) onParamDrag?.(patch);
    };
    const cancel = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
    const up = (): void => {
      cancel();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  };
  if (result.grid && result.variables.length === 2) {
    const { grid } = result;
    const xMin = grid.x[0]!;
    const xMax = grid.x[grid.x.length - 1]!;
    const yMin = grid.y[0]!;
    const yMax = grid.y[grid.y.length - 1]!;
    const xScale = linearScale([xMin, xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
    const yScale = linearScale([yMin, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
    const values = grid.z.flat().filter((value): value is number => typeof value === 'number');
    const low = Math.min(...values);
    const high = Math.max(...values);
    const levels = contourLevels(grid, 7);
    const cellW = PLOT_W / (grid.x.length - 1);
    const cellH = PLOT_H / (grid.y.length - 1);
    const path = result.trajectory
      .slice(0, currentIndex + 1)
      .map((point) => `${xScale(point.point[0]!)},${yScale(point.point[1]!)}`)
      .join(' ');
    return (
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="目标函数热力图、等高线与迭代轨迹">
        <g>
          {grid.z.map((row, rowIndex) =>
            row.map((value, columnIndex) => {
              if (typeof value !== 'number') return null;
              const t = normalize(value, low, high);
              return (
                <rect
                  key={`${rowIndex}-${columnIndex}`}
                  x={MARGIN.left + columnIndex * cellW}
                  y={MARGIN.top + PLOT_H - (rowIndex + 1) * cellH}
                  width={cellW + 0.5}
                  height={cellH + 0.5}
                  fill={`hsl(232 66% ${92 - t * 48}%)`}
                />
              );
            }),
          )}
        </g>
        <g>
          {levels.map((level) =>
            contourSegments(grid, level).map((segment, index) => (
              <line
                key={`${level}-${index}`}
                x1={xScale(segment[0])}
                y1={yScale(segment[1])}
                x2={xScale(segment[2])}
                y2={yScale(segment[3])}
                className={styles.contour}
              />
            )),
          )}
        </g>
        <PlotAxes
          xScale={xScale}
          yScale={yScale}
          xTicks={niceTicks(xMin, xMax, 6)}
          yTicks={niceTicks(yMin, yMax, 5)}
          xLabel="x"
          yLabel="y"
        />
        {compare && compare.subject === 'optimization' ? (
          <polyline
            points={compare.trajectory
              .map((point) => `${xScale(point.point[0]!)},${yScale(point.point[1]!)}`)
              .join(' ')}
            className={styles.compareTrace}
          />
        ) : null}
        <polyline points={path} className={styles.trace} />
        {result.trajectory.map((point, index) => (
          <circle
            key={point.index}
            cx={xScale(point.point[0]!)}
            cy={yScale(point.point[1]!)}
            r={index === currentIndex ? 7 : index === 0 ? 4.5 : 3}
            className={index === currentIndex ? styles.currentPoint : index === 0 ? styles.startPoint : styles.tracePoint}
            onClick={() => onStepChange?.(index)}
            role="button"
            tabIndex={0}
            aria-label={`迭代 ${index}`}
          />
        ))}
        {canDrag && result.trajectory[0] ? (
          <circle
            cx={xScale(result.trajectory[0].point[0]!)}
            cy={yScale(result.trajectory[0].point[1]!)}
            r="11"
            className={styles.dragHandle}
            data-testid="optimization-start-handle"
            onPointerDown={(event) => beginParamDrag(event, (px, py) => {
              const invertX = invertLinearScale([xMin, xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
              const invertY = invertLinearScale([yMin, yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
              const stepX = Math.max(0.05, (grid.x[1] ?? xMin + 1) - grid.x[0]!);
              const stepY = Math.max(0.05, (grid.y[1] ?? yMin + 1) - grid.y[0]!);
              return {
                [`${result.variables[0]}0`]: clampBox(snapToStep(invertX(px), stepX), xMin, xMax),
                [`${result.variables[1]}0`]: clampBox(snapToStep(invertY(py), stepY), yMin, yMax),
              };
            })}
          >
            <title>拖动起点，实时重算梯度下降轨迹</title>
          </circle>
        ) : null}
        {current ? (
          <g
            className={styles.hotspot}
            onClick={() => onSelect({ id: 'trajectory', label: `迭代 ${currentIndex} 的轨迹点`, kind: 'point' })}
            role="button"
            tabIndex={0}
            aria-label="查看当前轨迹点"
          >
            <circle cx={xScale(current.point[0]!)} cy={yScale(current.point[1]!)} r={emphasis === 'update' || emphasis === 'stop' ? 23 : 16} className={styles.pointHalo} />
          </g>
        ) : null}
        <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabelOnDark}>
          f = {formatNumber(current?.f ?? null)} · ‖∇f‖ = {formatNumber(current?.gradNorm ?? null)}
        </text>
        <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNoteOnDark}>
          等高线来自当前目标函数；轨迹前段较淡，当前点高亮。{canDrag ? '拖动橙色圆环改变起点。' : ''}
        </text>
      </svg>
    );
  }

  const bounds = boundsOfWork(result.series, result.domain);
  const xScale = linearScale([bounds.xMin, bounds.xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
  const yScale = linearScale([bounds.yMin, bounds.yMax], [MARGIN.top + PLOT_H, MARGIN.top]);
  const path = seriesPath(result.series, xScale, yScale);
  const trajectoryPath = result.trajectory
    .slice(0, currentIndex + 1)
    .map((point) => `${xScale(point.point[0]!)},${yScale(point.f)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="目标函数曲线与梯度下降轨迹">
      <PlotAxes
        xScale={xScale}
        yScale={yScale}
        xTicks={niceTicks(bounds.xMin, bounds.xMax, 7)}
        yTicks={niceTicks(bounds.yMin, bounds.yMax, 5)}
        xLabel="x"
        yLabel="f(x)"
      />
      <path d={path} className={emphasis === 'objective' ? `${styles.curve} ${styles.curveStrong}` : styles.curve} />
      {compare && compare.subject === 'optimization' && compare.variables.length === 1 ? (
        <polyline
          points={compare.trajectory
            .map((point) => `${xScale(point.point[0]!)},${yScale(point.f)}`)
            .join(' ')}
          className={styles.compareTrace}
        />
      ) : null}
      <polyline points={trajectoryPath} className={styles.trace} />
      {result.trajectory.map((point, index) => (
        <circle
          key={point.index}
          cx={xScale(point.point[0]!)}
          cy={yScale(point.f)}
          r={index === currentIndex ? 7 : index === 0 ? 4.5 : 3}
          className={index === currentIndex ? styles.currentPoint : index === 0 ? styles.startPoint : styles.tracePoint}
          onClick={() => onStepChange?.(index)}
          role="button"
          tabIndex={0}
          aria-label={`迭代 ${index}`}
        />
      ))}
      {canDrag && result.trajectory[0] ? (
        <circle
          cx={xScale(result.trajectory[0].point[0]!)}
          cy={yScale(result.trajectory[0].f)}
          r="11"
          className={styles.dragHandle}
          data-testid="optimization-start-handle"
          onPointerDown={(event) => beginParamDrag(event, (px) => {
            const invertX = invertLinearScale([bounds.xMin, bounds.xMax], [MARGIN.left, MARGIN.left + PLOT_W]);
            return { [`${result.variables[0]}0`]: clampBox(snapToStep(invertX(px), 0.25), bounds.xMin, bounds.xMax) };
          })}
        >
          <title>拖动起点，实时重算梯度下降轨迹</title>
        </circle>
      ) : null}
      {current ? (
        <line
          x1={xScale(current.point[0]!)}
          y1={yScale(current.f)}
          x2={xScale(current.point[0]!) + clampBox(-current.gradient[0]! * 16, -60, 60)}
          y2={yScale(current.f) - 8}
          className={styles.gradientArrow}
          markerEnd="url(#gradient-arrow)"
        />
      ) : null}
      {result.exactPoint && result.exactPoint.length === 1 ? (
        <g>
          <line
            x1={xScale(result.exactPoint[0]!)}
            y1={MARGIN.top}
            x2={xScale(result.exactPoint[0]!)}
            y2={MARGIN.top + PLOT_H}
            className={styles.exactLine}
          />
          <text x={xScale(result.exactPoint[0]!) + 6} y={MARGIN.top + 16} className={styles.exactLabel}>
            驻点 x*={formatNumber(result.exactPoint[0]!)}
          </text>
        </g>
      ) : null}
      <defs>
        <marker id="gradient-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#ff7a59" />
        </marker>
      </defs>
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
        第 {currentIndex} 步 · f={formatNumber(current?.f ?? null)}
      </text>
      <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
        ‖∇f‖={formatNumber(current?.gradNorm ?? null)} · {currentIndex >= result.trajectory.length - 1 ? result.stopReason : '轨迹进行中'}{canDrag ? ' · 拖动橙色圆环改变起点' : ''}
      </text>
      {current?.gradient.length ? (
        <g
          className={styles.hotspot}
          onClick={() => onSelect({ id: 'trajectory', label: `迭代 ${currentIndex} 的梯度`, kind: 'point' })}
          role="button"
          tabIndex={0}
          aria-label="查看当前轨迹点"
        >
          <circle cx={xScale(current.point[0]!)} cy={yScale(current.f)} r={emphasis === 'update' || emphasis === 'stop' ? 24 : 17} className={styles.pointHalo} />
        </g>
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* BFS                                                                        */
/* -------------------------------------------------------------------------- */

interface GraphManual { mode: boolean; picks: string[] }

function BfsCanvas({
  result,
  step,
  selected,
  onSelect,
  saved,
  onSave,
  readOnly,
}: {
  result: BfsResult;
  step: number;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  saved?: { mode?: boolean; picks?: string[] };
  onSave?: (value: unknown) => void;
  readOnly?: boolean;
}): ReactNode {
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame: BfsResultFrame = result.frames[index] ?? result.frames[0]!;
  const nodes = result.nodes;
  const [gm, setGm] = useManualState<GraphManual>(
    saved as GraphManual | undefined, onSave, { mode: false, picks: [] });
  const ro = readOnly === true;
  const traversalKind = result.algorithm === 'dfs' ? 'dfs' : result.algorithm === 'bfs' ? 'bfs' : null;
  const manualMode = traversalKind !== null && (ro ? saved?.mode === true : gm.mode);
  const picks = gm.picks;
  const isDfs = traversalKind === 'dfs';
  const audit = useMemo(
    () => auditManualTraversal(result.adjacency, nodes.map((node) => node.id), result.start, picks, traversalKind ?? 'bfs'),
    [traversalKind, nodes, picks, result.adjacency, result.start],
  );
  // 每个被点选节点在「你的访问序」中的首次位置与该步审计结果。
  const pickIndex = useMemo(() => {
    const map = new Map<string, number>();
    picks.forEach((id, pick) => { if (!map.has(id)) map.set(id, pick); });
    return map;
  }, [picks]);
  const okPicks = useMemo(() => {
    const set = new Set<string>();
    audit.steps.forEach((item, pick) => { if (item.ok) set.add(picks[pick]!); });
    return set;
  }, [audit.steps, picks]);
  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const columns = nodes.length <= 8 ? 1 : Math.ceil(Math.sqrt(nodes.length));
    const rows = Math.ceil(nodes.length / columns);
    nodes.forEach((node, nodeIndex) => {
      if (nodes.length <= 8) {
        const angle = -Math.PI / 2 + (nodeIndex / Math.max(1, nodes.length)) * Math.PI * 2;
        map[node.id] = { x: 260 + Math.cos(angle) * 175, y: 190 + Math.sin(angle) * 145 };
      } else {
        const column = nodeIndex % columns;
        const row = Math.floor(nodeIndex / columns);
        map[node.id] = {
          x: 90 + (column / Math.max(1, columns - 1)) * 340,
          y: 80 + (row / Math.max(1, rows - 1)) * 250,
        };
      }
    });
    return map;
  }, [nodes]);
  // DFS 的等待集合是栈；BFS 是队列。节点状态与下方面板按同一字段渲染。
  const queue = new Set(isDfs ? (frame.stack ?? []) : frame.queue);
  const visited = new Set(frame.visited);
  const tree = new Set(result.treeEdges.map((edge) => `${edge.from}->${edge.to}`));
  const emphasis = selected?.kind === 'solution-step' ? selected.id : null;
  const discoverAction = isDfs ? 'push' : 'enqueue';
  const orderWord = isDfs ? '访问' : '出队';
  const manualState = (id: string): 'visited' | 'error' | 'unvisited' => {
    if (!pickIndex.has(id)) return 'unvisited';
    return okPicks.has(id) ? 'visited' : 'error';
  };
  return (
    <div className={styles.bfsLayout}>
      <div className={styles.bfsMain}>
        {ro || traversalKind === null ? null : (
          <div className={styles.manualBar} role="group" aria-label="遍历模式切换">
            <button type="button" className={styles.modeBtn} data-current={!manualMode || undefined} onClick={() => setGm((m) => ({ ...m, mode: false }))}>内核推演</button>
            <button type="button" className={styles.modeBtn} data-current={manualMode || undefined} onClick={() => setGm((m) => ({ ...m, mode: true }))}>我来手动{isDfs ? '走 DFS' : '走 BFS'} ✋</button>
            {manualMode ? <small>{isDfs ? '点选下一个要访问的节点；栈顶决定顺序' : '点选下一个要出队的节点；队首先入先出'}</small> : null}
          </div>
        )}
        <svg viewBox="0 0 520 400" className={styles.svgBfs} role="img" aria-label={`${isDfs ? 'DFS' : 'BFS'} 图、${isDfs ? '栈' : '队列'}与已访问集合`}>
        <defs>
          <marker id="bfs-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
          </marker>
        </defs>
        {result.edges.map((edge, edgeIndex) => {
          const from = positions[edge.from];
          const to = positions[edge.to];
          if (!from || !to) return null;
          const key = `${edge.from}->${edge.to}`;
          const isTree = tree.has(key) || (!result.directed && tree.has(`${edge.to}->${edge.from}`));
          return (
            <line
              key={`${edge.from}-${edge.to}-${edgeIndex}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={isTree ? (emphasis === discoverAction ? `${styles.treeEdge} ${styles.treeEdgeStrong}` : styles.treeEdge) : styles.graphEdge}
              markerEnd={result.directed ? 'url(#bfs-arrow)' : undefined}
            />
          );
        })}
        {nodes.map((node) => {
          const position = positions[node.id];
          if (!position) return null;
          const isCurrent = frame.current === node.id;
          const state = manualMode ? manualState(node.id) : isCurrent ? 'current' : queue.has(node.id) ? 'queue' : visited.has(node.id) ? 'visited' : 'unvisited';
          const pick = pickIndex.get(node.id);
          const clickNode = manualMode && !ro
            ? () => setGm((m) => ({ ...m, picks: [...m.picks, node.id] }))
            : () => onSelect({ id: `node:${node.id}`, label: `节点 ${node.label}`, kind: 'node' });
          return (
            <g
              key={node.id}
              className={styles.nodeGroup}
              data-emphasis={(emphasis === 'init' && node.id === result.start) || (emphasis === (isDfs ? 'visit' : 'dequeue') && isCurrent) || undefined}
              onClick={clickNode}
              role="button"
              tabIndex={0}
              aria-label={manualMode ? `点选 ${node.label} 为下一个${orderWord}节点` : `节点 ${node.label}，${state}`}
            >
              {!manualMode && isCurrent ? <circle cx={position.x} cy={position.y} r="29" className={styles.nodeHalo} /> : null}
              <circle cx={position.x} cy={position.y} r="20" data-state={state} className={styles.node} />
              <text x={position.x} y={position.y + 5} textAnchor="middle" className={styles.nodeLabel}>
                {node.label}
              </text>
              {manualMode && pick !== undefined ? (
                <text x={position.x + 22} y={position.y - 12} textAnchor="middle" className={styles.pickOrder} data-ok={okPicks.has(node.id) || undefined}>
                  {pick + 1}
                </text>
              ) : null}
              <text x={position.x} y={position.y + 37} textAnchor="middle" className={styles.nodeLevel}>
                {result.level[node.id] !== undefined ? `L${result.level[node.id]}` : '—'}
              </text>
            </g>
          );
        })}
        <text x="18" y="26" className={styles.canvasLabel}>
          {manualMode ? `手动${isDfs ? ' DFS' : ' BFS'} · 已选 ${picks.length} / ${audit.expected.length} 个节点` : frame.label}
        </text>
        <text x="18" y="46" className={styles.canvasNote}>
          {manualMode ? (ro ? '分享回放：学生的访问序与审计结论' : `点选图中的节点作为下一个${orderWord}对象`) : frame.detail}
        </text>
      </svg>
      </div>
      <aside className={styles.bfsState}>
        {manualMode ? (
          <>
            <div className={styles.stateBlock}>
              <span className={styles.stateTitle}>你的{orderWord}顺序</span>
              <div className={styles.chipRow}>
                {picks.length ? picks.map((item, pick) => (
                  <span key={`${item}-${pick}`} className={styles.pickChip} data-ok={audit.steps[pick]?.ok === true || undefined}>
                    {pick + 1}.{item}
                  </span>
                )) : <span className={styles.emptyText}>点选图中的节点开始</span>}
              </div>
            </div>
            {ro ? null : (
              <div className={styles.queueRow}>
                <button type="button" className={styles.pickBtn} disabled={!picks.length}
                  onClick={() => setGm((m) => ({ ...m, picks: m.picks.slice(0, -1) }))}>撤销一步</button>
                <button type="button" className={styles.pickBtn} disabled={!picks.length}
                  onClick={() => setGm((m) => ({ ...m, picks: [] }))}>清空</button>
              </div>
            )}
            {audit.errors.length || audit.warnings.length ? (
              <div className={styles.stateBlock}>
                <span className={styles.stateTitle}>审计</span>
                <ul className={styles.auditList} role={audit.errors.length ? 'alert' : undefined}>
                  {audit.errors.map((error, index) => <li key={`e${index}`}>{error}</li>)}
                  {audit.warnings.map((warning, index) => <li key={`w${index}`} className={styles.auditWarn}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
            {audit.divergence ? (
              <p className={styles.orderText}>
                首次分歧在第 {audit.divergence.index + 1} 步：你选 {audit.divergence.pick}，内核{orderWord} {audit.divergence.expected}。
              </p>
            ) : null}
            {audit.unreachable.length ? (
              <div className={styles.stateBlock}>
                <span className={styles.stateTitle}>不可达节点</span>
                <div className={styles.chipRow}>
                  {audit.unreachable.map((item) => <span key={item} className={styles.visitedChip}>{item}</span>)}
                </div>
              </div>
            ) : null}
            {audit.complete ? (
              <p className={styles.orderText}>
                {audit.matchesKernel
                  ? `完成：你的${orderWord}顺序与内核完全一致。`
                  : '已走完整个序列；对照审计找出分歧。'}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.stateBlock}>
              <span className={styles.stateTitle}>{isDfs ? '栈（LIFO，栈顶在右）' : '队列（FIFO）'}</span>
              <div className={styles.queueRow}>
                {frame.queue.length ? (
                  frame.queue.map((item, queueIndex) => (
                    <span key={`${item}-${queueIndex}`} className={styles.queueCell}>
                      {item}
                    </span>
                  ))
                ) : (
                  <span className={styles.emptyText}>空</span>
                )}
              </div>
            </div>
            <div className={styles.stateBlock}>
              <span className={styles.stateTitle}>已访问</span>
              <div className={styles.chipRow}>
                {frame.visited.map((item) => (
                  <span key={item} className={styles.visitedChip}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.stateBlock}>
              <span className={styles.stateTitle}>{orderWord}顺序</span>
              <p className={styles.orderText}>{frame.order.join(' → ') || `尚未${orderWord}`}</p>
            </div>
            <div className={styles.pseudocode} aria-label="伪代码">
              {result.pseudocode.map((line, lineIndex) => (
                <code key={lineIndex} data-active={frame.pseudocodeLine === lineIndex + 1 || undefined}>
                  <i>{lineIndex + 1}</i>
                  {line}
                </code>
              ))}
            </div>
            <p className={styles.stateNote}>入队即标记；同层邻居按节点编号升序。</p>
          </>
        )}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 线性代数：增广矩阵消元 / 矩阵运算                                            */
/* -------------------------------------------------------------------------- */

function MatrixTable({
  matrix,
  augCols = 0,
  pivot = null,
  rows = [],
  cell = null,
  highlightRow = null,
  highlightCol = null,
  ariaLabel,
}: {
  matrix: (number | string | null)[][];
  augCols?: number;
  pivot?: { row: number; col: number } | null;
  rows?: number[];
  cell?: { row: number; col: number } | null;
  highlightRow?: number | null;
  highlightCol?: number | null;
  ariaLabel?: string;
}): ReactNode {
  const cols = matrix[0]?.length ?? 0;
  const augStart = cols - augCols;
  return (
    <div className={styles.matrix} role="table" aria-label={ariaLabel}>
      {matrix.map((row, r) => (
        <div key={r} className={styles.matrixRow} role="row"
          data-target={rows.includes(r) || highlightRow === r || undefined}>
          {row.map((value, c) => (
            <span key={c} role="cell" className={styles.matrixCell}
              data-pivot={(pivot && pivot.row === r && pivot.col === c) || undefined}
              data-active={(cell && cell.row === r && cell.col === c) || highlightCol === c || undefined}
              data-aug={(augCols > 0 && c === augStart) || undefined}>
              {value === null ? '·' : typeof value === 'string' ? value : formatNumber(value)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function LinAlgCanvas({ result, step }: { result: LinAlgResult; step: number }): ReactNode {
  const frame = result.frames[Math.min(Math.max(0, step), result.frames.length - 1)] ?? result.frames[0];
  if (!frame) return <p>暂无可展示的轨迹。</p>;
  const values = (frame.values ?? {}) as Record<string, unknown>;

  if (result.laKind === 'eigen') {
    return (
      <div className={styles.laLayout}>
        <div className={styles.laStage}>
          {result.matrixA ? <MatrixTable matrix={result.matrixAExact ?? result.matrixA} ariaLabel="原矩阵 A" /> : null}
          <p className={styles.laCaption}>
            <strong><MathText text={frame.label} /></strong>
            <MathText text={String(frame.detail ?? '')} />
          </p>
        </div>
        <aside className={styles.laState}>
          <div className={styles.stateBlock}>
            <span className={styles.stateTitle}>精确特征值与特征空间</span>
            <p className={styles.stateNote}><MathText text={result.answer} /></p>
          </div>
          <div className={styles.pseudocode} aria-label="特征值求解步骤">
            {result.pseudocode.map((line, index) => (
              <code key={index} data-active={frame.pseudocodeLine === index + 1 || undefined}>
                <i>{index + 1}</i>{line}
              </code>
            ))}
          </div>
        </aside>
      </div>
    );
  }

  if (result.engine === 'matmul_v1') {
    const a = (values.a ?? null) as (number | null)[][] | null;
    const b = (values.b ?? null) as (number | null)[][] | null;
    const c = (values.matrix ?? []) as (number | null)[][];
    const cell = (values.cell ?? null) as { row: number; col: number } | null;
    const symbol = result.op === 'add' ? '+' : result.op === 'sub' ? '−' : '×';
    return (
      <div className={styles.laLayout}>
        <div className={styles.laStage}>
          <div className={styles.matmulRow}>
            {result.op === 'scalar' ? <span className={styles.matmulOp}>{formatNumber(result.scalar)}</span> : null}
            {a ? <MatrixTable matrix={a} highlightRow={result.op === 'mul' ? cell?.row ?? null : null} ariaLabel="左矩阵" /> : null}
            <span className={styles.matmulOp}>{symbol}</span>
            {b ? <MatrixTable matrix={b} highlightCol={result.op === 'mul' ? cell?.col ?? null : null} ariaLabel="右矩阵" /> : null}
            <span className={styles.matmulOp}>=</span>
            <MatrixTable matrix={c} cell={cell} ariaLabel="结果矩阵" />
          </div>
          <p className={styles.laCaption}>
            <strong><MathText text={String(frame.label ?? '')} /></strong>
            {typeof values.op_label === 'string' && values.op_label ? <code>{values.op_label}</code> : null}
          </p>
        </div>
        <aside className={styles.laState}>
          <div className={styles.stateBlock}>
            <span className={styles.stateTitle}>说明</span>
            <p className={styles.stateNote}><MathText text={String(frame.detail ?? '')} /></p>
          </div>
          <div className={styles.stateBlock}>
            <span className={styles.stateTitle}>运算</span>
            <p className={styles.orderText}>{result.op === 'mul' ? (result.order === 'ba' ? 'B·A' : 'A·B') : result.op === 'add' ? 'A+B' : result.op === 'sub' ? 'A−B' : `${formatNumber(result.scalar)}·A`}</p>
          </div>
        </aside>
      </div>
    );
  }

  const w = (values.matrix ?? []) as (number | null)[][];
  const augCols = typeof values.aug === 'number' ? values.aug : 0;
  const pivot = (values.pivot ?? null) as { row: number; col: number } | null;
  const targetRows = Array.isArray(values.rows) ? (values.rows as number[]) : [];
  const det = typeof values.det === 'number' ? values.det : null;
  const partial = Array.isArray(values.solution) ? (values.solution as (number | null)[]) : [];
  const solved = partial.filter((item): item is number => item !== null);
  return (
    <div className={styles.laLayout}>
      <div className={styles.laStage}>
        <MatrixTable matrix={w} augCols={augCols} pivot={pivot} rows={targetRows} ariaLabel="工作矩阵" />
        <p className={styles.laCaption}>
          <strong><MathText text={String(frame.label ?? '')} /></strong>
          <MathText text={String(frame.detail ?? '')} />
        </p>
      </div>
      <aside className={styles.laState}>
        {det !== null ? (
          <div className={styles.stateBlock}>
            <span className={styles.stateTitle}>累计主元乘积</span>
            <p className={styles.orderText}>{formatNumber(det)}</p>
          </div>
        ) : null}
        {solved.length ? (
          <div className={styles.stateBlock}>
            <span className={styles.stateTitle}>已解出分量</span>
            <p className={styles.orderText}>({solved.map((v) => formatNumber(v)).join(', ')})</p>
          </div>
        ) : null}
        {result.pseudocode.length ? (
          <div className={styles.pseudocode} aria-label="伪代码">
            {result.pseudocode.map((line, lineIndex) => (
              <code key={lineIndex} data-active={frame.pseudocodeLine === lineIndex + 1 || undefined}>
                <i>{lineIndex + 1}</i>
                {line}
              </code>
            ))}
          </div>
        ) : null}
        <p className={styles.stateNote}>换行使行列式变号；倍加变换不变。</p>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 深度学习                                                                   */
/* -------------------------------------------------------------------------- */

interface DlManual {
  mode?: boolean;
  /** 输出层 argmax 预测记录（按帧下标记）。 */
  picks: { step: number; pick: number }[];
  /** 损失方向预测：step 帧处猜「下一步 loss 下降?」。 */
  guesses: { step: number; down: boolean }[];
}

function DlCanvas({
  result,
  step,
  selected,
  onSelect,
  compare,
  readOnly,
  saved,
  onSave,
}: {
  result: DlResult;
  step: number;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  compare?: LabResult | null;
  readOnly?: boolean;
  saved?: DlManual;
  onSave?: (value: DlManual) => void;
}): ReactNode {
  const ro = readOnly === true;
  const [gm, setGm] = useManualState<DlManual>(saved, onSave, { mode: false, picks: [], guesses: [] });
  const manualMode = ro ? saved?.mode === true : gm.mode;
  const index = Math.max(0, Math.min(step, result.frames.length - 1));
  const frame: DlFrame = result.frames[index] ?? result.frames[0]!;
  const outputIndex = Math.max(0, result.layers.length - 1);
  const outputA = frame.activations[outputIndex]?.a ?? [];
  const argmax = outputA.length ? outputA.indexOf(Math.max(...outputA)) : -1;
  const pick = gm.picks.find((entry) => entry.step === index)?.pick;
  const guess = gm.guesses.find((entry) => entry.step === index);
  const nextFrame = result.frames[index + 1];
  const revealPick = !manualMode || pick !== undefined;
  const pickHits = gm.picks.filter((entry) => {
    const f = result.frames[entry.step];
    const a = f?.activations[outputIndex]?.a ?? [];
    return a.length > 0 && a.indexOf(Math.max(...a)) === entry.pick;
  }).length;
  const guessHits = gm.guesses.filter((entry) => {
    const f = result.frames[entry.step];
    const nf = result.frames[entry.step + 1];
    return !!f && !!nf && (nf.loss < f.loss) === entry.down;
  }).length;
  const recordPick = (nodeIndex: number): void => {
    if (ro || !manualMode || pick !== undefined) return;
    setGm((previous) => ({ ...previous, picks: [...previous.picks, { step: index, pick: nodeIndex }] }));
  };
  const recordGuess = (down: boolean): void => {
    if (ro || !manualMode || guess || !nextFrame) return;
    setGm((previous) => ({ ...previous, guesses: [...previous.guesses, { step: index, down }] }));
  };
  const emphasis = selected?.kind === 'solution-step' ? selected.id : null;
  const positions = useMemo(() => {
    const resultLayers: { x: number; y: number }[][] = [];
    result.layers.forEach((layer, layerIndex) => {
      const x = 90 + (layerIndex / Math.max(1, result.layers.length - 1)) * 580;
      const gap = Math.min(44, 250 / Math.max(1, layer.size));
      const total = (layer.size - 1) * gap;
      resultLayers.push(
        Array.from({ length: layer.size }, (_, nodeIndex) => ({
          x,
          y: 210 - total / 2 + nodeIndex * gap,
        })),
      );
    });
    return resultLayers;
  }, [result.layers]);
  const selectedLayer = selected?.id.startsWith('layer:') ? Number(selected.id.split(':')[1]) : 1;
  const lossPoints = result.lossHistory;
  const lossMin = Math.min(...lossPoints);
  const lossMax = Math.max(...lossPoints);
  const sparkW = 220;
  const sparkH = 70;
  const sparkPath = lossPoints
    .map((value, pointIndex) => {
      const x = 10 + (pointIndex / Math.max(1, lossPoints.length - 1)) * sparkW;
      const y = 10 + (1 - normalize(value, lossMin, lossMax)) * sparkH;
      return `${pointIndex === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');
  const compareLoss =
    compare && compare.subject === 'deep_learning'
      ? compare.lossHistory
          .map((value, pointIndex) => {
            const x = 10 + (pointIndex / Math.max(1, compare.lossHistory.length - 1)) * sparkW;
            const y = 10 + (1 - normalize(value, lossMin, lossMax)) * sparkH;
            return `${pointIndex === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join('')
      : '';
  const weights = frame.weights;
  const edgeMax = Math.max(
    1e-6,
    ...weights.flat(2).map((value) => Math.abs(value)),
  );
  const layerInfo = frame.activations[selectedLayer];
  return (
    <div className={styles.dlLayout}>
      {ro ? null : (
        <div className={styles.manualBar} role="group" aria-label="预测模式切换">
          <button type="button" className={styles.modeBtn} data-current={!manualMode || undefined} onClick={() => setGm((m) => ({ ...m, mode: false }))}>内核推演</button>
          <button type="button" className={styles.modeBtn} data-current={manualMode || undefined} onClick={() => setGm((m) => ({ ...m, mode: true }))}>我来预测 ✋</button>
          {manualMode ? <small>先遮住输出层：点选你认为激活最强的输出节点，再猜下一步损失方向</small> : null}
        </div>
      )}
      <div className={styles.dlTop}>
        <svg viewBox="0 0 760 400" className={styles.svgDl} role="img" aria-label="神经网络结构、权重与当前激活">
          {result.layers.slice(0, -1).map((_, layerIndex) =>
            positions[layerIndex]!.flatMap((from, fromIndex) =>
              positions[layerIndex + 1]!.map((to, toIndex) => {
                const weight = weights[layerIndex]?.[toIndex]?.[fromIndex] ?? 0;
                const magnitude = Math.abs(weight) / edgeMax;
                return (
                  <line
                    key={`${layerIndex}-${fromIndex}-${toIndex}`}
                    x1={from.x + 18}
                    y1={from.y}
                    x2={to.x - 18}
                    y2={to.y}
                    stroke={weight >= 0 ? `rgba(79,70,229,${0.12 + magnitude * 0.7})` : `rgba(255,122,89,${0.14 + magnitude * 0.7})`}
                    strokeWidth={0.6 + magnitude * 3.2}
                  />
                );
              }),
            ),
          )}
          {result.layers.map((layer, layerIndex) => (
            <g
              key={layerIndex}
              onClick={() =>
                onSelect({
                  id: `layer:${layerIndex}`,
                  label: layerIndex === 0 ? '输入层' : layerIndex === result.layers.length - 1 ? '输出层' : `隐藏层 ${layerIndex}`,
                  kind: 'layer',
                })
              }
              role="button"
              tabIndex={0}
              aria-label={`第 ${layerIndex} 层，${layer.size} 个节点`}
            >
              <text x={positions[layerIndex]![0]?.x ?? 0} y="28" textAnchor="middle" className={styles.layerLabel}>
                {layerIndex === 0 ? '输入' : layerIndex === result.layers.length - 1 ? '输出' : `隐藏 ${layerIndex}`}
                <tspan x={positions[layerIndex]![0]?.x ?? 0} dy="14" className={styles.layerSize}>
                  {layer.size}
                </tspan>
              </text>
              {positions[layerIndex]!.map((position, nodeIndex) => {
                const activation = frame.activations[layerIndex]?.a[nodeIndex] ?? 0;
                const alpha = 0.15 + Math.min(0.85, Math.abs(activation));
                const isOutput = layerIndex === outputIndex;
                const masked = manualMode && isOutput && !revealPick;
                const picked = manualMode && isOutput && pick === nodeIndex;
                const actual = manualMode && isOutput && revealPick && argmax === nodeIndex;
                return (
                  <g
                    key={nodeIndex}
                    onClick={masked ? (event) => { event.stopPropagation(); recordPick(nodeIndex); } : undefined}
                    data-predict={masked ? 'masked' : undefined}
                  >
                    <circle
                      cx={position.x}
                      cy={position.y}
                      r="17"
                      fill={masked ? 'rgba(148,163,184,0.3)' : activation >= 0 ? `rgba(79,70,229,${alpha})` : `rgba(255,122,89,${alpha})`}
                      className={[
                        selectedLayer === layerIndex ? styles.nodeSelected : styles.netNode,
                        masked ? styles.nodeMasked : '',
                        actual ? styles.nodeArgmax : '',
                        picked ? (pick === argmax ? styles.nodePickHit : styles.nodePickMiss) : '',
                      ].join(' ').trim()}
                    />
                    <text x={position.x} y={position.y + 4} textAnchor="middle" className={styles.netNodeText}>
                      {masked ? '?' : formatNumber(activation, 2)}
                    </text>
                    {picked ? <text x={position.x} y={position.y - 22} textAnchor="middle" className={styles.pickBadge}>{pick === argmax ? '✓' : '✗'}</text> : null}
                    {actual && !picked ? <text x={position.x} y={position.y - 22} textAnchor="middle" className={styles.argmaxBadge}>最强</text> : null}
                  </g>
                );
              })}
            </g>
          ))}
          <text x="24" y="372" className={styles.canvasNote}>
            {manualMode ? '预测模式：输出层已遮住。点选最强节点；点击层名仍可展开数值。' : '边宽与颜色表示权重方向；节点颜色表示当前激活。点击层可展开中间数值。'}
          </text>
        </svg>
        {manualMode ? (
          <div className={styles.predictBar} data-testid="dl-predict">
            {revealPick ? (
              <span data-hit={pick === argmax || undefined}>
                输出预测：你选了第 {pick! + 1} 节点，实际最强是第 {argmax + 1} 节点{pick === argmax ? ' ✓ 命中' : ' ✗ 未中'}
              </span>
            ) : <span>输出层已遮住：点击你认为激活最强的节点</span>}
            {nextFrame ? (
              guess ? (
                <span data-hit={(nextFrame.loss < frame.loss) === guess.down || undefined}>
                  损失方向：你猜{guess.down ? '下降' : '上升/持平'}，实际{nextFrame.loss < frame.loss ? '下降' : '未降'}
                  {(nextFrame.loss < frame.loss) === guess.down ? ' ✓' : ' ✗'}
                </span>
              ) : ro ? <span>下一步损失方向：未作答</span> : (
                <span role="group" aria-label="预测下一步损失方向">
                  下一步损失？
                  <button type="button" className={styles.pickBtn} onClick={() => recordGuess(true)}>↓ 下降</button>
                  <button type="button" className={styles.pickBtn} onClick={() => recordGuess(false)}>↑/＝ 不降</button>
                </span>
              )
            ) : <span>已到最后一帧，无下一步可猜</span>}
            <span className={styles.predictStats}>
              argmax {pickHits}/{gm.picks.length} · 方向 {guessHits}/{gm.guesses.length}
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.dlBottom}>
        <div className={styles.lossPanel} data-emphasis={emphasis === 'loss' || emphasis === 'forward' || undefined}>
          <div className={styles.lossHead}>
            <span>损失曲线</span>
            <b>{formatNumber(frame.loss)}</b>
          </div>
          <svg viewBox="0 0 240 90" role="img" aria-label="损失曲线">
            <path d={sparkPath} className={styles.sparkline} />
            {compareLoss ? <path d={compareLoss} className={styles.compareSpark} /> : null}
            <line
              x1={10 + (index / Math.max(1, lossPoints.length - 1)) * sparkW}
              y1="8"
              x2={10 + (index / Math.max(1, lossPoints.length - 1)) * sparkW}
              y2={sparkH + 12}
              className={styles.sparkMarker}
            />
            <circle
              cx={10 + (index / Math.max(1, lossPoints.length - 1)) * sparkW}
              cy={10 + (1 - normalize(frame.loss, lossMin, lossMax)) * sparkH}
              r="3.5"
              className={styles.currentPoint}
            />
          </svg>
          <p>Epoch {index} / {result.layers.length ? result.frames.length - 1 : 0}</p>
        </div>
        <div className={styles.layerPanel}>
          <div className={styles.lossHead}>
            <span>{selectedLayer === 0 ? '输入层' : selectedLayer === result.layers.length - 1 ? '输出层' : `隐藏层 ${selectedLayer}`}</span>
            <b>{layerInfo ? `${layerInfo.a.length} 维` : '—'}</b>
          </div>
          {layerInfo ? (
            <div className={styles.layerTable}>
              <div>
                <span>z</span>
                <code>{layerInfo.z.map((value) => formatNumber(value, 3)).join(' · ')}</code>
              </div>
              <div>
                <span>a</span>
                <code>{layerInfo.a.map((value) => formatNumber(value, 3)).join(' · ')}</code>
              </div>
              <div>
                <span>激活</span>
                <code>{layerInfo.activation}</code>
              </div>
            </div>
          ) : (
            <p className={styles.emptyText}>选择一层查看中间数值。</p>
          )}
          <p className={styles.stateNote}>权重来源：<MathText text={String(result.notes[0] ?? '')} /></p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 路由                                                                       */
/* -------------------------------------------------------------------------- */

function ConstrainedExtremaCanvas({ result }: { result: OptimizationResult }): ReactNode {
  const candidates = result.candidates ?? [];
  const xs = candidates.map(item => item.point_values?.[0] ?? Number(item.point[0])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const ys = candidates.map(item => item.point_values?.[1] ?? Number(item.point[1])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const xMin = result.domain.x_min ?? Math.min(-1, ...xs), xMax = result.domain.x_max ?? Math.max(1, ...xs);
  const yMin = result.domain.y_min ?? Math.min(-1, ...ys), yMax = result.domain.y_max ?? Math.max(1, ...ys);
  const sx = linearScale([xMin - (xMax-xMin || 1) * 0.2, xMax + (xMax-xMin || 1) * 0.2], [MARGIN.left, MARGIN.left + PLOT_W]);
  const sy = linearScale([yMin - (yMax-yMin || 1) * 0.2, yMax + (yMax-yMin || 1) * 0.2], [MARGIN.top + PLOT_H, MARGIN.top]);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="等式约束极值驻点">
      <PlotAxes xScale={sx} yScale={sy} xTicks={niceTicks(xMin, xMax, 6)} yTicks={niceTicks(yMin, yMax, 5)} xLabel="x" yLabel="y" />
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
        约束：{result.constraint ?? '—'}
      </text>
      {candidates.map((item, index) => {
        const x = item.point_values?.[0] ?? Number(item.point[0]);
        const y = item.point_values?.[1] ?? Number(item.point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const color = item.classification === 'minimum' ? '#16a34a' : item.classification === 'maximum' ? '#dc2626' : '#6b7280';
        return (
          <g key={index}>
            <circle cx={sx(x)} cy={sy(y)} r="7" fill={color} className={styles.currentPoint} />
            <text x={sx(x) + 10} y={sy(y) - 10} className={styles.canvasNote}>
              ({item.point.join(', ')}) {item.classification}
            </text>
          </g>
        );
      })}
      <text x="388" y="400" textAnchor="middle">
        绿：极小 · 红：极大 · 灰：未定；点位为约束流形上的拉格朗日驻点
      </text>
    </svg>
  );
}

function SpaceCanvas({ result }: { result: CalculusResult }): ReactNode {
  const space = result.space;
  const triple = result.task === 'triple_integral';
  const curves = space?.curves ?? [];
  const grid = space?.grid ?? [];
  const edges = space?.edges ?? [];
  const points = space?.points ?? [];
  const line = space?.line ?? [];
  const all = [
    ...curves.flatMap(item => item.points),
    ...grid.flatMap(row => row),
    ...edges.flatMap(item => item),
    ...points,
    ...line,
  ];
  if (!all.length) {
    return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label={triple ? '三重积分区域' : '空间对象'}>
      <text x="380" y="200" textAnchor="middle" className={styles.canvasLabel}>{result.answerText || (triple ? '三重积分区域待核对' : '空间对象待核对')}</text>
    </svg>;
  }
  const xs = all.map(p => p.x), ys = all.map(p => p.y), zs = all.map(p => p.z);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs), 1);
  const scale = 145 / span * (space?.view_zoom ?? 1);
  const angle = (space?.view_yaw ?? 0) * Math.PI / 180;
  const rotate = (p: {x:number;y:number;z:number}) => ({x:centerX+(p.x-centerX)*Math.cos(angle)-(p.y-centerY)*Math.sin(angle),y:centerY+(p.x-centerX)*Math.sin(angle)+(p.y-centerY)*Math.cos(angle),z:p.z});
  const projectRotated = (p: { x: number; y: number; z: number }) => ({
    x: 380 + ((p.x - centerX) - (p.y - centerY)) * 0.866 * scale,
    y: 205 + (((p.x - centerX) + (p.y - centerY)) * 0.5 - (p.z - centerZ)) * scale,
  });
  const project = (p: {x:number;y:number;z:number}) => projectRotated(rotate(p));
  const path = (items: { x: number; y: number; z: number }[]) => items.map((p, index) => {
    const q = project(p);
    return `${index === 0 ? 'M' : 'L'}${q.x},${q.y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label={triple ? '三重积分区域、曲面网格与边界曲线' : '空间曲线、曲面与空间对象'}>
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
        {triple ? '三重积分区域' : '空间对象'}
      </text>
      <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
        {triple ? '等轴投影；曲面网格与边界曲线来自已核验的积分区域。' : '等轴投影；曲线、曲面网格、立方体边或几何点来自同一空间模型。'}
      </text>
      {grid.map((row, index) => <path key={`row${index}`} d={path(row)} fill="none" stroke="#94a3b8" strokeWidth="0.8" opacity="0.55" />)}
      {grid.length ? Array.from({ length: grid[0]?.length ?? 0 }, (_, column) => <path key={`col${column}`} d={path(grid.map(row => row[column]).filter((point): point is { x: number; y: number; z: number } => point !== undefined))} fill="none" stroke="#94a3b8" strokeWidth="0.8" opacity="0.35" />) : null}
      {edges.map((edge, index) => <path key={`edge${index}`} d={path(edge)} fill="none" stroke="#6366f1" strokeWidth="1.2" />)}
      {line.length ? <path d={path(line)} fill="none" stroke="#f59e0b" strokeWidth="1.4" /> : null}
      {curves.map(item => <path key={item.id} d={path(item.points)} fill="none" stroke="#4f46e5" strokeWidth="2" />)}
      {points.map((point, index) => {
        const q = project(point);
        return <g key={index}><circle cx={q.x} cy={q.y} r="5" className={styles.currentPoint} />
          <text x={q.x + 8} y={q.y - 8} className={styles.canvasNote}>{point.id ?? `P${index + 1}`}</text></g>;
      })}
      <text x="388" y="400" textAnchor="middle">{triple ? '区域网格与边界曲线来自已确认条件；数值积分仅作独立复核' : '曲线/曲面由参数模型采样；三大公式同时核对两条路径'}</text>
    </svg>
  );
}

function ProofCanvas({ result }: { result: CalculusResult }): ReactNode {
  const proof = result.proof;
  const obligations = proof?.obligations ?? [];
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={styles.svg} role="img" aria-label="证明义务与证书">
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} className={styles.canvasLabel}>
        证明类型：{proof?.proof_kind ?? '—'} · {proof?.status ?? '—'}
      </text>
      <text x={MARGIN.left + 16} y={MARGIN.top + 38} className={styles.canvasNote}>
        认证级别：{proof?.verification_level ?? '—'}
      </text>
      {obligations.map((item, index) => (
        <text key={item.id} x={MARGIN.left + 16} y={MARGIN.top + 64 + index * 24}
          className={item.status === 'pass' ? styles.canvasNote : styles.canvasLabel}>
          {item.status === 'pass' ? '✓' : '•'} 第 {index + 1} 项核对（依据见图下说明）
        </text>
      ))}
      <text x="388" y="400" textAnchor="middle">
        定理证书与局部等式核对分开显示；未认证证明不能自动判分
      </text>
    </svg>
  );
}

export function LabCanvas(props: Props): ReactNode {
  const { result, compare, selected, onSelect, step, onStepChange } = props;
  if (result.subject === 'unknown') {
    return <div className={styles.canvasRoot}><p>请先核对题目类型与条件，再建立可操作模型。</p></div>;
  }
  if (result.subject === 'calculus') {
    if(props.problem.manual_input?.double_extension){
      const input=props.problem.manual_input;
      return <section className={styles.canvasRoot} aria-label="二重积分计算依据"><h3>{input.double_extension!.title}</h3><Formula tex={input.latex} block /><p><MathText text={props.problem.solution.summary} /></p><p>计算使用已确认的原区域；参数代换、收敛依据与应用题的逐项结果见“原题计算结果与过程”。</p></section>;
    }
    if (props.problem.manual_input?.task === 'double_integral' && props.problem.solution.solution_complete !== true) {
      return <section className={styles.canvasRoot} aria-label="二重积分未完成"><h3>已记录完整积分区域</h3><Formula tex={props.problem.manual_input.latex} block /><p><MathText text={props.problem.solution.incomplete_reason || props.problem.solution.summary} /></p><p>当前不生成未核验的积分结果或替代示例；可在核对窗口修改原题字段后重算。</p></section>;
    }
    if (props.problem.manual_input?.task === 'triple_integral' && props.problem.solution.solution_complete !== true) {
      return <section className={styles.canvasRoot} aria-label="三重积分未完成"><h3>已记录完整三重积分区域</h3><Formula tex={props.problem.manual_input.latex} block />{result.space ? <SpaceCanvas result={result} /> : null}<p><MathText text={props.problem.solution.incomplete_reason || props.problem.solution.summary} /></p><p>当前不生成未核验的积分结果或替代示例；可在核对窗口修改原题字段后重算。</p></section>;
    }
    if (result.kind === 'multivariable_extrema') {
      const data=props.problem.solution.extrema_details;
      return <section className={styles.canvasRoot} aria-label="多元极值结果"><h3>多元局部极值计算</h3><p>{data?.constraint ? `完整约束：${data.constraint}` : '无约束，整个实平面'}</p>{props.problem.solution.solution_complete && data?.result_latex ? <Formula tex={data.result_latex} block /> : <p><MathText text={props.problem.solution.incomplete_reason || props.problem.solution.summary} /></p>}<CalculusCanvas result={result} compare={compare} selected={selected} onSelect={onSelect} /><p>候选点与判定依据见原题结果；未运行梯度下降示例，局部分类不代替全局最值证明。</p></section>;
    }
    if (result.kind === 'multivariable') {
      const data=props.problem.solution.multi_details;
      return <section className={styles.canvasRoot} aria-label="多元微分结果"><h3>多元微分计算</h3><p>变量顺序：{data?.variables.join('、')}</p>{data?.point ? <p>求值点：({data.point.join(', ')})</p> : <p>未指定求值点，展示条件适用的符号公式。</p>}{props.problem.solution.solution_complete && data?.result_latex ? <Formula tex={data.result_latex} block /> : <p><MathText text={props.problem.solution.incomplete_reason || props.problem.solution.summary} /></p>}<CalculusCanvas result={result} compare={compare} selected={selected} onSelect={onSelect} /><p>本任务展示符号结果与核验依据；求值点或方向修改后需要重新确认计算。</p></section>;
    }
    if (result.kind === 'proof' || result.proof) return <div className={styles.canvasRoot} data-subject="calculus"><ProofCanvas result={result} /><ol>{result.proof?.obligations.map(item => <li key={item.id}><MathText text={`${item.label}：${item.detail}`} /></li>)}</ol></div>;
    if (result.kind === 'space' || result.space) return <div className={styles.canvasRoot} data-subject="calculus"><SpaceCanvas result={result} /><p className={styles.canvasCaption}><span>当前结果</span><MathText text={result.answerText || result.headline} /></p></div>;
    if (result.task === 'double_integral') return <DoubleIntegralCanvas model={props.problem.model} result={result as DoubleIntegralResult} labId={props.labId} problemId={props.problem.problem_id} />;
    return (
      <div className={styles.canvasRoot} data-subject="calculus">
        <CalculusCanvas result={result} compare={compare} selected={selected} onSelect={onSelect}
          onParamDrag={props.onParamDrag} readOnly={props.readOnly}
          boundsDraggable={!['geometric_area', 'area_volume', 'rotation_volume'].includes(props.problem.model.task ?? '')}
          isNormal={props.problem.model.task === 'implicit_normal'} verticalNormal={props.problem.model.vertical_normal} />
        <p className={styles.canvasCaption}><span>当前结果</span><MathText text={result.answerText || result.headline} /></p>
      </div>
    );
  }
  if (result.subject === 'optimization') {
    if (result.kind === 'constrained_extrema') {
      return (
        <div className={styles.canvasRoot} data-subject="optimization">
          <ConstrainedExtremaCanvas result={result as OptimizationResult} />
          {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
        </div>
      );
    }
    return (
      <div className={styles.canvasRoot} data-subject="optimization">
        <OptimizationCanvas result={result} compare={compare} step={step} selected={selected} onSelect={onSelect} onStepChange={onStepChange} onParamDrag={props.onParamDrag} readOnly={props.readOnly} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'algorithm') {
    const manualSlice = (key: string) => ({
      saved: props.manual?.[key] as { mode?: boolean } | undefined,
      onSave: props.onManualChange ? (value: unknown) => props.onManualChange!(key, value) : undefined,
    });
    if (result.algorithm === 'heap') return <HeapCanvas result={result} step={step} selected={selected} onSelect={onSelect} readOnly={props.readOnly} {...manualSlice('heap')} />;
    if ('dsKind' in result) {
      return (
        <div className={styles.canvasRoot} data-subject="algorithm">
          <DsCanvas result={result} step={step} />
          {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
        </div>
      );
    }
    return (
      <div className={styles.canvasRoot} data-subject="algorithm">
        <BfsCanvas result={result} step={step} selected={selected} onSelect={onSelect} readOnly={props.readOnly} {...manualSlice('graph')} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'linear_algebra') {
    return (
      <div className={styles.canvasRoot} data-subject="linear_algebra">
        <LinAlgCanvas result={result} step={step} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'operating_system') {
    return (
      <div className={styles.canvasRoot} data-subject="operating_system">
        <OsCanvas result={result} step={step} selected={selected} onSelect={onSelect}
          manual={props.manual} onManualChange={props.onManualChange} readOnly={props.readOnly} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'computer_organization') {
    return (
      <div className={styles.canvasRoot} data-subject="computer_organization">
        <CoCanvas result={result} step={step} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'computer_network') {
    return (
      <div className={styles.canvasRoot} data-subject="computer_network">
        <NetworkCanvas result={result} step={step} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  if (result.subject === 'physics') {
    return (
      <div className={styles.canvasRoot} data-subject="physics">
        <PhysicsCanvas result={result} step={step} />
        {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
      </div>
    );
  }
  return (
    <div className={styles.canvasRoot} data-subject="deep_learning">
      <DlCanvas result={result} step={step} selected={selected} onSelect={onSelect} compare={compare}
        readOnly={props.readOnly}
        saved={props.manual?.dl as DlManual | undefined}
        onSave={props.onManualChange ? (value) => props.onManualChange!('dl', value) : undefined} />
      {selected?.kind === 'solution-step' ? <span className={styles.emphasisLabel}>正在突出：{selected.label}</span> : null}
    </div>
  );
}

export default LabCanvas;
