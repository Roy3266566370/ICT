import {useState} from 'react';
import {FigureSpecView} from '@/components/ispec/views/FigureSpecView';
import {boundsFromPoints, createProjector} from '@/ispec/chart';
import {SceneAxes} from './sceneChart';
import {inverse2, type Vec2} from '@/ispec/sceneMath';
import {applyMatrix, eigenScale, isFixedVector, realEigenpairs} from '@/ispec/geometry';
import {formatNumberSmart} from '@/ispec/format';
import type {FigureView} from '@/ispec/types';
import type {SceneComponentProps} from './sceneTypes';
import styles from './ExperimentStage.module.css';

function numberValue(values: SceneComponentProps['values'], id: string, fallback: number): number {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function matrixValues(values: SceneComponentProps['values']) {
  return {a: numberValue(values, 'a', 1), b: numberValue(values, 'b', 0),
    c: numberValue(values, 'c', 0), d: numberValue(values, 'd', 1)};
}

export function EigenProbeExperiment({spec, values, evaluation, onChange}: SceneComponentProps) {
  const [showHints, setShowHints] = useState(false);
  const view = spec.views.find(item => item.type === 'figure') as FigureView | undefined;
  if (!view) return null;
  const matrix = matrixValues(values);
  const probe: [number, number] = [numberValue(values, 'vx', 1), numberValue(values, 'vy', 1)];
  const image = applyMatrix({a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d}, probe);
  const pairs = realEigenpairs({a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d});
  const lambda = eigenScale({a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d}, probe);
  const length = Math.hypot(probe[0], probe[1]);
  const fixed = isFixedVector({a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d}, probe);
  const zero = length < 1e-9;
  const preset = (a: number, b: number, c: number, d: number) => {
    onChange('a', a); onChange('b', b); onChange('c', c); onChange('d', d);
  };
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>寻找仍在原直线上的方向</b><span>先拖动探针尝试；确认后再显示特征方向提示。</span></div>
      <div className={styles.sceneButtons}>
        <button type="button" onClick={() => preset(0, -1, 1, 0)}>旋转 90°</button>
        <button type="button" onClick={() => preset(1, 1, 0, 1)}>剪切</button>
        <button type="button" onClick={() => preset(1, 0, 0, 1)}>恒等</button>
        <button type="button" aria-pressed={showHints} onClick={() => setShowHints(value => !value)}>{showHints ? '隐藏特征方向' : '显示特征方向'}</button>
      </div>
    </div>
    <div className={styles.sceneFigure}>
      <FigureSpecView view={view} spec={spec} evaluation={evaluation} stage={2} progress={1} reducedMotion draggable
        onParamChange={onChange} hideEigenHints={!showHints}/>
    </div>
    <div className={styles.sceneReadout}>
      <div><span>探针向量 v</span><b>({formatNumberSmart(probe[0])}, {formatNumberSmart(probe[1])})</b><small>{zero ? '零向量没有方向' : ''}</small></div>
      <div><span>A·v</span><b>({formatNumberSmart(image[0])}, {formatNumberSmart(image[1])})</b><small>{fixed ? '仍在原方向' : '方向改变'}</small></div>
      <div><span>当前判断</span><b>{zero ? '零向量，不是特征向量' : lambda === null ? '方向改变' : lambda === 0 ? '映为零，λ=0' : lambda > 0 ? `同向，λ=${formatNumberSmart(lambda)}` : `反向，λ=${formatNumberSmart(lambda)}`}</b>
        <small>{showHints ? (pairs.length ? `实特征方向 ${pairs.length} 个` : '没有实特征方向') : '先尝试，再显示特征方向'}</small></div>
    </div>
  </div>;
}

export function InverseExperiment({values, onChange}: SceneComponentProps) {
  const matrix = matrixValues(values);
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  const target: [number, number] = [numberValue(values, 'target_x', 2), numberValue(values, 'target_y', 1)];
  const inverse = inverse2([[matrix.a, matrix.b], [matrix.c, matrix.d]]);
  const firstColumn: [number, number] = [matrix.a, matrix.c];
  const secondColumn: [number, number] = [matrix.b, matrix.d];
  const column = Math.hypot(...firstColumn) > 1e-9 ? firstColumn : secondColumn;
  const columnLength = Math.hypot(...column);
  const consistent = columnLength > 1e-9 && Math.abs(target[0] * column[1] - target[1] * column[0]) <= 1e-7 * Math.max(1, columnLength) * Math.max(1, Math.hypot(...target));
  const scale = columnLength > 1e-9 ? (target[0] * column[0] + target[1] * column[1]) / (columnLength * columnLength) : 0;
  const particular: [number, number] = Math.abs(matrix.a) > 1e-9 || Math.abs(matrix.c) > 1e-9 ? [scale, 0] : [0, scale];
  const nullVector: [number, number] = Math.hypot(matrix.b, matrix.a) > 1e-9 ? [matrix.b, -matrix.a] : [matrix.d, -matrix.c];
  const preimages: Array<{point: [number, number]; label: string}> = inverse
    ? [{point: [inverse[0][0] * target[0] + inverse[0][1] * target[1], inverse[1][0] * target[0] + inverse[1][1] * target[1]], label: 'x'}]
    : consistent && columnLength > 1e-9
      ? [-1, 0, 1].map((step, index) => ({point: [particular[0] + nullVector[0] * step, particular[1] + nullVector[1] * step], label: `x${index + 1}`}))
      : [];
  const zeroMatrix = Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d) < 1e-9;
  const wholePlane = zeroMatrix && Math.hypot(...target) < 1e-9;
  const points: Vec2[] = [[0, 0], target, ...preimages.map(item => item.point), firstColumn, secondColumn];
  const bounds = boundsFromPoints(points, {padding: .8, minSpan: 4});
  const leftProject = createProjector({x: 24, y: 34, w: 280, h: 286}, bounds);
  const rightProject = createProjector({x: 336, y: 34, w: 280, h: 286}, bounds);
  const preset = (a: number, b: number, c: number, d: number, tx: number, ty: number) => {
    onChange('a', a); onChange('b', b); onChange('c', c); onChange('d', d);
    onChange('target_x', tx); onChange('target_y', ty);
  };
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>输入空间与输出空间</b><span>左侧原像身份与右侧输出一一对应；动画倒退不等于数学可逆。</span></div>
      <div className={styles.sceneButtons}>
        <button type="button" onClick={() => preset(1, 1, 0, 1, 2, 1)}>可逆剪切</button>
        <button type="button" onClick={() => preset(1, 0, 0, 0, 2, 0)}>投影 · 有原像</button>
        <button type="button" onClick={() => preset(1, 0, 0, 0, 2, 1)}>投影 · 无解</button>
      </div>
    </div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 360" role="img" aria-label="输入空间与输出空间">
      <SceneAxes project={leftProject} bounds={bounds}/><SceneAxes project={rightProject} bounds={bounds}/>
      <text x={24} y={22} fill="#6F7F99" fontSize={10}>输入空间</text>
      <text x={336} y={22} fill="#6F7F99" fontSize={10}>输出空间</text>
      {inverse && preimages.map(item => <g key={item.label}>
        <circle cx={leftProject(item.point[0], item.point[1])[0]} cy={leftProject(item.point[0], item.point[1])[1]} r={5} fill="#16233A"/>
        <text x={leftProject(item.point[0], item.point[1])[0] + 6} y={leftProject(item.point[0], item.point[1])[1] - 4} fill="#16233A" fontSize={10}>{item.label}</text>
      </g>)}
      {!inverse && consistent && columnLength > 1e-9 && <line x1={leftProject(particular[0] - nullVector[0], particular[1] - nullVector[1])[0]}
        y1={leftProject(particular[0] - nullVector[0], particular[1] - nullVector[1])[1]}
        x2={leftProject(particular[0] + nullVector[0], particular[1] + nullVector[1])[0]}
        y2={leftProject(particular[0] + nullVector[0], particular[1] + nullVector[1])[1]} stroke="#6B5CA5" strokeWidth={2} strokeDasharray="5 4"/>}
      {!inverse && consistent && preimages.map(item => <g key={item.label}>
        <circle cx={leftProject(item.point[0], item.point[1])[0]} cy={leftProject(item.point[0], item.point[1])[1]} r={5} fill="#16233A"/>
        <text x={leftProject(item.point[0], item.point[1])[0] + 6} y={leftProject(item.point[0], item.point[1])[1] - 4} fill="#16233A" fontSize={10}>{item.label}</text>
      </g>)}
      <line x1={rightProject(0, 0)[0]} y1={rightProject(0, 0)[1]} x2={rightProject(target[0], target[1])[0]} y2={rightProject(target[0], target[1])[1]} stroke="#C4622D" strokeWidth={2.4} markerEnd="url(#inverse-arrow)"/>
      <circle cx={rightProject(target[0], target[1])[0]} cy={rightProject(target[0], target[1])[1]} r={5} fill="#C4622D"/>
      <text x={rightProject(target[0], target[1])[0] + 6} y={rightProject(target[0], target[1])[1] - 4} fill="#C4622D" fontSize={10}>b</text>
      <defs><marker id="inverse-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="context-stroke"/></marker></defs>
    </svg>
    <div className={styles.sceneReadout}>
      <div><span>行列式</span><b>{formatNumberSmart(det)}</b><small>{Math.abs(det) < 1e-9 ? '不可逆' : '可逆'}</small></div>
      <div><span>原像集合</span><b>{inverse ? '唯一原像' : wholePlane ? '整个输入平面' : consistent && columnLength > 1e-9 ? '整条原像线' : '无解'}</b>
        <small>{zeroMatrix ? '零矩阵把所有输入映到 0' : '判断来自矩阵与目标点'}</small></div>
      <div><span>零空间</span><b>{Math.abs(det) < 1e-9 ? '非零，信息丢失' : '只有零'}</b><small>过程与静态结果一致</small></div>
    </div>
  </div>;
}

export function BasisChangeExperiment({spec, values, evaluation, onChange}: SceneComponentProps) {
  const view = spec.views.find(item => item.type === 'figure') as FigureView | undefined;
  if (!view) return null;
  const pointX = numberValue(values, 'point_x', 2);
  const pointY = numberValue(values, 'point_y', 1);
  const b2x = numberValue(values, 'b2x', .8);
  const b2y = numberValue(values, 'b2y', .8);
  const degenerate = Math.abs(b2y) < 1e-9;
  const coordA = degenerate ? null : (pointX * b2y - b2x * pointY) / b2y;
  const coordB = degenerate ? null : pointY / b2y;
  const preset = (x: number, y: number, bx: number, by: number) => {
    onChange('point_x', x); onChange('point_y', y); onChange('b2x', bx); onChange('b2y', by);
  };
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>同一个物理点，两套坐标</b><span>固定 P 的位置，拖动 b₂ 改变坐标基。</span></div>
      <div className={styles.sceneButtons}>
        <button type="button" onClick={() => preset(2, 1, .8, .8)}>斜基示例</button>
        <button type="button" onClick={() => preset(2, 1, 1, 0)}>基退化</button>
      </div>
    </div>
    <div className={styles.sceneFigure}>
      <FigureSpecView view={view} spec={spec} evaluation={evaluation} stage={2} progress={1} reducedMotion draggable
        onParamChange={onChange}/>
    </div>
    <div className={styles.sceneReadout}>
      <div><span>正交基 A 坐标</span><b>({formatNumberSmart(pointX)}, {formatNumberSmart(pointY)})</b><small>固定物理位置</small></div>
      <div><span>斜基 B 坐标</span><b>{coordA === null ? '不能唯一确定' : `(${formatNumberSmart(coordA)}, ${formatNumberSmart(coordB ?? 0)})`}</b>
        <small>{degenerate ? '基退化：坐标不唯一' : '同一个点的另一组读数'}</small></div>
      <div><span>b₂</span><b>({formatNumberSmart(b2x)}, {formatNumberSmart(b2y)})</b><small>拖动端点修改斜基</small></div>
    </div>
  </div>;
}
