import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import { calculusSandboxMoreDoc, type CalculusSandboxMoreKind } from './calculusSandboxesMore.ts';
import {
  convergenceRule, curvatureRule, denoiseRule, gradientDescentRule,
  lagrangeRule, odeArenaRule, oscillatorRule, taylorHeatRule,
} from './calculusSandboxRules.ts';
import type { CanvasDoc } from './types.ts';

export type CalculusSandboxKind =
  | CalculusSandboxMoreKind | 'ch03-derivatives-app' | 'ch07-ode-dynamics' | 'ch09-multivar-opt' | 'ch12-series-fourier';

export function isCalculusSandboxKind(kind: string | null): kind is CalculusSandboxKind {
  return kind === 'ch03-derivatives-app' || kind === 'ch07-ode-dynamics'
    || kind === 'ch09-multivar-opt' || kind === 'ch12-series-fourier'
    || kind === 'ch01-limits' || kind === 'ch02-derivatives' || kind === 'ch04-integrals'
    || kind === 'ch06-integral-apps' || kind === 'ch08-space-geometry'
    || kind === 'ch10-multiple-int' || kind === 'ch11-vector-calc';
}

const wave = 'sin(x) + 0.35*cos(2*x)';
const derivativePresets = [
  { label: '光滑振荡', text: wave, params: {} },
  { label: '尖点不可导', text: 'abs(x)', params: {} },
  { label: '高频急弯', text: 'sin(3*x)', params: {} },
];

function derivativeSandbox(title: string): CanvasDoc {
  const x0 = slider('x0', '观察点 x₀', 500, 0, -2.5, 2.5, 0.05);
  const options = { controls: [], presets: derivativePresets, auxiliaryKind: 'scalar' as const, presetSource: 'text' as const };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '函数哪里转弯最急？\n点函数图，试 exp(-0.3*x)*sin(3*x)\n把 x₀ 接到切线和展开中心。'),
    node('src', 'functionSource', 40, 225, { a: 1, b: 0, c: 0 }, wave),
    x0,
    node('deriv', 'derivative', 420, 40, { x: 0, h: 0.5, showDerivative: 1 }),
    node('taylor', 'taylor', 420, 380, { center: 0, degree: 3, x: 0.5, span: 2 }),
    rule('curvature', 820, 40, {
      ...options, title: '曲率圆与中值定理', summary: '沿函数移动切点，比较曲率圆、极值、拐点与中值切线。',
      preferredView: 'shapes', code: curvatureRule,
    }),
    rule('spotlight', 820, 440, {
      ...options, title: '泰勒局部误差', summary: '从一阶到七阶，比较各阶多项式在展开中心附近的绝对误差。',
      preferredView: 'grid', code: taylorHeatRule,
    }),
  ], [
    ['src', 'deriv'], ['src', 'taylor'], ['src', 'curvature'], ['src', 'spotlight'],
    ['x0', 'deriv', 'x'], ['x0', 'taylor', 'center'], ['x0', 'curvature', 'aux'], ['x0', 'spotlight', 'aux'],
  ], ['curvature', 'spotlight', 'deriv', 'taylor'], [sliderParam(x0),
    { node_id: 'deriv', param_key: 'h', label: '割线步长', min: 0.01, max: 2, step: 0.01 },
    { node_id: 'taylor', param_key: 'degree', label: '展开阶数', min: 1, max: 5, step: 1 }]);
}

function odeSandbox(title: string): CanvasDoc {
  const zeta = slider('zeta', '一阶系数 ζ (p/2)', 225, 0.18, 0.02, 1.5, 0.01);
  const step = slider('stepH', '数值步长 h', 365, 0.2, 0.05, 0.8, 0.05);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '特征根和步长怎样改变解曲线？\n先切复根/重实根，再把 h 拉大。\n将 h 接入斜率场与求解器。'),
    zeta, step,
    node('slope', 'odeSlopeField', 420, 40, { x0: 0, y0: 1, min: -2, max: 2, step: 0.2, steps: 10 }, '-3*y'),
    rule('spring', 420, 450, {
      title: '二阶方程解族与相轨', summary: '观察 y″+2ζy′+y=Fcos(ωt) 在复根、重实根与同频激励下的解形态。',
      preferredView: 'shapes', code: oscillatorRule, presetSource: { param: 'zeta' },
      controls: [control('zeta', '一阶系数 ζ', 0.18, 0.02, 1.5, 0.01),
        control('omega', '外频 ω', 1, 0.3, 2, 0.05), control('force', '非齐次幅值 F', 0, 0, 1, 0.05)],
      presets: [
        { label: '复特征根（衰减振荡）', params: { zeta: 0.18, omega: 1, force: 0 } },
        { label: '重实根（临界回稳）', params: { zeta: 1, omega: 1, force: 0 } },
        { label: '同频特解放大', params: { zeta: 0.04, omega: 1, force: 0.8 } },
      ],
    }),
    rule('arena', 840, 200, {
      title: '数值求解器擂台', summary: '让 Euler、中点法和 RK4 在同一组初值和步长下与解析解竞赛。',
      preferredView: 'chart', code: odeArenaRule, presetSource: { param: 'h' },
      controls: [control('h', '数值步长 h', 0.2, 0.05, 0.8, 0.05)],
      presets: [
        { label: '细步长', params: { h: 0.05 } },
        { label: '中等步长', params: { h: 0.35 } },
        { label: 'Euler 越出稳定区', params: { h: 0.8 } },
      ],
    }),
  ], [['zeta', 'spring'], ['stepH', 'slope', 'step'], ['stepH', 'arena']], ['spring', 'arena', 'slope'], [
    sliderParam(zeta), sliderParam(step),
    { node_id: 'spring', param_key: 'omega', label: '外频 ω', min: 0.3, max: 2, step: 0.05 },
    { node_id: 'spring', param_key: 'force', label: '非齐次幅值 F', min: 0, max: 1, step: 0.05 },
  ]);
}

const doubleWell = '(x^2-1)^2+2*y^2';

function multivarSandbox(title: string): CanvasDoc {
  const lr = slider('lr', '学习率 η', 560, 0.07, 0.02, 0.45, 0.01);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '小球会滚进哪个谷？\n改地形或增大学习率。\n把同一地形接给等高线和寻谷。'),
    node('f2d', 'func2dSource', 40, 225, { a: 1, b: 1 }, doubleWell),
    lr,
    node('grad', 'gradientContour', 420, 40, { x: 1.3, y: 0.8, theta: Math.PI / 4, span: 2.5, gx: 0, gy: 0 }),
    rule('lagrange', 420, 475, {
      title: '约束圆与相切', summary: '在约束圆上扫描极值候选，比较目标梯度与约束法向。',
      preferredView: 'shapes', code: lagrangeRule, presetSource: 'text',
      controls: [control('radius', '约束半径', 1.4, 0.4, 2.5, 0.1)],
      presets: [
        { label: '双谷约束', text: doubleWell, params: { radius: 1.4 } },
        { label: '椭圆等值线', text: 'x^2+2*y^2', params: { radius: 1.4 } },
        { label: '鞍形约束', text: 'x^2-y^2', params: { radius: 1.4 } },
      ],
    }),
    rule('gd', 840, 200, {
      title: '梯度下降寻谷', summary: '逐步播放小球位置，比较地形热图、轨迹和目标值。',
      preferredView: 'grid', code: gradientDescentRule, auxiliaryKind: 'function2d', presetSource: { param: 'eta' },
      controls: [control('eta', '学习率 η', 0.07, 0.02, 0.45, 0.01),
        control('startX', '起点 x', 1.65, -2.5, 2.5, 0.05), control('startY', '起点 y', 1, -2.5, 2.5, 0.05)],
      presets: [
        { label: '平稳寻谷', params: { eta: 0.07, startX: 1.65, startY: 1 } },
        { label: '步子过大', params: { eta: 0.45, startX: 1.65, startY: 1 } },
        { label: '鞍点停滞', params: { eta: 0.07, startX: 0, startY: 0 } },
      ],
    }),
  ], [['f2d', 'grad'], ['f2d', 'lagrange'], ['lr', 'gd'], ['f2d', 'gd', 'aux']], ['gd', 'lagrange', 'grad'], [
    sliderParam(lr), { node_id: 'lagrange', param_key: 'radius', label: '约束半径', min: 0.4, max: 2.5, step: 0.1 },
    { node_id: 'gd', param_key: 'startX', label: '起点 x', min: -2.5, max: 2.5, step: 0.05 },
    { node_id: 'gd', param_key: 'startY', label: '起点 y', min: -2.5, max: 2.5, step: 0.05 },
  ]);
}

function seriesSandbox(title: string): CanvasDoc {
  const n = slider('nHarm', '保留项数 N', 225, 8, 1, 25, 1);
  const count = control('count', '保留项数 N', 8, 1, 25, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '保留更多项就一定更好？\n拖 N 比较过冲与信噪比。\n将 N 同时接入合成与降噪。'),
    n,
    node('fourier', 'fourierLab', 420, 40, { n: 8, waveform: 0, span: Math.PI * 2 }),
    rule('convRace', 420, 420, {
      title: '收敛悬崖', summary: '比较几何、调和、p-级数与幂级数的部分和。',
      preferredView: 'chart', code: convergenceRule, presetSource: { param: 'count' },
      controls: [count, control('x', '幂级数 x', 0.85, -1.3, 1.3, 0.05), control('p', 'p-级数指数', 2, 0.5, 3, 0.1)],
      presets: [
        { label: '收敛区内', params: { count: 15, x: 0.85, p: 2 } },
        { label: '收敛半径边界', params: { count: 20, x: 1, p: 1 } },
        { label: '越过收敛半径', params: { count: 25, x: 1.2, p: 0.7 } },
      ],
    }),
    rule('denoise', 840, 200, {
      title: '傅里叶降噪', summary: '在时域和频域比较带噪信号、低通重建和信噪比。',
      preferredView: 'chart', code: denoiseRule, presetSource: { param: 'count' },
      controls: [count, control('noise', '噪声强度', 0.45, 0.05, 1.2, 0.05), control('seed', '噪声种子', 42, 1, 99, 1)],
      presets: [
        { label: '轻度噪声低通', params: { count: 4, noise: 0.3 } },
        { label: '强噪声滤波', params: { count: 4, noise: 1 } },
        { label: '过度截断失真', params: { count: 1, noise: 0.3 } },
      ],
    }),
  ], [['nHarm', 'fourier', 'n'], ['nHarm', 'convRace'], ['nHarm', 'denoise']], ['denoise', 'fourier', 'convRace'], [
    sliderParam(n), { node_id: 'fourier', param_key: 'waveform', label: '波形序号', min: 0, max: 2, step: 1 },
    { node_id: 'convRace', param_key: 'x', label: '幂级数 x', min: -1.3, max: 1.3, step: 0.05 },
    { node_id: 'denoise', param_key: 'noise', label: '噪声强度', min: 0.05, max: 1.2, step: 0.05 },
  ]);
}

export function calculusSandboxDoc(kind: CalculusSandboxKind, title: string): CanvasDoc {
  switch (kind) {
    case 'ch03-derivatives-app': return derivativeSandbox(title);
    case 'ch07-ode-dynamics': return odeSandbox(title);
    case 'ch09-multivar-opt': return multivarSandbox(title);
    case 'ch12-series-fourier': return seriesSandbox(title);
    default: return calculusSandboxMoreDoc(kind, title);
  }
}
