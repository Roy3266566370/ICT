/** 大学物理整章全景沙盘（第二批：第 2/3/4/6/7/9 章）。
 *
 * 与 physicsSandboxes.ts 同模式：混合既有物理积木（内置演示）与
 * aiRuleBlock 确定性规则（缺失视图 + 守恒/扫描核对），panel 已预设仪器态。
 */
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  carnotAuditRule, dopplerRule, maxwellRule, motionalEmfRule, pendulumAuditRule,
  rcChargeRule, resonanceScanRule, rollRaceRule, snellRule, spinUpRule,
  standingWaveRule, thinLensRule,
} from './physicsSandboxRules.ts';
import type { CanvasDoc } from './types.ts';

export type PhysicsSandboxMoreKind =
  | 'phy02-rigid-rotation' | 'phy03-oscillations' | 'phy04-waves'
  | 'phy06-induction-circuits' | 'phy07-geometric-optics' | 'phy09-thermodynamics';

export function physicsSandboxMoreDoc(kind: PhysicsSandboxMoreKind, title: string): CanvasDoc {
  switch (kind) {
    case 'phy02-rigid-rotation': return rigidRotationSandbox(title);
    case 'phy03-oscillations': return oscillationsSandbox(title);
    case 'phy04-waves': return wavesSandbox(title);
    case 'phy06-induction-circuits': return inductionCircuitsSandbox(title);
    case 'phy07-geometric-optics': return geometricOpticsSandbox(title);
    default: return thermodynamicsSandbox(title);
  }
}

/* ---------- 第 2 章 刚体转动与角动量 ---------- */

function rigidRotationSandbox(title: string): CanvasDoc {
  const alpha = slider('alpha', '斜面倾角 α (°)', 225, 30, 10, 60, 1);
  const radius = slider('radius', '半径 R (m)', 365, 0.3, 0.1, 0.6, 0.02);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '谁最先滚到底？\n惯量分布决定快慢，半径只改圈数。\n收臂为什么越转越快、动能却增加？'),
    alpha, radius,
    rule('rollRace', 420, 40, {
      title: '无滑滚落竞赛', summary: '实心球/圆盘/圆环同 m 同 R：I 越小 a 越大先到，与 R 无关。',
      preferredView: 'shapes', code: rollRaceRule,
      controls: [
        control('alpha', 'α 回落 (°)', 30, 10, 60, 1),
        control('radius', 'R 回落 (m)', 0.3, 0.1, 0.6, 0.02),
      ],
      presets: [
        { label: '缓坡 α=15°', params: { alpha: 15 } },
        { label: '标准 α=30°', params: { alpha: 30 } },
        { label: '陡坡 α=55°', params: { alpha: 55 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'alpha' },
    }),
    rule('spinUp', 420, 470, {
      title: '角动量守恒收臂', summary: 'L=mvr 守恒：r 减半 ω 增至 4 倍，转动动能反而 ×4——功来自手的拉力。',
      preferredView: 'shapes', code: spinUpRule,
      controls: [
        control('r', 'r 回落 (m)', 0.3, 0.1, 0.6, 0.02),
        control('v0', '初始速率 v₀', 1.2, 0.4, 3, 0.1),
      ],
      presets: [
        { label: '收臂 r=0.12', params: { r: 0.12 } },
        { label: '中间 r=0.3', params: { r: 0.3 } },
        { label: '展臂 r=0.58', params: { r: 0.58 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'r' },
    }),
  ], [
    ['alpha', 'rollRace'], ['radius', 'rollRace', 'aux'], ['radius', 'spinUp'],
  ], ['rollRace', 'spinUp'], [
    sliderParam(alpha), sliderParam(radius),
    { node_id: 'spinUp', param_key: 'v0', label: '初始速率 v₀', min: 0.4, max: 3, step: 0.1 },
  ]);
}

/* ---------- 第 3 章 振动、阻尼与共振 ---------- */

function oscillationsSandbox(title: string): CanvasDoc {
  const damp = slider('damp', '阻尼系数 c', 225, 0.4, 0.02, 1.5, 0.02);
  const drive = slider('drive', '驱动频率 ωd', 365, 3.16, 0.5, 8, 0.05);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '共振峰何时最高？\n阻尼 c 压低并展宽共振峰，\n能量在动能与势能间来回换手。'),
    damp, drive,
    node('tick', 'ticker', 40, 510, { period: 6, running: 1 }),
    node('pend', 'pendulum', 420, 40, { L: 1.5, theta0: 55, g: 9.8, m: 1, running: 1, showForce: 0, showVelocity: 0, showStrobe: 0, alt: 1 }),
    node('reson', 'resonanceLab', 420, 470, { k: 10, m: 1, c: 0.4, f0: 1, wd: 3.16, running: 1 }),
    rule('pendAudit', 840, 40, {
      title: '单摆能量账本', summary: '上游 body 实时给出 Ek/Ep/θ：无阻尼时总量守恒；大摆角周期被拉长。',
      preferredView: 'shapes', code: pendulumAuditRule,
      controls: [control('thetaAmp', '分析摆幅 θ₀ (°)', 55, 5, 85, 1)],
      presets: [
        { label: '小摆角 10°', params: { thetaAmp: 10 } },
        { label: '中摆角 45°', params: { thetaAmp: 45 } },
        { label: '大摆角 80°', params: { thetaAmp: 80 } },
      ],
      presetSource: 'text',
    }),
    rule('resonanceScan', 840, 430, {
      title: '幅频特性扫描', summary: 'A(ωd)=F₀/√((k−mω²)²+(cω)²)：c 越小峰越高越窄，峰位≈ω0。',
      preferredView: 'chart', code: resonanceScanRule,
      controls: [
        control('c', 'c 回落', 0.4, 0.02, 1.5, 0.02),
        control('wd', 'ωd 回落', 3.16, 0.5, 8, 0.05),
        control('k', '弹性系数 k', 10, 2, 20, 0.5),
        control('m', '质量 m', 1, 0.4, 4, 0.1),
        control('f0', '驱动力幅 F₀', 1, 0.2, 3, 0.1),
      ],
      presets: [
        { label: '轻阻尼 c=0.08', params: { c: 0.08 } },
        { label: '标准 c=0.4', params: { c: 0.4 } },
        { label: '重阻尼 c=1.2', params: { c: 1.2 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'c' },
    }),
  ], [
    ['tick', 'pend', 't'], ['tick', 'reson', 't'],
    ['pend', 'pendAudit'],
    ['damp', 'resonanceScan'], ['drive', 'resonanceScan', 'aux'],
  ], ['pend', 'reson', 'resonanceScan', 'pendAudit'], [
    sliderParam(damp), sliderParam(drive),
    { node_id: 'pend', param_key: 'theta0', label: '摆幅 θ₀', min: 5, max: 85, step: 1 },
    { node_id: 'reson', param_key: 'wd', label: '共振台驱动 ωd', min: 0.5, max: 8, step: 0.05 },
  ]);
}

/* ---------- 第 4 章 机械波、叠加与多普勒 ---------- */

function wavesSandbox(title: string): CanvasDoc {
  const freq = slider('freq', '频率 f (Hz)', 225, 1, 0.5, 3, 0.05);
  const srcV = slider('srcV', '波源速度 vs (×c)', 365, 0.4, 0, 1.2, 0.02);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '波前为什么前密后疏？\nvs 推高前方频率、拉宽后方，\n超过 c 时波前堆成马赫锥。'),
    freq, srcV,
    node('tick', 'ticker', 40, 510, { period: 6, running: 1 }),
    node('wave', 'waveLab', 420, 40, { amp: 0.6, freq: 1, lambda: 2, mode: 0, running: 1 }),
    rule('standing', 420, 470, {
      title: '行波 vs 驻波', summary: '行波以 v=fλ 整体平移输能；驻波波节钉死，净能流为零。',
      preferredView: 'shapes', code: standingWaveRule,
      controls: [
        control('f', 'f 回落 (Hz)', 1, 0.5, 3, 0.05),
        control('lambda', '波长 λ', 2, 0.8, 4, 0.1),
      ],
      presets: [
        { label: '低频 f=0.6', params: { f: 0.6 } },
        { label: '标准 f=1.0', params: { f: 1 } },
        { label: '高频 f=2.6', params: { f: 2.6 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'f' },
    }),
    rule('doppler', 840, 180, {
      title: '多普勒波前与马赫锥', summary: '移动波源波前压缩/拉伸；vs≥c 时出现半角 asin(c/vs) 的锥面。',
      preferredView: 'shapes', code: dopplerRule,
      controls: [control('vs', 'vs 回落 (×c)', 0.4, 0, 1.2, 0.02)],
      presets: [
        { label: '静止 vs=0', params: { vs: 0 } },
        { label: '亚音速 vs=0.6', params: { vs: 0.6 } },
        { label: '超音速 vs=1.15', params: { vs: 1.15 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'vs' },
    }),
  ], [
    ['tick', 'wave', 't'],
    ['freq', 'standing'], ['srcV', 'doppler'],
  ], ['wave', 'standing', 'doppler'], [
    sliderParam(freq), sliderParam(srcV),
    { node_id: 'wave', param_key: 'freq', label: '波场频率', min: 0.5, max: 3, step: 0.05 },
    { node_id: 'standing', param_key: 'lambda', label: '波长 λ', min: 0.8, max: 4, step: 0.1 },
  ]);
}

/* ---------- 第 6 章 电磁感应与交流暂态 ---------- */

function inductionCircuitsSandbox(title: string): CanvasDoc {
  const ohm = slider('ohm', '回路电阻 R (Ω)', 225, 20, 5, 100, 1);
  const bField = slider('bField', '磁感应强度 B (T)', 365, 0.8, 0.2, 2, 0.05);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '一根棒为什么会自己刹车？\n安培力把动能炼成焦耳热；\nR 与 B 共同决定时间常数。'),
    ohm, bField,
    node('rlc', 'rlcCircuitLab', 420, 40, { r: 20, l: 0.08, c: 0.002, freq: 3, amplitude: 12, seconds: 2.4, drive: 1 }),
    rule('motionalEmf', 420, 470, {
      title: '导体棒切割磁感线', summary: 'v=v₀e^(−t/τ)，τ=mR/(B²L²)；初始动能全部变成焦耳热。',
      preferredView: 'shapes', code: motionalEmfRule,
      controls: [
        control('b', 'B 回落 (T)', 0.8, 0.2, 2, 0.05),
        control('r', 'R 回落 (Ω)', 20, 5, 100, 1),
        control('rail', '轨距 L (m)', 0.5, 0.2, 1, 0.05),
        control('mass', '棒质量 m (kg)', 0.5, 0.1, 2, 0.05),
        control('v0', '初速 v₀ (m/s)', 4, 1, 8, 0.2),
      ],
      presets: [
        { label: '弱磁慢刹 B=0.3', params: { b: 0.3 } },
        { label: '标准 B=0.8', params: { b: 0.8 } },
        { label: '强磁急刹 B=1.8', params: { b: 1.8 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'b' },
    }),
    rule('rcCharge', 840, 180, {
      title: 'RC 充电暂态', summary: 'τ=RC 决定充电快慢；电源能量一半储能、一半在电阻上烧掉。',
      preferredView: 'chart', code: rcChargeRule,
      controls: [
        control('r', 'R 回落 (Ω)', 20, 5, 100, 1),
        control('cap', '电容 C (mF)', 1, 0.2, 4, 0.1),
        control('u0', '电源 U₀ (V)', 12, 3, 24, 0.5),
      ],
      presets: [
        { label: '快充 R=6Ω', params: { r: 6 } },
        { label: '标准 R=20Ω', params: { r: 20 } },
        { label: '慢充 R=80Ω', params: { r: 80 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'r' },
    }),
  ], [
    ['bField', 'motionalEmf'], ['ohm', 'motionalEmf', 'aux'], ['ohm', 'rcCharge'],
  ], ['rlc', 'motionalEmf', 'rcCharge'], [
    sliderParam(ohm), sliderParam(bField),
    { node_id: 'rcCharge', param_key: 'cap', label: '电容 C (mF)', min: 0.2, max: 4, step: 0.1 },
    { node_id: 'rlc', param_key: 'freq', label: '示波器激励频率', min: 0.5, max: 8, step: 0.1 },
  ]);
}

/* ---------- 第 7 章 折射、全反射与透镜 ---------- */

function geometricOpticsSandbox(title: string): CanvasDoc {
  const incident = slider('incident', '入射角 θ (°)', 225, 35, 0, 89, 1);
  const objDist = slider('objDist', '物距 u (mm)', 365, 90, 15, 160, 1);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '折射光何时突然消失？\nθ 越过临界角 → 全反射锁光；\n物距跨过 f → 实像翻成放大虚像。'),
    incident, objDist,
    node('bench', 'opticsBench', 420, 40,
      { mode: 2, wavelength: 550, focal: 45, objectDistance: 70, slitSpacing: 0.35, screenDistance: 120, n1: 1, n2: 1.5 }),
    rule('snell', 840, 40, {
      title: '斯涅尔折射 → 全反射', summary: 'n₁sinθ=n₂sinθ₂；θ>θc 时折射光消失，能量全部回到光密介质。',
      preferredView: 'shapes', code: snellRule,
      controls: [
        control('theta', 'θ 回落 (°)', 35, 0, 89, 1),
        control('n1', 'n₁ 光密', 1.5, 1, 2.5, 0.05),
        control('n2', 'n₂ 光疏', 1, 1, 1.6, 0.05),
      ],
      presets: [
        { label: '小于临界 θ=30°', params: { theta: 30 } },
        { label: '临界附近 θ=41°', params: { theta: 41 } },
        { label: '全反射 θ=55°', params: { theta: 55 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'theta' },
    }),
    rule('lens3', 840, 430, {
      title: '薄透镜三条特殊光线', summary: '平行→焦、过心直、过焦→平行三线定像；v=uf/(u−f)。',
      preferredView: 'shapes', code: thinLensRule,
      controls: [
        control('u', 'u 回落 (mm)', 90, 15, 160, 1),
        control('focal', '焦距 f (mm)', 45, 20, 80, 1),
      ],
      presets: [
        { label: 'u=3f 缩小实像', params: { u: 135 } },
        { label: 'u=1.5f 放大实像', params: { u: 68 } },
        { label: 'u<f 放大虚像', params: { u: 30 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'u' },
    }),
  ], [
    ['incident', 'snell'], ['objDist', 'lens3'],
  ], ['bench', 'snell', 'lens3'], [
    sliderParam(incident), sliderParam(objDist),
    { node_id: 'snell', param_key: 'n1', label: '折射率 n₁', min: 1, max: 2.5, step: 0.05 },
    { node_id: 'lens3', param_key: 'focal', label: '焦距 f', min: 20, max: 80, step: 1 },
  ]);
}

/* ---------- 第 9 章 分子动理论与热力学循环 ---------- */

function thermodynamicsSandbox(title: string): CanvasDoc {
  const tHot = slider('tHot', '高温热源 T_H (K)', 225, 600, 400, 900, 10);
  return board(title, [
    node('task', 'textNote', 40, 40, {}, '热机效率的天花板是谁？\nT_H 推高卡诺效率与分子速率；\n闭合面积就是每循环净功。'),
    tHot,
    node('thermo', 'thermoCycle', 420, 40, { hot: 600, cold: 300, compression: 3, gamma: 1.4 }),
    rule('maxwell', 420, 470, {
      title: '麦克斯韦速率分布', summary: 'f(v)∝v²e^(−mv²/2kT)：T 升高峰右移变宽，盒中分子运动加快。',
      preferredView: 'shapes', code: maxwellRule,
      controls: [control('tHot', 'T 回落 (K)', 600, 100, 900, 10)],
      presets: [
        { label: '低温 150K', params: { tHot: 150 } },
        { label: '室温 300K', params: { tHot: 300 } },
        { label: '高温 900K', params: { tHot: 900 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'tHot' },
    }),
    rule('carnot', 840, 180, {
      title: '卡诺循环与效率对账', summary: 'P–V 环面积=W净=Qh−Qc；W/Qh 恰好等于 1−Tc/Th。',
      preferredView: 'shapes', code: carnotAuditRule,
      controls: [
        control('tHot', 'T_H 回落 (K)', 600, 250, 900, 10),
        control('cold', '低温 T_C (K)', 300, 80, 500, 5),
        control('r', '压缩比 r', 3, 1.2, 6, 0.1),
      ],
      presets: [
        { label: '低效机 Th=400', params: { tHot: 400, cold: 320 } },
        { label: '标准 Th=600', params: { tHot: 600, cold: 300 } },
        { label: '高效机 Th=880', params: { tHot: 880, cold: 240 } },
      ],
      auxiliaryKind: 'scalar', presetSource: { param: 'tHot' },
    }),
  ], [
    ['tHot', 'maxwell'], ['tHot', 'carnot'],
  ], ['thermo', 'maxwell', 'carnot'], [
    sliderParam(tHot),
    { node_id: 'thermo', param_key: 'cold', label: '循环低温 T₂', min: 150, max: 500, step: 5 },
    { node_id: 'carnot', param_key: 'cold', label: '卡诺低温 T_C', min: 80, max: 500, step: 5 },
    { node_id: 'carnot', param_key: 'r', label: '压缩比 r', min: 1.2, max: 6, step: 0.1 },
  ]);
}
