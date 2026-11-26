import type { AiRulePreferredView } from './aiRuleBlock.ts';
import { board, control, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  la01GridRule, la01ComposeRule, la01BasisRule, la02RrefRule, la02LuRule, la02SolutionRule,
  la03MapRule, la03DecomposeRule, la03RankRule, la04QrRule, la04LeastSquaresRule, la04ProjectionRule,
  la05EigenRule, la05PowersRule, la05MarkovRule, la06QuadraticRule, la06SvdRule, la06PcaRule,
} from './linalgSandboxRules.ts';
import type { CanvasDoc, RuleControlSpec } from './types.ts';

export const LINALG_SANDBOX_TITLES = {
  'la01-matrix-det-basis': '矩阵变换、行列式与基变换',
  'la02-gauss-lu-rank': '高斯消元、秩与方程组解空间',
  'la03-four-subspaces': '向量空间与四大基本子空间',
  'la04-ortho-qr-ls': '正交化、QR 分解与最小二乘',
  'la05-eigen-dynamics': '特征值、相似对角化与动态系统',
  'la06-quadform-svd-pca': '二次型、SVD 与主成分分析',
} as const;

export type LinalgSandboxKind = keyof typeof LINALG_SANDBOX_TITLES;

interface View {
  id: string;
  title: string;
  summary: string;
  preferredView: AiRulePreferredView;
  code: string;
  controls?: readonly RuleControlSpec[];
  textLabel?: string;
}

interface Chapter {
  amount: { label: string; value: number; step: number };
  scenes: readonly [string, string, string, string];
  views: readonly [View, View, View];
}

const LINALG_SANDBOXES: Record<LinalgSandboxKind, Chapter> = {
  'la01-matrix-det-basis': {
    amount: { label: '变换强度（1 为预设基准）', value: 1, step: .05 },
    scenes: ['旋转 45°', '水平剪切', '镜像翻转', '奇异降维'],
    views: [
      { id: 'matrix', title: '网格与行列式', summary: '网格、面积和单位圆共用同一线性变换。', preferredView: 'shapes', code: la01GridRule },
      { id: 'compose', title: '矩阵复合顺序', summary: '播放两条路径，对照 A(Bv) 与 B(Av) 的落点。', preferredView: 'shapes', code: la01ComposeRule },
      { id: 'basis', title: '基变换与相似矩阵', summary: '在两套坐标下表示同一个向量，核对相似矩阵的迹和行列式。', preferredView: 'shapes', code: la01BasisRule },
    ],
  },
  'la02-gauss-lu-rank': {
    amount: { label: '方程变化量', value: 1, step: .05 },
    scenes: ['满秩唯一解', '欠定无穷解', '矛盾无解', '零主元需行交换'],
    views: [
      { id: 'rref', title: '高斯消元与 RREF', summary: '逐帧追踪增广矩阵的主元、交换、倍加与归一化。', preferredView: 'grid', code: la02RrefRule },
      { id: 'lu', title: 'PA = LU 分解核对', summary: '按部分选主元法计算 P、L、U 并检查重构误差。', preferredView: 'grid', code: la02LuRule },
      { id: 'solution', title: '解空间几何', summary: '用实际方程画出交点、仿射解集或平行矛盾约束。', preferredView: 'shapes', code: la02SolutionRule },
    ],
  },
  'la03-four-subspaces': {
    amount: { label: '行相关扰动 α', value: 1, step: .05 },
    scenes: ['秩 2 满列秩', '秩 1 退化矩阵', '3×2 高瘦矩阵', '2×3 矮胖矩阵'],
    views: [
      { id: 'subspaces', title: '四大子空间映射', summary: '沿 A 的映射追踪行空间、零空间、列空间与左零空间。', preferredView: 'shapes', code: la03MapRule },
      {
        id: 'decompose', title: '向量正交分解', summary: '调节向量分量，观察行空间投影与零空间残差。', preferredView: 'shapes', code: la03DecomposeRule,
        controls: [control('x1', '向量分量 x₁', 2, -3, 3, .1), control('x2', '向量分量 x₂', 1, -3, 3, .1),
          control('x3', '向量分量 x₃（矮胖矩阵）', 1.5, -3, 3, .1)],
      },
      { id: 'rank', title: '秩变敏感度', summary: '调节矩阵的行相关程度，同步核对四个子空间的基和维数。', preferredView: 'grid', code: la03RankRule },
    ],
  },
  'la04-ortho-qr-ls': {
    amount: { label: '拟合阶数（0 自动 / 1 直线 / 2 二次）', value: 0, step: 1 },
    scenes: ['近共线病态基', '低噪线性拟合', '强噪二次拟合', '已有正交基'],
    views: [
      { id: 'qr', title: 'Gram–Schmidt 正交化', summary: '沿时间轴观察减投影和单位化，核对 QᵀQ 与 QR。', preferredView: 'shapes', code: la04QrRule },
      { id: 'leastSquares', title: '最小二乘与残差', summary: '调节噪声，比较拟合曲线与观测点，并检验残差正交。', preferredView: 'shapes', code: la04LeastSquaresRule,
        controls: [control('noise', '观测噪声倍率', 1, 0, 2, .05)] },
      { id: 'projection', title: '投影矩阵性质', summary: '对同一拟合设计矩阵，检验投影算子的对称性与幂等性。', preferredView: 'grid', code: la04ProjectionRule },
    ],
  },
  'la05-eigen-dynamics': {
    amount: { label: '谱变换与转移强度', value: 1, step: .05 },
    scenes: ['双实根鞍点', '复特征值阻尼螺旋', '剪切重根不可对角化', '马尔可夫稳态收敛'],
    views: [
      { id: 'eigen', title: '特征方向与复特征值', summary: '识别不变直线、重根与共轭复根，核对迹与行列式。', preferredView: 'shapes', code: la05EigenRule },
      { id: 'powers', title: '幂次演化 Aᵏx₀', summary: '从 k=0 推进到 k=16，对照谱半径与轨迹长期行为。', preferredView: 'shapes', code: la05PowersRule },
      { id: 'markov', title: '马尔可夫链稳态', summary: '观察三种状态的占比演化，核对 λ=1 对应的稳态分布。', preferredView: 'chart', code: la05MarkovRule,
        textLabel: '转移矩阵（每行 3 项，按列归一化；留空使用当前情景）' },
    ],
  },
  'la06-quadform-svd-pca': {
    amount: { label: '耦合强度与主轴尺度', value: 1, step: .05 },
    scenes: ['正定椭圆', '不定马鞍面', '高条件数细长椭圆', '强相关点云 PCA'],
    views: [
      { id: 'quadratic', title: '二次型与正定性', summary: '红正蓝负，核对顺序主子式和特征值的符号。', preferredView: 'grid', code: la06QuadraticRule },
      { id: 'svd', title: 'SVD 三步几何分解', summary: '播放 Vᵀ、Σ、U 三段变换，核对矩阵重构。', preferredView: 'shapes', code: la06SvdRule },
      { id: 'pca', title: '低秩压缩与 PCA', summary: '调整保留秩，观察点云重构、奇异值谱和累计方差。', preferredView: 'shapes', code: la06PcaRule,
        controls: [control('k', '保留主成分数 k', 1, 0, 2, 1)] },
    ],
  },
};

export function linalgSandboxDoc(kind: LinalgSandboxKind): CanvasDoc {
  const chapter = LINALG_SANDBOXES[kind];
  const scene = slider('scene', '情景编号（0–3）', 60, 0, 0, 3, 1);
  const amount = slider('amount', chapter.amount.label, 260, chapter.amount.value, 0, 2, chapter.amount.step);
  const sceneControl = control('scene', '情景编号（0–3）', 0, 0, 3, 1);
  const views = chapter.views.map(({ id, controls, ...view }, index) => rule(id, 430, 40 + 320 * index, {
    ...view,
    controls: [sceneControl, ...(controls ?? [])],
    auxiliaryKind: 'scalar',
    presets: chapter.scenes.map((label, scene) => ({
      label, params: { ...Object.fromEntries((controls ?? []).map(spec => [spec.key, spec.value])),
        scene, amount: chapter.amount.value },
    })),
    presetSource: { param: 'scene', auxiliaryParam: 'amount' },
  }));
  return board(LINALG_SANDBOX_TITLES[kind], [scene, amount, ...views],
    views.flatMap(({ id }): [string, string, string?][] => [[scene.id, id], [amount.id, id, 'aux']]),
    views.map(({ id }) => id), [sliderParam(scene), sliderParam(amount)]);
}
