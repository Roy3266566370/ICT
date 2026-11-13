/**
 * ForceCanvas.tsx —— force_2d 的 SVG 矢量图（R7-AC1 / R7-AC3 / R7-AC4）
 *
 * 设计要点：
 *  - **等比坐标**：viewBox 固定 640×640 正方形，x 轴向右为 0°、y 轴向上为 90°；
 *    屏幕 y 轴与数学 y 轴相反，因此绘制时统一走 `toScreen()`，避免每个地方各写一次取反。
 *  - **长度按比例**：视野 range 由「各力分量 + 合力大小」的最大绝对值决定（至少 ±10N），
 *    所以 2–4 个力与合力的相对长度可直接目测比较。
 *  - **退化情况**：合力≈0 时**不画合力箭头**，改为原点处的空心圆 + "合力 0 N · 方向未定义"，
 *    绝不出现 0° 或 NaN（R7-AC3）。
 *  - 颜色不是唯一编码：分力/合力除了颜色不同，线宽与箭头形状也不同，并有文字图例。
 */
import { useId } from 'react';
import type { Force2dResult } from '@/api/types';
import { formatNumber, trimDecimalString } from '@/domain/format';
import styles from './force.module.css';

/** 画布内部坐标系边长（正方形 ⇒ 等比，图形不会被拉伸） */
const VIEW = 640;
const CENTER = VIEW / 2;
/** 箭头可用半径：留出四周文字与刻度空间 */
const MAX_RADIUS = 244;
/** 视野下限：至少 ±10N，避免 0.1N 的力画出满屏箭头 */
const MIN_RANGE = 10;
/** 网格分割数（每象限） */
const GRID_STEPS = 4;

export interface ForceCanvasProps {
  result: Force2dResult;
  reducedMotion: boolean;
}

/** 把数学坐标（x 右 / y 上，单位 N）换算成 SVG 屏幕坐标。 */
function toScreen(x: number, y: number, unit: number): { x: number; y: number } {
  return { x: CENTER + x * unit, y: CENTER - y * unit };
}

/** 由所有向量决定视野范围与每牛顿对应的像素数。 */
function computeScale(result: Force2dResult): { unit: number; range: number } {
  let maxAbs = 1;
  for (const force of result.forces) {
    maxAbs = Math.max(maxAbs, Math.abs(force.fx), Math.abs(force.fy));
  }
  maxAbs = Math.max(maxAbs, Math.abs(result.fx), Math.abs(result.fy), result.magnitude);
  const range = Math.max(MIN_RANGE, Math.ceil(maxAbs * 1.15));
  return { unit: MAX_RADIUS / range, range };
}

/** 力的可读标签：`F1 10N ∠0°`。 */
function forceLabel(magnitude: string, angle: number): string {
  return `${trimDecimalString(magnitude)}N ∠${trimDecimalString(formatNumber(angle, 2))}°`;
}

export default function ForceCanvas({ result, reducedMotion }: ForceCanvasProps) {
  const rawId = useId();
  const markerPrefix = rawId.replace(/[^A-Za-z0-9_-]/g, '');
  const { unit, range } = computeScale(result);

  const marker = (name: 'coral' | 'indigo' | 'muted'): string => `url(#${markerPrefix}-${name})`;

  // 网格与刻度：±GRID_STEPS 等分
  const gridLines: { value: number; screen: number }[] = [];
  for (let index = -GRID_STEPS; index <= GRID_STEPS; index += 1) {
    gridLines.push({ value: (range / GRID_STEPS) * index, screen: unit * ((range / GRID_STEPS) * index) });
  }

  const origin = toScreen(0, 0, unit);
  const resultantEnd = toScreen(result.fx, result.fy, unit);
  const directionText =
    result.direction_defined && result.direction_rounded !== null
      ? `${trimDecimalString(result.direction_rounded)}°`
      : '未定义';

  const ariaParts = result.forces.map(
    (force, index) => `F${index + 1} ${forceLabel(force.magnitude, force.angle_deg)}`,
  );
  const ariaLabel =
    `共点力矢量图：${ariaParts.join('，')}；合力 ${trimDecimalString(result.magnitude_rounded)}N，` +
    `方向 ${directionText}，分量 Fx=${trimDecimalString(formatNumber(result.fx, 2))}N、` +
    `Fy=${trimDecimalString(formatNumber(result.fy, 2))}N。`;

  return (
    <div className={styles.canvasWrap}>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <marker
            id={`${markerPrefix}-coral`}
            markerUnits="userSpaceOnUse"
            markerWidth={14}
            markerHeight={14}
            refX={12}
            refY={6}
            orient="auto"
            viewBox="0 0 14 14"
          >
            <path d="M0 0 L14 6 L0 12 Z" fill="var(--color-coral)" />
          </marker>
          <marker
            id={`${markerPrefix}-indigo`}
            markerUnits="userSpaceOnUse"
            markerWidth={16}
            markerHeight={16}
            refX={13}
            refY={7}
            orient="auto"
            viewBox="0 0 16 16"
          >
            <path d="M0 0 L16 7 L0 14 Z" fill="var(--color-indigo)" />
          </marker>
          <marker
            id={`${markerPrefix}-muted`}
            markerUnits="userSpaceOnUse"
            markerWidth={10}
            markerHeight={10}
            refX={9}
            refY={4}
            orient="auto"
            viewBox="0 0 10 10"
          >
            <path d="M0 0 L10 4 L0 8 Z" fill="var(--color-border-strong)" />
          </marker>
        </defs>

        {/* 网格 */}
        <g aria-hidden="true">
          {gridLines.map(({ value, screen }) => (
            <g key={`grid-${value}`}>
              <line
                x1={CENTER + screen}
                y1={0}
                x2={CENTER + screen}
                y2={VIEW}
                className={value === 0 ? styles.axis : styles.grid}
              />
              <line
                x1={0}
                y1={CENTER - screen}
                x2={VIEW}
                y2={CENTER - screen}
                className={value === 0 ? styles.axis : styles.grid}
              />
            </g>
          ))}
        </g>

        {/* 轴标签与比例说明（文字编码，不只靠颜色） */}
        <g aria-hidden="true" className={styles.axisLabel}>
          <text x={VIEW - 12} y={CENTER - 10} textAnchor="end">
            x
          </text>
          <text x={CENTER + 10} y={16} textAnchor="start">
            y（90°）
          </text>
          <text x={12} y={VIEW - 12} textAnchor="start">
            视野 ±{range} N
          </text>
        </g>

        {/* 合力的正交分量辅助线（矩形），用于说明 Fx / Fy 的来源 */}
        <g aria-hidden="true" className={styles.componentLines}>
          <line
            x1={origin.x}
            y1={origin.y}
            x2={resultantEnd.x}
            y2={origin.y}
            strokeDasharray="5 5"
            markerEnd={marker('muted')}
          />
          <line
            x1={resultantEnd.x}
            y1={origin.y}
            x2={resultantEnd.x}
            y2={resultantEnd.y}
            strokeDasharray="5 5"
            markerEnd={marker('muted')}
          />
          <text
            x={(origin.x + resultantEnd.x) / 2}
            y={origin.y + (result.fy >= 0 ? 16 : -8)}
            textAnchor="middle"
          >
            Fx = {trimDecimalString(formatNumber(result.fx, 2))} N
          </text>
          <text
            x={resultantEnd.x + (result.fx >= 0 ? 8 : -8)}
            y={(origin.y + resultantEnd.y) / 2}
            textAnchor={result.fx >= 0 ? 'start' : 'end'}
          >
            Fy = {trimDecimalString(formatNumber(result.fy, 2))} N
          </text>
        </g>

        {/* 各分力箭头（珊瑚橙，细线） */}
        {result.forces.map((force, index) => {
          const end = toScreen(force.fx, force.fy, unit);
          if (Math.hypot(force.fx, force.fy) < 1e-9) return null;
          const labelX = end.x + (force.fx >= 0 ? 10 : -10);
          const labelY = end.y + (force.fy >= 0 ? -10 : 18);
          return (
            <g key={`force-${index}`} className={styles.forceVector}>
              <line
                x1={origin.x}
                y1={origin.y}
                x2={end.x}
                y2={end.y}
                className={styles.forceLine}
                markerEnd={marker('coral')}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={force.fx >= 0 ? 'start' : 'end'}
                className={styles.forceLabel}
              >
                F{index + 1} {forceLabel(force.magnitude, force.angle_deg)}
              </text>
            </g>
          );
        })}

        {/* 合力箭头（靛蓝，粗线）；合力为零时不画箭头，避免暗示方向 */}
        {result.cancel || result.magnitude < result.tolerance ? (
          <g className={styles.cancelGroup}>
            <circle cx={origin.x} cy={origin.y} r={10} className={styles.cancelCircle} />
            <text x={origin.x + 18} y={origin.y + 5} textAnchor="start" className={styles.resultLabel}>
              合力 0 N · 方向未定义
            </text>
          </g>
        ) : (
          <g className={styles.resultVector}>
            <line
              x1={origin.x}
              y1={origin.y}
              x2={resultantEnd.x}
              y2={resultantEnd.y}
              className={styles.resultLine}
              markerEnd={marker('indigo')}
            />
            <text
              x={resultantEnd.x + (result.fx >= 0 ? 10 : -10)}
              y={resultantEnd.y + (result.fy >= 0 ? 20 : -12)}
              textAnchor={result.fx >= 0 ? 'start' : 'end'}
              className={styles.resultLabel}
            >
              合力 R {trimDecimalString(result.magnitude_rounded)}N ∠{directionText}
            </text>
          </g>
        )}

        {/* 原点 */}
        <circle cx={origin.x} cy={origin.y} r={4} className={styles.originDot} aria-hidden="true" />
      </svg>

      <ul className={styles.legend} aria-label="图例">
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchCoral}`} aria-hidden="true" />
          分力（珊瑚橙细箭头）
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchIndigo}`} aria-hidden="true" />
          合力（靛蓝粗箭头）
        </li>
        <li className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchDashed}`} aria-hidden="true" />
          合力的正交分量 Fx / Fy（灰色虚线）
        </li>
      </ul>

      <p className={styles.canvasNote} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        角度约定：0° 向右（x 轴正方向）、逆时针为正、90° 向上；箭头长度按同一比例尺换算，
        可直接比较各力的相对大小。
      </p>
    </div>
  );
}