import { nextId } from './math.ts';
import type { CanvasDoc, CanvasNode, NodeType } from './types.ts';

export const CALCULUS_TEMPLATES = [
  { kind: 'function-graph', name: '函数变换与图像', desc: '调节 a、b、c，观察开口、平移与函数值。', tag: '高数 · 函数', level: '入门', minutes: 5, formula: 'f(x) = ax² + bx + c', recipe: '函数源 → 函数图像 ← 滑杆', question: '同一条函数曲线怎样随参数变化？', steps: '1. 修改函数源中的 a，比较正负与大小。\n2. 保持 a 不变，分别修改 b、c。\n3. 拖动滑杆，读取不同位置的函数值。', observation: 'c 改变时整体竖直平移；a 的符号决定二次函数开口方向。换成 sin(x) 继续搭建。' },
  { kind: 'limit-sinc', name: '重要极限：sin x / x', desc: '从两侧逐步靠近 0，区分函数值与极限。', tag: '高数 · 极限', level: '入门', minutes: 6, formula: 'lim sin(x)/x，x → 0', recipe: '函数源 → 极限观察 + 函数图像', question: 'x=0 没有函数值，极限还能趋近同一个数吗？', steps: '1. 阅读极限表中从 10⁻¹ 到 10⁻⁶ 的样本。\n2. 分别切换左极限、右极限。\n3. 改成 (exp(x)-1)/x，比较数值候选。', observation: 'sin(x)/x 在 0 无定义，但两侧样本趋近 1。数值观察不替代极限证明。' },
  { kind: 'limit-sides', name: '左右极限与间断', desc: '比较 |x|/x 的左、右与双侧趋近。', tag: '高数 · 连续性', level: '基础', minutes: 8, formula: 'f(x) = |x| / x', recipe: '一个函数源 → 三个极限观察器', question: '左右都有有限极限，双侧极限就一定存在吗？', steps: '1. 比较左极限和右极限读数。\n2. 查看双侧观察器为何不输出候选。\n3. 改成 sin(x)/x、1/x，分别比较可去间断和发散。', observation: '|x|/x 左侧趋近 −1、右侧趋近 1，双侧不一致。图像中的空洞与数值表需要共同阅读。' },
  { kind: 'derivative-definition', name: '从割线走向切线', desc: '减小 h，观察差商趋近导数与局部斜率。', tag: '高数 · 导数', level: '基础', minutes: 8, formula: '[f(x₀+h) − f(x₀)] / h', recipe: '函数源 + 滑杆 → 导数切线 → 记录仪', question: '平均变化率怎样趋近瞬时变化率？', steps: '1. 将 h 从 0.5 减小到 0.01。\n2. 拖动滑杆改变 x₀，观察斜率正负变化。\n3. 将函数改成 abs(x)，滑杆设为 0，检查尖点。', observation: 'x² 的导数在 x₀ 处为 2x₀；|x| 在 0 的左右差商不同，因此停止输出导数。' },
  { kind: 'riemann-integral', name: '黎曼和与定积分', desc: '从有限矩形出发，比较取样方法与分割数。', tag: '高数 · 积分', level: '基础', minutes: 8, formula: '∫₀¹ x² dx = 1/3', recipe: '函数源 → 黎曼积分 → 记录仪', question: '矩形之和怎样逼近曲线下的积分？', steps: '1. 比较 n=4、12、50、100 时的黎曼和。\n2. 切换左端点、中点、右端点取样。\n3. 交换上下限，记录数值参考怎样改变。', observation: '分割细化后通常更接近 1/3；交换积分上下限会变号。数值参考也有离散误差。' },
  { kind: 'integral-area', name: '定积分不等于几何面积', desc: '同一函数、同一区间，并排比较积分与面积。', tag: '高数 · 积分应用', level: '进阶', minutes: 10, formula: '∫ f(x) dx 与 ∫ |f(x)| dx', recipe: '一个函数源 → 两个黎曼积分器', question: '曲线上下两部分面积会在定积分中抵消吗？', steps: '1. 比较 x³−x 在 [−1,1] 的两个积分器。\n2. 观察负值矩形与面积模式中的 |f(x)|。\n3. 修改区间为 [0,1]，再交换上下限。', observation: '原区间带符号积分为 0，几何面积为 1/2；面积按非负值累计，与区间方向无关。' },
  { kind: 'taylor-expansion', name: '泰勒展开与局部近似', desc: '调节阶数和展开中心，对比原函数与多项式。', tag: '高数 · 级数', level: '进阶', minutes: 10, formula: 'Pₙ(x) ≈ Σ f⁽ᵏ⁾(a₀)(x−a₀)ᵏ/k!', recipe: '函数源 → 泰勒近似 → 函数图像', question: '低阶多项式在多大的邻域里像原函数？', steps: '1. 从一阶逐步增加到五阶，比较 exp(x)。\n2. 将观察点从 0.2 移到 2，比较点上误差。\n3. 修改展开中心，再改为 sin(x) 或 ln(x)，注意定义域。', observation: '近似是局部的，远离中心误差可能增大。系数是数值估计，不构成级数收敛证明。' },
] as const;

export type CalculusTemplateKind = typeof CALCULUS_TEMPLATES[number]['kind'];

export function calculusTemplateDoc(kind: CalculusTemplateKind): CanvasDoc {
  const template = CALCULUS_TEMPLATES.find((t) => t.kind === kind);
  if (!template) throw new Error('高数模板不存在');
  const nodes: CanvasNode[] = [], wires: CanvasDoc['wires'] = [];
  const add = (type: NodeType, x: number, y: number, params: Record<string, number> = {}, text?: string) => {
    const node: CanvasNode = { id: nextId('n'), type, x, y, params, ...(text !== undefined ? { text } : {}) };
    nodes.push(node); return node.id;
  };
  const connect = (from: string, to: string, toPort = 'in') => wires.push({ id: nextId('w'), from, to, toPort });
  add('textNote', 35, 25, {}, `${template.name}\n探究：${template.question}`);
  add('textNote', 355, 25, {}, `动手搭建\n${template.steps}`);
  add('textNote', 675, 25, {}, `预期观察\n${template.observation}`);
  const expression = kind === 'limit-sinc' ? 'sin(x)/x' : kind === 'limit-sides' ? 'abs(x)/x' : kind === 'integral-area' ? 'x^3-x' : kind === 'taylor-expansion' ? 'exp(a*x)' : 'a*x^2+b*x+c';
  const source = add('functionSource', 35, 260, { a: 1, b: 0, c: 0 }, expression);
  if (kind === 'function-graph' || kind === 'derivative-definition') {
    const slider = add('slider', 65, 655, { v: kind === 'function-graph' ? 0.5 : 1, min: -2, max: 2 });
    const plot = add('functionPlot', 385, 260, { min: -3, max: 3 });
    connect(source, plot); connect(slider, plot, 'x');
    if (kind === 'derivative-definition') {
      const derivative = add('derivative', 815, 260, { x: 1, h: 0.5 });
      connect(source, derivative); connect(slider, derivative, 'x');
      connect(derivative, add('spark', 1250, 300));
    }
  } else if (kind === 'limit-sinc' || kind === 'limit-sides') {
    connect(source, add('functionPlot', 385, 260, { min: -1, max: 1 }));
    connect(source, add('limitProbe', 815, 260, { x: 0, side: 0 }));
    if (kind === 'limit-sides') {
      connect(source, add('limitProbe', 1200, 260, { x: 0, side: -1 }));
      connect(source, add('limitProbe', 1200, 700, { x: 0, side: 1 }));
    }
  } else if (kind === 'riemann-integral' || kind === 'integral-area') {
    const params = { lower: kind === 'integral-area' ? -1 : 0, upper: 1, n: 12, method: 1, area: 0 };
    const integral = add('integral', 385, 260, params);
    connect(source, integral);
    if (kind === 'integral-area') connect(source, add('integral', 815, 260, { ...params, area: 1 }));
    else connect(integral, add('spark', 815, 300));
  } else {
    const taylor = add('taylor', 385, 260, { center: 0, degree: 3, x: 0.5, span: 2 });
    connect(source, taylor);
    connect(taylor, add('functionPlot', 815, 260, { min: -2, max: 2, x: 0.5 }));
  }
  add('textNote', 35, 900, {}, '我的观察记录\n我改了哪些参数：\n我先预测：\n实际观察到：\n哪些结果需要用公式或证明解释：');
  return { version: 1, title: template.name, zoom: 0.8, nodes, wires, strokes: [] };
}
