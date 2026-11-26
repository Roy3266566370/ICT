import { buildCalculusPipeline } from './calculusPipeline.ts';
import { calculusSandboxDoc, isCalculusSandboxKind, type CalculusSandboxKind } from './calculusSandboxes.ts';
import type { CanvasDoc } from './types.ts';

export interface CalculusTopic { id: 'c01' | 'c02' | 'c03' | 'c04' | 'c05'; name: string; lead: string }

export type CalculusTemplateKind =
  | CalculusSandboxKind | 'limit-epsilon' | 'derivative-triptych' | 'mean-value'
  | 'ftc-sweep' | 'integration-race' | 'taylor-error' | 'fourier-gibbs' | 'ode-methods'
  | 'gradient-direction' | 'lagrange-multiplier' | 'double-green'
  | 'basis-change' | 'eigen-transform' | 'svd-steps';

export interface CalculusTemplate {
  kind: CalculusTemplateKind; topic: CalculusTopic['id']; name: string; desc: string; tag: string;
  level: string; minutes: number; formula: string;
  question: string; steps: string; observation: string;
  keywords: readonly string[];
  panorama?: true;
  /** 已被整章全景沙盘覆盖的旧单点模板：目录中隐藏，但保留 URL / 历史活页兼容 */
  legacy?: true;
  preview: 'function' | 'limit' | 'tangent' | 'integral' | 'area' | 'ftc' | 'series' | 'fourier' | 'ode' | 'surface' | 'gradient' | 'double' | 'matrix';
}

export const CALCULUS_TOPICS: readonly CalculusTopic[] = [
  { id: 'c01', name: '专题 01 · 一元微分学', lead: '围绕局部变化与逼近：极限、导数、中值定理、曲率圆与 Taylor 展开。' },
  { id: 'c02', name: '专题 02 · 一元积分学', lead: '围绕累加、反演与应用：数值求积、微积分基本定理与几何工程应用。' },
  { id: 'c03', name: '专题 03 · 微分方程与无穷级数', lead: '围绕动态演化与无穷逼近：斜率场、特征根解族、级数敛散与傅里叶分析。' },
  { id: 'c04', name: '专题 04 · 空间几何与多元场论', lead: '围绕高维几何与向量场：二次曲面、梯度优化、重积分与 Green 公式。' },
];

export const CALCULUS_TEMPLATES: readonly CalculusTemplate[] = [
  {
    kind: 'ch01-limits', topic: 'c01', name: '第 1 章 · 函数与极限', panorama: true,
    desc: '收紧 ε–δ 邻域，比较间断类型、无穷小阶数和二分夹逼。', tag: '高数 · 一元微分', level: '基础', minutes: 14,
    formula: '0 < |x| < δ ⇒ |f(x)−L| < ε',
    question: '原点上没有函数值，为什么两侧仍可能趋于同一个数？',
    steps: '减小 ε 并观察 δ，切换可去、跳跃和振荡示例，再回放二分夹逼。',
    observation: '左右极限需一致才有双侧极限。样本管道和夹逼结果提供数值证据。',
    keywords: ['极限', '间断', '无穷小', 'ε–δ', '二分法'], preview: 'limit',
  },
  {
    kind: 'ch02-derivatives', topic: 'c01', name: '第 2 章 · 导数与微分', panorama: true,
    desc: '共享增量 h，联动割线、复合函数的局部倍率和微分余差。', tag: '高数 · 一元微分', level: '基础', minutes: 14,
    formula: '(f∘g)′ = (f′∘g)g′，dy = f′(0)h',
    question: '输入增量减半时，差商和线性近似的余差会怎样变化？',
    steps: '拖小 h，让割线靠近切线，再比较链式法则的倍率和微分余差。',
    observation: '二次示例中 h 减半使余差缩为四分之一。尖点处可以比较增量，导数可能不存在。',
    keywords: ['差商', '切线', '链式法则', '微分', '线性近似'], preview: 'tangent',
  },
  {
    kind: 'ch03-derivatives-app', topic: 'c01', name: '第 3 章 · 导数应用与局部近似', panorama: true,
    desc: '一个函数联动切线、曲率圆、极值与泰勒误差热图。', tag: '高数 · 一元微分', level: '进阶', minutes: 15,
    formula: 'κ = f″/(1 + f′²)³⁄²',
    question: '同一个点的曲率和泰勒近似误差如何随函数变化？',
    steps: '拖动观察点，再选择尖点或高频波形，比较切线、曲率圆和误差热图。',
    observation: '曲率和泰勒展开依赖局部导数。通过数值候选比较中值切线和区间割线。',
    keywords: ['中值定理', '曲率圆', '驻点', '拐点', 'Taylor 残差'], preview: 'tangent',
  },
  {
    kind: 'ch04-integrals', topic: 'c02', name: '第 4–5 章 · 积分与微积分基本定理', panorama: true,
    desc: '对照黎曼和与变上限积分，比较求积误差和 p=1 的收敛临界。', tag: '高数 · 一元积分', level: '进阶', minutes: 16,
    formula: 'F′(x)=f(x)，∫₁^∞ x⁻ᵖ dx 在 p>1 时收敛',
    question: '更细的分割会怎样降低误差？逐渐拉长积分上限时面积一定会暴涨吗？',
    steps: '拖 n 观察黎曼和与求积误差，调 FTC 上限读累计面积，再拖 p 穿过 1。',
    observation: '有限区间的参考积分来自细网格；反常积分的收敛由无穷上限的解析公式判定。',
    keywords: ['黎曼和', 'FTC', '原函数', '梯形', 'Simpson', '反常积分'], preview: 'integral',
  },
  {
    kind: 'ch06-integral-apps', topic: 'c02', name: '第 6 章 · 定积分应用', panorama: true,
    desc: '共用轮廓与切片数，计算旋转体体积、坝面静水合力和抽水做功。', tag: '高数 · 一元积分', level: '进阶', minutes: 15,
    formula: 'V = π∫ f² dx，F = ∫ p(d)b(d) dd',
    question: '同一条轮廓线，怎样同时决定旋转体体积和坝面的静水合力？',
    steps: '增加切片数看轮廓变细，切换等宽、线性和弧形轮廓，再改变水深和抽水出口高度。',
    observation: '旋转体累加的是圆盘面积，坝面合力还要乘各深度的压强，抽水功还随提升距离变化。',
    keywords: ['定积分应用', '旋转体', '圆盘法', '静水压强', '水坝', '变力做功'], preview: 'area',
  },
  {
    kind: 'ch07-ode-dynamics', topic: 'c03', name: '第 7 章 · 微分方程解族与数值解法', panorama: true,
    desc: '调特征系数看二阶方程解形态与相轨，调步长对比斜率场及三种求解器。', tag: '高数 · 微分方程', level: '进阶', minutes: 15,
    formula: 'y″ + 2ζy′ + y = F cos(ωt)',
    question: '特征方程判别式如何决定解曲线形态？大步长时数值解法为何发散？',
    steps: '切换复根衰减、重实根临界与同频非齐次放大，再加大步长比较 Euler、中点法和 RK4。',
    observation: '复特征根产生衰减振荡，重实根最快回稳；对 y′=−3y，大步长可能使 Euler 跳出稳定区。',
    keywords: ['ODE', '微分方程', '特征根', '斜率场', 'Euler', 'RK4'], preview: 'ode',
  },
  {
    kind: 'ch08-space-geometry', topic: 'c04', name: '第 8 章 · 向量与空间几何', panorama: true,
    desc: '拖动截平面观察二次曲面截痕翻转，同时对照高度热图和向量投影。', tag: '高数 · 空间几何', level: '进阶', minutes: 15,
    formula: 'a·b = ‖b‖·comp_b(a)，S = ‖a×b‖',
    question: '为什么截平面穿过马鞍面原点时，双曲线开口会旋转 90°？',
    steps: '把 c 从正值调到负值，比较 xy、xz、yz 截痕和热图，再检查点积为零时的投影和面积。',
    observation: '马鞍面的水平截痕由 x²−y²=c 决定；点积控制有向投影，叉积模给出空间平行四边形面积。',
    keywords: ['向量', '点积', '叉积', '二次曲面', '抛物面', '马鞍面', '截痕'], preview: 'surface',
  },
  {
    kind: 'ch09-multivar-opt', topic: 'c04', name: '第 9 章 · 多元微分与梯度寻谷', panorama: true,
    desc: '一张地形同时驱动等高线、约束相切和梯度下降。', tag: '高数 · 多元微积分', level: '进阶', minutes: 15,
    formula: '∇f = λ∇g，pₖ₊₁ = pₖ − η∇f(pₖ)',
    question: '梯度箭头、约束圆的法向和寻谷方向各指向哪里？',
    steps: '改变地形和学习率，播放目标值曲线，再把小球放到鞍点比较结果。',
    observation: '正则约束极值处两梯度平行。学习率过大可能让迭代越出视野。',
    keywords: ['拉格朗日乘数', '方向导数', '梯度下降', '鞍点', '等高线'], preview: 'gradient',
  },
  {
    kind: 'ch10-multiple-int', topic: 'c04', name: '第 10 章 · 重积分与质心', panorama: true,
    desc: '共用单位圆盘密度，比较极坐标面积权重、质量积分与质心移动。', tag: '高数 · 重积分', level: '进阶', minutes: 15,
    formula: 'dA = r dr dθ，x̄ = ∬xρ dA / ∬ρ dA',
    question: '给薄板的一侧增加密度、另一侧减少密度，总质量和质心分别怎样变化？',
    steps: '让 a 从正变负，再切换均匀与竖直偏置，比较热图、质心与漏乘 r 的积分。',
    observation: '靠外的角向微元更宽，Jacobian r 正是面积放大率。非负密度的质心随一阶矩变化。',
    keywords: ['二重积分', '质心', '薄板', '极坐标', 'Jacobian', '密度'], preview: 'double',
  },
  {
    kind: 'ch11-vector-calc', topic: 'c04', name: '第 11 章 · 曲线曲面积分与场论', panorama: true,
    desc: '用同一向量场核对闭合做功、外向通量、旋度与散度。', tag: '高数 · 场论', level: '进阶', minutes: 17,
    formula: '∮(P dx+Q dy)=∬(∂ₓQ−∂ᵧP) dA',
    question: '为何绕势场一圈不做净功，而涡流的净功会随面积增大？',
    steps: '切换势场与涡流并拖动 R，再比较环量、通量及不同积分域上的结果。',
    observation: '逆时针环量对应旋度面积分。把平面场沿高度延拓，可用单位高圆柱观察曲面通量。',
    keywords: ['格林公式', '散度定理', '曲线积分', '曲面积分', '环量', '通量', '旋度', '向量场'], preview: 'surface',
  },
  {
    kind: 'ch12-series-fourier', topic: 'c03', name: '第 12 章 · 级数收敛与傅里叶降噪', panorama: true,
    desc: '共享项数滑杆，比较部分和、谐波过冲和信号重建。', tag: '高数 · 无穷级数', level: '进阶', minutes: 15,
    formula: 'Σxᵏ（|x| < 1），SNR = 10 log₁₀(Pₛ/Pₑ)',
    question: '增加级数项数或保留频率，会改善哪些结果？',
    steps: '把幂级数参数拉出收敛半径，切换噪声预设，再用同一滑杆查看谐波过冲和信噪比。',
    observation: '越过收敛半径后幂级数发散。过度截断会滤去部分有效信号。',
    keywords: ['傅里叶', 'Fourier', '幂级数', 'Gibbs', '谐波', '频谱', '信噪比'], preview: 'fourier',
  },
  {
    kind: 'limit-epsilon', topic: 'c01', name: '极限的 ε–δ 构造', legacy: true,
    desc: '左右趋近样本、δ 管道与间断类型同步显示。', tag: '高数 · 极限', level: '基础', minutes: 8,
    formula: '0 < |x−a| < δ ⇒ |f(x)−L| < ε',
    question: '函数在一点没有定义时，左右样本还能给出同一个极限候选吗？怎样用 ε 找到可用的 δ？',
    steps: '改变 ε 并观察 δ 管道收缩，分别检查左右趋近表；再换成 abs(x)/x，比较双侧与单侧结论。',
    observation: '两侧趋近同一有限值才支持双侧极限候选；数值样本揭示趋势，但不替代严格证明。',
    keywords: ['极限', 'ε–δ', '左右极限', '间断'], preview: 'limit',
  },
  {
    kind: 'derivative-triptych', topic: 'c01', name: '函数与导数三联图', legacy: true,
    desc: 'f、f′、f″ 竖直对齐，标记驻点、极值和拐点。', tag: '高数 · 导数', level: '基础', minutes: 10,
    formula: 'f′(x) = lim(h→0) [f(x+h)−f(x)]/h',
    question: '原函数的增减、切线斜率和弯曲方向怎样由一阶与二阶导数共同刻画？',
    steps: '减小割线步长观察差商趋近导数，再修改函数系数；对照三联图中的零点、极值点和拐点标记。',
    observation: 'f′ 的符号对应原函数增减，f″ 的符号对应凹凸性；尖点处左右导数不一致时不能伪造导数值。',
    keywords: ['导数', '二阶导数', '驻点', '极值', '拐点'], preview: 'tangent',
  },
  {
    kind: 'mean-value', topic: 'c01', name: '拉格朗日中值定理', legacy: true,
    desc: '区间端点、割线斜率与内部切点联动构造。', tag: '高数 · 中值定理', level: '进阶', minutes: 10,
    formula: 'f′(ξ) = [f(b)−f(a)]/(b−a)',
    question: '为什么连续可导函数在区间内部会有一条切线与端点割线平行？',
    steps: '改变区间 [a,b]，比较端点割线和候选切线斜率；更换函数，检查切点数量及定义域条件。',
    observation: '满足定理条件时至少存在一个内部切点使两种斜率相等；数值求根给出证据而非解析证明。',
    keywords: ['中值定理', '割线', '切线', '平均变化率'], preview: 'tangent',
  },
  {
    kind: 'ftc-sweep', topic: 'c02', name: '变上限积分与 FTC', legacy: true,
    desc: '推进积分上限，同步累计面积、F(x) 和斜率验证。', tag: '高数 · 基本定理', level: '进阶', minutes: 10,
    formula: 'F(x) = ∫ₐˣ f(t)dt，F′(x) = f(x)',
    question: '累计面积函数的瞬时增长速度为什么恰好等于当前被积函数值？',
    steps: '固定下限并推进上限 x，观察累计面积和 F(x) 描点；比较局部斜率与 f(x)，再交换上下限检查符号。',
    observation: '小区间上的面积增量约为 f(x)Δx，因此 F′(x)=f(x)；数值微分与积分结果应相互吻合。',
    keywords: ['变上限积分', '微积分基本定理', '累计面积', '原函数'], preview: 'ftc',
  },
  {
    kind: 'integration-race', topic: 'c02', name: '数值积分方法竞赛', legacy: true,
    desc: '左/中点、梯形与 Simpson 对照误差和收敛阶。', tag: '高数 · 数值积分', level: '进阶', minutes: 12,
    formula: '∫ₐᵇ f(x)dx ≈ Σ wᵢf(xᵢ)',
    question: '相同分割数下不同求积方法为何有不同误差？细化网格时误差按什么速度下降？',
    steps: '依次增加分割数 n，比较左端点、中点、梯形和 Simpson 结果；读取相对参考值的误差与收敛阶。',
    observation: '光滑函数上高阶方法通常更快逼近参考积分；误差表需与函数光滑性、区间和舍入误差一起解读。',
    keywords: ['黎曼和', '梯形法', 'Simpson', '误差', '收敛阶'], preview: 'integral',
  },
  {
    kind: 'taylor-error', topic: 'c01', name: 'Taylor 展开与余项', legacy: true,
    desc: '阶数、展开中心和观察点共同驱动局部误差。', tag: '高数 · Taylor', level: '进阶', minutes: 10,
    formula: 'f(x) = Pₙ(x) + Rₙ(x)',
    question: '增加 Taylor 阶数是否在任何位置都能改善近似？展开中心怎样影响有效邻域？',
    steps: '从一阶逐步增加阶数，比较原函数和多项式；移动观察点与展开中心，分别记录局部误差变化。',
    observation: 'Taylor 多项式是局部近似，远离中心时误差可能增大；数值余项不等于级数收敛性证明。',
    keywords: ['Taylor 展开', '多项式', '余项', '局部近似'], preview: 'series',
  },
  {
    kind: 'fourier-gibbs', topic: 'c03', name: 'Fourier 频谱与 Gibbs 现象', legacy: true,
    desc: '谐波叠加、系数频谱和跳变处过冲同步观察。', tag: '高数 · Fourier', level: '进阶', minutes: 12,
    formula: 'S_N(x) = a₀/2 + Σ[aₙcos(nx)+bₙsin(nx)]',
    question: '为什么增加谐波后跳变附近仍保留过冲？不同波形的频谱衰减为何不同？',
    steps: '逐步增加谐波数 N，观察波形和频谱；切换方波、三角波与锯齿波，比较跳变过冲及系数衰减。',
    observation: '更多谐波改善连续区域的逼近，但跳变处出现过冲且不随 N 消失，这就是 Gibbs 现象。',
    keywords: ['Fourier 级数', '谐波', '频谱', 'Gibbs 现象'], preview: 'fourier',
  },
  {
    kind: 'ode-methods', topic: 'c03', name: 'ODE 的 Euler 与 RK4', legacy: true,
    desc: '斜率场、两条积分轨迹与步长误差对照。', tag: '高数 · 微分方程', level: '进阶', minutes: 12,
    formula: 'y′ = f(x,y)，y(x₀)=y₀',
    question: '同样步长下 Euler 与 RK4 的轨迹为何不同？减半步长时误差怎样变化？',
    steps: '在斜率场中预测解的走向，再改变初值和步数；比较 Euler、RK4 与参考解的末端值和误差。',
    observation: '两种方法都沿局部斜率推进，RK4 利用多个中间斜率，通常在相同步长下获得更小误差。',
    keywords: ['ODE', '斜率场', 'Euler', 'RK4', '数值误差'], preview: 'ode',
  },
  {
    kind: 'gradient-direction', topic: 'c04', name: '梯度与方向导数', legacy: true,
    desc: '偏导、梯度箭头和等高线正交关系同屏。', tag: '高数 · 多元微分', level: '进阶', minutes: 10,
    formula: 'Dᵤf = ∇f·u，‖u‖=1',
    question: '为什么梯度指向函数增长最快方向，并且与等高线切线正交？',
    steps: '移动观察点读取偏导和梯度，再转动单位方向 u；比较方向导数最大值、零值与等高线方向。',
    observation: '方向导数在 u 与梯度同向时达到 |∇f|，沿等高线切向时为零；梯度为零处需单独判断。',
    keywords: ['梯度', '方向导数', '偏导', '等高线'], preview: 'gradient',
  },
  {
    kind: 'lagrange-multiplier', topic: 'c04', name: '拉格朗日乘数与约束极值', legacy: true,
    desc: '目标等值线、约束曲线和梯度平行条件联动。', tag: '高数 · 条件极值', level: '进阶', minutes: 12,
    formula: '∇f = λ∇g，g(x,y)=0',
    question: '条件极值点为什么常出现在目标等值线与约束曲线相切的位置？',
    steps: '扫描目标等值线并移动约束上的候选点，比较两梯度方向；改变约束参数，核对 λ 和候选极值。',
    observation: '正则候选点满足 ∇f=λ∇g，几何上表现为等值线与约束相切；候选点仍需进一步判定极值类型。',
    keywords: ['拉格朗日乘数', '约束极值', '等值线', '梯度平行'], preview: 'gradient',
  },
  {
    kind: 'double-green', topic: 'c04', name: '二重积分与 Green 公式', legacy: true,
    desc: '极坐标 bounds、Jacobian、环量与旋度面积分对照。', tag: '高数 · 场论', level: '进阶', minutes: 14,
    formula: '∮∂D Pdx+Qdy = ∬D(∂Q/∂x−∂P/∂y)dA',
    question: '极坐标面积微元为什么必须乘 r？闭合路径环量怎样与旋度的区域积分对应？',
    steps: '修改半径和角度区间，检查实际积分 bounds 与 r 微元；再推进闭合路径，比较环量和旋度面积分。',
    observation: '极坐标下 dA=rdrdθ，遗漏 r 会改变结果；满足条件时 Green 公式给出路径与区域两种等价计算。',
    keywords: ['二重积分', '极坐标', 'Jacobian', 'Green 公式', '环量', '旋度'], preview: 'double',
  },
  {
    kind: 'basis-change', topic: 'c05', name: '基变换与双坐标系', legacy: true,
    desc: '斜基网格、坐标列向量和过渡矩阵同步更新。', tag: '高数 · 线性代数', level: '基础', minutes: 10,
    formula: 'v = Pv′，v′ = P⁻¹v',
    question: '同一个向量为何在不同基下坐标不同，而几何位置保持不变？',
    steps: '拖动斜基或修改基向量矩阵，比较 v 与 v′；用过渡矩阵往返变换，并观察接近奇异时的状态。',
    observation: '基向量组成过渡矩阵 P，坐标按 P⁻¹ 变换；矩阵不可逆时不能形成有效二维基。',
    keywords: ['基变换', '过渡矩阵', '坐标', '逆矩阵'], preview: 'matrix',
  },
  {
    kind: 'eigen-transform', topic: 'c05', name: '特征向量与矩阵变换', legacy: true,
    desc: '网格变形、行列式面积倍率和实特征方向对照。', tag: '高数 · 特征值', level: '进阶', minutes: 12,
    formula: 'Av = λv，det(A−λI)=0',
    question: '哪些方向在线性变换后仍保持共线？行列式为零时空间为何塌缩？',
    steps: '修改 2×2 矩阵观察网格和单位正方形，读取实特征值与方向；调节到 det=0，检查像的维数。',
    observation: '实特征向量满足 Av=λv，只发生伸缩或反向；|detA| 是面积倍率，detA=0 对应奇异变换。',
    keywords: ['特征值', '特征向量', '行列式', '线性变换'], preview: 'matrix',
  },
  {
    kind: 'svd-steps', topic: 'c05', name: 'SVD 三步与低秩重构', legacy: true,
    desc: 'Vᵀ、Σ、U 逐步作用于单位圆并输出可复算矩阵。', tag: '高数 · 奇异值分解', level: '进阶', minutes: 14,
    formula: 'A = UΣVᵀ，Aᵣ = Σᵢ₌₁ʳ σᵢuᵢvᵢᵀ',
    question: '任意实矩阵怎样分解成旋转、拉伸和再旋转？舍弃小奇异值后重构改变了什么？',
    steps: '依次选择 Vᵀ、Σ、U 观察单位圆变形，读取奇异值与秩；切换低秩重构并比较原矩阵和误差。',
    observation: 'SVD 将线性变换分解为正交变换与轴向缩放；低秩近似舍弃较小奇异方向并降低表示秩。',
    keywords: ['SVD', '奇异值', '正交矩阵', '低秩重构'], preview: 'matrix',
  },
];

/** 定象坊目录与活页插件目录展示的高数模板（11 个整章全景沙盘 + 3 个线代专题） */
export const VISIBLE_CALCULUS_TEMPLATES: readonly CalculusTemplate[] = CALCULUS_TEMPLATES.filter((item) => !item.legacy);

export function calculusTemplateDoc(kind: string): CanvasDoc {
  const template = CALCULUS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知高数模板：${kind}`);
  if (isCalculusSandboxKind(kind)) return calculusSandboxDoc(kind, template.name);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildCalculusPipeline(kind, template.name, note);
}
