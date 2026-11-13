/**
 * MatrixCanvas.tsx —— matrix_2d 的可交互 SVG 画布（R6-AC5 / R6-AC6 / R6-AC8 / R6-AC11）
 *
 * 设计要点：
 *  - **等比坐标**：viewBox 固定为正方形 640×640，数学范围随参数自适应（至少 -4..4），
 *    横纵轴共用同一个 `scale`，因此图形不会被拉伸，能直接看出"圆变椭圆"。
 *  - **三种显示模式**：原始 / 变换后 / 叠加，只改绘制集合，不改参数，也不重建任何状态。
 *  - **拖动端点**：拖动过程只写本地 preview state 做实时预览，pointerup 才提交一次
 *    `onVectorChange`（即 `onParameterChange`），避免高频写全局 store 触发 revision 暴涨。
 *  - **键盘可达**：端点 tabIndex=0，方向键 ±0.1，Shift+方向键 ±1.0，与滑块步长一致。
 *  - **退化情况**：rank<2 时不画椭圆（单位圆的像不再是椭圆），并在画布顶部给出说明；
 *    零向量时端点仍在原点可拖，标签显示 "x = (0, 0)"。
 */
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Matrix2, Vector2 } from '@/api/types';
import { applyMatrix, applyMatrixToPolygon, sampleUnitCircle, sampleUnitSquare } from '@/domain/matrix';
import { EPSILON } from '@/domain/format';
import { formatValue, formatVec } from './MatrixNumericTable';
import styles from './matrix.module.css';

export type DisplayMode = 'original' | 'transformed' | 'overlay';

/** 画布内部坐标系边长（viewBox 正方形 ⇒ 等比） */
const VIEW = 640;
/** 四周留白：给刻度、轴标签与端点手柄 */
const PAD = 58;
/** 可视范围下限：至少 -4..4（T5 验收 3） */
const MIN_RANGE = 4;
/** 可视范围上限：参数上界 3 时 Ax 分量最大 18，20 足够容纳 */
const MAX_RANGE = 20;
/** 与 C-MX@1 规则 7 一致：元素与分量 -3..3，步长 0.1 */
const PARAM_MIN = -3;
const PARAM_MAX = 3;
const PARAM_STEP = 0.1;
/** 单位圆采样点数（足够让椭圆边界平滑） */
const CIRCLE_SAMPLES = 96;

/** 把任意值吸附到参数的合法网格上（clamp 到 [-3, 3]，四舍五入到 0.1）。 */
function clampParam(value: number): number {
  const clamped = Math.min(PARAM_MAX, Math.max(PARAM_MIN, value));
  const snapped = Math.round(clamped / PARAM_STEP) * PARAM_STEP;
  const rounded = Math.round(snapped * 1e10) / 1e10;
  return Math.abs(rounded) <= EPSILON ? 0 : rounded;
}

/** 由所有要显示的点决定可视范围（对称、等比、向上取到 0.5 的倍数）。 */
function computeRange(points: readonly Vector2[]): number {
  let maxAbs = MIN_RANGE;
  for (const point of points) {
    maxAbs = Math.max(maxAbs, Math.abs(point[0]), Math.abs(point[1]));
  }
  const needed = maxAbs * 1.12 + 0.4;
  const range = Math.ceil(needed * 2) / 2;
  return Math.min(MAX_RANGE, Math.max(MIN_RANGE, range));
}

/** 对称刻度序列：-limit*step .. limit*step（跳过 0 的交点由调用方处理）。 */
function enumerateTicks(range: number, step: number): number[] {
  const limit = Math.floor(range / step);
  const ticks: number[] = [];
  for (let index = -limit; index <= limit; index += 1) {
    ticks.push(index * step);
  }
  return ticks;
}

function isZeroVector(vector: Vector2): boolean {
  return Math.abs(vector[0]) <= EPSILON && Math.abs(vector[1]) <= EPSILON;
}

export interface MatrixCanvasProps {
  matrix: Matrix2;
  vector: Vector2;
  rank: 0 | 1 | 2;
  /** 单位圆像的半轴长；rank<2 时为 null（此时不画椭圆） */
  ellipse: { a: number; b: number } | null;
  display: DisplayMode;
  reducedMotion: boolean;
  /** 与数字输入共用同一个提交路径（C-UI@1 TemplateProps.onParameterChange） */
  onVectorChange: (next: Vector2) => void;
}

export default function MatrixCanvas({
  matrix,
  vector,
  rank,
  ellipse,
  display,
  reducedMotion,
  onVectorChange,
}: MatrixCanvasProps) {
  const rawId = useId();
  const markerPrefix = rawId.replace(/[^A-Za-z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const [preview, setPreview] = useState<Vector2 | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * 拖动期间冻结可视范围：若范围随 preview 一起重算，画面会在拖动时忽大忽小，
   * 端点看起来"跳"。冻结后坐标映射不变，手柄严格跟随指针。
   */
  const [frozenRange, setFrozenRange] = useState<number | null>(null);

  // 拖动过程中只渲染 preview；提交后由 props.vector 接管
  const activeVector: Vector2 = preview ?? vector;
  const activeAx = applyMatrix(matrix, activeVector);
  const columns: [Vector2, Vector2] = [
    [matrix[0][0], matrix[1][0]],
    [matrix[0][1], matrix[1][1]],
  ];

  const naturalRange = computeRange([
    activeVector,
    activeAx,
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [matrix[0][0], matrix[0][1]],
    [matrix[1][0], matrix[1][1]],
  ]);
  const range = frozenRange ?? naturalRange;
  const scale = (VIEW - PAD * 2) / (2 * range);
  const cx = VIEW / 2;
  const cy = VIEW / 2;
  const gridStep = range <= 6 ? 1 : range <= 12 ? 2 : 4;
  const ticks = enumerateTicks(range, gridStep);

  const showOriginal = display === 'original' || display === 'overlay';
  const showTransformed = display === 'transformed' || display === 'overlay';

  const squarePoints = sampleUnitSquare();
  const imageSquarePoints = applyMatrixToPolygon(matrix, squarePoints);
  const circlePoints = sampleUnitCircle(CIRCLE_SAMPLES);
  const imageCirclePoints = applyMatrixToPolygon(matrix, circlePoints);

  const toX = (value: number): number => cx + value * scale;
  const toY = (value: number): number => cy - value * scale;
  const project = (point: Vector2): string => `${toX(point[0]).toFixed(2)},${toY(point[1]).toFixed(2)}`;
  const polygonOf = (points: readonly Vector2[]): string => points.map(project).join(' ');

  /** 标签位置：按点的横向位置决定左右对齐，避免文字压到图形上。 */
  const placement = (
    point: Vector2,
    offsetX = 8,
    offsetY = -8,
  ): { x: number; y: number; textAnchor: 'start' | 'end' } => {
    const anchor: 'start' | 'end' = point[0] < 0 ? 'end' : 'start';
    return {
      x: toX(point[0]) + (anchor === 'end' ? -offsetX : offsetX),
      y: toY(point[1]) + offsetY,
      textAnchor: anchor,
    };
  };

  const marker = (name: 'indigo' | 'coral' | 'muted'): string => `url(#${markerPrefix}-${name})`;

  /** 客户端坐标 → 数学坐标（用 getScreenCTM 反算，CSS 缩放/留白都能正确处理）。 */
  const mathFromClient = (clientX: number, clientY: number): Vector2 | null => {
    const svg = svgRef.current;
    if (svg === null) return null;
    const ctm = svg.getScreenCTM();
    if (ctm === null) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return [clampParam((local.x - cx) / scale), clampParam((cy - local.y) / scale)];
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setFrozenRange(range);
    const next = mathFromClient(event.clientX, event.clientY);
    if (next !== null) setPreview(next);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>): void => {
    if (!draggingRef.current) return;
    const next = mathFromClient(event.clientX, event.clientY);
    if (next !== null) setPreview(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGGElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 浏览器可能已隐式释放指针捕获；失败无副作用，忽略
    }
    const next = mathFromClient(event.clientX, event.clientY);
    setPreview(null);
    setFrozenRange(null);
    if (
      next !== null &&
      (Math.abs(next[0] - vector[0]) > EPSILON || Math.abs(next[1] - vector[1]) > EPSILON)
    ) {
      onVectorChange(next);
    }
  };

  const handlePointerCancel = (): void => {
    // 取消（如触摸被打断）时丢弃预览，不提交，避免误改参数
    draggingRef.current = false;
    setDragging(false);
    setPreview(null);
    setFrozenRange(null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>): void => {
    const delta = event.shiftKey ? 1 : PARAM_STEP;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dx = -delta;
        break;
      case 'ArrowRight':
        dx = delta;
        break;
      case 'ArrowUp':
        dy = delta;
        break;
      case 'ArrowDown':
        dy = -delta;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next: Vector2 = [clampParam(activeVector[0] + dx), clampParam(activeVector[1] + dy)];
    if (Math.abs(next[0] - activeVector[0]) <= EPSILON && Math.abs(next[1] - activeVector[1]) <= EPSILON) {
      return; // 已到边界，不产生无意义的 revision
    }
    onVectorChange(next);
  };

  const handleLabel = `输入向量端点，当前 x = ${formatVec(
    activeVector,
  )}。拖动或按方向键调整（每次 0.1，按住 Shift 每次 1.0）。`;

  return (
    <figure className={styles.canvasFigure} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <div className={styles.canvasWrap}>
        <svg
          ref={svgRef}
          className={styles.canvas}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          role="group"
          aria-label="矩阵作用于二维平面的示意图：网格、坐标轴、原像与像"
        >
          <title>矩阵 A 作用于输入向量 x 的几何示意</title>

          <defs>
            <marker
              id={`${markerPrefix}-indigo`}
              markerUnits="userSpaceOnUse"
              markerWidth={14}
              markerHeight={14}
              refX={14}
              refY={7}
              orient="auto"
              viewBox="0 0 14 14"
            >
              <path d="M 0 0 L 14 7 L 0 14 z" fill="var(--color-indigo)" />
            </marker>
            <marker
              id={`${markerPrefix}-coral`}
              markerUnits="userSpaceOnUse"
              markerWidth={14}
              markerHeight={14}
              refX={14}
              refY={7}
              orient="auto"
              viewBox="0 0 14 14"
            >
              <path d="M 0 0 L 14 7 L 0 14 z" fill="var(--color-coral)" />
            </marker>
            <marker
              id={`${markerPrefix}-muted`}
              markerUnits="userSpaceOnUse"
              markerWidth={12}
              markerHeight={12}
              refX={12}
              refY={6}
              orient="auto"
              viewBox="0 0 12 12"
            >
              <path d="M 0 0 L 12 6 L 0 12 z" fill="var(--color-navy-subtle)" />
            </marker>
          </defs>

          <rect x={0} y={0} width={VIEW} height={VIEW} fill="var(--color-surface-raised)" />

          {/* 网格与刻度 */}
          <g aria-hidden="true">
            {ticks.map((tick) => (
              <g key={`grid-${tick}`}>
                <line
                  x1={toX(tick)}
                  y1={toY(-range)}
                  x2={toX(tick)}
                  y2={toY(range)}
                  className={styles.gridLine}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={toX(-range)}
                  y1={toY(tick)}
                  x2={toX(range)}
                  y2={toY(tick)}
                  className={styles.gridLine}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
            {ticks.map((tick) =>
              tick === 0 ? null : (
                <g key={`tick-${tick}`}>
                  <text x={toX(tick)} y={cy + 20} textAnchor="middle" className={styles.tickLabel}>
                    {formatValue(tick, 0)}
                  </text>
                  <text x={cx - 10} y={toY(tick) + 5} textAnchor="end" className={styles.tickLabel}>
                    {formatValue(tick, 0)}
                  </text>
                </g>
              ),
            )}
          </g>

          {/* 坐标轴 */}
          <g aria-hidden="true">
            <line
              x1={toX(-range)}
              y1={cy}
              x2={toX(range)}
              y2={cy}
              className={styles.axisLine}
              markerEnd={marker('muted')}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={cx}
              y1={toY(-range)}
              x2={cx}
              y2={toY(range)}
              className={styles.axisLine}
              markerEnd={marker('muted')}
              vectorEffect="non-scaling-stroke"
            />
            <text x={toX(range) - 4} y={cy - 12} textAnchor="end" className={styles.axisLabel}>
              x
            </text>
            <text x={cx + 12} y={toY(range) + 6} textAnchor="start" className={styles.axisLabel}>
              y
            </text>
          </g>

          {/* 原像：单位正方形、单位圆、基向量、输入向量（灰蓝虚线） */}
          {showOriginal ? (
            <g>
              <polygon points={polygonOf(squarePoints)} className={styles.originalSquare} />
              <circle cx={cx} cy={cy} r={scale} className={styles.originalCircle} />

              <line
                x1={cx}
                y1={cy}
                x2={toX(1)}
                y2={toY(0)}
                className={styles.inputVector}
                markerEnd={marker('muted')}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={cx}
                y1={cy}
                x2={toX(0)}
                y2={toY(1)}
                className={styles.inputVector}
                markerEnd={marker('muted')}
                vectorEffect="non-scaling-stroke"
              />
              <text {...placement([1, 0], 6, 20)} className={styles.inputLabel}>
                e1
              </text>
              <text {...placement([0, 1], 10, -8)} className={styles.inputLabel}>
                e2
              </text>

              {!isZeroVector(activeVector) ? (
                <line
                  x1={cx}
                  y1={cy}
                  x2={toX(activeVector[0])}
                  y2={toY(activeVector[1])}
                  className={styles.inputVector}
                  markerEnd={marker('muted')}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <text {...placement(activeVector, 8, -10)} className={styles.inputLabel}>
                x = {formatVec(activeVector)}
              </text>
            </g>
          ) : null}

          {/* 像：平行四边形、椭圆（仅 rank=2）、列向量去向、Ax（珊瑚橙实线） */}
          {showTransformed ? (
            <g>
              <polygon points={polygonOf(imageSquarePoints)} className={styles.imageSquare} />
              {rank === 2 ? (
                <polygon points={polygonOf(imageCirclePoints)} className={styles.imageEllipse} />
              ) : null}

              {columns.map((column, index) =>
                isZeroVector(column) ? (
                  <circle
                    key={`column-${index}`}
                    cx={toX(column[0])}
                    cy={toY(column[1])}
                    r={4}
                    className={styles.zeroDot}
                  />
                ) : (
                  <line
                    key={`column-${index}`}
                    x1={cx}
                    y1={cy}
                    x2={toX(column[0])}
                    y2={toY(column[1])}
                    className={styles.columnVector}
                    markerEnd={marker('indigo')}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {columns.map((column, index) => (
                <text
                  key={`column-label-${index}`}
                  {...placement(column, 8, -8)}
                  className={styles.vectorLabel}
                >
                  A·e{index + 1} = {formatVec(column)}
                </text>
              ))}

              {isZeroVector(activeAx) ? (
                <circle
                  cx={toX(activeAx[0])}
                  cy={toY(activeAx[1])}
                  r={5}
                  className={styles.zeroDotAccent}
                />
              ) : (
                <line
                  x1={cx}
                  y1={cy}
                  x2={toX(activeAx[0])}
                  y2={toY(activeAx[1])}
                  className={styles.imageVector}
                  markerEnd={marker('coral')}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <text {...placement(activeAx, 10, 20)} className={styles.imageLabel}>
                Ax = {formatVec(activeAx)}
              </text>
            </g>
          ) : null}

          {/* 叠加模式：x → Ax 的对应关系 */}
          {display === 'overlay' && !isZeroVector([activeAx[0] - activeVector[0], activeAx[1] - activeVector[1]]) ? (
            <line
              x1={toX(activeVector[0])}
              y1={toY(activeVector[1])}
              x2={toX(activeAx[0])}
              y2={toY(activeAx[1])}
              className={styles.mappingLine}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {display === 'overlay' && !isZeroVector(activeAx) && !isZeroVector(activeVector) ? (
            <text
              x={(toX(activeVector[0]) + toX(activeAx[0])) / 2}
              y={(toY(activeVector[1]) + toY(activeAx[1])) / 2 - 6}
              textAnchor="middle"
              className={styles.mappingLabel}
            >
              x ↦ Ax
            </text>
          ) : null}

          {/* rank<2 的退化说明 */}
          {rank < 2 ? (
            <text x={cx} y={30} textAnchor="middle" className={styles.canvasNote}>
              {rank === 1
                ? '矩阵把平面压成一条线（rank=1），单位圆的像不再是椭圆'
                : '矩阵把平面压成一个点（rank=0），单位圆的像不再绘制'}
            </text>
          ) : null}

          {/* 椭圆半轴长（数值依据来自 SVD 奇异值） */}
          {rank === 2 && ellipse !== null ? (
            <text
              x={VIEW - 14}
              y={VIEW - 14}
              textAnchor="end"
              className={styles.canvasFootnote}
            >
              单位圆的像：半轴 {formatValue(ellipse.a)} × {formatValue(ellipse.b)}
            </text>
          ) : null}

          {/* 可拖动端点（键盘可达） */}
          <g
            className={dragging ? `${styles.handle} ${styles.handleDragging}` : styles.handle}
            tabIndex={0}
            role="button"
            aria-label={handleLabel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
          >
            <circle
              className={styles.handleHit}
              cx={toX(activeVector[0])}
              cy={toY(activeVector[1])}
              r={22}
            />
            <circle
              className={styles.handleDot}
              cx={toX(activeVector[0])}
              cy={toY(activeVector[1])}
              r={9}
            />
          </g>
        </svg>
      </div>

      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatchOriginal} aria-hidden="true" />
          原像（单位正方形 / 单位圆 / x）
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchImage} aria-hidden="true" />
          像（平行四边形 / 椭圆 / Ax）
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchColumn} aria-hidden="true" />
          列向量去向（e1、e2）
        </span>
        <span className={styles.legendHint}>
          拖动端点可直接改 x；聚焦端点后方向键 ±0.1，Shift+方向键 ±1.0
        </span>
      </figcaption>
    </figure>
  );
}