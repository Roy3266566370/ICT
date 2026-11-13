/**
 * matrixEigen/MatrixEigenScene.tsx —— S6 动态层（SVG）渲染。
 *
 * 施工依据：rebuild-spec §7（视觉规范）与 §7.1（标注防遮挡）。图层顺序刻意与
 * `prototype/s06.html` 一致：轴 → 单位圆 → 椭圆 → 原像虚线 → 像实线 → 标注 → 拖动手柄。
 *
 * 防遮挡的三条硬规则（对应 §7.1，上一版被扣分最多的地方）：
 *  1. `A·v ≈ v`（特征值 1）时**只画一条线**，标注合并为 `(1, -1) 不动 ×1`；
 *  2. 原像标注贴端点**内侧**（朝原点方向），像标注贴箭头**外侧**（远离原点）；
 *  3. 倍数标注放在像向量 60% 处的外侧并加 `#F6F3EC` 5px 描边；
 *  4. 所有文字统一过 `layoutLabels`：包围盒互斥 + 不出 viewBox，冲突时先牺牲刻度数字。
 */
import {
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { RegionCoordinateSystem } from '@/regions/types';
import {
  applyMatrix,
  buildTicks,
  clampVector,
  clipFromOrigin,
  ellipseMathPoints,
  ellipsePath,
  eigenScale,
  fitToViewBox,
  fmt,
  fmtVec,
  isFixedVector,
  layoutLabels,
  measureText,
  normalOf,
  project,
  shouldSkipAlternateTicks,
  unproject,
  type LabelRequest,
  type Mat2,
  type PlacedLabel,
  type TextAnchor,
  type Vec2,
} from './scene';
import styles from './matrixEigen.module.css';

/** 三条向量的配色（与原型一致：第一条深藏青，其余强调橙）。 */
const IMAGE_COLORS = ['#16233A', '#C4622D', '#C4622D'] as const;

const GHOST = '#93A1B8';
const AXIS = '#8B9AB3';
const ORANGE = '#C4622D';
const NAVY = '#16233A';
const BG = '#F6F3EC';

/** 原像标注向内偏移（SVG px）、像标注向外偏移（SVG px）。 */
const INWARD_OFFSET = 32;
const OUTWARD_OFFSET = 30;
/** 倍数标注相对像向量的位置（60%）与法向外移量。 */
const SCALE_AT = 0.6;
const SCALE_OFFSET = 26;
/** 拖动端点时的参数吸附步长：与 scene.clampParam 的 0.1 一致。 */
const DRAG_EPS = 1e-9;

export interface MatrixEigenSceneProps {
  cs: RegionCoordinateSystem;
  matrix: Mat2;
  vectors: Vec2[];
  /** 0 原像 / 1 变换中 / 2 完成 */
  stage: 0 | 1 | 2;
  reducedMotion: boolean;
  /** viewBox 宽度对应的屏幕像素宽度，用于判断刻度数字是否需要隔一个画。 */
  screenWidth: number;
  onVectorChange: (index: number, vector: Vec2) => void;
}

interface VectorGeometry {
  index: number;
  vector: Vec2;
  image: Vec2;
  /** `A·v ≈ v`：原像与像重合，§7.1 要求合并成一条线。 */
  fixed: boolean;
  /** 与向量共线的倍数（特征向量才有）；`null` 表示不是特征方向。 */
  scale: number | null;
  /** 像向量的屏幕端点（必要时裁剪到 viewBox 内）。 */
  imageEnd: { x: number; y: number; clipped: boolean };
}

/** 屏幕坐标单位化；长度过小时返回 null。 */
function unitScreen(from: [number, number], to: [number, number]): [number, number] | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return [dx / length, dy / length];
}

/** 依据方向选择 text-anchor，让文字始终"贴"在端点外侧而不是压住线。 */
function anchorFor(dx: number): TextAnchor {
  if (dx > 0.35) return 'start';
  if (dx < -0.35) return 'end';
  return 'middle';
}

function toneColor(tone: PlacedLabel['tone']): string {
  switch (tone) {
    case 'image':
      return NAVY;
    case 'ghost':
      return '#8B97AB';
    case 'scale':
      return ORANGE;
    case 'merged':
      return NAVY;
    case 'tick':
      return '#8B97AB';
    case 'meta':
      return '#6F7F99';
    default:
      return NAVY;
  }
}

export function MatrixEigenScene(props: MatrixEigenSceneProps): ReactElement {
  const { cs: rawCs, matrix, vectors, stage, reducedMotion, screenWidth, onVectorChange } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndex = useRef<number | null>(null);

  /**
   * 内容包围盒自检：参数取极值时椭圆 / 像向量会远超区域，等比缩小 `unit`（原点不动），
   * 避免图形被 viewBox 裁掉一半。默认参数下 scale=1，尺寸与原页一致。
   */
  const fit = useMemo(() => {
    const points: Vec2[] = [...vectors, ...vectors.map((item) => applyMatrix(matrix, item))];
    points.push(...ellipseMathPoints(matrix, 96));
    return fitToViewBox(rawCs, rawCs.view_box, points);
  }, [rawCs, vectors, matrix]);

  /** 后续所有投影统一使用缩放后的坐标系（`fit.scale === 1` 时就是原坐标系）。 */
  const cs = useMemo(
    () => (fit.scale === 1 ? rawCs : { ...rawCs, unit: fit.unit }),
    [rawCs, fit],
  );

  /** reducedMotion 时直接按"完成态"渲染（§10：无过渡但数值即时更新）。 */
  const effectiveStage: 0 | 1 | 2 = reducedMotion ? 2 : stage;
  /** 0 / 0.6 / 1：变换过程的可视进度。 */
  const progress = effectiveStage === 0 ? 0 : effectiveStage === 1 ? 0.6 : 1;
  const completed = effectiveStage === 2;

  const viewBox = cs.view_box;
  const [originX, originY] = cs.origin;

  const geometry = useMemo<VectorGeometry[]>(() => {
    return vectors.map((vector, index) => {
      const rawImage = applyMatrix(matrix, vector);
      const end = project(cs, [rawImage[0] * progress, rawImage[1] * progress]);
      const clipped = clipFromOrigin(cs, viewBox, end);
      return {
        index,
        vector,
        image: rawImage,
        fixed: isFixedVector(matrix, vector),
        scale: eigenScale(matrix, vector),
        imageEnd: clipped,
      };
    });
  }, [vectors, matrix, cs, viewBox, progress]);

  /** 单位圆半径（像素）：与 unit 一致，保证 1 个数学单位 = 1 个圆半径。 */
  const unitRadius = cs.unit;

  /* ---------------------------- 标注布局 ---------------------------- */

  const placedLabels = useMemo<PlacedLabel[]>(() => {
    const requests: LabelRequest[] = [];
    const originScreen = project(cs, [0, 0]);

    /** 原像标注：贴端点内侧（朝原点）+ 法向轻移，避开线段本身。 */
    for (const item of geometry) {
      // 固定向量在完成态合并显示，原像标注不再单独出现（§7.1）
      if (completed && item.fixed) continue;
      if (progress > 0 && item.fixed) continue;
      const end = project(cs, item.vector);
      const inward = unitScreen(end, originScreen) ?? [0, 1];
      const normal = normalOf(item.vector);
      const nScreen: [number, number] = [normal[0], -normal[1]];
      const x = end[0] + inward[0] * INWARD_OFFSET + nScreen[0] * 20;
      const y = end[1] + inward[1] * INWARD_OFFSET + nScreen[1] * 20 + 8;
      const anchor = anchorFor(inward[0]);
      requests.push({
        id: `ghost-${item.index}`,
        text: fmtVec(item.vector),
        fontSize: 23,
        priority: 3,
        tone: 'ghost',
        anchor,
        x,
        y,
        alternatives: [
          { x: x, y: y + (inward[1] >= 0 ? -26 : 26), anchor },
          { x: end[0] - inward[0] * INWARD_OFFSET, y: end[1] - inward[1] * INWARD_OFFSET, anchor },
        ],
      });
    }

    /** 像标注：贴箭头外侧；固定向量合并为 `(1, -1) 不动 ×1`。 */
    for (const item of geometry) {
      if (progress === 0) continue;
      const end = item.imageEnd;
      const outward = unitScreen(originScreen, [end.x, end.y]) ?? [1, 0];
      const x = end.x + outward[0] * OUTWARD_OFFSET;
      const y = end.y + outward[1] * OUTWARD_OFFSET + 8;
      const anchor = anchorFor(outward[0]);

      if (item.fixed && completed) {
        // 合并标注是唯一的"结果 + 倍数"载体，额外外移，避免贴住箭头尖端
        const mergedX = end.x + outward[0] * 36;
        const mergedY = end.y + outward[1] * 36 + 14;
        requests.push({
          id: `merged-${item.index}`,
          text: `${fmtVec(item.vector)} 不动 ×${fmt(item.scale ?? 1)}`,
          fontSize: 25,
          priority: 1,
          tone: 'merged',
          anchor,
          x: mergedX,
          y: mergedY,
          alternatives: [
            { x: mergedX, y: mergedY + 34, anchor },
            { x: end.x - outward[0] * 36, y: end.y - outward[1] * 36 + 10, anchor },
          ],
        });
        continue;
      }

      requests.push({
        id: `image-${item.index}`,
        text: fmtVec([item.image[0] * progress, item.image[1] * progress]),
        fontSize: 26,
        priority: 2,
        tone: 'image',
        anchor,
        x,
        y,
        alternatives: [
          { x, y: y + 36, anchor },
          { x: end.x - outward[0] * 30, y: end.y - outward[1] * 30 + 8, anchor },
        ],
      });
    }

    /** 倍数标注：像向量 60% 处的外侧，带背景描边（§7.1）。 */
    if (completed) {
      for (const item of geometry) {
        if (item.scale === null || item.fixed) continue;
        const beforeClip = project(cs, [
          item.image[0] * SCALE_AT,
          item.image[1] * SCALE_AT,
        ]);
        const anchorPoint = clipFromOrigin(cs, viewBox, beforeClip, 28);
        const base = project(cs, [item.image[0], item.image[1]]);
        const dir = unitScreen(originScreen, base) ?? [1, 0];
        // 屏幕法向：取指向画布上方的一侧，避免压到 x 轴刻度数字
        let nx = dir[1];
        let ny = -dir[0];
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }
        requests.push({
          id: `scale-${item.index}`,
          text: `×${fmt(item.scale)}`,
          fontSize: 25,
          priority: 1,
          tone: 'scale',
          anchor: anchorFor(nx),
          x: anchorPoint.x + nx * SCALE_OFFSET,
          y: anchorPoint.y + ny * SCALE_OFFSET + 8,
          alternatives: [
            { x: anchorPoint.x - nx * SCALE_OFFSET, y: anchorPoint.y - ny * SCALE_OFFSET + 8, anchor: anchorFor(-nx) },
          ],
        });
      }
    }

    /** 两条"参考图形"说明（原页本来就有的文字，位置沿用原型）。 */
    requests.push({
      id: 'unit-circle',
      text: '单位圆',
      fontSize: 26,
      priority: 4,
      tone: 'meta',
      anchor: 'end',
      x: originX - unitRadius - 20,
      y: originY + 8,
      alternatives: [{ x: originX - unitRadius - 20, y: originY - 24, anchor: 'end' }],
    });
    if (progress > 0) {
      requests.push({
        id: 'ellipse',
        text: '变换后：椭圆',
        fontSize: 25,
        priority: 4,
        tone: 'scale',
        anchor: 'start',
        x: Math.min(viewBox[0] - 240, originX + unitRadius * 2.6),
        y: Math.min(viewBox[1] - 100, originY + unitRadius * 2.4),
        alternatives: [
          {
            x: Math.min(viewBox[0] - 240, originX + unitRadius * 2.2),
            y: Math.min(viewBox[1] - 60, originY + unitRadius * 2.9),
            anchor: 'start',
          },
        ],
      });
    }

    /** 刻度数字：间距 < 28px 时隔一个画（§7.1）；冲突时由 layoutLabels 隐藏。 */
    const maxTickWidth = measureText('-3', 20);
    const skipAlternate = shouldSkipAlternateTicks(cs.unit, maxTickWidth, {
      estimatedScreenGap: (screenWidth / Math.max(1, viewBox[0])) * cs.unit,
    });
    for (const tick of buildTicks(cs, viewBox, 26)) {
      if (skipAlternate && Math.abs(tick.value) % 2 === 0) continue;
      requests.push({
        id: `tick-${tick.horizontal ? 'x' : 'y'}-${tick.value}`,
        text: String(tick.value),
        fontSize: 20,
        priority: 5,
        tone: 'tick',
        anchor: tick.horizontal ? 'middle' : 'end',
        x: tick.horizontal ? tick.x : tick.x - 14,
        y: tick.horizontal ? tick.y + 42 : tick.y + 7,
      });
    }

    /** 自动缩放提示：优先级 1，不允许被隐藏（参数取极值时必须告知用户） */
    if (fit.scaled) {
      requests.push({
        id: 'fit-note',
        text: `图示已超出区域，已自动缩放 ×${fmt(fit.scale)}`,
        fontSize: 22,
        priority: 1,
        tone: 'meta',
        anchor: 'start',
        x: 28,
        y: 44,
      });
    }

    return layoutLabels(requests, viewBox);
  }, [geometry, completed, progress, cs, viewBox, originX, originY, unitRadius, screenWidth, fit]);

  const labelById = useMemo(() => {
    const map = new Map<string, PlacedLabel>();
    for (const label of placedLabels) map.set(label.id, label);
    return map;
  }, [placedLabels]);

  /** 屏幕坐标 → 数学坐标（含 preserveAspectRatio 的 letterbox 补偿）。 */
  const toMathPoint = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const svg = svgRef.current;
      if (svg === null) return [0, 0];
      const rect = svg.getBoundingClientRect();
      const [viewWidth, viewHeight] = viewBox;
      const scale = Math.min(rect.width / viewWidth, rect.height / viewHeight);
      if (!Number.isFinite(scale) || scale <= 0) return [0, 0];
      const offsetX = (rect.width - viewWidth * scale) / 2;
      const offsetY = (rect.height - viewHeight * scale) / 2;
      const px = (clientX - rect.left - offsetX) / scale;
      const py = (clientY - rect.top - offsetY) / scale;
      return clampVector(unproject(cs, px, py));
    },
    [cs, viewBox],
  );

  const handlePointerDown = useCallback(
    (index: number) =>
      (event: ReactPointerEvent<SVGCircleElement>): void => {
        dragIndex.current = index;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const index = dragIndex.current;
      if (index === null) return;
      const next = toMathPoint(event.clientX, event.clientY);
      const current = vectors[index];
      if (current !== undefined && Math.abs(next[0] - current[0]) < DRAG_EPS && Math.abs(next[1] - current[1]) < DRAG_EPS) {
        return;
      }
      onVectorChange(index, next);
    },
    [onVectorChange, toMathPoint, vectors],
  );

  const handlePointerUp = useCallback((): void => {
    dragIndex.current = null;
  }, []);

  /** 键盘微调：焦点在端点手柄时用方向键修改参数（走同一个 onChange 出口）。 */
  const handleKeyDown = useCallback(
    (index: number) =>
      (event: KeyboardEvent<SVGCircleElement>): void => {
        const step = event.shiftKey ? 0.5 : 0.1;
        const current = vectors[index] ?? [0, 0];
        let next: Vec2 | null = null;
        if (event.key === 'ArrowLeft') next = [current[0] - step, current[1]];
        else if (event.key === 'ArrowRight') next = [current[0] + step, current[1]];
        else if (event.key === 'ArrowUp') next = [current[0], current[1] + step];
        else if (event.key === 'ArrowDown') next = [current[0], current[1] - step];
        if (next === null) return;
        event.preventDefault();
        onVectorChange(index, clampVector(next));
      },
    [onVectorChange, vectors],
  );

  const renderLabel = (label: PlacedLabel | undefined): ReactElement | null => {
    if (label === undefined || label.hidden) return null;
    const isScale = label.tone === 'scale';
    const stroke = isScale || label.tone === 'merged' ? BG : undefined;
    return (
      <text
        key={label.id}
        x={label.x}
        y={label.y}
        textAnchor={label.anchor}
        fontSize={label.fontSize}
        fontWeight={600}
        fill={toneColor(label.tone)}
        stroke={stroke}
        strokeWidth={stroke === undefined ? undefined : 5}
        paintOrder={stroke === undefined ? undefined : 'stroke'}
        strokeLinejoin={stroke === undefined ? undefined : 'round'}
        className={styles.label}
      >
        {label.text}
      </text>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={styles.svg}
      viewBox={`0 0 ${viewBox[0]} ${viewBox[1]}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="矩阵作用在三条向量上：浅色虚线为原向量，深色实线为变换后的像，可拖动端点或调参数"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-stage={String(effectiveStage)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <defs>
        <marker id="me-arw-axis" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={AXIS} />
        </marker>
        <marker id="me-arw-navy" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={NAVY} />
        </marker>
        <marker id="me-arw-orange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={ORANGE} />
        </marker>
        <marker id="me-arw-ghost" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={GHOST} />
        </marker>
      </defs>

      {/* 1. 坐标轴 + 刻度刻线（数字在下方统一布局） */}
      <g className={styles.axis} stroke={AXIS} strokeWidth={1.8} fill="none">
        <line x1={24} y1={originY} x2={viewBox[0] - 40} y2={originY} markerEnd="url(#me-arw-axis)" />
        <line x1={originX} y1={viewBox[1] - 24} x2={originX} y2={30} markerEnd="url(#me-arw-axis)" />
        <g data-layer="tick-marks">
          {buildTicks(cs, viewBox, 26).map((tick) => (
            <line
              key={`mark-${tick.horizontal ? 'x' : 'y'}-${tick.value}`}
              x1={tick.horizontal ? tick.x : tick.x - 9}
              y1={tick.horizontal ? tick.y - 9 : tick.y}
              x2={tick.horizontal ? tick.x : tick.x + 9}
              y2={tick.horizontal ? tick.y + 9 : tick.y}
              strokeWidth={1.8}
            />
          ))}
        </g>
      </g>

      {/* 2. 原点实心点 */}
      <circle cx={originX} cy={originY} r={5} fill={NAVY} />

      {/* 3. 单位圆（虚线） */}
      <circle
        cx={originX}
        cy={originY}
        r={unitRadius}
        fill="none"
        stroke="#9FADC2"
        strokeWidth={2.2}
        strokeDasharray="9 7"
        opacity={0.9}
      />

      {/* 4. 变换后的椭圆：progress=0 时不渲染，1 时满色 */}
      {progress > 0 ? (
        <path
          data-layer="ellipse"
          d={ellipsePath(
            {
              a11: matrix.a11 * progress,
              a12: matrix.a12 * progress,
              a21: matrix.a21 * progress,
              a22: matrix.a22 * progress,
            },
            cs,
          )}
fill={ORANGE}
          stroke={ORANGE}
          strokeWidth={3.2}
          strokeOpacity={progress}
          fillOpacity={0.055 * progress}
        />
      ) : null}

      {/* 5. 原像：虚线 + 端点 + 浅色标注（固定向量在完成态合并，只留一条线） */}
      <g data-layer="ghost-vectors" stroke={GHOST} strokeWidth={3.2} fill="none" strokeDasharray="9 8" opacity={0.95}>
        {geometry
          .filter((item) => !(completed && item.fixed))
          .map((item) => {
            const end = project(cs, item.vector);
            return (
              <g key={`ghost-${item.index}`}>
                <line
                  data-role="ghost-line"
                  data-index={item.index}
                  x1={originX}
                  y1={originY}
                  x2={end[0]}
                  y2={end[1]}
                />
                {/* 端点实心点：让"三条原向量"在虚线圆上依然可辨 */}
                <circle cx={end[0]} cy={end[1]} r={5} fill="#8B97AB" stroke="none" />
              </g>
            );
          })}
      </g>

      {/* 6. 像向量：实线 + 箭头（stage 0 不渲染） */}
      <g data-layer="image-vectors" strokeWidth={3.2} fill="none" opacity={progress === 0 ? 0 : 1}>
        {progress > 0
          ? geometry.map((item) => {
              const color = IMAGE_COLORS[item.index] ?? ORANGE;
              const marker = item.index === 0 ? 'url(#me-arw-navy)' : 'url(#me-arw-orange)';
              const end = item.imageEnd;
              return (
                <line
                  key={`image-${item.index}`}
                  data-role="image-line"
                  data-index={item.index}
                  data-ghost-merged={item.fixed && completed ? 'true' : undefined}
                  x1={originX}
                  y1={originY}
                  x2={end.x}
                  y2={end.y}
                  stroke={color}
                  markerEnd={marker}
                />
              );
            })
          : null}
      </g>

      {/* 7. 原向量端点（拖动热区） */}
      <g data-layer="handles">
        {geometry.map((item) => {
          const end = project(cs, item.vector);
          return (
            <g key={`handle-${item.index}`}>
              <circle cx={end[0]} cy={end[1]} r={5} fill="#9FABBD" />
              <circle
                className={styles.handle}
                cx={end[0]}
                cy={end[1]}
                r={16}
                fill="transparent"
                role="slider"
                tabIndex={0}
                aria-label={`拖动向量 ${item.index + 1} 的端点，当前 ${fmtVec(item.vector)}`}
                aria-valuetext={fmtVec(item.vector)}
                data-role="vector-handle"
                data-index={item.index}
                onPointerDown={handlePointerDown(item.index)}
                onKeyDown={handleKeyDown(item.index)}
              />
            </g>
          );
        })}
      </g>

      {/* 8. 标注层（全部经 layoutLabels 防重叠 / 防出界） */}
      <g data-layer="labels" className={styles.labels}>
        {placedLabels.map((label) => renderLabel(label))}
        {labelById.size === 0 ? null : null}
      </g>
    </svg>
  );
}

/** 便于测试与调试：把向量格式化后的文本（与 SVG 内一致）。 */
export function vectorLabel(vector: Vec2): string {
  return fmtVec(vector);
}

/** 便于测试：判断某条向量在当前矩阵下是否需要合并标注。 */
export function shouldMergeVector(matrix: Mat2, vector: Vec2): boolean {
  return isFixedVector(matrix, vector);
}

/** 便于测试：特征倍数文本（`×3`）。 */
export function scaleLabel(scale: number | null): string {
  return scale === null ? '' : `×${fmt(scale)}`;
}