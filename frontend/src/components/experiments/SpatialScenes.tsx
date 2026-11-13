import {useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {boundsFromPoints, createProjector} from '@/ispec/chart';
import {realEigenpairs} from '@/ispec/geometry';
import {formatNumberSmart} from '@/ispec/format';
import {applyMat, formatMatrix, inverse2, multiplyMatrices, type Mat2, type Vec2} from '@/ispec/sceneMath';
import {ArrowDefs, SceneArrow, SceneAxes} from './sceneChart';
import type {SceneComponentProps} from './sceneTypes';
import styles from './ExperimentStage.module.css';

function numberValue(values: SceneComponentProps['values'], id: string, fallback: number): number {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function fmt(value: number): string {
  return formatNumberSmart(Math.abs(value) < 1e-9 ? 0 : value);
}
function rankOf(rows: number[][]): number {
  const matrix = rows.map(row => [...row]);
  let rank = 0;
  for (let column = 0; column < (matrix[0]?.length ?? 0) && rank < matrix.length; column += 1) {
    let pivot = rank;
    for (let row = rank; row < matrix.length; row += 1) if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    if (Math.abs(matrix[pivot]![column]!) < 1e-9) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot]!, matrix[rank]!];
    const value = matrix[rank]![column]!;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === rank) continue;
      const factor = matrix[row]![column]! / value;
      matrix[row] = matrix[row]!.map((item, index) => item - factor * matrix[rank]![index]!);
    }
    rank += 1;
  }
  return rank;
}

const CASES = {
  embed_3x2: {
    title: '3×2 · 平面嵌进三维', inputDim: 2, outputDim: 3,
    matrix: [[1, 0], [0, 1], [0, 0]],
    note: '输出写三个坐标，第三个恒为 0；张成的仍是一张二维平面。',
  },
  project_2x3: {
    title: '2×3 · 三维压成平面', inputDim: 3, outputDim: 2,
    matrix: [[1, 0, 0], [0, 1, 0]],
    note: '第三个输入方向被丢掉；不同深度的输入可以映到同一个点。',
  },
  plane_to_line: {
    title: '2×2 · 平面压成直线', inputDim: 2, outputDim: 2,
    matrix: [[1, 1], [1, 1]],
    note: '秩 1：所有输入落到同一条直线，独立方向只剩一个。',
  },
} as const;

function project3(point: [number, number, number], azimuth: number): Vec2 {
  const c = Math.cos(azimuth); const s = Math.sin(azimuth);
  const x = point[0] * c - point[1] * s;
  const y = point[0] * s + point[1] * c;
  return [x + point[2] * .45, y + point[2] * .32];
}

export function RankSpaceExperiment({values}: SceneComponentProps) {
  const key = String(values.rank_case ?? 'embed_3x2') as keyof typeof CASES;
  const current = CASES[key] ?? CASES.embed_3x2;
  const [azimuth, setAzimuth] = useState(0.6);
  const rank = rankOf(current.matrix.map(row => [...row]));
  const samples: Array<{input: [number, number, number]; output: [number, number, number]}> = [];
  if (key === 'project_2x3') {
    const grid: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [x, y] of grid) {
      for (const z of [-1, 0, 1]) samples.push({input: [x, y, z], output: [x, y, 0]});
    }
  } else if (key === 'plane_to_line') {
    const grid: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];
    for (const [x, y] of grid) samples.push({input: [x, y, 0], output: [x + y, x + y, 0]});
  } else {
    const grid: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];
    for (const [x, y] of grid) samples.push({input: [x, y, 0], output: [x, y, 0]});
  }
  const screenPoints = samples.flatMap(sample => [project3(sample.input, azimuth), project3(sample.output, azimuth)]);
  const bounds = boundsFromPoints(screenPoints, {padding: .6, minSpan: 4});
  const project = createProjector({x: 28, y: 18, w: 584, h: 316}, bounds);
  const origin = project(...project3([0, 0, 0], azimuth));
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}>
      <div><b>{current.title}</b><span>{current.note}</span></div>
      {(key === 'embed_3x2' || key === 'project_2x3') && <label className={styles.sceneTimelineLocal}>视角
        <input type="range" min={0} max={1.4} step={.02} value={azimuth} onChange={event => setAzimuth(Number(event.target.value))}/></label>}
    </div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 350" role="img" aria-label="秩与空间映射">
      <SceneAxes project={project} bounds={bounds}/>
      {samples.map((sample, index) => {
        const input = project(...project3(sample.input, azimuth));
        const output = project(...project3(sample.output, azimuth));
        return <g key={index}><line x1={input[0]} y1={input[1]} x2={output[0]} y2={output[1]} stroke="#C9C2D8" strokeWidth={.8}/>
          <circle cx={input[0]} cy={input[1]} r={3} fill="#16233A" opacity={.7}/>
          <rect x={output[0] - 3} y={output[1] - 3} width={6} height={6} fill="#C4622D" opacity={.8}/></g>;
      })}
      <circle cx={origin[0]} cy={origin[1]} r={2.5} fill="#16233A"/>
    </svg>
    <div className={styles.sceneReadout}>
      <div><span>输入维度</span><b>{current.inputDim}</b><small>列数</small></div>
      <div><span>输出维度</span><b>{current.outputDim}</b><small>行数</small></div>
      <div><span>秩（由映射计算）</span><b>{rank}</b><small>正奇异值个数 = 秩</small></div>
    </div>
  </div>;
}

const DET_KEYS = ['unit', 'scale', 'shear', 'projection'] as const;

export function DetAreaExperiment({values, onChange}: SceneComponentProps) {
  const selected = String(values.det_case ?? 'unit');
  const index = Math.max(0, DET_KEYS.indexOf(selected as typeof DET_KEYS[number]));
  const cellMatrix = (cellIndex: number): Mat2 => {
    const cell = cellIndex === 1 ? 'cells_1' : cellIndex === 2 ? 'cells_2' : cellIndex === 3 ? 'cells_3' : 'cells_0';
    return [[numberValue(values, `${cell}_matrix_0_0`, 1), numberValue(values, `${cell}_matrix_0_1`, 0)],
      [numberValue(values, `${cell}_matrix_1_0`, 0), numberValue(values, `${cell}_matrix_1_1`, 1)]];
  };
  const matrix = cellMatrix(index);
  const c1: Vec2 = [matrix[0][0], matrix[1][0]];
  const c2: Vec2 = [matrix[0][1], matrix[1][1]];
  const signed = c1[0] * c2[1] - c1[1] * c2[0];
  const bounds = boundsFromPoints([[0, 0], [1, 0], [0, 1], [1, 1], c1, c2,
    [c1[0] + c2[0], c1[1] + c2[1]]], {padding: .7, minSpan: 3});
  const area = {x: 28, y: 18, w: 584, h: 300};
  const project = createProjector(area, bounds);
  const origin = project(0, 0);
  const scale = Math.min(area.w / (bounds.xMax - bounds.xMin), area.h / (bounds.yMax - bounds.yMin));
  const offsetX = area.x + (area.w - (bounds.xMax - bounds.xMin) * scale) / 2 - bounds.xMin * scale;
  const offsetY = area.y + (area.h - (bounds.yMax - bounds.yMin) * scale) / 2 + bounds.yMax * scale;
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  const cellPrefix = index === 1 ? 'cells_1' : index === 2 ? 'cells_2' : index === 3 ? 'cells_3' : 'cells_0';
  const updateColumn = (column: 0 | 1, point: Vec2) => {
    onChange(`${cellPrefix}_matrix_0_${column}`, Number(point[0].toFixed(3)));
    onChange(`${cellPrefix}_matrix_1_${column}`, Number(point[1].toFixed(3)));
  };
  const pointerPoint = (event: ReactPointerEvent<SVGSVGElement>): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 640;
    const y = (event.clientY - rect.top) / rect.height * 360;
    return [(x - offsetX) / scale, (offsetY - y) / scale];
  };
  const labels = DET_KEYS.map((key, cellIndex) => String(values[`cells_${cellIndex}_label`] ?? key));
  return <div className={styles.specialScene}>
    <div className={styles.sceneCards}>{DET_KEYS.map((key, cellIndex) => {
      const item = cellMatrix(cellIndex);
      return <button type="button" key={key} className={styles.sceneCard} aria-pressed={selected === key}
        onClick={() => onChange('det_case', key)}><b>{labels[cellIndex]}</b>
        <span>det = {fmt(item[0][0] * item[1][1] - item[0][1] * item[1][0])}</span></button>;
    })}</div>
    <svg ref={svg} className={styles.sceneSvg} viewBox="0 0 640 340" role="img" aria-label="有向面积"
      onPointerMove={event => {if (dragging !== null) updateColumn(dragging, pointerPoint(event));}}
      onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
      <ArrowDefs id="det-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <polygon points={`${origin[0]},${origin[1]} ${project(1, 0)[0]},${project(1, 0)[1]} ${project(1, 1)[0]},${project(1, 1)[1]} ${project(0, 1)[0]},${project(0, 1)[1]}`}
        fill="none" stroke="#A3AFC2" strokeWidth={1.2} strokeDasharray="5 4"/>
      <polygon points={[origin, project(...c1), project(c1[0] + c2[0], c1[1] + c2[1]), project(...c2)]
        .map(point => `${point[0]},${point[1]}`).join(' ')} fill="#C4622D18" stroke="#C4622D" strokeWidth={2}/>
      <SceneArrow from={origin} to={project(...c1)} color="#16233A" width={2.4} marker="det-arrow"/>
      <SceneArrow from={origin} to={project(...c2)} color="#6B5CA5" width={2.4} marker="det-arrow"/>
      {[c1, c2].map((column, columnIndex) => <circle key={columnIndex} cx={project(...column)[0]} cy={project(...column)[1]} r={7}
        fill="#fff" stroke={columnIndex ? '#6B5CA5' : '#16233A'} strokeWidth={2} style={{cursor: 'grab'}}
        onPointerDown={event => {event.preventDefault(); setDragging(columnIndex as 0 | 1);}}/>)}
      <text x={area.x + 6} y={area.y + 14} fill="#6F7F99" fontSize={10}>拖动圆点改变两条边向量</text>
    </svg>
    <div className={styles.sceneFormula}>det A = {fmt(signed)}；|det A| = {fmt(Math.abs(signed))}；{Math.abs(signed) < 1e-9 ? '两列共线，面积 0' : signed < 0 ? '定向为负（翻转）' : '定向为正'}</div>
    <div className={styles.sceneReadout}>
      <div><span>有向面积</span><b>{fmt(signed)}</b><small>交换两列会变号</small></div>
      <div><span>绝对面积</span><b>{fmt(Math.abs(signed))}</b><small>面积倍率</small></div>
      <div><span>操作</span><b><button type="button" onClick={() => {
        onChange(`${cellPrefix}_matrix_0_1`, c1[0]); onChange(`${cellPrefix}_matrix_1_1`, c1[1]);
        onChange(`${cellPrefix}_matrix_0_0`, c2[0]); onChange(`${cellPrefix}_matrix_1_0`, c2[1]);
      }}>交换两列</button></b><small>观察符号变化</small></div>
    </div>
  </div>;
}

export function PerturbationExperiment({values, onChange}: SceneComponentProps) {
  const s = Math.max(.0001, numberValue(values, 'compress_s', .01));
  const relative = Math.max(0, numberValue(values, 'perturb_relative', .001));
  const angle = numberValue(values, 'perturb_angle', 90);
  const radians = angle * Math.PI / 180;
  const x: Vec2 = [1, 0];
  const b: Vec2 = [1, 0];
  const bB: Vec2 = [s, 0];
  const deltaA: Vec2 = [relative * Math.cos(radians), relative * Math.sin(radians)];
  const deltaB: Vec2 = [relative * s * Math.cos(radians), relative * s * Math.sin(radians)];
  const xhatA: Vec2 = [1 + deltaA[0], deltaA[1] / s];
  const xhatB: Vec2 = [1 + deltaB[0] / s, deltaB[1] / s];
  const inputErrorA = Math.abs(xhatA[0] - x[0]) + Math.abs(xhatA[1] - x[1]);
  const inputErrorB = Math.abs(xhatB[0] - x[0]) + Math.abs(xhatB[1] - x[1]);
  const amplificationA = relative > 0 ? inputErrorA / relative : 0;
  const amplificationB = relative > 0 ? inputErrorB / relative : 0;
  const kappa = 1 / s;
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>扰动放大：逆存在，不等于逆好用</b><span>两组使用相同的输出相对扰动，比较输入误差与条件数上界。</span></div></div>
    <div className={styles.scenePanels}>
      <div className={styles.scenePanel}><h4>A · 只压缩纵向</h4>
        <p>A = diag(1, {fmt(s)}) · κ₂ = {fmt(kappa)}</p>
        <div className={styles.sceneMetrics}><span>准确 b<b>({fmt(b[0])}, {fmt(b[1])})</b></span>
          <span>扰动 δb<b>({fmt(deltaA[0])}, {fmt(deltaA[1])})</b></span>
          <span>恢复 x̂<b>({fmt(xhatA[0])}, {fmt(xhatA[1])})</b></span>
          <span>输入相对误差<b>{(inputErrorA * 100).toFixed(2)}%</b></span>
          <span>实际放大<b>{fmt(amplificationA)}×</b></span></div>
      </div>
      <div className={styles.scenePanel}><h4>B · 所有方向一起缩</h4>
        <p>B = {fmt(s)}·I · κ₂ = 1</p>
        <div className={styles.sceneMetrics}><span>准确 b<b>({fmt(bB[0])}, {fmt(bB[1])})</b></span>
          <span>扰动 δb<b>({fmt(deltaB[0])}, {fmt(deltaB[1])})</b></span>
          <span>恢复 x̂<b>({fmt(xhatB[0])}, {fmt(xhatB[1])})</b></span>
          <span>输入相对误差<b>{(inputErrorB * 100).toFixed(2)}%</b></span>
          <span>实际放大<b>{fmt(amplificationB)}×</b></span></div>
      </div>
    </div>
    <div className={styles.sceneFormula}>当前预设：x=(1,0)，输出相对扰动 {(relative * 100).toFixed(2)}%，方向 {fmt(angle)}°。A 的实际放大约 {fmt(amplificationA)}×，B 约 {fmt(amplificationB)}×；条件数 κ₂(A) = {fmt(kappa)}，κ₂(B)=1。</div>
    <label className={styles.sceneTimelineLocal}>压缩程度（对数）<input type="range" min={-3} max={0} step={.01} value={Math.log10(s)}
      aria-label="压缩程度对数滑块" onChange={event => onChange('compress_s', Number((10 ** Number(event.target.value)).toFixed(4)))}/>
      <b>{fmt(s)}</b></label>
    <div className={styles.sceneWarning}>该结果只针对当前预设；不要宣称任意扰动都会放大 κ 倍。实际放大与条件数上界分开理解。</div>
  </div>;
}

export function ChangeOfBasisExperiment({values}: SceneComponentProps) {
  const A: Mat2 = [[numberValue(values, 'base_a', 2), numberValue(values, 'base_b', 0)],
    [numberValue(values, 'base_c', 0), numberValue(values, 'base_d', 3)]];
  const P: Mat2 = [[numberValue(values, 'p11', .7071), numberValue(values, 'p12', .7071)],
    [numberValue(values, 'p21', -.7071), numberValue(values, 'p22', .7071)]];
  const Pinv = inverse2(P);
  const B = Pinv ? multiplyMatrices(multiplyMatrices(Pinv, A), P) : null;
  const x: Vec2 = [numberValue(values, 'input_x', 1), numberValue(values, 'input_y', .5)];
  const coords = Pinv ? applyMat(Pinv, x) : null;
  const image = applyMat(A, x);
  const eigenPairs = realEigenpairs({a: A[0][0], b: A[0][1], c: A[1][0], d: A[1][1]});
  const bounds = boundsFromPoints([[0, 0], x, image, [P[0][0], P[1][0]], [P[0][1], P[1][1]]], {padding: .8, minSpan: 3.4});
  const project = createProjector({x: 28, y: 18, w: 584, h: 300}, bounds);
  const origin = project(0, 0);
  return <div className={styles.specialScene}>
    <div className={styles.sceneToolbar}><div><b>固定物理动作，只换坐标基</b><span>P 的列是新基在旧坐标中的方向；实际点与像不动。</span></div></div>
    <svg className={styles.sceneSvg} viewBox="0 0 640 340" role="img" aria-label="换基与坐标">
      <ArrowDefs id="cb-arrow"/><SceneAxes project={project} bounds={bounds}/>
      <SceneArrow from={origin} to={project(P[0][0], P[1][0])} color="#6B5CA5" width={2} marker="cb-arrow"/>
      <SceneArrow from={origin} to={project(P[0][1], P[1][1])} color="#6B5CA5" dashed/>
      <SceneArrow from={origin} to={project(x[0], x[1])} color="#16233A" width={2.4} marker="cb-arrow"/>
      <SceneArrow from={origin} to={project(image[0], image[1])} color="#C4622D" width={2.4} marker="cb-arrow"/>
      <text x={project(x[0], x[1])[0] + 4} y={project(x[0], x[1])[1] - 4} fill="#16233A" fontSize={10}>x 固定</text>
      <text x={project(image[0], image[1])[0] + 4} y={project(image[0], image[1])[1] - 4} fill="#C4622D" fontSize={10}>A·x 固定</text>
    </svg>
    <div className={styles.sceneFormula}>A = {formatMatrix(A)}　P = {formatMatrix(P)}　B = P⁻¹·A·P = {B ? formatMatrix(B) : 'P 不可逆'}</div>
    <div className={styles.sceneReadout}>
      <div><span>旧坐标 x</span><b>{`(${fmt(x[0])}, ${fmt(x[1])})`}</b><small>物理点不变</small></div>
      <div><span>新坐标 P⁻¹x</span><b>{coords ? `(${fmt(coords[0])}, ${fmt(coords[1])})` : '—'}</b><small>随 P 改变</small></div>
      <div><span>不变量</span><b>特征值 {eigenPairs.map(pair => fmt(pair.lambda)).join(',')} · 迹 {fmt(A[0][0] + A[1][1])} · det {fmt(A[0][0] * A[1][1] - A[0][1] * A[1][0])} · 秩 {rankOf(A.map(row => [...row]))}</b><small>B 与 A 相同；P 为实验条件</small></div>
    </div>
  </div>;
}
