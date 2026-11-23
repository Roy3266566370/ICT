import { formatNumber } from '../../../labs/expr';
import type { SliceBand, SlicePoint } from '../../../labs/walkthrough';
import styles from './primitives.module.css';

interface CumulativeChartProps {
  exactPoints: SlicePoint[];
  bands: SliceBand[];
  band: SliceBand;
  h: number;
  exact: number;
  approx: number;
  verified: boolean;
  revealValue: boolean;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];
const PLOT = { x: 74, y: 16, w: 556, h: 126 };

export function CumulativeChart({ exactPoints, bands, band, h, exact, approx, verified, revealValue }: CumulativeChartProps) {
  const lower = exactPoints[0]!.z;
  const upper = exactPoints[exactPoints.length - 1]!.z;
  const approxPoints = [{ z: lower, value: 0 }, ...bands.map((item) => ({ z: item.upper, value: item.cumulative }))];
  const values = [...exactPoints, ...approxPoints].map((point) => point.value);
  const min = Math.min(0, exact, approx, ...values);
  const max = Math.max(0, exact, approx, ...values);
  const pad = ((max - min) || 1) * 0.12;
  const y0 = min - pad;
  const y1 = max + pad;
  const x = (z: number) => PLOT.x + ((z - lower) / (upper - lower)) * PLOT.w;
  const y = (value: number) => PLOT.y + (1 - (value - y0) / (y1 - y0)) * PLOT.h;
  const points = (curve: SlicePoint[]) => curve.map((point) => `${x(point.z)},${y(point.value)}`).join(' ');
  const exactLabel = verified ? '精确积分' : '待验证的积分';

  return (
    <div className={styles.chart}>
      <div className={styles.chartHeader}>
        <h3>沿 z 累积</h3>
        <ul className={styles.legend}>
          <li className={styles.exactKey}>{exactLabel}</li>
          <li className={styles.approxKey}>环带累加</li>
        </ul>
      </div>
      <svg viewBox="0 0 654 174" role="img" aria-label={`截面高度 ${formatNumber(h, 2)}${revealValue ? `，${exactLabel} ${formatNumber(exact, 4)}，环带累加 ${formatNumber(approx, 4)}` : ''}`}>
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.w} height={PLOT.h} className={styles.plot} />
        {TICKS.map((ratio) => {
          const value = y0 + ratio * (y1 - y0);
          const z = lower + ratio * (upper - lower);
          return (
            <g key={ratio} className={styles.gridline}>
              <line x1={PLOT.x} x2={PLOT.x + PLOT.w} y1={y(value)} y2={y(value)} />
              <text x={PLOT.x - 8} y={y(value) + 4} textAnchor="end">{formatNumber(value, 2)}</text>
              <text x={x(z)} y={PLOT.y + PLOT.h + 19} textAnchor="middle">{formatNumber(z, 2)}</text>
            </g>
          );
        })}
        <text x={PLOT.x + PLOT.w + 14} y={PLOT.y + PLOT.h + 19} className={styles.axisLabel}>z</text>
        <rect x={x(band.lower)} y={PLOT.y} width={x(band.upper) - x(band.lower)} height={PLOT.h} className={styles.selectedBand} />
        <polyline className={styles.exact} points={points(exactPoints)} />
        <polyline className={styles.approx} points={points(approxPoints)} />
        <line x1={x(h)} x2={x(h)} y1={PLOT.y} y2={PLOT.y + PLOT.h} className={styles.cursor} />
        <circle cx={x(h)} cy={y(exact)} r={4} className={styles.exactDot} />
        <circle cx={x(h)} cy={y(approx)} r={3} className={styles.approxDot} />
      </svg>
    </div>
  );
}
