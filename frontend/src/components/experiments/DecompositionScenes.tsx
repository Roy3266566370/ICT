import {useState} from 'react';
import {boundsFromPoints, createProjector, svgPath} from '@/ispec/chart';
import {ellipsePoints, singularValues} from '@/ispec/geometry';
import {formatNumberSmart} from '@/ispec/format';
import {applyMat, formatMatrix, lerpMat, multiplyMatrices, svd2, transpose, type Mat2, type Vec2} from '@/ispec/sceneMath';
import {ArrowDefs, SceneAxes} from './sceneChart';
import type {SceneComponentProps} from './sceneTypes';
import styles from './ExperimentStage.module.css';

function numberValue(values: SceneComponentProps['values'], id: string, fallback: number): number {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function matrixOf(values: SceneComponentProps['values']): Mat2 {
  return [[numberValue(values, 'a', 1), numberValue(values, 'b', 0)],
    [numberValue(values, 'c', 0), numberValue(values, 'd', 1)]];
}

function fmt(value: number): string {
  return formatNumberSmart(Math.abs(value) < 1e-9 ? 0 : value);
}

const SECTORS: Array<{points: Vec2[]; color: string}> = [
  {points: [[0, 0], [1, 0], [0.5, 0.866]], color: '#C4622D28'},
  {points: [[0, 0], [0.5, 0.866], [-0.5, 0.866]], color: '#16233A20'},
  {points: [[0, 0], [-0.5, 0.866], [-1, 0]], color: '#6B5CA526'},
];
const MARKERS: Array<{point: Vec2; label: string}> = [
  {point: [0, 1], label: '①'}, {point: [0.866, 0.5], label: '②'}, {point: [-0.866, 0.5], label: '③'},
];
const CIRCLE: Vec2[] = Array.from({length: 96}, (_, index) => {
  const angle = (Math.PI * 2 * index) / 96;
  return [Math.cos(angle), Math.sin(angle)] as Vec2;
});

export function SvdProcessExperiment({values, progress}: SceneComponentProps) {
  const A = matrixOf(values);
  const result = svd2(A);
  const Vt = transpose(result.v);
  const Sigma: Mat2 = [[result.sigma[0], 0], [0, result.sigma[1]]];
  const sigmaVt = multiplyMatrices(Sigma, Vt);
  const final = multiplyMatrices(result.u, sigmaVt);
  const t = Math.max(0, Math.min(1, progress));
  const current = t <= 1 / 3 ? lerpMat([[1, 0], [0, 1]], Vt, t * 3)
    : t <= 2 / 3 ? lerpMat(Vt, sigmaVt, (t - 1 / 3) * 3)
      : lerpMat(sigmaVt, final, (t - 2 / 3) * 3);
  const stage = t <= 1 / 3 ? 0 : t <= 2 / 3 ? 1 : 2;
  const allPoints: Vec2[] = [[0, 0], ...CIRCLE,
    ...SECTORS.flatMap(sector => sector.points),
    ...MARKERS.map(marker => marker.point)];
  const atStages = [0, 1 / 3, 2 / 3, 1].flatMap(value => {
    const matrix = value === 0 ? ([[1, 0], [0, 1]] as Mat2) : value <= 1 / 3 ? Vt : value <= 2 / 3 ? sigmaVt : final;
    return allPoints.map(point => applyMat(matrix, point));
  });
  const bounds = boundsFromPoints([...allPoints, ...atStages], {padding: .6, minSpan: 4});
  const project = createProjector({x: 28, y: 18, w: 584, h: 324}, bounds);
  const origin = project(0, 0);
  const phaseName = stage === 0 ? 'Vᵀ · 对齐输入方向' : stage === 1 ? 'Σ · 沿坐标轴伸缩' : 'U · 转向输出方向';
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>SVD 三步：对齐 → 伸缩 → 对齐</b><span>彩色扇区与编号点让第一步的方向对齐可见。</span></div>
      <div className={styles.sceneButtons}><span>{phaseName}</span></div>
    </div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 360" role="img" aria-label="SVD 三阶段">
      <ArrowDefs id="svd-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <path d={svgPath(CIRCLE.map(point => {const p = project(point[0], point[1]); return p;}), true)} fill="none" stroke="#A3AFC2" strokeWidth={1.2} strokeDasharray="6 5"/>
      {SECTORS.map((sector, index) => <polygon key={index} fill={sector.color}
        points={sector.points.map(point => {const p = project(...applyMat(current, point)); return `${p[0]},${p[1]}`;}).join(' ')}/>)}
      <path d={svgPath(CIRCLE.map(point => {const p = project(...applyMat(current, point)); return p;}), true)}
        fill="none" stroke="#C4622D" strokeWidth={2}/>
      {MARKERS.map(marker => {const p = project(...applyMat(current, marker.point)); return <g key={marker.label}>
        <circle cx={p[0]} cy={p[1]} r={5} fill="#fff" stroke="#16233A" strokeWidth={1.6}/>
        <text x={p[0]} y={p[1] + 3} textAnchor="middle" fontSize={7} fill="#16233A">{marker.label}</text>
      </g>;})}
      <circle cx={origin[0]} cy={origin[1]} r={3} fill="#16233A"/>
    </svg>
    <div className={styles.sceneFormula}>
      A = U·Σ·Vᵀ；当前因子：<em>{stage === 0 ? 'Vᵀ' : stage === 1 ? 'Σ' : 'U'}</em>；U = {formatMatrix(result.u)}　Σ = diag({fmt(result.sigma[0])}, {fmt(result.sigma[1])})　Vᵀ = {formatMatrix(Vt)}
    </div>
    <div className={styles.sceneReadout}>
      <div><span>矩阵 A</span><b>{formatMatrix(A)}</b><small>秩 = {result.rank}</small></div>
      <div><span>当前阶段</span><b>{stage + 1} / 3</b><small>{stage === 0 ? '正交对齐，可能含翻转' : stage === 1 ? '沿坐标轴非负伸缩' : '转向输出方向'}</small></div>
      <div><span>最终一致</span><b>{formatMatrix(final)}</b><small>UΣVᵀ 与 A 同一矩阵</small></div>
    </div>
  </div>;
}

export function ShearCompareExperiment({values}: SceneComponentProps) {
  const k = numberValue(values, 'shear_k', 1.618);
  const [normalized, setNormalized] = useState(false);
  const A: Mat2 = [[1, k], [0, 1]];
  const B: Mat2 = [[1, 0], [k, 1]];
  const sigmaA = singularValues({a: A[0][0], b: A[0][1], c: A[1][0], d: A[1][1]});
  const sigmaB = singularValues({a: B[0][0], b: B[0][1], c: B[1][0], d: B[1][1]});
  const panels = [{label: 'A · 上剪切', matrix: A, sigma: sigmaA, color: '#16233A'},
    {label: 'B · 下剪切', matrix: B, sigma: sigmaB, color: '#C4622D'}];
  const displayMatrix = (matrix: Mat2, sigma: readonly [number, number]) => normalized && sigma[0] > 1e-9
    ? [[matrix[0][0] / sigma[0], matrix[0][1] / sigma[0]], [matrix[1][0] / sigma[0], matrix[1][1] / sigma[0]]] as Mat2 : matrix;
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>剪切族：行列式不变，形状被拉扁</b><span>特征值仍为 1,1；奇异值随剪切强度变化。</span></div>
      <div className={styles.sceneButtons}><button type="button" aria-pressed={normalized} onClick={() => setNormalized(value => !value)}>{normalized ? '形状归一（按最长半轴）' : '同尺度显示'}</button></div>
    </div>
    <div className={styles.scenePanels}>
      {panels.map(panel => {
        const matrix = displayMatrix(panel.matrix, panel.sigma);
        const ellipse = ellipsePoints({a: matrix[0][0], b: matrix[0][1], c: matrix[1][0], d: matrix[1][1]}, 96);
        const bounds = boundsFromPoints([...ellipse, [0, 0]], {padding: .5, minSpan: 2.4});
        const project = createProjector({x: 12, y: 12, w: 360, h: 270}, bounds);
        return <div className={styles.scenePanel} key={panel.label}>
          <h4>{panel.label}</h4>
          <svg viewBox="0 0 384 294" role="img" aria-label={panel.label}>
            <SceneAxes project={project} bounds={bounds}/>
            <path d={svgPath(ellipse.map(point => project(point[0], point[1])), true)} fill={`${panel.color}14`} stroke={panel.color} strokeWidth={2}/>
            <circle cx={project(0, 0)[0]} cy={project(0, 0)[1]} r={3} fill={panel.color}/>
          </svg>
          <p>特征值 1,1 · det = 1 · σ = {fmt(panel.sigma[0])} / {fmt(panel.sigma[1])}{normalized ? `　显示倍率 ×${fmt(1 / Math.max(1e-12, panel.sigma[0]))}` : ''}</p>
          <div className={styles.sceneMetrics}><span>条件数<b>{fmt(panel.sigma[0] / Math.max(1e-12, panel.sigma[1]))}</b></span><span>面积<b>1</b></span></div>
        </div>;
      })}
    </div>
    <div className={styles.sceneReadout}>
      <div><span>剪切强度 k</span><b>{fmt(k)}</b><small>拖动关键控制</small></div>
      <div><span>特征值</span><b>1 , 1</b><small>重根，不可对角化</small></div>
      <div><span>显示方式</span><b>{normalized ? '形状归一' : '同尺度'}</b><small>{normalized ? '归一后仍标出实际倍率' : '面积可直接比较'}</small></div>
    </div>
  </div>;
}
