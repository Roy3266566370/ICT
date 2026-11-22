import { buildPhysicsPipeline } from './physicsPipeline.ts';
import type { CanvasDoc } from './types.ts';

export type PhysicsTemplateKind =
  | 'projectile-drag' | 'incline-friction' | 'collision-momentum' | 'oscillation-wave'
  | 'charged-particle' | 'rc-circuit' | 'motional-emf'
  | 'double-slit' | 'refraction-fiber' | 'thin-lens'
  | 'carnot-cycle' | 'photoelectric';

export interface PhysicsTemplate {
  kind: PhysicsTemplateKind;
  topic: 'p01' | 'p02' | 'p03' | 'p04';
  name: string; desc: string; tag: string;
  question: string; steps: string; observation: string;
  keywords: readonly string[];
  preview: 'projectile' | 'incline' | 'collision' | 'oscillation' | 'field' | 'circuit' | 'induction' | 'optics' | 'thermal' | 'quantum';
}

export const PHYSICS_TOPICS: readonly { id: PhysicsTemplate['topic']; name: string; lead: string }[] = [
  { id: 'p01', name: '专题 01 · 运动、受力与守恒', lead: '从阻力弹道、摩擦临界到碰撞与振动波动，沿同一条数据管线核对运动图像、受力和守恒量。' },
  { id: 'p02', name: '专题 02 · 电磁与电路', lead: '连接场、电路与能量：观察带电粒子偏转、RC 暂态和导体棒电磁感应的连续变化。' },
  { id: 'p03', name: '专题 03 · 光学', lead: '用真实波长、折射定律和透镜公式生成条纹与光路，比较波动光学和几何光学。' },
  { id: 'p04', name: '专题 04 · 热学与近代物理', lead: '推进卡诺循环并扫描入射光频率，把热机效率、光子能量和宏观测量放在同一工作台。' },
];

export const PHYSICS_TEMPLATES: readonly PhysicsTemplate[] = [
  {
    kind: 'projectile-drag', topic: 'p01', name: '理想与阻力抛体',
    desc: '初速、角度与阻力共同驱动轨迹、受力和机械能对照。', tag: '大学物理 · 抛体',
    question: '空气阻力怎样改变射程、顶点与落地速度？机械能减少量去了哪里？',
    steps: '固定初速与角度，先比较理想和阻力轨迹；再只改变阻力系数，记录射程、顶点高度和机械能损耗。',
    observation: '阻力持续反向于速度，使轨迹不再对称并耗散机械能；水平方向也不再保持匀速。',
    keywords: ['抛体', '空气阻力', '轨迹', '机械能损耗'], preview: 'projectile',
  },
  {
    kind: 'incline-friction', topic: 'p01', name: '斜面摩擦临界与能量',
    desc: '跨越 tanα=μ，联动滑动判据、功与摩擦热。', tag: '大学物理 · 斜面',
    question: '物块何时从静摩擦平衡转为加速下滑？重力做功怎样分配给动能与热量？',
    steps: '逐步增大倾角找到临界位置；随后固定倾角改变摩擦因数，比较加速度、底端速度和摩擦热。',
    observation: '未越过临界时静摩擦抵消沿面重力分量；滑动后摩擦力转为动摩擦，部分重力功转化为热。',
    keywords: ['斜面', '静摩擦', '动摩擦', '临界角', '功能关系'], preview: 'incline',
  },
  {
    kind: 'collision-momentum', topic: 'p01', name: '碰撞中的动量与能量',
    desc: '恢复系数扫描碰撞末速、冲量和动能损失。', tag: '大学物理 · 碰撞',
    question: '为什么恢复系数改变时总动量仍守恒，而动能可以保持或损失？',
    steps: '先用等质量和 e=1 验证速度交换，再降低 e；改变两球质量与初速，核对碰撞前后动量、动能和冲量。',
    observation: '孤立系统总动量保持不变；e=1 时动能守恒，e<1 时出现与形变和耗散对应的动能损失。',
    keywords: ['碰撞', '恢复系数', '动量守恒', '冲量', '动能损失'], preview: 'collision',
  },
  {
    kind: 'oscillation-wave', topic: 'p01', name: '振动、共振与机械波',
    desc: '大摆角、受迫响应、相空间和行波/驻波分支对照。', tag: '大学物理 · 振动波动',
    question: '振幅、阻尼和驱动频率怎样决定振动响应？行波与驻波的能量传播有何不同？',
    steps: '先比较大摆角与小角近似，再扫描驱动频率观察共振；进入波动分支改变波长和频率，标记波节与波腹。',
    observation: '大摆角使真实周期偏离小角公式，阻尼压低并展宽共振峰；驻波具有固定波节而不输运净能量。',
    keywords: ['单摆', '共振', '相空间', '行波', '驻波', '频谱'], preview: 'oscillation',
  },
  {
    kind: 'charged-particle', topic: 'p02', name: '带电粒子偏转与磁轨道',
    desc: '速度选择器连接洛伦兹力、圆弧轨道与周期。', tag: '大学物理 · 磁场',
    question: '为什么只有 v=E/B 的粒子能直线通过选择器？进入磁场后半径和周期由什么决定？',
    steps: '调整 E、B 和入射速度观察筛选条件，再改变电荷、质量或磁感应强度，比较轨道半径、受力方向和周期。',
    observation: '速度选择器平衡电场力与磁场力；匀强磁场中的圆周半径 R=mv/(|q|B)，磁力不做功。',
    keywords: ['带电粒子', '速度选择器', '洛伦兹力', '圆周运动'], preview: 'field',
  },
  {
    kind: 'rc-circuit', topic: 'p02', name: 'RC 充放电与能量',
    desc: '时间常数驱动电压、电流、储能和焦耳热曲线。', tag: '大学物理 · 电路',
    question: 'R 与 C 怎样改变暂态快慢？充电过程中电源能量如何分配？',
    steps: '切换充电和放电模式，分别改变 R、C；在时间轴上读取电压、电流，并比较电容储能与电阻焦耳热。',
    observation: '特征时间由 τ=RC 决定；充电时电压趋近电源值而电流衰减，能量在储能与耗散之间分配。',
    keywords: ['RC 电路', '充放电', '时间常数', '电容储能', '焦耳热'], preview: 'circuit',
  },
  {
    kind: 'motional-emf', topic: 'p02', name: '导体棒动生电动势',
    desc: '感应电流、安培阻力、速度衰减与能量闭环。', tag: '大学物理 · 电磁感应',
    question: '导体棒为何因感应电流而减速？初始动能最终转化为什么？',
    steps: '改变初速度、磁场和导轨间距，观察电动势与电流；推进时间轴，核对安培力做功、速度变化和焦耳热。',
    observation: '动生电动势与 BLv 成正比，安培力阻碍运动；无其他耗散时，动能减少量对应回路焦耳热。',
    keywords: ['动生电动势', '感应电流', '安培力', '能量守恒'], preview: 'induction',
  },
  {
    kind: 'double-slit', topic: 'p03', name: '双缝与光栅干涉',
    desc: '真实波长颜色、缝数与光强条纹同步变化。', tag: '大学物理 · 波动光学',
    question: '波长、缝距、屏距和缝数怎样改变条纹位置、间距与主极大宽度？',
    steps: '先只改变波长观察颜色和条纹间距，再改变缝距与屏距；增加缝数，比较主极大锐度和次级结构。',
    observation: '双缝条纹间距与波长和屏距成正比、与缝距成反比；多缝干涉使主极大更窄、更亮。',
    keywords: ['双缝干涉', '光栅', '波长', '光强', '主极大'], preview: 'optics',
  },
  {
    kind: 'refraction-fiber', topic: 'p03', name: '折射、临界角与光纤',
    desc: '斯涅尔定律连接全反射判据和连续反射光路。', tag: '大学物理 · 几何光学',
    question: '为什么折射光会在临界角之后消失？光纤怎样把光约束在内部？',
    steps: '从高折射率一侧逐渐增大入射角，记录折射角；跨过临界角后进入光纤场景，检查每次界面反射。',
    observation: '只有从光密介质射向光疏介质时才存在全反射临界角；超过临界角后能量返回原介质。',
    keywords: ['折射', '斯涅尔定律', '临界角', '全反射', '光纤'], preview: 'optics',
  },
  {
    kind: 'thin-lens', topic: 'p03', name: '薄透镜三条特殊光线',
    desc: '物距跨过 f 与 2f，实时判断实像、虚像和放大率。', tag: '大学物理 · 透镜成像',
    question: '物距跨过焦点和二倍焦距时，像的位置、正倒与大小为何突变或反转？',
    steps: '从远处移动物体跨过 2f 和 f，跟踪三条特殊光线；用像距和放大率公式核对实像、虚像状态。',
    observation: '凸透镜在物距大于 f 时可成实像，物距小于 f 时成正立放大虚像；焦点处没有有限像距。',
    keywords: ['薄透镜', '三条光线', '实像', '虚像', '放大率'], preview: 'optics',
  },
  {
    kind: 'carnot-cycle', topic: 'p04', name: '卡诺循环与热机效率',
    desc: '活塞、P-V 闭合图、热量和做功逐段联动。', tag: '大学物理 · 热学',
    question: '两条等温线和两条绝热线怎样组成闭合循环？效率为什么只由两热源温度决定？',
    steps: '逐段推进等温膨胀、绝热膨胀、等温压缩和绝热压缩，记录每段热量与功；改变 T₁、T₂ 比较效率。',
    observation: '理想卡诺循环净功对应 P-V 闭合面积，效率 η=1−T₂/T₁；提高高温端或降低低温端可提高效率。',
    keywords: ['卡诺循环', 'P-V 图', '等温过程', '绝热过程', '热机效率'], preview: 'thermal',
  },
  {
    kind: 'photoelectric', topic: 'p04', name: '光电效应与遏止电压',
    desc: '频率、光强分别控制初动能、遏止电压和饱和电流。', tag: '大学物理 · 近代物理',
    question: '为什么低于截止频率再增强光强也不能逸出光电子？频率和光强各控制什么测量量？',
    steps: '固定光强扫描频率，观察最大初动能与遏止电压；再固定高于截止的频率改变光强，比较 I-U 曲线和饱和电流。',
    observation: '最大初动能随频率线性增加，截止频率由逸出功决定；高于截止时，光强主要改变光电子数量和饱和电流。',
    keywords: ['光电效应', '截止频率', '逸出功', '遏止电压', '饱和光电流'], preview: 'quantum',
  },
];

export function physicsTemplateDoc(kind: PhysicsTemplateKind): CanvasDoc {
  const template = PHYSICS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知物理模板：${kind}`);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildPhysicsPipeline(kind, template.name, note);
}