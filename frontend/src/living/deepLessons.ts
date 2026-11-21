import { deepTemplateDoc, type DeepTemplateKind } from '../canvas/deepTemplates.ts';
import type { CanvasDoc, CanvasNode, NodeType } from '../canvas/types.ts';
import type { PageBlock, PageVariables } from './types';

export interface DeepLesson {
  id: string;
  title: string;
  subtitle: string;
  desc: string;
  topic: string;
  build: () => { blocks: PageBlock[]; variables: PageVariables };
}

function nodeOf(doc: CanvasDoc, type: NodeType): CanvasNode {
  const node = doc.nodes.find((item) => item.type === type);
  if (!node) throw new Error(`模板缺少 ${type} 节点`);
  return node;
}

function canvasBlock(id: string, kind: DeepTemplateKind, bindings: Record<string, string>, lockedUntil?: string, doc = deepTemplateDoc(kind)): PageBlock {
  return {
    id, type: 'canvas', data: { doc: doc as unknown as Record<string, unknown> }, bindings,
    ...(lockedUntil ? { locked_until: { block_id: lockedUntil, rule: 'submitted' as const } } : {}),
  };
}

function text(id: string, md: string): PageBlock {
  return { id, type: 'text', data: { md } };
}

function section(id: string, heading: string, level: 1 | 2 | 3 = 2): PageBlock {
  return { id, type: 'section', data: { heading, level } };
}

function quiz(id: string, question: string, value: number, min: number, max: number, answer: string): PageBlock {
  return { id, type: 'quiz', data: { question, answer, explain: '', min, max, value } };
}

export const DEEP_LESSONS: readonly DeepLesson[] = [
  {
    id: 'gradient',
    title: '十层之后，梯度还剩多少？',
    subtitle: '激活函数 · 梯度消失',
    desc: '先预测 Sigmoid 连乘十层的梯度量级，再调激活函数与输入，观察梯度柱和输入敏感性的变化。',
    topic: '专题 01 · 训练动力学',
    build: () => {
      const doc = deepTemplateDoc('dlActivation');
      const lab = nodeOf(doc, 'activationProbe');
      return {
        variables: {
          act: { label: '激活函数编号（0 ReLU / 1 LeakyReLU / 2 Sigmoid / 3 Tanh / 4 GELU）', type: 'number', value: 2, min: 0, max: 4, step: 1 },
          x: { label: '输入 x / 固定预激活 z', type: 'number', value: 1, min: -8, max: 8, step: 0.05 },
        },
        blocks: [
          section('l1_sec', '十层之后，梯度还剩多少？', 1),
          text('l1_intro', '本页的**活变量**会同时驱动正文和下方实验。当前激活函数编号为 `${act}`，输入为 `${x}`。\n\n固定权重为 1、偏置为 0 时，十层累计梯度等于十次局部导数连乘。先在闸门里押一个数量级，再看实验。'),
          quiz('l1_quiz', 'Sigmoid 在 x=1 连乘十层，梯度更接近哪个数量级？', -7, -12, 0, '约 10⁻⁷'),
          canvasBlock('l1_canvas', 'dlActivation', {
            [`${lab.id}.activation`]: 'act',
            [`${lab.id}.x`]: 'x',
          }, 'l1_quiz', doc),
          text('l1_note', '注意：固定模式只比较同一局部导数的乘积，不是真实网络前传；切到逐层模式后，$h_l=f(h_{l-1})$ 才是链式导数。ReLU 在负区间导数为 0，柱状图会显示“死神经元”的极端情形。'),
          { id: 'l1_check', type: 'checkpoint', data: { prompt: 'Sigmoid 的导数最大值是多少？', expected: '0.25', placeholder: '小数或分数，如 0.25 / 1/4', grading: 'numeric' } },
        ],
      };
    },
  },
  {
    id: 'optimizer',
    title: '同一山谷，四种走法',
    subtitle: 'SGD / Momentum / RMSProp / Adam',
    desc: '在碗形、鞍点与狭长山谷上同起点释放四种优化器，比较轨迹、振荡和最终 Loss。',
    topic: '专题 01 · 训练动力学',
    build: () => {
      const doc = deepTemplateDoc('dlOptimizer');
      const lab = nodeOf(doc, 'optimizerArena');
      return {
        variables: {
          eta: { label: '学习率', type: 'number', value: 0.05, min: 0.001, max: 0.5, step: 0.001 },
          terrain: { label: '地形（0 碗 / 1 鞍点 / 2 山谷）', type: 'number', value: 0, min: 0, max: 2, step: 1 },
        },
        blocks: [
          section('l2_sec', '同一山谷，四种走法', 1),
          text('l2_intro', '起点统一为 $(-1.5,1.5)$，学习率 `${eta}`，地形编号 `${terrain}`。\n\nMomentum 累积历史梯度，RMSProp 按二阶矩缩放，Adam 同时做一阶与二阶矩的偏差修正。先预测：同样的起点和学习率，它们的轨迹会不会一样？'),
          quiz('l2_quiz', '学习率固定时，哪种方法最可能因历史动量在狭长山谷里来回振荡？押一个“损失下降倍数”的数量级指数（-3 表示约 10⁻³）。', -2, -6, 0, '不同路径会给出不同数量级；关键是比较而非背一个数'),
          canvasBlock('l2_canvas', 'dlOptimizer', {
            [`${lab.id}.lr`]: 'eta',
            [`${lab.id}.terrain`]: 'terrain',
          }, 'l2_quiz', doc),
          text('l2_note', '把起点放到鞍点原点：解析梯度精确为零，四种方法都不会自行离开——这是确定性优化的局限。出视野不等于收敛；程序遇到非有限值会停止，保留最后有限状态。'),
        ],
      };
    },
  },
  {
    id: 'attention',
    title: '维度变大，注意力为什么变尖？',
    subtitle: '缩放点积注意力 + KV Cache',
    desc: '调 dₖ 对照缩放前后的 Softmax 权重，再逐词观察 KV Cache 省掉了哪部分计算。',
    topic: '专题 03 · 注意力与大模型',
    build: () => {
      const attention = deepTemplateDoc('dlAttention');
      const ab = nodeOf(attention, 'attentionAB');
      const kvDoc = deepTemplateDoc('dlKv');
      return {
        variables: {
          dk: { label: '键维度 dₖ', type: 'number', value: 16, min: 2, max: 64, step: 1 },
        },
        blocks: [
          section('l3_sec', '维度变大，注意力为什么变尖？', 1),
          text('l3_intro', '左侧的“未缩放”计算 $QK^\\top$，右侧除以 $\\sqrt{d_k}$。当前 $d_k=${dk}$。\n\n两套权重来自完全相同的 Q/K。先预测：$d_k$ 变大时，未缩放点积的尺度会怎样变化？Softmax 会更集中还是更均匀？'),
          quiz('l3_quiz', '在同样的 N(0,1) Q/K 上，dₖ 增大且不缩放时，Softmax 通常更接近 one-hot 吗？（1 是 / 0 否）', 1, 0, 1, '通常更尖锐，但不保证每一行都饱和'),
          canvasBlock('l3_canvas', 'dlAttention', { [`${ab.id}.dk`]: 'dk' }, 'l3_quiz', attention),
          text('l3_note', '缩放把点积的方差拉回与维度无关的量级。但“更尖锐”不等于“梯度必然归零”：Jacobian $J=\\operatorname{diag}(p)-pp^\\top$ 还取决于概率向量本身。点开热图格与弧线，核对它们是否指向同一对 Query/Key。'),
          section('l3_kvsec', '推理时，缓存省掉了什么？', 2),
          text('l3_kvtext', '下方是无缓存 / 有缓存的逐步示意。缓存锁存历史 K/V，避免每步重新投影；但每一步的注意力仍要与全部历史交互。注意区分 **K/V 投影的累计节省** 与 **注意力计算的 O(n²) 总量**。'),
          canvasBlock('l3_kv', 'dlKv', {}),
          text('l3_kvnote', '这是固定种子的玩具分布，不是真实 LLM。拖动 Temperature、Top-k、Top-p，观察“温度 softmax → Top-k 重归一化 → Top-p 最小前缀 → 再归一化”的先后顺序。'),
        ],
      };
    },
  },
  {
    id: 'regularization',
    title: '训练 Loss 更低，就一定更好吗？',
    subtitle: '过拟合、正则化与 Batch 噪声',
    desc: '在带噪同心圆数据上同时观察训练/验证 Loss、决策边界与 L2、Dropout、Batch 的影响。',
    topic: '专题 01 · 泛化',
    build: () => {
      const doc = deepTemplateDoc('dlRegularization');
      const trainer = nodeOf(doc, 'mlpTrainer');
      return {
        variables: {
          l2: { label: 'L2 系数', type: 'number', value: 0, min: 0, max: 0.05, step: 0.001 },
          dropout: { label: 'Dropout 概率', type: 'number', value: 0, min: 0, max: 0.8, step: 0.05 },
        },
        blocks: [
          section('l4_sec', '训练 Loss 更低，就一定更好吗？', 1),
          text('l4_intro', '数据集带有噪声，训练集和验证集分开。当前 L2 = `${l2}`，Dropout = `${dropout}`。\n\n验证点用空心圆标出，且**不参与权重更新**。先预测：不加正则时，训练 Loss 与验证 Loss 会一直同步下降吗？'),
          quiz('l4_quiz', '训练 Loss 持续下降时，验证 Loss 一定也持续下降吗？（1 是 / 0 否）', 0, 0, 1, '不一定；两条曲线可能分叉'),
          canvasBlock('l4_canvas', 'dlRegularization', {
            [`${trainer.id}.l2`]: 'l2',
            [`${trainer.id}.dropout`]: 'dropout',
          }, 'l4_quiz', doc),
          text('l4_note', '边界与 Loss 来自真实的小网络优化，不保证某组超参数一定“更好”。观察到的是这小份数据与这个种子下的行为；Dropout 只在训练态启用，评估时不丢神经元。'),
          { id: 'l4_check', type: 'checkpoint', data: { prompt: '验证集为什么不参与反向传播？（作答记录点）', expected: '', placeholder: '写下你的理解', grading: 'exact' } },
        ],
      };
    },
  },
];

export function deepLessonById(id: string): DeepLesson | undefined {
  return DEEP_LESSONS.find((lesson) => lesson.id === id);
}
