import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  chainRule, differentialRule, discontinuityRule, improperIntegralRule, infinitesimalRaceRule, quadratureRule,
} from './calculusSandboxMoreRules.ts';
import { damWorkRule, diskSlicesRule, heightFieldRule, surfaceTracesRule, vectorGeometryRule } from './calculusGeometryRules.ts';
import { VECTOR_FIELDS } from './calculusField.ts';
import { differentialHeatRule, diskCentroidRule, fieldPathRule, fieldTheoremsRule, jacobianRule } from './calculusFieldRules.ts';
import type { CanvasDoc } from './types.ts';

export type CalculusSandboxMoreKind = 'ch01-limits' | 'ch02-derivatives' | 'ch04-integrals' | 'ch06-integral-apps'
  | 'ch08-space-geometry' | 'ch10-multiple-int' | 'ch11-vector-calc';

const functionNode = (text: string) => node('src', 'functionSource', 40, 225, { a: 1, b: 0, c: 0 }, text);

function limits(title: string): CanvasDoc {
  const eps = slider('eps', '容差 ε', 505, 0.12, 0.001, 0.5, 0.001);
  const removable = '(x^2+x)/x';
  const common = {
    sampleProfile: 'limit' as const, auxiliaryKind: 'scalar' as const, presetSource: 'text' as const,
    controls: [],
    presets: [
      { label: '可去间断', text: removable, params: {} },
      { label: '跳跃间断', text: 'abs(x)/x', params: {} },
      { label: '振荡间断', text: 'sin(1/x)', params: {} },
    ],
  };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '函数在原点没值，也能有极限吗？\n拖小 ε，再切换间断预设。\n把 ε 连至观察口以共用容差。'),
    functionNode(removable), eps,
    node('limit', 'limitProbe', 420, 40, { x: 0, side: 0, eps: 0.12 }),
    rule('orderRace', 420, 390, {
      ...common, title: '无穷小阶数赛跑', preferredView: 'chart',
      summary: '比较同一组趋近步长下的一阶、二阶无穷小与当前函数误差。', code: infinitesimalRaceRule,
    }),
    rule('discontinuity', 820, 40, {
      ...common, title: '间断点解剖与二分法', preferredView: 'shapes',
      summary: '分辨左右极限和实际函数值，再在独立区间播放二分夹逼。', code: discontinuityRule,
    }),
  ], [
    ['src', 'limit'], ['eps', 'limit', 'eps'],
    ['src', 'orderRace'], ['eps', 'orderRace', 'aux'],
    ['src', 'discontinuity'], ['eps', 'discontinuity', 'aux'],
  ], ['discontinuity', 'limit', 'orderRace'], [sliderParam(eps)]);
}

function derivatives(title: string): CanvasDoc {
  const step = slider('stepH', '增量 h', 505, 0.45, 0.001, 0.8, 0.001);
  const initial = 'x+x^2';
  const common = {
    sampleProfile: 'differential' as const, auxiliaryKind: 'scalar' as const, presetSource: 'text' as const,
    controls: [],
    presets: [
      { label: '二次余差', text: initial, params: {} },
      { label: '指数局部线性化', text: 'exp(x)', params: {} },
      { label: '尖点无导数', text: 'abs(x)', params: {} },
    ],
  };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '把 h 减半，微分余差缩小多少？\n拖 h 观察割线及余差读数。\n让 h 同时驱动三个下游积木。'),
    functionNode(initial), step,
    node('derivative', 'derivative', 420, 40, { x: 0, h: 0.45, showDerivative: 0 }),
    rule('chain', 420, 420, {
      ...common, title: '链式法则两级放大器', preferredView: 'shapes',
      summary: '将输入增量先经过内层 g，再经过上游函数 f，观察局部倍率乘积。', code: chainRule,
    }),
    rule('differential', 820, 40, {
      ...common, title: '微分余差放大镜', preferredView: 'shapes',
      summary: '比较真实增量 Δy、线性增量 dy 和余差，检查 |Δy−dy|/h²。', code: differentialRule,
    }),
  ], [
    ['src', 'derivative'], ['stepH', 'derivative', 'h'],
    ['src', 'chain'], ['stepH', 'chain', 'aux'],
    ['src', 'differential'], ['stepH', 'differential', 'aux'],
  ], ['differential', 'derivative', 'chain'], [sliderParam(step)]);
}

function integrals(title: string): CanvasDoc {
  const divisions = slider('divisions', '分割数 n', 505, 12, 2, 64, 2);
  const power = slider('power', '反常积分指数 p', 710, 1.25, 0.5, 2, 0.05);
  const initial = 'exp(x)';
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '无限长的尾部能积出有限面积吗？\n拖 n 比误差，拖 p 穿过 1。\n把 n 接到黎曼和与求积竞赛。'),
    functionNode(initial), divisions, power,
    node('integral', 'integral', 420, 40, { lower: 0, upper: 1, n: 12, method: 1 }),
    node('ftc', 'ftcView', 420, 420, { a: 0, x: 1, n: 12, constant: 0.75 }),
    rule('quadrature', 840, 40, {
      title: '求积精度赛', preferredView: 'chart', sampleProfile: 'quadrature',
      auxiliaryKind: 'scalar', presetSource: 'text', controls: [],
      summary: '在 [0,1] 对同一函数比较四种求积法的数值误差。', code: quadratureRule,
      presets: [
        { label: '指数曲线', text: initial, params: {} },
        { label: '二次函数', text: 'x^2', params: {} },
        { label: '四次函数', text: 'x^4', params: {} },
      ],
    }),
    rule('improper', 840, 450, {
      title: '反常积分的 p=1 临界线', preferredView: 'chart', presetSource: { param: 'power' },
      summary: '逐步延伸积分上限 R，比较 p<1、p=1 与 p>1 的累积面积。', code: improperIntegralRule,
      controls: [control('power', '指数 p', 1.25, 0.5, 2, 0.05)],
      presets: [
        { label: '幂次发散', params: { power: 0.75 } },
        { label: '对数发散', params: { power: 1 } },
        { label: '面积收敛', params: { power: 1.5 } },
      ],
    }),
  ], [
    ['src', 'integral'], ['divisions', 'integral', 'n'],
    ['src', 'ftc'], ['divisions', 'ftc', 'n'],
    ['src', 'quadrature'], ['divisions', 'quadrature', 'aux'],
    ['power', 'improper'],
  ], ['quadrature', 'integral', 'ftc', 'improper'], [
    sliderParam(divisions), sliderParam(power),
    { node_id: 'ftc', param_key: 'x', label: 'FTC 上限 x', min: 0, max: 2, step: 0.05 },
    { node_id: 'ftc', param_key: 'constant', label: '积分常数 C', min: -3, max: 3, step: 0.1 },
  ]);
}

function integralApplications(title: string): CanvasDoc {
  const slices = slider('slices', '切片数 N', 515, 12, 2, 32, 1);
  const initial = '1+x';
  const config = {
    sampleProfile: 'integralApplications' as const, auxiliaryKind: 'scalar' as const, presetSource: 'text' as const,
    presets: [
      { label: '等宽轮廓', text: '1', params: {} },
      { label: '线性收放', text: 'x', params: {} },
      { label: '弧形轮廓', text: 'sqrt(x)', params: {} },
    ],
  };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '截面累加能算体积和水压力吗？\n增大 N，把轮廓改成 x。\n把轮廓和 N 同时接到两个应用。'),
    functionNode(initial), slices,
    node('profile', 'functionPlot', 420, 40, { min: 0, max: 1, x: 0.5 }),
    rule('disks', 420, 385, {
      ...config, title: '旋转体圆盘切片', preferredView: 'shapes', controls: [],
      summary: '以 |f(x)| 为半径绕 x 轴旋转，对照圆盘阶梯、光滑轮廓和体积误差。', code: diskSlicesRule,
    }),
    rule('dam', 820, 40, {
      ...config, title: '水坝压强与抽水做功', preferredView: 'shapes',
      summary: '令坝宽 b(d)=B|f(d/H)|，求垂直坝面的静水合力，并计算把同宽、长 L 的水池抽到出口所需的重力功。',
      code: damWorkRule,
      controls: [
        control('depth', '水深 H（米）', 10, 1, 25, 0.5),
        control('width', '基准坝宽 B（米）', 4, 1, 12, 0.5),
        control('length', '水池长度 L（米）', 4, 1, 20, 0.5),
        control('rise', '出口高出水面（米）', 1, 0, 10, 0.5),
      ],
    }),
  ], [
    ['src', 'profile'],
    ['src', 'disks'], ['slices', 'disks', 'aux'],
    ['src', 'dam'], ['slices', 'dam', 'aux'],
  ], ['disks', 'dam', 'profile'], [
    sliderParam(slices),
    { node_id: 'dam', param_key: 'depth', label: '水深 H（米）', min: 1, max: 25, step: 0.5 },
    { node_id: 'dam', param_key: 'width', label: '基准坝宽 B（米）', min: 1, max: 12, step: 0.5 },
    { node_id: 'dam', param_key: 'length', label: '水池长度 L（米）', min: 1, max: 20, step: 0.5 },
    { node_id: 'dam', param_key: 'rise', label: '出口高出水面（米）', min: 0, max: 10, step: 0.5 },
  ]);
}

function spaceGeometry(title: string): CanvasDoc {
  const plane = slider('plane', '截平面高度 c', 225, 0.8, -3, 3, 0.05);
  const surfaceMode = slider('surfaceMode', '曲面类型 0–2', 380, 0, 0, 2, 1);
  const common = {
    auxiliaryKind: 'scalar' as const, presetSource: { param: 'surface' },
    controls: [{
      key: 'surface', label: '曲面类型', value: 0,
      options: [{ value: 0, label: '马鞍面' }, { value: 1, label: '上开抛物面' }, { value: 2, label: '下开抛物面' }],
    }],
    presets: [
      { label: '马鞍面', params: { surface: 0 } },
      { label: '上开抛物面', params: { surface: 1 } },
      { label: '下开抛物面', params: { surface: 2 } },
    ],
  };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '穿过马鞍面时，截痕为何转向？\n把 c 从正值拖到负值。\n把同一 c 接到截痕和高度热图。'),
    plane, surfaceMode,
    rule('vectors', 420, 40, {
      title: '点积投影与叉积面积', preferredView: 'shapes', presetSource: { param: 'level' }, code: vectorGeometryRule,
      summary: '令向量 a 的 z 分量等于 c，对照 a 在 b 上的有向投影及两向量张成的空间面积。',
      controls: [
        control('level', '截平面高度 c', 0.8, -3, 3, 0.05),
        control('ax', 'aₓ', 1.2, -2, 2, 0.1), control('ay', 'aᵧ', 1, -2, 2, 0.1),
        control('bx', 'bₓ', 1, -2, 2, 0.1), control('by', 'bᵧ', -0.5, -2, 2, 0.1), control('bz', 'b_z', 0.4, -2, 2, 0.1),
      ],
      presets: [
        { label: '空间向量', params: { level: 0.8, ax: 1.2, ay: 1, bx: 1, by: -0.5, bz: 0.4 } },
        { label: '点积为零', params: { level: 0, ax: 1, ay: 0, bx: 0, by: 1, bz: 0 } },
        { label: '反向投影', params: { level: -1, ax: -1, ay: 1, bx: 1, by: 0, bz: 0 } },
      ],
    }),
    rule('traces', 820, 40, {
      ...common, title: '二次曲面三视图', preferredView: 'shapes', code: surfaceTracesRule,
      summary: '对照水平 z=c 截痕以及固定 x=0、y=0 的侧面截痕。',
    }),
    rule('heights', 820, 405, {
      ...common, title: '高度场热图', preferredView: 'grid', code: heightFieldRule,
      summary: '用 z−c 表示曲面相对截平面的高度，蓝色在下、红色在上。',
    }),
  ], [
    ['plane', 'vectors'],
    ['surfaceMode', 'traces'], ['plane', 'traces', 'aux'],
    ['surfaceMode', 'heights'], ['plane', 'heights', 'aux'],
  ], ['traces', 'heights', 'vectors'], [
    sliderParam(plane), sliderParam(surfaceMode),
    { node_id: 'vectors', param_key: 'ax', label: 'aₓ', min: -2, max: 2, step: 0.1 },
    { node_id: 'vectors', param_key: 'ay', label: 'aᵧ', min: -2, max: 2, step: 0.1 },
  ]);
}

function multipleIntegrals(title: string): CanvasDoc {
  const bias = slider('bias', '密度偏置 a', 610, 0.5, -0.8, 0.8, 0.05);
  const options = { sampleProfile: 'diskDensity' as const, presetSource: 'text' as const, controls: [],
    presets: [
      { label: '均匀薄板', text: '1', params: {} },
      { label: '水平密度偏置', text: '1+a*x', params: {} },
      { label: '竖直密度偏置', text: '1+a*y', params: {} },
    ] };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '总质量不变，质心也会不动吗？\n拖动 a 穿过零点，观察质心。\n把同一密度接到三个观察积木。'),
    node('density', 'func2dSource', 40, 225, { a: 0.5, b: 1 }, '1+a*x'),
    bias,
    node('double', 'doubleIntegralView', 420, 40),
    rule('jacobian', 420, 410, {
      ...options, title: '极坐标网格畸变', preferredView: 'shapes', code: jacobianRule,
      summary: '比较参数平面中的网格与实际圆盘的扇形，同时计算乘 r 和漏乘 r 的积分。',
    }),
    rule('centroid', 840, 40, {
      ...options, title: '薄板密度与质心', preferredView: 'grid', code: diskCentroidRule,
      summary: '在同一单位圆盘上积分密度及一阶矩，比较热图与质心标靶。',
    }),
  ], [
    ['bias', 'density', 'a'], ['density', 'double'], ['density', 'jacobian'], ['density', 'centroid'],
  ], ['centroid', 'jacobian', 'double'], [sliderParam(bias)]);
}

function vectorCalculus(title: string): CanvasDoc {
  const radius = slider('radius', '路径半径 R', 515, 1, 0.25, 2.5, 0.05);
  const options = { auxiliaryKind: 'scalar' as const, presetSource: 'text' as const, controls: [],
    presets: VECTOR_FIELDS.map(({ label, text }) => ({ label, text, params: {} })) };
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '绕一圈一定做功吗？\n切换势场与涡流，拖动 R。\n把同一个 (P,Q) 接给三块积木。'),
    node('field', 'vectorFieldSource', 40, 225, {}, VECTOR_FIELDS[1].text),
    radius,
    rule('path', 420, 40, {
      ...options, title: '绕圈做功', preferredView: 'shapes', code: fieldPathRule,
      summary: '质点沿逆时针圆周移动，逐步累加场沿切向做的功。',
    }),
    rule('fieldHeat', 420, 460, {
      ...options, title: '旋度与散度热图', preferredView: 'grid', code: differentialHeatRule,
      summary: '查看同一区域内的旋度和散度，切换帧对比。',
    }),
    rule('theorems', 820, 40, {
      ...options, title: '格林与散度定理', preferredView: 'chart', code: fieldTheoremsRule,
      summary: '分别计算边界环量和外向通量，再与面积积分、单位高圆柱的体积分核对。',
    }),
  ], [
    ['field', 'path'], ['radius', 'path', 'aux'],
    ['field', 'fieldHeat'], ['radius', 'fieldHeat', 'aux'],
    ['field', 'theorems'], ['radius', 'theorems', 'aux'],
  ], ['path', 'fieldHeat', 'theorems'], [sliderParam(radius)]);
}

export function calculusSandboxMoreDoc(kind: CalculusSandboxMoreKind, title: string): CanvasDoc {
  switch (kind) {
    case 'ch01-limits': return limits(title);
    case 'ch02-derivatives': return derivatives(title);
    case 'ch04-integrals': return integrals(title);
    case 'ch06-integral-apps': return integralApplications(title);
    case 'ch08-space-geometry': return spaceGeometry(title);
    case 'ch10-multiple-int': return multipleIntegrals(title);
    case 'ch11-vector-calc': return vectorCalculus(title);
  }
}
