import { useEffect, useMemo, useState } from 'react';
import { DeepPanoramaShell } from '../DeepPanoramaShell';
import { CNN_KERNELS, clamp, cnnInputMatrix, conv2dPanorama, finite, round, type Matrix } from '../deepPanoramaEngine';
import type { DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset } from '../deepPanoramaTypes';
import type { NodeBodyProps } from '../nodes';

export const CNN_PRESETS: readonly DeepScenarioPreset[] = [
  { id: 'edge-scan', label: '边缘扫描入门', patch: { inputPattern: 0, kernel: 0, stride: 1 }, note: '竖条输入与中心差分核逐步扫描' },
  { id: 'receptive-field', label: '感受野追光', patch: { inputPattern: 1, kernel: 0, stride: 1 }, note: '点击输出像素，观察两层 3×3 对应的 5×5 原图区域' },
  { id: 'residual-rescue', label: '残差救梯度', patch: { inputPattern: 3, kernel: 2, stride: 1 }, note: '比较纯串联与 x+F(x) 的信号保持能力' },
  { id: 'handdrawn-digit', label: '手绘数字实验', patch: { inputPattern: 3, kernel: 0, stride: 1 }, note: '直接在 12×12 画板上涂写，卷积核立即响应' },
];

const CONTROLS: readonly DeepPanoramaControl[] = [
  { key: 'kernel', label: '卷积核', options: [{ value: 0, label: '中心差分' }, { value: 1, label: '横线' }, { value: 2, label: '竖线' }, { value: 3, label: '均值模糊' }] },
  { key: 'stride', label: '步幅', min: 1, max: 2, step: 1, format: (v) => `${Math.round(v)} px` },
  { key: 'inputPattern', label: '输入底图', options: [{ value: 0, label: '竖条' }, { value: 1, label: '交叉' }, { value: 2, label: '方框' }, { value: 3, label: '数字 5' }] },
];
const STAGES = ['像素输入', '卷积扫描', '感受野回看', '残差对照'] as const;

function cellColor(value: number, max: number): string {
  const t = clamp(Math.abs(value) / Math.max(0.001, max), 0, 1);
  if (value >= 0) return `rgba(27,66,207,${0.08 + t * 0.78})`;
  return `rgba(217,72,36,${0.08 + t * 0.78})`;
}

function MatrixSvg({ matrix, cell = 15, x = 0, y = 0, highlight, maxValue, onCell, label }: {
  matrix: Matrix;
  cell?: number;
  x?: number;
  y?: number;
  highlight?: { row: number; col: number; size: number; color?: string };
  maxValue?: number;
  onCell?: (row: number, col: number) => void;
  label?: string;
}) {
  const max = maxValue ?? Math.max(0.001, ...matrix.flat().map((v) => Math.abs(v)));
  return (
    <g transform={`translate(${x} ${y})`}>
      {label ? <text x="0" y="-6" fontSize="9" fill="#6b746d">{label}</text> : null}
      {matrix.map((row, r) => row.map((value, c) => (
        <rect
          key={`${r}-${c}`}
          x={c * cell}
          y={r * cell}
          width={cell - 1}
          height={cell - 1}
          rx="1.5"
          fill={cellColor(value, max)}
          stroke="rgba(23,35,31,.08)"
          onClick={onCell ? () => onCell(r, c) : undefined}
          style={onCell ? { cursor: 'pointer' } : undefined}
        />
      )))}
      {highlight ? <rect x={highlight.col * cell - 1.5} y={highlight.row * cell - 1.5} width={highlight.size * cell + 2} height={highlight.size * cell + 2} fill="none" stroke={highlight.color ?? '#d94824'} strokeWidth="2" rx="3" /> : null}
    </g>
  );
}

function multiplication(input: Matrix, kernel: Matrix, row: number, col: number, stride: number) {
  const terms: { input: number; weight: number; product: number }[] = [];
  for (let u = 0; u < 3; u += 1) {
    for (let v = 0; v < 3; v += 1) {
      const source = input[row * stride + u]?.[col * stride + v] ?? 0;
      const weight = kernel[u]?.[v] ?? 0;
      terms.push({ input: source, weight, product: source * weight });
    }
  }
  return { terms, sum: terms.reduce((sum, term) => sum + term.product, 0) };
}

function ScanVisual({ input, kernel, output, stride, frame, onPaint, selectCell }: {
  input: Matrix;
  kernel: Matrix;
  output: Matrix;
  stride: number;
  frame: number;
  onPaint: (row: number, col: number) => void;
  selectCell: (row: number, col: number) => void;
}) {
  const rows = output.length || 1;
  const cols = output[0]?.length || 1;
  const index = Math.floor(frame) % (rows * cols);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const calc = multiplication(input, kernel, row, col, stride);
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="卷积核逐格扫描、乘加明细与输出特征图">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <MatrixSvg matrix={input} x={28} y={38} cell={24} highlight={{ row: row * stride, col: col * stride, size: 3 }} onCell={onPaint} label="12×12 输入画板（点击涂写）" />
      <g transform="translate(350 55)">
        <text x="0" y="-22" fontSize="11" fill="#17231f" fontWeight="600">当前 3×3 局部乘加</text>
        {calc.terms.map((term, i) => {
          const r = Math.floor(i / 3);
          const c = i % 3;
          return <g key={i} transform={`translate(${c * 102} ${r * 64})`}>
            <rect width="91" height="54" rx="8" fill="rgba(242,240,231,.78)" stroke="rgba(23,35,31,.12)" />
            <text x="8" y="20" fontSize="12" fill="#17231f">{round(term.input, 2)} × {round(term.weight, 2)}</text>
            <text x="8" y="40" fontSize="12" fill={term.product >= 0 ? '#1b42cf' : '#d94824'}>= {round(term.product, 2)}</text>
          </g>;
        })}
        <rect x="0" y="204" width="295" height="52" rx="9" fill="#e5eafc" stroke="#1b42cf" strokeOpacity=".24" />
        <text x="12" y="226" fontSize="10" fill="#6b746d">局部加权和</text>
        <text x="12" y="246" fontSize="19" fill="#1b42cf" fontWeight="700">{round(calc.sum, 3)}</text>
      </g>
      <MatrixSvg matrix={output} x={660} y={48} cell={24} highlight={{ row, col, size: 1, color: '#1b42cf' }} onCell={selectCell} label="输出特征图（点击定位）" />
      <path d={`M${28 + (col * stride + 3) * 24} ${38 + (row * stride + 1.5) * 24} C 390 160, 520 120, ${660 + (col + 0.5) * 24} ${48 + (row + 0.5) * 24}`} fill="none" stroke="#d94824" strokeWidth="2" strokeDasharray="7 5" opacity=".66" />
      <text x="30" y={355} fontSize="11" fill="#6b746d">扫描位置 ({row + 1}, {col + 1}) / {rows}×{cols} · 步幅 {stride}</text>
    </svg>
  );
}

function ReceptiveVisual({ input, kernel, output, frame }: { input: Matrix; kernel: Matrix; output: Matrix; frame: number }) {
  const second = conv2dPanorama(output, kernel, 1, 0);
  const rows = second.length || 1;
  const cols = second[0]?.length || 1;
  const index = Math.floor(frame) % (rows * cols);
  const row = Math.floor(index / cols);
  const col = index % cols;
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="两层 3×3 卷积对应的 5×5 感受野">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <MatrixSvg matrix={input} x={34} y={45} cell={21} highlight={{ row, col, size: 5, color: '#d94824' }} label="原输入：5×5 感受野" />
      <MatrixSvg matrix={output} x={355} y={57} cell={20} highlight={{ row, col, size: 3, color: '#b87818' }} label="第一层输出：3×3 支撑" />
      <MatrixSvg matrix={second} x={610} y={76} cell={20} highlight={{ row, col, size: 1, color: '#1b42cf' }} label="第二层输出" />
      {Array.from({ length: 3 }, (_, u) => Array.from({ length: 3 }, (_, v) => (
        <line key={`${u}-${v}`} x1={34 + (col + v + 0.5) * 21} y1={45 + (row + u + 0.5) * 21} x2={355 + (col + v + 0.5) * 20} y2={57 + (row + u + 0.5) * 20} stroke="#d94824" strokeOpacity=".18" />
      )))}
      {Array.from({ length: 3 }, (_, u) => Array.from({ length: 3 }, (_, v) => (
        <line key={`b-${u}-${v}`} x1={355 + (col + v + 0.5) * 20} y1={57 + (row + u + 0.5) * 20} x2={610 + (col + 0.5) * 20} y2={76 + (row + 0.5) * 20} stroke="#1b42cf" strokeOpacity=".18" />
      )))}
      <text x="36" y="352" fontSize="12" fill="#17231f">一个第二层像素不是只看见 3×3，而是透过两层窗口回看原图的 5×5 区域。</text>
      <text x="36" y="372" fontSize="10" fill="#6b746d">当前第二层像素 ({row + 1}, {col + 1})，光束显示信息如何从原图汇聚。</text>
    </svg>
  );
}

function ResidualChart() {
  const layers = Array.from({ length: 49 }, (_, i) => i + 1);
  const plain = layers.map((layer) => 0.88 ** layer);
  const residual = layers.map((layer) => Math.sqrt(1 + 0.18 ** 2 * layer) / Math.sqrt(1 + 0.18 ** 2 * 49));
  const points = (series: number[]) => series.map((value, i) => `${42 + i / 48 * 610},${320 - clamp(value, 0, 1.2) / 1.2 * 260}`).join(' ');
  return (
    <svg viewBox="0 0 760 390" style={{ width: '100%', height: '100%' }} role="img" aria-label="纯串联网络与残差网络的信号保持对照">
      <rect width="760" height="390" rx="14" fill="#fcfbf5" />
      <text x="44" y="44" fontSize="15" fill="#17231f" fontWeight="650">x + F(x)：给信号一条恒等高速公路</text>
      {[0, 1, 2, 3].map((i) => <line key={i} x1="42" x2="652" y1={320 - i / 3 * 260} y2={320 - i / 3 * 260} stroke="rgba(23,35,31,.11)" />)}
      <polyline points={points(plain)} fill="none" stroke="#d94824" strokeWidth="3" />
      <polyline points={points(residual)} fill="none" stroke="#1b42cf" strokeWidth="3" />
      <g transform="translate(470 86)">
        <rect width="205" height="82" rx="10" fill="rgba(242,240,231,.84)" stroke="rgba(23,35,31,.12)" />
        <line x1="15" x2="43" y1="25" y2="25" stroke="#d94824" strokeWidth="3" /><text x="51" y="29" fontSize="11" fill="#17231f">纯串联 x→F(x)</text>
        <line x1="15" x2="43" y1="55" y2="55" stroke="#1b42cf" strokeWidth="3" /><text x="51" y="59" fontSize="11" fill="#17231f">残差 x+F(x)</text>
      </g>
      <text x="42" y="365" fontSize="11" fill="#6b746d">纵轴为归一化信号/梯度尺度，横轴为网络深度。残差支路不会 magically 消除退化，但显著缓解连乘衰减。</text>
    </svg>
  );
}

function MainVisual(state: DeepPanoramaRenderState & { input: Matrix; onPaint: (row: number, col: number) => void }) {
  const kernelIndex = Math.round(finite(state.params.kernel, 0, 0, 3));
  const stride = Math.round(finite(state.params.stride, 1, 1, 2));
  const kernel = CNN_KERNELS[kernelIndex]!;
  const input = state.input;
  const output = useMemo(() => conv2dPanorama(input, kernel, stride, 0), [input, kernel, stride]);
  const paint = state.onPaint;
  const outputCells = Math.max(1, output.length * (output[0]?.length ?? 1));
  const selectCell = (row: number, col: number) => state.setParam('scanCell', row * (output[0]?.length ?? 1) + col);
  const effectiveFrame = finite(state.params.scanCell, -1, -1, 999) >= 0 && state.stage === 1
    ? finite(state.params.scanCell, 0, 0, outputCells - 1)
    : state.frame;
  if (state.stage === 2) return <ReceptiveVisual input={input} kernel={kernel} output={output} frame={state.frame} />;
  if (state.stage === 3) return <ResidualChart />;
  return <ScanVisual input={input} kernel={kernel} output={output} stride={stride} frame={effectiveFrame} onPaint={paint} selectCell={selectCell} />;
}

export function CnnResnetPanorama({ node, onParams }: NodeBodyProps) {
  const base = { inputPattern: 3, kernel: 0, stride: 1, scanCell: -1 };
  const params = { ...base, ...node.params };
  const inputPattern = Math.round(finite(params.inputPattern, 3, 0, 3));
  const [custom, setCustom] = useState<Matrix | null>(null);
  useEffect(() => setCustom(null), [inputPattern]);
  const input = custom ?? cnnInputMatrix(inputPattern);
  const paint = (row: number, col: number) => {
    setCustom((current) => {
      const next = (current ?? input).map((line) => [...line]);
      next[row]![col] = next[row]![col]! > 0.5 ? 0 : 1;
      return next;
    });
  };
  return (
    <DeepPanoramaShell
      title="CNN 卷积扫描与感受野"
      subtitle="可涂写像素 × 逐格乘加 × 残差对照"
      stages={STAGES}
      presets={CNN_PRESETS}
      params={params}
      totalSteps={(p) => {
        const matrix = cnnInputMatrix(Math.round(finite(p.inputPattern, 3, 0, 3)));
        const output = conv2dPanorama(matrix, CNN_KERNELS[Math.round(finite(p.kernel, 0, 0, 3))]!, Math.round(finite(p.stride, 1, 1, 2)), 0);
        return Math.max(1, output.length * (output[0]?.length ?? 1));
      }}
      controls={CONTROLS}
      onParams={(patch) => { if ('scanCell' in patch && patch.scanCell === -1) patch.scanCell = -1; onParams?.(patch); }}
      resetPatch={base}
      stageForFrame={(frame) => frame < 8 ? 0 : frame < 60 ? 1 : frame < 82 ? 2 : 3}
      caption={(state) => <span><strong>{STAGES[state.stage]}</strong> · 点击左侧像素可涂写，点击右侧输出像素可定位扫描窗</span>}
      renderFormula={(state) => {
        const kernel = CNN_KERNELS[Math.round(finite(state.params.kernel, 0, 0, 3))]!;
        const stride = Math.round(finite(state.params.stride, 1, 1, 2));
        const output = conv2dPanorama(input, kernel, stride, 0);
        const cols = output[0]?.length || 1;
        const idx = Math.floor(state.frame) % Math.max(1, output.length * cols);
        const calc = multiplication(input, kernel, Math.floor(idx / cols), idx % cols, stride);
        return <span>y[i,j] = ΣᵤΣᵥ x[i+u,j+v]·K[u,v]　当前 <code>{calc.terms.slice(0, 3).map((t) => round(t.product, 1)).join(' + ')} + … = {round(calc.sum, 3)}</code></span>;
      }}
      renderKpis={(state) => {
        const kernel = CNN_KERNELS[Math.round(finite(state.params.kernel, 0, 0, 3))]!;
        const output = conv2dPanorama(input, kernel, Math.round(finite(state.params.stride, 1, 1, 2)), 0);
        const flat = output.flat();
        return [
          { label: '输出尺寸', value: `${output.length}×${output[0]?.length ?? 0}`, tone: 'blue' },
          { label: '最大响应', value: round(Math.max(...flat, 0), 2).toString(), tone: 'green' },
          { label: '感受野', value: '3×3 → 5×5', tone: 'ochre' },
          { label: '残差通路', value: 'y=x+F(x)' },
        ];
      }}
    >
      {(state) => <MainVisual {...state} input={input} onPaint={paint} />}
    </DeepPanoramaShell>
  );
}
