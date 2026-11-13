/**
 * BudgetChart.tsx —— budget_compare 的 SVG 折线图（R9-AC4 / R9-AC5 / T6 验收 5–6）
 *
 *  - 横轴人数 n（0..2000）、纵轴金额；两条直线直接由契约的 `lines[]` 两点式数据绘制
 *    （`at_zero` 为 n=0、`at_max` 为 n=2000、`slope` 为人均增量）。
 *  - 方案 A 靛蓝**实线**、方案 B 珊瑚橙**虚线**——颜色 + 线型双编码，不只靠颜色。
 *  - 预算水平线只在 `budget_limit !== null` 时绘制；未设上限时**完全不渲染**该线与余量（R9-AC5）。
 *  - 交点标记只在两条直线确实相交时出现（斜率不同且交点落在 [0, 2000]）。
 *  - **像素坐标只用于几何定位**：直线的两个端点由 `at_zero / at_max` 换算，
 *    当前人数处的金额标签直接取内核输出的 `scenarios[].total`（十进制字符串）。
 */
import type { BudgetCompareResult } from '@/api/types';
import { LINE_MAX_PEOPLE, PEOPLE_MAX } from '@/domain/budget';
import { formatMoney, formatNumber, trimDecimalString } from '@/domain/format';
import styles from './budget.module.css';

const VIEW_WIDTH = 780;
const VIEW_HEIGHT = 400;
const PAD_LEFT = 92;
const PAD_RIGHT = 28;
const PAD_TOP = 26;
const PAD_BOTTOM = 58;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
/** 纵轴刻度数（区间等分） */
const Y_TICKS = 4;
/** 横轴刻度（人数） */
const X_TICKS = [0, 500, 1000, 1500, 2000] as const;

export interface BudgetChartProps {
  result: BudgetCompareResult;
  names: [string, string];
  reducedMotion: boolean;
}

/** 把纵轴上界向上取整到 1 / 2 / 2.5 / 5 × 10^k，刻度才不会出现 9374.3 这种数字。 */
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1000;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (value <= factor * base) return factor * base;
  }
  return 10 * base;
}

export default function BudgetChart({ result, names, reducedMotion }: BudgetChartProps) {
  const lineA = result.lines[0];
  const lineB = result.lines[1];
  const limit = result.budget_limit === null ? null : Number(result.budget_limit);

  // 两点式端点：只做像素换算，金额真值仍是十进制字符串
  const zeroA = Number(lineA.at_zero);
  const maxA = Number(lineA.at_max);
  const zeroB = Number(lineB.at_zero);
  const maxB = Number(lineB.at_max);

  const rawMax = Math.max(maxA, maxB, limit ?? 0, 1);
  const maxY = niceCeil(rawMax * 1.05);

  const x = (people: number): number => PAD_LEFT + (people / LINE_MAX_PEOPLE) * PLOT_WIDTH;
  const y = (amount: number): number => PAD_TOP + PLOT_HEIGHT - (amount / maxY) * PLOT_HEIGHT;

  const people = result.inputs.people;
  const currentA = zeroA + (Number(lineA.slope) * people);
  const currentB = zeroB + (Number(lineB.slope) * people);

  // 交点：两条直线斜率不同才有唯一交点；像素换算用浮点，文案给"约"字
  const slopeA = Number(lineA.slope);
  const slopeB = Number(lineB.slope);
  const slopeDiff = slopeA - slopeB;
  let crossing: { people: number; amount: number } | null = null;
  if (Math.abs(slopeDiff) > 1e-9) {
    const crossPeople = (zeroB - zeroA) / slopeDiff;
    if (Number.isFinite(crossPeople) && crossPeople >= 0 && crossPeople <= LINE_MAX_PEOPLE) {
      crossing = { people: crossPeople, amount: zeroA + slopeA * crossPeople };
    }
  }

  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, index) => (maxY / Y_TICKS) * index);

  const ariaLabel =
    `两方案金额曲线：${names[0]} 从 ${formatMoney(lineA.at_zero)} 元线性增长到 n=${LINE_MAX_PEOPLE} 时的 ` +
    `${formatMoney(lineA.at_max)} 元；${names[1]} 从 ${formatMoney(lineB.at_zero)} 元增长到 ` +
    `${formatMoney(lineB.at_max)} 元。当前 n=${people} 时分别为 ${formatMoney(result.scenarios[0].total)} 元与 ` +
    `${formatMoney(result.scenarios[1].total)} 元。` +
    (result.budget_limit === null ? '未设预算上限，不绘制预算线。' : `预算上限 ${formatMoney(result.budget_limit)} 元。`);

  return (
    <div className={styles.chartWrap} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <svg className={styles.chart} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={ariaLabel}>
        {/* 网格与刻度 */}
        <g aria-hidden="true">
          {yTicks.map((tick) => (
            <g key={`ytick-${tick}`}>
              <line
                x1={PAD_LEFT}
                y1={y(tick)}
                x2={VIEW_WIDTH - PAD_RIGHT}
                y2={y(tick)}
                className={tick === 0 ? styles.axis : styles.grid}
              />
              <text x={PAD_LEFT - 10} y={y(tick) + 4} textAnchor="end" className={styles.tickLabel}>
                {formatMoney(formatNumber(tick, 0))}
              </text>
            </g>
          ))}
          {X_TICKS.map((tick) => (
            <g key={`xtick-${tick}`}>
              <line x1={x(tick)} y1={PAD_TOP} x2={x(tick)} y2={PAD_TOP + PLOT_HEIGHT} className={styles.grid} />
              <text x={x(tick)} y={PAD_TOP + PLOT_HEIGHT + 22} textAnchor="middle" className={styles.tickLabel}>
                {tick}
              </text>
            </g>
          ))}
        </g>

        {/* 轴标题 */}
        <text x={PAD_LEFT + PLOT_WIDTH / 2} y={VIEW_HEIGHT - 12} textAnchor="middle" className={styles.axisTitle}>
          人数 n（{PEOPLE_MAX} 人为绘图区间上界）
        </text>
        <text
          x={16}
          y={PAD_TOP + PLOT_HEIGHT / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${PAD_TOP + PLOT_HEIGHT / 2})`}
          className={styles.axisTitle}
        >
          金额（元）
        </text>

        {/* 预算水平线：仅设上限时渲染 */}
        {limit === null ? null : (
          <g>
            <line
              x1={PAD_LEFT}
              y1={y(limit)}
              x2={VIEW_WIDTH - PAD_RIGHT}
              y2={y(limit)}
              className={styles.limitLine}
            />
            <text x={PAD_LEFT + 8} y={y(limit) - 8} textAnchor="start" className={styles.limitLabel}>
              预算上限 {formatMoney(result.budget_limit ?? '0')} 元
            </text>
          </g>
        )}

        {/* 两条方案直线（两点式：n=0 与 n=2000） */}
        <line x1={x(0)} y1={y(zeroA)} x2={x(LINE_MAX_PEOPLE)} y2={y(maxA)} className={styles.lineA} />
        <line x1={x(0)} y1={y(zeroB)} x2={x(LINE_MAX_PEOPLE)} y2={y(maxB)} className={styles.lineB} />

        {/* 交点 */}
        {crossing === null ? null : (
          <g>
            <circle cx={x(crossing.people)} cy={y(crossing.amount)} r={7} className={styles.crossPoint} />
            <text
              x={x(crossing.people)}
              y={y(crossing.amount) - 14}
              textAnchor={crossing.people > LINE_MAX_PEOPLE * 0.75 ? 'end' : 'start'}
              className={styles.crossLabel}
            >
              交点 n ≈ {trimDecimalString(formatNumber(crossing.people, 1))}（两方案总额相等）
            </text>
          </g>
        )}

        {/* 当前 n 的参考线与两个数据点 */}
        <line
          x1={x(people)}
          y1={PAD_TOP}
          x2={x(people)}
          y2={PAD_TOP + PLOT_HEIGHT}
          className={styles.currentLine}
        />
        <rect
          x={x(people) - 5}
          y={y(currentB) - 5}
          width={10}
          height={10}
          className={styles.pointB}
          aria-hidden="true"
        />
        <circle cx={x(people)} cy={y(currentA)} r={6} className={styles.pointA} aria-hidden="true" />

        <text
          x={x(people) + 10}
          y={y(currentA) - 10}
          textAnchor={people > LINE_MAX_PEOPLE * 0.8 ? 'end' : 'start'}
          className={styles.pointLabelA}
        >
          {names[0]} {formatMoney(result.scenarios[0].total)} 元
        </text>
        <text
          x={x(people) + 10}
          y={y(currentB) + 18}
          textAnchor={people > LINE_MAX_PEOPLE * 0.8 ? 'end' : 'start'}
          className={styles.pointLabelB}
        >
          {names[1]} {formatMoney(result.scenarios[1].total)} 元
        </text>
      </svg>

      <ul className={styles.legend} aria-label="图例">
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendA}`} aria-hidden="true" />
          {names[0]}（实线 · 靛蓝）
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendB}`} aria-hidden="true" />
          {names[1]}（虚线 · 珊瑚橙，方形点）
        </li>
        {result.budget_limit === null ? (
          <li className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendMuted}`} aria-hidden="true" />
            未设上限：不绘制预算线、不显示余量
          </li>
        ) : (
          <li className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendMuted}`} aria-hidden="true" />
            预算上限水平线（{formatMoney(result.budget_limit)} 元）
          </li>
        )}
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendCurrent}`} aria-hidden="true" />
          当前人数 n = {people}
        </li>
      </ul>

      <p className={styles.chartNote}>
        直线的两个端点由内核输出的两点式数据绘制（n=0 与 n={LINE_MAX_PEOPLE}）；当前人数处的金额标签取内核总额。
        像素坐标只用于几何定位，交点的「n ≈」为几何换算值，不参与任何金额真值。
      </p>
    </div>
  );
}