import { activation, clamp, tensor, traces, weights, type Matrix, type Trace } from './deepCore.ts';
import { dfAttention, dfSoftmax, dfCacheCounts, dfOptimRun, dfCacheLogits, dfSampleDistribution } from './deepFirst.ts';
import { normalize as normalization, rope, sequenceModel, linearAutoencoder, infoNCE, diffusionMixture, diffusionForward, mixtureScore } from './deepAdvanced.ts';
import type { CanvasNode, PortSpec, PortValue } from './types.ts';

const t = (id: string): PortSpec => ({ id, label: id, kind: 'tensor2d' });
const scalar = (id: string): PortSpec => ({ id, label: id, kind: 'scalar' });
const cloud = (id: string): PortSpec => ({ id, label: id, kind: 'dataset2d' });
export const studyStages = {
  studyNorm: { title: '批归一化 / 层归一化', inputs: [t('in'), scalar('模式')], outputs: [t('out')] },
  studyLossGradient: { title: '均方误差的输出梯度', inputs: [t('in')], outputs: [t('out')] },
  studyBackprop: { title: '反传一层', inputs: [t('梯度'), t('激活'), t('预激活'), t('权重'), scalar('模式')],
    outputs: [t('out')] },
  studyLayerStats: { title: '方差与梯度模长', inputs: [t('激活'), t('梯度')], outputs: [t('out')] },
  studyStatsView: { title: '逐层方差与梯度', inputs: ['普通 1','普通 2','残差 1','残差 2'].map(t), outputs: [] },
  studyCloudPlot: { title: '二维点云观察', inputs: [t('in')], outputs: [] },
  studyVectorPlot: { title: '二维向量场观察', inputs: [t('in'), t('vectors')], outputs: [] },
  studyBars: { title: '数值柱状图', inputs: [t('in')], outputs: [] },
  studyTrajectory: { title: '四种优化器轨迹', inputs: [t('SGD'), t('Momentum'), t('RMSProp'), t('Adam')], outputs: [] },
  studyOptim: { title: '优化器更新轨迹', inputs: [scalar('地形'), scalar('起点 x'), scalar('起点 y'), scalar('学习率'), scalar('步数')],
    outputs: [t('SGD'), t('Momentum'), t('RMSProp'), t('Adam')] },
  studyHiddenLayer: { title: '可训练线性层与激活', inputs: [scalar('宽度'), scalar('激活')], outputs: [t('out')] },
  studyMlpModel: { title: 'MLP 层结构', inputs: [t('第一层'), t('第二层')], outputs: [t('out')] },
  studyTrainConfig: { title: '训练配置', inputs: [scalar('学习率'), scalar('Batch'), scalar('L1'), scalar('L2'), scalar('Dropout')], outputs: [t('out')] },
  studyCliff: { title: '6×6 悬崖环境', inputs: [scalar('每步奖励'), scalar('悬崖惩罚'), scalar('终点奖励')], outputs: [t('out')] },
  studySvmFeatures: { title: 'SVM 特征映射', inputs: [cloud('点云'), scalar('二次特征')], outputs: [cloud('out')] },
  studyTokens: { title: '共享注意力输入', inputs: [scalar('维度')], outputs: [t('out')] },
  studyProjection: { title: 'Q / K / V 投影', inputs: [t('in'), scalar('种子')], outputs: [t('out')] },
  studyScores: { title: '打分 QKᵀ', inputs: [t('Q'), t('K')], outputs: [t('out')] },
  studyScale: { title: '缩放 √dₖ', inputs: [t('in'), t('K')], outputs: [t('out')] },
  studyMask: { title: '因果掩码', inputs: [t('in'), scalar('启用')], outputs: [t('out')] },
  studySoftmax: { title: '逐行 Softmax', inputs: [t('in')], outputs: [t('out')] },
  studyWeighted: { title: '注意力加权输出', inputs: [t('权重'), t('V')], outputs: [t('out')] },
  studyHead: { title: '拆分注意力头', inputs: [t('in'), scalar('头')], outputs: [t('out')] },
  studyReversePair: { title: '交换 K 特征对', inputs: [t('in')], outputs: [t('out')] },
  studyPosition: { title: '正弦位置编码 / RoPE', inputs: [t('in'), scalar('模式'), scalar('偏移')], outputs: [t('out')] },
  studyConcat: { title: '合并注意力头', inputs: [t('头一'), t('头二')], outputs: [t('out')] },
  studyPool: { title: '最大池化 2×2', inputs: [t('in'), scalar('启用')], outputs: [t('out')] },
  studyActivation: { title: '激活和局部导数', inputs: [scalar('输入'), scalar('激活')], outputs: [t('out')] },
  studyGradient: { title: '十层梯度连乘', inputs: [t('in'), scalar('逐层前传')], outputs: [t('out')] },
  studyRnn: { title: 'RNN 状态与敏感度', inputs: [t('in'), scalar('循环权重')], outputs: [t('out')] },
  studyLstm: { title: 'LSTM 记忆与敏感度', inputs: [t('in'), scalar('遗忘门')], outputs: [t('out')] },
  studyRetrieve: { title: '末词注意力检索', inputs: [t('in')], outputs: [t('out')] },
  studyKvLogits: { title: '当前词元候选', inputs: [scalar('步数')], outputs: [t('out')] },
  studyKvCounts: { title: '累计投影成本', inputs: [scalar('步数'), scalar('缓存')], outputs: [t('out')] },
  studySampling: { title: '温度与 Top-k / Top-p', inputs: [t('in'), scalar('温度'), scalar('Top-k'), scalar('Top-p')], outputs: [t('out'), t('last')] },
  studyTokenView: { title: '自回归生成词元', inputs: [t('in')], outputs: [] },
  studyEncode: { title: '线性编码器', inputs: [t('in'), scalar('旋转')], outputs: [t('out'), t('basis')] },
  studyDecode: { title: '共享基解码器', inputs: [t('潜变量'), t('基')], outputs: [t('out')] },
  studyInfoNce: { title: 'InfoNCE 正负样本', inputs: [t('in'), scalar('温度')], outputs: [t('out'), t('grad'), scalar('loss')] },
  studyNoise: { title: '扩散前向加噪', inputs: [cloud('点云'), scalar('时间')], outputs: [t('out')] },
  studyScore: { title: '解析 score 向量', inputs: [cloud('点云'), t('in'), scalar('时间')], outputs: [t('out')] },
  studyReverse: { title: '反向 Euler 一步', inputs: [t('含噪点'), t('score'), scalar('时间')], outputs: [t('out')] },
} as const;
export type StudyStage = keyof typeof studyStages;

export function isStudyStage(type: string): type is StudyStage {
  return Object.hasOwn(studyStages, type);
}

function product(a: Matrix, b: Matrix): Matrix | null {
  if (a[0]?.length !== b.length || !b[0]) return null;
  return a.map((row) => b[0]!.map((_, c) =>
    row.reduce((sum, value, i) => sum + value * b[i]![c]!, 0)));
}
const transpose = (a: Matrix): Matrix => a[0]?.map((_, c) => a.map((r) => r[c]!)) ?? [];

function maxPool(a: Matrix): Matrix {
  const previous = traces.get(a);
  const poolTrace: Trace[][] = [];
  const result = Array.from({ length: Math.floor(a.length / 2) }, (_, y) => {
    const row: Trace[] = [];
    poolTrace.push(row);
    return Array.from({ length: Math.floor(a[0]!.length / 2) }, (_, x) => {
      const cells = [[2*y, 2*x], [2*y, 2*x+1], [2*y+1, 2*x], [2*y+1, 2*x+1]] as const;
      const values = cells.map(([r,c]) => a[r]![c]!);
      const children = cells.flatMap(([r,c]) => previous?.[r]?.[c] ? [previous[r]![c]!] : []);
      const value = Math.max(...values);
      row.push({ row: y, col: x, value, children, expression: `max(${values.join(', ')}) = ${value}`,
        sources: [...new Set(cells.flatMap(([r,c]) => previous?.[r]?.[c]?.sources ?? [`${r},${c}`]))] });
      return value;
    });
  });
  traces.set(result, poolTrace);
  return result;
}

export function studyOutput(node: CanvasNode, input: (port: string) => PortValue | null, port: string): PortValue | null {
  if (!isStudyStage(node.type) || !studyStages[node.type].outputs.some((output) => output.id === port)) return null;
  const matrix = (name: string) => { const v = input(name); return v?.kind === 'tensor2d' ? v.data : null; };
  const number = (name: string) => { const v = input(name); return v?.kind === 'scalar' ? v.v : null; };
  const a = matrix('in');
  const step = number('步数');
  const time = number('时间');
  const mode = number('模式');
  const offset = number('偏移');
  const points = input('点云');
  const mixture = () => diffusionMixture(false, points?.kind === 'dataset2d' ? points.points : undefined);
  const feature = (name: string) => number(name) ?? node.params[name] ?? null;
  switch (node.type) {
    case 'studyNorm': return a && mode !== null
      ? tensor(normalization(a, mode === 1 ? 'BN' : mode === 2 ? 'LN' : 'none').y) : null;
    case 'studyLossGradient': return a ? tensor(a.map((row, i) => row.map((value, j) =>
      (value - .3 * Math.sin(i + 2 * j + 1)) / (a.length * row.length)))) : null;
    case 'studyBackprop': {
      const grad = matrix('梯度'), activation = matrix('激活'), z = matrix('预激活'), w = matrix('权重');
      const normMode = mode ?? node.params['模式'];
      if (!grad || !activation || !z || !w || normMode === undefined
          || grad.length !== activation.length || grad.length !== z.length
          || grad[0]?.length !== activation[0]?.length || z[0]?.length !== grad[0]?.length
          || w[0]?.length !== grad[0]?.length || (node.params.residual && w.length !== grad[0]?.length)) return null;
      const dy = grad.map((row, i) => row.map((v, j) => v * (1 - activation[i]![j]! ** 2)));
      const dx = product(normalization(z, normMode === 1 ? 'BN' : normMode === 2 ? 'LN' : 'none').backward(dy), transpose(w));
      return dx ? tensor(dx.map((row, i) => row.map((v, j) => v + (node.params.residual ? grad[i]![j]! : 0)))) : null;
    }
    case 'studyLayerStats': {
      const values = matrix('激活')?.flat(), grad = matrix('梯度');
      if (!values?.length || !grad) return null;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return tensor([[variance, Math.hypot(...grad.flat())]]);
    }
    case 'studyStatsView': case 'studyTokenView': return null;
    case 'studyOptim': {
      const config = studyStages.studyOptim.inputs.map(({ id }) => number(id));
      if (config.some((v) => v === null)) return null;
      const [terrain, x, y, lr, steps] = config as [number, number, number, number, number];
      const run = dfOptimRun({ terrain, x, y, lr, steps }).find((item) => item.kind === port);
      if (!run) return null;
      const count = Math.min(16, run.path.length);
      return tensor(Array.from({ length: count }, (_, i) => {
        const point = run.path[Math.round(i / Math.max(1, count - 1) * (run.path.length - 1))]!;
        return [point.x, point.y];
      }));
    }
    case 'studyTrajectory': case 'studyCloudPlot': case 'studyVectorPlot': case 'studyBars': return null;
    case 'studyHiddenLayer': {
      const width = feature('宽度'), kind = feature('激活');
      return width !== null && kind !== null ? tensor([[Math.round(clamp(width, 1, 8)), Math.round(clamp(kind, 0, 4))]]) : null;
    }
    case 'studyMlpModel': {
      const a = matrix('第一层'), b = matrix('第二层');
      return a?.length === 1 && b?.length === 1 && a[0]?.length === 2 && b[0]?.length === 2
        ? tensor([[a[0][0]!, b[0][0]!, a[0][1]!, b[0][1]!]]) : null;
    }
    case 'studyTrainConfig': {
      // Tensor descriptors are immutable once emitted and replayable from saved inputs.
      const config = studyStages[node.type].inputs.map(({ id }) => feature(id));
      return config.every((value) => value !== null) ? tensor([config as number[]]) : null;
    }
    case 'studyCliff': {
      const normal = feature('每步奖励'), cliff = feature('悬崖惩罚'), goal = feature('终点奖励');
      if (normal === null || cliff === null || goal === null) return null;
      return tensor(Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) =>
        y !== 5 || x === 0 ? normal : x === 5 ? goal : cliff)));
    }
    case 'studySvmFeatures': {
      const quadratic = number('二次特征');
      return points?.kind === 'dataset2d' && quadratic !== null
        ? { ...points, featureMap: quadratic ? 'quadratic' : 'linear' } : null;
    }
    case 'studyTokens': {
      const dimension = number('维度');
      if (dimension === null) return null;
      return tensor(dfAttention(clamp(dimension, 2, 16)).q);
    }
    case 'studyProjection': {
      const seed = feature('种子');
      if (!a || seed === null) return null;
      const width = a[0]!.length;
      const result = product(a, weights(width, width, Math.round(seed), true));
      return result ? tensor(result) : null;
    }
    case 'studyScores': {
      const q = matrix('Q'), k = matrix('K');
      const result = q && k && product(q, transpose(k));
      return result ? tensor(result) : null;
    }
    case 'studyScale': {
      const k = matrix('K');
      return a && k && a[0]?.length === k.length ? tensor(a.map((row) => row.map((v) => v / Math.sqrt(k[0]!.length)))) : null;
    }
    case 'studyMask': {
      const enabled = number('启用');
      return a && enabled !== null ? tensor(enabled ? a.map((row, i) => row.map((v, j) => j <= i ? v : -1e6)) : a) : null;
    }
    case 'studySoftmax': return a ? tensor(a.map(dfSoftmax)) : null;
    case 'studyWeighted': {
      const w = matrix('权重'), v = matrix('V');
      const result = w && v && product(w, v);
      return result ? tensor(result) : null;
    }
    case 'studyHead': {
      const head = feature('头');
      return a && head !== null && a[0]!.length % 2 === 0
        ? tensor(a.map((row) => { const width = row.length / 2; return row.slice(head ? width : 0, head ? row.length : width); })) : null;
    }
    case 'studyReversePair': return a ? tensor(a.map((row) => [...row].reverse())) : null;
    case 'studyPosition': return a && mode !== null && offset !== null
      ? tensor(a.map((row, i) => mode ? rope(row, i + offset)
        : row.map((v, j) => v + (node.params.key ? 0 : (j % 2 ? Math.cos : Math.sin)((i + offset) / 10000 ** ((j - j % 2) / row.length)))))) : null;
    case 'studyConcat': {
      const first = matrix('头一'), second = matrix('头二');
      return first && second && first.length === second.length ? tensor(first.map((row, i) => [...row, ...second[i]!])) : null;
    }
    case 'studyPool': {
      const enabled = number('启用');
      return a && enabled !== null ? tensor(enabled ? maxPool(a) : a) : null;
    }
    case 'studyActivation': {
      const x = number('输入'), kind = number('激活');
      return x === null || kind === null ? null : tensor([[x, kind, ...activation(x, kind)]]);
    }
    case 'studyGradient': {
      const mode = number('逐层前传');
      if (!a || a.length !== 1 || a[0]!.length !== 4 || mode === null) return null;
      const [x, kind, first, local] = a[0]! as [number, number, number, number];
      let inputValue = x, derivativeProduct = 1;
      return tensor(Array.from({ length: 10 }, (_, i) => {
        const [value, derivative] = i === 0 || !mode ? [first, local] : activation(inputValue, kind);
        derivativeProduct *= derivative;
        const row = [inputValue, value, derivative, derivativeProduct];
        if (mode) inputValue = value;
        return row;
      }));
    }
    case 'studyRnn': case 'studyLstm': case 'studyRetrieve': {
      if (!a) return null;
      const xs = a.map((row) => row[0]!);
      const result = sequenceModel(xs, number('循环权重') ?? undefined, number('遗忘门') ?? undefined);
      if (node.type === 'studyRnn') return tensor(result.rnn.map((v, i) => [v, result.rnnSensitivity[i]!]));
      if (node.type === 'studyLstm') return tensor(result.lstm.map((v, i) => [v, result.lstmSensitivity[i]!]));
      return tensor([result.attention]);
    }
    case 'studyKvLogits': return step === null ? null : tensor(
      Array.from({ length: Math.round(clamp(step, 1, 8)) }, (_, i) => dfCacheLogits(i + 1)));

    case 'studyKvCounts': {
      const cache = feature('缓存');
      if (step === null || cache === null) return null;
      return tensor(Array.from({ length: Math.round(clamp(step, 1, 8)) }, (_, i) => {
        const counts = dfCacheCounts(i + 1);
        return [cache ? counts.totalWith : counts.totalWithout];
      }));
    }
    case 'studySampling': {
      const temp = number('温度'), k = number('Top-k'), p = number('Top-p');
      if (!a || temp === null || k === null || p === null) return null;
      const rows = (port === 'last' ? a.slice(-1) : a).map((row) => dfSampleDistribution(row, temp, k, p).probabilities);
      return tensor(rows);
    }
    case 'studyEncode': {
      const angle = number('旋转');
      if (!a || angle === null) return null;
      const result = linearAutoencoder(a, angle);
      return tensor(port === 'basis' ? result.basis : result.latent);
    }
    case 'studyDecode': {
      const latent = matrix('潜变量'), basis = matrix('基');
      const result = latent && basis && product(latent, basis);
      return result ? tensor(result) : null;
    }
    case 'studyInfoNce': {
      const temp = number('温度');
      if (!a || a.length < 3 || temp === null) return null;
      const result = infoNCE(a[0]!, a.slice(1), temp);
      if (port === 'grad') return tensor([result.gradient, ...result.candidateGradients].map((row) => row.map((v) => -v)));
      return port === 'loss' ? { kind: 'scalar', v: result.loss } : tensor([result.probabilities]);
    }
    case 'studyNoise': return points?.kind === 'dataset2d' && time !== null
      ? tensor(diffusionForward(time, 7, mixture()).slice(0, 16)) : null;
    case 'studyScore': return a && a[0]?.length === 2 && points?.kind === 'dataset2d' && time !== null
      ? tensor(a.map((row) => mixtureScore(row, time, mixture()).score)) : null;
    case 'studyReverse': {
      const x = matrix('含噪点'), score = matrix('score');
      return x && score && time !== null && x.length === score.length && x[0]?.length === score[0]?.length
        ? tensor(x.map((row, i) => row.map((v, j) => v + 1.5 * clamp(time, 0, .02) * (v + score[i]![j]!)))) : null;
    }
  }
}
