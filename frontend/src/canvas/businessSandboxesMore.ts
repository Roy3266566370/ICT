/** 办公决策全景沙盘（第二批 4 章）：实验统计、库存排队、加权决策、预算组合。 */

import type { CanvasDoc } from './types.ts';
import type { BusinessSandboxKind } from './businessSandboxes.ts';
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  abPowerRule,
  allocCompareRule,
  ciEvolutionRule,
  eoqRule,
  marginalRoiRule,
  matrixCompareRule,
  paretoRule,
  peekTrapRule,
  queueRule,
  stockSimRule,
  weightFlipRule,
} from './businessSandboxRules.ts';

/** biz04 A/B 实验规划与早停陷阱：流量 → 功效曲线/CI 演化/偷看假阳性。 */
function buildAbExperiment(): CanvasDoc {
  const traffic = slider('traffic', '日均总流量（人）', 60, 4000, 500, 50000, 100);
  const abPower = rule('abPower', 430, 40, {
    title: '样本量与功效规划',
    summary: '给定基线转化率与最小可检提升，要多少样本、跑多少天。',
    preferredView: 'chart',
    code: abPowerRule,
    controls: [
      control('traffic', '日均流量（联动滑杆）', 4000, 500, 50000, 100),
      control('baseRate', '对照组转化率', 0.1, 0.01, 0.5, 0.01),
      control('lift', '相对提升', 0.12, 0.01, 0.4, 0.01),
      control('alpha', '显著性 α', 0.05, 0.01, 0.1, 0.01),
    ],
    presets: [
      { label: '小流量长尾', params: { traffic: 1500 } },
      { label: '基准', params: { traffic: 4000 } },
      { label: '大促流量', params: { traffic: 20000 } },
    ],
    presetSource: { param: 'traffic' },
    verificationNote: 'n = ((z_α·σ_null + z_β·σ_alt)/Δ)²；天数 = 2n/日流量。',
  });
  const ci = rule('ci', 430, 300, {
    title: '置信区间演化',
    summary: '95% CI 随 √n 收窄，下沿跨 0 即为显著。',
    preferredView: 'shapes',
    code: ciEvolutionRule,
    controls: [
      control('traffic', '日均流量（联动滑杆）', 4000, 500, 50000, 100),
      control('baseRate', '对照组转化率', 0.1, 0.01, 0.5, 0.01),
      control('lift', '相对提升', 0.12, 0.01, 0.4, 0.01),
    ],
    presets: [
      { label: '小流量长尾', params: { traffic: 1500 } },
      { label: '基准', params: { traffic: 4000 } },
      { label: '大促流量', params: { traffic: 20000 } },
    ],
    presetSource: { param: 'traffic' },
    verificationNote: 'CI 半宽 = 1.96·σ/√n；下沿 >0 时差异显著。',
  });
  const peek = rule('peek', 430, 560, {
    title: '早停陷阱模拟',
    summary: 'A/A 无差异实验每天偷看 p 值，看假阳性率如何飙升。',
    preferredView: 'chart',
    code: peekTrapRule,
    controls: [
      control('traffic', '日均流量（联动滑杆）', 4000, 500, 50000, 100),
      control('sims', '模拟实验次数', 300, 100, 500, 50),
      control('seed', '随机种子', 11, 1, 999, 1),
    ],
    presets: [
      { label: '种子 11', params: { seed: 11 } },
      { label: '种子 42', params: { seed: 42 } },
      { label: '高频偷看', params: { seed: 7, sims: 500, traffic: 20000 } },
    ],
    presetSource: { param: 'traffic' },
    verificationNote: '部分和过程模拟累计 z 值首越 1.96 的比例——显著高于名义 5%。',
  });
  return board('A/B 实验规划与早停陷阱',
    [traffic, abPower, ci, peek],
    [
      ['traffic', 'abPower'],
      ['traffic', 'ci'],
      ['traffic', 'peek'],
    ],
    ['abPower', 'ci', 'peek'],
    [sliderParam(traffic)]);
}

/** biz06 库存补货与服务排队：需求 → EOQ/库存模拟；客服数 → 排队等待。 */
function buildInventoryQueue(): CanvasDoc {
  const demand = slider('demand', '日均需求（件）', 60, 120, 40, 300, 5);
  const agents = slider('agents', '客服坐席数（人）', 300, 4, 1, 8, 1);
  const eoq = rule('eoq', 430, 40, {
    title: 'EOQ 经济订货批量',
    summary: '订货费与持有费权衡的 U 型总成本曲线。',
    preferredView: 'chart',
    code: eoqRule,
    controls: [
      control('demand', '日均需求（联动滑杆）', 120, 40, 300, 5),
      control('orderCost', '单次订货费（元）', 300, 50, 2000, 10),
      control('holdCost', '年持有费（元/件）', 6, 1, 30, 0.5),
    ],
    verificationNote: 'EOQ = √(2·D·K/h)；TC(Q) = D/Q·K + Q/2·h。',
  });
  const stock = rule('stock', 430, 300, {
    title: '库存锯齿模拟',
    summary: '随机日需求 + 再订点补货，看安全库存挡不挡得住缺货。',
    preferredView: 'chart',
    code: stockSimRule,
    controls: [
      control('demand', '日均需求（联动滑杆）', 120, 40, 300, 5),
      control('sd', '需求波动 σ', 30, 5, 100, 5),
      control('reorderQ', '补货批量', 400, 100, 1000, 50),
      control('rop', '再订点（安全库存）', 300, 50, 800, 25),
      control('leadTime', '到货提前期（天）', 3, 1, 7, 1),
      control('days', '模拟天数', 40, 20, 60, 5),
      control('seed', '随机种子', 5, 1, 999, 1),
    ],
    presets: [
      { label: '稳妥库存', params: { rop: 500, reorderQ: 500, seed: 5 } },
      { label: '压库存冒险', params: { rop: 150, reorderQ: 300, seed: 5 } },
      { label: '高波动考验', params: { sd: 80, rop: 300, seed: 5 } },
    ],
    presetSource: { param: 'demand' },
    verificationNote: '库存≤再订点即下单，lead 天后到货；服务水平 = 1-缺货天数占比。',
  });
  const queue = rule('queue', 430, 560, {
    title: '服务台排队等待',
    summary: 'M/M/s 排队：人数 vs 利用率，逼近 100% 等待爆炸。',
    preferredView: 'chart',
    code: queueRule,
    controls: [
      control('agents', '坐席数（联动滑杆）', 4, 1, 8, 1),
      control('lambda', '到达率 λ（/时）', 20, 5, 60, 1),
      control('mu', '单席服务率 μ（/时）', 8, 2, 20, 0.5),
      control('maxS', '曲线最大坐席', 8, 3, 10, 1),
    ],
    presets: [
      { label: '坐席不足 s=2', params: { agents: 2 } },
      { label: '刚好 s=3', params: { agents: 3 } },
      { label: '富余 s=5', params: { agents: 5 } },
    ],
    presetSource: { param: 'agents' },
    verificationNote: 'ρ=λ/(sμ) ≥1 时队列发散；Erlang C 给出平均排队等待。',
  });
  return board('库存补货与服务排队',
    [demand, agents, eoq, stock, queue],
    [
      ['demand', 'eoq'],
      ['demand', 'stock'],
      ['agents', 'queue'],
    ],
    ['eoq', 'stock', 'queue'],
    [sliderParam(demand), sliderParam(agents)]);
}

/** biz07 多方案加权决策与翻转分析：成本权重 → 决策卡/翻转曲线/四维对比。 */
function buildDecisionMatrix(): CanvasDoc {
  const costW = slider('costW', '成本权重 w（0–1）', 60, 0.25, 0, 1, 0.01);
  const matrix = node('matrix', 'bizDecisionMatrix', 40, 300, {});
  const flip = rule('flip', 430, 40, {
    title: '权重敏感性 · 翻转点',
    summary: '方案得分随成本权重变化，标出第一名易主的阈值。',
    preferredView: 'chart',
    code: weightFlipRule,
    controls: [control('costW', '成本权重（联动滑杆）', 0.25, 0, 1, 0.01)],
    presets: [
      { label: '重成本 w=0.6', params: { costW: 0.6 } },
      { label: '均衡 w=0.25', params: { costW: 0.25 } },
      { label: '轻成本 w=0.1', params: { costW: 0.1 } },
    ],
    presetSource: { param: 'costW' },
    verificationNote: '成本权重 w，其余三维均分 (1-w)/3；扫描 0–1 找排名翻转。',
  });
  const compare = rule('compare', 430, 300, {
    title: '四维方案对比',
    summary: '成本/工期/风险/收益四维打分与加权排名。',
    preferredView: 'shapes',
    code: matrixCompareRule,
    controls: [control('costW', '成本权重（联动滑杆）', 0.25, 0, 1, 0.01)],
    presets: [
      { label: '重成本 w=0.6', params: { costW: 0.6 } },
      { label: '均衡 w=0.25', params: { costW: 0.25 } },
      { label: '轻成本 w=0.1', params: { costW: 0.1 } },
    ],
    presetSource: { param: 'costW' },
    verificationNote: '加权得分 = Σ 维度分×权重；第一名随 w 变化会翻转。',
  });
  return board('多方案加权决策与翻转分析',
    [costW, matrix, flip, compare],
    [
      ['costW', 'matrix', 'cost'],
      ['costW', 'flip'],
      ['costW', 'compare'],
    ],
    ['matrix', 'flip', 'compare'],
    [sliderParam(costW)]);
}

/** biz08 多渠道预算分配与边际收益：总预算 → 边际 ROI/平分对比/帕累托前沿。 */
function buildBudgetPortfolio(): CanvasDoc {
  const budget = slider('budget', '总预算（万元）', 60, 90, 30, 300, 5);
  const mroi = rule('mroi', 430, 40, {
    title: '边际 ROI 递减',
    summary: '三条渠道的边际收益递减曲线与边际相等分配点。',
    preferredView: 'chart',
    code: marginalRoiRule,
    controls: [control('budget', '总预算（联动滑杆）', 90, 30, 300, 5)],
    presets: [
      { label: '紧缩 60 万', params: { budget: 60 } },
      { label: '基准 90 万', params: { budget: 90 } },
      { label: '扩张 180 万', params: { budget: 180 } },
    ],
    presetSource: { param: 'budget' },
    verificationNote: '收益 = a·(1-e^-kx)·100；最优解各渠道边际 ROI 相等。',
  });
  const alloc = rule('alloc', 430, 300, {
    title: '平分 vs 边际最优',
    summary: '三等分预算与边际相等分配的累计收益对比。',
    preferredView: 'shapes',
    code: allocCompareRule,
    controls: [control('budget', '总预算（联动滑杆）', 90, 30, 300, 5)],
    presets: [
      { label: '紧缩 60 万', params: { budget: 60 } },
      { label: '基准 90 万', params: { budget: 90 } },
      { label: '扩张 180 万', params: { budget: 180 } },
    ],
    presetSource: { param: 'budget' },
    verificationNote: '边际最优 ≥ 平分；差距随预算与渠道间斜率差扩大。',
  });
  const pareto = rule('pareto', 430, 560, {
    title: '组合帕累托前沿',
    summary: '进攻/稳健两资产按不同比例混合的收益-波动散点。',
    preferredView: 'shapes',
    code: paretoRule,
    controls: [
      control('budget', '总预算（联动滑杆）', 90, 30, 300, 5),
      control('corr', '资产相关系数 ρ', 0.1, -0.9, 0.9, 0.1),
    ],
    presets: [
      { label: '低相关 ρ=0.1', params: { corr: 0.1 } },
      { label: '负相关对冲', params: { corr: -0.5, budget: 60 } },
      { label: '高相关 ρ=0.7', params: { corr: 0.7 } },
    ],
    presetSource: { param: 'budget' },
    verificationNote: 'σ_p² = w²σ_A²+(1-w)²σ_B²+2w(1-w)σ_Aσ_Bρ；最小方差点标注。',
  });
  return board('多渠道预算分配与边际收益',
    [budget, mroi, alloc, pareto],
    [
      ['budget', 'mroi'],
      ['budget', 'alloc'],
      ['budget', 'pareto'],
    ],
    ['mroi', 'alloc', 'pareto'],
    [sliderParam(budget)]);
}

export const BUSINESS_SANDBOX_MORE: Record<string, () => CanvasDoc> = {
  'biz04-ab-experiment': buildAbExperiment,
  'biz06-inventory-queue': buildInventoryQueue,
  'biz07-decision-matrix': buildDecisionMatrix,
  'biz08-budget-portfolio': buildBudgetPortfolio,
};
