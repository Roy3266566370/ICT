export const D_MODEL = 8;
export const HEADS = 2;
export const D_HEAD = D_MODEL / HEADS;
export const D_FF = 16;
export const LAYERS = 1;
export const MAX_TOKENS = 8;
export const VOCAB = ['的', '是', '在', '我', '你', '了', '，', '。'] as const;

export type StageId =
  | 'token'
  | 'embed'
  | 'qkv'
  | 'attention'
  | 'norm1'
  | 'ffn'
  | 'norm2'
  | 'output';

export interface StageInfo {
  id: StageId;
  index: string;
  label: string;
  sub: string;
  shape: string;
  formula: string;
  explanation: string;
}

export const STAGES: readonly StageInfo[] = [
  {
    id: 'token',
    index: '01',
    label: '分词',
    sub: '字符 → token',
    shape: 'T',
    formula: '\\text{tokens}=[t_1,\\ldots,t_T]',
    explanation:
      '按字符切分输入。为了看清流程，演示限制在 8 个字符以内；每个字符保留自己的码点，不依赖外部词表。',
  },
  {
    id: 'embed',
    index: '02',
    label: '嵌入 + 位置',
    sub: 'X⁰ = E + P',
    shape: 'T × 8',
    formula: 'X^{0}=E[t]+P',
    explanation:
      '字符嵌入给出“是谁”，正弦位置编码给出“在哪里”。两者逐维相加，得到进入注意力层的 X⁰。',
  },
  {
    id: 'qkv',
    index: '03',
    label: 'Q / K / V',
    sub: '三组线性投影',
    shape: 'T × 8',
    formula: 'Q=X^{0}W_Q,\\quad K=X^{0}W_K,\\quad V=X^{0}W_V',
    explanation:
      '同一个 X⁰ 分别乘三组权重：Q 表示“我在找什么”，K 表示“我提供什么”，V 表示“我实际携带什么”。',
  },
  {
    id: 'attention',
    index: '04',
    label: '因果注意力',
    sub: 'softmax(QKᵀ/√dₖ)V',
    shape: 'T × T',
    formula: '\\mathrm{Attn}(Q,K,V)=\\mathrm{softmax}\\!\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}+M\\right)V',
    explanation:
      '点积衡量 Query 与 Key 的匹配程度，除以 √dₖ 稳定方差；因果遮罩 M 把未来位置置为 −∞，使每个位置只能看见自己和左边。',
  },
  {
    id: 'norm1',
    index: '05',
    label: '残差 + LN',
    sub: 'LN(X⁰ + MHA)',
    shape: 'T × 8',
    formula: 'X^{1}=\\mathrm{LN}\\!\\left(X^{0}+\\mathrm{MHA}(X^{0})\\right)',
    explanation:
      '多头输出先加回 X⁰（残差），再做 LayerNorm。残差让梯度有直达通道，LayerNorm 把每个位置的 8 个数拉回稳定尺度。',
  },
  {
    id: 'ffn',
    index: '06',
    label: '前馈网络',
    sub: 'W₂·GELU(W₁x)',
    shape: 'T × 16 → T × 8',
    formula: 'F=\\mathrm{GELU}(X^{1}W_1+b_1)W_2+b_2',
    explanation:
      '逐位置的两层 MLP：先升到 16 维，经 GELU 非线性，再压回 8 维。它不混合不同位置，负责逐 token 的特征变换。',
  },
  {
    id: 'norm2',
    index: '07',
    label: '残差 + LN',
    sub: 'LN(X¹ + FFN)',
    shape: 'T × 8',
    formula: 'X^{2}=\\mathrm{LN}\\!\\left(X^{1}+F\\right)',
    explanation:
      '把前馈输出加回 X¹ 并再次归一化。至此一个 Transformer 块完成；真实模型会把这一块堆叠 N 层，这里只保留 1 层。',
  },
  {
    id: 'output',
    index: '08',
    label: '输出头',
    sub: 'softmax(h·W_U)',
    shape: '8',
    formula: 'p=\\mathrm{softmax}\\!\\left(x^{2}_{T}W_U+b_U\\right)',
    explanation:
      '取最后一个位置的向量，乘输出矩阵得到 8 个 logits，再经 softmax 变成下一个 token 的概率分布。',
  },
] as const;

export function findStage(id: StageId): StageInfo {
  return STAGES.find((stage) => stage.id === id) ?? STAGES[0]!;
}

export interface Token {
  char: string;
  codePoint: number;
}

export interface AttentionHeadTrace {
  q: number[][];
  k: number[][];
  v: number[][];
  scores: number[][];
  weights: number[][];
  output: number[][];
}

export interface TransformerTrace {
  tokens: Token[];
  position: number[][];
  tokenEmbedding: number[][];
  x0: number[][];
  heads: AttentionHeadTrace[];
  concat: number[][];
  mha: number[][];
  x1Pre: number[][];
  x1: number[][];
  ffnPre: number[][];
  ffnActivated: number[][];
  ffnOut: number[][];
  x2Pre: number[][];
  x2: number[][];
  logits: number[];
  probs: number[];
  top: { token: string; index: number; prob: number }[];
}

export interface VecStats {
  mean: number;
  std: number;
}

export function normalizeInput(raw: string): { chars: string[]; truncated: boolean } {
  const cleaned = Array.from(raw.replace(/\s+/g, ''));
  if (cleaned.length === 0) return { chars: Array.from('万象'), truncated: false };
  return { chars: cleaned.slice(0, MAX_TOKENS), truncated: cleaned.length > MAX_TOKENS };
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomMatrix(rows: number, cols: number, scale: number, rng: () => number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (rng() * 2 - 1) * scale),
  );
}

function randomVector(length: number, scale: number, rng: () => number): number[] {
  return Array.from({ length }, () => (rng() * 2 - 1) * scale);
}

const weightRng = makeRng(0x5eed7a11);
const W_Q = randomMatrix(D_MODEL, D_MODEL, 0.5, weightRng);
const W_K = randomMatrix(D_MODEL, D_MODEL, 0.5, weightRng);
const W_V = randomMatrix(D_MODEL, D_MODEL, 0.5, weightRng);
const W_O = randomMatrix(D_MODEL, D_MODEL, 0.5, weightRng);
const W_1 = randomMatrix(D_MODEL, D_FF, 0.45, weightRng);
const B_1 = randomVector(D_FF, 0.12, weightRng);
const W_2 = randomMatrix(D_FF, D_MODEL, 0.45, weightRng);
const B_2 = randomVector(D_MODEL, 0.1, weightRng);
const W_U = randomMatrix(D_MODEL, VOCAB.length, 0.55, weightRng);
const B_U = randomVector(VOCAB.length, 0.1, weightRng);

function matmul(left: number[][], right: number[][]): number[][] {
  const rows = left.length;
  const cols = right[0]?.length ?? 0;
  const inner = right.length;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      let sum = 0;
      for (let t = 0; t < inner; t += 1) sum += (left[i]?.[t] ?? 0) * (right[t]?.[j] ?? 0);
      return sum;
    }),
  );
}

function matvec(matrix: number[][], vector: number[], bias: number[]): number[] {
  return matrix[0]?.map((_, j) => {
    let sum = bias[j] ?? 0;
    for (let i = 0; i < vector.length; i += 1) sum += (vector[i] ?? 0) * (matrix[i]?.[j] ?? 0);
    return sum;
  }) ?? [];
}

function addRows(left: number[][], right: number[][]): number[][] {
  return left.map((row, i) => row.map((value, j) => value + (right[i]?.[j] ?? 0)));
}

function addVectors(left: number[], right: number[]): number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function dot(left: number[], right: number[]): number {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += (left[i] ?? 0) * (right[i] ?? 0);
  return sum;
}

function embedChar(codePoint: number): number[] {
  const rng = makeRng(Math.imul(codePoint, 2654435761) >>> 0);
  return Array.from({ length: D_MODEL }, () => (rng() * 2 - 1) * 0.95);
}

function positionalEncoding(position: number): number[] {
  return Array.from({ length: D_MODEL }, (_, index) => {
    const pair = Math.floor(index / 2);
    const frequency = Math.pow(10000, (2 * pair) / D_MODEL);
    return index % 2 === 0
      ? Math.sin(position / frequency)
      : Math.cos(position / frequency);
  });
}

export function layerNorm(row: number[]): number[] {
  const mean = row.reduce((sum, value) => sum + value, 0) / (row.length || 1);
  const variance = row.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (row.length || 1);
  return row.map((value) => (value - mean) / Math.sqrt(variance + 1e-5));
}

export function vectorStats(row: number[]): VecStats {
  const mean = row.reduce((sum, value) => sum + value, 0) / (row.length || 1);
  const variance = row.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (row.length || 1);
  return { mean, std: Math.sqrt(variance) };
}

export function gelu(value: number): number {
  return 0.5 * value * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (value + 0.044715 * value ** 3)));
}

function softmax(values: number[]): number[] {
  if (values.length === 0) return [];
  const finite = values.filter((value) => Number.isFinite(value));
  const max = finite.length ? Math.max(...finite) : 0;
  const exps = values.map((value) => (Number.isFinite(value) ? Math.exp(value - max) : 0));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}

export function attentionScores(q: number[][], k: number[][]): number[][] {
  return q.map((qRow, i) =>
    Array.from({ length: k.length }, (_, j) => {
      if (j > i) return -Infinity;
      return dot(qRow, k[j] ?? []) / Math.sqrt(D_HEAD);
    }),
  );
}

export function runTransformer(raw: string): TransformerTrace {
  const { chars } = normalizeInput(raw);
  const tokens: Token[] = chars.map((char) => ({ char, codePoint: char.codePointAt(0) ?? 0 }));
  const position = tokens.map((_, index) => positionalEncoding(index));
  const tokenEmbedding = tokens.map((token) => embedChar(token.codePoint));
  const x0 = tokenEmbedding.map((row, index) => addVectors(row, position[index] ?? []));

  const qFull = matmul(x0, W_Q);
  const kFull = matmul(x0, W_K);
  const vFull = matmul(x0, W_V);

  const heads: AttentionHeadTrace[] = Array.from({ length: HEADS }, (_, head) => {
    const start = head * D_HEAD;
    const q = qFull.map((row) => row.slice(start, start + D_HEAD));
    const k = kFull.map((row) => row.slice(start, start + D_HEAD));
    const v = vFull.map((row) => row.slice(start, start + D_HEAD));
    const scores = attentionScores(q, k);
    const weights = scores.map((row) => softmax(row));
    const output = weights.map((row) =>
      Array.from({ length: D_HEAD }, (_, dim) =>
        row.reduce((sum, weight, j) => sum + weight * (v[j]?.[dim] ?? 0), 0),
      ),
    );
    return { q, k, v, scores, weights, output };
  });

  const concat = x0.map((_, rowIndex) =>
    heads.flatMap((head) => head.output[rowIndex] ?? []),
  );
  const mha = matmul(concat, W_O);
  const x1Pre = addRows(x0, mha);
  const x1 = x1Pre.map(layerNorm);
  const ffnPre = x1.map((row) => matvec(W_1, row, B_1));
  const ffnActivated = ffnPre.map((row) => row.map(gelu));
  const ffnOut = ffnActivated.map((row) => matvec(W_2, row, B_2));
  const x2Pre = addRows(x1, ffnOut);
  const x2 = x2Pre.map(layerNorm);
  const last = x2[x2.length - 1] ?? [];
  const logits = matvec(W_U, last, B_U);
  const probs = softmax(logits);
  const top = probs
    .map((prob, index) => ({ token: VOCAB[index] ?? '?', index, prob }))
    .sort((a, b) => b.prob - a.prob);

  return {
    tokens,
    position,
    tokenEmbedding,
    x0,
    heads,
    concat,
    mha,
    x1Pre,
    x1,
    ffnPre,
    ffnActivated,
    ffnOut,
    x2Pre,
    x2,
    logits,
    probs,
    top,
  };
}

export function formatCell(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.0005) return '0.00';
  return value.toFixed(digits);
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export const MODEL_CARDS: readonly { label: string; value: string }[] = [
  { label: 'd_model', value: String(D_MODEL) },
  { label: 'heads', value: String(HEADS) },
  { label: 'd_head', value: String(D_HEAD) },
  { label: 'd_ff', value: String(D_FF) },
  { label: 'layers', value: String(LAYERS) },
  { label: 'vocab', value: String(VOCAB.length) },
];
