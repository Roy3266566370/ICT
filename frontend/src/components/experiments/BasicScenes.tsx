import {useMemo, useState} from 'react';
import {boundsFromPoints, createProjector} from '@/ispec/chart';
import {ellipsePoints, matrixRank, realEigenpairs} from '@/ispec/geometry';
import {formatNumberSmart} from '@/ispec/format';
import {
  applyMat, formatMatrix, formatPoint, inverse2, multiplyMatrices,
  type Mat2, type Vec2,
} from '@/ispec/sceneMath';
import {ArrowDefs, SceneArrow, SceneAxes, polygonPoints} from './sceneChart';
import {SvdProcessExperiment} from './DecompositionScenes';
import type {SceneComponentProps} from './sceneTypes';
import styles from './ExperimentStage.module.css';

function numberValue(values: SceneComponentProps['values'], id: string, fallback: number): number {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function matrixOf(values: SceneComponentProps['values'], ids: [string, string, string, string] = ['a', 'b', 'c', 'd']): Mat2 {
  return [
    [numberValue(values, ids[0], 1), numberValue(values, ids[1], 0)],
    [numberValue(values, ids[2], 0), numberValue(values, ids[3], 1)],
  ];
}

function fmt(value: number): string {
  return formatNumberSmart(Math.abs(value) < 1e-9 ? 0 : value);
}

export function VectorFamilyExperiment({spec, values}: SceneComponentProps) {
  const [selected, setSelected] = useState(0);
  const matrix = matrixOf(values);
  const vectors = useMemo(() => {
    const ids = spec.parameters.map(parameter => parameter.id);
    const result: Array<{label: string; vector: Vec2; xId: string; yId: string}> = [];
    for (let index = 1; index <= 8; index += 1) {
      if (ids.includes(`x${index}`) && ids.includes(`y${index}`)) {
        result.push({label: `v${index}`, vector: [numberValue(values, `x${index}`, 0), numberValue(values, `y${index}`, 0)],
          xId: `x${index}`, yId: `y${index}`});
      }
    }
    return result;
  }, [spec.parameters, values]);
  const active = vectors[Math.min(selected, Math.max(0, vectors.length - 1))];
  const ellipse = ellipsePoints({a: matrix[0][0]!, b: matrix[0][1]!, c: matrix[1][0]!, d: matrix[1][1]!}, 96);
  const all = [...ellipse, ...vectors.flatMap(item => [item.vector, applyMat(matrix, item.vector)])];
  const bounds = boundsFromPoints(all, {padding: .8, minSpan: 4});
  const area = {x: 28, y: 18, w: 584, h: 324};
  const project = createProjector(area, bounds);
  const origin = project(0, 0);
  const image = active ? applyMat(matrix, active.vector) : ([0, 0] as Vec2);
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>三条向量，各自去哪了</b><span>选择一条向量：原像虚线、像实线；其余向量降低视觉权重。</span></div>
      <div className={styles.sceneButtons}>{vectors.map((item, index) => <button key={item.label} type="button"
        aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.label} {formatPoint(item.vector)}</button>)}</div>
    </div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 360" role="img" aria-label="矩阵与多条向量">
      <ArrowDefs id="vf-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <polygon points={polygonPoints(ellipse, project)} fill="#C4622D10" stroke="#C4622D" strokeWidth={1.8}/>
      {vectors.map((item, index) => {
        const imageEnd = applyMat(matrix, item.vector);
        const muted = index !== selected;
        return <g key={item.label} opacity={muted ? .28 : 1}>
          <SceneArrow from={origin} to={project(item.vector[0], item.vector[1])} color="#8B97AB" dashed/>
          <SceneArrow from={origin} to={project(imageEnd[0], imageEnd[1])} color="#16233A" marker="vf-arrow" width={2.2}/>
          <text x={project(item.vector[0], item.vector[1])[0] + 4} y={project(item.vector[0], item.vector[1])[1] - 4} fill="#8B97AB" fontSize={10}>{item.label}</text>
        </g>;
      })}
      <text x={area.x + 6} y={area.y + 14} fill="#6F7F99" fontSize={10}>A = {formatMatrix(matrix)}</text>
    </svg>
    <div className={styles.sceneReadout}>
      <div><span>选中向量</span><b>{active ? `${active.label} = ${formatPoint(active.vector)}` : '—'}</b><small>点击上方切换</small></div>
      <div><span>A·v</span><b>{active ? formatPoint(image) : '—'}</b><small>方向与长度同时更新</small></div>
      <div><span>是否共线</span><b>{active && Math.abs(active.vector[0] * image[1] - active.vector[1] * image[0]) < 1e-7 ? '是' : '否'}</b>
        <small>det(A) = {fmt(matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0])}</small></div>
    </div>
  </div>;
}

export function ColumnCombinationExperiment({values}: SceneComponentProps) {
  const [reveal, setReveal] = useState(2);
  const matrix = matrixOf(values);
  const input: Vec2 = [numberValue(values, 'input_x', 1), numberValue(values, 'input_y', 1)];
  const col1: Vec2 = [matrix[0][0], matrix[1][0]];
  const col2: Vec2 = [matrix[0][1], matrix[1][1]];
  const p1: Vec2 = [col1[0] * input[0], col1[1] * input[0]];
  const p2: Vec2 = [col2[0] * input[1], col2[1] * input[1]];
  const sum: Vec2 = [p1[0] + p2[0], p1[1] + p2[1]];
  const bounds = boundsFromPoints([[0, 0], col1, col2, p1, p2, sum], {padding: .8, minSpan: 4});
  const project = createProjector({x: 28, y: 18, w: 584, h: 324}, bounds);
  const origin = project(0, 0);
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>x 沿两列拆开，再首尾相接</b><span>输入向量决定每列取多少；第二段从第一段终点出发。</span></div>
      <div className={styles.sceneButtons}>{['第一列','第二列','合成'].map((label, index) => <button key={label} type="button"
        aria-pressed={reveal === index} onClick={() => setReveal(index)}>{label}</button>)}</div></div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 360" role="img" aria-label="列向量线性组合">
      <ArrowDefs id="cc-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <SceneArrow from={origin} to={project(col1[0], col1[1])} color="#A3AFC2" dashed/>
      <SceneArrow from={origin} to={project(col2[0], col2[1])} color="#A3AFC2" dashed/>
      {reveal >= 0 && <SceneArrow from={origin} to={project(p1[0], p1[1])} color="#16233A" width={2.4} marker="cc-arrow"/>}
      {reveal >= 1 && <SceneArrow from={project(p1[0], p1[1])} to={project(sum[0], sum[1])} color="#C4622D" width={2.4} marker="cc-arrow"/>}
      {reveal >= 2 && <SceneArrow from={origin} to={project(sum[0], sum[1])} color="#6B5CA5" width={2} marker="cc-arrow"/>}
      <text x={project(p1[0], p1[1])[0] + 4} y={project(p1[0], p1[1])[1] - 4} fill="#16233A" fontSize={10}>x₁·c₁</text>
      <text x={project(sum[0], sum[1])[0] + 4} y={project(sum[0], sum[1])[1] - 4} fill="#C4622D" fontSize={10}>x₂·c₂</text>
    </svg>
    <div className={styles.sceneFormula}>
      x = <em>{fmt(input[0])}·c₁</em> + <em>{fmt(input[1])}·c₂</em> =
      ({fmt(input[0])}·({fmt(col1[0])}, {fmt(col1[1])}) + {fmt(input[1])}·({fmt(col2[0])}, {fmt(col2[1])})) =
      <b> {formatPoint(sum)}</b>
    </div>
    <div className={styles.sceneReadout}>
      <div><span>第一列缩放</span><b>{formatPoint(p1)}</b><small>x₁ = {fmt(input[0])}</small></div>
      <div><span>第二列缩放</span><b>{formatPoint(p2)}</b><small>x₂ = {fmt(input[1])}</small></div>
      <div><span>首尾相接结果</span><b>{formatPoint(sum)}</b><small>与 A·x 一致</small></div>
    </div>
  </div>;
}

export function MatrixAdditionExperiment({values, onChange}: SceneComponentProps) {
  const [reveal, setReveal] = useState(2);
  const A: Mat2 = [[numberValue(values, 'a', 1), numberValue(values, 'b', 1)],
    [numberValue(values, 'c', 0), numberValue(values, 'd', 1)]];
  const B: Mat2 = [[numberValue(values, 'e', 0), numberValue(values, 'f', -1)],
    [numberValue(values, 'g', 1), numberValue(values, 'h', 0)]];
  const v: Vec2 = [numberValue(values, 'vx', 1), numberValue(values, 'vy', 1)];
  const av = applyMat(A, v); const bv = applyMat(B, v); const avPlusBv: Vec2 = [av[0] + bv[0], av[1] + bv[1]];
  const combined: Mat2 = [[A[0][0] + B[0][0], A[0][1] + B[0][1]], [A[1][0] + B[1][0], A[1][1] + B[1][1]]];
  const combinedV = applyMat(combined, v);
  const bounds = boundsFromPoints([[0, 0], v, av, bv, avPlusBv], {padding: .9, minSpan: 4});
  const project = createProjector({x: 28, y: 18, w: 584, h: 300}, bounds);
  const origin = project(0, 0);
  const cell = (matrix: Mat2, row: number, column: number, id: string, name: string) => <input key={id}
    type="number" step="any" aria-label={`矩阵 ${name} 第${row + 1}行第${column + 1}列`} value={matrix[row]?.[column] ?? 0}
    onChange={event => onChange(id, Number(event.target.value))}/>;
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>先各算一遍，再相加</b><span>同一个 v 分别经过 A、B；右侧核对 (A+B)v。</span></div>
      <div className={styles.sceneButtons}>{['A·v','B·v','合成'].map((label, index) => <button key={label} type="button"
        aria-pressed={reveal === index} onClick={() => setReveal(index)}>{label}</button>)}</div>
      <div className={styles.sceneInlineMatrix}><span>A</span><div className={styles.sceneMatrixGrid}>
        {(['a', 'b', 'c', 'd'] as const).map((id, index) => cell(A, Math.floor(index / 2), index % 2, id, 'A'))}</div></div>
      <div className={styles.sceneInlineMatrix}><span>B</span><div className={styles.sceneMatrixGrid}>
        {(['e', 'f', 'g', 'h'] as const).map((id, index) => cell(B, Math.floor(index / 2), index % 2, id, 'B'))}</div></div>
    </div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 340" role="img" aria-label="矩阵加法">
      <ArrowDefs id="ma-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <SceneArrow from={origin} to={project(v[0], v[1])} color="#A3AFC2" dashed/>
      {reveal >= 0 && <SceneArrow from={origin} to={project(av[0], av[1])} color="#16233A" width={2.2} marker="ma-arrow"/>}
      {reveal >= 1 && <SceneArrow from={origin} to={project(bv[0], bv[1])} color="#C4622D" width={2.2} marker="ma-arrow"/>}
      {reveal >= 2 && <SceneArrow from={origin} to={project(avPlusBv[0], avPlusBv[1])} color="#6B5CA5" width={2.6} marker="ma-arrow"/>}
      <text x={project(av[0], av[1])[0] + 5} y={project(av[0], av[1])[1] - 4} fill="#16233A" fontSize={10}>A·v</text>
      <text x={project(bv[0], bv[1])[0] + 5} y={project(bv[0], bv[1])[1] - 4} fill="#C4622D" fontSize={10}>B·v</text>
      <text x={project(avPlusBv[0], avPlusBv[1])[0] + 5} y={project(avPlusBv[0], avPlusBv[1])[1] - 4} fill="#6B5CA5" fontSize={10}>A·v+B·v</text>
    </svg>
    <div className={styles.sceneFormula}>A·v + B·v = {formatPoint(avPlusBv)}； (A+B)·v = {formatPoint(combinedV)}；两者相等</div>
    <div className={styles.sceneReadout}>
      <div><span>A·v</span><b>{formatPoint(av)}</b><small>路径一</small></div>
      <div><span>B·v</span><b>{formatPoint(bv)}</b><small>路径二</small></div>
      <div><span>(A+B)·v</span><b>{formatPoint(combinedV)}</b><small>先加矩阵，再作用</small></div>
    </div>
  </div>;
}

export function EigenDecompositionExperiment({spec, values, progress}: SceneComponentProps) {
  const matrix = matrixOf(values);
  const [showSvd, setShowSvd] = useState(false);
  const pairs = realEigenpairs({a: matrix[0][0], b: matrix[0][1], c: matrix[1][0], d: matrix[1][1]});
  const identity = Math.abs(matrix[0][0] - 1) < 1e-9 && Math.abs(matrix[1][1] - 1) < 1e-9 &&
    Math.abs(matrix[0][1]) < 1e-9 && Math.abs(matrix[1][0]) < 1e-9;
  const complete = identity || (pairs.length >= 2 &&
    Math.abs(pairs[0]!.direction[0] * pairs[1]!.direction[1] - pairs[0]!.direction[1] * pairs[1]!.direction[0]) > 1e-8);
  if (!complete || showSvd) {
    return <div className={styles.specialScene}>
      <div className={styles.sceneToolbar}>
        <div><b>{showSvd ? '正交方向分解（SVD）' : '这套特征基不存在'}</b><span>旋转 90° 没有实特征方向；可退而使用正交方向分解。</span></div>
        <div className={styles.sceneButtons}>
          <button type="button" aria-pressed={!showSvd} onClick={() => setShowSvd(false)}>特征分解</button>
          <button type="button" aria-pressed={showSvd} onClick={() => setShowSvd(true)}>查看 SVD</button>
        </div>
      </div>
      {showSvd ? <SvdProcessExperiment spec={spec} values={values} progress={progress} evaluation={{values:{},derived:{},violations:[]}} onChange={() => undefined}/> :
        <div className={styles.sceneWarning}>det = {fmt(matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0])}；实特征方向 {pairs.length} 个，无法拼出完整特征基。<br/>
          不要强行画两条独立特征方向；这正是需要 SVD 的情形。</div>}
    </div>;
  }
  const directions = identity ? ([[1, 0], [0, 1]] as Vec2[]) : pairs.map(pair => pair.direction);
  const lambdas = identity ? [1, 1] : pairs.map(pair => pair.lambda);
  const P: Mat2 = [[directions[0]![0], directions[1]![0]], [directions[0]![1], directions[1]![1]]];
  const Pinv = inverse2(P);
  const D: Mat2 = [[lambdas[0]!, 0], [0, lambdas[1]!]];
  const reconstructed = Pinv ? multiplyMatrices(multiplyMatrices(P, D), Pinv) : null;
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>沿特征基拆开 → 各自伸缩 → 拼回</b><span>P 的列是特征方向；D 是对应伸缩倍数。</span></div></div>
    <div className={styles.sceneFormula}>A = P·D·P⁻¹　P = {formatMatrix(P)}　D = {formatMatrix(D)}</div>
    <div className={styles.sceneReadout}>
      <div><span>特征值</span><b>{lambdas.map(fmt).join(' , ')}</b><small>det = {fmt(matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0])}</small></div>
      <div><span>重建 A</span><b>{reconstructed ? formatMatrix(reconstructed) : '—'}</b><small>三步等于原矩阵一次作用</small></div>
      <div><span>适用条件</span><b>存在完整实特征基</b><small>不是每个变换都满足</small></div>
    </div>
  </div>;
}

export function RelationTypesExperiment({values, onChange}: SceneComponentProps) {
  const selected = String(values.relation_case ?? 'similar');
  const A: Mat2 = [[2, 0], [0, 3]];
  const cases: Record<string, {title: string; formula: string; B: Mat2; kept: string; note: string}> = {
    equivalent: {title: '等价', formula: 'B = Q⁻¹·A·P', B: [[1, 0], [0, 1]], kept: '秩 = 2', note: '输入、输出基各换各的；只保证秩。'},
    similar: {title: '相似', formula: 'B = P⁻¹·A·P', B: [[3, 0], [0, 2]], kept: '迹 5 · 行列式 6 · 特征值 2,3 · 秩 2', note: '同一套基一起换；内蕴量全保住。'},
    congruent: {title: '合同', formula: 'B = Pᵀ·A·P', B: [[8, 0], [0, 12]], kept: '惯性指数 2 · 秩 2', note: '二次型换基；两侧都代入，出现转置。'},
  };
  const current = cases[selected] ?? cases.similar!;
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>三种换基不能混</b><span>同时看公式、可变条件和保住的量。</span></div>
      <div className={styles.sceneButtons}>{Object.entries(cases).map(([key, item]) => <button key={key} type="button"
        aria-pressed={selected === key} onClick={() => onChange('relation_case', key)}>{item.title}</button>)}</div>
    </div>
    <div className={styles.scenePanels}>
      <div className={styles.scenePanel}><h4>{current.title}</h4><p>{current.formula}</p>
        <p>A = {formatMatrix(A)}</p><p>B = {formatMatrix(current.B)}</p>
        <div className={styles.sceneMetrics}><span>保持<b>{current.kept}</b></span><span>秩<b>{matrixRank({a: current.B[0][0], b: current.B[0][1], c: current.B[1][0], d: current.B[1][1]})}</b></span></div>
      </div>
      <div className={styles.scenePanel}><h4>怎么读</h4><p>{current.note}</p>
        <p>等价只看秩；相似看特征值/迹/行列式/秩；合同看惯性指数。</p>
        <div className={styles.sceneWarning}>Q 正交时相似与合同公式外形相同，但一个换变换坐标，一个换二次型坐标。</div>
      </div>
    </div>
  </div>;
}
