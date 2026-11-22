import { buildCalculusPipeline } from './calculusPipeline.ts';
import type { CanvasDoc } from './types.ts';

export interface CalculusTopic { id: 'c01' | 'c02' | 'c03' | 'c04'; name: string; lead: string }

export type CalculusTemplateKind =
  | 'limit-epsilon' | 'derivative-triptych' | 'mean-value'
  | 'ftc-sweep' | 'integration-race' | 'taylor-error' | 'fourier-gibbs' | 'ode-methods'
  | 'gradient-direction' | 'lagrange-multiplier' | 'double-green'
  | 'basis-change' | 'eigen-transform' | 'svd-steps';

export interface CalculusTemplate {
  kind: CalculusTemplateKind; topic: CalculusTopic['id']; name: string; desc: string; tag: string;
  level: string; minutes: number; formula: string;
  question: string; steps: string; observation: string;
  keywords: readonly string[];
  preview: 'function' | 'limit' | 'tangent' | 'integral' | 'area' | 'ftc' | 'series' | 'fourier' | 'ode' | 'surface' | 'gradient' | 'double' | 'matrix';
}

export const CALCULUS_TOPICS: readonly CalculusTopic[] = [
  { id: 'c01', name: '专题 01 · 极限、导数与中值定理', lead: '从 ε–δ 管道到竖直对齐的导数三联，再用割线与中值切点连接局部和整体变化率。' },
  { id: 'c02', name: '专题 02 · 数值积分、级数与 ODE', lead: '让积分方法、Taylor 余项、Fourier 频谱和微分方程解法在同一条构造链中比较误差。' },
  { id: 'c03', name: '专题 03 · 多元场论', lead: '从梯度与方向导数走向约束极值、二重积分和 Green 公式，观察几何与场量互相印证。' },
  { id: 'c04', name: '专题 04 · 线代几何', lead: '用基变换、特征方向和 SVD 三步分解解释矩阵怎样旋转、拉伸、压扁与重构空间。' },
];

export const CALCULUS_TEMPLATES: readonly CalculusTemplate[] = [
  {
    kind: 'limit-epsilon', topic: 'c01', name: '极限的 ε–δ 构造',
    desc: '左右趋近样本、δ 管道与间断类型同步显示。', tag: '高数 · 极限', level: '基础', minutes: 8,
    formula: '0 < |x−a| < δ ⇒ |f(x)−L| < ε',
    question: '函数在一点没有定义时，左右样本还能给出同一个极限候选吗？怎样用 ε 找到可用的 δ？',
    steps: '改变 ε 并观察 δ 管道收缩，分别检查左右趋近表；再换成 abs(x)/x，比较双侧与单侧结论。',
    observation: '两侧趋近同一有限值才支持双侧极限候选；数值样本揭示趋势，但不替代严格证明。',
    keywords: ['极限', 'ε–δ', '左右极限', '间断'], preview: 'limit',
  },
  {
    kind: 'derivative-triptych', topic: 'c01', name: '函数与导数三联图',
    desc: 'f、f′、f″ 竖直对齐，标记驻点、极值和拐点。', tag: '高数 · 导数', level: '基础', minutes: 10,
    formula: 'f′(x) = lim(h→0) [f(x+h)−f(x)]/h',
    question: '原函数的增减、切线斜率和弯曲方向怎样由一阶与二阶导数共同刻画？',
    steps: '减小割线步长观察差商趋近导数，再修改函数系数；对照三联图中的零点、极值点和拐点标记。',
    observation: 'f′ 的符号对应原函数增减，f″ 的符号对应凹凸性；尖点处左右导数不一致时不能伪造导数值。',
    keywords: ['导数', '二阶导数', '驻点', '极值', '拐点'], preview: 'tangent',
  },
  {
    kind: 'mean-value', topic: 'c01', name: '拉格朗日中值定理',
    desc: '区间端点、割线斜率与内部切点联动构造。', tag: '高数 · 中值定理', level: '进阶', minutes: 10,
    formula: 'f′(ξ) = [f(b)−f(a)]/(b−a)',
    question: '为什么连续可导函数在区间内部会有一条切线与端点割线平行？',
    steps: '改变区间 [a,b]，比较端点割线和候选切线斜率；更换函数，检查切点数量及定义域条件。',
    observation: '满足定理条件时至少存在一个内部切点使两种斜率相等；数值求根给出证据而非解析证明。',
    keywords: ['中值定理', '割线', '切线', '平均变化率'], preview: 'tangent',
  },
  {
    kind: 'ftc-sweep', topic: 'c02', name: '变上限积分与 FTC',
    desc: '推进积分上限，同步累计面积、F(x) 和斜率验证。', tag: '高数 · 基本定理', level: '进阶', minutes: 10,
    formula: 'F(x) = ∫ₐˣ f(t)dt，F′(x) = f(x)',
    question: '累计面积函数的瞬时增长速度为什么恰好等于当前被积函数值？',
    steps: '固定下限并推进上限 x，观察累计面积和 F(x) 描点；比较局部斜率与 f(x)，再交换上下限检查符号。',
    observation: '小区间上的面积增量约为 f(x)Δx，因此 F′(x)=f(x)；数值微分与积分结果应相互吻合。',
    keywords: ['变上限积分', '微积分基本定理', '累计面积', '原函数'], preview: 'ftc',
  },
  {
    kind: 'integration-race', topic: 'c02', name: '数值积分方法竞赛',
    desc: '左/中点、梯形与 Simpson 对照误差和收敛阶。', tag: '高数 · 数值积分', level: '进阶', minutes: 12,
    formula: '∫ₐᵇ f(x)dx ≈ Σ wᵢf(xᵢ)',
    question: '相同分割数下不同求积方法为何有不同误差？细化网格时误差按什么速度下降？',
    steps: '依次增加分割数 n，比较左端点、中点、梯形和 Simpson 结果；读取相对参考值的误差与收敛阶。',
    observation: '光滑函数上高阶方法通常更快逼近参考积分；误差表需与函数光滑性、区间和舍入误差一起解读。',
    keywords: ['黎曼和', '梯形法', 'Simpson', '误差', '收敛阶'], preview: 'integral',
  },
  {
    kind: 'taylor-error', topic: 'c02', name: 'Taylor 展开与余项',
    desc: '阶数、展开中心和观察点共同驱动局部误差。', tag: '高数 · Taylor', level: '进阶', minutes: 10,
    formula: 'f(x) = Pₙ(x) + Rₙ(x)',
    question: '增加 Taylor 阶数是否在任何位置都能改善近似？展开中心怎样影响有效邻域？',
    steps: '从一阶逐步增加阶数，比较原函数和多项式；移动观察点与展开中心，分别记录局部误差变化。',
    observation: 'Taylor 多项式是局部近似，远离中心时误差可能增大；数值余项不等于级数收敛性证明。',
    keywords: ['Taylor 展开', '多项式', '余项', '局部近似'], preview: 'series',
  },
  {
    kind: 'fourier-gibbs', topic: 'c02', name: 'Fourier 频谱与 Gibbs 现象',
    desc: '谐波叠加、系数频谱和跳变处过冲同步观察。', tag: '高数 · Fourier', level: '进阶', minutes: 12,
    formula: 'S_N(x) = a₀/2 + Σ[aₙcos(nx)+bₙsin(nx)]',
    question: '为什么增加谐波后跳变附近仍保留过冲？不同波形的频谱衰减为何不同？',
    steps: '逐步增加谐波数 N，观察波形和频谱；切换方波、三角波与锯齿波，比较跳变过冲及系数衰减。',
    observation: '更多谐波改善连续区域的逼近，但跳变处出现过冲且不随 N 消失，这就是 Gibbs 现象。',
    keywords: ['Fourier 级数', '谐波', '频谱', 'Gibbs 现象'], preview: 'fourier',
  },
  {
    kind: 'ode-methods', topic: 'c02', name: 'ODE 的 Euler 与 RK4',
    desc: '斜率场、两条积分轨迹与步长误差对照。', tag: '高数 · 微分方程', level: '进阶', minutes: 12,
    formula: 'y′ = f(x,y)，y(x₀)=y₀',
    question: '同样步长下 Euler 与 RK4 的轨迹为何不同？减半步长时误差怎样变化？',
    steps: '在斜率场中预测解的走向，再改变初值和步数；比较 Euler、RK4 与参考解的末端值和误差。',
    observation: '两种方法都沿局部斜率推进，RK4 利用多个中间斜率，通常在相同步长下获得更小误差。',
    keywords: ['ODE', '斜率场', 'Euler', 'RK4', '数值误差'], preview: 'ode',
  },
  {
    kind: 'gradient-direction', topic: 'c03', name: '梯度与方向导数',
    desc: '偏导、梯度箭头和等高线正交关系同屏。', tag: '高数 · 多元微分', level: '进阶', minutes: 10,
    formula: 'Dᵤf = ∇f·u，‖u‖=1',
    question: '为什么梯度指向函数增长最快方向，并且与等高线切线正交？',
    steps: '移动观察点读取偏导和梯度，再转动单位方向 u；比较方向导数最大值、零值与等高线方向。',
    observation: '方向导数在 u 与梯度同向时达到 |∇f|，沿等高线切向时为零；梯度为零处需单独判断。',
    keywords: ['梯度', '方向导数', '偏导', '等高线'], preview: 'gradient',
  },
  {
    kind: 'lagrange-multiplier', topic: 'c03', name: '拉格朗日乘数与约束极值',
    desc: '目标等值线、约束曲线和梯度平行条件联动。', tag: '高数 · 条件极值', level: '进阶', minutes: 12,
    formula: '∇f = λ∇g，g(x,y)=0',
    question: '条件极值点为什么常出现在目标等值线与约束曲线相切的位置？',
    steps: '扫描目标等值线并移动约束上的候选点，比较两梯度方向；改变约束参数，核对 λ 和候选极值。',
    observation: '正则候选点满足 ∇f=λ∇g，几何上表现为等值线与约束相切；候选点仍需进一步判定极值类型。',
    keywords: ['拉格朗日乘数', '约束极值', '等值线', '梯度平行'], preview: 'gradient',
  },
  {
    kind: 'double-green', topic: 'c03', name: '二重积分与 Green 公式',
    desc: '极坐标 bounds、Jacobian、环量与旋度面积分对照。', tag: '高数 · 场论', level: '进阶', minutes: 14,
    formula: '∮∂D Pdx+Qdy = ∬D(∂Q/∂x−∂P/∂y)dA',
    question: '极坐标面积微元为什么必须乘 r？闭合路径环量怎样与旋度的区域积分对应？',
    steps: '修改半径和角度区间，检查实际积分 bounds 与 r 微元；再推进闭合路径，比较环量和旋度面积分。',
    observation: '极坐标下 dA=rdrdθ，遗漏 r 会改变结果；满足条件时 Green 公式给出路径与区域两种等价计算。',
    keywords: ['二重积分', '极坐标', 'Jacobian', 'Green 公式', '环量', '旋度'], preview: 'double',
  },
  {
    kind: 'basis-change', topic: 'c04', name: '基变换与双坐标系',
    desc: '斜基网格、坐标列向量和过渡矩阵同步更新。', tag: '高数 · 线性代数', level: '基础', minutes: 10,
    formula: 'v = Pv′，v′ = P⁻¹v',
    question: '同一个向量为何在不同基下坐标不同，而几何位置保持不变？',
    steps: '拖动斜基或修改基向量矩阵，比较 v 与 v′；用过渡矩阵往返变换，并观察接近奇异时的状态。',
    observation: '基向量组成过渡矩阵 P，坐标按 P⁻¹ 变换；矩阵不可逆时不能形成有效二维基。',
    keywords: ['基变换', '过渡矩阵', '坐标', '逆矩阵'], preview: 'matrix',
  },
  {
    kind: 'eigen-transform', topic: 'c04', name: '特征向量与矩阵变换',
    desc: '网格变形、行列式面积倍率和实特征方向对照。', tag: '高数 · 特征值', level: '进阶', minutes: 12,
    formula: 'Av = λv，det(A−λI)=0',
    question: '哪些方向在线性变换后仍保持共线？行列式为零时空间为何塌缩？',
    steps: '修改 2×2 矩阵观察网格和单位正方形，读取实特征值与方向；调节到 det=0，检查像的维数。',
    observation: '实特征向量满足 Av=λv，只发生伸缩或反向；|detA| 是面积倍率，detA=0 对应奇异变换。',
    keywords: ['特征值', '特征向量', '行列式', '线性变换'], preview: 'matrix',
  },
  {
    kind: 'svd-steps', topic: 'c04', name: 'SVD 三步与低秩重构',
    desc: 'Vᵀ、Σ、U 逐步作用于单位圆并输出可复算矩阵。', tag: '高数 · 奇异值分解', level: '进阶', minutes: 14,
    formula: 'A = UΣVᵀ，Aᵣ = Σᵢ₌₁ʳ σᵢuᵢvᵢᵀ',
    question: '任意实矩阵怎样分解成旋转、拉伸和再旋转？舍弃小奇异值后重构改变了什么？',
    steps: '依次选择 Vᵀ、Σ、U 观察单位圆变形，读取奇异值与秩；切换低秩重构并比较原矩阵和误差。',
    observation: 'SVD 将线性变换分解为正交变换与轴向缩放；低秩近似舍弃较小奇异方向并降低表示秩。',
    keywords: ['SVD', '奇异值', '正交矩阵', '低秩重构'], preview: 'matrix',
  },
];

export function calculusTemplateDoc(kind: string): CanvasDoc {
  const template = CALCULUS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知高数模板：${kind}`);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildCalculusPipeline(kind, template.name, note);
}