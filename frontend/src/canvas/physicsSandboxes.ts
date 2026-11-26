/** 大学物理整章全景沙盘（第一批：第 1/5/8/10 章）。
 *
 * 每章画布 = 任务卡 + 1–2 个主控滑杆 + 中间列核心视觉 + 右列核对视图；
 * 一个源头经连线同时驱动多个视角，panel 已预设仪器态。
 * 布局约定沿用 calculusSandboxes：col1 x=40 任务与源头，col2 x=420 主视觉，col3 x=840 核对。
 * 第二批（第 2/3/4/6/7/9 章）在 physicsSandboxesMore.ts。
 */
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import { physicsSandboxMoreDoc, type PhysicsSandboxMoreKind } from './physicsSandboxesMore.ts';
import {
  collisionRule, dragProjectileRule, emSelectorRule, energyDissipationRule, gratingRule,
  interferenceRule, orbitAuditRule, photoelectricRule, polarizerRule, quantumWellRule,
  relativityRule,
} from './physicsSandboxRules.ts';
import type { CanvasDoc } from './types.ts';

export type PhysicsSandboxKind =
  | PhysicsSandboxMoreKind | 'phy01-mechanics' | 'phy05-em-fields' | 'phy08-wave-optics' | 'phy10-modern-physics';

const SANDBOX_KINDS: readonly PhysicsSandboxKind[] = [
  'phy01-mechanics', 'phy02-rigid-rotation', 'phy03-oscillations', 'phy04-waves',
  'phy05-em-fields', 'phy06-induction-circuits', 'phy07-geometric-optics', 'phy08-wave-optics',
  'phy09-thermodynamics', 'phy10-modern-physics',
];

export function isPhysicsSandboxKind(kind: string | null): kind is PhysicsSandboxKind {
  return kind !== null && (SANDBOX_KINDS as readonly string[]).includes(kind);
}

export function physicsSandboxDoc(kind: PhysicsSandboxKind, title: string): CanvasDoc {
  switch (kind) {
    case 'phy01-mechanics': return mechanicsSandbox(title);
    case 'phy05-em-fields': return emFieldsSandbox(title);
    case 'phy08-wave-optics': return waveOpticsSandbox(title);
    case 'phy10-modern-physics': return modernPhysicsSandbox(title);
    default: return physicsSandboxMoreDoc(kind, title);
  }
}

/* ---------- 第 1 章 质点运动、受力与守恒 ---------- */

function mechanicsSandbox(title: string): CanvasDoc {
  const v0 = slider('v0', '初速度 v₀ (m/s)', 225, 12, 5, 25, 0.5);
  const drag = slider('drag', '阻力系数 k (N·s/m)', 365, 0.05, 0, 0.35, 0.01);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '阻力把机械能吃到哪里？\n拖 v₀ 与 k，看双弹道与能量账。\n再切到碰撞：动量纹丝不动。'),
    v0, drag,
    rule('proj', 420, 40, {
      title: '理想 vs 阻力双弹道', summary: '同一 v₀ 下理想抛体与线性阻力抛体逐帧对照，附速度/阻力矢量。',
      preferredView: 'shapes', code: dragProjectileRule,
      controls: [
        control('v0', '初速度 v₀ (m/s)', 12, 5, 25, 0.5),
        control('angle', '发射角 θ (°)', 55, 20, 80, 1),
        control('k', '阻力系数 k', 0.05, 0, 0.35, 0.01),
      ],
      presets: [
        { label: '近射低速 v₀=8', params: { v0: 8, angle: 65 } },
        { label: '高速远射 v₀=22', params: { v0: 22, angle: 45 } },
        { label: '高抛弹道 θ=75°', params: { v0: 15, angle: 75 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'v0' },
    }),
    rule('collision', 420, 470, {
      title: '一维碰撞实验室', summary: 'm₁v₁+m₂v₂ 始终守恒；恢复系数 e 决定动能损失比例。',
      preferredView: 'shapes', code: collisionRule,
      controls: [
        control('v0', '上游 v₁ 缩放回落', 12, 5, 25, 0.5),
        control('e', '恢复系数 e', 0.7, 0, 1, 0.05),
        control('m2', 'm₂ (kg)', 1.6, 0.5, 4, 0.1),
        control('v2', 'v₂ (m/s)', -1.2, -4, 0, 0.1),
      ],
      presets: [
        { label: '完全弹性 e=1', params: { e: 1 } },
        { label: '重靶部分非弹性', params: { e: 0.5, m2: 2.5 } },
        { label: '完全非弹性 e=0', params: { e: 0 } },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('energyBar', 840, 180, {
      title: '机械能 ⇄ 耗散热账本', summary: 'Ek、Ep、累计耗散热三条曲线：E(t)+Q(t)=E₀ 始终成立。',
      preferredView: 'chart', code: energyDissipationRule,
      controls: [
        control('k', '阻力系数 k', 0.05, 0, 0.35, 0.01),
        control('v0', '初速度 v₀ (m/s)', 12, 5, 25, 0.5),
        control('angle', '发射角 θ (°)', 55, 20, 80, 1),
      ],
      presets: [
        { label: '真空 k=0', params: { k: 0 } },
        { label: '微风 k=0.10', params: { k: 0.1 } },
        { label: '强风 k=0.30', params: { k: 0.3, v0: 18 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'k' },
    }),
  ], [
    ['v0', 'proj'], ['drag', 'proj', 'aux'], ['v0', 'collision'], ['drag', 'energyBar'],
  ], ['proj', 'collision', 'energyBar'], [
    sliderParam(v0), sliderParam(drag),
    { node_id: 'proj', param_key: 'angle', label: '发射角 θ', min: 20, max: 80, step: 1 },
    { node_id: 'collision', param_key: 'e', label: '恢复系数 e', min: 0, max: 1, step: 0.05 },
  ]);
}

/* ---------- 第 5 章 静电场、磁场与带电粒子 ---------- */

function emFieldsSandbox(title: string): CanvasDoc {
  const bField = slider('bField', '磁感应强度 B (T)', 300, 1.2, 0.2, 2.5, 0.05);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '什么速度能直穿正交场？\n场源画出匀强 E，B 滑杆\n同时改写选择器与回旋半径。'),
    node('emSrc', 'emFieldSource', 40, 200,
      { mode: 0, uniform: 1, count: 2, x1: 55, y1: 65, s1: 1.5, x2: 100, y2: 65, s2: -1.2, ux: 0, uy: -1, uStrength: 1.2 }),
    bField,
    node('emView', 'emFieldView', 420, 40, { t: 0.65, px: 45, py: 65, vx: 0.8, vy: 0.2, charge: 1, mass: 1 }),
    rule('selector', 840, 40, {
      title: '速度选择器 → 磁偏转', summary: '只有 v=E/B 的粒子直穿缝隙，其余被挡；过缝粒子按 R=mv/(qB) 回旋。',
      preferredView: 'shapes', code: emSelectorRule,
      controls: [
        control('b', 'B 回落 (T)', 1.2, 0.2, 2.5, 0.05),
        control('e', '电场 E', 1.2, 0.5, 3, 0.1),
        control('velocity', '入射速度 v', 1, 0.3, 2.5, 0.05),
        control('mass', '质量 m', 1, 0.4, 3, 0.1),
        control('charge', '电荷 q', 1, 0.5, 3, 0.1),
      ],
      presets: [
        { label: '匹配速度直穿', params: { velocity: 1, e: 1.2, b: 1.2 } },
        { label: '速度过大上偏', params: { velocity: 1.9 } },
        { label: '重同位素大半径', params: { mass: 2.4, velocity: 1 } },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('orbitAudit', 840, 460, {
      title: '回旋半径与周期核对', summary: 'R(B)、T(B) 扫描曲线：半径反比于 B，周期只由荷质比与 B 决定。',
      preferredView: 'chart', code: orbitAuditRule,
      controls: [
        control('b', 'B 回落 (T)', 1.2, 0.2, 2.5, 0.05),
        control('mass', '质量 m', 1, 0.4, 3, 0.1),
        control('charge', '电荷 q', 1, 0.5, 3, 0.1),
        control('velocity', '速度 v', 1, 0.3, 2.5, 0.05),
      ],
      presets: [
        { label: '弱磁大轨道', params: { b: 0.4 } },
        { label: '标准场', params: { b: 1.2 } },
        { label: '强磁紧轨道', params: { b: 2.3 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'b' },
    }),
  ], [
    ['emSrc', 'emView'], ['bField', 'selector'], ['bField', 'orbitAudit'],
  ], ['emView', 'selector', 'orbitAudit'], [
    sliderParam(bField),
    { node_id: 'selector', param_key: 'e', label: '电场强度 E', min: 0.5, max: 3, step: 0.1 },
    { node_id: 'selector', param_key: 'velocity', label: '入射速度 v', min: 0.3, max: 2.5, step: 0.05 },
    { node_id: 'emView', param_key: 'charge', label: '示踪粒子电荷', min: -2, max: 2, step: 0.1 },
  ]);
}

/* ---------- 第 8 章 干涉、衍射与偏振 ---------- */

function waveOpticsSandbox(title: string): CanvasDoc {
  const lambda = slider('lambda', '波长 λ (nm)', 225, 550, 400, 700, 10);
  const slits = slider('slits', '缝数 N', 365, 2, 2, 12, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '条纹为什么随波长变宽？\nλ 改变条纹颜色与间距，\n缝数 N 把主极大压成细线。'),
    lambda, slits,
    rule('interfer', 420, 40, {
      title: '双缝干涉条纹屏', summary: '屏上条纹以真实波长颜色绘制，间距 Δy=λL/d 随 λ 线性变宽。',
      preferredView: 'shapes', code: interferenceRule,
      controls: [
        control('lambda', 'λ 回落 (nm)', 550, 400, 700, 10),
        control('slitSep', '缝距 d (mm)', 0.25, 0.05, 0.6, 0.05),
        control('screen', '屏距 L (m)', 1, 0.3, 3, 0.1),
      ],
      presets: [
        { label: '紫光 420nm', params: { lambda: 420 } },
        { label: '绿光 550nm', params: { lambda: 550 } },
        { label: '红光 650nm', params: { lambda: 650 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'lambda' },
    }),
    rule('polarizer', 420, 470, {
      title: '马吕斯偏振实验', summary: 'I=I₀cos²θ；在正交双片之间插入 45° 中片，光竟重新透出。',
      preferredView: 'shapes', code: polarizerRule,
      controls: [
        control('lambda', 'λ 回落 (nm)', 550, 400, 700, 10),
        control('theta', '检偏角 θ (°)', 60, 0, 90, 5),
        control('middle', '插入 45° 中片', 0, 0, 1, 1),
      ],
      presets: [
        { label: 'θ=45° 半透', params: { theta: 45 } },
        { label: 'θ=90° 全消光', params: { theta: 90 } },
        { label: '90°+中片复亮', params: { theta: 90, middle: 1 } },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
    rule('grating', 840, 180, {
      title: 'N 缝光栅强度分布', summary: '主极大随 N 变窄变锐，次级被压平，并乘上单缝衍射包络。',
      preferredView: 'chart', code: gratingRule,
      controls: [
        control('slits', 'N 回落', 2, 2, 12, 1),
        control('dOverA', 'd/a 比', 3, 1.2, 8, 0.2),
      ],
      presets: [
        { label: '双缝 N=2', params: { slits: 2 } },
        { label: '五缝 N=5', params: { slits: 5 } },
        { label: '十缝 N=10', params: { slits: 10 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'slits' },
    }),
  ], [
    ['lambda', 'interfer'], ['lambda', 'polarizer'], ['slits', 'grating'],
  ], ['interfer', 'polarizer', 'grating'], [
    sliderParam(lambda), sliderParam(slits),
    { node_id: 'polarizer', param_key: 'theta', label: '检偏角 θ', min: 0, max: 90, step: 5 },
    { node_id: 'polarizer', param_key: 'middle', label: '插入 45° 中片', min: 0, max: 1, step: 1 },
  ]);
}

/* ---------- 第 10 章 相对论与量子物理入门 ---------- */

function modernPhysicsSandbox(title: string): CanvasDoc {
  const beta = slider('beta', '速度 β=v/c', 225, 0.6, 0, 0.98, 0.01);
  const freq = slider('freq', '频率 ν (×10¹⁴Hz)', 365, 6, 3, 12, 0.1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '接近光速时什么变了？\nβ 推高 γ 改钟改尺；\nν 决定光电子与量子跃迁。'),
    beta, freq,
    rule('relativity', 420, 40, {
      title: '光钟 · 时间膨胀 · 尺缩', summary: '运动光钟走斜边变慢 γ 倍，飞船沿运动方向收缩为 L₀/γ。',
      preferredView: 'shapes', code: relativityRule,
      controls: [control('beta', 'β 回落', 0.6, 0, 0.98, 0.01)],
      presets: [
        { label: '巡航 β=0.1', params: { beta: 0.1 } },
        { label: '高速 β=0.6', params: { beta: 0.6 } },
        { label: '近光 β=0.95', params: { beta: 0.95 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'beta' },
    }),
    rule('photo', 420, 470, {
      title: '光电效应 I–U 与截止', summary: 'hν<W 时再强光也无电流；越过 ν0 后遏止电压线性增长。',
      preferredView: 'chart', code: photoelectricRule,
      controls: [
        control('nu', 'ν 回落 (×10¹⁴Hz)', 6, 3, 12, 0.1),
        control('work', '逸出功 W (eV)', 2.3, 1.5, 4.5, 0.1),
        control('intensity', '光强', 1, 0.2, 3, 0.1),
      ],
      presets: [
        { label: '低于截止 ν=5', params: { nu: 5 } },
        { label: '临界附近 ν=5.6', params: { nu: 5.6 } },
        { label: '充分光电 ν=9', params: { nu: 9 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'nu' },
    }),
    rule('well', 840, 180, {
      title: '一维无限深势阱', summary: '能级 En=n²E₁ 量子化，|ψn|² 出现节点；hν 对上 ΔE 才吸收。',
      preferredView: 'shapes', code: quantumWellRule,
      controls: [
        control('nu', 'ν 回落 (×10¹⁴Hz)', 6, 3, 12, 0.1),
        control('level', '量子数 n', 2, 1, 5, 1),
        control('e1', '基态能 E₁ (eV)', 0.5, 0.1, 3, 0.05),
      ],
      presets: [
        { label: '基态 n=1', params: { level: 1 } },
        { label: '三激发 n=3', params: { level: 3 } },
        { label: '高激发 n=5', params: { level: 5 } },
      ],
      auxiliaryKind: 'scalar', presetSource: 'text',
    }),
  ], [
    ['beta', 'relativity'], ['freq', 'photo'], ['freq', 'well'],
  ], ['relativity', 'photo', 'well'], [
    sliderParam(beta), sliderParam(freq),
    { node_id: 'well', param_key: 'level', label: '量子数 n', min: 1, max: 5, step: 1 },
    { node_id: 'photo', param_key: 'work', label: '逸出功 W', min: 1.5, max: 4.5, step: 0.1 },
  ]);
}
