import { nextId } from './math.ts';
import type { CanvasDoc, CanvasNode, CanvasPanel } from './types.ts';

export type DeepTemplateKind =
  | 'dlSvm' | 'dlActivation' | 'dlOptimizer' | 'dlRegularization'
  | 'dlManifold' | 'dlCnn' | 'dlResnet'
  | 'dlSequence' | 'dlAttention' | 'dlMultihead' | 'dlKv'
  | 'dlAutoencoder' | 'dlDiffusion' | 'dlQlearning';

export interface DeepTopic {
  id: string;
  name: string;
  lead: string;
}

export interface DeepTemplate {
  kind: DeepTemplateKind;
  topic: string;
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
  preview: 'unit' | 'architecture' | 'attention' | 'generative';
}

export const DEEP_TOPICS: readonly DeepTopic[] = [
  {
    id: 'dl01', name: '专题 01 · 神经单元与训练动力学',
    lead: '从间隔、激活与优化器出发：先看到梯度怎样衰减，再看到不同更新规则如何改变轨迹。',
  },
  {
    id: 'dl02', name: '专题 02 · 经典深度网络架构',
    lead: '线性层折叠空间、卷积共享局部权重、残差与归一化保住梯度通路——三层结构各解决一个问题。',
  },
  {
    id: 'dl03', name: '专题 03 · 注意力与大模型机制',
    lead: '比较循环记忆与直接检索，拆开缩放、多头、位置编码与 KV Cache；分清单步成本与序列总成本。',
  },
  {
    id: 'dl04', name: '专题 04 · 生成模型与深度强化学习',
    lead: '在二维玩具数据上观察潜空间、Score 向量场与 Q 值传播；小模型结论不能直接外推到真实系统。',
  },
];

export const DEEP_TEMPLATES: readonly DeepTemplate[] = [
  {
    kind: 'dlSvm', topic: 'dl01', name: 'SVM：间隔与支持向量', desc: '在双月点云上调整 C 与线性/二次特征，观察间隔、支持候选与准确率。',
    tag: '深度学习 · 专题 01 · 分类', question: 'C 变大时，有多少点被允许落进间隔？二次映射后线性不可分的数据发生了什么？',
    steps: '1. 保持线性特征，只调 C，记录支持候选数量与训练准确率。\n2. 切到二次特征，观察决策边界由直线变成曲线。\n3. 对照验证准确率，判断训练集拟合是否等于泛化。',
    observation: 'C 控制 hinge 惩罚；支持候选是 margin 附近的训练点。二次映射是固定 φ=[x,y,x²,√2xy,y²]，不是任意核。',
    keywords: ['SVM', '支持向量', 'hinge', 'margin', '核', 'C', '分类'], preview: 'unit',
  },
  {
    kind: 'dlActivation', topic: 'dl01', name: '激活函数 · 十层梯度探针', desc: '同屏查看五种激活及导数，比较十层局部导数连乘与逐层前传的梯度。',
    tag: '深度学习 · 专题 01 · 梯度', question: 'Sigmoid 叠十层后梯度为什么容易接近零？ReLU 在负区间的梯度说明了什么？',
    steps: '1. 逐一切换激活函数，观察曲线与导数。\n2. 固定输入，查看十层累计梯度柱状图。\n3. 切换“逐层前传”，比较两种假设的差异。',
    observation: '固定模式只乘同一局部导数，不是真实网络前传；逐层模式是 hₗ=f(hₗ₋₁) 的链式导数。权重假设为 1。',
    keywords: ['ReLU', 'LeakyReLU', 'Sigmoid', 'Tanh', 'GELU', '梯度消失', 'dead ReLU', '激活'], preview: 'unit',
  },
  {
    kind: 'dlOptimizer', topic: 'dl01', name: '优化器 · 四种地形赛跑', desc: '在碗、鞍点、狭长山谷上同起点释放 SGD、Momentum、RMSProp、Adam。',
    tag: '深度学习 · 专题 01 · 优化', question: '为什么 Momentum 在狭长山谷里更稳？鞍点上 Adam 会不会比 SGD 更容易离开精确原点？',
    steps: '1. 选择碗形地形，比较四条轨迹的振荡与步数。\n2. 换到狭长山谷，降低 lr 观察稳定性。\n3. 在鞍点把起点放在原点，记录精确零梯度的情形。',
    observation: '四种方法共享起点与学习率，但动量、二阶矩和偏差修正不同。出视野不等于收敛；发散时程序停止。',
    keywords: ['SGD', 'Momentum', 'RMSProp', 'Adam', '学习率', '鞍点', '优化器'], preview: 'unit',
  },
  {
    kind: 'dlRegularization', topic: 'dl01', name: '过拟合 · 正则化与 Batch 噪声', desc: '带噪点云上调节 L1/L2、Dropout 与 Batch Size，观察训练/验证 Loss 分叉。',
    tag: '深度学习 · 专题 01 · 泛化', question: '训练 Loss 更低一定更好吗？小 Batch 的噪声在什么阶段像正则化，在什么阶段阻碍收敛？',
    steps: '1. 先不加正则训练，记录训练与验证 Loss。\n2. 提高 L2 与 Dropout，观察边界平滑度与两条曲线。\n3. 调小 Batch，比较 Loss 波动与最终泛化。',
    observation: '验证集不参与权重更新；Dropout 只在训练态启用。真实优化结果不保证特定超参数一定更好。',
    keywords: ['过拟合', 'L1', 'L2', 'Dropout', 'Batch', '正则化', '泛化'], preview: 'architecture',
  },
  {
    kind: 'dlManifold', topic: 'dl02', name: 'MLP · 流形折叠观察台', desc: '把二维坐标网格一起喂入网络，逐层切换看线性拉伸与激活折叠。',
    tag: '深度学习 · 专题 02 · 表示', question: '为什么异或/双螺旋点云经过两层非线性后能用一条线分开？',
    steps: '1. 用异或数据训练，查看 Input 与 Layer 1 网格。\n2. 逐层穿梭到 Output，观察两类概率区域。\n3. 换双螺旋数据，比较需要多宽的隐层。',
    observation: '网格显示的是当前层坐标变换；训练结果取决于优化，不宣称一定分离。Layer 1 只显示前两个神经元。',
    keywords: ['MLP', '流形', 'XOR', '双螺旋', '网格', '表示学习'], preview: 'architecture',
  },
  {
    kind: 'dlCnn', topic: 'dl02', name: 'CNN · 卷积核与感受野透视', desc: '12×12 像素画板 + 3×3 可编辑卷积核，点击输出反溯感受野与乘加。',
    tag: '深度学习 · 专题 02 · 视觉', question: '两层 3×3 卷积为什么能覆盖原图 5×5？Stride 与 Pooling 怎样改变输出尺寸？',
    steps: '1. 选边缘核，在画板上画一条竖线。\n2. 点击输出像素，查看叠加两层后的原图 5×5 区域。\n3. 开 Padding 或 Stride，观察尺寸与边界响应。',
    observation: '实现为互相关，不翻转核；零填充位置以 0 参与乘加。追踪展示的是精确贡献，不是近似热图。',
    keywords: ['CNN', '卷积', '感受野', 'kernel', 'stride', 'padding', 'pooling'], preview: 'architecture',
  },
  {
    kind: 'dlResnet', topic: 'dl02', name: 'ResNet · 残差与归一化对照', desc: '纯堆叠 vs x+F(x)+BN/LN，对照每层激活方差与输入梯度模长。',
    tag: '深度学习 · 专题 02 · 残差', question: '残差旁路保住了什么？BN 与 LN 的统计轴不同，什么时候会给出不同结果？',
    steps: '1. 固定深度与 W 增益，比较两条梯度曲线。\n2. 把归一化从 BN 切到 LN。\n3. 增加层数，观察纯堆叠的方差与梯度。',
    observation: 'BN 按列跨样本统计，LN 按行跨特征统计。真实反传，不保证所有参数下残差都占优。',
    keywords: ['ResNet', '残差', 'BatchNorm', 'LayerNorm', '梯度', '方差'], preview: 'architecture',
  },
  {
    kind: 'dlSequence', topic: 'dl03', name: 'RNN / LSTM · 门控与直接检索', desc: '比较循环隐状态的指数衰减、LSTM 门控记忆与注意力直接权重。',
    tag: '深度学习 · 专题 03 · 序列', question: '开头信息为什么会随步数衰减？注意力跨距 O(1) 是否意味着整个序列计算也是 O(1)？',
    steps: '1. 调循环权重 w，观察开头敏感性曲线。\n2. 改 LSTM 遗忘门 bias，比较 cell 保留。\n3. 查看末 token 的注意力权重。',
    observation: '注意力到任意位置的路径长度是 O(1)，但全序列注意力计算通常 O(n²)。标量模型是机制示意。',
    keywords: ['RNN', 'LSTM', '遗忘门', '注意力', '长序列', 'memory'], preview: 'attention',
  },
  {
    kind: 'dlAttention', topic: 'dl03', name: 'Attention · 缩放 A/B 对照', desc: '调 dₖ 与 Q/K 词元，同时查看未缩放和除以 √dₖ 的 Softmax 权重。',
    tag: '深度学习 · 专题 03 · 注意力', question: 'dₖ 增大时未缩放点积为什么会饱和？缩放后的熵和梯度一定更大吗？',
    steps: '1. 固定 Q/K，观察 dₖ=2 与 64 的两张热图。\n2. 点击热图格，联动查看弧线权重。\n3. 比较两行的熵与 Jacobian 范数。',
    observation: 'A/B 使用完全相同的固定种子 Q/K。大 logits 常使分布更尖锐、梯度更小，但不保证每行饱和或梯度归零。',
    keywords: ['Attention', 'scaled dot-product', 'dk', 'softmax', '熵', '缩放'], preview: 'attention',
  },
  {
    kind: 'dlMultihead', topic: 'dl03', name: 'Multi-head · 位置编码', desc: '两头各自投影与注意力，对照 Sinusoid 与 RoPE 的相对位置内积。',
    tag: '深度学习 · 专题 03 · 位置', question: '多头为什么能关注不同关系？RoPE 如何让内积依赖相对距离而不是绝对位置？',
    steps: '1. 切换两个注意力头，比较权重。\n2. 在 Sinusoid 与 RoPE 间切换。\n3. 调整整体位置偏移，观察相对内积是否改变。',
    observation: '教学向量固定，不代表语言语义；头与投影是明确写出的简化模型。RoPE 在投影后旋转，相对内积应约保持。',
    keywords: ['Multi-head', '位置编码', 'Sinusoidal', 'RoPE', '相对位置'], preview: 'attention',
  },
  {
    kind: 'dlKv', topic: 'dl03', name: 'KV Cache · 推理与采样', desc: '逐词生成动画对比有无缓存，并用 Temperature/Top-k/Top-p 重分布候选。',
    tag: '深度学习 · 专题 03 · 推理', question: 'KV Cache 省掉了哪一部分计算？为什么它不能把注意力的 O(n²) 总代价变成 O(n)？',
    steps: '1. 播放生成动画，比较左右 K/V 锁存。\n2. 查看累计投影与注意力 MAC。\n3. 调 Top-k/Top-p，观察最小前缀截断与重归一化。',
    observation: '玩具 logits 是确定性示意，不是真实 LLM。缓存省去历史 K/V 重投影；每步注意力仍需面对全部历史。',
    keywords: ['KV Cache', 'temperature', 'top-k', 'top-p', '自回归', '采样'], preview: 'attention',
  },
  {
    kind: 'dlAutoencoder', topic: 'dl04', name: 'Autoencoder · 潜空间与 InfoNCE', desc: '线性教学 AE 压缩到二维，配合 InfoNCE 正负样本力场观察拉近与推远。',
    tag: '深度学习 · 专题 04 · 表示', question: '锚点被拉向哪个方向？温度 τ 如何改变正负样本的相对权重？',
    steps: '1. 点击平面移动 anchor，观察梯度箭头。\n2. 调整 τ，比较 softmax 概率与 loss。\n3. 旋转 AE 子空间，观察潜坐标变化。',
    observation: 'AE 是精确线性投影教学模型，非训练网络或 PCA；InfoNCE 使用未归一化点积，箭头是 anchor 的负梯度方向。',
    keywords: ['Autoencoder', 'AE', 'InfoNCE', '对比学习', '潜空间', '温度'], preview: 'generative',
  },
  {
    kind: 'dlDiffusion', topic: 'dl04', name: 'Diffusion · 加噪与解析 score', desc: '双峰/Swiss roll 点云沿 t 加噪，叠加解析 Score 箭头并做一次反向 Euler 步。',
    tag: '深度学习 · 专题 04 · 生成', question: '加噪后点云怎样接近先验？Score 箭头指向高密度区的哪个方向？',
    steps: '1. 从 t=0 拉到 4，观察点云扩散。\n2. 打开 Score 箭头，比较指向。\n3. 开启反向一步，观察点被拉回多少。',
    observation: 'Score 来自解析 Gaussian mixture，不是训练的去噪网络；反向 Euler 只做一步，不是精确还原。',
    keywords: ['Diffusion', '扩散', 'score', '去噪', '高斯混合', 'Swiss roll'], preview: 'generative',
  },
  {
    kind: 'dlQlearning', topic: 'dl04', name: 'Q-learning / REINFORCE · 悬崖迷宫', desc: '6×6 悬崖世界中调 γ、α、ε，观察 Q 热力箭头、策略与回合曲线。',
    tag: '深度学习 · 专题 04 · 强化学习', question: '折扣因子 γ 如何改变远处的终点奖励？探索率 ε 与学习率 α 各影响什么？',
    steps: '1. 运行 Q-learning，观察箭头从终点向外传播。\n2. 调低 γ，比较路径与回报。\n3. 切到 REINFORCE，比较回合波动。',
    observation: 'Q-learning 使用 seeded ε-greedy 与 Bellman 更新；REINFORCE 是策略梯度演示。奖励固定，200 步截断。',
    keywords: ['Q-learning', 'REINFORCE', '策略梯度', '强化学习', 'gamma', 'epsilon', '迷宫'], preview: 'generative',
  },
];

const byKind = new Map(DEEP_TEMPLATES.map((template) => [template.kind, template]));

export function isDeepTemplateKind(kind: string): kind is DeepTemplateKind {
  return byKind.has(kind as DeepTemplateKind);
}

function node(type: CanvasNode['type'], x: number, y: number, params: Record<string, number> = {}, text?: string): CanvasNode {
  return { id: nextId('n'), type, x, y, params, ...(text === undefined ? {} : { text }) };
}

function note(template: DeepTemplate): CanvasNode {
  return node('textNote', 60, 30, {}, `探究：${template.question}\n\n步骤：\n${template.steps}\n\n观察：${template.observation}`);
}

function singleLabDoc(template: DeepTemplate, type: CanvasNode['type'], params: Record<string, number>, exposed: CanvasPanel['exposed_params']): CanvasDoc {
  const lab = node(type, 60, 220, params);
  return {
    version: 1, title: template.name, zoom: 1, strokes: [],
    nodes: [note(template), lab],
    wires: [],
    panel: { title: template.name, view_node_ids: [lab.id], exposed_params: exposed.map((entry) => ({ ...entry, node_id: lab.id })) },
  };
}

export function deepTemplateDoc(kind: DeepTemplateKind): CanvasDoc {
  const template = byKind.get(kind);
  if (!template) throw new Error(`未知深度学习模板：${kind}`);
  switch (kind) {
    case 'dlSvm': {
      const data = node('dataset2dSource', 60, 220, { kind: 1, samples: 100, noise: 0.12, seed: 7 });
      const lab = node('svmLab', 360, 220, { control: 2, steps: 100, quadratic: 0 });
      return {
        version: 1, title: template.name, zoom: 1, strokes: [],
        nodes: [note(template), data, lab],
        wires: [{ id: nextId('w'), from: data.id, to: lab.id, toPort: 'in' }],
        panel: { title: template.name, view_node_ids: [data.id, lab.id], exposed_params: [
          { node_id: lab.id, param_key: 'control', label: 'C', min: 0.01, max: 20, step: 0.1 },
          { node_id: lab.id, param_key: 'quadratic', label: '二次特征', min: 0, max: 1, step: 1 },
          { node_id: data.id, param_key: 'noise', label: '数据噪声', min: 0, max: 0.5, step: 0.01 },
        ] },
      };
    }
    case 'dlActivation':
      return singleLabDoc(template, 'activationProbe', { activation: 2, x: 1, mode: 0 }, [
        { node_id: '', param_key: 'activation', label: '激活函数', min: 0, max: 4, step: 1 },
        { node_id: '', param_key: 'x', label: '输入', min: -8, max: 8, step: 0.05 },
        { node_id: '', param_key: 'mode', label: '实验模式', min: 0, max: 1, step: 1 },
      ]);
    case 'dlOptimizer':
      return singleLabDoc(template, 'optimizerArena', { terrain: 0, lr: 0.05, steps: 60, x: -1.5, y: 1.5 }, [
        { node_id: '', param_key: 'terrain', label: '地形', min: 0, max: 2, step: 1 },
        { node_id: '', param_key: 'lr', label: '学习率', min: 0.001, max: 1, step: 0.001 },
        { node_id: '', param_key: 'steps', label: '步数', min: 0, max: 200, step: 1 },
      ]);
    case 'dlRegularization': {
      const data = node('dataset2dSource', 60, 220, { kind: 2, samples: 100, noise: 0.22, seed: 11 });
      const trainer = node('mlpTrainer', 360, 220, { width: 6, seed: 7, lr: 0.08, batch: 16, l1: 0, l2: 0, dropout: 0, play: 0, reset: 0 });
      const boundary = node('boundaryView', 760, 200, { layer: 0 });
      const spark = node('spark', 760, 620, {});
      const trainWire = { id: nextId('w'), from: trainer.id, fromPort: 'loss', to: spark.id, toPort: 'in' };
      const validationWire = { id: nextId('w'), from: trainer.id, fromPort: 'validationLoss', to: spark.id, toPort: 'validation' };
      const boundaryWire = { id: nextId('w'), from: trainer.id, fromPort: 'boundary', to: boundary.id, toPort: 'in' };
      return {
        version: 1, title: template.name, zoom: 1, strokes: [],
        nodes: [note(template), data, trainer, boundary, spark],
        wires: [{ id: nextId('w'), from: data.id, to: trainer.id, toPort: 'in' }, trainWire, validationWire, boundaryWire],
        panel: { title: template.name, view_node_ids: [trainer.id, boundary.id, spark.id], exposed_params: [
          { node_id: trainer.id, param_key: 'l1', label: 'L1', min: 0, max: 0.05, step: 0.001 },
          { node_id: trainer.id, param_key: 'l2', label: 'L2', min: 0, max: 0.05, step: 0.001 },
          { node_id: trainer.id, param_key: 'dropout', label: 'Dropout', min: 0, max: 0.8, step: 0.05 },
          { node_id: trainer.id, param_key: 'batch', label: 'Batch', min: 1, max: 16, step: 1 },
          { node_id: data.id, param_key: 'noise', label: '噪声', min: 0, max: 0.5, step: 0.01 },
        ] },
      };
    }
    case 'dlManifold': {
      const data = node('dataset2dSource', 60, 220, { kind: 3, samples: 100, noise: 0.08, seed: 7 });
      const trainer = node('mlpTrainer', 360, 220, { width: 6, seed: 7, lr: 0.08, batch: 16, l1: 0, l2: 0, dropout: 0, play: 0, reset: 0 });
      const boundary = node('boundaryView', 760, 200, { layer: 1 });
      return {
        version: 1, title: template.name, zoom: 1, strokes: [],
        nodes: [note(template), data, trainer, boundary],
        wires: [
          { id: nextId('w'), from: data.id, to: trainer.id, toPort: 'in' },
          { id: nextId('w'), from: trainer.id, fromPort: 'boundary', to: boundary.id, toPort: 'in' },
        ],
        panel: { title: template.name, view_node_ids: [trainer.id, boundary.id], exposed_params: [
          { node_id: trainer.id, param_key: 'width', label: '隐层宽度', min: 1, max: 8, step: 1 },
          { node_id: trainer.id, param_key: 'lr', label: '学习率', min: 0.0001, max: 0.5, step: 0.01 },
          { node_id: boundary.id, param_key: 'layer', label: '层级', min: 0, max: 3, step: 1 },
        ] },
      };
    }
    case 'dlCnn': {
      const pixels = node('pixelGridSource', 60, 220, { preset: 0, brush: 1 });
      const conv = node('conv2dOp', 300, 220, { kernel: 0, stride: 1, padding: 0, pool: 0, second: 1 });
      const view = node('matrixHeatmapView', 640, 220, {});
      return {
        version: 1, title: template.name, zoom: 1, strokes: [],
        nodes: [note(template), pixels, conv, view],
        wires: [
          { id: nextId('w'), from: pixels.id, to: conv.id, toPort: 'in' },
          { id: nextId('w'), from: conv.id, to: view.id, toPort: 'in' },
        ],
        panel: { title: template.name, view_node_ids: [pixels.id, conv.id, view.id], exposed_params: [
          { node_id: conv.id, param_key: 'kernel', label: '卷积核', min: 0, max: 2, step: 1 },
          { node_id: conv.id, param_key: 'stride', label: 'Stride', min: 1, max: 2, step: 1 },
          { node_id: conv.id, param_key: 'padding', label: 'Padding', min: 0, max: 1, step: 1 },
          { node_id: conv.id, param_key: 'second', label: '第二层', min: 0, max: 1, step: 1 },
        ] },
      };
    }
    case 'dlResnet':
      return singleLabDoc(template, 'resnetLab', { control: 0.65, depth: 6, norm: 2 }, [
        { node_id: '', param_key: 'control', label: 'W 增益', min: 0.05, max: 2, step: 0.05 },
        { node_id: '', param_key: 'depth', label: '层数', min: 1, max: 12, step: 1 },
        { node_id: '', param_key: 'norm', label: '归一化', min: 0, max: 2, step: 1 },
      ]);
    case 'dlSequence':
      return singleLabDoc(template, 'sequenceMemory', { recurrent: 0.7, control: 2 }, [
        { node_id: '', param_key: 'recurrent', label: '循环权重', min: -1.5, max: 1.5, step: 0.05 },
        { node_id: '', param_key: 'control', label: '遗忘门 bias', min: -5, max: 5, step: 0.1 },
      ]);
    case 'dlAttention':
      return singleLabDoc(template, 'attentionAB', { dk: 16, query: 1, key: 2 }, [
        { node_id: '', param_key: 'dk', label: 'dₖ', min: 2, max: 64, step: 1 },
        { node_id: '', param_key: 'query', label: 'Query', min: 0, max: 5, step: 1 },
        { node_id: '', param_key: 'key', label: 'Key', min: 0, max: 5, step: 1 },
      ]);
    case 'dlMultihead':
      return singleLabDoc(template, 'multiheadLab', { mode: 1, control: 0, head: 0 }, [
        { node_id: '', param_key: 'mode', label: '位置编码', min: 0, max: 1, step: 1 },
        { node_id: '', param_key: 'control', label: '整体偏移', min: -20, max: 20, step: 1 },
        { node_id: '', param_key: 'head', label: '观察头', min: 0, max: 1, step: 1 },
      ]);
    case 'dlKv':
      return singleLabDoc(template, 'kvCache', { steps: 4, temperature: 1, topk: 10, topp: 1 }, [
        { node_id: '', param_key: 'steps', label: '生成步骤', min: 1, max: 8, step: 1 },
        { node_id: '', param_key: 'temperature', label: 'Temperature', min: 0.05, max: 3, step: 0.05 },
        { node_id: '', param_key: 'topk', label: 'Top-k', min: 1, max: 10, step: 1 },
        { node_id: '', param_key: 'topp', label: 'Top-p', min: 0.01, max: 1, step: 0.01 },
      ]);
    case 'dlAutoencoder':
      return singleLabDoc(template, 'autoencoderLab', { control: 0.5, angle: 0, ax: 0.4, ay: 0.3 }, [
        { node_id: '', param_key: 'control', label: '温度 τ', min: 0.05, max: 5, step: 0.05 },
        { node_id: '', param_key: 'angle', label: '子空间旋转', min: -3.14, max: 3.14, step: 0.05 },
        { node_id: '', param_key: 'ax', label: 'Anchor x', min: -3, max: 3, step: 0.1 },
        { node_id: '', param_key: 'ay', label: 'Anchor y', min: -3, max: 3, step: 0.1 },
      ]);
    case 'dlDiffusion':
      return singleLabDoc(template, 'diffusionLab', { control: 0.4, swiss: 0, seed: 7, reverse: 0 }, [
        { node_id: '', param_key: 'control', label: '扩散时间 t', min: 0, max: 4, step: 0.02 },
        { node_id: '', param_key: 'swiss', label: '先验', min: 0, max: 1, step: 1 },
        { node_id: '', param_key: 'reverse', label: '反向一步', min: 0, max: 1, step: 1 },
      ]);
    case 'dlQlearning':
      return singleLabDoc(template, 'qLearningLab', { mode: 0, control: 0.2, alpha: 0.15, gamma: 0.95, episodes: 30, seed: 7 }, [
        { node_id: '', param_key: 'mode', label: '算法', min: 0, max: 1, step: 1 },
        { node_id: '', param_key: 'gamma', label: '折扣 γ', min: 0, max: 1, step: 0.01 },
        { node_id: '', param_key: 'alpha', label: '学习率 α', min: 0.001, max: 1, step: 0.01 },
        { node_id: '', param_key: 'control', label: '探索 ε', min: 0, max: 1, step: 0.05 },
      ]);
  }
}
