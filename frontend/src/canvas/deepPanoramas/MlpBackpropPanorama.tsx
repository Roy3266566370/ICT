import { useCallback, useMemo } from 'react';
import { DeepPanoramaShell, PanoramaCanvas } from '../DeepPanoramaShell';
import { clamp, finite, forwardMlp, round, trainMlpPanoramaCached, transformMlpGrid, type MlpSnapshot } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset, DeepStageRenderState } from '../deepPanoramaTypes';
import { dfOptimRun, dfTerrain } from '../deepFirst';
import type { NodeBodyProps } from '../nodes';

export const MLP_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'xor-gelu', label: 'XOR 流形折叠', patch: { scenario: 0, activation: 1, lr: 0.12, width: 6, l2: 0.0005, dropout: 0 }, note: 'GELU 把平面连续折叠成可分边界' },
  { id: 'sigmoid-vanish', label: 'Sigmoid 梯度消失', patch: { scenario: 0, activation: 3, lr: 0.08, width: 6, l2: 0, dropout: 0 }, note: '饱和 sigmoid 让上游梯度瀑布迅速衰减' },
  { id: 'spiral-overfit', label: '正则化防过拟合', patch: { scenario: 1, activation: 2, lr: 0.1, width: 7, l2: 0.008, dropout: 0.12 }, note: '双螺旋上比较 L2 与 dropout 的平滑作用' },
  { id: 'optimizer-race', label: '优化器竞速', patch: { scenario: 0, activation: 1, lr: 0.16, width: 6, l2: 0, dropout: 0 }, note: '同一狭长谷地上比较 SGD、动量、RMSProp 与 Adam' },
];

const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'activation', label: '激活函数', options: [{ value: 0, label: 'ReLU' }, { value: 1, label: 'GELU' }, { value: 2, label: 'Tanh' }, { value: 3, label: 'Sigmoid' }] },
  { key: 'lr', label: '学习率 η', min: 0.01, max: 0.32, step: 0.005, format: (v) => v.toFixed(3) },
  { key: 'width', label: '隐藏宽度', min: 2, max: 8, step: 1, format: (v) => `${Math.round(v)} 神经元` },
  { key: 'l2', label: 'L2 正则', min: 0, max: 0.02, step: 0.0005, format: (v) => v.toFixed(4) },
  { key: 'dropout', label: 'Dropout', min: 0, max: 0.5, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
];

const STAGES = ['数据与拓扑', '前向流形折叠', '损失与优化竞速', '反传梯度瀑布'] as const;
const ACT_NAMES = ['ReLU', 'GELU', 'Tanh', 'Sigmoid'];

function useSnapshot(state: DeepPanoramaRenderState): MlpSnapshot {
  const epoch = Math.round(clamp(state.frame, 0, 100));
  const scenario = Math.round(finite(state.params.scenario, 0, 0, 3));
  const activation = Math.round(finite(state.params.activation, 1, 0, 3));
  const width = Math.round(finite(state.params.width, 6, 2, 8));
  const lr = finite(state.params.lr, 0.1, 0.005, 0.5);
  const l2 = finite(state.params.l2, 0, 0, 0.05);
  const dropout = finite(state.params.dropout, 0, 0, 0.7);
  return useMemo(() => trainMlpPanoramaCached({ scenario, activation, width, lr, l2, dropout, steps: epoch }), [scenario, activation, width, lr, l2, dropout, epoch]);
}

function dataTransform(x: number, y: number, width: number, height: number): [number, number] {
  return [(x + 2.25) / 4.5 * width, height - (y + 2.25) / 4.5 * height];
}

function DecisionCanvas({ snapshot, activation, stage, epoch }: { snapshot: MlpSnapshot; activation: number; stage: number; epoch: number }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fcfbf5';
    ctx.fillRect(0, 0, width, height);
    const low = document.createElement('canvas');
    const lw = 112;
    const lh = 76;
    low.width = lw;
    low.height = lh;
    const lowCtx = low.getContext('2d');
    if (lowCtx) {
      const image = lowCtx.createImageData(lw, lh);
      for (let y = 0; y < lh; y += 1) {
        for (let x = 0; x < lw; x += 1) {
          const px = x / (lw - 1) * 4.5 - 2.25;
          const py = 2.25 - y / (lh - 1) * 4.5;
          const p = forwardMlp(snapshot.weights, px, py, activation).probability;
          const i = (y * lw + x) * 4;
          const confidence = Math.abs(p - 0.5) * 2;
          image.data[i] = p > 0.5 ? 225 - 65 * confidence : 235 - 55 * confidence;
          image.data[i + 1] = p > 0.5 ? 232 - 65 * confidence : 216 - 75 * confidence;
          image.data[i + 2] = p > 0.5 ? 252 - 15 * confidence : 176 - 88 * confidence;
          image.data[i + 3] = stage === 0 ? 80 : 235;
        }
      }
      lowCtx.putImageData(image, 0, 0);
    }
    const plotW = Math.max(40, width - 36);
    const plotH = Math.max(40, height - 46);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(low, 18, 12, plotW, plotH);
    ctx.restore();
    ctx.strokeStyle = 'rgba(23,35,31,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 12, plotW, plotH);
    if (stage === 1 && epoch > 4) {
      const grid = transformMlpGrid(snapshot.weights, activation, epoch > 45 ? 2 : 1, 9);
      const maxAbs = Math.max(0.5, ...grid.flat().flat().map(Math.abs));
      ctx.save();
      ctx.translate(width * 0.55, 12 + plotH * 0.5);
      ctx.strokeStyle = 'rgba(27,66,207,.52)';
      ctx.lineWidth = 1;
      for (let r = 0; r < grid.length; r += 1) {
        ctx.beginPath();
        grid[r]!.forEach((point, c) => {
          const x = point[0]! / maxAbs * width * 0.18 + c * 2;
          const y = -point[1]! / maxAbs * plotH * 0.24 + r * 1.4;
          if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const point of snapshot.points) {
      const [x, y] = dataTransform(point.x, point.y, plotW, plotH);
      ctx.beginPath();
      ctx.arc(18 + x, 12 + y, point.split === 'validation' ? 4.1 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = point.label ? '#1b42cf' : '#d94824';
      ctx.fill();
      ctx.lineWidth = point.split === 'validation' ? 1.4 : 0.7;
      ctx.strokeStyle = point.split === 'validation' ? '#fcfbf5' : 'rgba(252,251,245,.75)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(23,35,31,.72)';
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.fillText(stage === 1 ? '输入平面 → 隐层坐标连续折叠' : '训练点 ●  验证点 ◉', 20, height - 12);
  }, [snapshot, activation, stage, epoch]);
  return <PanoramaCanvas draw={draw} label="二维分类概率场、训练数据与隐层流形折叠" />;
}

function NetworkDiagram({ snapshot, activation }: { snapshot: MlpSnapshot; activation: number }) {
  const width = snapshot.weights.width;
  const sample = forwardMlp(snapshot.weights, 0.82, -0.76, activation);
  const xs = [18, 98, 178, 258];
  const positions = [
    [0, 1].map((i) => ({ x: xs[0]!, y: 48 + i * 72, value: i ? -0.76 : 0.82 })),
    Array.from({ length: width }, (_, i) => ({ x: xs[1]!, y: 22 + i * (132 / Math.max(1, width - 1)), value: sample.a1[i]! })),
    Array.from({ length: width }, (_, i) => ({ x: xs[2]!, y: 22 + i * (132 / Math.max(1, width - 1)), value: sample.a2[i]! })),
    [{ x: xs[3]!, y: 88, value: sample.probability }],
  ];
  const lines: JSX.Element[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const matrix = layer === 0 ? snapshot.weights.w1 : layer === 1 ? snapshot.weights.w2 : snapshot.weights.w3.map((w) => [w]);
    positions[layer]!.forEach((from, i) => {
      positions[layer + 1]!.forEach((to, j) => {
        const weight = layer === 0 ? matrix[j]?.[i] ?? 0 : matrix[j]?.[i] ?? 0;
        lines.push(<line key={`${layer}-${i}-${j}`} x1={from.x + 6} y1={from.y} x2={to.x - 6} y2={to.y} stroke={weight >= 0 ? '#1b42cf' : '#d94824'} strokeOpacity={clamp(Math.abs(weight) * 0.55, 0.08, 0.72)} strokeWidth={clamp(Math.abs(weight) * 1.5, 0.35, 2.6)} />);
      });
    });
  }
  return (
    <svg viewBox="0 0 286 176" role="img" aria-label="样本前向传播网络拓扑" style={{ width: '100%', height: '100%' }}>
      <rect width="286" height="176" rx="12" fill="rgba(242,240,231,.66)" />
      {lines}
      {positions.map((layer, layerIndex) => layer.map((node, i) => (
        <g key={`${layerIndex}-${i}`}>
          <circle cx={node.x} cy={node.y} r={layerIndex === 3 ? 10 : 7} fill={layerIndex === 3 ? (node.value > 0.5 ? '#1b42cf' : '#d94824') : '#fcfbf5'} stroke="#17231f" strokeOpacity=".42" />
          <circle cx={node.x} cy={node.y} r={(layerIndex === 3 ? 7 : 4.5) * clamp(Math.abs(node.value), 0.12, 1)} fill={layerIndex === 0 ? '#b87818' : '#1b42cf'} opacity=".58" />
        </g>
      )))}
      <text x="18" y="164" fontSize="10" fill="#6b746d">x₁=0.82, x₂=-0.76</text>
      <text x="198" y="164" fontSize="10" fill="#1b42cf">p={sample.probability.toFixed(3)}</text>
    </svg>
  );
}

function LossChart({ losses, validation, label = '训练 / 验证损失' }: { losses: number[]; validation?: number[]; label?: string }) {
  const max = Math.max(0.2, ...losses, ...(validation ?? []));
  const points = (series: number[]) => series.map((value, i) => `${8 + i / Math.max(1, series.length - 1) * 184},${82 - value / max * 68}`).join(' ');
  return (
    <svg viewBox="0 0 210 96" style={{ width: '100%', height: '100%' }} role="img" aria-label={label}>
      <rect width="210" height="96" rx="10" fill="rgba(242,240,231,.68)" />
      {[0.25, 0.5, 0.75].map((v) => <line key={v} x1="8" x2="192" y1={82 - v * 68} y2={82 - v * 68} stroke="rgba(23,35,31,.12)" />)}
      <polyline points={points(losses)} fill="none" stroke="#1b42cf" strokeWidth="2" />
      {validation ? <polyline points={points(validation)} fill="none" stroke="#d94824" strokeWidth="1.8" strokeDasharray="4 3" /> : null}
      <text x="10" y="13" fontSize="9" fill="#6b746d">{label}</text>
    </svg>
  );
}

function OptimizerRace({ epoch, lr }: { epoch: number; lr: number }) {
  const runs = useMemo(() => dfOptimRun({ terrain: 2, x: -2.6, y: 1.9, lr: clamp(lr, 0.01, 0.12), steps: Math.min(42, epoch) }, Math.min(42, epoch)), [epoch, lr]);
  const colors = ['#6b746d', '#b87818', '#16835b', '#1b42cf'];
  const project = (x: number, y: number): [number, number] => [105 + x * 31, 52 - y * 20];
  return (
    <svg viewBox="0 0 210 104" style={{ width: '100%', height: '100%' }} role="img" aria-label="四类优化器在狭长谷地上的竞速轨迹">
      <rect width="210" height="104" rx="10" fill="rgba(242,240,231,.68)" />
      {[1.2, 2.2, 3.2].map((r) => <ellipse key={r} cx="105" cy="52" rx={r * 30} ry={r * 10} fill="none" stroke="rgba(23,35,31,.13)" />)}
      {runs.map((run, index) => {
        const d = run.path.map((point, i) => {
          const [x, y] = project(point.x, point.y);
          return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ');
        const [x, y] = project(run.state.x, run.state.y);
        return <g key={run.kind}><path d={d} fill="none" stroke={colors[index]} strokeWidth="1.8" /><circle cx={x} cy={y} r="3.5" fill={colors[index]} /><text x={10 + index * 49} y="15" fontSize="8" fill={colors[index]}>{run.kind}</text></g>;
      })}
      <text x="10" y="97" fontSize="9" fill="#6b746d">狭长二次谷：x²/2 + 20y²</text>
    </svg>
  );
}

function GradientWaterfall({ snapshot }: { snapshot: MlpSnapshot }) {
  const latest = snapshot.gradientNorms[snapshot.gradientNorms.length - 1] ?? [0, 0, 0];
  const max = Math.max(1e-8, ...latest);
  return (
    <svg viewBox="0 0 210 104" style={{ width: '100%', height: '100%' }} role="img" aria-label="反向传播梯度瀑布">
      <rect width="210" height="104" rx="10" fill="rgba(242,240,231,.68)" />
      {latest.map((value, index) => {
        const height = clamp(Math.sqrt(value / max) * 62, 2, 62);
        return <g key={index}>
          <rect x={25 + index * 58} y={82 - height} width="32" height={height} rx="4" fill={index === 0 ? '#d94824' : index === 1 ? '#b87818' : '#1b42cf'} opacity=".84" />
          <text x={25 + index * 58} y="94" fontSize="8" fill="#6b746d">L{index + 1}</text>
          <text x={18 + index * 58} y={76 - height} fontSize="8" fill="#17231f">{value.toExponential(1)}</text>
        </g>;
      })}
      <text x="10" y="13" fontSize="9" fill="#6b746d">∂L/∂W 范数：输入端 → 输出端</text>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState) {
  const snapshot = useSnapshot(state);
  const activation = Math.round(finite(state.params.activation, 1, 0, 3));
  const epoch = Math.round(clamp(state.frame, 0, 100));
  const side = state.stage === 0
    ? <NetworkDiagram snapshot={snapshot} activation={activation} />
    : state.stage === 1
      ? <LossChart losses={snapshot.losses} validation={snapshot.validationLosses} />
      : state.stage === 2
        ? <OptimizerRace epoch={epoch} lr={finite(state.params.lr, 0.1)} />
        : <GradientWaterfall snapshot={snapshot} />;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(210px,.85fr)', gap: 10, padding: 12 }}>
      <div style={{ minWidth: 0, minHeight: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(23,35,31,.12)' }}>
        <DecisionCanvas snapshot={snapshot} activation={activation} stage={state.stage} epoch={epoch} />
      </div>
      <div style={{ minWidth: 0, display: 'grid', gridTemplateRows: '1fr auto', gap: 8 }}>
        {side}
        <div style={{ padding: 8, borderRadius: 9, background: 'rgba(23,35,31,.055)', color: '#6b746d', fontSize: 11, lineHeight: 1.45 }}>
          {state.stage === 0 && '一个样本从输入端流向输出端：线宽代表权重，圆心亮度代表激活。'}
          {state.stage === 1 && '决策场不是黑盒贴图：每一点都由同一组权重实时前向计算。'}
          {state.stage === 2 && `狭长谷地曲率比约 40:1，当前学习率 η=${finite(state.params.lr, 0.1).toFixed(3)}。`}
          {state.stage === 3 && '梯度乘积逐层回传；激活饱和时，输入端柱状条会先塌缩。'}
        </div>
      </div>
    </div>
  );
}

export function MlpBackpropPanorama({ node, onParams }: NodeBodyProps) {
  const base = { scenario: 0, activation: 1, lr: 0.12, width: 6, l2: 0.0005, dropout: 0 };
  const params = { ...base, ...node.params };
  return (
    <DeepPanoramaShell
      title="MLP 流形折叠与反传"
      subtitle="二维流形 × 网络拓扑 × 优化动力学"
      stages={STAGES}
      presets={MLP_PRESETS}
      params={params}
      totalSteps={101}
      controls={CONTROLS}
      onParams={onParams}
      resetPatch={base}
      stageForFrame={(frame) => frame < 16 ? 0 : frame < 52 ? 1 : frame < 78 ? 2 : 3}
      caption={(state) => {
        const epoch = Math.round(state.frame);
        return <span><strong>第 {epoch} 轮</strong> · {STAGES[state.stage]} · {ACT_NAMES[Math.round(finite(state.params.activation, 1, 0, 3))]}</span>;
      }}
      renderFormula={(state) => {
        const snapshot = trainMlpPanoramaCached({ scenario: Math.round(finite(state.params.scenario, 0, 0, 3)), activation: Math.round(finite(state.params.activation, 1, 0, 3)), width: Math.round(finite(state.params.width, 6, 2, 8)), lr: finite(state.params.lr, 0.1), l2: finite(state.params.l2, 0), dropout: finite(state.params.dropout, 0), steps: Math.round(clamp(state.frame, 0, 100)) });
        const sample = forwardMlp(snapshot.weights, 0.82, -0.76, Math.round(finite(state.params.activation, 1, 0, 3)));
        return <span>h⁽¹⁾ = σ(W⁽¹⁾x+b⁽¹⁾)　p = σ(<code>{sample.z.toFixed(3)}</code>) = <code>{sample.probability.toFixed(3)}</code>　∂L/∂h⁽¹⁾ = δ⁽²⁾W⁽²⁾⊙σ′(z⁽¹⁾)</span>;
      }}
      renderKpis={(state) => {
        const snapshot = trainMlpPanoramaCached({ scenario: Math.round(finite(state.params.scenario, 0, 0, 3)), activation: Math.round(finite(state.params.activation, 1, 0, 3)), width: Math.round(finite(state.params.width, 6, 2, 8)), lr: finite(state.params.lr, 0.1), l2: finite(state.params.l2, 0), dropout: finite(state.params.dropout, 0), steps: Math.round(clamp(state.frame, 0, 100)) });
        const grad = snapshot.gradientNorms[snapshot.gradientNorms.length - 1] ?? [0, 0, 0];
        return [
          { label: '训练损失', value: (snapshot.losses[snapshot.losses.length - 1] ?? 0).toFixed(3), tone: 'blue' },
          { label: '验证准确率', value: `${Math.round(snapshot.validationAccuracy * 100)}%`, tone: 'green' },
          { label: '首层梯度', value: (grad[0] ?? 0).toExponential(1), tone: (grad[0] ?? 0) < 1e-4 ? 'red' : 'ochre' },
          { label: 'Epoch', value: `${Math.round(clamp(state.frame, 0, 100))}/100` },
        ];
      }}
    >
      {(state) => <MainVisual {...state} />}
    </DeepPanoramaShell>
  );
}


export function MlpSourceStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={0} />;
}
export function MlpFoldStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={1} />;
}
export function MlpGradientStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={3} />;
}
export function MlpOptimizerStage(state: DeepStageRenderState) {
  return <MainVisual {...state} stage={2} />;
}
