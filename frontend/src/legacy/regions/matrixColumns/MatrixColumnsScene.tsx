/**
 * matrixColumns/MatrixColumnsScene.tsx —— S9 动态层（SVG）渲染。
 *
 * 图层：坐标轴/刻度 → 基 e₁ e₂（浅虚线）→ 矩阵两列（= 基的像，实线可拖）→ 输入向量 v
 * → 组合过程（stage 1：v₁·col₁；stage 2：加上 v₂·col₂ 与合向量 A·v）→ 退化说明。
 *
 * §7.1 防遮挡：原像（v / e）标注贴内侧，像（列）标注贴箭头外侧；所有文字过 `layoutLabels`，
 * 包围盒互斥且不出 viewBox，冲突时先隐藏刻度数字。
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
  buildColumnsModel,
  buildTicks,
  clampVector,
  clipFromOrigin,
  cross,
  degenerationNotice,
  fitToViewBox,
  fmt,
  fmtVec,
  isZeroVector,
  layoutLabels,
  measureText,
  projectPoint,
  shouldSkipAlternateTicks,
  unproject,
  type ColumnsModel,
  type LabelRequest,
  type Mat2,
  type PlacedLabel,
  type TextAnchor,
  type Vec2,
} from './scene';
import styles from './matrixColumns.module.css';

const AXIS = '#8B9AB3';
const ORANGE = '#C4622D';
const NAVY = '#16233A';
const GHOST = '#93A1B8';
const BG = '#F6F3EC';

const OUTWARD = 36;
const INWARD = 20;
const DRAG_EPS = 1e-9;

export interface MatrixColumnsSceneProps {
  cs: RegionCoordinateSystem;
  matrix: Mat2;
  vector: Vec2;
  stage: 0 | 1 | 2;
  reducedMotion: boolean;
  screenWidth: number;
  onColumnChange: (index: 0 | 1, vector: Vec2) => void;
}

function unitScreen(from: [number, number], to: [number, number]): [number, number] | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return [dx / length, dy / length];
}

function anchorFor(dx: number): TextAnchor {
  if (dx > 0.35) return 'start';
  if (dx < -0.35) return 'end';
  return 'middle';
}

function toneColor(tone: PlacedLabel['tone']): string {
  switch (tone) {
    case 'column':
      return NAVY;
    case 'basis':
      return '#7C8AA3';
    case 'input':
      return '#6F7F99';
    case 'compose':
      return ORANGE;
    case 'meta':
      return '#5B6678';
    case 'tick':
      return '#7C8AA3';
    default:
      return NAVY;
  }
}

export function MatrixColumnsScene(props: MatrixColumnsSceneProps): ReactElement {
  const { cs: rawCs, matrix, vector, stage, reducedMotion, screenWidth, onColumnChange } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndex = useRef<0 | 1 | null>(null);

  const model = useMemo<ColumnsModel>(() => buildColumnsModel(matrix, vector), [matrix, vector]);
  const effectiveStage: 0 | 1 | 2 = reducedMotion ? 2 : stage;

  /**
   * 内容包围盒自检：极值参数下两列 / 合向量会超出区域，等比缩小 `unit`（原点不动），
   * 避免图形被裁掉一半。默认参数下 scale=1。
   */
  const fit = useMemo(() => {
    const points: Vec2[] = [
      model.col1,
      model.col2,
      vector,
      model.scaled1,
      model.scaled2,
      model.image,
    ];
    return fitToViewBox(rawCs, rawCs.view_box, points);
  }, [rawCs, model, vector]);

  const cs = useMemo(
    () => (fit.scale === 1 ? rawCs : { ...rawCs, unit: fit.unit }),
    [rawCs, fit],
  );

  const notice = degenerationNotice(model);

  const viewBox = cs.view_box;
  const [originX, originY] = cs.origin;
  const originScreen = projectPoint(cs, 0, 0);

  const columns = useMemo(() => {
    return [model.col1, model.col2].map((column, index) => {
      const end = clipFromOrigin(cs, viewBox, projectPoint(cs, column[0], column[1]));
      return { index: index as 0 | 1, column, end, zero: isZeroVector(column) };
    });
  }, [model, cs, viewBox]);

  /**
   * stage=0 也要看得见"矩阵两列 = 基的去向"这个核心信息，因此列线始终渲染，
   * 但 stage=0 时降到低透明度（不抢输入向量的视线）；只有可拖手柄在 stage≥1 才出现。
   */
  const visibleColumns = columns;
  const columnOpacity = effectiveStage >= 1 ? 1 : 0.32;
  const showHandles = effectiveStage >= 1;

  const composed = useMemo(() => {
    const first = clipFromOrigin(cs, viewBox, projectPoint(cs, model.scaled1[0], model.scaled1[1]));
    const sum = clipFromOrigin(cs, viewBox, projectPoint(cs, model.image[0], model.image[1]));
    const secondStart = projectPoint(cs, model.scaled1[0], model.scaled1[1]);
    const second = clipFromOrigin(cs, viewBox, projectPoint(cs, model.image[0], model.image[1]));
    return { first, sum, secondStart, second };
  }, [model, cs, viewBox]);

  /* ---------------------------- 标注布局 ---------------------------- */

  const placedLabels = useMemo<PlacedLabel[]>(() => {
    const requests: LabelRequest[] = [];

    // 基向量 e₁/e₂：贴端点内侧（朝原点）
    [model.col1, model.col2].forEach((column, index) => {
      const basis: Vec2 = index === 0 ? [1, 0] : [0, 1];
      const end = projectPoint(cs, basis[0], basis[1]);
      const inward = unitScreen(end, originScreen) ?? [0, 1];
      const label = index === 0 ? 'e₁' : 'e₂';
      requests.push({
        id: `basis-${index}`,
        text: label,
        fontSize: 24,
        priority: 4,
        tone: 'basis',
        anchor: anchorFor(inward[0]),
        x: end[0] + inward[0] * INWARD,
        y: end[1] + inward[1] * INWARD + 8,
        alternatives: [{ x: end[0], y: end[1] - 16, anchor: 'middle' }],
      });
    });

    // 矩阵两列：贴箭头外侧，文字带列号与坐标
    visibleColumns.forEach((item) => {
      const outward = unitScreen(originScreen, [item.end.x, item.end.y]) ?? [1, 0];
      const name = item.index === 0 ? 'col₁' : 'col₂';
      requests.push({
        id: `column-${item.index}`,
        text: item.zero ? `${name} = (0, 0)` : `${name} ${fmtVec(item.column)}`,
        fontSize: 25,
        priority: 2,
        tone: 'column',
        anchor: anchorFor(outward[0]),
        x: item.end.x + outward[0] * OUTWARD,
        y: item.end.y + outward[1] * OUTWARD + 8,
        alternatives: [
          { x: item.end.x + outward[0] * OUTWARD, y: item.end.y + outward[1] * OUTWARD + 40, anchor: anchorFor(outward[0]) },
          { x: item.end.x - outward[0] * 30, y: item.end.y - outward[1] * 30 + 8, anchor: anchorFor(-outward[0]) },
        ],
      });
    });

    // 输入向量 v：贴端点内侧
    {
      const end = projectPoint(cs, vector[0], vector[1]);
      const inward = unitScreen(end, originScreen) ?? [0, 1];
      requests.push({
        id: 'input-v',
        text: `v ${fmtVec(vector)}`,
        fontSize: 25,
        priority: 3,
        tone: 'input',
        anchor: anchorFor(inward[0]),
        x: end[0] + inward[0] * INWARD,
        y: end[1] + inward[1] * INWARD + 8,
        alternatives: [{ x: end[0] - inward[0] * 26, y: end[1] - inward[1] * 26 + 8, anchor: anchorFor(-inward[0]) }],
      });
    }

    // 组合过程说明（stage ≥ 1）
    if (effectiveStage >= 1 && !isZeroVector(model.scaled1)) {
      const mid = projectPoint(cs, model.scaled1[0] / 2, model.scaled1[1] / 2);
      const dir = unitScreen(originScreen, mid) ?? [1, 0];
      let nx = dir[1];
      let ny = -dir[0];
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      requests.push({
        id: 'compose-1',
        text: `v₁·col₁ = ${fmtVec(model.scaled1)}`,
        fontSize: 22,
        priority: 2,
        tone: 'compose',
        anchor: anchorFor(nx),
        x: mid[0] + nx * 30,
        y: mid[1] + ny * 30 + 8,
        alternatives: [{ x: mid[0] - nx * 30, y: mid[1] - ny * 30 + 8, anchor: anchorFor(-nx) }],
      });
    }
    if (effectiveStage >= 2 && !isZeroVector(model.scaled2)) {
      const mid = projectPoint(cs, (model.scaled1[0] + model.image[0]) / 2, (model.scaled1[1] + model.image[1]) / 2);
      const dir = unitScreen(originScreen, mid) ?? [0, 1];
      let nx = dir[1];
      let ny = -dir[0];
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      requests.push({
        id: 'compose-2',
        text: `v₂·col₂ = ${fmtVec(model.scaled2)}`,
        fontSize: 22,
        priority: 2,
        tone: 'column',
        anchor: anchorFor(nx),
        x: mid[0] + nx * 30,
        y: mid[1] + ny * 30 + 8,
        alternatives: [{ x: mid[0] - nx * 30, y: mid[1] - ny * 30 + 8, anchor: anchorFor(-nx) }],
      });
    }
    if (effectiveStage >= 2) {
      const outward = unitScreen(originScreen, [composed.sum.x, composed.sum.y]) ?? [1, 0];
      requests.push({
        id: 'compose-sum',
        text: `A·v = ${fmtVec(model.image)}`,
        fontSize: 26,
        priority: 1,
        tone: 'compose',
        anchor: anchorFor(outward[0]),
        x: composed.sum.x + outward[0] * OUTWARD,
        y: composed.sum.y + outward[1] * OUTWARD + 8,
        alternatives: [
          { x: composed.sum.x + outward[0] * OUTWARD, y: composed.sum.y + outward[1] * OUTWARD + 42, anchor: anchorFor(outward[0]) },
          { x: composed.sum.x - outward[0] * 34, y: composed.sum.y - outward[1] * 34 + 8, anchor: anchorFor(-outward[0]) },
        ],
      });
    }

    // 公式注记（固定位置，冲突时让位）
    requests.push({
      id: 'formula',
      text: 'A·v = v₁·col₁ + v₂·col₂',
      fontSize: 24,
      priority: 4,
      tone: 'meta',
      anchor: 'start',
      x: originX - cs.unit * 3.4,
      y: viewBox[1] - 44,
      alternatives: [{ x: originX - cs.unit * 3.2, y: viewBox[1] - 96, anchor: 'start' }],
    });

    // 退化文案：固定位置，优先级最高（教学结论不能被隐藏）
    if (notice !== null) {
      requests.push({
        id: 'degenerate',
        text: notice,
        fontSize: 24,
        priority: 1,
        tone: 'meta',
        anchor: 'start',
        x: originX - cs.unit * 3.4,
        y: viewBox[1] - 92,
      });
    }

    // 刻度数字：间距 < 28px 时隔一个画
    const maxTickWidth = measureText('-3', 20);
    const skipAlternate = shouldSkipAlternateTicks(
      (screenWidth / Math.max(1, viewBox[0])) * cs.unit,
      maxTickWidth,
      cs.unit,
    );
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
  }, [model, columns, vector, composed, effectiveStage, notice, cs, viewBox, originX, screenWidth, fit]);

  /* ------------------------------ 拖动 ------------------------------ */

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
      return clampVector(
        unproject(cs, (clientX - rect.left - offsetX) / scale, (clientY - rect.top - offsetY) / scale),
      );
    },
    [cs, viewBox],
  );

  const handlePointerDown = useCallback(
    (index: 0 | 1) =>
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
      const current = index === 0 ? model.col1 : model.col2;
      if (Math.abs(next[0] - current[0]) < DRAG_EPS && Math.abs(next[1] - current[1]) < DRAG_EPS) return;
      onColumnChange(index, next);
    },
    [model, onColumnChange, toMathPoint],
  );

  const handlePointerUp = useCallback((): void => {
    dragIndex.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (index: 0 | 1) =>
      (event: KeyboardEvent<SVGCircleElement>): void => {
        const step = event.shiftKey ? 0.5 : 0.1;
        const current = index === 0 ? model.col1 : model.col2;
        let next: Vec2 | null = null;
        if (event.key === 'ArrowLeft') next = [current[0] - step, current[1]];
        else if (event.key === 'ArrowRight') next = [current[0] + step, current[1]];
        else if (event.key === 'ArrowUp') next = [current[0], current[1] + step];
        else if (event.key === 'ArrowDown') next = [current[0], current[1] - step];
        if (next === null) return;
        event.preventDefault();
        onColumnChange(index, clampVector(next));
      },
    [model, onColumnChange],
  );

  const renderLabel = (label: PlacedLabel): ReactElement | null => {
    if (label.hidden) return null;
    const outlined = label.tone === 'compose' || label.id === 'degenerate';
    return (
      <text
        key={label.id}
        x={label.x}
        y={label.y}
        textAnchor={label.anchor}
        fontSize={label.fontSize}
        fontWeight={600}
        fill={toneColor(label.tone)}
        stroke={outlined ? BG : undefined}
        strokeWidth={outlined ? 5 : undefined}
        paintOrder={outlined ? 'stroke' : undefined}
        strokeLinejoin={outlined ? 'round' : undefined}
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
      aria-label="矩阵的两列决定空间去向：拖动两列的箭头可反推矩阵，调整输入向量可见 v₁·col₁ + v₂·col₂"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-stage={String(effectiveStage)}
      data-rank={String(model.rank)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <defs>
        <marker id="mc-arw-axis" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={AXIS} />
        </marker>
        <marker id="mc-arw-ghost" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={GHOST} />
        </marker>
        <marker id="mc-arw-orange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={ORANGE} />
        </marker>
        <marker id="mc-arw-navy" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={NAVY} />
        </marker>
      </defs>

      {/* 1. 坐标轴 + 刻度刻线 */}
      <g stroke={AXIS} strokeWidth={1.8} fill="none">
        <line x1={24} y1={originY} x2={viewBox[0] - 40} y2={originY} markerEnd="url(#mc-arw-axis)" />
        <line x1={originX} y1={viewBox[1] - 24} x2={originX} y2={30} markerEnd="url(#mc-arw-axis)" />
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
      <circle cx={originX} cy={originY} r={5} fill={NAVY} />

      {/* 2. 基向量 e₁ / e₂（原像，浅虚线） */}
      <g data-layer="basis" stroke={GHOST} strokeWidth={2.4} fill="none" strokeDasharray="8 7" opacity={0.95}>
        {[0, 1].map((index) => {
          const end = projectPoint(cs, index === 0 ? 1 : 0, index === 0 ? 0 : 1);
          return (
            <line
              key={`basis-${index}`}
              data-role="basis-line"
              x1={originX}
              y1={originY}
              x2={end[0]}
              y2={end[1]}
              markerEnd="url(#mc-arw-ghost)"
            />
          );
        })}
      </g>

      {/* 3. 输入向量 v（原像，浅虚线） */}
      <g data-layer="input" stroke="#7F8DA3" strokeWidth={3.2} fill="none" strokeDasharray="9 8">
        <line
          data-role="input-line"
          x1={originX}
          y1={originY}
          x2={projectPoint(cs, vector[0], vector[1])[0]}
          y2={projectPoint(cs, vector[0], vector[1])[1]}
          markerEnd="url(#mc-arw-ghost)"
        />
      </g>
      <circle
        cx={projectPoint(cs, vector[0], vector[1])[0]}
        cy={projectPoint(cs, vector[0], vector[1])[1]}
        r={4.5}
        fill="#7F8DA3"
      />

      {/* 4. 矩阵两列（= 基的像，实线可拖） */}
      <g data-layer="columns" strokeWidth={3.2} fill="none" opacity={columnOpacity}>
        {visibleColumns.map((item) => (
          <line
            key={`column-${item.index}`}
            data-role="column-line"
            data-index={item.index}
            x1={originX}
            y1={originY}
            x2={item.end.x}
            y2={item.end.y}
            stroke={item.index === 0 ? ORANGE : NAVY}
            markerEnd={item.index === 0 ? 'url(#mc-arw-orange)' : 'url(#mc-arw-navy)'}
          />
        ))}
      </g>

      {/* 5. 组合过程：v₁·col₁（stage ≥ 1） */}
      {effectiveStage >= 1 && !isZeroVector(model.scaled1) ? (
        <g data-layer="composition" strokeWidth={3.2} fill="none">
          <line
            data-role="compose-first"
            x1={originX}
            y1={originY}
            x2={composed.first.x}
            y2={composed.first.y}
            stroke={ORANGE}
            markerEnd="url(#mc-arw-orange)"
            strokeDasharray="14 7"
          />
        </g>
      ) : null}

      {/* 6. 组合过程：v₂·col₂ 与合向量（stage = 2） */}
      {effectiveStage >= 2 ? (
        <g data-layer="composition-sum" strokeWidth={3.2} fill="none">
          {!isZeroVector(model.scaled2) ? (
            <line
              data-role="compose-second"
              x1={composed.secondStart[0]}
              y1={composed.secondStart[1]}
              x2={composed.second.x}
              y2={composed.second.y}
              stroke={NAVY}
              markerEnd="url(#mc-arw-navy)"
              strokeDasharray="14 7"
            />
          ) : null}
          <line
            data-role="compose-sum"
            x1={originX}
            y1={originY}
            x2={composed.sum.x}
            y2={composed.sum.y}
            stroke={ORANGE}
            strokeWidth={4.4}
            markerEnd="url(#mc-arw-orange)"
          />
          <circle cx={composed.sum.x} cy={composed.sum.y} r={5.5} fill={ORANGE} />
        </g>
      ) : null}

      {/* 7. 列端点手柄（拖动反推矩阵列） */}
      <g data-layer="handles">
        {(showHandles ? visibleColumns : []).map((item) => {
          const point = projectPoint(cs, item.column[0], item.column[1]);
          return (
            <g key={`handle-${item.index}`}>
              <circle cx={point[0]} cy={point[1]} r={5} fill={item.index === 0 ? ORANGE : NAVY} />
              <circle
                className={styles.handle}
                cx={point[0]}
                cy={point[1]}
                r={16}
                fill="transparent"
                role="slider"
                tabIndex={0}
                aria-label={`拖动 col${item.index === 0 ? '₁' : '₂'} 的像，当前 ${fmtVec(item.column)}`}
                aria-valuetext={fmtVec(item.column)}
                data-role="column-handle"
                data-index={item.index}
                onPointerDown={handlePointerDown(item.index)}
                onKeyDown={handleKeyDown(item.index)}
              />
            </g>
          );
        })}
      </g>

      {/* 8. 标注层 */}
      <g data-layer="labels" className={styles.labels}>
        {placedLabels.map((label) => renderLabel(label))}
      </g>

    </svg>
  );
}

/** 便于测试：当前矩阵两列是否共线。 */
export function columnsCollinear(matrix: Mat2): boolean {
  return Math.abs(cross([matrix.a11, matrix.a21], [matrix.a12, matrix.a22])) <= 1e-7;
}

/** 便于测试：组合结果（A·v）。 */
export function composedImage(matrix: Mat2, vector: Vec2): Vec2 {
  return buildColumnsModel(matrix, vector).image;
}

/** 便于测试：`×` 之外的数值格式，供宿主日志使用。 */
export function formatValue(value: number): string {
  return fmt(value);
}