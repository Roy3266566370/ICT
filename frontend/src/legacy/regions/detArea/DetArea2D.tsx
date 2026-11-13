/**
 * det_area_2d —— S18「行列式与面积」原位动态组件。
 *
 * 职责（spec §9）：在原页四格位置连续演示 单位 / 拉伸 / 剪切 / 压缩（det=0）与翻转，
 * 面积 = |det|、定向 = sign(det) 随手柄拖动与 `stage` 播放实时更新。
 *
 * 三条硬约束：
 *  1. 退化安全：det≈0 时只画一条线并给出说明，绝不出现 NaN / 除零；
 *  2. `prefers-reduced-motion`：不走 rAF 插值，数值立即到位；
 *  3. 文字同步：把每格当前值通过 `onLinkedTexts` 回传，宿主负责原位覆盖并标"当前值"。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, RefObject } from 'react';
import type { CellId, CellState } from './model';
import {
  DEGENERATE_NOTE,
  PARAM_METAS,
  buildCells,
  buildLinkedTextValues,
  readNumericParam,
  visibleCellIds,
} from './model';
import {
  computeLayout,
  formatPoint,
  project,
  toPath,
  type CellLayout,
} from './layout';
import type { RegionRendererProps } from '@/regions/types';
import styles from './DetArea2D.module.css';

/* -------------------------------------------------------------------------- */
/* 手柄定义：拖哪个点 → 改哪个参数                                             */
/* -------------------------------------------------------------------------- */

interface DragHandle {
  key: string;
  /** 手柄的数学坐标 */
  x: number;
  y: number;
  /** 拖动哪个轴生效 */
  axis: 'x' | 'y';
  param: string;
  label: string;
  /** 把"拖动到的数学坐标"换算成参数值 */
  toValue: (mathX: number, mathY: number) => number;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function handlesFor(cell: CellState): DragHandle[] {
  const m = cell.matrix;
  switch (cell.id) {
    case 'unit':
      return [
        {
          key: 'unit-flip',
          x: m.a11,
          y: 0,
          axis: 'x',
          param: 'unit_flip',
          label: '拖动把手左右移动：向右为没翻，向左为翻过来',
          toValue: (mathX) => (mathX < 0 ? -1 : 1),
        },
      ];
    case 'stretch':
      return [
        {
          key: 'stretch-x',
          x: m.a11,
          y: 0,
          axis: 'x',
          param: 'stretch_x',
          label: '拖动横向倍率',
          toValue: (mathX) => clampValue(Math.abs(mathX), 0.4, 4),
        },
        {
          key: 'stretch-y',
          x: 0,
          y: m.a22,
          axis: 'y',
          param: 'stretch_y',
          label: '拖动纵向倍率',
          toValue: (_mathX, mathY) => clampValue(Math.abs(mathY), 0.4, 4),
        },
      ];
    case 'shear':
      return [
        {
          key: 'shear-k',
          x: 1,
          y: m.a12,
          axis: 'y',
          param: 'shear_k',
          label: '上下拖动改变剪切量',
          toValue: (_mathX, mathY) => clampValue(mathY, -2, 2),
        },
      ];
    case 'compress':
      return [
        {
          key: 'compress-y',
          x: 0,
          y: m.a22,
          axis: 'y',
          param: 'compress_y',
          label: '上下拖动改变纵向压缩；拖到 0 即压成一条线',
          toValue: (_mathX, mathY) => clampValue(mathY, 0, 1),
        },
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* 单格渲染                                                                    */
/* -------------------------------------------------------------------------- */

interface CellFigureProps {
  cell: CellState;
  layout: CellLayout;
  xTicks: number[];
  yTicks: number[];
  crossTickSize: number;
  tickFont: number;
  /** 拖动中的参数（用于让手柄高亮） */
  activeParam: string | null;
  onHandleDown: (cellId: CellId, handle: DragHandle, event: ReactPointerEvent<SVGCircleElement>) => void;
  onHandleKey: (handle: DragHandle, delta: number) => void;
}

/** 像的平行四边形顶点：0 → A·e1 → A·e1+A·e2 → A·e2 */
function imageQuad(m: { a11: number; a12: number; a21: number; a22: number }): Array<[number, number]> {
  return [
    [0, 0],
    [m.a11, m.a21],
    [m.a11 + m.a12, m.a21 + m.a22],
    [m.a12, m.a22],
  ];
}

/** 单位矩阵判定：stage=0 时原像与像完全重合，只画一条（spec §7.1）。 */
function isIdentityLike(m: { a11: number; a12: number; a21: number; a22: number }): boolean {
  return (
    Math.abs(m.a11 - 1) < 1e-9 &&
    Math.abs(m.a22 - 1) < 1e-9 &&
    Math.abs(m.a12) < 1e-9 &&
    Math.abs(m.a21) < 1e-9
  );
}

/**
 * 像空间里的格子线：把平行四边形按 nx × ny 切分。
 * 只在像仍是"二维面积"时绘制，退化成线时自动跳过。
 */
function gridLines(m: { a11: number; a12: number; a21: number; a22: number }): Array<[[number, number], [number, number]]> {
  const det = m.a11 * m.a22 - m.a12 * m.a21;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return [];
  const nx = Math.min(4, Math.max(1, Math.round(Math.abs(m.a11) + Math.abs(m.a12))));
  const ny = Math.min(4, Math.max(1, Math.round(Math.abs(m.a21) + Math.abs(m.a22))));
  if (nx <= 1 && ny <= 1) return [];
  const lines: Array<[[number, number], [number, number]]> = [];
  for (let i = 1; i < nx; i += 1) {
    const u = i / nx;
    lines.push([
      [u * m.a11, u * m.a21],
      [u * m.a11 + m.a12, u * m.a21 + m.a22],
    ]);
  }
  for (let j = 1; j < ny; j += 1) {
    const v = j / ny;
    lines.push([
      [v * m.a12, v * m.a22],
      [v * m.a12 + m.a11, v * m.a22 + m.a21],
    ]);
  }
  return lines;
}

function CellFigure(props: CellFigureProps): ReactElement {
  const { cell, layout, xTicks, yTicks, crossTickSize, tickFont, activeParam } = props;
  const m = cell.matrix;
  const degenerate = cell.orientation === 'collapsed';
  const identical = isIdentityLike(m);

  const xAxisStart = project(layout, -2.2, 0);
  const xAxisEnd = project(layout, 3.2, 0);
  const yAxisStart = project(layout, 0, -1.2);
  const yAxisEnd = project(layout, 0, 3.2);
  const arrow = layout.unit * 0.16;
  const originPoint = project(layout, 0, 0);

  const lineHeight = layout.areaFont * 1.45;

  return (
    <g data-cell={cell.id} data-degenerate={degenerate ? 'true' : undefined}>
      {/* 坐标轴（§7：轴 #8B9AB3，线宽 1.8） */}
      <line
        className={styles.axis}
        x1={xAxisStart[0]}
        y1={xAxisStart[1]}
        x2={xAxisEnd[0]}
        y2={xAxisEnd[1]}
        strokeWidth={layout.axisWidth}
      />
      <path
        className={styles.axisArrow}
        d={`M${xAxisEnd[0]},${xAxisEnd[1] - arrow / 2} L${xAxisEnd[0] + arrow},${xAxisEnd[1]} L${xAxisEnd[0]},${xAxisEnd[1] + arrow / 2} Z`}
      />
      <line
        className={styles.axis}
        x1={yAxisStart[0]}
        y1={yAxisStart[1]}
        x2={yAxisEnd[0]}
        y2={yAxisEnd[1]}
        strokeWidth={layout.axisWidth}
      />
      <path
        className={styles.axisArrow}
        d={`M${yAxisEnd[0] - arrow / 2},${yAxisEnd[1]} L${yAxisEnd[0]},${yAxisEnd[1] - arrow} L${yAxisEnd[0] + arrow / 2},${yAxisEnd[1]} Z`}
      />

      {/* 刻度数字（§7.1：间距过小时已由 layout 隔一个画） */}
      {xTicks.map((tick) => {
        const [px, py] = project(layout, tick, 0);
        return (
          <g key={`xt-${tick}`}>
            <line
              className={styles.axis}
              x1={px}
              y1={py - crossTickSize}
              x2={px}
              y2={py + crossTickSize}
              strokeWidth={layout.axisWidth * 0.8}
            />
            <text
              className={styles.tickText}
              x={px}
              y={py + tickFont * 1.5}
              fontSize={tickFont}
              textAnchor="middle"
            >
              {tick}
            </text>
          </g>
        );
      })}
      {yTicks.map((tick) => {
        const [px, py] = project(layout, 0, tick);
        return (
          <g key={`yt-${tick}`}>
            <line
              className={styles.axis}
              x1={px - crossTickSize}
              y1={py}
              x2={px + crossTickSize}
              y2={py}
              strokeWidth={layout.axisWidth * 0.8}
            />
            <text
              className={styles.tickText}
              x={px - crossTickSize * 2.2}
              y={py + tickFont * 0.36}
              fontSize={tickFont}
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {/* 原像：单位方格（虚线 #A9B4C7）。stage=0 时与像重合，合并为单条（§7.1） */}
      {!identical && (
        <path
          className={styles.preimage}
          d={toPath([[0, 0], [1, 0], [1, 1], [0, 1]], layout)}
          strokeWidth={layout.dashedWidth}
          strokeDasharray={layout.dashArray}
        />
      )}

      {/* 像：A 作用后的平行四边形；退化时只剩一条线，仍如实绘制 */}
      <path
        className={styles.image}
        d={toPath(imageQuad(m), layout)}
        strokeWidth={layout.strokeWidth}
        fillOpacity={degenerate ? 0 : 0.055}
      />
      {gridLines(m).map(([from, to], index) => {
        const [x1, y1] = project(layout, from[0], from[1]);
        const [x2, y2] = project(layout, to[0], to[1]);
        return (
          <line
            key={`grid-${cell.id}-${index}`}
            className={styles.gridLine}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={layout.strokeWidth * 0.5}
          />
        );
      })}

      {/* 像的两条列向量端点（坐标标注贴外侧，避免压线） */}
      {!degenerate && (
        <>
          <circle
            className={styles.imageDot}
            cx={project(layout, m.a11, m.a21)[0]}
            cy={project(layout, m.a11, m.a21)[1]}
            r={layout.unit * 0.055}
          />
          <text
            className={styles.vectorLabel}
            x={project(layout, m.a11, m.a21)[0] + tickFont * 0.6}
            y={project(layout, m.a11, m.a21)[1] + tickFont * 1.15}
            fontSize={tickFont * 1.05}
          >
            {formatPoint(m.a11, m.a21)}
          </text>
          <circle
            className={styles.imageDot}
            cx={project(layout, m.a12, m.a22)[0]}
            cy={project(layout, m.a12, m.a22)[1]}
            r={layout.unit * 0.055}
          />
          <text
            className={styles.vectorLabel}
            x={project(layout, m.a12, m.a22)[0] + tickFont * 0.6}
            y={project(layout, m.a12, m.a22)[1] - tickFont * 0.55}
            fontSize={tickFont * 1.05}
          >
            {formatPoint(m.a12, m.a22)}
          </text>
        </>
      )}

      {/* 原点实心点 */}
      <circle className={styles.originDot} cx={originPoint[0]} cy={originPoint[1]} r={layout.unit * 0.055} />

      {/* 拖动把手 */}
      {handlesFor(cell).map((handle) => {
        const [hx, hy] = project(layout, handle.x, handle.y);
        const active = activeParam === handle.param;
        return (
          <circle
            key={handle.key}
            className={styles.handle}
            data-active={active ? 'true' : undefined}
            cx={hx}
            cy={hy}
            r={layout.unit * (active ? 0.16 : 0.12)}
            tabIndex={0}
            role="button"
            aria-label={handle.label}
            onPointerDown={(event) => props.onHandleDown(cell.id, handle, event)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault();
                props.onHandleKey(handle, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault();
                props.onHandleKey(handle, -1);
              }
            }}
          />
        );
      })}

      {/* 格内结果：面积 / 定向 / det 公式；参数偏离时标"当前值"（spec §8） */}
      <text
        className={styles.areaText}
        x={layout.cell.x + layout.cell.w * 0.04}
        y={layout.labelTop}
        fontSize={layout.areaFont}
        data-degenerate={degenerate ? 'true' : undefined}
      >
        {`面积 ${cell.areaText}`}
      </text>
      {cell.modified && (
        <text
          className={styles.currentBadge}
          x={layout.cell.x + layout.cell.w * 0.96}
          y={layout.labelTop}
          fontSize={layout.areaFont * 0.62}
          textAnchor="end"
        >
          当前值
        </text>
      )}
      <text
        className={styles.orientationText}
        x={layout.cell.x + layout.cell.w * 0.04}
        y={layout.labelTop + lineHeight}
        fontSize={layout.areaFont * 0.78}
      >
        {`定向：${cell.orientationText}`}
      </text>
      <text
        className={styles.formulaText}
        x={layout.cell.x + layout.cell.w * 0.04}
        y={layout.labelTop + lineHeight * 2}
        fontSize={layout.areaFont * 0.72}
        data-degenerate={degenerate ? 'true' : undefined}
      >
        {degenerate ? DEGENERATE_NOTE : cell.formulaText}
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function DetArea2D(props: RegionRendererProps): ReactElement {
  const { region, params, onChange, stage, reducedMotion, onLinkedTexts } = props;
  const svgRef: RefObject<SVGSVGElement> = useRef<SVGSVGElement>(null);
  /** 拖动中的参数（用于手柄高亮 + 阻止宿主重复处理） */
  const [activeParam, setActiveParam] = useState<string | null>(null);
  const dragRef = useRef<{ layout: CellLayout; handle: DragHandle } | null>(null);

  /* ---------------- 播放进度：stage 0/1/2 → t 0/0.5/1 ---------------- */
  const target = stage / 2;
  const [progress, setProgress] = useState<number>(target);
  const progressRef = useRef<number>(target);

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined') {
      progressRef.current = target;
      setProgress(target);
      return undefined;
    }
    const from = progressRef.current;
    if (Math.abs(from - target) < 1e-6) {
      setProgress(target);
      return undefined;
    }
    const duration = 420;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const ratio = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - ratio, 3);
      const value = from + (target - from) * eased;
      progressRef.current = value;
      setProgress(value);
      if (ratio < 1) raf = requestAnimationFrame(tick);
      else progressRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reducedMotion]);

  const cells = useMemo(
    () => buildCells(params, region.original_params, progress),
    [params, region.original_params, progress],
  );

  const visibleIds = useMemo(() => visibleCellIds(params), [params]);
  const visibleCells = useMemo(
    () => visibleIds.map((id) => cells.find((cell) => cell.id === id)).filter((c): c is CellState => c !== undefined),
    [cells, visibleIds],
  );
  const layout = useMemo(
    () => computeLayout(region.coordinate_system, visibleCells.map((cell) => cell.id)),
    [region.coordinate_system, visibleCells],
  );

  /* ---------------- 文字同步（签名去重，避免父组件 setState 循环） ---------------- */
  const linked = useMemo(
    () => buildLinkedTextValues(region.linked_texts, visibleCells, params, region.original_params),
    [region.linked_texts, visibleCells, params, region.original_params],
  );
  const lastSignature = useRef<string>('');
  useEffect(() => {
    const signature = linked.map((item) => `${item.element_id}|${item.text}|${item.changed}`).join(';');
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    onLinkedTexts(linked);
  }, [linked, onLinkedTexts]);

  /* ---------------- 拖动 ---------------- */
  const toMath = useCallback(
    (clientX: number, clientY: number, cellLayout: CellLayout): [number, number] => {
      const svg = svgRef.current;
      if (svg === null) return [0, 0];
      const rect = svg.getBoundingClientRect();
      const [vbW, vbH] = region.coordinate_system.view_box;
      const width = rect.width > 0 ? rect.width : 1;
      const height = rect.height > 0 ? rect.height : 1;
      const boxW = Number.isFinite(vbW) && vbW > 0 ? vbW : 960;
      const boxH = Number.isFinite(vbH) && vbH > 0 ? vbH : 640;
      // preserveAspectRatio="xMidYMid meet" 的 letterbox 补偿
      const scale = Math.min(width / boxW, height / boxH);
      const offsetX = (width - boxW * scale) / 2;
      const offsetY = (height - boxH * scale) / 2;
      const vx = (clientX - rect.left - offsetX) / scale;
      const vy = (clientY - rect.top - offsetY) / scale;
      return [
        (vx - cellLayout.origin[0]) / cellLayout.unit,
        (cellLayout.origin[1] - vy) / cellLayout.unit,
      ];
    },
    [region.coordinate_system.view_box],
  );

  const handleDown = useCallback(
    (cellId: CellId, handle: DragHandle, event: ReactPointerEvent<SVGCircleElement>): void => {
      const cellLayout = layout.cells.find((item) => item.id === cellId);
      if (cellLayout === undefined) return;
      event.stopPropagation();
      event.preventDefault();
      dragRef.current = { layout: cellLayout, handle };
      setActiveParam(handle.param);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [layout.cells],
  );

  const handleMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const [mathX, mathY] = toMath(event.clientX, event.clientY, drag.layout);
      const next = drag.handle.toValue(mathX, mathY);
      if (!Number.isFinite(next)) return;
      onChange({ [drag.handle.param]: Number(next.toFixed(2)) });
    },
    [onChange, toMath],
  );

  const endDrag = useCallback((): void => {
    dragRef.current = null;
    setActiveParam(null);
  }, []);

  const handleKey = useCallback(
    (handle: DragHandle, delta: number): void => {
      const meta = PARAM_METAS.find((item) => item.key === handle.param);
      const step = meta?.step ?? 0.1;
      const current = readNumericParam(params, handle.param, 0);
      onChange({ [handle.param]: Number((current + step * delta).toFixed(2)) });
    },
    [onChange, params],
  );

  const degenerateCount = visibleCells.filter((cell) => cell.orientation === 'collapsed').length;
  const ariaLabel =
    `行列式与面积：${visibleCells.map((cell) => `${cell.spec.title} 面积 ${cell.areaText}`).join('；')}` +
    (degenerateCount > 0 ? '；有一格已压成一条线' : '');

  return (
    <div
      className={styles.root}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-region-id={region.region_id}
    >
      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`0 0 ${region.coordinate_system.view_box[0]} ${region.coordinate_system.view_box[1]}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        {visibleCells.map((cell) => {
          const cellLayout = layout.cells.find((item) => item.id === cell.id);
          if (cellLayout === undefined) return null;
          return (
            <CellFigure
              key={cell.id}
              cell={cell}
              layout={cellLayout}
              xTicks={layout.xTicks}
              yTicks={layout.yTicks}
              crossTickSize={layout.crossTickSize}
              tickFont={layout.tickFont}
              activeParam={activeParam}
              onHandleDown={handleDown}
              onHandleKey={handleKey}
            />
          );
        })}
      </svg>
      <p className={styles.caption} aria-live={reducedMotion ? 'polite' : 'off'}>
        {visibleCells
          .map((cell) => `${cell.spec.title}：面积 ${cell.areaText}，定向${cell.orientationText}`)
          .join('　')}
      </p>
    </div>
  );
}

export default DetArea2D;