/**
 * MafsCalculusCanvas —— 基于 Mafs 的交互式 2D 微积分画布。
 *
 * 覆盖定积分（曲线 + 阴影面积 + 黎曼矩形 + 可拖拽上下限 a/b）、
 * 导数与切线（曲线 + 切线 + 可拖拽研究点）与不定积分（原函数族 F(x)+C），
 * 原生支持鼠标滚轮缩放、画布拖拽平移与一键复位视图。
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Coordinates,
  Line,
  Mafs,
  MovablePoint,
  Point,
  Polygon,
  Polyline,
  Text,
} from 'mafs';
import 'mafs/core.css';
import type { CalculusPoint, CalculusResult, LabResult } from '@/labs/types';
import { formatNumber } from '@/labs/expr';
import { clampBox, snapToStep } from './charts';
import type { LabSelection } from './LabCanvas';
import styles from './MafsCalculusCanvas.module.css';

type Vec2 = [number, number];

interface Props {
  result: CalculusResult;
  compare?: LabResult | null;
  selected: LabSelection | null;
  onSelect: (selection: LabSelection | null) => void;
  onParamDrag?: (patch: Record<string, number>) => void;
  readOnly?: boolean;
  boundsDraggable?: boolean;
}

const INDIGO = '#4f46e5';
const CORAL = '#b8431f';
const ORANGE = '#f97316';

/** 把含 null 断点的采样点列拆成若干连续段，供 Mafs Polyline 绘制。 */
function splitSegments(series: CalculusPoint[]): Vec2[][] {
  const segments: Vec2[][] = [];
  let current: Vec2[] = [];
  for (const pt of series) {
    if (typeof pt.y === 'number' && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      current.push([pt.x, pt.y]);
    } else if (current.length > 0) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

function computeViewBox(result: CalculusResult): { x: Vec2; y: Vec2 } {
  const ys = [
    ...result.series,
    ...(result.lowerSeries ?? []),
    ...(result.overlays ?? []).flatMap((item) => item.series),
  ]
    .map((pt) => pt.y)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax - yMin < 1e-6) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.16;
  const xMin = Number.isFinite(result.domain.x_min) ? result.domain.x_min : -6;
  const xMax = Number.isFinite(result.domain.x_max) ? result.domain.x_max : 6;
  const xPad = Math.max(0.25, (xMax - xMin) * 0.08);
  return {
    x: [xMin - xPad, xMax + xPad],
    y: [yMin - yPad, yMax + yPad],
  };
}

export function MafsCalculusCanvas({
  result,
  compare,
  selected,
  onSelect,
  onParamDrag,
  readOnly = false,
  boundsDraggable = false,
}: Props): ReactNode {
  const [resetSeed, setResetSeed] = useState(0);
  const viewBox = useMemo(() => computeViewBox(result), [result]);
  const mainSegments = useMemo(() => splitSegments(result.series), [result.series]);
  const lowerSegments = useMemo(
    () => splitSegments(result.lowerSeries ?? []),
    [result.lowerSeries],
  );
  const compareSegments = useMemo(
    () => (compare && compare.subject === 'calculus' ? splitSegments(compare.series) : []),
    [compare],
  );

  const canDrag = Boolean(onParamDrag) && !readOnly;
  const emphasis = selected?.id;

  // 定积分阴影多边形
  const areaPolygon = useMemo<Vec2[]>(() => {
    if (result.kind !== 'integral') return [];
    const inside = result.series.filter(
      (pt) =>
        typeof pt.y === 'number' &&
        Number.isFinite(pt.y) &&
        pt.x >= result.domain.x_min + 1e-6 &&
        pt.x <= result.domain.x_max - 1e-6,
    );
    if (inside.length < 2) return [];
    const lowerInside = (result.lowerSeries ?? []).filter(
      (pt) =>
        typeof pt.y === 'number' &&
        Number.isFinite(pt.y) &&
        pt.x >= result.domain.x_min + 1e-6 &&
        pt.x <= result.domain.x_max - 1e-6,
    );
    if (lowerInside.length >= 2) {
      return [
        ...inside.map((pt): Vec2 => [pt.x, pt.y as number]),
        ...[...lowerInside].reverse().map((pt): Vec2 => [pt.x, pt.y as number]),
      ];
    }
    const first = inside[0]!;
    const last = inside[inside.length - 1]!;
    return [
      [first.x, 0],
      ...inside.map((pt): Vec2 => [pt.x, pt.y as number]),
      [last.x, 0],
    ];
  }, [result.kind, result.series, result.lowerSeries, result.domain.x_min, result.domain.x_max]);

  const integralBounds =
    result.kind === 'integral' && boundsDraggable && result.rects.length >= 2
      ? {
          lower: result.rects[0]!.x0,
          upper: result.rects[result.rects.length - 1]!.x1,
        }
      : null;

  const isDerivative =
    result.kind === 'derivative' &&
    result.point &&
    typeof result.point.y === 'number' &&
    Number.isFinite(result.point.y);
  const isAntiderivative = result.kind === 'antiderivative';

  const ariaLabel = isDerivative
    ? '函数、切线与差商（可缩放平移）'
    : isAntiderivative
      ? '原函数族 F(x)+C（可缩放平移）'
      : '函数曲线、积分区域与黎曼矩形（可缩放平移）';

  const headline = isDerivative
    ? `切线斜率 ${formatNumber(result.point!.slope)}`
    : isAntiderivative
      ? 'F(x)+C · 拖动积分常数观察整体平移'
      : `黎曼和 ${formatNumber(result.approx)}`;

  const subline = isDerivative
    ? `差商 ${formatNumber(result.approx)} → 导数 ${formatNumber(result.exact)}`
    : isAntiderivative
      ? '原题结论与公式见图下说明'
      : `${result.exact !== null ? `解析/参照 ${formatNumber(result.exact)}` : '等待可计算表达式'} · 误差 ${formatNumber(result.error)}${integralBounds && canDrag ? ' · 可拖动 a/b 端点改区间' : ''}`;

  return (
    <div className={styles.wrap} role="img" aria-label={ariaLabel}>
      <div className={styles.headerOverlay}>
        <span className={styles.title}>{headline}</span>
        <span className={styles.subtitle}>{subline}</span>
        {lowerSegments.length > 0 ? (
          <span className={styles.compareNote}>虚线：区域下边界</span>
        ) : null}
        {compareSegments.length > 0 ? (
          <span className={styles.compareNote}>
            {isAntiderivative ? '虚线：对照情景的另一条原函数' : '虚线：对照情景'}
          </span>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => setResetSeed((n) => n + 1)}
          title="恢复默认坐标视野"
        >
          复位视图
        </button>
      </div>

      <Mafs
        key={resetSeed}
        height={400}
        viewBox={viewBox}
        preserveAspectRatio={false}
        pan
        zoom={{ min: 0.25, max: 12 }}
      >
        <Coordinates.Cartesian />

        {/* 定积分阴影区域与黎曼矩形 */}
        {areaPolygon.length >= 3 ? (
          <Polygon
            points={areaPolygon}
            color={
              emphasis === 'integral_area' || emphasis === 'limits' || emphasis === 'evaluate'
                ? CORAL
                : INDIGO
            }
            fillOpacity={0.14}
            weight={0}
          />
        ) : null}

        {result.kind === 'integral'
          ? result.rects.map((rect, index) => {
              const base = rect.base ?? 0;
              return (
                <Polygon
                  key={`rect-${index}`}
                  points={[
                    [rect.x0, base],
                    [rect.x1, base],
                    [rect.x1, rect.height],
                    [rect.x0, rect.height],
                  ]}
                  color={emphasis === 'approx' ? CORAL : INDIGO}
                  fillOpacity={emphasis === 'approx' ? 0.16 : 0.08}
                  strokeOpacity={0.35}
                  weight={1}
                />
              );
            })
          : null}

        {/* 下边界与对照情景曲线 */}
        {lowerSegments.map((pts, idx) => (
          <Polyline
            key={`lower-${idx}`}
            points={pts}
            color={CORAL}
            weight={1.8}
            strokeStyle="dashed"
            strokeOpacity={0.75}
          />
        ))}
        {compareSegments.map((pts, idx) => (
          <Polyline
            key={`cmp-${idx}`}
            points={pts}
            color={CORAL}
            weight={1.8}
            strokeStyle="dashed"
            strokeOpacity={0.75}
          />
        ))}

        {/* 主函数曲线 */}
        {mainSegments.map((pts, idx) => (
          <Polyline
            key={`main-${idx}`}
            points={pts}
            color={INDIGO}
            weight={emphasis === 'antiderivative' || emphasis === 'derivative' ? 3.2 : 2.5}
          />
        ))}

        {/* 导数切线与可拖拽研究点 */}
        {isDerivative && result.point ? (
          <>
            <Line.ThroughPoints
              point1={[result.point.x, result.point.y as number]}
              point2={[
                result.point.x + 1,
                (result.point.y as number) + result.point.tangent.m,
              ]}
              color={CORAL}
              weight={emphasis === 'slope' || emphasis === 'derivative' ? 2.8 : 2}
            />
            {canDrag ? (
              <MovablePoint
                point={[result.point.x, result.point.y as number]}
                color={ORANGE}
                constrain={([nx]) => [
                  clampBox(snapToStep(nx, 0.05), result.domain.x_min, result.domain.x_max),
                  result.point!.y as number,
                ]}
                onMove={([nx]) => {
                  const snapped = clampBox(
                    snapToStep(nx, 0.05),
                    result.domain.x_min,
                    result.domain.x_max,
                  );
                  if (Number.isFinite(snapped)) {
                    onSelect({ id: 'tangent', label: '切线与导数', kind: 'tangent' });
                    onParamDrag?.({ point: snapped });
                  }
                }}
              />
            ) : (
              <Point x={result.point.x} y={result.point.y as number} color={CORAL} />
            )}
          </>
        ) : null}

        {/* 定积分可拖拽上下限端点 a / b */}
        {integralBounds && canDrag ? (
          <>
            <Line.Segment
              point1={[integralBounds.lower, viewBox.y[0]]}
              point2={[integralBounds.lower, viewBox.y[1]]}
              color={ORANGE}
              style="dashed"
              opacity={0.5}
            />
            <Line.Segment
              point1={[integralBounds.upper, viewBox.y[0]]}
              point2={[integralBounds.upper, viewBox.y[1]]}
              color={ORANGE}
              style="dashed"
              opacity={0.5}
            />
            <MovablePoint
              point={[integralBounds.lower, 0]}
              color={ORANGE}
              constrain={([nx]) => [
                clampBox(snapToStep(nx, 0.05), viewBox.x[0], viewBox.x[1]),
                0,
              ]}
              onMove={([nx]) => {
                const snapped = clampBox(snapToStep(nx, 0.05), viewBox.x[0], viewBox.x[1]);
                if (Number.isFinite(snapped)) {
                  onSelect({ id: 'integral_area', label: '积分区域与黎曼和', kind: 'area' });
                  onParamDrag?.({ lower: snapped });
                }
              }}
            />
            <MovablePoint
              point={[integralBounds.upper, 0]}
              color={ORANGE}
              constrain={([nx]) => [
                clampBox(snapToStep(nx, 0.05), viewBox.x[0], viewBox.x[1]),
                0,
              ]}
              onMove={([nx]) => {
                const snapped = clampBox(snapToStep(nx, 0.05), viewBox.x[0], viewBox.x[1]);
                if (Number.isFinite(snapped)) {
                  onSelect({ id: 'integral_area', label: '积分区域与黎曼和', kind: 'area' });
                  onParamDrag?.({ upper: snapped });
                }
              }}
            />
            <Text x={integralBounds.lower} y={0} attach="s" attachDistance={22} size={12}>
              {`a=${formatNumber(integralBounds.lower)}`}
            </Text>
            <Text x={integralBounds.upper} y={0} attach="s" attachDistance={22} size={12}>
              {`b=${formatNumber(integralBounds.upper)}`}
            </Text>
          </>
        ) : null}
      </Mafs>

      <span className={styles.footerHint}>
        滚轮缩放 · 拖动画布平移{canDrag && (isDerivative || integralBounds) ? ' · 拖动橙色控制点实时重算' : ''}
      </span>
    </div>
  );
}

export default MafsCalculusCanvas;
