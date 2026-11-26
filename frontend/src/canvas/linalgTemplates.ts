import { LINALG_SANDBOX_TITLES, linalgSandboxDoc, type LinalgSandboxKind } from './linalgSandboxes.ts';
import type { CanvasDoc } from './types.ts';

type TopicId = 'la-transform' | 'la-subspace' | 'la-spectral';
export type LinalgTemplateKind = LinalgSandboxKind;

export interface LinalgTopic {
  id: TopicId;
  name: string;
  lead: string;
}

export interface LinalgTemplate {
  kind: LinalgTemplateKind;
  topic: TopicId;
  name: string;
  desc: string;
  tag: string;
  formula: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
  preview: LinalgTemplateKind;
  panorama: true;
}

export const LINALG_TOPICS: readonly LinalgTopic[] = [
  { id: 'la-transform', name: '专题 01 · 矩阵变换与线性方程组', lead: '从几何变换、行列式与基变换走到高斯消元和 LU 分解。' },
  { id: 'la-subspace', name: '专题 02 · 向量空间与正交投影', lead: '连起四大基本子空间，掌握正交分解、QR 与最小二乘。' },
  { id: 'la-spectral', name: '专题 03 · 特征谱、二次型与 SVD', lead: '用特征谱预测动态行为，再用 SVD 和 PCA 分析矩阵及数据。' },
];

const chapters: readonly Omit<LinalgTemplate, 'name' | 'preview' | 'panorama'>[] = [
  {
    kind: 'la01-matrix-det-basis', topic: 'la-transform', tag: '线性代数 · 几何',
    desc: '对照网格和有向面积，逐步复合矩阵，并在斜基下核对相似不变量。',
    formula: 'v′ = P⁻¹v；A′ = P⁻¹AP',
    question: '从哪里能看出矩阵改变了面积和方向？',
    steps: '切换旋转、剪切、镜像或奇异情景，再播放两种复合顺序。',
    observation: '相似变换改变矩阵表示，保留迹与行列式。',
    keywords: ['矩阵变换', '行列式', '矩阵乘法', '基变换', '相似矩阵', '可逆', 'det', 'basis'],
  },
  {
    kind: 'la02-gauss-lu-rank', topic: 'la-transform', tag: '线性代数 · 消元',
    desc: '逐步还原增广矩阵，核对 PA = LU，并画出三种方程组解空间。',
    formula: 'PA = LU；rank(A) 与 rank([A | b])',
    question: '矩阵主元和末列如何共同判断方程组是否有解？',
    steps: '拖时间轴观察消元，再切换行交换、无穷解和矛盾预设。',
    observation: '系数秩与增广秩不等时，方程组不相容。',
    keywords: ['高斯消元', 'RREF', 'LU', '秩', '线性方程组', '主元', '高斯-若尔当', '逆矩阵'],
  },
  {
    kind: 'la03-four-subspaces', topic: 'la-subspace', tag: '线性代数 · 子空间',
    desc: '查看四大基本子空间的映射，分解输入向量，并观察秩亏时维数跳变。',
    formula: 'rank(A) + dim N(A) = n',
    question: '一个向量中的哪部分会被矩阵消去？',
    steps: '改变矩阵行相关程度，再调向量分量核对正交分解。',
    observation: '行空间与零空间正交；列空间与左零空间正交。',
    keywords: ['四子空间', '四大基本子空间', '秩零度', '行空间', '列空间', '零空间', '基', '维数'],
  },
  {
    kind: 'la04-ortho-qr-ls', topic: 'la-subspace', tag: '线性代数 · 投影',
    desc: '逐帧正交化，拟合有噪观测，并核对残差正交与投影矩阵的性质。',
    formula: 'A = QR；Aᵀ(Ax̂ − b) = 0',
    question: '最小二乘的残差为什么与列空间正交？',
    steps: '播放 Gram–Schmidt，切换拟合阶数和噪声，再检查投影矩阵。',
    observation: '正交投影满足 Pᵀ=P 与 P²=P。',
    keywords: ['正交化', 'Gram-Schmidt', 'QR', '最小二乘', '正规方程', '正交投影', '幂等', '残差'],
  },
  {
    kind: 'la05-eigen-dynamics', topic: 'la-spectral', tag: '线性代数 · 特征谱',
    desc: '寻找实特征方向或复根，播放矩阵幂轨迹，并观察马尔可夫链稳态。',
    formula: 'det(A − λI) = 0；xₖ = Aᵏx₀',
    question: '为什么同样是重复施加矩阵，有些轨迹会旋转收敛，有些会发散？',
    steps: '切换实根、复根和亏损重根，在幂次视角播放，再比较稳态。',
    observation: '谱半径小于 1 时幂次趋零；重根不保证存在完整特征基。',
    keywords: ['特征值', '特征向量', '相似对角化', '谱半径', '复特征值', '马尔可夫链', 'Markov'],
  },
  {
    kind: 'la06-quadform-svd-pca', topic: 'la-spectral', tag: '线性代数 · 分解',
    desc: '对照二次型正定性，播放 SVD 三步变换，并用 PCA 比较低秩压缩。',
    formula: 'A = UΣVᵀ；保留能量 = Σᵢ≤ₖ σᵢ² ÷ Σᵢ σᵢ²',
    question: '矩阵的拉伸尺度与点云的主成分有什么关系？',
    steps: '切换椭圆或马鞍面，播放 SVD，再拖动保留主成分数。',
    observation: '截断较小的奇异值，用低秩保留主要结构和能量。',
    keywords: ['二次型', '正定性', '顺序主子式', '奇异值分解', 'SVD', 'PCA', '主成分分析', '低秩'],
  },
];

export const LINALG_TEMPLATES: readonly LinalgTemplate[] = chapters.map(chapter => ({
  ...chapter, name: LINALG_SANDBOX_TITLES[chapter.kind], preview: chapter.kind, panorama: true,
}));
export const VISIBLE_LINALG_TEMPLATES = LINALG_TEMPLATES;

export function isLinalgTemplateKind(kind: string): kind is LinalgTemplateKind {
  return Object.hasOwn(LINALG_SANDBOX_TITLES, kind);
}

export function linalgTemplateDoc(kind: LinalgTemplateKind): CanvasDoc {
  return linalgSandboxDoc(kind);
}
