import { memo, useMemo, useState, type ReactNode } from 'react';
import type { ISpec } from '@/ispec/types';
import { applyMat, dualPath, formatMatrix, formatPoint, interpolateDualPath, matrixFor, polygonArea, maxVertexDeviation, RECTANGLE, transformPolygon, type DualPathOrder, type Mat2, type Vec2 } from '@/ispec/sceneMath';
import { boundsFromPoints, createProjector } from '@/ispec/chart';
import styles from './ExperimentStage.module.css';

interface Props {
  spec: ISpec;
  values: Record<string, number | boolean | string>;
  progress: number;
  reducedMotion?: boolean;
}

function numberValue(values: Record<string, number | boolean | string>, id: string, fallback: number): number {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pointsAttribute(points: readonly Vec2[], project: (x: number, y: number) => Vec2): string {
  return points.map(point => {
    const screen = project(point[0], point[1]);
    return `${screen[0].toFixed(2)},${screen[1].toFixed(2)}`;
  }).join(' ');
}

function vectorArrow(origin: Vec2, end: Vec2, color: string, dashed = false): ReactNode {
  return <line x1={origin[0]} y1={origin[1]} x2={end[0]} y2={end[1]} stroke={color}
    strokeWidth={2.2} strokeDasharray={dashed ? '5 4' : undefined} markerEnd="url(#dual-arrow)" strokeLinecap="round"/>;
}

export const DualPathExperiment = memo(function DualPathExperiment({ values, progress }: Props) {
  const [overlay, setOverlay] = useState(false);
  const angle = numberValue(values, 'steps_rotate_angle_deg', 30);
  const sx = numberValue(values, 'steps_stretch_factor_x', 1.6);
  const sy = numberValue(values, 'steps_stretch_factor_y', 1);
  const order: DualPathOrder = values.steps_order === 'B' ? 'B' : 'A';
  const shape = values.steps_shape === 'basis' ? 'basis' : 'rectangle';
  const v: Vec2 = [1, 0];
  const currentA = interpolateDualPath('A', angle, sx, sy, v, progress);
  const currentB = interpolateDualPath('B', angle, sx, sy, v, progress);
  const fullA = dualPath('A', angle, sx, sy, v);
  const fullB = dualPath('B', angle, sx, sy, v);
  const matrixA = matrixFor('A', angle, sx, sy);
  const matrixB = matrixFor('B', angle, sx, sy);
  const finalRectA = transformPolygon(matrixA, RECTANGLE);
  const finalRectB = transformPolygon(matrixB, RECTANGLE);
  const deviation = maxVertexDeviation(finalRectA, finalRectB);
  const areaA = polygonArea(finalRectA);
  const areaB = polygonArea(finalRectB);
  const points: Vec2[] = [[0, 0], v, ...RECTANGLE, ...finalRectA, ...finalRectB];
  for (const t of [0.25, 0.5, 0.75, 1]) {
    for (const orderName of ['A', 'B'] as const) {
      const state = interpolateDualPath(orderName, angle, sx, sy, v, t);
      points.push(...transformPolygon(state.matrix, RECTANGLE), state.final);
    }
  }
  const bounds = boundsFromPoints(points, { padding: 0.8, minSpan: 4 });
  const panels = [
    { order: 'A' as const, title: 'A · 旋转 → 拉伸', subtitle: `S(${sx}, ${sy}) · R(${angle}°)`, current: currentA, full: fullA, other: finalRectB, color: '#16233A' },
    { order: 'B' as const, title: 'B · 拉伸 → 旋转', subtitle: `R(${angle}°) · S(${sx}, ${sy})`, current: currentB, full: fullB, other: finalRectA, color: '#C4622D' },
  ];
  const details = useMemo(() => ({
    a: `${formatPoint(fullA.middle)} → ${formatPoint(fullA.final)}`,
    b: `${formatPoint(fullB.middle)} → ${formatPoint(fullB.final)}`,
    matrixA: formatMatrix(matrixA),
    matrixB: formatMatrix(matrixB),
  }), [angle, sx, sy]);
  const rectAt = (matrix: Mat2) => transformPolygon(matrix, RECTANGLE);

  return <div className={styles.dualExperiment}>
    <div className={styles.dualToolbar}>
      <div><b>两条路径，同一坐标尺度</b><span>原形虚线 · 中间态虚线 · 当前结果实线</span></div>
      <button type="button" aria-pressed={overlay} onClick={() => setOverlay(value => !value)}>叠加比较</button>
    </div>
    <svg className={styles.dualSvg} viewBox="0 0 1000 500" role="img" aria-label="旋转与拉伸的双路径比较">
      <defs><marker id="dual-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
        <path d="M0,0 L9,4.5 L0,9 Z" fill="context-stroke"/></marker></defs>
      {panels.map((panel, panelIndex) => {
        const area = {x: panelIndex === 0 ? 20 : 505, y: 54, w: 475, h: 410};
        const project = createProjector(area, bounds);
        const origin = project(0, 0);
        const midMatrix = interpolateDualPath(panel.order, angle, sx, sy, v, .5).matrix;
        const currentMatrix = panel.current.matrix;
        const originalVector = [project(v[0], v[1]), origin] as const;
        const currentVector = [project(panel.current.final[0], panel.current.final[1]), origin] as const;
        const primary = order === panel.order;
        const baseShape = shape === 'rectangle' ? RECTANGLE : [];
        const currentShape = rectAt(currentMatrix);
        const midShape = rectAt(midMatrix);
        const fullShape = rectAt(panel.full.matrix);
        const gridX = Math.ceil(bounds.xMin); const gridY = Math.ceil(bounds.yMin);
        return <g key={panel.order} data-primary={primary}>
          <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={12} className={styles.dualPanel}/>
          <text x={area.x + 18} y={32} className={styles.dualTitle}>{panel.title}</text>
          <text x={area.x + 18} y={46} className={styles.dualSubtitle}>{panel.subtitle}{primary ? ' · 当前顺序' : ''}</text>
          {[...Array(Math.min(30, Math.max(0, Math.floor(bounds.xMax) - gridX + 1)))].map((_, index) => {
            const x = gridX + index; const top = project(x, bounds.yMax); const bottom = project(x, bounds.yMin);
            return <line key={`x${x}`} x1={top[0]} y1={top[1]} x2={bottom[0]} y2={bottom[1]} className={styles.dualGrid}/>;
          })}
          {[...Array(Math.min(30, Math.max(0, Math.floor(bounds.yMax) - gridY + 1)))].map((_, index) => {
            const y = gridY + index; const left = project(bounds.xMin, y); const right = project(bounds.xMax, y);
            return <line key={`y${y}`} x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} className={styles.dualGrid}/>;
          })}
          <line x1={project(bounds.xMin, 0)[0]} y1={origin[1]} x2={project(bounds.xMax, 0)[0]} y2={origin[1]} className={styles.dualAxis}/>
          <line x1={origin[0]} y1={project(0, bounds.yMin)[1]} x2={origin[0]} y2={project(0, bounds.yMax)[1]} className={styles.dualAxis}/>
          {shape === 'rectangle' ? <>
            <polygon points={pointsAttribute(baseShape, project)} className={styles.dualOriginal}/>
            {progress < 0.999 && <polygon points={pointsAttribute(fullShape, project)} fill="none" stroke={panel.color}
              strokeWidth={1.5} opacity={0.28}/>}
            <polygon points={pointsAttribute(midShape, project)} className={styles.dualMiddle}/>
            <polygon points={pointsAttribute(currentShape, project)} fill={`${panel.color}14`} stroke={panel.color} strokeWidth={2.4}/>
          </> : <>
            {vectorArrow(origin, project(1, 0), '#A3AFC2', true)}
            {vectorArrow(origin, project(0, 1), '#A3AFC2', true)}
            {vectorArrow(origin, project(panel.current.matrix[0][0], panel.current.matrix[1][0]), panel.color)}
            {vectorArrow(origin, project(panel.current.matrix[0][1], panel.current.matrix[1][1]), panel.color)}
          </>}
          {shape === 'rectangle' && vectorArrow(origin, originalVector[0], '#8B97AB', true)}
          {shape === 'rectangle' && vectorArrow(origin, currentVector[0], panel.color)}
          {overlay && <polygon points={pointsAttribute(panel.order === 'A' ? finalRectB : finalRectA, project)}
            fill="none" stroke={panel.order === 'A' ? '#C4622D' : '#16233A'} strokeWidth={1.4} strokeDasharray="6 5"/>}
          <text x={area.x + 18} y={area.y + area.h - 46} className={styles.dualReadout}>v {formatPoint([1, 0])} → {formatPoint(panel.current.final)}</text>
          <text x={area.x + 18} y={area.y + area.h - 22} className={styles.dualReadout}>中间态 {formatPoint(panel.current.middle)} · 面积 {shape === 'rectangle' ? polygonArea(currentShape).toFixed(3) : '—'}</text>
          <circle cx={project(...panel.current.final)[0]} cy={project(...panel.current.final)[1]} r={4} fill={panel.color}/>
        </g>;
      })}
    </svg>
    <div className={styles.dualSummary}>
      <div><span>A · 先转后拉</span><b>v → {formatPoint(fullA.middle)} → {formatPoint(fullA.final)}</b><small>{details.matrixA}</small></div>
      <div><span>B · 先拉后转</span><b>v → {formatPoint(fullB.middle)} → {formatPoint(fullB.final)}</b><small>{details.matrixB}</small></div>
      {shape === 'rectangle'
        ? <div><span>面积与差异</span><b>面积 {areaA.toFixed(3)} / {areaB.toFixed(3)}</b><small>最大顶点偏差 {deviation.toFixed(3)}；det = {sx * sy}</small></div>
        : <div><span>基向量终点</span><b>A：e₂ → {formatPoint(applyMat(fullA.matrix, [0, 1]))}　B：e₂ → {formatPoint(applyMat(fullB.matrix, [0, 1]))}</b><small>e₁ → {formatPoint(fullA.final)} / {formatPoint(fullB.final)}；det = {sx * sy}</small></div>}
    </div>
    {overlay && <p className={styles.dualNote}>叠加只比较最终轮廓；中间态与当前阶段仍按各自时间轴显示。当前选择：{order === 'A' ? '先转后拉' : '先拉后转'}。</p>}
  </div>;
});
