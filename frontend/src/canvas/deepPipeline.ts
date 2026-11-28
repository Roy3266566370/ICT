import type { CanvasDoc, CanvasNode, PortSpec, PortValue, Wire } from './types.ts';
import type { DeepPanoramaKind } from './deepPanoramaTypes.ts';
import { nextId } from './math.ts';
import {
  CNN_KERNELS,
  clamp,
  cnnInputMatrix,
  conv2dPanorama,
  demoLoraMatrix,
  diffusionScore,
  diffusionTrajectoryCached,
  entropy,
  finite,
  forwardMlp,
  rlTransition,
  trainMlpPanoramaCached,
  trainRlPanoramaCached,
  transformerPanorama,
  type Matrix,
} from './deepPanoramaEngine.ts';
import {
  dfCacheCounts,
  dfCacheLogits,
  dfCacheSequence,
  dfOptimRun,
  dfSampleDistribution,
} from './deepFirst.ts';
import { loraApprox, quantizeMatrix } from './deepModernBlocks.ts';

export type DeepStageId = 'source' | 'core' | 'viewA' | 'viewB';
export type DeepDataValue = Extract<PortValue, { kind: 'deepData' }>;

export interface DeepStageControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface DeepStageMetric {
  id: string;
  label: string;
  select: (state: Record<string, unknown>) => number;
}

export interface DeepStageDef {
  id: DeepStageId;
  title: string;
  inputLabel: string;
  outputLabel: string;
  width: number;
  controls?: readonly DeepStageControl[];
  metric?: DeepStageMetric;
}

export interface DeepSliderDef extends DeepStageControl {
  targets: readonly DeepStageId[];
}

export interface DeepPipelineDef {
  kind: DeepPanoramaKind;
  title: string;
  task: string;
  defaults: Record<string, number>;
  totalSteps: (params: Record<string, number>) => number;
  sliders: readonly DeepSliderDef[];
  stages: readonly DeepStageDef[];
}

const CONTROL = (key: string, label: string, min: number, max: number, step: number): DeepStageControl => ({ key, label, min, max, step });

function nested(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = state[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function numberField(object: Record<string, unknown>, key: string, fallback = 0): number {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) || !value.length) return null;
  if (!value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'number' && Number.isFinite(cell)))) return null;
  return value as Matrix;
}

function metricNumber(state: Record<string, unknown>, stage: string, key: string, fallback = 0): number {
  return numberField(nested(state, stage), key, fallback);
}

const STAGE_WIDTH = { source: 340, core: 420, view: 420 } as const;

function stage(id: DeepStageId, title: string, inputLabel: string, outputLabel: string, options: Partial<Pick<DeepStageDef, 'controls' | 'metric' | 'width'>> = {}): DeepStageDef {
  return {
    id,
    title,
    inputLabel,
    outputLabel,
    width: options.width ?? (id === 'source' ? STAGE_WIDTH.source : id === 'core' ? STAGE_WIDTH.core : STAGE_WIDTH.view),
    ...(options.controls ? { controls: options.controls } : {}),
    ...(options.metric ? { metric: options.metric } : {}),
  };
}

export const DEEP_PIPELINES: Record<DeepPanoramaKind, DeepPipelineDef> = {
  'dl-mlp-backprop': {
    kind: 'dl-mlp-backprop',
    title: 'MLP 流形折叠与反传沙盘',
    task: '探究任务：播放训练过程，比较 GELU/Tanh/Sigmoid 下流形折叠速度、逐层梯度衰减与四类优化器在狭长谷地上的差异。',
    defaults: { scenario: 0, activation: 1, lr: 0.12, width: 6, l2: 0.0005, dropout: 0 },
    totalSteps: () => 101,
    sliders: [
      { ...CONTROL('lr', '学习率 η', 0.01, 0.32, 0.005), targets: ['source', 'viewB'] },
      { ...CONTROL('activation', '激活函数 0–3', 0, 3, 1), targets: ['source'] },
    ],
    stages: [
      stage('source', '数据集与训练控台', '数据流', '数据流', { controls: [CONTROL('lr', '学习率 η', 0.01, 0.32, 0.005), CONTROL('activation', '激活函数', 0, 3, 1)] }),
      stage('core', 'MLP 前向与流形折叠', '数据流', '特征流'),
      stage('viewA', '逐层反向梯度瀑布', '特征流', '梯度流'),
      stage('viewB', '优化器地形竞速台', '特征流', '超参流', {
        controls: [CONTROL('lr', '学习率 η', 0.01, 0.32, 0.005)],
        metric: { id: 'loss', label: '最优 loss', select: (state) => metricNumber(state, 'viewB', 'bestLoss') },
      }),
    ],
  },
  'dl-cnn-resnet': {
    kind: 'dl-cnn-resnet',
    title: 'CNN 卷积扫描与感受野沙盘',
    task: '探究任务：涂写 12×12 输入，逐格核对 3×3 乘加账本；再追光两层感受野，并比较纯串联与 ResNet 残差通路的信号保持。',
    defaults: { inputPattern: 3, kernel: 0, stride: 1, scanCell: -1, depth: 12 },
    totalSteps: (params) => {
      const input = cnnInputMatrix(Math.round(finite(params.inputPattern, 3, 0, 3)));
      const output = conv2dPanorama(input, CNN_KERNELS[Math.round(finite(params.kernel, 0, 0, 3))]!, Math.round(finite(params.stride, 1, 1, 2)), 0);
      return Math.max(1, output.length * (output[0]?.length ?? 1));
    },
    sliders: [
      { ...CONTROL('kernel', '卷积核预设', 0, 3, 1), targets: ['source'] },
      { ...CONTROL('depth', '网络深度 1–12', 1, 12, 1), targets: ['viewB'] },
    ],
    stages: [
      stage('source', '12×12 手绘像素源', '图像流', '图像流', { controls: [CONTROL('kernel', '卷积核', 0, 3, 1)] }),
      stage('core', '3×3 卷积滑窗扫描', '图像流', '特征流'),
      stage('viewA', '双层感受野光束透视', '特征流', '感受野流'),
      stage('viewB', 'ResNet 残差梯度对照', '特征流', '深度流', {
        controls: [CONTROL('depth', '网络深度', 1, 12, 1)],
        metric: { id: 'gradient', label: '残差梯度比', select: (state) => metricNumber(state, 'viewB', 'gradientRatio', 1) },
      }),
    ],
  },
  'dl-transformer-attention': {
    kind: 'dl-transformer-attention',
    title: 'Transformer 注意力全景沙盘',
    task: '探究任务：点击查询词元观察注意力弧线；调节 dₖ 与位置偏移，比较缩放/未缩放 softmax 的熵和多头长程依赖。',
    defaults: { dk: 16, offset: 0, encoding: 1, scaleMode: 1, query: 4 },
    totalSteps: () => 90,
    sliders: [
      { ...CONTROL('dk', '键维度 dₖ', 2, 64, 1), targets: ['source', 'core'] },
      { ...CONTROL('offset', 'RoPE 位置偏移', -8, 8, 1), targets: ['source'] },
    ],
    stages: [
      stage('source', '词元嵌入与位置编码', '编码流', '编码流', {
        controls: [CONTROL('dk', '键维度 dₖ', 2, 64, 1), CONTROL('offset', '位置偏移', -8, 8, 1)],
      }),
      stage('core', 'Q/K/V 投影与缩放 A/B', '编码流', '权重流', { controls: [CONTROL('dk', '键维度 dₖ', 2, 64, 1)] }),
      stage('viewA', '注意力弧线主舞台', '权重流', '注意力流', {
        metric: { id: 'entropy', label: '注意力熵', select: (state) => metricNumber(state, 'viewA', 'attentionEntropy') },
      }),
      stage('viewB', '多头并行 vs RNN 衰减', '权重流', '对照流'),
    ],
  },
  'dl-llm-inference-lora': {
    kind: 'dl-llm-inference-lora',
    title: 'LLM 推理、KV-cache 与 LoRA 沙盘',
    task: '探究任务：播放逐 token 生成，核对 KV-cache 节省的 MAC 账本；再调节采样漏斗与 LoRA rank/量化精度，观察候选和质量代价。',
    defaults: { mode: 0, temperature: 1, topk: 10, topp: 1, rank: 2, quant: 0 },
    totalSteps: () => 64,
    sliders: [
      { ...CONTROL('temperature', '采样温度 T', 0.2, 2.4, 0.05), targets: ['source', 'viewA'] },
      { ...CONTROL('rank', 'LoRA 秩 r', 1, 6, 1), targets: ['viewB'] },
    ],
    stages: [
      stage('source', '上下文与生成控台', '步进流', '步进流', { controls: [CONTROL('temperature', '采样温度 T', 0.2, 2.4, 0.05)] }),
      stage('core', 'Decode 与 KV-Cache 复用', '步进流', 'Logits 流'),
      stage('viewA', '温度 / Top-k / Top-p 采样漏斗', 'Logits 流', '采样流', {
        controls: [CONTROL('temperature', '采样温度 T', 0.2, 2.4, 0.05)],
        metric: { id: 'entropy', label: '采样熵', select: (state) => metricNumber(state, 'viewA', 'sampleEntropy') },
      }),
      stage('viewB', 'LoRA 低秩与量化误差', 'Logits 流', '秩流', {
        controls: [CONTROL('rank', 'LoRA 秩 r', 1, 6, 1)],
        metric: { id: 'error', label: 'LoRA 误差', select: (state) => metricNumber(state, 'viewB', 'loraError') },
      }),
    ],
  },
  'dl-diffusion-latent': {
    kind: 'dl-diffusion-latent',
    title: '扩散轨迹与潜空间沙盘',
    task: '探究任务：播放前向加噪与反向去噪，观察解析 score 场如何把粒子推回流形；再用 anchor 与温度 τ 拆解 InfoNCE 力场。',
    defaults: { scenario: 2, beta: 3, steps: 30, anchorX: 0.6, anchorY: 0.2, tau: 1 },
    totalSteps: (params) => Math.round(finite(params.steps, 30, 8, 42)) * 2 + 1,
    sliders: [
      { ...CONTROL('time', '扩散时间 t', 0, 4, 0.02), targets: ['source'] },
      { ...CONTROL('tau', '对比温度 τ', 0.1, 2, 0.05), targets: ['viewB'] },
    ],
    stages: [
      stage('source', '数据流形与噪声调度', '时序流', '时序流', { controls: [CONTROL('time', '扩散时间 t', 0, 4, 0.02)] }),
      stage('core', '正向加噪与密度云图', '时序流', '密度流'),
      stage('viewA', 'Score 矢量场与反向去噪', '密度流', 'Score 流'),
      stage('viewB', '潜空间与 InfoNCE 力场', '密度流', '温度流', {
        controls: [CONTROL('tau', '对比温度 τ', 0.1, 2, 0.05)],
        metric: { id: 'nce', label: 'InfoNCE', select: (state) => metricNumber(state, 'viewB', 'nceLoss') },
      }),
    ],
  },
  'dl-rl-agent': {
    kind: 'dl-rl-agent',
    title: '强化学习智能体进化沙盘',
    task: '探究任务：播放悬崖迷宫训练回合，点击格子查看贝尔曼更新；比较 γ、ε 与 REINFORCE 对回报收敛和路径风险的影响。',
    defaults: { alpha: 0.18, gamma: 0.95, epsilon: 0.22, reinforce: 0, selectedState: 30 },
    totalSteps: () => 160,
    sliders: [
      { ...CONTROL('gamma', '折扣因子 γ', 0, 1, 0.01), targets: ['source'] },
      { ...CONTROL('epsilon', '探索率 ε', 0, 0.8, 0.01), targets: ['source'] },
    ],
    stages: [
      stage('source', '6×6 悬崖环境与超参', '环境流', '环境流', {
        controls: [CONTROL('gamma', '折扣因子 γ', 0, 1, 0.01), CONTROL('epsilon', '探索率 ε', 0, 0.8, 0.01)],
      }),
      stage('core', 'Agent 实时探索迷宫', '环境流', '轨迹流'),
      stage('viewA', 'Q 值热力与策略指南针', '轨迹流', '策略流'),
      stage('viewB', 'Bellman 拆解与回报曲线', '轨迹流', '回报流', {
        metric: { id: 'return', label: '最新回报', select: (state) => metricNumber(state, 'viewB', 'latestReturn') },
      }),
    ],
  },
};

export function findDeepStage(
  node: Pick<CanvasNode, 'type' | 'payload'>,
): { pipeline: DeepPipelineDef; stage: DeepStageDef } | undefined {
  if (node.type !== 'deepStage' || !node.payload) return undefined;
  const [pipelineKind, stageId] = node.payload.split('/');
  const pipeline = DEEP_PIPELINES[pipelineKind as DeepPanoramaKind];
  const stageDef = pipeline?.stages.find(({ id }) => id === stageId);
  return pipeline && stageDef ? { pipeline, stage: stageDef } : undefined;
}

export function deepPipelinePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  const definition = findDeepStage(node);
  if (!definition) return [];
  const { stage: stageDef } = definition;
  if (dir === 'out') {
    const ports: PortSpec[] = [{ id: 'out', label: stageDef.outputLabel, kind: 'deepData' }];
    if (stageDef.metric) ports.push({ id: stageDef.metric.id, label: stageDef.metric.label, kind: 'scalar' });
    return ports;
  }
  const ports: PortSpec[] = [];
  if (stageDef.id !== 'source') ports.push({ id: 'in', label: stageDef.inputLabel, kind: 'deepData' });
  for (const control of stageDef.controls ?? []) ports.push({ id: control.key, label: control.label, kind: 'scalar' });
  return ports;
}

function mlpSnapshot(params: Record<string, number>, frame: number) {
  return trainMlpPanoramaCached({
    scenario: Math.round(finite(params.scenario, 0, 0, 3)),
    activation: Math.round(finite(params.activation, 1, 0, 3)),
    width: Math.round(finite(params.width, 6, 2, 8)),
    lr: finite(params.lr, 0.1, 0.005, 0.5),
    l2: finite(params.l2, 0, 0, 0.05),
    dropout: finite(params.dropout, 0, 0, 0.7),
    steps: Math.round(clamp(frame, 0, 100)),
  });
}

function computeMlpStage(stageId: DeepStageId, params: Record<string, number>, frame: number): Record<string, unknown> {
  const epoch = Math.round(clamp(frame, 0, 100));
  const snapshot = mlpSnapshot(params, frame);
  if (stageId === 'source') return { snapshot, epoch, samples: snapshot.points.length };
  const activation = Math.round(finite(params.activation, 1, 0, 3));
  const sample = forwardMlp(snapshot.weights, 0.82, -0.76, activation);
  if (stageId === 'core') return { snapshot, epoch, sample, activation, loss: snapshot.losses[snapshot.losses.length - 1] ?? 0 };
  if (stageId === 'viewA') {
    const gradient = snapshot.gradientNorms[snapshot.gradientNorms.length - 1] ?? [0, 0, 0];
    return { snapshot, epoch, gradient, losses: snapshot.losses, validationLosses: snapshot.validationLosses, loss: snapshot.losses[snapshot.losses.length - 1] ?? 0 };
  }
  const steps = Math.min(42, Math.max(1, epoch));
  const runs = dfOptimRun({ terrain: 2, x: -2.6, y: 1.9, lr: clamp(finite(params.lr, 0.1), 0.01, 0.12), steps }, steps);
  return { epoch, runs, bestLoss: Math.min(...runs.map((run) => run.loss)), steps };
}

function convMoment(input: Matrix, kernel: Matrix, row: number, col: number, stride: number): number {
  let sum = 0;
  for (let u = 0; u < kernel.length; u += 1) for (let v = 0; v < (kernel[u]?.length ?? 0); v += 1) {
    sum += (input[row * stride + u]?.[col * stride + v] ?? 0) * (kernel[u]?.[v] ?? 0);
  }
  return sum;
}

function computeCnnStage(stageId: DeepStageId, params: Record<string, number>, frame: number, upstreamState: Record<string, unknown>, localState?: Record<string, unknown>): Record<string, unknown> {
  const pattern = Math.round(finite(params.inputPattern, 3, 0, 3));
  const inheritedInput = asMatrix(nested(upstreamState, 'source').inputMatrix);
  const painted = asMatrix(localState?.inputMatrix);
  const input = (stageId === 'source' ? painted ?? inheritedInput : inheritedInput) ?? cnnInputMatrix(pattern);
  const kernel = CNN_KERNELS[Math.round(finite(params.kernel, 0, 0, 3))] ?? CNN_KERNELS[0]!;
  const stride = Math.round(finite(params.stride, 1, 1, 2));
  const output = conv2dPanorama(input, kernel, stride, 0);
  const rows = Math.max(1, output.length);
  const cols = Math.max(1, output[0]?.length ?? 1);
  const index = Math.floor(clamp(frame, 0, rows * cols - 0.001)) % (rows * cols);
  const scanRow = Math.floor(index / cols);
  const scanCol = index % cols;
  if (stageId === 'source') return { inputMatrix: input, inputPattern: pattern, rows: input.length, cols: input[0]?.length ?? 0, painted: Boolean(painted) };
  if (stageId === 'core') return { inputMatrix: input, kernel, stride, output, scanRow, scanCol, scanSum: convMoment(input, kernel, scanRow, scanCol, stride), maxResponse: Math.max(0, ...output.flat()) };
  if (stageId === 'viewA') {
    const second = conv2dPanorama(output, kernel, 1, 0);
    const secondRows = Math.max(1, second.length);
    const secondCols = Math.max(1, second[0]?.length ?? 1);
    const secondIndex = Math.floor(clamp(frame, 0, secondRows * secondCols - 0.001)) % (secondRows * secondCols);
    return { inputMatrix: input, kernel, output, second, row: Math.floor(secondIndex / secondCols), col: secondIndex % secondCols, receptiveSize: 5 };
  }
  const depth = Math.round(finite(params.depth, 12, 1, 12));
  const layers = Array.from({ length: 49 }, (_, i) => i + 1);
  const plain = layers.map((layer) => 0.88 ** layer);
  const residual = layers.map((layer) => Math.sqrt(1 + 0.18 ** 2 * layer) / Math.sqrt(1 + 0.18 ** 2 * 49));
  const at = clamp(depth, 1, 49) - 1;
  return { depth, plain, residual, gradientRatio: (residual[at] ?? 1) / Math.max(1e-9, plain[at] ?? 1) };
}

function computeTransformerStage(stageId: DeepStageId, params: Record<string, number>): Record<string, unknown> {
  const dk = Math.round(finite(params.dk, 16, 2, 64));
  const offset = Math.round(finite(params.offset, 0, -8, 8));
  const encoding = Math.round(finite(params.encoding, 1, 0, 1));
  const query = Math.round(finite(params.query, 4, 0, 5));
  const data = transformerPanorama(dk, offset, encoding);
  if (stageId === 'source') return { data, tokens: data.tokens, encoding, offset, dk };
  const scaledEntropy = data.scaled.map(entropy);
  const unscaledEntropy = data.unscaled.map(entropy);
  if (stageId === 'core') return { data, scaledEntropy, unscaledEntropy, meanScaledEntropy: scaledEntropy.reduce((s, x) => s + x, 0) / scaledEntropy.length, meanUnscaledEntropy: unscaledEntropy.reduce((s, x) => s + x, 0) / unscaledEntropy.length };
  if (stageId === 'viewA') {
    const matrix = Math.round(finite(params.scaleMode, 1, 0, 1)) ? data.scaled : data.unscaled;
    const row = matrix[query] ?? [];
    return { data, query, row, attentionEntropy: entropy(row), scaleMode: Math.round(finite(params.scaleMode, 1, 0, 1)) };
  }
  return { data, localEntropy: data.headLocal.map(entropy), longEntropy: data.headLong.map(entropy), rnnDecay: Array.from({ length: 32 }, (_, i) => 0.82 ** i) };
}

function computeLlmStage(stageId: DeepStageId, params: Record<string, number>, frame: number): Record<string, unknown> {
  const step = clamp(Math.floor(frame / 16) + 1, 1, 4);
  const counts = dfCacheCounts(step, 8);
  if (stageId === 'source') return { step, counts, promptTokens: ['给出', '一个', '深度学习', '比喻'], generated: dfCacheSequence(4, finite(params.temperature, 1), finite(params.topk, 10), finite(params.topp, 1)) };
  if (stageId === 'core') return { step, counts, saving: 1 - counts.totalWith / Math.max(1, counts.totalWithout), totalWith: counts.totalWith, totalWithout: counts.totalWithout };
  if (stageId === 'viewA') {
    const sample = dfSampleDistribution(dfCacheLogits(step), finite(params.temperature, 1), finite(params.topk, 10), finite(params.topp, 1));
    return { step, sample, sampleEntropy: entropy(sample.probabilities), kept: sample.kept.length };
  }
  const base = demoLoraMatrix();
  const lora = loraApprox(base, finite(params.rank, 2, 1, 6));
  const quant = quantizeMatrix(base, finite(params.quant, 0, 0, 3));
  return { base, lora, quant, loraError: lora.error, compression: lora.compression, quantMaxError: quant.maxError };
}

function diffusionFrame(params: Record<string, number>, frame: number): { index: number; t: number; forward: boolean; steps: number } {
  const steps = Math.round(finite(params.steps, 30, 8, 42));
  const phase = clamp(frame, 0, steps * 2);
  const forwardPhase = phase <= steps;
  let index = Math.round(forwardPhase ? steps - phase : phase - steps);
  let t = forwardPhase ? 4 * phase / Math.max(1, steps) : 4 * (1 - index / Math.max(1, steps));
  let forward = forwardPhase;
  if (params.time !== undefined && Number.isFinite(params.time)) {
    t = clamp(params.time, 0, 4);
    index = Math.round(steps * (1 - t / 4));
    forward = true;
  }
  return { index: clamp(index, 0, steps), t, forward, steps };
}

function computeDiffusionStage(stageId: DeepStageId, params: Record<string, number>, frame: number): Record<string, unknown> {
  const scenario = Math.round(finite(params.scenario, 2, 0, 3));
  const beta = finite(params.beta, 3, 1, 5);
  const steps = Math.round(finite(params.steps, 30, 8, 42));
  const trajectory = diffusionTrajectoryCached({ scenario, steps, beta });
  const timing = diffusionFrame(params, frame);
  const index = timing.index;
  if (stageId === 'source') return { trajectory, scenario, beta, steps, alphaBar: trajectory.alphaBar, centers: trajectory.mixture.centers };
  const points = trajectory.frames[index] ?? [];
  const logDensity = trajectory.logDensity[index] ?? 0;
  const alpha = trajectory.alphaBar[index] ?? 0;
  if (stageId === 'core') return { trajectory, points, index, t: timing.t, forward: timing.forward, logDensity, alpha, beta };
  if (stageId === 'viewA') {
    const arrows: { x: number; y: number; vx: number; vy: number }[] = [];
    for (let gy = 0; gy < 5; gy += 1) for (let gx = 0; gx < 7; gx += 1) {
      const x = -2.1 + gx * 0.7;
      const y = -1.65 + gy * 0.82;
      const score = diffusionScore([x, y], timing.t, trajectory.mixture.centers, trajectory.mixture.variance, beta).score;
      arrows.push({ x, y, vx: score[0], vy: score[1] });
    }
    return { trajectory, points, index, t: timing.t, forward: timing.forward, arrows, logDensity, beta };
  }
  const anchor: [number, number] = [finite(params.anchorX, 0.6, -1.6, 1.6), finite(params.anchorY, 0.2, -1.6, 1.6)];
  const positives = trajectory.mixture.centers.filter((_, i) => i % 12 === 0).slice(0, 4);
  const positive = positives[0] ?? [0, 0];
  const distance = Math.hypot(anchor[0] - positive[0]!, anchor[1] - positive[1]!);
  const tau = finite(params.tau, 1, 0.1, 2);
  const similarity = Math.exp(-distance / tau);
  return { trajectory, anchor, positives, distance, tau, similarity, nceLoss: -Math.log(Math.max(1e-9, similarity)) };
}

function computeRlStage(stageId: DeepStageId, params: Record<string, number>, frame: number): Record<string, unknown> {
  const episodes = clamp(Math.floor(frame) + 1, 1, 160);
  const alpha = finite(params.alpha, 0.18, 0.001, 1);
  const gamma = finite(params.gamma, 0.95, 0, 1);
  const epsilon = finite(params.epsilon, 0.22, 0, 1);
  const reinforce = finite(params.reinforce, 0, 0, 1);
  const snapshot = trainRlPanoramaCached({ episodes, alpha, gamma, epsilon, reinforce });
  if (stageId === 'source') return { snapshot, episodes, alpha, gamma, epsilon, reinforce };
  const path = snapshot.lastPath.length ? snapshot.lastPath : [30];
  const pathIndex = Math.floor(frame * 3) % path.length;
  const agent = path[pathIndex] ?? 30;
  if (stageId === 'core') return { snapshot, episodes, path, pathIndex, agent };
  const selected = Math.round(finite(params.selectedState, 30, 0, 35));
  const row = snapshot.table[selected] ?? [0, 0, 0, 0];
  const action = row.indexOf(Math.max(...row));
  if (stageId === 'viewA') return { snapshot, episodes, selected, qValues: row, bestAction: action, stateValue: Math.max(...row) };
  const transition = rlTransition(selected, action);
  const nextMax = Math.max(...(snapshot.table[transition.next] ?? [0, 0, 0, 0]));
  const current = row[action] ?? 0;
  const target = transition.reward + (transition.done ? 0 : gamma * nextMax);
  return { snapshot, episodes, selected, action, transition, current, target, tdError: target - current, nextMax, latestReturn: snapshot.returns[snapshot.returns.length - 1] ?? 0, latestSteps: snapshot.steps[snapshot.steps.length - 1] ?? 0 };
}

export function computeDeepStageState(
  pipeline: DeepPanoramaKind,
  stageId: DeepStageId,
  params: Record<string, number>,
  frame: number,
  upstreamState: Record<string, unknown>,
  localState?: Record<string, unknown>,
): Record<string, unknown> {
  switch (pipeline) {
    case 'dl-mlp-backprop': return computeMlpStage(stageId, params, frame);
    case 'dl-cnn-resnet': return computeCnnStage(stageId, params, frame, upstreamState, localState);
    case 'dl-transformer-attention': return computeTransformerStage(stageId, params);
    case 'dl-llm-inference-lora': return computeLlmStage(stageId, params, frame);
    case 'dl-diffusion-latent': return computeDiffusionStage(stageId, params, frame);
    case 'dl-rl-agent': return computeRlStage(stageId, params, frame);
  }
}

function scalarOverride(value: PortValue | null | undefined): number | undefined {
  return value?.kind === 'scalar' && Number.isFinite(value.v) ? value.v : undefined;
}

export function computeDeepStageValue(
  node: CanvasNode,
  values: Record<string, PortValue | null | undefined>,
  options: { frameOverride?: number; localState?: Record<string, unknown>; playing?: boolean } = {},
): DeepDataValue | null {
  const definition = findDeepStage(node);
  if (!definition) return null;
  const { pipeline, stage: stageDef } = definition;
  const upstreamValue = values.in;
  const upstream = upstreamValue?.kind === 'deepData' && upstreamValue.pipeline === pipeline.kind ? upstreamValue : null;
  const params: Record<string, number> = {
    ...pipeline.defaults,
    ...(upstream?.params ?? {}),
    ...Object.fromEntries(Object.entries(node.params).filter(([, value]) => Number.isFinite(value))),
  };
  for (const control of stageDef.controls ?? []) {
    const override = scalarOverride(values[control.key]);
    if (override !== undefined) params[control.key] = clamp(override, control.min, control.max);
  }
  if (options.playing && pipeline.kind === 'dl-diffusion-latent' && stageDef.id === 'source') delete params.time;
  const frame = finite(options.frameOverride ?? upstream?.frame ?? node.params.frame ?? 0, 0, -1e4, 1e4);
  const state = computeDeepStageState(pipeline.kind, stageDef.id, params, frame, upstream?.state ?? {}, options.localState);
  return { kind: 'deepData', pipeline: pipeline.kind, stage: stageDef.id, params, frame, state: { ...(upstream?.state ?? {}), [stageDef.id]: state } };
}

export function evaluateDeepStage(
  node: CanvasNode,
  input: (id: string) => PortValue | null,
): DeepDataValue | null {
  const definition = findDeepStage(node);
  if (!definition) return null;
  const values: Record<string, PortValue | null> = { in: input('in') };
  for (const control of definition.stage.controls ?? []) values[control.key] = input(control.key);
  return computeDeepStageValue(node, values);
}

export function evaluateDeepStageMetric(
  node: CanvasNode,
  input: (id: string) => PortValue | null,
  portId: string,
): PortValue | null {
  const definition = findDeepStage(node);
  if (!definition?.stage.metric || definition.stage.metric.id !== portId) return null;
  const value = evaluateDeepStage(node, input);
  return value ? { kind: 'scalar', v: finite(definition.stage.metric.select(value.state), 0) } : null;
}

function addWire(wires: Wire[], from: CanvasNode, to: CanvasNode, toPort: string, fromPort = 'out'): void {
  wires.push({ id: nextId('w'), from: from.id, fromPort, to: to.id, toPort });
}

export function buildDeepPipelineDoc(kind: DeepPanoramaKind): CanvasDoc {
  const pipeline = DEEP_PIPELINES[kind];
  if (!pipeline) throw new Error(`未知深度学习管线：${kind}`);
  const nodes: CanvasNode[] = [];
  const wires: Wire[] = [];
  const stageNodes = new Map<DeepStageId, CanvasNode>();
  nodes.push({ id: nextId('n'), type: 'textNote', x: 40, y: 30, params: {}, text: pipeline.task });
  const positions: Record<DeepStageId, { x: number; y: number }> = {
    source: { x: 40, y: 180 }, core: { x: 440, y: 140 }, viewA: { x: 920, y: 30 }, viewB: { x: 920, y: 500 },
  };
  for (const stageDef of pipeline.stages) {
    const node: CanvasNode = {
      id: nextId('n'), type: 'deepStage', x: positions[stageDef.id].x, y: positions[stageDef.id].y,
      w: stageDef.width, payload: `${kind}/${stageDef.id}`, params: stageDef.id === 'source' ? { ...pipeline.defaults } : {},
    };
    stageNodes.set(stageDef.id, node);
    nodes.push(node);
  }
  const sliderNodes: CanvasNode[] = [];
  pipeline.sliders.forEach((slider, index) => {
    const node: CanvasNode = {
      id: nextId('n'), type: 'slider', x: 40, y: 690 + index * 118,
      params: { v: pipeline.defaults[slider.key] ?? (slider.key === 'time' ? 1.6 : slider.min), min: slider.min, max: slider.max, step: slider.step },
      text: slider.label,
    };
    sliderNodes.push(node);
    nodes.push(node);
    for (const target of slider.targets) {
      const targetNode = stageNodes.get(target);
      if (targetNode) addWire(wires, node, targetNode, slider.key);
    }
  });
  const source = stageNodes.get('source')!;
  const core = stageNodes.get('core')!;
  const viewA = stageNodes.get('viewA')!;
  const viewB = stageNodes.get('viewB')!;
  addWire(wires, source, core, 'in');
  addWire(wires, core, viewA, 'in');
  addWire(wires, core, viewB, 'in');
  return {
    version: 1,
    title: pipeline.title,
    nodes,
    wires,
    strokes: [],
    zoom: 0.8,
    panel: {
      title: pipeline.title,
      view_node_ids: [core.id, viewA.id, viewB.id],
      exposed_params: sliderNodes.map((node, index) => {
        const slider = pipeline.sliders[index]!;
        return { node_id: node.id, param_key: 'v', label: slider.label, min: slider.min, max: slider.max, step: slider.step };
      }),
    },
  };
}
