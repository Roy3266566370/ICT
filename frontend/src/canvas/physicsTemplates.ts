import { buildPhysicsPipeline } from './physicsPipeline.ts';
import { isPhysicsSandboxKind, physicsSandboxDoc, type PhysicsSandboxKind } from './physicsSandboxes.ts';
import type { CanvasDoc } from './types.ts';

/** 旧版单点流水线模板 kind（仍可通过 ?template= 打开，见 legacy 标记）。 */
export type PhysicsPipelineKind =
  | 'projectile-drag' | 'incline-friction' | 'collision-momentum' | 'oscillation-wave'
  | 'charged-particle' | 'rc-circuit' | 'motional-emf'
  | 'double-slit' | 'refraction-fiber' | 'thin-lens'
  | 'carnot-cycle' | 'photoelectric';

export type PhysicsTemplateKind = PhysicsPipelineKind | PhysicsSandboxKind;

export interface PhysicsTemplate {
  kind: PhysicsTemplateKind;
  topic: 'p01' | 'p02' | 'p03' | 'p04' | 'p05';
  name: string; desc: string; tag: string;
  question: string; steps: string; observation: string;
  keywords: readonly string[];
  preview: 'projectile' | 'incline' | 'collision' | 'oscillation' | 'field' | 'circuit' | 'induction' | 'optics' | 'thermal' | 'quantum' | 'rotation' | 'modern';
  formula?: string;
  panorama?: true;
  legacy?: true;
}

export const PHYSICS_TOPICS: readonly { id: PhysicsTemplate['topic']; name: string; lead: string }[] = [
  { id: 'p01', name: '专题 01 · 经典力学与守恒律', lead: '从阻力弹道、滚落竞赛到碰撞守恒，一个源头同时驱动多条轨迹与能量账本。' },
  { id: 'p02', name: '专题 02 · 振动、机械波与声学', lead: '阻尼展宽共振峰、驻波锁住能流、波源移动挤压波前——振动与波在同一张画布上互证。' },
  { id: 'p03', name: '专题 03 · 电磁学与电路', lead: '正交场筛选速度、回旋轨道核对周期、电磁感应把动能炼成焦耳热。' },
  { id: 'p04', name: '专题 04 · 几何与波动光学', lead: '真实波长着色的条纹、临界角后的全反射、三条特殊光线的成像判决。' },
  { id: 'p05', name: '专题 05 · 热学与近代物理', lead: '分子速率分布联动卡诺效率，γ 因子改写时间长度，hν 决定光电与量子跃迁。' },
];

const sandboxEntry = (
  kind: PhysicsSandboxKind, topic: PhysicsTemplate['topic'],
  name: string, desc: string, tag: string,
  question: string, steps: string, observation: string,
  keywords: readonly string[], preview: PhysicsTemplate['preview'], formula: string,
): PhysicsTemplate => ({
  kind, topic, name, desc, tag, question, steps, observation, keywords, preview, formula, panorama: true,
});

/** 整章全景沙盘（置顶可见）。旧 12 个单点模板保留在下方 legacy 区以兼容已保存作品与链接。 */
export const PHYSICS_TEMPLATES: readonly PhysicsTemplate[] = [
  sandboxEntry('phy01-mechanics', 'p01', '质点运动与守恒全景',
    'v₀ 与阻力系数同时驱动双弹道、能量账本与碰撞实验，守恒量互证。',
    '大学物理 · 全景沙盘 · 第 1 章',
    '空气阻力怎样吃掉射程与机械能？碰撞中动量不变而动能为何可变？',
    '拖 v₀ 与 k 看理想/阻力弹道分岔；切到碰撞实验室扫恢复系数，核对 Σp 与动能损失。',
    '阻力弹道射程缩短且能量单调耗散；碰撞前后 Σp 纹丝不动，动能损失随 e 下降。',
    ['抛体', '空气阻力', '碰撞', '动量守恒', '机械能'], 'projectile', 'Σp 守恒 · E+Q=E₀'),
  sandboxEntry('phy02-rigid-rotation', 'p01', '刚体转动与角动量',
    '滚落竞赛比较三种惯量，收臂实验让 ω 与转动动能同时跳变。',
    '大学物理 · 全景沙盘 · 第 2 章',
    '同样的质量和半径，为什么球先到底？收臂时动能反而增加的功来自哪里？',
    '改变倾角看竞赛快慢不变序；收半径看 ω∝1/r² 与 Ek∝1/r² 同步上升。',
    'a=gsinα/(1+I/mR²) 与 R 无关；L 守恒下收臂 ω 猛增，手的拉力提供了新增动能。',
    ['刚体', '转动惯量', '滚落', '角动量守恒'], 'rotation', 'a=g sinα/(1+I/mR²)'),
  sandboxEntry('phy03-oscillations', 'p02', '振动、阻尼与共振',
    '单摆+受迫共振台同节拍运行，能量账本与幅频扫描同步核对。',
    '大学物理 · 全景沙盘 · 第 3 章',
    '大摆角把周期拉长多少？阻尼怎样压扁共振峰？',
    '改摆幅看 T/T₀ 偏离小角近似；扫 c 与 ωd 对比共振峰高窄变化，同时看 Ek/Ep 实时换手。',
    'T/T₀ 随摆幅单调上升；c 越小峰越高越窄，峰位锁定在 ω0=√(k/m) 附近。',
    ['单摆', '阻尼', '受迫振动', '共振', '能量'], 'oscillation', 'T≈2π√(L/g) · ω₀=√(k/m)'),
  sandboxEntry('phy04-waves', 'p02', '机械波、驻波与多普勒',
    '行波驻波同频对照，波源一移动波前就前密后疏直到马赫锥。',
    '大学物理 · 全景沙盘 · 第 4 章',
    '驻波为什么不输运能量？波源超过波速时波前去哪里了？',
    '让内置波场与行波/驻波对照同跑；推 vs 从静止到超音速，读前后方频移与马赫锥半角。',
    '驻波波节钉死净能流为零；vs→c 前方波前堆叠成激波，vs>c 出现 asin(c/vs) 马赫锥。',
    ['行波', '驻波', '多普勒效应', '马赫锥'], 'oscillation', "f′=f·c/(c∓vs)"),
  sandboxEntry('phy05-em-fields', 'p03', '电磁场与带电粒子',
    '匀强 E 场源铺出场线，B 滑杆同时改写速度选择器与回旋半径周期。',
    '大学物理 · 全景沙盘 · 第 5 章',
    '为什么只有 v=E/B 的粒子能直穿选择器？R 和 T 各由什么决定？',
    '看场线渲染与示踪粒子；拖 B 对比选择器过筛与磁区回旋，再核对 R(B)、T(B) 曲线。',
    'v=E/B 直穿，其余偏出缝隙；R=mv/(qB) 反比于 B，T 与速率无关，磁力不做功。',
    ['电场', '磁场', '速度选择器', '洛伦兹力', '回旋'], 'field', 'v=E/B · R=mv/(qB)'),
  sandboxEntry('phy06-induction-circuits', 'p03', '电磁感应与电路暂态',
    'R/B 驱动导体棒自动刹车与 RC 充电，动能-焦耳热闭环对账。',
    '大学物理 · 全景沙盘 · 第 6 章',
    '感应电流为何总阻碍运动？RC 暂态的能量去了哪里？',
    '推 B 看 τ=mR/(B²L²) 收缩、棒更快停；推 R 同时看棒的焦耳热与 RC 充电曲线。',
    '安培力把初始动能全部转为焦耳热；RC 充电一半储能一半耗散，τ 由 RC 乘积决定。',
    ['电磁感应', '动生电动势', 'RC 暂态', '焦耳热'], 'induction', 'ε=BLv · τ=RC'),
  sandboxEntry('phy07-geometric-optics', 'p04', '折射、全反射与薄透镜',
    '入射角推到临界角折射光消失；物距跨过 f 实像翻成虚像。',
    '大学物理 · 全景沙盘 · 第 7 章',
    '光在什么条件下被锁进介质？像的实虚正倒由什么判决？',
    '拖 θ 越过 θc 看折射光消失、光被锁进光纤；拖 u 跨过 f 看三条特殊光线改画虚像。',
    'θ>θc=asin(n₂/n₁) 时全反射；u>f 成倒立实像，u<f 成正立放大虚像，v=uf/(u−f)。',
    ['折射', '全反射', '光纤', '薄透镜', '成像'], 'optics', 'n₁sinθ₁=n₂sinθ₂ · 1/f=1/u+1/v'),
  sandboxEntry('phy08-wave-optics', 'p04', '干涉、衍射与偏振',
    'λ 决定条纹真颜色与间距，N 缝把主极大压锐，偏振片上演消光复亮。',
    '大学物理 · 全景沙盘 · 第 8 章',
    '条纹间距随什么线性变化？正交双片间插入 45° 中片为何重亮？',
    '拖 λ 看条纹变色变宽；拖 N 看主极大锐化；转检偏角并插入 45° 中片对比透过率。',
    'Δy=λL/d 随 λ 线性增长；N 增大主极大变窄；I=I₀cos²θ，45° 中片让 90° 消光处复亮。',
    ['双缝干涉', '光栅', '偏振', '马吕斯定律'], 'optics', 'Δy=λL/d · I=I₀cos²θ'),
  sandboxEntry('phy09-thermodynamics', 'p05', '分子热运动与热机',
    'T_H 同时推高分子速率分布与卡诺效率，P-V 面积核对净功。',
    '大学物理 · 全景沙盘 · 第 9 章',
    '温度升高分布曲线怎样变形？效率天花板为什么只由两个温度决定？',
    '拖 T_H 看分子盒加速、速率分布右移变宽；同源的卡诺环 W/Qh 与 1−Tc/Th 对账。',
    'vp=√(2kT/m) 随 T 增长；卡诺效率 η=1−Tc/Th，实测 W/Qh 恰好等于它。',
    ['麦克斯韦分布', '卡诺循环', '热机效率', 'P-V 图'], 'thermal', 'η=1−T꜀/Tₕ'),
  sandboxEntry('phy10-modern-physics', 'p05', '相对论与量子入门',
    'β 推高 γ 改钟改尺，ν 同时决定光电子逸出与势阱跃迁吸收。',
    '大学物理 · 全景沙盘 · 第 10 章',
    '运动钟为什么慢？频率怎样一票否决光电与量子吸收？',
    '拖 β 看光钟斜边变长、飞船收缩；拖 ν 看光电截止与势阱 hν=ΔE 共振吸收。',
    'γ=1/√(1−β²) 随 β 发散；hν<W 无光电子，hν≈ΔE 才触发能级跃迁。',
    ['狭义相对论', '光电效应', '无限深势阱', '能级跃迁'], 'modern', 'γ=1/√(1−β²) · K=hν−W'),

  /* ---- 旧版单点流水线模板：保留 ?template= 链接与已保存作品兼容，不再出现在目录 ---- */
  {
    kind: 'projectile-drag', topic: 'p01', name: '理想与阻力抛体', legacy: true,
    desc: '初速、角度与阻力共同驱动轨迹、受力和机械能对照。', tag: '大学物理 · 抛体',
    question: '空气阻力怎样改变射程、顶点与落地速度？机械能减少量去了哪里？',
    steps: '固定初速与角度，先比较理想和阻力轨迹；再只改变阻力系数，记录射程、顶点高度和机械能损耗。',
    observation: '阻力持续反向于速度，使轨迹不再对称并耗散机械能；水平方向也不再保持匀速。',
    keywords: ['抛体', '空气阻力', '轨迹', '机械能损耗'], preview: 'projectile',
  },
  {
    kind: 'incline-friction', topic: 'p01', name: '斜面摩擦临界与能量', legacy: true,
    desc: '跨越 tanα=μ，联动滑动判据、功与摩擦热。', tag: '大学物理 · 斜面',
    question: '物块何时从静摩擦平衡转为加速下滑？重力做功怎样分配给动能与热量？',
    steps: '逐步增大倾角找到临界位置；随后固定倾角改变摩擦因数，比较加速度、底端速度和摩擦热。',
    observation: '未越过临界时静摩擦抵消沿面重力分量；滑动后摩擦力转为动摩擦，部分重力功转化为热。',
    keywords: ['斜面', '静摩擦', '动摩擦', '临界角', '功能关系'], preview: 'incline',
  },
  {
    kind: 'collision-momentum', topic: 'p01', name: '碰撞中的动量与能量', legacy: true,
    desc: '恢复系数扫描碰撞末速、冲量和动能损失。', tag: '大学物理 · 碰撞',
    question: '为什么恢复系数改变时总动量仍守恒，而动能可以保持或损失？',
    steps: '先用等质量和 e=1 验证速度交换，再降低 e；改变两球质量与初速，核对碰撞前后动量、动能和冲量。',
    observation: '孤立系统总动量保持不变；e=1 时动能守恒，e<1 时出现与形变和耗散对应的动能损失。',
    keywords: ['碰撞', '恢复系数', '动量守恒', '冲量', '动能损失'], preview: 'collision',
  },
  {
    kind: 'oscillation-wave', topic: 'p02', name: '振动、共振与机械波', legacy: true,
    desc: '大摆角、受迫响应、相空间和行波/驻波分支对照。', tag: '大学物理 · 振动波动',
    question: '振幅、阻尼和驱动频率怎样决定振动响应？行波与驻波的能量传播有何不同？',
    steps: '先比较大摆角与小角近似，再扫描驱动频率观察共振；进入波动分支改变波长和频率，标记波节与波腹。',
    observation: '大摆角使真实周期偏离小角公式，阻尼压低并展宽共振峰；驻波具有固定波节而不输运净能量。',
    keywords: ['单摆', '共振', '相空间', '行波', '驻波', '频谱'], preview: 'oscillation',
  },
  {
    kind: 'charged-particle', topic: 'p03', name: '带电粒子偏转与磁轨道', legacy: true,
    desc: '速度选择器连接洛伦兹力、圆弧轨道与周期。', tag: '大学物理 · 磁场',
    question: '为什么只有 v=E/B 的粒子能直线通过选择器？进入磁场后半径和周期由什么决定？',
    steps: '调整 E、B 和入射速度观察筛选条件，再改变电荷、质量或磁感应强度，比较轨道半径、受力方向和周期。',
    observation: '速度选择器平衡电场力与磁场力；匀强磁场中的圆周半径 R=mv/(|q|B)，磁力不做功。',
    keywords: ['带电粒子', '速度选择器', '洛伦兹力', '圆周运动'], preview: 'field',
  },
  {
    kind: 'rc-circuit', topic: 'p03', name: 'RC 充放电与能量', legacy: true,
    desc: '时间常数驱动电压、电流、储能和焦耳热曲线。', tag: '大学物理 · 电路',
    question: 'R 与 C 怎样改变暂态快慢？充电过程中电源能量如何分配？',
    steps: '切换充电和放电模式，分别改变 R、C；在时间轴上读取电压、电流，并比较电容储能与电阻焦耳热。',
    observation: '特征时间由 τ=RC 决定；充电时电压趋近电源值而电流衰减，能量在储能与耗散之间分配。',
    keywords: ['RC 电路', '充放电', '时间常数', '电容储能', '焦耳热'], preview: 'circuit',
  },
  {
    kind: 'motional-emf', topic: 'p03', name: '导体棒动生电动势', legacy: true,
    desc: '感应电流、安培阻力、速度衰减与能量闭环。', tag: '大学物理 · 电磁感应',
    question: '导体棒为何因感应电流而减速？初始动能最终转化为什么？',
    steps: '改变初速度、磁场和导轨间距，观察电动势与电流；推进时间轴，核对安培力做功、速度变化和焦耳热。',
    observation: '动生电动势与 BLv 成正比，安培力阻碍运动；无其他耗散时，动能减少量对应回路焦耳热。',
    keywords: ['动生电动势', '感应电流', '安培力', '能量守恒'], preview: 'induction',
  },
  {
    kind: 'double-slit', topic: 'p04', name: '双缝与光栅干涉', legacy: true,
    desc: '真实波长颜色、缝数与光强条纹同步变化。', tag: '大学物理 · 波动光学',
    question: '波长、缝距、屏距和缝数怎样改变条纹位置、间距与主极大宽度？',
    steps: '先只改变波长观察颜色和条纹间距，再改变缝距与屏距；增加缝数，比较主极大锐度和次级结构。',
    observation: '双缝条纹间距与波长和屏距成正比、与缝距成反比；多缝干涉使主极大更窄、更亮。',
    keywords: ['双缝干涉', '光栅', '波长', '光强', '主极大'], preview: 'optics',
  },
  {
    kind: 'refraction-fiber', topic: 'p04', name: '折射、临界角与光纤', legacy: true,
    desc: '斯涅尔定律连接全反射判据和连续反射光路。', tag: '大学物理 · 几何光学',
    question: '为什么折射光会在临界角之后消失？光纤怎样把光约束在内部？',
    steps: '从高折射率一侧逐渐增大入射角，记录折射角；跨过临界角后进入光纤场景，检查每次界面反射。',
    observation: '只有从光密介质射向光疏介质时才存在全反射临界角；超过临界角后能量返回原介质。',
    keywords: ['折射', '斯涅尔定律', '临界角', '全反射', '光纤'], preview: 'optics',
  },
  {
    kind: 'thin-lens', topic: 'p04', name: '薄透镜三条特殊光线', legacy: true,
    desc: '物距跨过 f 与 2f，实时判断实像、虚像和放大率。', tag: '大学物理 · 透镜成像',
    question: '物距跨过焦点和二倍焦距时，像的位置、正倒与大小为何突变或反转？',
    steps: '从远处移动物体跨过 2f 和 f，跟踪三条特殊光线；用像距和放大率公式核对实像、虚像状态。',
    observation: '凸透镜在物距大于 f 时可成实像，物距小于 f 时成正立放大虚像；焦点处没有有限像距。',
    keywords: ['薄透镜', '三条光线', '实像', '虚像', '放大率'], preview: 'optics',
  },
  {
    kind: 'carnot-cycle', topic: 'p05', name: '卡诺循环与热机效率', legacy: true,
    desc: '活塞、P-V 闭合图、热量和做功逐段联动。', tag: '大学物理 · 热学',
    question: '两条等温线和两条绝热线怎样组成闭合循环？效率为什么只由两热源温度决定？',
    steps: '逐段推进等温膨胀、绝热膨胀、等温压缩和绝热压缩，记录每段热量与功；改变 T₁、T₂ 比较效率。',
    observation: '理想卡诺循环净功对应 P-V 闭合面积，效率 η=1−T₂/T₁；提高高温端或降低低温端可提高效率。',
    keywords: ['卡诺循环', 'P-V 图', '等温过程', '绝热过程', '热机效率'], preview: 'thermal',
  },
  {
    kind: 'photoelectric', topic: 'p05', name: '光电效应与遏止电压', legacy: true,
    desc: '频率、光强分别控制初动能、遏止电压和饱和电流。', tag: '大学物理 · 近代物理',
    question: '为什么低于截止频率再增强光强也不能逸出光电子？频率和光强各控制什么测量量？',
    steps: '固定光强扫描频率，观察最大初动能与遏止电压；再固定高于截止的频率改变光强，比较 I-U 曲线和饱和电流。',
    observation: '最大初动能随频率线性增加，截止频率由逸出功决定；高于截止时，光强主要改变光电子数量和饱和电流。',
    keywords: ['光电效应', '截止频率', '逸出功', '遏止电压', '饱和光电流'], preview: 'quantum',
  },
];

/** 目录与活页插件展示的物理模板：只有整章全景沙盘。 */
export const VISIBLE_PHYSICS_TEMPLATES: readonly PhysicsTemplate[] =
  PHYSICS_TEMPLATES.filter((template) => !template.legacy);

export function physicsTemplateDoc(kind: PhysicsTemplateKind): CanvasDoc {
  const template = PHYSICS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知物理模板：${kind}`);
  if (isPhysicsSandboxKind(kind)) return physicsSandboxDoc(kind, template.name);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildPhysicsPipeline(kind, template.name, note);
}
