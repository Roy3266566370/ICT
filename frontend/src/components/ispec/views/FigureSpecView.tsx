/**
 * FigureSpecView.tsx —— figure 视图：五个内置几何模板
 * （vectors / circle_ellipse / grid_transform / step_diagram / det_area）。
 *
 * 参数来源（按 id 约定，iSpec 不新增字段）：
 *  - `a / b / c / d`（或原文别名 `a11 / a12 / a21 / a22`）→ 2×2 矩阵 A；
 *  - `x1 / y1 … x8 / y8`（或旧约定 `x / y`、`x2 / y2`，或扁平化的 `v1x / v1y`）→ 向量列表；
 *  - 向量缺失时按「e₁ + 两个实特征方向」生成探针向量（完全由矩阵参数推导，不硬编码矩阵值）；
 *  - `det_area` 读 `cells_{i}_matrix_{r}_{c}` 四格；`step_diagram` 读
 *    `steps_rotate_angle_deg / steps_stretch_factor_*`，缺失则回退 SVD 三步。
 *
 * 教学图层（对齐归档前的专用组件）：
 *  - 坐标轴 + 整数刻度数字（< 28px 时隔一个画）+ 刻度短线 + 原点实心点；
 *  - 单位圆虚线、变换后椭圆橙色实线（fill-opacity .055）；
 *  - 原像浅色虚线（端点圆点 + 坐标）与像向量实线（箭头 + 坐标）双层；
 *  - `A·v ≈ v` 时只画一条像向量，标注合并为 `(1,-1) 不动 ×1`；
 *  - 特征倍数 `×λ` 放在像向量 60% 外侧并带 `#F6F3EC` 背景描边；
 *  - 所有 `<text>` 统一走 `layoutLabels`（SSR 安全：只用字宽估算，不用 getBBox），
 *    包围盒互斥、不出 viewBox，冲突时先牺牲刻度数字。
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { FigureView, ISpec, SpecEvaluation } from '../../../ispec/types';
import {
  arrowHeadPath,
  boundsFromPoints,
  clipSegmentToRect,
  createProjector,
  layoutLabels,
  svgPath,
  unitDirection,
  type LabelRequest,
  type LabelTone,
  type MathBounds,
  type PlacedLabel,
  type PlotArea,
  type RectArea,
  type TextAnchor,
  type Vec2,
} from '../../../ispec/chart';
import {
  applyMatrix,
  columnLengths,
  defaultProbeVectors,
  determinant,
  eigenScale,
  ellipsePoints,
  IDENTITY_MATRIX,
  inverseMatrix,
  isFixedVector,
  lerpMatrix,
  matrixFromScope,
  missingMatrixFields,
  readNumber,
  readVectorList,
  realEigenpairs,
  type Matrix2,
} from '../../../ispec/geometry';
import { formatNumberSmart, type SpecCell } from '../../../ispec/format';
import styles from './FigureSpecView.module.css';

const CANVAS_W = 640;
const CANVAS_H = 360;
const PLOT: PlotArea = { x: 34, y: 30, w: CANVAS_W - 68, h: CANVAS_H - 62 };
const FULL_AREA: RectArea = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

/** 与归档前专用组件一致的色板。 */
const GHOST = '#A3AFC2';
const GHOST_DOT = '#8B97AB';
const ORANGE = '#C4622D';
const NAVY = '#16233A';
const BACKGROUND = '#F6F3EC';

/** 像向量的配色：第一条藏青、其余橙色（与原 S6 一致）。 */
const IMAGE_COLORS: readonly string[] = [NAVY, ORANGE, ORANGE];

const TEMPLATE_TITLES: Readonly<Record<FigureView['spec_ref'], string>> = {
  vectors: '向量',
  circle_ellipse: '圆与椭圆',
  grid_transform: '网格与变换',
  step_diagram: '步骤图',
  det_area: '两列围成的有向面积',
  eigen_probe: '特征向量探针',
  basis_change: '换基与坐标',
  singular_compare: '奇异值与条件数对比',
  rank_map: '维度与秩',
  inverse_map: '逆映射与零空间',
};

const HANDLE_HINTS: Partial<Record<FigureView['spec_ref'], string>> = {
  vectors: '拖动端点改变向量',
  circle_ellipse: '拖动圆点直接改矩阵列',
  grid_transform: '拖动圆点直接改矩阵列',
  eigen_probe: '拖动端点改变探针向量',
  basis_change: '拖动 P 或 b₂ 看坐标变化',
  inverse_map: '拖动目标点 b',
};

const TONE_CLASS: Readonly<Record<LabelTone, string | undefined>> = {
  primary: styles.vectorLabel,
  ghost: styles.labelGhost,
  image: styles.labelImage,
  scale: styles.labelScale,
  merged: styles.labelMerged,
  meta: styles.labelMeta,
  tick: styles.tickText,
  panel: styles.labelPanel,
};

export interface FigureSpecViewProps {
  view: FigureView;
  spec: ISpec;
  evaluation: SpecEvaluation;
  stage: 0 | 1 | 2;
  reducedMotion: boolean;
  /** 0–1 的连续变换进度；缺省时按 stage 取 0 / 0.6 / 1。 */
  progress?: number;
  /** `kind="geometric"` 时为 true：显示拖动手柄并回写参数。 */
  draggable?: boolean;
  /** 手柄回写：参数 id + 新数值（由 ISpecView 统一校验后写入）。 */
  onParamChange?: (id: string, value: number) => void;
  /** 先让学生尝试，再显示特征方向提示。 */
  hideEigenHints?: boolean;
}

/** 一个拖动手柄：定位在数学坐标上，拖动后改写一组参数。 */
interface DragHandleSpec {
  key: string;
  /** 当前数学坐标（也用于键盘微调）。 */
  value: [number, number];
  /** 需要同步写入的两个参数 id（x / y 或矩阵的一列）。 */
  ids: [string, string];
  label: string;
}

/**
 * `createProjector` 的逆变换：把 SVG 坐标（viewBox 单位）还原成数学坐标。
 * 与 `createProjector` 使用同一套 scale / offset 推导，避免两套真相。
 */
function createUnprojector(
  area: PlotArea,
  bounds: MathBounds,
): (x: number, y: number) => Vec2 {
  const width = Math.max(1e-9, bounds.xMax - bounds.xMin);
  const height = Math.max(1e-9, bounds.yMax - bounds.yMin);
  const scale = Math.min(area.w / width, area.h / height);
  const offsetX = area.x + (area.w - width * scale) / 2 - bounds.xMin * scale;
  const offsetY = area.y + (area.h - height * scale) / 2 + bounds.yMax * scale;
  return (x: number, y: number): Vec2 => [(x - offsetX) / scale, (offsetY - y) / scale];
}

function clampToBounds(value: Vec2, bounds: MathBounds): Vec2 {
  return [
    Math.min(bounds.xMax, Math.max(bounds.xMin, value[0])),
    Math.min(bounds.yMax, Math.max(bounds.yMin, value[1])),
  ];
}

function roundToStep(value: number, step = 0.05): number {
  return Number((Math.round(value / step) * step).toFixed(4));
}

/* -------------------------------------------------------------------------- */
/* 标注：轻量构造器 + 统一渲染层                                                */
/* -------------------------------------------------------------------------- */

function formatNumber(value: number): string {
  // 特征向量坐标常有 6.1e-17 这类浮点尾差，先吸附到 0 再按 3 位有效小数输出。
  const snapped = Math.abs(value) < 1e-9 ? 0 : value;
  return formatNumberSmart(snapped, 3);
}

/** 坐标文本不带空格，便于在 SVG 里保持紧凑并与原文断言一致：`(1,-1)`。 */
function formatVector(vector: Vec2): string {
  return `(${formatNumber(vector[0])},${formatNumber(vector[1])})`;
}

interface LabelOptions {
  fontSize?: number;
  anchor?: TextAnchor;
  tone?: LabelTone;
  priority?: number;
  background?: boolean;
  alternatives?: readonly { x: number; y: number; anchor?: TextAnchor }[];
}

function makeLabel(
  id: string,
  text: string,
  x: number,
  y: number,
  options: LabelOptions = {},
): LabelRequest {
  return {
    id,
    text,
    x,
    y,
    fontSize: options.fontSize ?? 11,
    anchor: options.anchor,
    tone: options.tone ?? 'primary',
    priority: options.priority ?? 3,
    background: options.background,
    alternatives: options.alternatives,
  };
}

/** 依据方向选择 text-anchor，让文字贴在线段外侧而不是压住线。 */
function anchorFor(dx: number): TextAnchor {
  if (dx > 0.35) return 'start';
  if (dx < -0.35) return 'end';
  return 'middle';
}

/**
 * 端点标注：`inward` 贴端点内侧（原像），`outward` 贴箭头外侧（像）。
 * 与端点保持距离，并提供「再远一点 / 换到另一侧」两个候选位置。
 */
function endpointLabel(
  id: string,
  text: string,
  end: Vec2,
  origin: Vec2,
  mode: 'inward' | 'outward',
  distance: number,
  options: LabelOptions = {},
): LabelRequest {
  const direction = unitDirection(origin, end) ?? [1, 0];
  const sign = mode === 'outward' ? 1 : -1;
  const normal: Vec2 = [-direction[1], direction[0]];
  const normalShift = mode === 'inward' ? 9 : 4;
  const anchor = anchorFor(direction[0] * sign);
  const x = end[0] + direction[0] * sign * distance + normal[0] * normalShift;
  const y = end[1] + direction[1] * sign * distance + normal[1] * normalShift + 6;
  const far = distance + 18;
  return makeLabel(id, text, x, y, {
    ...options,
    anchor,
    alternatives: [
      {
        x: end[0] + direction[0] * sign * far + normal[0] * normalShift,
        y: end[1] + direction[1] * sign * far + normal[1] * normalShift + 6,
        anchor,
      },
      {
        x,
        y: y + (direction[1] * sign >= 0 ? 16 : -16),
        anchor,
      },
    ],
  });
}

/** 特征倍数标注：像向量 60% 处的外侧，带背景描边（避免压线）。 */
function scaleLabelRequest(id: string, scale: number, origin: Vec2, end: Vec2): LabelRequest {
  const direction = unitDirection(origin, end) ?? [1, 0];
  let normalX = -direction[1];
  let normalY = direction[0];
  // 取屏幕上方一侧，避免压到 x 轴的刻度数字。
  if (normalY > 0) {
    normalX = -normalX;
    normalY = -normalY;
  }
  const anchorPoint: Vec2 = [
    origin[0] + (end[0] - origin[0]) * 0.6,
    origin[1] + (end[1] - origin[1]) * 0.6,
  ];
  return makeLabel(
    id,
    `×${formatNumber(scale)}`,
    anchorPoint[0] + normalX * 22,
    anchorPoint[1] + normalY * 22 + 5,
    {
      tone: 'scale',
      fontSize: 12,
      anchor: anchorFor(normalX),
      priority: 1,
      background: true,
      alternatives: [
        {
          x: anchorPoint[0] - normalX * 22,
          y: anchorPoint[1] - normalY * 22 + 5,
          anchor: anchorFor(-normalX),
        },
      ],
    },
  );
}

/** 合并标注：`(1,-1) 不动 ×1`，是「原像 + 像 + 倍数」的唯一载体。 */
function mergedLabelRequest(id: string, vector: Vec2, scale: number, origin: Vec2, end: Vec2): LabelRequest {
  const direction = unitDirection(origin, end) ?? [1, 0];
  const baseX = end[0] + direction[0] * 32;
  const baseY = end[1] + direction[1] * 32 + 6;
  return makeLabel(
    id,
    `${formatVector(vector)} 不动 ×${formatNumber(scale)}`,
    baseX,
    baseY,
    {
      tone: 'merged',
      fontSize: 12,
      anchor: anchorFor(direction[0]),
      priority: 1,
      background: true,
      alternatives: [
        { x: baseX, y: baseY + 18, anchor: anchorFor(direction[0]) },
        {
          x: end[0] - direction[0] * 32,
          y: end[1] - direction[1] * 32 + 6,
          anchor: anchorFor(-direction[0]),
        },
      ],
    },
  );
}

/** 统一文字层：位置已由 `layoutLabels` 规划好，这里只负责样式。 */
function LabelLayer(props: { labels: readonly PlacedLabel[] }): ReactElement {
  const { labels } = props;
  return (
    <g data-layer="labels">
      {labels.map((label) => (
        <text
          key={label.id}
          className={TONE_CLASS[label.tone]}
          data-label-tone={label.tone}
          x={label.x}
          y={label.y}
          textAnchor={label.anchor}
          fontSize={label.fontSize}
          {...(label.background
            ? {
                stroke: BACKGROUND,
                strokeWidth: 5,
                strokeLinejoin: 'round' as const,
                paintOrder: 'stroke' as const,
              }
            : {})}
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 公共图元                                                                    */
/* -------------------------------------------------------------------------- */

interface FigureFrameProps {
  title: string;
  specRef: FigureView['spec_ref'];
  ariaLabel: string;
  notes: string[];
  reducedMotion: boolean;
  children: ReactNode;
  /** 覆盖层（拖动手柄）：与图形共用同一个 viewBox。 */
  overlay?: ReactNode;
  /** 标题右侧的操作提示（例如可拖动端点）。 */
  hint?: string;
}

function FigureFrame(props: FigureFrameProps): ReactElement {
  const { title, specRef, ariaLabel, notes, reducedMotion, children, overlay, hint } = props;
  return (
    <figure
      className={styles.root}
      data-figure-view
      data-spec-ref={specRef}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <figcaption className={styles.title}>
        <span>{title}</span>
        {hint === undefined ? null : <span className={styles.dragHint}>{hint}</span>}
      </figcaption>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
      >
        <rect className={styles.background} x={0} y={0} width={CANVAS_W} height={CANVAS_H} />
        {children}
        {overlay}
      </svg>
      {notes.length === 0 ? null : (
        <ul className={styles.notes}>
          {notes.map((note, index) => (
            <li key={`note-${index}`} data-figure-note>
              {note}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

type Projector = (x: number, y: number) => Vec2;

interface AxisOptions {
  idPrefix?: string;
  tickFontSize?: number;
  tickPriority?: number;
  showTickLabels?: boolean;
}

interface AxisParts {
  layer: ReactElement;
  labels: LabelRequest[];
}

/**
 * 坐标轴：轴线 + 箭头 + 整数刻度短线 + 刻度数字请求。
 * 刻度数字间距 < 28px 时只画偶数，避免 595px 容器内挤成一团。
 * 刻度数字以 `priority: 5` 参与统一布局，冲突时最先被隐藏。
 */
function buildAxis(projector: Projector, bounds: MathBounds, options: AxisOptions = {}): AxisParts {
  const prefix = options.idPrefix ?? 'axis';
  const tickFontSize = options.tickFontSize ?? 10;
  const tickPriority = options.tickPriority ?? 5;
  const xStart = projector(bounds.xMin, 0);
  const xEnd = projector(bounds.xMax, 0);
  const yStart = projector(0, bounds.yMin);
  const yEnd = projector(0, bounds.yMax);

  const unit = Math.abs(projector(1, 0)[0] - projector(0, 0)[0]);
  const skipAlternate = unit > 0 && unit < 28;

  const marks: ReactElement[] = [];
  const labels: LabelRequest[] = [];
  const xFrom = Math.ceil(bounds.xMin);
  const xTo = Math.floor(bounds.xMax);
  const yFrom = Math.ceil(bounds.yMin);
  const yTo = Math.floor(bounds.yMax);

  for (let tick = xFrom; tick <= xTo; tick += 1) {
    const point = projector(tick, 0);
    marks.push(
      <line
        key={`${prefix}-xm-${tick}`}
        className={styles.axisTick}
        x1={point[0]}
        y1={point[1] - 4}
        x2={point[0]}
        y2={point[1] + 4}
      />,
    );
    if (tick === 0 || options.showTickLabels === false) continue;
    if (skipAlternate && Math.abs(tick) % 2 === 1) continue;
    labels.push(
      makeLabel(`${prefix}-xt-${tick}`, String(tick), point[0], point[1] + 13, {
        fontSize: tickFontSize,
        tone: 'tick',
        priority: tickPriority,
        anchor: 'middle',
      }),
    );
  }

  for (let tick = yFrom; tick <= yTo; tick += 1) {
    const point = projector(0, tick);
    marks.push(
      <line
        key={`${prefix}-ym-${tick}`}
        className={styles.axisTick}
        x1={point[0] - 4}
        y1={point[1]}
        x2={point[0] + 4}
        y2={point[1]}
      />,
    );
    if (tick === 0 || options.showTickLabels === false) continue;
    if (skipAlternate && Math.abs(tick) % 2 === 1) continue;
    labels.push(
      makeLabel(`${prefix}-yt-${tick}`, String(tick), point[0] - 7, point[1] + 4, {
        fontSize: tickFontSize,
        tone: 'tick',
        priority: tickPriority,
        anchor: 'end',
      }),
    );
  }

  return {
    layer: (
      <g key={prefix} data-layer="axis">
        <line className={styles.axis} x1={xStart[0]} y1={xStart[1]} x2={xEnd[0]} y2={xEnd[1]} />
        <path className={styles.axisArrow} d={arrowHeadPath(xStart, xEnd, 8)} />
        <line className={styles.axis} x1={yStart[0]} y1={yStart[1]} x2={yEnd[0]} y2={yEnd[1]} />
        <path className={styles.axisArrow} d={arrowHeadPath(yStart, yEnd, 8)} />
        {marks}
      </g>
    ),
    labels,
  };
}

interface ArrowProps {
  from: Vec2;
  to: Vec2;
  color: string;
  dashed?: boolean;
  headSize?: number;
  /** 语义角色，便于自检统计。 */
  role?: string;
}

/** 向量：线段 + 实心箭头（颜色由调用方决定，线宽走 non-scaling-stroke）。 */
function Arrow(props: ArrowProps): ReactElement {
  const { from, to, color, dashed = false, headSize = 9, role = 'vector' } = props;
  return (
    <g data-role={role}>
      <line
        className={dashed ? styles.vectorDashed : styles.vectorLine}
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={color}
      />
      <path className={styles.arrowHeadShape} fill={color} d={arrowHeadPath(from, to, headSize)} />
    </g>
  );
}

function matrixFromNote(scope: Record<string, SpecCell>): { matrix: Matrix2; notes: string[] } {
  const missing = missingMatrixFields(scope);
  return {
    matrix: matrixFromScope(scope),
    notes:
      missing.length === 0
        ? []
        : [`参数 ${missing.join(' / ')} 缺失，按单位矩阵对应分量（1/0）兜底绘制。`],
  };
}

interface RenderedFigure {
  body: ReactElement;
  notes: string[];
  /** 本图实际使用的数学视域（拖动手柄的逆变换必须与之一致）。 */
  bounds: MathBounds;
}

const STAGE_PROGRESS: Readonly<Record<0 | 1 | 2, number>> = { 0: 0, 1: 0.6, 2: 1 };

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/* -------------------------------------------------------------------------- */
/* 模板：vectors                                                               */
/* -------------------------------------------------------------------------- */

function renderVectors(scope: Record<string, SpecCell>): RenderedFigure {
  const matrix = matrixFromScope(scope);
  const explicit = readVectorList(scope);
  const notes: string[] = [];
  let vectors: Vec2[];
  if (explicit.length > 0) {
    vectors = explicit.slice(0, 8);
  } else {
    vectors = defaultProbeVectors(matrix);
    notes.push('未提供向量参数，按 e₁ + 两个特征方向生成探针向量（参数缺失时的明确兜底）。');
  }

  const bounds = boundsFromPoints(vectors, { padding: 0.8, minSpan: 4 });
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const axis = buildAxis(projector, bounds);
  const labels: LabelRequest[] = [...axis.labels];
  const elements: ReactElement[] = [axis.layer];

  // 可选基准网格：整数线，透明到底色之上、向量之下。
  const gridFromX = Math.ceil(bounds.xMin);
  const gridToX = Math.floor(bounds.xMax);
  if (gridToX - gridFromX <= 12) {
    for (let tick = gridFromX; tick <= gridToX; tick += 1) {
      if (tick === 0) continue;
      const top = projector(tick, bounds.yMax);
      const bottom = projector(tick, bounds.yMin);
      elements.push(
        <line
          key={`grid-v-${tick}`}
          className={styles.sourceGrid}
          x1={top[0]}
          y1={top[1]}
          x2={bottom[0]}
          y2={bottom[1]}
        />,
      );
    }
  }
  const gridFromY = Math.ceil(bounds.yMin);
  const gridToY = Math.floor(bounds.yMax);
  if (gridToY - gridFromY <= 12) {
    for (let tick = gridFromY; tick <= gridToY; tick += 1) {
      if (tick === 0) continue;
      const left = projector(bounds.xMin, tick);
      const right = projector(bounds.xMax, tick);
      elements.push(
        <line
          key={`grid-h-${tick}`}
          className={styles.sourceGrid}
          x1={left[0]}
          y1={left[1]}
          x2={right[0]}
          y2={right[1]}
        />,
      );
    }
  }

  vectors.forEach((vector, index) => {
    const end = projector(vector[0], vector[1]);
    const clipped = clipSegmentToRect(origin, end, PLOT, 6).point;
    const color = index % 2 === 0 ? NAVY : ORANGE;
    elements.push(
      <Arrow
        key={`vector-${index}`}
        from={origin}
        to={clipped}
        color={color}
        role="vector"
      />,
    );
    labels.push(
      endpointLabel(
        `vector-label-${index}`,
        formatVector(vector),
        clipped,
        origin,
        'outward',
        24,
        {
          tone: index % 2 === 0 ? 'primary' : 'image',
          fontSize: 11,
          priority: 2,
        },
      ),
    );
  });

  elements.push(<circle key="vectors-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.4} />);

  return {
    body: (
      <g data-figure-template="vectors" data-vector-count={vectors.length}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/** 多图模板共用的整数网格；限制线数，避免视域过大时糊成一片。 */
function addCartesianGrid(
  elements: ReactElement[],
  projector: Projector,
  bounds: MathBounds,
  maxLines = 12,
): void {
  const fromX = Math.max(-maxLines, Math.ceil(bounds.xMin));
  const toX = Math.min(maxLines, Math.floor(bounds.xMax));
  const fromY = Math.max(-maxLines, Math.ceil(bounds.yMin));
  const toY = Math.min(maxLines, Math.floor(bounds.yMax));
  for (let tick = fromX; tick <= toX; tick += 1) {
    if (tick === 0) continue;
    const top = projector(tick, bounds.yMax);
    const bottom = projector(tick, bounds.yMin);
    elements.push(
      <line key={`grid-v-${tick}`} className={styles.sourceGrid} x1={top[0]} y1={top[1]} x2={bottom[0]} y2={bottom[1]} />,
    );
  }
  for (let tick = fromY; tick <= toY; tick += 1) {
    if (tick === 0) continue;
    const left = projector(bounds.xMin, tick);
    const right = projector(bounds.xMax, tick);
    elements.push(
      <line key={`grid-h-${tick}`} className={styles.sourceGrid} x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} />,
    );
  }
}

function orientedSegment(
  point: Vec2,
  direction: Vec2,
  projector: Projector,
  area: RectArea,
): [Vec2, Vec2] | null {
  const length = Math.hypot(direction[0], direction[1]);
  if (length < 1e-9) return null;
  const unit: Vec2 = [direction[0] / length, direction[1] / length];
  const center = projector(point[0], point[1]);
  const far: Vec2 = [center[0] + unit[0] * 1000, center[1] - unit[1] * 1000];
  const near: Vec2 = [center[0] - unit[0] * 1000, center[1] + unit[1] * 1000];
  const forward = clipSegmentToRect(center, far, area, 0);
  const backward = clipSegmentToRect(center, near, area, 0);
  return [backward.point, forward.point];
}

/* -------------------------------------------------------------------------- */
/* 模板：eigen_probe                                                           */
/* -------------------------------------------------------------------------- */

function renderEigenProbe(scope: Record<string, SpecCell>, hideEigenHints = false): RenderedFigure {
  const { matrix, notes } = matrixFromNote(scope);
  const probe = parameterPair(scope, ['vx', 'vy']);
  const vector: Vec2 =
    probe ?? [readNumber(scope, 'x1') ?? 1, readNumber(scope, 'y1') ?? 1];
  const image = applyMatrix(matrix, vector);
  const length = Math.hypot(vector[0], vector[1]);
  const imageLength = Math.hypot(image[0], image[1]);
  const cross = image[0] * vector[1] - image[1] * vector[0];
  const collinear =
    length > 1e-9 &&
    (imageLength < 1e-9 || Math.abs(cross) <= 1e-6 * length * Math.max(1, imageLength));
  const lambda = collinear && length > 1e-9
    ? (image[0] * vector[0] + image[1] * vector[1]) / (length * length)
    : null;
  const pairs = realEigenpairs(matrix);

  const eigenSamples = pairs.flatMap((pair) => {
    const [x, y] = pair.direction;
    return [[x * 5, y * 5], [-x * 5, -y * 5]] as Vec2[];
  });
  const bounds = boundsFromPoints(
    [[0, 0], vector, image, ...eigenSamples],
    { padding: 0.75, minSpan: 4.5 },
  );
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const axis = buildAxis(projector, bounds);
  const elements: ReactElement[] = [axis.layer];
  const labels: LabelRequest[] = [...axis.labels];
  addCartesianGrid(elements, projector, bounds);

  // 实特征方向：紫色虚线；复特征值（旋转型）没有可画的实线。
  if (!hideEigenHints) pairs.forEach((pair, index) => {
    const direction = pair.direction;
    const far: Vec2 = [direction[0] * 5, direction[1] * 5];
    const a = projector(-far[0], -far[1]);
    const b = projector(far[0], far[1]);
    elements.push(
      <line key={`eigen-line-${index}`} className={styles.eigenLine} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />,
    );
    labels.push(
      makeLabel(`eigen-label-${index}`, `λ = ${formatNumber(pair.lambda)}`, b[0] + 5, b[1] - 5, {
        tone: 'meta',
        fontSize: 9.5,
        priority: 4,
        anchor: 'start',
      }),
    );
  });

  elements.push(
    <Arrow key="probe-ghost" from={origin} to={projector(vector[0], vector[1])} color={GHOST} dashed headSize={7} role="probe-vector" />,
  );
  const imageEnd = projector(image[0], image[1]);
  const clipped = clipSegmentToRect(origin, imageEnd, PLOT, 6).point;
  elements.push(<Arrow key="probe-image" from={origin} to={clipped} color={ORANGE} role="image-vector" />);
  elements.push(<circle key="probe-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.6} />);

  labels.push(
    endpointLabel('probe-vector-label', `v = ${formatVector(vector)}`, projector(vector[0], vector[1]), origin, 'outward', 24, {
      tone: 'ghost',
      fontSize: 10,
      priority: 3,
    }),
  );
  labels.push(
    endpointLabel('probe-image-label', `A·v = ${formatVector(image)}`, clipped, origin, 'outward', 24, {
      tone: 'image',
      fontSize: 10.5,
      priority: 2,
    }),
  );
  labels.push(
    makeLabel(
      'probe-status',
      lambda === null
        ? '方向改变 · 不是特征向量'
        : `A·v = ${formatNumber(lambda)}·v`,
      PLOT.x + 6,
      PLOT.y + 14,
      {
        tone: lambda === null ? 'meta' : 'scale',
        fontSize: 10.5,
        priority: 1,
        background: true,
        alternatives: [{ x: PLOT.x + 6, y: PLOT.y + 28 }],
      },
    ),
  );

  if (length < 1e-9) {
    notes.push('零向量没有方向；把探针向量拖到非零位置再看它是否留在原方向。');
  }
  if (!hideEigenHints && pairs.length === 0) {
    notes.push('该矩阵没有实特征方向（旋转型）：任何非零向量都会被转离原方向。');
  }
  if (lambda === 0) {
    notes.push('v 被压到原点，λ = 0——压成零也算特征值。');
  }
  if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) {
    notes.push('恒等矩阵：每个方向都是特征方向，λ = 1。');
  }

  return {
    body: (
      <g data-figure-template="eigen_probe" data-collinear={collinear ? 'true' : 'false'}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：basis_change                                                          */
/* -------------------------------------------------------------------------- */

function renderBasisChange(scope: Record<string, SpecCell>): RenderedFigure {
  const point: Vec2 = [
    readNumber(scope, 'point_x') ?? 2,
    readNumber(scope, 'point_y') ?? 1,
  ];
  const second: Vec2 = [
    readNumber(scope, 'b2x') ?? 0.8,
    readNumber(scope, 'b2y') ?? 0.8,
  ];
  const notes: string[] = [];
  const det = second[1];
  const coordinates: Vec2 | null =
    Math.abs(det) > 1e-9
      ? [(point[0] * second[1] - second[0] * point[1]) / det, point[1] / det]
      : null;
  const first: Vec2 = [1, 0];

  const bounds = boundsFromPoints(
    [[0, 0], point, second, first, ...(coordinates ? [coordinates] : [])],
    { padding: 0.75, minSpan: 3.4 },
  );
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const axis = buildAxis(projector, bounds);
  const elements: ReactElement[] = [axis.layer];
  const labels: LabelRequest[] = [...axis.labels];
  addCartesianGrid(elements, projector, bounds);

  const drawVector = (key: string, vector: Vec2, color: string, dashed = false, role = 'basis-vector') => {
    const end = projector(vector[0], vector[1]);
    const clipped = clipSegmentToRect(origin, end, PLOT, 6).point;
    elements.push(<Arrow key={key} from={origin} to={clipped} color={color} dashed={dashed} headSize={7} role={role} />);
    return clipped;
  };

  // 标准基（浅色）与斜基（橙色）；b1 与 e1 重合，只画一次。
  drawVector('basis-e2', [0, 1], GHOST, true, 'standard-basis');
  const b1End = drawVector('basis-b1', first, NAVY);
  const b2End = drawVector('basis-b2', second, ORANGE);
  elements.push(<circle key="basis-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.4} />);

  if (coordinates !== null) {
    const c1 = coordinates[0];
    const c2 = coordinates[1];
    const firstStep: Vec2 = [c1 * first[0], c1 * first[1]];
    const secondStep: Vec2 = [c2 * second[0], c2 * second[1]];
    const firstPoint = projector(firstStep[0], firstStep[1]);
    const secondPoint = projector(secondStep[0], secondStep[1]);
    const target = projector(point[0], point[1]);
    elements.push(
      <line key="basis-guide-1" className={styles.basisGuide} x1={origin[0]} y1={origin[1]} x2={firstPoint[0]} y2={firstPoint[1]} />,
      <line key="basis-guide-2" className={styles.basisGuide} x1={firstPoint[0]} y1={firstPoint[1]} x2={target[0]} y2={target[1]} />,
      <line key="basis-guide-3" className={styles.basisGuide} x1={origin[0]} y1={origin[1]} x2={secondPoint[0]} y2={secondPoint[1]} />,
      <line key="basis-guide-4" className={styles.basisGuide} x1={secondPoint[0]} y1={secondPoint[1]} x2={target[0]} y2={target[1]} />,
    );
  }

  const target = projector(point[0], point[1]);
  elements.push(<circle key="basis-point" className={styles.markerDot} cx={target[0]} cy={target[1]} r={4.2} fill={NAVY} />);
  labels.push(
    endpointLabel('basis-b1-label', 'b₁', b1End, origin, 'outward', 20, {
      tone: 'primary', fontSize: 12, priority: 3,
    }),
  );
  labels.push(
    endpointLabel('basis-b2-label', 'b₂', b2End, origin, 'outward', 20, {
      tone: 'image', fontSize: 12, priority: 3,
    }),
  );
  labels.push(
    makeLabel(
      'basis-coordinates',
      coordinates === null ? 'b₁ 与 b₂ 共线：坐标不唯一' : `A 坐标 = ${formatVector(point)}　B 坐标 = ${formatVector(coordinates)}`,
      PLOT.x + 6,
      PLOT.y + 14,
      {
        tone: coordinates === null ? 'meta' : 'scale',
        fontSize: 12,
        priority: 1,
        background: true,
        alternatives: [{ x: PLOT.x + 6, y: PLOT.y + 30 }],
      },
    ),
  );
  if (coordinates === null) {
    notes.push('斜基与水平方向共线，平面上任何点都无法用两个独立方向唯一表示。');
  } else {
    notes.push('第一组坐标按正交基读取；斜基由原页第二组坐标反推，b₁ 取水平方向。拖动 P 或 b₂ 观察倍数变化。');
  }

  return {
    body: (
      <g data-figure-template="basis_change" data-degenerate={coordinates === null ? 'true' : 'false'}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：singular_compare                                                      */
/* -------------------------------------------------------------------------- */

interface SingularPanel {
  label: string;
  s1: number;
  s2: number;
}

function renderSingularCompare(scope: Record<string, SpecCell>): RenderedFigure {
  const panels: SingularPanel[] = [
    {
      label: 'A',
      s1: Math.abs(readNumber(scope, 's1a') ?? 1.618),
      s2: Math.abs(readNumber(scope, 's2a') ?? 0.618),
    },
    {
      label: 'B',
      s1: Math.abs(readNumber(scope, 's1b') ?? 100),
      s2: Math.abs(readNumber(scope, 's2b') ?? 0.01),
    },
  ];
  const notes: string[] = ['两格各自缩放显示，便于观察形状；σ 与 κ 的数值可直接比较。'];
  const gap = 18;
  const panelW = (PLOT.w - gap) / 2;
  const panelH = PLOT.h - 36;
  const panelTop = PLOT.y + 26;
  const elements: ReactElement[] = [];
  const labels: LabelRequest[] = [];

  panels.forEach((panel, index) => {
    const major = Math.max(panel.s1, panel.s2);
    const minor = Math.min(panel.s1, panel.s2);
    const area: RectArea = { x: PLOT.x + index * (panelW + gap), y: panelTop, w: panelW, h: panelH };
    const maxSpan = Math.max(0.35, major) * 1.2;
    const bounds: MathBounds = { xMin: -maxSpan, xMax: maxSpan, yMin: -maxSpan, yMax: maxSpan };
    const projector = createProjector({ x: area.x + 6, y: area.y + 20, w: area.w - 12, h: area.h - 26 }, bounds);
    const origin = projector(0, 0);
    const axis = buildAxis(projector, bounds, { showTickLabels: false, idPrefix: `sing-${index}` });
    elements.push(
      <rect key={`sing-bg-${index}`} className={styles.panelBackground} x={area.x} y={area.y} width={area.w} height={area.h} rx={6} />,
      <g key={`sing-axis-${index}`}>{axis.layer}</g>,
    );
    labels.push(
      makeLabel(`sing-title-${index}`, panel.label, area.x + 8, area.y + 16, {
        tone: 'panel', fontSize: 12.5, priority: 1,
      }),
    );
    const radius = Math.hypot(projector(1, 0)[0] - origin[0], projector(1, 0)[1] - origin[1]);
    elements.push(
      <circle key={`sing-unit-${index}`} className={styles.unitCircle} cx={origin[0]} cy={origin[1]} r={radius} />,
    );
    const shape = ellipsePoints({ a: major, b: 0, c: 0, d: minor }, 96).map((point) => projector(point[0], point[1]));
    elements.push(
      <path key={`sing-shape-${index}`} className={styles.imageCurve} d={svgPath(shape, true)} fillOpacity={0.08} />,
    );
    const kappa = minor <= 1e-9 ? null : major / minor;
    labels.push(
      makeLabel(
        `sing-values-${index}`,
        `σ = (${formatNumber(major)}, ${formatNumber(minor)})`,
        area.x + 8,
        area.y + area.h - 26,
        { tone: 'meta', fontSize: 11.5, priority: 2, anchor: 'start' },
      ),
    );
    labels.push(
      makeLabel(
        `sing-kappa-${index}`,
        `κ = ${kappa === null ? '∞' : formatNumber(kappa)} · |det| = ${formatNumber(major * minor)}`,
        area.x + 8,
        area.y + area.h - 12,
        { tone: 'scale', fontSize: 12, priority: 2, anchor: 'start' },
      ),
    );
    if (minor <= 1e-9) {
      notes.push(`${panel.label} 的短轴为 0：秩降为 1，逆不存在。`);
    } else if (Math.abs(major - minor) <= 1e-9) {
      notes.push(`${panel.label} 两个奇异值相等：圆还是圆，条件数为 1。`);
    }
  });

  return {
    body: (
      <g data-figure-template="singular_compare">
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：rank_map                                                              */
/* -------------------------------------------------------------------------- */

function renderRankMap(scope: Record<string, SpecCell>): RenderedFigure {
  const rows = Math.min(3, Math.max(1, Math.round(readNumber(scope, 'rows') ?? 3)));
  const cols = Math.min(3, Math.max(1, Math.round(readNumber(scope, 'cols') ?? 2)));
  const requestedRank = Math.round(readNumber(scope, 'rank') ?? Math.min(rows, cols));
  const rank = Math.min(Math.min(rows, cols), Math.max(0, requestedRank));
  const notes: string[] = [];
  if (requestedRank > Math.min(rows, cols)) {
    notes.push(`秩不能超过 min(行数 ${rows}, 列数 ${cols})，画面按 ${rank} 显示。`);
  }
  const cellW = 64;
  const cellH = 44;
  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const left = (CANVAS_W - gridW) / 2;
  const top = PLOT.y + 56;
  const elements: ReactElement[] = [
    <rect key="rank-bg" className={styles.panelBackground} x={PLOT.x} y={PLOT.y} width={PLOT.w} height={PLOT.h} rx={8} />,
  ];
  const labels: LabelRequest[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const active = row === col && row < rank;
      elements.push(
        <rect
          key={`rank-cell-${row}-${col}`}
          x={left + col * cellW + 6}
          y={top + row * cellH + 6}
          width={cellW - 12}
          height={cellH - 12}
          rx={5}
          className={active ? styles.rankCellActive : styles.rankCell}
        />,
      );
      if (active) {
        labels.push(
          makeLabel(`rank-cell-label-${row}`, '●', left + col * cellW + cellW / 2, top + row * cellH + cellH / 2 + 4, {
            tone: 'image', fontSize: 12, priority: 4, anchor: 'middle',
          }),
        );
      }
    }
  }

  labels.push(
    makeLabel('rank-cols', `列数 n = ${cols}（输入维度）`, left + gridW, top - 12, {
      tone: 'meta', fontSize: 11, priority: 1, anchor: 'end',
    }),
  );
  labels.push(
    makeLabel('rank-rows', `行数 m = ${rows}（输出维度）`, left - 8, top + 14, {
      tone: 'meta', fontSize: 11, priority: 2, anchor: 'end',
    }),
  );
  labels.push(
    makeLabel(
      'rank-summary',
      rank === 0
        ? '秩 = 0：所有输入都映成零'
        : `秩 = ${rank} · 实际张成 ${rank} 维${rank === Math.min(rows, cols) ? '（满秩）' : '（有维度损失）'}`,
      PLOT.x + PLOT.w / 2,
      top + gridH + 40,
      { tone: rank === Math.min(rows, cols) ? 'image' : 'scale', fontSize: 12.5, priority: 1, anchor: 'middle' },
    ),
  );
  labels.push(
    makeLabel(
      'rank-bound',
      '秩 ≤ min(行数, 列数)；正奇异值个数 = 秩',
      PLOT.x + PLOT.w / 2,
      top + gridH + 60,
      { tone: 'meta', fontSize: 10.5, priority: 2, anchor: 'middle' },
    ),
  );
  notes.push('行数决定输出维度，列数决定输入维度；改变行数/列数/秩观察张成维度和损失的来源。');

  return {
    body: (
      <g data-figure-template="rank_map" data-rows={rows} data-cols={cols} data-rank={rank}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 },
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：inverse_map                                                           */
/* -------------------------------------------------------------------------- */

function renderInverseMap(scope: Record<string, SpecCell>): RenderedFigure {
  const { matrix, notes } = matrixFromNote(scope);
  const target: Vec2 = [
    readNumber(scope, 'target_x') ?? 2,
    readNumber(scope, 'target_y') ?? 1,
  ];
  const det = determinant(matrix);
  const inverse = inverseMatrix(matrix);
  const preimage = inverse === null ? null : applyMatrix(inverse, target);
  const samples: Vec2[] = [[0, 0], target];
  if (preimage) samples.push(preimage);
  const bounds = boundsFromPoints(samples, { padding: 0.9, minSpan: 4 });
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const axis = buildAxis(projector, bounds);
  const elements: ReactElement[] = [axis.layer];
  const labels: LabelRequest[] = [...axis.labels];
  addCartesianGrid(elements, projector, bounds);

  const targetEnd = projector(target[0], target[1]);
  const targetClipped = clipSegmentToRect(origin, targetEnd, PLOT, 6).point;
  elements.push(<Arrow key="inverse-target" from={origin} to={targetClipped} color={ORANGE} role="target-vector" />);
  labels.push(
    endpointLabel('inverse-target-label', `b = ${formatVector(target)}`, targetClipped, origin, 'outward', 24, {
      tone: 'image', fontSize: 10.5, priority: 2,
    }),
  );

  if (preimage) {
    const preEnd = projector(preimage[0], preimage[1]);
    const preClipped = clipSegmentToRect(origin, preEnd, PLOT, 6).point;
    elements.push(<Arrow key="inverse-preimage" from={origin} to={preClipped} color={NAVY} role="preimage-vector" />);
    elements.push(
      <line
        key="inverse-connector"
        className={styles.basisGuide}
        x1={preClipped[0]}
        y1={preClipped[1]}
        x2={targetClipped[0]}
        y2={targetClipped[1]}
      />,
    );
    labels.push(
      endpointLabel('inverse-preimage-label', `A⁻¹·b = ${formatVector(preimage)}`, preClipped, origin, 'outward', 24, {
        tone: 'primary', fontSize: 11, priority: 2,
      }),
    );
    labels.push(
      makeLabel('inverse-status', '唯一原像：A 可逆', PLOT.x + 6, PLOT.y + 14, {
        tone: 'scale', fontSize: 10.5, priority: 1, background: true,
      }),
    );
  } else {
    // 秩 1：若 b 在列空间内，原像是一整条线；否则无解。
    const firstColumn: Vec2 = [matrix.a, matrix.c];
    const secondColumn: Vec2 = [matrix.b, matrix.d];
    const column = Math.hypot(firstColumn[0], firstColumn[1]) > 1e-9 ? firstColumn : secondColumn;
    const columnLength = Math.hypot(column[0], column[1]);
    const cross = Math.abs(target[0] * column[1] - target[1] * column[0]);
    const consistent = columnLength > 1e-9 && cross <= 1e-6 * Math.max(1, columnLength) * Math.max(1, Math.hypot(target[0], target[1]));
    if (columnLength < 1e-9) {
      const targetLength = Math.hypot(target[0], target[1]);
      labels.push(
        makeLabel(
          'inverse-preimage-label',
          targetLength < 1e-9 ? '零矩阵：任意输入都映到 0' : '零矩阵：b ≠ 0，无解',
          PLOT.x + 6,
          PLOT.y + 30,
          { tone: 'meta', fontSize: 9.5, priority: 1, background: true },
        ),
      );
    } else if (consistent) {
      const scale = (target[0] * column[0] + target[1] * column[1]) / (columnLength * columnLength);
      const particular: Vec2 = [column[0] * scale, column[1] * scale];
      const nullVector: Vec2 =
        Math.hypot(matrix.b, matrix.a) > 1e-9 ? [matrix.b, -matrix.a] : [matrix.d, -matrix.c];
      const start = projector(particular[0], particular[1]);
      const segment = orientedSegment(particular, nullVector, (x, y) => projector(x, y), PLOT);
      if (segment) {
        elements.push(
          <line key="inverse-null" className={styles.eigenLine} x1={segment[0][0]} y1={segment[0][1]} x2={segment[1][0]} y2={segment[1][1]} />,
        );
      }
      elements.push(<circle key="inverse-particular" className={styles.markerDot} cx={start[0]} cy={start[1]} r={4} fill={NAVY} />);
      labels.push(
        makeLabel('inverse-preimage-label', '整条原像线：多组输入都映到 b', PLOT.x + 6, PLOT.y + 30, {
          tone: 'primary', fontSize: 9.5, priority: 1, background: true,
        }),
      );
    } else {
      labels.push(
        makeLabel('inverse-preimage-label', 'b 不在列空间：无解', PLOT.x + 6, PLOT.y + 30, {
          tone: 'meta', fontSize: 9.5, priority: 1, background: true,
        }),
      );
    }
    labels.push(
      makeLabel('inverse-status', '不可逆：没有唯一原像', PLOT.x + 6, PLOT.y + 14, {
        tone: 'scale', fontSize: 10.5, priority: 1, background: true,
      }),
    );
    notes.push('det ≈ 0：零空间中的向量都被映成 0；目标点可能无解，或对应一整条原像线。');
  }

  labels.push(
    makeLabel('inverse-det', `det A = ${formatNumber(det)}`, PLOT.x + PLOT.w - 4, PLOT.y + 14, {
      tone: 'meta', fontSize: 9.5, priority: 2, anchor: 'end',
    }),
  );
  elements.push(<circle key="inverse-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.4} />);
  notes.push('拖动目标点 b，观察唯一原像、无解或整条原像线；用矩阵实验台切换投影/剪切。');

  return {
    body: (
      <g data-figure-template="inverse_map" data-invertible={preimage ? 'true' : 'false'}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：circle_ellipse（原 S6）                                                */
/* -------------------------------------------------------------------------- */

function renderCircleEllipse(
  scope: Record<string, SpecCell>,
  stage: 0 | 1 | 2,
  progressInput?: number,
): RenderedFigure {
  const { matrix, notes } = matrixFromNote(scope);
  const det = determinant(matrix);
  const lengths = columnLengths(matrix);
  const progress = clampProgress(progressInput ?? STAGE_PROGRESS[stage]);
  const completed = progress >= 0.999;
  const animatedMatrix = lerpMatrix(IDENTITY_MATRIX, matrix, progress);

  const explicit = readVectorList(scope);
  const vectors = explicit.length > 0 ? explicit.slice(0, 3) : defaultProbeVectors(matrix);
  if (explicit.length === 0) {
    notes.push('原页标注了三条向量，这里按单位向量与两个特征方向重画；拖动参数即可看它们各自去哪。');
  }

  const images = vectors.map((vector) => applyMatrix(animatedMatrix, vector));
  const ellipse = ellipsePoints(animatedMatrix, 96);
  const unitSamples = ellipsePoints(IDENTITY_MATRIX, 48);
  // 视域按最终矩阵固定，动画过程中不缩放镜头，只让图形连续变形。
  const finalEllipse = ellipsePoints(matrix, 48);
  const finalImages = vectors.map((vector) => applyMatrix(matrix, vector));

  const bounds = boundsFromPoints(
    [[0, 0], ...unitSamples, ...finalEllipse, ...vectors, ...finalImages],
    { padding: 0.55, minSpan: 5 },
  );
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const unitRadius = Math.hypot(projector(1, 0)[0] - origin[0], projector(1, 0)[1] - origin[1]);
  // 椭圆采样点是数学坐标，必须投影到 SVG 坐标后再拼 path。
  const ellipseScreen = ellipse.map((point) => projector(point[0], point[1]));
  const axis = buildAxis(projector, bounds);
  const labels: LabelRequest[] = [...axis.labels];
  const elements: ReactElement[] = [axis.layer];

  // 1) 单位圆：浅蓝虚线。
  elements.push(
    <circle
      key="unit-circle"
      className={styles.unitCircle}
      cx={origin[0]}
      cy={origin[1]}
      r={unitRadius}
    />,
  );

  // 2) 变换后的椭圆：橙色实线 + 极淡填充。
  if (progress > 0) {
    elements.push(
      <path
        key="image-ellipse"
        className={styles.imageCurve}
        d={svgPath(ellipseScreen, true)}
        fillOpacity={0.055 * progress}
        strokeOpacity={progress}
      />,
    );
  }

  // 3) 原像向量：浅色虚线 + 端点圆点 + 坐标。
  vectors.forEach((vector, index) => {
    const fixed = isFixedVector(matrix, vector);
    const end = projector(vector[0], vector[1]);
    const ghostVisible = !(completed && fixed);
    if (ghostVisible) {
      elements.push(
        <Arrow
          key={`ghost-${index}`}
          from={origin}
          to={end}
          color={GHOST}
          dashed
          headSize={7}
          role="ghost-vector"
        />,
      );
      labels.push(
        endpointLabel(
          `ghost-label-${index}`,
          formatVector(vector),
          end,
          origin,
          'inward',
          26,
          { tone: 'ghost', fontSize: 10.5, priority: 3 },
        ),
      );
    }
    // 端点圆点始终保留，让三条原向量在虚线圆上依然可辨。
    elements.push(
      <circle
        key={`ghost-dot-${index}`}
        className={styles.ghostDot}
        cx={end[0]}
        cy={end[1]}
        r={3.4}
        fill={GHOST_DOT}
      />,
    );
  });

  // 4) 像向量：实线 + 箭头 + 坐标；固定向量与合并标注只出现一条线。
  if (progress > 0) {
    vectors.forEach((vector, index) => {
      const image = images[index];
      if (image === undefined) return;
      const fixed = isFixedVector(matrix, vector);
      const end = projector(image[0], image[1]);
      const clipped = clipSegmentToRect(origin, end, PLOT, 6).point;
      const color = IMAGE_COLORS[index] ?? ORANGE;
      elements.push(
        <Arrow
          key={`image-${index}`}
          from={origin}
          to={clipped}
          color={color}
          role="image-vector"
        />,
      );

      if (completed && fixed) {
        labels.push(
          mergedLabelRequest(
            `merged-${index}`,
            vector,
            eigenScale(matrix, vector) ?? 1,
            origin,
            clipped,
          ),
        );
        return;
      }

      labels.push(
        endpointLabel(
          `image-label-${index}`,
          formatVector(image),
          clipped,
          origin,
          'outward',
          26,
          {
            tone: index === 0 ? 'primary' : 'image',
            fontSize: 11,
            priority: 2,
          },
        ),
      );
    });
  }

  // 5) 特征倍数 ×λ：只在完成态出现，位置在像向量 60% 外侧。
  if (completed) {
    vectors.forEach((vector, index) => {

      const scale = eigenScale(matrix, vector);
      if (scale === null || isFixedVector(matrix, vector)) return;
      const image = applyMatrix(matrix, vector);
      const end = projector(image[0], image[1]);
      const clipped = clipSegmentToRect(origin, end, PLOT, 6).point;
      labels.push(scaleLabelRequest(`scale-${index}`, scale, origin, clipped));
    });
  }

  // 6) 参考说明。
  // 「单位圆」放在圆左上外侧：既贴住虚线圆，又不压 x 轴刻度数字。
  labels.push(
    makeLabel(
      'unit-circle-note',
      '单位圆',
      origin[0] - unitRadius * 0.9,
      origin[1] - unitRadius * 1.15,
      {
        tone: 'meta',
        fontSize: 10.5,
        priority: 4,
        anchor: 'end',
        alternatives: [
          { x: origin[0] - unitRadius - 6, y: origin[1] - 6, anchor: 'end' },
          { x: origin[0] - unitRadius * 0.9, y: origin[1] + unitRadius * 1.2, anchor: 'end' },
        ],
      },
    ),
  );
  if (progress > 0) {
    labels.push(
      makeLabel(
        'ellipse-note',
        '变换后：椭圆',
        origin[0] + unitRadius * 1.55,
        origin[1] + unitRadius * 1.9 + 8,
        {
          tone: 'scale',
          fontSize: 11,
          priority: 4,
          anchor: 'start',
          alternatives: [
            {
              x: origin[0] + unitRadius * 1.1,
              y: origin[1] + unitRadius * 2.2 + 8,
              anchor: 'start',
            },
            {
              x: origin[0] - unitRadius * 1.1,
              y: origin[1] + unitRadius * 2.2 + 8,
              anchor: 'end',
            },
          ],
        },
      ),
    );
  }

  labels.push(
    makeLabel(
      'det-note',
      `det A = ${formatNumber(det)} · |A·e₁| = ${formatNumber(lengths.first)} · |A·e₂| = ${formatNumber(lengths.second)}`,
      PLOT.x + 6,
      PLOT.y + 14,
      {
        tone: 'meta',
        fontSize: 10,
        priority: 2,
        alternatives: [{ x: PLOT.x + 6, y: PLOT.y + 28 }],
      },
    ),
  );

  elements.push(<circle key="ellipse-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.6} />);

  if (Math.abs(det) < 1e-9) {
    notes.push('det ≈ 0：单位圆被压成一条线段（秩为 1）。');
  }

  return {
    body: (
      <g data-figure-template="circle_ellipse" data-stage={stage} data-progress={progress}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：grid_transform（原 S9）                                                */
/* -------------------------------------------------------------------------- */

function renderGridTransform(
  scope: Record<string, SpecCell>,
  stage: 0 | 1 | 2,
  progressInput?: number,
): RenderedFigure {
  const { matrix, notes } = matrixFromNote(scope);
  const finalDet = determinant(matrix);
  const progress = clampProgress(progressInput ?? STAGE_PROGRESS[stage]);
  const animatedMatrix = lerpMatrix(IDENTITY_MATRIX, matrix, progress);
  const det = determinant(animatedMatrix);
  const firstColumn: Vec2 = [animatedMatrix.a, animatedMatrix.c];
  const secondColumn: Vec2 = [animatedMatrix.b, animatedMatrix.d];
  const imageQuad: Vec2[] = [
    [0, 0],
    firstColumn,
    [firstColumn[0] + secondColumn[0], firstColumn[1] + secondColumn[1]],
    secondColumn,
  ];
  const unitSquare: Vec2[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  // 用最终像定视域，动画只变形不缩放镜头。
  const finalQuad: Vec2[] = [
    [0, 0],
    [matrix.a, matrix.c],
    [matrix.a + matrix.b, matrix.c + matrix.d],
    [matrix.b, matrix.d],
  ];

  const bounds = boundsFromPoints(
    [...finalQuad, ...unitSquare, [3, 3], [-3, -3]],
    { padding: 0.5, minSpan: 7 },
  );
  const projector = createProjector(PLOT, bounds);
  const origin = projector(0, 0);
  const axis = buildAxis(projector, bounds);
  const labels: LabelRequest[] = [...axis.labels];
  const elements: ReactElement[] = [axis.layer];

  // 原网格（整数线；超出 7×7 时只画范围内的线，避免视图噪声）。
  const fromX = Math.max(-6, Math.ceil(bounds.xMin));
  const toX = Math.min(6, Math.floor(bounds.xMax));
  for (let tick = fromX; tick <= toX; tick += 1) {
    if (tick === 0) continue;
    const top = projector(tick, bounds.yMax);
    const bottom = projector(tick, bounds.yMin);
    elements.push(
      <line
        key={`grid-v-${tick}`}
        className={styles.sourceGrid}
        x1={top[0]}
        y1={top[1]}
        x2={bottom[0]}
        y2={bottom[1]}
      />,
    );
  }
  const fromY = Math.max(-6, Math.ceil(bounds.yMin));
  const toY = Math.min(6, Math.floor(bounds.yMax));
  for (let tick = fromY; tick <= toY; tick += 1) {
    if (tick === 0) continue;
    const left = projector(bounds.xMin, tick);
    const right = projector(bounds.xMax, tick);
    elements.push(
      <line
        key={`grid-h-${tick}`}
        className={styles.sourceGrid}
        x1={left[0]}
        y1={left[1]}
        x2={right[0]}
        y2={right[1]}
      />,
    );
  }

  const unitSquareScreen = unitSquare.map((point) => projector(point[0], point[1]));
  const imageScreen = imageQuad.map((point) => projector(point[0], point[1]));

  elements.push(
    <path key="unit-square" className={styles.preimage} d={svgPath(unitSquareScreen, true)} />,
  );
  if (Math.abs(det) < 1e-9) {
    const direction = Math.hypot(firstColumn[0], firstColumn[1]) > 1e-9 ? firstColumn : secondColumn;
    const end = projector(direction[0], direction[1]);
    elements.push(
      <line
        key="degenerate-grid"
        className={styles.degenerateLine}
        x1={origin[0]}
        y1={origin[1]}
        x2={end[0]}
        y2={end[1]}
      />,
    );
  } else {
    elements.push(
      <path
        key="image-parallelogram"
        className={styles.imageArea}
        d={svgPath(imageScreen, true)}
        fillOpacity={0.14}
      />,
    );
  }

  // 两列去向箭头 + 坐标标注。
  const columnEnds: Array<{ vector: Vec2; color: string; id: string; name: string }> = [
    { vector: firstColumn, color: NAVY, id: 'col-1', name: 'A·e₁' },
    { vector: secondColumn, color: ORANGE, id: 'col-2', name: 'A·e₂' },
  ];
  columnEnds.forEach((column) => {
    const end = projector(column.vector[0], column.vector[1]);
    const clipped = clipSegmentToRect(origin, end, PLOT, 6).point;
    elements.push(<Arrow key={column.id} from={origin} to={clipped} color={column.color} role="column-vector" />);
    labels.push(
      endpointLabel(
        `${column.id}-label`,
        `${column.name} = ${formatVector(column.vector)}`,
        clipped,
        origin,
        'outward',
        26,
        {
          tone: column.color === NAVY ? 'primary' : 'image',
          fontSize: 10.5,
          priority: 2,
        },
      ),
    );
  });

  elements.push(<circle key="grid-origin" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={3.6} />);
  labels.push(
    makeLabel(
      'grid-det',
      `${progress >= 0.999 ? 'det A' : 'det A(t)'} = ${formatNumber(det)}`,
      PLOT.x + 6,
      PLOT.y + 14,
      {
        tone: 'meta',
        fontSize: 10,
        priority: 2,
        alternatives: [{ x: PLOT.x + 6, y: PLOT.y + 28 }],
      },
    ),
  );

  if (Math.abs(finalDet) < 1e-9) {
    notes.push('det ≈ 0：网格被压成一条线（平面退化为 1 维）。');
  }

  return {
    body: (
      <g
        data-figure-template="grid_transform"
        data-degenerate={Math.abs(finalDet) < 1e-9 ? 'true' : 'false'}
        data-progress={progress}
      >
        {elements}
        <LabelLayer labels={layoutLabels(labels, FULL_AREA)} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：step_diagram（原 S10 / S14）                                           */
/* -------------------------------------------------------------------------- */

interface PanelContent {
  elements: ReactElement[];
  labels: LabelRequest[];
}

interface StepPanel {
  title: string;
  content: PanelContent;
}

const PANEL_BOUNDS: MathBounds = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };

/** 子图坐标轴（无刻度数字，只保留轴与短线，避免小图拥挤）。 */
function miniAxes(projector: Projector, bounds: MathBounds): ReactElement {
  const xStart = projector(bounds.xMin, 0);
  const xEnd = projector(bounds.xMax, 0);
  const yStart = projector(0, bounds.yMin);
  const yEnd = projector(0, bounds.yMax);
  return (
    <g data-layer="axis">
      <line className={styles.axis} x1={xStart[0]} y1={xStart[1]} x2={xEnd[0]} y2={xEnd[1]} />
      <path className={styles.axisArrow} d={arrowHeadPath(xStart, xEnd, 6)} />
      <line className={styles.axis} x1={yStart[0]} y1={yStart[1]} x2={yEnd[0]} y2={yEnd[1]} />
      <path className={styles.axisArrow} d={arrowHeadPath(yStart, yEnd, 6)} />
    </g>
  );
}

function drawAreaOf(area: RectArea): RectArea {
  return { x: area.x + 8, y: area.y + 20, w: area.w - 16, h: area.h - 28 };
}

/** S14：单位圆 → 沿坐标轴伸缩 → 转向输出方向（三个明确中间态）。 */
function buildSvdPanel(index: number, area: RectArea): PanelContent {
  const sigma: Vec2 = [1.618, 0.618];
  const rotationDeg = 32;
  const drawArea = drawAreaOf(area);
  const projector = createProjector(drawArea, PANEL_BOUNDS);
  const origin = projector(0, 0);
  const elements: ReactElement[] = [<g key="mini-axis">{miniAxes(projector, PANEL_BOUNDS)}</g>];
  const labels: LabelRequest[] = [];

  // 参照单位圆始终保留（虚浅）。
  elements.push(
    <circle key="svd-unit" className={styles.unitCircle} cx={origin[0]} cy={origin[1]} r={Math.hypot(projector(1, 0)[0] - origin[0], projector(1, 0)[1] - origin[1])} />,
  );

  if (index === 0) {
    const radius = Math.hypot(projector(1, 0)[0] - origin[0], projector(1, 0)[1] - origin[1]);
    elements.push(
      <circle key="svd-shape" className={styles.stepShape} cx={origin[0]} cy={origin[1]} r={radius} stroke={NAVY} />,
    );
    const end = projector(1, 0);
    elements.push(<Arrow key="svd-marker" from={origin} to={end} color={ORANGE} role="marker" headSize={7} />);
    elements.push(
      <circle key="svd-dot" className={styles.markerDot} cx={end[0]} cy={end[1]} r={3.6} fill={ORANGE} />,
    );
    labels.push(
      makeLabel('svd-marker-label', '标记点 (1,0)', area.x + 8, area.y + area.h - 7, {
        tone: 'scale',
        fontSize: 9,
        priority: 1,
      }),
    );
  } else {
    const angle = (rotationDeg * Math.PI) / 180;
    const shapeMatrix: Matrix2 =
      index === 1
        ? { a: sigma[0], b: 0, c: 0, d: sigma[1] }
        : {
            a: sigma[0] * Math.cos(angle),
            b: -sigma[1] * Math.sin(angle),
            c: sigma[0] * Math.sin(angle),
            d: sigma[1] * Math.cos(angle),
          };
    const shape = ellipsePoints(shapeMatrix, 72).map((point) => projector(point[0], point[1]));
    elements.push(
      <path
        key="svd-shape"
        className={styles.imageCurve}
        d={svgPath(shape, true)}
        fillOpacity={0.06}
      />,
    );
    const markerMath = applyMatrix(shapeMatrix, [1, 0]);
    const end = projector(markerMath[0], markerMath[1]);
    const clipped = clipSegmentToRect(origin, end, drawArea, 5).point;
    elements.push(<Arrow key="svd-marker" from={origin} to={clipped} color={ORANGE} role="marker" headSize={7} />);
    elements.push(
      <circle key="svd-dot" className={styles.markerDot} cx={clipped[0]} cy={clipped[1]} r={3.6} fill={ORANGE} />,
    );

    const majorEnd = projector(markerMath[0], markerMath[1]);
    labels.push(
      makeLabel(
        'svd-sigma-1',
        `×${formatNumber(sigma[0])}`,
        majorEnd[0] + 6,
        majorEnd[1] - 4,
        {
          tone: 'scale',
          fontSize: 9,
          priority: 2,
          anchor: 'start',
          background: true,
          alternatives: [{ x: majorEnd[0] - 6, y: majorEnd[1] - 8, anchor: 'end' }],
        },
      ),
    );
    const minorMath = applyMatrix(shapeMatrix, [0, 1]);
    const minorEnd = projector(minorMath[0], minorMath[1]);
    labels.push(
      makeLabel(
        'svd-sigma-2',
        `×${formatNumber(sigma[1])}`,
        minorEnd[0] + 5,
        minorEnd[1] + 3,
        {
          tone: 'scale',
          fontSize: 9,
          priority: 2,
          anchor: 'start',
          background: true,
          alternatives: [{ x: minorEnd[0] - 5, y: minorEnd[1] - 4, anchor: 'end' }],
        },
      ),
    );
    labels.push(
      makeLabel('svd-marker-label', '标记点', area.x + 8, area.y + area.h - 7, {
        tone: 'scale',
        fontSize: 9,
        priority: 1,
      }),
    );
  }

  return { elements, labels };
}

interface OrderParams {
  rotateDeg: number;
  stretchX: number;
  stretchY: number;
}

/** S10：先转后拉 vs 先拉后转（三步各自一个明确状态）。 */
function buildOrderPanel(index: number, area: RectArea, params: OrderParams): PanelContent {
  const drawArea = drawAreaOf(area);
  const projector = createProjector(drawArea, PANEL_BOUNDS);
  const origin = projector(0, 0);
  const elements: ReactElement[] = [<g key="mini-axis">{miniAxes(projector, PANEL_BOUNDS)}</g>];
  const labels: LabelRequest[] = [];

  const angle = (params.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const input: Vec2 = [1, 0];
  const rotated: Vec2 = [cos, sin];
  const stretched: Vec2 = [params.stretchX, 0];
  const rotateThenStretch: Vec2 = [params.stretchX * cos, params.stretchY * sin];
  const stretchThenRotate: Vec2 = [params.stretchX * cos, params.stretchX * sin];

  elements.push(
    <circle
      key="order-unit"
      className={styles.unitCircle}
      cx={origin[0]}
      cy={origin[1]}
      r={Math.hypot(projector(1, 0)[0] - origin[0], projector(1, 0)[1] - origin[1])}
    />,
  );

  const pushArrow = (key: string, vector: Vec2, color: string, role: string): void => {
    const end = projector(vector[0], vector[1]);
    const clipped = clipSegmentToRect(origin, end, drawArea, 5).point;
    elements.push(<Arrow key={key} from={origin} to={clipped} color={color} role={role} headSize={7} />);
  };

  // 小图宽度只有 180 viewBox 单位：标注固定贴底两行，避免端点外侧放不下被隐藏。
  const bottomLeft = area.x + 8;
  const bottomRight = area.x + area.w - 8;
  const bottomLow = area.y + area.h - 5;
  const bottomHigh = area.y + area.h - 19;

  if (index === 0) {
    pushArrow('order-input', input, NAVY, 'step-vector');
    labels.push(
      makeLabel('order-input-label', `${formatVector(input)} 长度 1`, bottomLeft, bottomLow, {
        tone: 'primary',
        fontSize: 8.5,
        priority: 1,
      }),
    );
  } else if (index === 1) {
    pushArrow('order-rotated', rotated, NAVY, 'step-vector');
    pushArrow('order-stretched', stretched, ORANGE, 'step-vector');
    labels.push(
      makeLabel('order-rotated-label', `旋转后 ${formatVector(rotated)}`, bottomLeft, bottomHigh, {
        tone: 'primary',
        fontSize: 8.5,
        priority: 1,
      }),
    );
    labels.push(
      makeLabel('order-stretched-label', `拉伸后 ${formatVector(stretched)}`, bottomRight, bottomLow, {
        tone: 'image',
        fontSize: 8.5,
        priority: 1,
        anchor: 'end',
      }),
    );
  } else {
    pushArrow('order-a', rotateThenStretch, NAVY, 'step-vector');
    pushArrow('order-b', stretchThenRotate, ORANGE, 'step-vector');
    const lengthA = Math.hypot(rotateThenStretch[0], rotateThenStretch[1]);
    const lengthB = Math.hypot(stretchThenRotate[0], stretchThenRotate[1]);
    labels.push(
      makeLabel(
        'order-a-label',
        `先转后拉 ${formatVector(rotateThenStretch)} 长 ${formatNumber(lengthA)}`,
        bottomLeft,
        bottomHigh,
        { tone: 'primary', fontSize: 8.5, priority: 1 },
      ),
    );
    labels.push(
      makeLabel(
        'order-b-label',
        `先拉后转 ${formatVector(stretchThenRotate)} 长 ${formatNumber(lengthB)}`,
        bottomRight,
        bottomLow,
        { tone: 'image', fontSize: 8.5, priority: 1, anchor: 'end' },
      ),
    );
  }

  return { elements, labels };
}

function renderStepDiagram(scope: Record<string, SpecCell>, stage: 0 | 1 | 2): RenderedFigure {
  const current = Math.max(0, Math.min(2, stage));
  const rotateDeg = readNumber(scope, 'steps_rotate_angle_deg');
  const stretchX = readNumber(scope, 'steps_stretch_factor_x');
  const stretchY = readNumber(scope, 'steps_stretch_factor_y');
  const orderMode = rotateDeg !== null || stretchX !== null || stretchY !== null;
  const notes: string[] = [];

  const params: OrderParams = {
    rotateDeg: rotateDeg ?? 90,
    stretchX: stretchX ?? 2,
    stretchY: stretchY ?? 1,
  };

  const gap = 16;
  const panelTop = PLOT.y + 26;
  const panelH = PLOT.h - 58;
  const panelW = (PLOT.w - gap * 2) / 3;
  const panelAreas: RectArea[] = [0, 1, 2].map((index) => ({
    x: PLOT.x + index * (panelW + gap),
    y: panelTop,
    w: panelW,
    h: panelH,
  }));
  const centers = panelAreas.map((area) => area.x + area.w / 2);
  const indicatorY = PLOT.y + 8;

  let panels: StepPanel[];
  if (orderMode) {
    panels = [
      { title: '输入', content: buildOrderPanel(0, panelAreas[0] ?? PLOT, params) },
      { title: '中间状态', content: buildOrderPanel(1, panelAreas[1] ?? PLOT, params) },
      { title: '输出', content: buildOrderPanel(2, panelAreas[2] ?? PLOT, params) },
    ];
  } else {
    notes.push('未提供 steps_* 参数，按原页 SVD 三步（σ₁=1.618 / σ₂=0.618、转向 32°）绘制明确中间态。');
    panels = [
      { title: '单位圆', content: buildSvdPanel(0, panelAreas[0] ?? PLOT) },
      { title: '沿坐标轴伸缩', content: buildSvdPanel(1, panelAreas[1] ?? PLOT) },
      { title: '转向输出方向', content: buildSvdPanel(2, panelAreas[2] ?? PLOT) },
    ];
  }

  const panelElements: ReactElement[] = panels.map((panel, index) => {
    const area: RectArea = panelAreas[index] ?? PLOT;
    const active = index === current;
    const visible = index <= current;
    const titleLabel = makeLabel(
      `panel-title-${index}`,
      `第 ${index + 1} 步 · ${panel.title}`,
      area.x + 8,
      area.y + 14,
      { tone: 'panel', fontSize: 10, priority: 1 },
    );
    const labels = layoutLabels([titleLabel, ...panel.content.labels], area);
    return (
      <g
        key={`step-panel-${index}`}
        data-step-panel={index}
        data-step-state={index < current ? 'done' : active ? 'active' : 'todo'}
        opacity={visible ? 1 : 0.45}
      >
        <rect
          className={styles.panelBackground}
          data-state={active ? 'active' : visible ? 'done' : 'todo'}
          x={area.x}
          y={area.y}
          width={area.w}
          height={area.h}
          rx={6}
        />
        {panel.content.elements}
        <LabelLayer labels={labels} />
      </g>
    );
  });

  const indicator: ReactElement[] = [
    <line
      key="step-track"
      className={styles.stepTrack}
      x1={centers[0] ?? PLOT.x}
      y1={indicatorY}
      x2={centers[2] ?? PLOT.x + PLOT.w}
      y2={indicatorY}
    />,
  ];
  if (current > 0) {
    indicator.push(
      <line
        key="step-progress"
        className={styles.stepProgress}
        x1={centers[0] ?? PLOT.x}
        y1={indicatorY}
        x2={centers[current] ?? PLOT.x}
        y2={indicatorY}
      />,
    );
  }
  [0, 1, 2].forEach((index) => {
    const center = centers[index] ?? PLOT.x;
    const completed = index < current;
    const active = index === current;
    indicator.push(
      <circle
        key={`step-node-${index}`}
        className={styles.stepNode}
        data-state={completed ? 'done' : active ? 'active' : 'todo'}
        cx={center}
        cy={indicatorY}
        r={6}
      />,
    );
    indicator.push(
      <text
        key={`step-index-${index}`}
        className={styles.stepIndex}
        data-state={completed ? 'done' : active ? 'active' : 'todo'}
        x={center}
        y={indicatorY + 3}
        textAnchor="middle"
      >
        {completed ? '✓' : index + 1}
      </text>,
    );
  });

  const statusLabels = layoutLabels(
    [
      makeLabel(
        'step-status',
        `第 ${current + 1} 步 / 3 · ${panels[current]?.title ?? ''}`,
        PLOT.x + PLOT.w - 4,
        panelTop + panelH + 24,
        { tone: 'panel', fontSize: 10, priority: 1, anchor: 'end' },
      ),
    ],
    FULL_AREA,
  );

  return {
    body: (
      <g data-figure-template="step_diagram" data-stage={current} data-mode={orderMode ? 'order' : 'svd'}>
        {indicator}
        {panelElements}
        <LabelLayer labels={statusLabels} />
      </g>
    ),
    notes,
    bounds: PANEL_BOUNDS,
  };
}

/* -------------------------------------------------------------------------- */
/* 模板：det_area（原 S18 四格）                                                */
/* -------------------------------------------------------------------------- */

interface DetCell {
  id: string;
  label: string;
  matrix: Matrix2;
  det: number;
}

function readTextCell(scope: Record<string, SpecCell>, id: string): string | null {
  const value = scope[id];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 读取四格参数；参数缺失时回退到整块矩阵（单格展示并说明）。 */
function readDetCells(scope: Record<string, SpecCell>, fallback: Matrix2): DetCell[] {
  const cells: DetCell[] = [];
  for (let index = 0; index < 4; index += 1) {
    const a = readNumber(scope, `cells_${index}_matrix_0_0`);
    const b = readNumber(scope, `cells_${index}_matrix_0_1`);
    const c = readNumber(scope, `cells_${index}_matrix_1_0`);
    const d = readNumber(scope, `cells_${index}_matrix_1_1`);
    if (a === null && b === null && c === null && d === null) continue;
    const matrix: Matrix2 = {
      a: a ?? fallback.a,
      b: b ?? fallback.b,
      c: c ?? fallback.c,
      d: d ?? fallback.d,
    };
    cells.push({
      id: `cell-${index}`,
      label: readTextCell(scope, `cells_${index}_label`) ?? `格 ${index + 1}`,
      matrix,
      det: determinant(matrix),
    });
  }
  if (cells.length === 0) {
    cells.push({ id: 'cell-0', label: '矩阵 A', matrix: fallback, det: determinant(fallback) });
  }
  return cells;
}

function orientationText(det: number): string {
  if (Math.abs(det) < 1e-9) return '无';
  return det > 0 ? '正' : '负';
}

function renderDetArea(scope: Record<string, SpecCell>): RenderedFigure {
  const fallback = matrixFromScope(scope);
  const cells = readDetCells(scope, fallback);
  const notes: string[] = [];
  if (cells.length < 4) {
    notes.push(`只检测到 ${cells.length} 格参数（cells_*），按 ${cells.length} 格布局绘制。`);
  }

  // 四格共用一套视域，面积大小可以直接横向比较。
  const points: Vec2[] = [];
  for (const cell of cells) {
    const image = [
      applyMatrix(cell.matrix, [0, 0]),
      applyMatrix(cell.matrix, [1, 0]),
      applyMatrix(cell.matrix, [1, 1]),
      applyMatrix(cell.matrix, [0, 1]),
    ];
    points.push(...image, [1, 0], [0, 1], [1, 1]);
  }
  const bounds = boundsFromPoints(points, { padding: 0.4, minSpan: 2.6 });

  const columns = cells.length >= 2 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(cells.length / columns));
  const gap = 12;
  const panelW = (PLOT.w - gap * (columns - 1)) / columns;
  const panelH = (PLOT.h - gap * (rows - 1)) / rows;

  const panels = cells.map((cell, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const area: RectArea = {
      x: PLOT.x + column * (panelW + gap),
      y: PLOT.y + row * (panelH + gap),
      w: panelW,
      h: panelH,
    };
    const content: RectArea = { x: area.x + 8, y: area.y + 20, w: area.w - 16, h: area.h - 28 };
    const projector = createProjector(content, bounds);
    const origin = projector(0, 0);
    const imageQuad = [
      projector(0, 0),
      projector(cell.matrix.a, cell.matrix.c),
      projector(cell.matrix.a + cell.matrix.b, cell.matrix.c + cell.matrix.d),
      projector(cell.matrix.b, cell.matrix.d),
    ];
    const unitSquare = [
      projector(0, 0),
      projector(1, 0),
      projector(1, 1),
      projector(0, 1),
    ];
    const degenerate = Math.abs(cell.det) < 1e-9;

    const elements: ReactElement[] = [
      <rect
        key="panel-bg"
        className={styles.panelBackground}
        x={area.x}
        y={area.y}
        width={area.w}
        height={area.h}
        rx={6}
      />,
      <line
        key="axis-x"
        className={styles.axis}
        x1={projector(bounds.xMin, 0)[0]}
        y1={origin[1]}
        x2={projector(bounds.xMax, 0)[0]}
        y2={origin[1]}
      />,
      <line
        key="axis-y"
        className={styles.axis}
        x1={origin[0]}
        y1={projector(0, bounds.yMin)[1]}
        x2={origin[0]}
        y2={projector(0, bounds.yMax)[1]}
      />,
      <path key="unit-square" className={styles.preimage} d={svgPath(unitSquare, true)} />,
    ];

    if (degenerate) {
      const firstColumn: Vec2 = [cell.matrix.a, cell.matrix.c];
      const secondColumn: Vec2 = [cell.matrix.b, cell.matrix.d];
      const direction =
        Math.hypot(firstColumn[0], firstColumn[1]) > 1e-9
          ? firstColumn
          : Math.hypot(secondColumn[0], secondColumn[1]) > 1e-9
            ? secondColumn
            : null;
      if (direction === null) {
        elements.push(
          <circle key="degenerate-dot" className={styles.markerDot} cx={origin[0]} cy={origin[1]} r={2.6} fill={ORANGE} />,
        );
      } else {
        const end = projector(direction[0], direction[1]);
        elements.push(
          <line
            key="degenerate-line"
            className={styles.degenerateLine}
            x1={origin[0]}
            y1={origin[1]}
            x2={end[0]}
            y2={end[1]}
          />,
        );
      }
    } else {
      elements.push(
        <path
          key="image-area"
          className={cell.det < 0 ? styles.imageAreaNegative : styles.imageArea}
          d={svgPath(imageQuad, true)}
          fillOpacity={0.16}
        />,
      );
    }

    elements.push(
      <circle key="origin-dot" className={styles.originDot} cx={origin[0]} cy={origin[1]} r={2.6} />,
    );

    const labels: LabelRequest[] = [
      makeLabel('cell-label', cell.label, area.x + 8, area.y + 13, {
        tone: 'panel',
        fontSize: 9,
        priority: 3,
        anchor: 'start',
      }),
    ];
    if (degenerate) {
      labels.push(
        makeLabel('cell-area', '面积 0，平面被压成一条线（定向 无）', content.x + 2, content.y + content.h - 3, {
          tone: 'scale',
          fontSize: 9,
          priority: 1,
          anchor: 'start',
          alternatives: [{ x: content.x + 2, y: content.y + content.h - 18, anchor: 'start' }],
        }),
      );
    } else {
      labels.push(
        makeLabel('cell-area', `面积 ${formatNumber(Math.abs(cell.det))}`, content.x + 2, content.y + content.h - 3, {
          tone: 'image',
          fontSize: 9.5,
          priority: 2,
          anchor: 'start',
        }),
      );
      labels.push(
        makeLabel('cell-orientation', `定向 ${orientationText(cell.det)}`, content.x + content.w - 2, content.y + content.h - 3, {
          tone: 'meta',
          fontSize: 9.5,
          priority: 2,
          anchor: 'end',
        }),
      );
    }

    return (
      <g key={cell.id} data-det-cell={index} data-degenerate={degenerate ? 'true' : 'false'}>
        {elements}
        <LabelLayer labels={layoutLabels(labels, area)} />
      </g>
    );
  });

  const summary = layoutLabels(
    [
      makeLabel(
        'det-summary',
        `det(单元方格) = 1 · ${cells.map((cell) => `|det|=${formatNumber(Math.abs(cell.det))}`).join(' · ')}`,
        PLOT.x + 4,
        PLOT.y - 2,
        { tone: 'meta', fontSize: 9, priority: 2, anchor: 'start' },
      ),
    ],
    FULL_AREA,
  );

  return {
    body: (
      <g data-figure-template="det_area" data-cell-count={cells.length}>
        {panels}
        <LabelLayer labels={summary} />
      </g>
    ),
    notes,
    bounds,
  };
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

function parameterPair(
  scope: Record<string, SpecCell>,
  ids: readonly [string, string],
): [number, number] | null {
  const first = readNumber(scope, ids[0]);
  const second = readNumber(scope, ids[1]);
  if (first === null || second === null) return null;
  return [first, second];
}

/**
 * 按图模板列出可拖动的手柄。
 *
 * 参数 id 约定（iSpec 不新增字段）：
 *  - `vectors`：`x / y`、`x2 / y2`；
 *  - 矩阵类：`a / c`（第一列）与 `b / d`（第二列）；若使用原文的 `a11..a22`，
 *    分别映射为 `(a11, a21)` 与 `(a12, a22)`；
 *  - `det_area`：四格各有自己的视域，不做整体拖拽。
 */
function buildHandles(
  specRef: FigureView['spec_ref'],
  scope: Record<string, SpecCell>,
): DragHandleSpec[] {
  if (
    specRef === 'step_diagram' ||
    specRef === 'det_area' ||
    specRef === 'singular_compare' ||
    specRef === 'rank_map'
  ) {
    return [];
  }

  if (specRef === 'eigen_probe') {
    const vector = parameterPair(scope, ['vx', 'vy']);
    return vector === null
      ? []
      : [{ key: 'probe-vector', value: vector, ids: ['vx', 'vy'], label: '探针向量端点' }];
  }

  if (specRef === 'basis_change') {
    const handles: DragHandleSpec[] = [];
    const point = parameterPair(scope, ['point_x', 'point_y']);
    if (point !== null) {
      handles.push({ key: 'basis-point', value: point, ids: ['point_x', 'point_y'], label: '固定点 P' });
    }
    const second = parameterPair(scope, ['b2x', 'b2y']);
    if (second !== null) {
      handles.push({ key: 'basis-second', value: second, ids: ['b2x', 'b2y'], label: '斜基向量 b₂' });
    }
    return handles;
  }

  if (specRef === 'inverse_map') {
    const target = parameterPair(scope, ['target_x', 'target_y']);
    return target === null
      ? []
      : [{ key: 'inverse-target', value: target, ids: ['target_x', 'target_y'], label: '目标点 b' }];
  }

  if (specRef === 'vectors') {
    const handles: DragHandleSpec[] = [];
    const first = parameterPair(scope, ['x', 'y']);
    if (first !== null) {
      handles.push({ key: 'vector-1', value: first, ids: ['x', 'y'], label: '向量 1 端点' });
    }
    const second = parameterPair(scope, ['x2', 'y2']);
    if (second !== null) {
      handles.push({ key: 'vector-2', value: second, ids: ['x2', 'y2'], label: '向量 2 端点' });
    }
    return handles;
  }

  const firstColumn = parameterPair(scope, ['a', 'c']) ?? parameterPair(scope, ['a11', 'a21']);
  const secondColumn = parameterPair(scope, ['b', 'd']) ?? parameterPair(scope, ['a12', 'a22']);
  const ids: Array<[string, string]> = [];
  if (parameterPair(scope, ['a', 'c']) !== null) ids.push(['a', 'c']);
  else ids.push(['a11', 'a21']);
  if (parameterPair(scope, ['b', 'd']) !== null) ids.push(['b', 'd']);
  else ids.push(['a12', 'a22']);

  const handles: DragHandleSpec[] = [];
  if (firstColumn !== null) {
    handles.push({
      key: 'column-1',
      value: firstColumn,
      ids: ids[0] ?? ['a11', 'a21'],
      label: '第一列端点',
    });
  }
  if (secondColumn !== null) {
    handles.push({
      key: 'column-2',
      value: secondColumn,
      ids: ids[1] ?? ['a12', 'a22'],
      label: '第二列端点',
    });
  }
  return handles;
}

interface DragHandleProps {
  center: Vec2;
  value: [number, number];
  label: string;
  toMath: (svgPoint: Vec2) => Vec2;
  onMove: (mathPoint: Vec2) => void;
}

/**
 * SVG 拖动手柄：指针拖动 + 方向键微调。
 * 坐标换算走 SVG 的 `getScreenCTM()`，因此缩放/容器尺寸变化都不影响正确性。
 */
function DragHandle(props: DragHandleProps): ReactElement {
  const { center, value, label, toMath, onMove } = props;
  const [dragging, setDragging] = useState(false);
  const ref = useRef<SVGCircleElement | null>(null);
  const pendingPoint = useRef<Vec2 | null>(null);
  const frame = useRef<number | null>(null);

  const flush = (): void => {
    frame.current = null;
    const point = pendingPoint.current;
    pendingPoint.current = null;
    if (point !== null) onMove(toMath(point));
  };
  const schedule = (point: Vec2): void => {
    pendingPoint.current = point;
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<SVGCircleElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (!dragging) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (svg === null) return;
    const matrix = svg.getScreenCTM();
    if (matrix === null) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    schedule([point.x, point.y]);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGCircleElement>): void => {
    setDragging(false);
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const point = pendingPoint.current;
    pendingPoint.current = null;
    if (point !== null) onMove(toMath(point));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>): void => {
    const step = event.shiftKey ? 0.5 : 0.1;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onMove([value[0] + delta[0], value[1] + delta[1]]);
  };

  return (
    <g>
      <circle
        className={styles.dragHalo}
        cx={center[0]}
        cy={center[1]}
        r={dragging ? 16 : 12}
        pointerEvents="none"
        data-dragging={dragging ? 'true' : 'false'}
      />
      <circle
        ref={ref}
        className={styles.dragHandle}
        data-drag-handle={label}
        data-dragging={dragging ? 'true' : 'false'}
        cx={center[0]}
        cy={center[1]}
        r={dragging ? 8 : 6.5}
        role="button"
        tabIndex={0}
        aria-label={`${label}（可拖动，方向键微调）`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      />
    </g>
  );
}

/** 按 `spec_ref` 分派模板；default 只为类型穷尽兜底（schema 已限死五个值）。 */
function renderFigure(
  view: FigureView,
  scope: Record<string, SpecCell>,
  stage: 0 | 1 | 2,
  progress: number,
  hideEigenHints = false,
): RenderedFigure {
  switch (view.spec_ref) {
    case 'vectors':
      return renderVectors(scope);
    case 'circle_ellipse':
      return renderCircleEllipse(scope, stage, progress);
    case 'grid_transform':
      return renderGridTransform(scope, stage, progress);
    case 'step_diagram':
      return renderStepDiagram(scope, stage);
    case 'det_area':
      return renderDetArea(scope);
    case 'eigen_probe':
      return renderEigenProbe(scope, hideEigenHints);
    case 'basis_change':
      return renderBasisChange(scope);
    case 'singular_compare':
      return renderSingularCompare(scope);
    case 'rank_map':
      return renderRankMap(scope);
    case 'inverse_map':
      return renderInverseMap(scope);
    default:
      return renderVectors(scope);
  }
}

export const FigureSpecView = memo(function FigureSpecView(props: FigureSpecViewProps): ReactElement {
  const {
    view,
    evaluation,
    stage,
    reducedMotion,
    progress: progressInput,
    draggable = false,
    onParamChange,
    hideEigenHints = false,
  } = props;
  const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };
  const progress = clampProgress(progressInput ?? STAGE_PROGRESS[stage]);
  const rendered = renderFigure(view, scope, stage, progress, hideEigenHints);

  const title = view.title ?? TEMPLATE_TITLES[view.spec_ref];
  const det = determinant(matrixFromScope(scope));
  const animating = progress < 0.999;
  const ariaLabel =
    view.spec_ref === 'step_diagram'
      ? `${title}：当前第 ${stage + 1} 步，共 3 步`
      : view.spec_ref === 'vectors'
        ? `${title}：x=${formatNumberSmart(readNumber(scope, 'x') ?? 1)}，y=${formatNumberSmart(readNumber(scope, 'y') ?? 1)}`
        : view.spec_ref === 'det_area'
          ? `${title}：四格面积与定向对比`
          : view.spec_ref === 'rank_map'
            ? `${title}：行数 ${formatNumberSmart(readNumber(scope, 'rows') ?? 3)}，列数 ${formatNumberSmart(readNumber(scope, 'cols') ?? 2)}，秩 ${formatNumberSmart(readNumber(scope, 'rank') ?? 2)}`
            : view.spec_ref === 'singular_compare'
              ? `${title}：A 的奇异值 ${formatNumberSmart(readNumber(scope, 's1a') ?? 1)} 与 ${formatNumberSmart(readNumber(scope, 's2a') ?? 1)}`
              : view.spec_ref === 'basis_change'
                ? `${title}：固定点与两套坐标`
                : view.spec_ref === 'eigen_probe'
                  ? `${title}：探针向量 ${formatNumberSmart(readNumber(scope, 'vx') ?? 1)}，${formatNumberSmart(readNumber(scope, 'vy') ?? 1)}`
                  : `${title}：det = ${formatNumberSmart(det)}${animating ? `，变换进度 ${Math.round(progress * 100)}%` : ''}`;

  const projector = createProjector(PLOT, rendered.bounds);
  const unprojector = createUnprojector(PLOT, rendered.bounds);
  const handles =
    draggable && onParamChange !== undefined && !animating
      ? buildHandles(view.spec_ref, scope)
      : [];

  const overlay =
    handles.length === 0 ? undefined : (
      <g data-drag-layer={handles.length}>
        {handles.map((handle) => (
          <DragHandle
            key={handle.key}
            center={projector(handle.value[0], handle.value[1])}
            value={handle.value}
            label={handle.label}
            toMath={(svgPoint) => unprojector(svgPoint[0], svgPoint[1])}
            onMove={(mathPoint) => {
              const clamped = clampToBounds(mathPoint, rendered.bounds);
              const nextX = roundToStep(clamped[0]);
              const nextY = roundToStep(clamped[1]);
              onParamChange?.(handle.ids[0], nextX);
              onParamChange?.(handle.ids[1], nextY);
            }}
          />
        ))}
      </g>
    );

  return (
    <FigureFrame
      title={title}
      specRef={view.spec_ref}
      ariaLabel={ariaLabel}
      notes={rendered.notes}
      reducedMotion={reducedMotion}
      overlay={overlay}
      hint={handles.length > 0 ? (HANDLE_HINTS[view.spec_ref] ?? '拖动圆点改参数') : undefined}
    >
      {rendered.body}
    </FigureFrame>
  );
});

export default FigureSpecView;