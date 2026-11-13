/**
 * svdSteps/MiniPlot.tsx —— S14 的单个子图（圆 / 椭圆 / 旋转椭圆）+ 标记点。
 *
 * 视觉与语义（rebuild-spec §7 / §9 S14）：
 *  - 单位圆用「原像虚浅 #A9B4C7」虚线常驻作参考；当前阶段形状用实线（阶段性配色）；
 *  - **标记点始终存在**：第一步 Vᵀ 是旋转，圆看起来没变，只有标记点从 (1,0) 转到新方向
 *    —— 这是原件「光画圆看不出第一步——要盯住那个标记点」的核心；
 *  - 过渡按该步的真实语义插值：① 按角度旋转、② 按倍率伸缩、③ 按角度转向；
 *  - 倍率标注（×σ₁ / ×σ₂）放在轴端点外侧并带底色描边，避免压在线上。
 */
import type { Vec2 } from './svd';
import { fmtNumber } from './svd';
import styles from './svdSteps.module.css';

const AXIS = '#8B9AB3';
const GHOST = '#A9B4C7';
const ORANGE = '#C4622D';
const NAVY = '#16233A';

export interface MiniPlotProps {
  /** 数学原点在 SVG 中的像素位置 */
  center: readonly [number, number];
  /** 1 数学单位 = 多少 SVG px */
  unit: number;
  phase: 0 | 1 | 2;
  sigma: readonly [number, number];
  /** 该阶段标记点的终态（数学坐标） */
  marker: Vec2;
  /** 该阶段标记点的起点（上一阶段位置；① 的起点固定为 (1,0)） */
  fromMarker: Vec2;
  /** 长轴方向（度，仅 phase 2 使用） */
  majorAngleDeg: number;
  /** 本阶段过渡进度 0..1（reducedMotion 时恒为 1） */
  progress: number;
  active: boolean;
  reached: boolean;
  markerPrefix: string;
  /** 小标题，如「① 单位圆」 */
  label: string;
  /** 屏幕阅读器描述 */
  ariaLabel: string;
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function angleOf(v: Vec2): number {
  return Math.atan2(v[1], v[0]);
}

/** 角度插值（取最短路径，避免跨 ±180° 时反向绕一圈）。 */
function lerpAngle(from: number, to: number, t: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

export default function MiniPlot(props: MiniPlotProps) {
  const {
    center,
    unit,
    phase,
    sigma,
    marker,
    fromMarker,
    majorAngleDeg,
    progress,
    active,
    reached,
    markerPrefix,
    label,
    ariaLabel,
  } = props;

  const [centerX, centerY] = center;
  const point = (x: number, y: number): [number, number] => [
    Math.round((centerX + x * unit) * 1000) / 1000,
    Math.round((centerY - y * unit) * 1000) / 1000,
  ];

  const axisLength = Math.max(1.25, sigma[0] * 1.04);
  const [axisLeft] = point(-axisLength, 0);
  const [axisRight] = point(axisLength, 0);
  const [, axisTop] = point(0, axisLength);
  const [, axisBottom] = point(0, -axisLength);

  // 形状参数：① 保持单位圆；② 从圆按倍率过渡到椭圆；③ 已伸缩后再按角度转向
  let rx = unit;
  let ry = unit;
  let rotateDeg = 0;
  if (phase === 1) {
    rx = unit * (1 + (sigma[0] - 1) * progress);
    ry = unit * (1 + (sigma[1] - 1) * progress);
  } else if (phase === 2) {
    rx = unit * sigma[0];
    ry = unit * sigma[1];
    rotateDeg = -majorAngleDeg * progress; // SVG 的 rotate 正角为顺时针，数学逆时针取负
  }

  // 标记点按该步的真实语义插值
  let markerPoint: Vec2;
  if (phase === 0) {
    const from = angleOf(fromMarker);
    const to = angleOf(marker);
    const angle = lerpAngle(from, to, progress);
    markerPoint = [Math.cos(angle), Math.sin(angle)];
  } else if (phase === 1) {
    markerPoint = [
      fromMarker[0] * (1 + (sigma[0] - 1) * progress),
      fromMarker[1] * (1 + (sigma[1] - 1) * progress),
    ];
  } else {
    const radius = Math.hypot(fromMarker[0], fromMarker[1]);
    const angle = lerpAngle(angleOf(fromMarker), angleOf(marker), progress);
    markerPoint = [radius * Math.cos(angle), radius * Math.sin(angle)];
  }

  const [markerX, markerY] = point(markerPoint[0], markerPoint[1]);
  const [originX, originY] = point(0, 0);
  const [fromX, fromY] = point(fromMarker[0], fromMarker[1]);

  const strokeColor = phase === 1 ? ORANGE : NAVY;
  const shapeOpacity = reached ? 1 : 0.3;

  // 倍率标注位置：沿长轴 / 短轴端点外侧
  const minorEnd = point(0, sigma[1] * 1.0);
  const majorLabel =
    rotateDeg === 0
      ? point(sigma[0], 0)
      : point(
          sigma[0] * Math.cos(degToRad(majorAngleDeg * progress)),
          sigma[0] * Math.sin(degToRad(majorAngleDeg * progress)),
        );

  return (
    <g
      className={styles.plot}
      data-phase={phase}
      data-active={active ? 'true' : undefined}
      data-reached={reached ? 'true' : undefined}
      role="group"
      aria-label={ariaLabel}
      style={{ opacity: reached ? 1 : 0.42 }}
    >
      {/* 坐标轴 */}
      <g aria-hidden="true" className={styles.axis}>
        <line x1={axisLeft} y1={centerY} x2={axisRight} y2={centerY} stroke={AXIS} />
        <line x1={centerX} y1={axisTop} x2={centerX} y2={axisBottom} stroke={AXIS} />
        <circle cx={originX} cy={originY} r={2.6} fill={AXIS} />
      </g>

      {/* 原像：单位圆（虚浅虚线，始终作为参考） */}
      <circle cx={originX} cy={originY} r={unit} className={styles.ghostCircle} stroke={GHOST} />

      {/* 当前阶段形状 */}
      {phase === 0 ? (
        <circle
          cx={originX}
          cy={originY}
          r={unit}
          className={styles.shape}
          stroke={strokeColor}
          style={{ opacity: shapeOpacity }}
        />
      ) : (
        <ellipse
          cx={originX}
          cy={originY}
          rx={Math.max(rx, 0.5)}
          ry={Math.max(ry, 0.5)}
          className={styles.shape}
          stroke={strokeColor}
          style={{ opacity: shapeOpacity }}
          transform={rotateDeg === 0 ? undefined : `rotate(${rotateDeg} ${originX} ${originY})`}
        />
      )}

      {/* 标记点：起点（虚线淡圈）+ 当前点（实心橙）+ 方向箭头 */}
      {active && progress < 0.999 ? (
        <circle cx={fromX} cy={fromY} r={4} className={styles.markerFrom} stroke={GHOST} />
      ) : null}
      <line
        x1={originX}
        y1={originY}
        x2={markerX}
        y2={markerY}
        className={styles.markerArrow}
        stroke={ORANGE}
        markerEnd={`url(#${markerPrefix}-marker)`}
      />
      <circle cx={markerX} cy={markerY} r={active ? 6.5 : 5} className={styles.markerDot} fill={ORANGE} />
      <text x={markerX + 10} y={markerY - 8} className={styles.markerLabel} textAnchor="start">
        标记点
      </text>

      {/* 倍率标注（§7：带 #F6F3EC 描边做底，不压线） */}
      {phase === 1 || phase === 2 ? (
        <g aria-hidden="true">
          <text x={majorLabel[0]} y={majorLabel[1] - 8} className={styles.scaleLabel} textAnchor="middle">
            ×{fmtNumber(sigma[0], 3)}
          </text>
          <text x={minorEnd[0] + 8} y={minorEnd[1] + 4} className={styles.scaleLabel} textAnchor="start">
            ×{fmtNumber(sigma[1], 3)}
          </text>
        </g>
      ) : null}

      {/* 小标题（原页文字在区域外，这里只作阶段提示，字号克制） */}
      <text x={originX} y={point(0, -axisLength)[1] + 12} className={styles.plotLabel} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}