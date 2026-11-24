import { useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortSpec } from './types.ts';
import {
  DEFAULT_LORA_MATRIX,
  DEFAULT_LOGITS,
  DEFAULT_QUANT_MATRIX,
  loraApprox,
  lossProbe,
  probabilityVector,
  quantizeMatrix,
  sampleDistribution,
  sanitizeMatrix,
  type Matrix,
} from './deepModernBlocks.ts';
import {
  BLOCK_COLORS,
  KpiRow,
  LineChart,
  Notice,
  RangeControl,
  SelectControl,
} from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

const tensorOut: PortSpec = { id: 'out', label: '张量', kind: 'tensor2d' };
const tensorIn: PortSpec = { id: 'in', label: '张量', kind: 'tensor2d' };

function inputMatrix(props: NodeBodyProps, fallback: Matrix): Matrix {
  const value = props.values.in;
  return value?.kind === 'tensor2d' ? (sanitizeMatrix(value.data) ?? fallback) : fallback;
}

function Heatmap({ matrix, ariaLabel, highlight = [] }: { matrix: Matrix; ariaLabel: string; highlight?: [number, number][] }): JSX.Element {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 1;
  const maxAbs = Math.max(1e-6, ...matrix.flat().map(Math.abs));
  const cell = Math.min(30, 190 / Math.max(rows, cols));
  return <svg className={styles.chart} viewBox={`0 0 ${cols * cell + 2} ${rows * cell + 18}`} role="img" aria-label={ariaLabel}>
    {matrix.flatMap((row, rowIndex) => row.map((value, colIndex) => {
      const ratio = Math.abs(value) / maxAbs;
      const marked = highlight.some(([r, c]) => r === rowIndex && c === colIndex);
      return <rect key={`${rowIndex}-${colIndex}`} x={colIndex * cell + 1} y={rowIndex * cell + 1} width={cell - 2} height={cell - 2} rx="2"
        fill={value >= 0 ? `rgba(79,70,229,${0.08 + ratio * 0.62})` : `rgba(177,82,54,${0.08 + ratio * 0.62})`}
        stroke={marked ? '#0d9488' : 'transparent'} strokeWidth="1.5" />;
    }))}
    <text x="3" y={rows * cell + 13}>{ariaLabel}</text>
  </svg>;
}

export function LossProbeBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const matrix = inputMatrix(props, [probabilityVector(null)]);
  const probabilities = probabilityVector(matrix);
  const result = lossProbe(probabilities, node.params.target ?? 0, node.params.gamma ?? 2);
  const target = Math.max(0, Math.min(probabilities.length - 1, Math.round(node.params.target ?? 0)));
  return <div className={styles.root}>
    <LineChart labels={result.curve.map((point) => point.p.toFixed(2))} compact={inCard} ariaLabel="MSE / 交叉熵 / Focal Loss 曲线"
      series={[
        { name: '交叉熵', values: result.curve.map((point) => point.ce), color: BLOCK_COLORS[0] },
        { name: 'MSE', values: result.curve.map((point) => point.mse), color: BLOCK_COLORS[2], dashed: true },
        { name: 'Focal', values: result.curve.map((point) => point.focal), color: BLOCK_COLORS[1], dashed: true },
      ]} />
    <div className={styles.barList}>{result.probabilities.map((value, index) => <div key={index} className={styles.barRow}>
      <span>类别 {index}{index === target ? ' · 目标' : ''}</span>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${value * 100}%`, background: index === target ? '#0d9488' : BLOCK_COLORS[index % BLOCK_COLORS.length] }} /></div>
      <b>{value.toFixed(3)}</b>
    </div>)}</div>
    <KpiRow items={[
      { label: 'MSE', value: result.losses.mse.toFixed(4) },
      { label: '交叉熵', value: result.losses.ce.toFixed(4) },
      { label: 'Focal', value: result.losses.focal.toFixed(4), tone: 'warn' },
    ]} />
    {!inCard && <div className={styles.controls}>
      <RangeControl label="目标类别" value={target} min={0} max={Math.max(0, result.probabilities.length - 1)} step={1} onChange={(value) => onParams?.({ target: value })} />
      <RangeControl label="Focal γ" value={node.params.gamma ?? 2} min={0.1} max={5} step={0.1}
        onChange={(value) => onParams?.({ gamma: Math.round(value * 1000) / 1000 })} />
      <SelectControl label="标量输出" value={node.params.metric ?? 1} options={['MSE', '交叉熵', 'Focal']} onChange={(value) => onParams?.({ metric: value })} />
      <p className={styles.tip}>输入张量按列平均成类别概率；若数值不是 0–1 概率，会先做 softmax。Focal Loss = (1−p)ᵞ·CE，用来压低易分样本的梯度。</p>
    </div>}
  </div>;
}

export function LoraAdapterBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const matrix = inputMatrix(props, DEFAULT_LORA_MATRIX);
  const rank = Math.max(1, Math.min(matrix.length, matrix[0]?.length ?? 1, Math.round(node.params.rank ?? 2)));
  const result = loraApprox(matrix, rank);
  const diff = result.approx.map((row, rowIndex) => row.map((value, colIndex) => value - (matrix[rowIndex]![colIndex] ?? 0)));
  return <div className={styles.root}>
    <div className={styles.matrixGrid}>
      <Heatmap matrix={matrix} ariaLabel="原始权重" />
      <Heatmap matrix={result.approx} ariaLabel={`LoRA 近似 r=${rank}`} />
    </div>
    <KpiRow items={[
      { label: '重构误差', value: `${(result.error * 100).toFixed(2)}%`, tone: result.error < 0.15 ? 'good' : 'warn' },
      { label: '参数量', value: `${result.adapterParams}/${result.originalParams}` },
      { label: '压缩比', value: `${(result.compression * 100).toFixed(0)}%` },
    ]} />
    {!inCard && <>
      <RangeControl label="秩 r" value={rank} min={1} max={Math.min(matrix.length, matrix[0]?.length ?? 1)} step={1} onChange={(value) => onParams?.({ rank: value })} />
      <Heatmap matrix={diff} ariaLabel="重构误差热图" />
      <p className={styles.tip}>LoRA 用 r(m+n) 个参数近似 m×n 权重矩阵；截断 SVD 同时给出压缩比和误差。秩越接近满秩，重构越准但参数越多。</p>
    </>}
  </div>;
}

export function QuantProbeBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const matrix = inputMatrix(props, DEFAULT_QUANT_MATRIX);
  const precision = Math.round(node.params.precision ?? 2);
  const result = quantizeMatrix(matrix, precision);
  return <div className={styles.root}>
    <div className={styles.matrixGrid}>
      <Heatmap matrix={matrix} ariaLabel="FP32 原始张量" />
      <Heatmap matrix={result.quantized} ariaLabel={['FP32', 'FP16', 'INT8', 'INT4'][precision] ?? '量化'} />
    </div>
    <KpiRow items={[
      { label: '最大误差', value: result.maxError.toExponential(2) },
      { label: '平均误差', value: result.meanError.toExponential(2) },
      { label: '显存', value: `${result.memoryBytes} B` },
    ]} />
    {!inCard && <>
      <SelectControl label="数值精度" value={precision} options={['FP32', 'FP16', 'INT8', 'INT4']} onChange={(value) => onParams?.({ precision: value })} />
      <p className={styles.tip}>INT8 / INT4 使用逐张量对称量化；阶梯状的近似值是量化误差来源。显存按 {result.bits} bit/参数估算，不含缩放因子和元数据。</p>
      <table className={styles.table}>
        <thead><tr><th>指标</th><th>值</th></tr></thead>
        <tbody>
          <tr><td>每参数位数</td><td>{result.bits} bit</td></tr>
          <tr><td>相对 FP32 压缩</td><td>{result.compression.toFixed(1)}×</td></tr>
          <tr><td>元素数量</td><td>{matrix.length * (matrix[0]?.length ?? 0)}</td></tr>
        </tbody>
      </table>
    </>}
  </div>;
}

export function SamplingDecoderViewBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const matrix = inputMatrix(props, [DEFAULT_LOGITS]);
  const logits = probabilityVector(matrix);
  const result = sampleDistribution(logits, node.params.temperature ?? 1, node.params.topK ?? logits.length, node.params.topP ?? 1);
  const [detail, setDetail] = useState(false);
  const kept = result.tokens.filter((item) => item.kept).length;
  return <div className={styles.root}>
    <LineChart labels={result.tokens.map((item) => `#${item.token}`)} compact={inCard} ariaLabel="采样后 Token 概率分布"
      series={[{ name: '概率', values: result.tokens.map((item) => item.probability) }]} includeZero />
    <KpiRow items={[
      { label: '保留 Token', value: `${kept}/${result.tokens.length}` },
      { label: '温度', value: result.temperature.toFixed(2) },
      { label: '最大概率', value: Math.max(0, ...result.tokens.map((item) => item.probability)).toFixed(3) },
    ]} />
    {!inCard && <>
      <RangeControl label="Temperature" value={node.params.temperature ?? 1} min={0.05} max={3} step={0.05} onChange={(value) => onParams?.({ temperature: value })} />
      <RangeControl label="Top-K" value={node.params.topK ?? logits.length} min={1} max={Math.max(1, result.tokens.length)} step={1} onChange={(value) => onParams?.({ topK: value })} />
      <RangeControl label="Top-P" value={node.params.topP ?? 1} min={0.01} max={1} step={0.01} onChange={(value) => onParams?.({ topP: value })} />
      <button type="button" className={styles.tag} onClick={() => setDetail((value) => !value)}>{detail ? '收起候选表' : '展开候选表'}</button>
      {detail ? <table className={styles.table}>
        <thead><tr><th>Token</th><th>logit</th><th>概率</th><th>保留</th></tr></thead>
        <tbody>{result.tokens.map((item) => <tr key={item.token}><td>#{item.token}</td><td>{item.logit.toFixed(2)}</td><td>{item.probability.toFixed(4)}</td><td>{item.kept ? '是' : '否'}</td></tr>)}</tbody>
      </table> : null}
      <p className={styles.tip}>先按温度缩放 logits，再做 Top-K/Top-P 截断并重新归一化。温度越低分布越尖，越高越平坦；输出视图可对照不同采样策略。</p>
    </>}
  </div>;
}

export const DEEP_MODERN_DEFS: Partial<Record<NodeType, NodeDef>> = {
  lossProbeOp: {
    title: '损失函数对比器', badge: '变换', width: 360,
    inputs: [tensorIn], outputs: [tensorOut, { id: 'loss', label: 'Loss', kind: 'scalar' }], Body: LossProbeBody,
  },
  loraAdapterOp: { title: 'LoRA 低秩适配器', badge: '变换', width: 350, inputs: [tensorIn], outputs: [tensorOut], Body: LoraAdapterBody },
  quantProbeOp: { title: '模型量化探针', badge: '变换', width: 350, inputs: [tensorIn], outputs: [tensorOut], Body: QuantProbeBody },
  samplingDecoderView: { title: 'LLM 采样解码器', badge: '视图', width: 350, inputs: [tensorIn], Body: SamplingDecoderViewBody },
};

export const DEEP_MODERN_DEFAULTS: Partial<Record<NodeType, Record<string, number>>> = {
  lossProbeOp: { target: 0, gamma: 2, metric: 1 },
  loraAdapterOp: { rank: 2 },
  quantProbeOp: { precision: 2 },
  samplingDecoderView: { temperature: 1, topK: 6, topP: 1 },
};
