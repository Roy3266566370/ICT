import type { CanvasDoc, CanvasNode, NodeType } from './types.ts';
import { deepTemplateDoc, type DeepTemplateKind } from './deepTemplates.ts';
import { isDeepPanoramaTemplateKind } from './deepPanoramaTemplates.ts';
import { nextId } from './math.ts';
import { buildDeepPipelineDoc } from './deepPipeline.ts';

const DEEP_PANORAMA_DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  'dl-mlp-backprop': { scenario: 0, activation: 1, lr: 0.12, width: 6, l2: 0.0005, dropout: 0 },
  'dl-cnn-resnet': { inputPattern: 3, kernel: 0, stride: 1, scanCell: -1 },
  'dl-transformer-attention': { dk: 16, offset: 0, encoding: 1, scaleMode: 1, query: 4 },
  'dl-llm-inference-lora': { mode: 0, temperature: 1, topk: 10, topp: 1, rank: 2, quant: 0 },
  'dl-diffusion-latent': { scenario: 2, beta: 3, steps: 30, anchorX: 0.6, anchorY: 0.2 },
  'dl-rl-agent': { alpha: 0.18, gamma: 0.95, epsilon: 0.22, reinforce: 0, selectedState: 30 },
};
const DEEP_PANORAMA_TITLES: Record<string, string> = {
  'dl-mlp-backprop': 'MLP 流形折叠与反传沙盘',
  'dl-cnn-resnet': 'CNN 卷积扫描与感受野沙盘',
  'dl-transformer-attention': 'Transformer 注意力全景沙盘',
  'dl-llm-inference-lora': 'LLM 推理、KV-cache 与 LoRA 沙盘',
  'dl-diffusion-latent': '扩散轨迹与潜空间沙盘',
  'dl-rl-agent': '强化学习智能体进化沙盘',
};
const DEEP_PANORAMA_EXPOSED: Record<string, readonly [string, string, number, number, number][]> = {
  'dl-mlp-backprop': [['lr', '学习率', 0.01, 0.32, 0.005], ['width', '隐藏宽度', 2, 8, 1], ['dropout', 'Dropout', 0, 0.5, 0.02]],
  'dl-cnn-resnet': [['kernel', '卷积核', 0, 3, 1], ['stride', '步幅', 1, 2, 1]],
  'dl-transformer-attention': [['dk', '维度 dₖ', 2, 64, 1], ['offset', '位置偏移', -8, 8, 1], ['scaleMode', '缩放路径', 0, 1, 1]],
  'dl-llm-inference-lora': [['temperature', '温度', 0.2, 2.4, 0.05], ['topk', 'top-k', 1, 10, 1], ['topp', 'top-p', 0.2, 1, 0.02]],
  'dl-diffusion-latent': [['beta', '噪声速率', 1, 5, 0.1], ['steps', '反向步数', 8, 42, 1], ['anchorX', 'anchor x', -1.6, 1.6, 0.05]],
  'dl-rl-agent': [['alpha', '学习率', 0.01, 0.5, 0.01], ['gamma', '折扣', 0, 1, 0.01], ['epsilon', '探索率', 0, 0.8, 0.01]],
};

/** Workbench templates are separate from the documents used by published lessons. */
export function deepWorkshopDoc(kind: DeepTemplateKind | string): CanvasDoc {
  if (isDeepPanoramaTemplateKind(kind)) return buildDeepPipelineDoc(kind);

  const older = deepTemplateDoc(kind as DeepTemplateKind);
  const doc: CanvasDoc = {
    version: 1, title: older.title, nodes: [], wires: [], strokes: [], zoom: 0.9,
    panel: { title: older.title, view_node_ids: [], exposed_params: [] },
  };
  const panel = doc.panel!;
  const add = (type: NodeType, x: number, y: number, params: Record<string, number> = {}, text?: string): CanvasNode => {
    const node = { id: nextId('n'), type, x: 32 + x * 290, y: 28 + y * 250, params, ...(text === undefined ? {} : { text }) };
    doc.nodes.push(node);
    return node;
  };
  const wire = (from: CanvasNode, to: CanvasNode, toPort = 'in', fromPort = 'out') => {
    doc.wires.push({ id: nextId('w'), from: from.id, to: to.id, fromPort, toPort });
    return to;
  };
  const expose = (node: CanvasNode, param_key: string, label: string, min: number, max: number, step: number) => {
    panel.exposed_params.push({ node_id: node.id, param_key, label, min, max, step });
  };
  const control = (label: string, v: number, min: number, max: number, step: number, row: number) => {
    const node = add('slider', 0, row, { v, min, max, step }, label);
    expose(node, 'v', label, min, max, step);
    return node;
  };
  const watch = (source: CanvasNode, column: number, row: number, label: string, port = 'out', type: NodeType = 'matrixHeatmapView') => {
    const view = wire(source, add(type, column, row, {}, label), 'in', port);
    panel.view_node_ids.push(view.id);
    return view;
  };
  switch (kind) {
    case 'dlActivation': {
      const x = control('输入 x', 1, -8, 8, .05, 0);
      const activationKind = control('激活函数（0–4）', 2, 0, 4, 1, 1);
      const mode = control('逐层前传', 0, 0, 1, 1, 2);
      const activation = wire(x, add('studyActivation', 1, 0), '输入');
      wire(activationKind, activation, '激活');
      const chain = wire(activation, add('studyGradient', 2, 0));
      wire(mode, chain, '逐层前传');
      watch(chain, 3, 0, '十层累计梯度', 'out', 'studyBars');
      watch(chain, 3, 1, '逐层输入、输出、局部导数、累计梯度');
      return doc;
    }
    case 'dlCnn': {
      const pixels = add('pixelGridSource', 0, 0, { preset: 0, brush: 1 });
      const first = wire(pixels, add('conv2dOp', 1.15, 0, { kernel: 0, stride: 1, padding: 0, pool: 0, second: 0 }, 'conv1'));
      const second = wire(first, add('conv2dOp', 2.35, 0, { kernel: 0, stride: 1, padding: 0, pool: 0, second: 0 }, 'conv2'));
      const poolEnabled = control('最大池化', 0, 0, 1, 1, 2);
      const pool = wire(second, add('studyPool', 3.55, 0));
      wire(poolEnabled, pool, '启用');
      watch(pool, 4.5, 0, '输出特征图与感受野');
      expose(first, 'kernel', '第一层卷积核', 0, 2, 1);
      expose(second, 'kernel', '第二层卷积核', 0, 2, 1);
      expose(first, 'stride', '第一层步长', 1, 2, 1);
      expose(first, 'padding', '第一层填充', 0, 1, 1);
      return doc;
    }
    case 'dlAttention': {
      const dim = control('键维度 dₖ', 8, 2, 16, 1, 0);
      const causal = control('因果掩码', 0, 0, 1, 1, 1);
      const tokens = wire(dim, add('studyTokens', .9, 0), '维度');
      const q = wire(tokens, add('studyProjection', 1.8, 0, { 种子: 7 }, 'Q 投影'));
      const k = wire(tokens, add('studyProjection', 1.8, .65, { 种子: 53 }, 'K 投影'));
      const v = wire(tokens, add('studyProjection', 1.8, 1.3, { 种子: 97 }, 'V 投影'));
      const scores = wire(q, add('studyScores', 2.7, 0), 'Q');
      wire(k, scores, 'K');
      const scaled = wire(scores, add('studyScale', 3.6, 0));
      wire(k, scaled, 'K');
      for (const [i, input] of [scaled, scores].entries()) {
        const masked = wire(input, add('studyMask', 4.4, i));
        wire(causal, masked, '启用');
        const weights = wire(masked, add('studySoftmax', 5.25, i));
        const out = wire(weights, add('studyWeighted', 6, i), '权重');
        wire(v, out, 'V');
        watch(weights, 6, i + 2, i ? '未缩放权重' : '缩放后权重');
        watch(out, 7, i, i ? '未缩放输出' : '缩放后输出');
      }
      return doc;
    }
    case 'dlMultihead': {
      const mode = control('RoPE（关：正弦位置编码）', 1, 0, 1, 1, 1);
      const offset = control('位置偏移', 0, -20, 20, 1, 2);
      const tokens = add('tokenSeqSource', 0, 0, { seed: 7 });
      const outputs = [0, 1].map((head) => {
        const row = head * 2;
        const raw = wire(tokens, add('studyHead', 1, row, { 头: head }));
        const base = wire(raw, add('studyPosition', 2, row));
        wire(mode, base, '模式');
        wire(offset, base, '偏移');
        const reversed = wire(raw, add('studyReversePair', 2, row + 1));
        const key = wire(reversed, add('studyPosition', 3, row + 1, { key: 1 }));
        wire(mode, key, '模式');
        wire(offset, key, '偏移');
        const score = wire(base, add('studyScores', 4, row), 'Q');
        wire(key, score, 'K');
        const scaled = wire(score, add('studyScale', 5, row));
        wire(key, scaled, 'K');
        const weights = wire(scaled, add('studySoftmax', 6, row));
        watch(weights, 7, row + 1, `头 ${head + 1} 权重`);
        const out = wire(weights, add('studyWeighted', 7, row), '权重');
        wire(raw, out, 'V');
        return out;
      });
      const combined = wire(outputs[0]!, add('studyConcat', 6, 4), '头一');
      wire(outputs[1]!, combined, '头二');
      watch(combined, 7, 4, '合并后的输出');
      return doc;
    }
    case 'dlSequence': {
      const input = add('tokenSeqSource', 0, 0, { seed: 7 });
      const recurrence = control('循环权重', .7, -1.5, 1.5, .05, 1);
      const forget = control('遗忘门 bias', 2, -5, 5, .1, 2);
      const rnn = wire(input, add('studyRnn', 1, 0));
      const lstm = wire(input, add('studyLstm', 1, 1));
      wire(recurrence, rnn, '循环权重');
      wire(forget, lstm, '遗忘门');
      const retrieve = wire(input, add('studyRetrieve', 1, 2));
      watch(rnn, 2, 0, 'RNN 隐状态与首词敏感度');
      watch(lstm, 2, 1, 'LSTM 隐状态与首词敏感度');
      watch(retrieve, 2, 2, '注意力检索权重');
      return doc;
    }
    case 'dlKv': {
      const step = control('词元步数', 4, 1, 8, 1, 0);
      const temp = control('Temperature', 1, .05, 3, .05, 1);
      const k = control('Top-k', 10, 1, 10, 1, 2);
      const p = control('Top-p', 1, .01, 1, .01, 3);
      const logits = wire(step, add('studyKvLogits', 1, 0), '步数');
      const uncached = wire(step, add('studyKvCounts', 1, 1, { 缓存: 0 }, '重复投影'), '步数');
      const cached = wire(step, add('studyKvCounts', 1, 2, { 缓存: 1 }, '保留 K/V'), '步数');
      const sample = wire(logits, add('studySampling', 2, 0));
      wire(temp, sample, '温度');
      wire(k, sample, 'Top-k');
      wire(p, sample, 'Top-p');
      watch(sample, 3, 0, '当前步候选概率', 'last', 'studyBars');
      watch(sample, 3, 3, '已生成词元', 'out', 'studyTokenView');
      watch(uncached, 2, 1, '逐步累计成本：重复投影', 'out', 'studyBars');
      watch(cached, 2, 2, '逐步累计成本：保留历史 K/V', 'out', 'studyBars');
      return doc;
    }
    case 'dlAutoencoder': {
      const input = add('tokenSeqSource', 0, 0, { seed: 7 });
      const angle = control('子空间旋转', 0, -3.14, 3.14, .05, 1);
      const temp = control('InfoNCE 温度', .5, .05, 5, .05, 2);
      const encoded = wire(input, add('studyEncode', 1, 0));
      wire(angle, encoded, '旋转');
      const decoded = wire(encoded, add('studyDecode', 2, 0), '潜变量');
      wire(encoded, decoded, '基', 'basis');
      const contrast = wire(encoded, add('studyInfoNce', 2, 1));
      wire(temp, contrast, '温度');
      watch(encoded, 3, 0, '二维潜变量', 'out', 'studyCloudPlot');
      watch(decoded, 3, 1, '重建结果');
      watch(contrast, 3, 2, '首样本对候选的概率', 'out', 'studyBars');
      const forces = watch(encoded, 3, 3, 'InfoNCE 负梯度方向', 'out', 'studyVectorPlot');
      wire(contrast, forces, 'vectors', 'grad');
      return doc;
    }
    case 'dlDiffusion': {
      const data = add('dataset2dSource', 0, 0, { kind: 1, samples: 100, noise: .05, seed: 7 });
      const time = control('扩散时间', .4, 0, 4, .02, 1);
      const noise = wire(data, add('studyNoise', 1, 0), '点云');
      wire(time, noise, '时间');
      const score = wire(noise, add('studyScore', 2, 0));
      wire(data, score, '点云');
      wire(time, score, '时间');
      const reverse = wire(noise, add('studyReverse', 3, 0), '含噪点');
      wire(score, reverse, 'score');
      wire(time, reverse, '时间');
      watch(noise, 4, 0, '加噪点', 'out', 'studyCloudPlot');
      const vectors = watch(noise, 4, 1, '解析 score 向量场', 'out', 'studyVectorPlot');
      wire(score, vectors, 'vectors');
      watch(reverse, 4, 2, '反向一步后的点', 'out', 'studyCloudPlot');
      return doc;
    }
    case 'dlOptimizer': {
      const options = [
        ['地形（碗 / 鞍点 / 山谷）', '地形', 0, 0, 2, 1],
        ['起点 x', '起点 x', -1.5, -5, 5, .05], ['起点 y', '起点 y', 1.5, -5, 5, .05],
        ['学习率', '学习率', .05, .001, 1, .001], ['步数', '步数', 60, 0, 200, 1],
      ] as const;
      const run = add('studyOptim', 1, 0);
      options.forEach(([label, port, initial, min, max, step], i) => wire(control(label, initial, min, max, step, i), run, port));
      const view = add('studyTrajectory', 2, 0);
      for (const name of ['SGD', 'Momentum', 'RMSProp', 'Adam']) wire(run, view, name, name);
      panel.view_node_ids.push(view.id);
      return doc;
    }
    case 'dlSvm': {
      const data = add('dataset2dSource', 0, 0, { kind: 1, samples: 100, noise: .12, seed: 7 });
      const map = wire(data, add('studySvmFeatures', 1.2, 0), '点云');
      wire(control('二次特征', 0, 0, 1, 1, 2), map, '二次特征');
      const learner = wire(map, add('svmLab', 2.4, 0, { control: 2, steps: 100, wired: 1 }));
      wire(control('惩罚 C', 2, .01, 20, .1, 3), learner, 'control');
      panel.view_node_ids.push(learner.id);
      watch(learner, 4, 0, '分类超平面权重 (w, b)').params.svmWeights = 1;
      watch(learner, 4, 1, '决策分数 f(x, y)，域 [-2, 2]²', 'field');
      watch(learner, 4, 2, '训练 primal objective', 'history', 'studyCurveView');
      expose(data, 'noise', '数据噪声', 0, .5, .01);
      return doc;
    }
    case 'dlManifold': case 'dlRegularization': {
      const data = add('dataset2dSource', 0, 0, {
        kind: kind === 'dlManifold' ? 3 : 2, samples: 100, noise: kind === 'dlManifold' ? .08 : .22, seed: 7,
      });
      const first = add('studyHiddenLayer', 0, 2, { 宽度: 6, 激活: 3 }, '第一隐层');
      const second = add('studyHiddenLayer', 0, 3, { 宽度: 2, 激活: 3 }, '第二隐层');
      const model = wire(first, add('studyMlpModel', 1, 1), '第一层');
      wire(second, model, '第二层');
      const config = add('studyTrainConfig', 1, 2, { 学习率: .08, Batch: 16, L1: 0, L2: 0, Dropout: 0 });
      const trainer = wire(data, add('mlpTrainer', 2.2, 0, { seed: 7, play: 0, reset: 0, wired: 1 }, 'MLP 训练控制台'));
      wire(model, trainer, 'model');
      wire(config, trainer, 'training');
      const boundary = wire(trainer, add('boundaryView', 3.6, 0, { layer: kind === 'dlManifold' ? 1 : 0 }), 'in', 'boundary');
      const loss = watch(trainer, 3.6, 1, '训练 / 验证损失', 'loss', 'spark');
      wire(trainer, loss, 'validation', 'validationLoss');
      panel.view_node_ids.unshift(boundary.id, trainer.id);
      expose(first, '宽度', '隐层一宽度', 1, 8, 1);
      expose(second, '宽度', '隐层二宽度', 1, 8, 1);
      expose(first, '激活', '隐层一激活（0–4）', 0, 4, 1);
      expose(second, '激活', '隐层二激活（0–4）', 0, 4, 1);
      expose(config, '学习率', '学习率', .001, .5, .001);
      expose(config, 'Batch', 'Batch', 1, 16, 1);
      expose(config, 'L1', 'L1', 0, .05, .001);
      expose(config, 'L2', 'L2', 0, .05, .001);
      expose(config, 'Dropout', 'Dropout', 0, .8, .05);
      expose(boundary, 'layer', '观察层级', 0, 3, 1);
      return doc;
    }
    case 'dlResnet': {
      const tokens = add('tokenSeqSource', 0, 0, { seed: 7 });
      const mode = control('归一化（关 / BN / LN）', 2, 0, 2, 1, 2);
      const stats = add('studyStatsView', 15, 2, {}, '普通堆叠与残差：逐层方差和梯度');
      panel.view_node_ids.push(stats.id);
      for (const residual of [false, true]) {
        const row = residual ? 4 : 0;
        let input = tokens;
        const layers = [0, 1].map((i) => {
          const col = 1.25 + i * 5.3;
          const linear = wire(input, add('linearOp', col, row, { width: 4, seed: 7 + i }));
          const norm = residual ? wire(linear, add('studyNorm', col + 1.25, row)) : linear;
          if (residual) wire(mode, norm, '模式');
          const activation = wire(norm, add('activationOp', col + 2.25, row, { kind: 3 }));
          const out = residual ? wire(activation, add('residualJoin', col + 3.7, row), 'B') : activation;
          if (residual) wire(input, out, 'A');
          input = out;
          return { linear, activation, out };
        });
        let gradient = wire(input, add('studyLossGradient', 12, row));
        for (const i of [1, 0]) {
          const { activation, linear, out } = layers[i]!;
          const back = wire(gradient, add('studyBackprop', 8 + i * 3, row + 2,
            residual ? { residual: 1 } : { 模式: 0 }), '梯度');
          wire(activation, back, '激活');
          wire(linear, back, '预激活');
          wire(linear, back, '权重', 'weights');
          if (residual) wire(mode, back, '模式');
          const measure = wire(out, add('studyLayerStats', 8 + i * 3, row + 3), '激活');
          wire(back, measure, '梯度');
          wire(measure, stats, `${residual ? '残差' : '普通'} ${i + 1}`);
          gradient = back;
        }
      }
      return doc;
    }
    case 'dlQlearning': {
      const environment = add('studyCliff', 1.1, 0, { 每步奖励: -1, 悬崖惩罚: -100, 终点奖励: 20 });
      const learner = wire(environment, add('qLearningLab', 2.3, 0, { seed: 7, episodes: 30, wired: 1 }), 'environment');
      wire(control('探索 ε', .2, 0, 1, .05, 0), learner, 'control');
      wire(control('算法（Q-learning / REINFORCE）', 0, 0, 1, 1, 1), learner, 'mode');
      wire(control('折扣 γ', .95, 0, 1, .01, 2), learner, 'gamma');
      wire(control('学习率 α', .15, .001, 1, .01, 3), learner, 'alpha');
      expose(environment, '悬崖惩罚', '悬崖惩罚', -120, -1, 1);
      expose(environment, '终点奖励', '终点奖励', 1, 60, 1);
      panel.view_node_ids.push(learner.id);
      watch(learner, 4, 0, '策略动作（0–3）', 'policy');
      watch(learner, 4, 1, '回合回报（Episode return）', 'returns', 'studyCurveView');
      watch(learner, 4, 2, '回合步数（Episode steps）', 'steps', 'studyCurveView');
      return doc;
    }
    }
  return doc;
}
