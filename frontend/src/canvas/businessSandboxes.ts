/** 办公决策全景沙盘（第一批旗舰 4 章）：一源多路、确定性、可编辑。
 *
 * 每章把共享业务假设（价格/增长/现金流/延期/人力上限）接到多个视图：
 * 办公积木（bizTableSource/bizGrowthSource/bizScenarioFork/bizDiscountOp/bizWaterfallView）
 * 与 aiRuleBlock 确定性规则（grid/shapes/timeline/chart/graph + rand() 蒙特卡洛）。
 * `board()` 统一收口 nodes/wires + 仪器面板契约。
 */

import type { CanvasDoc } from './types.ts';
import { board, control, node, rule, slider, sliderParam } from './calculusSandboxDoc.ts';
import {
  cohortGridRule,
  depGraphRule,
  funnelRule,
  ganttRule,
  loadRule,
  ltvCurveRule,
  mcRiskRule,
  paybackRule,
  sensGridRule,
} from './businessSandboxRules.ts';
import { BUSINESS_SANDBOX_MORE } from './businessSandboxesMore.ts';

export type BusinessSandboxKind =
  | 'biz01-unit-economics' | 'biz02-investment-npv' | 'biz03-growth-cohort' | 'biz04-ab-experiment'
  | 'biz05-cpm-delivery' | 'biz06-inventory-queue' | 'biz07-decision-matrix' | 'biz08-budget-portfolio';

const CASHFLOW_BASE = '月份,现金流\n1月,180000\n2月,165000\n3月,210000\n4月,195000\n5月,230000\n6月,205000\n7月,240000\n8月,225000\n9月,255000\n10月,235000\n11月,260000\n12月,250000';
const CASHFLOW_GROWTH = '月份,现金流\n1月,90000\n2月,120000\n3月,160000\n4月,210000\n5月,270000\n6月,330000\n7月,390000\n8月,450000\n9月,510000\n10月,560000\n11月,610000\n12月,660000';
const CASHFLOW_DECLINE = '月份,现金流\n1月,120000\n2月,140000\n3月,110000\n4月,160000\n5月,130000\n6月,150000\n7月,170000\n8月,150000\n9月,180000\n10月,160000\n11月,190000\n12月,170000';

/** biz01 经营盈亏、定价与敏感性热图：price 滑杆 + 增长销量 → 瀑布/热图/回本三视图。 */
function buildUnitEconomics(): CanvasDoc {
  const price = slider('price', '客单价（元）', 60, 120, 50, 300, 5);
  const growth = node('growth', 'bizGrowthSource', 40, 300,
    { initial: 2500, rate: 0.08, months: 12, seasonality: 0.1 });
  const sensGrid = rule('sensGrid', 430, 40, {
    title: '敏感性热图：价格×成本率',
    summary: '拖动客单价或调变动成本率，看月净利在二维平面上何处转亏。',
    preferredView: 'grid',
    code: sensGridRule,
    controls: [
      control('price', '客单价（联动滑杆）', 120, 50, 300, 5),
      control('varRate', '变动成本率', 0.35, 0.1, 0.8, 0.01),
      control('fixedCost', '月固定开销（元）', 200000, 50000, 1000000, 5000),
      control('adBudget', '月营销预算（元）', 50000, 0, 500000, 5000),
      control('monthlySales', '基准月销量（单）', 2500, 500, 10000, 100),
    ],
    presets: [
      { label: '低价走量', params: { price: 80, monthlySales: 3200 } },
      { label: '基准经营', params: { price: 120, monthlySales: 2500 } },
      { label: '高端提价', params: { price: 200, monthlySales: 1600 } },
    ],
    presetSource: { param: 'price' },
    verificationNote: '月净利 = 客单价×(1-变动成本率)×销量 - 固定开销 - 营销预算。',
  });
  const waterfall = node('waterfall', 'bizWaterfallView', 430, 340);
  const payback = rule('payback', 430, 540, {
    title: '累计净利与回本',
    summary: '销量序列 × 单笔贡献毛利 - 月固定开销，看累计曲线第几期转正。',
    preferredView: 'chart',
    code: paybackRule,
    auxiliaryKind: 'scalar',
    controls: [
      control('price', '客单价（联动滑杆）', 120, 50, 300, 5),
      control('varRate', '变动成本率', 0.35, 0.1, 0.8, 0.01),
      control('fixedCost', '月固定开销（元）', 200000, 50000, 1000000, 5000),
      control('adBudget', '月营销预算（元）', 50000, 0, 500000, 5000),
    ],
    presets: [
      { label: '降本增效', params: { varRate: 0.25, adBudget: 30000 } },
      { label: '基准', params: { varRate: 0.35, adBudget: 50000 } },
      { label: '加码投放', params: { varRate: 0.35, adBudget: 140000 } },
    ],
    verificationNote: '盈亏平衡销量 = (固定+营销) / 单笔贡献毛利；累计净利首次 ≥0 的期即回本。',
  });
  return board('经营盈亏、定价与敏感性热图',
    [price, growth, sensGrid, waterfall, payback],
    [
      ['price', 'sensGrid'],
      ['price', 'payback', 'aux'],
      ['growth', 'waterfall'],
      ['growth', 'payback'],
    ],
    ['sensGrid', 'payback', 'waterfall'],
    [sliderParam(price)]);
}

/** biz02 投资立项 NPV 与压力测试：现金流表 → 情景分叉 / 折现 / 蒙特卡洛。 */
function buildInvestmentNpv(): CanvasDoc {
  const wacc = slider('wacc', '年折现率（0.04–0.20）', 60, 0.1, 0.04, 0.2, 0.005);
  const cashflow = node('cashflow', 'bizTableSource', 40, 300, { sample: -1 }, CASHFLOW_BASE);
  const fork = node('fork', 'bizScenarioFork', 40, 560, { spread: 0.15, drift: 0.01 });
  const discount = node('discount', 'bizDiscountOp', 430, 300, { rate: 0.1, investment: 1500000 });
  const mcRisk = rule('mcRisk', 430, 40, {
    title: '蒙特卡洛 NPV 风险',
    summary: '每期现金流在 ±波动幅度内随机冲击，看 NPV 分布与亏损概率。',
    preferredView: 'chart',
    code: mcRiskRule,
    auxiliaryKind: 'scalar',
    controls: [
      control('wacc', '年折现率（联动滑杆）', 0.1, 0.04, 0.2, 0.005),
      control('investment', '期初投入（元）', 1500000, 100000, 5000000, 50000),
      control('spread', '现金流波动幅度', 0.25, 0.05, 0.8, 0.05),
      control('sims', '模拟次数', 500, 100, 800, 50),
      control('seed', '随机种子', 7, 1, 999, 1),
    ],
    presets: [
      { label: '平稳现金流', text: CASHFLOW_BASE, params: { spread: 0.2 } },
      { label: '高增长扩张', text: CASHFLOW_GROWTH, params: { spread: 0.35 } },
      { label: '低现金流压力', text: CASHFLOW_DECLINE, params: { spread: 0.4 } },
    ],
    presetSource: 'text',
    verificationNote: 'NPV = -投入 + Σ 现金流×(1±波动) / (1+r/12)^t；换现金流文本可整体换情景。',
  });
  return board('投资立项 NPV 与压力测试',
    [wacc, cashflow, fork, discount, mcRisk],
    [
      ['wacc', 'discount', 'rate'],
      ['wacc', 'mcRisk', 'aux'],
      ['cashflow', 'fork'],
      ['cashflow', 'mcRisk'],
      ['fork', 'discount'],
    ],
    ['discount', 'mcRisk', 'fork'],
    [sliderParam(wacc)]);
}

/** biz03 增长漏斗与 Cohort 留存复利：留存/付费率 → 漏斗/热图/LTV 三视图。 */
function buildGrowthCohort(): CanvasDoc {
  const retention = slider('retention', '周留存率', 60, 0.65, 0.3, 0.9, 0.01);
  const payRate = slider('payRate', '付费转化率', 220, 0.08, 0.02, 0.2, 0.005);
  const funnel = rule('funnel', 430, 40, {
    title: '增长漏斗定位瓶颈',
    summary: '曝光→点击→注册→付费→复购，找出流失最严重的一层。',
    preferredView: 'shapes',
    code: funnelRule,
    controls: [
      control('payRate', '付费转化率（联动滑杆）', 0.08, 0.02, 0.2, 0.005),
      control('impressions', '每周曝光', 200000, 10000, 1000000, 10000),
      control('ctr', '点击率', 0.05, 0.01, 0.2, 0.005),
      control('regRate', '注册率', 0.25, 0.05, 0.6, 0.01),
      control('retention', '复购留存', 0.65, 0.3, 0.9, 0.01),
    ],
    presets: [
      { label: '冷启动低转化', params: { payRate: 0.04 } },
      { label: '基准', params: { payRate: 0.08 } },
      { label: '爆款高转化', params: { payRate: 0.15 } },
    ],
    presetSource: { param: 'payRate' },
    verificationNote: '付费用户数 = 曝光 × 点击率 × 注册率 × 付费转化率。',
  });
  const cohort = rule('cohort', 430, 260, {
    title: 'Cohort 留存热图',
    summary: '每周新客按周龄衰减 r^t，看 12 周还剩多少。',
    preferredView: 'grid',
    code: cohortGridRule,
    controls: [
      control('retention', '周留存率（联动滑杆）', 0.65, 0.3, 0.9, 0.01),
      control('weeks', '周数', 12, 8, 12, 1),
    ],
    presets: [
      { label: '流失型 r=45%', params: { retention: 0.45 } },
      { label: '基准 r=65%', params: { retention: 0.65 } },
      { label: '高粘 r=85%', params: { retention: 0.85 } },
    ],
    presetSource: { param: 'retention' },
    verificationNote: '周龄 a 的存活率 = r^a；半衰期 = ln(0.5)/ln(r)。',
  });
  const ltv = rule('ltv', 430, 490, {
    title: 'LTV 与复利杠杆',
    summary: '留存 +5pp vs 曝光×2 的 12 周累计 GMV 对照。',
    preferredView: 'chart',
    code: ltvCurveRule,
    controls: [
      control('retention', '周留存率（联动滑杆）', 0.65, 0.3, 0.9, 0.01),
      control('impressions', '每周曝光', 200000, 10000, 1000000, 10000),
      control('ctr', '点击率', 0.05, 0.01, 0.2, 0.005),
      control('regRate', '注册率', 0.25, 0.05, 0.6, 0.01),
      control('payRate', '付费转化率', 0.08, 0.02, 0.2, 0.005),
      control('arpu', '周客单价 ARPU', 120, 10, 500, 5),
      control('cac', '获客成本 CAC', 400, 50, 2000, 10),
    ],
    presets: [
      { label: '留存 45%', params: { retention: 0.45 } },
      { label: '留存 65%', params: { retention: 0.65 } },
      { label: '留存 85%', params: { retention: 0.85 } },
    ],
    presetSource: { param: 'retention' },
    verificationNote: 'active_w = 新客 + active_{w-1}×r；LTV = ARPU/(1-r)。',
  });
  return board('增长漏斗与 Cohort 留存复利',
    [retention, payRate, funnel, cohort, ltv],
    [
      ['retention', 'cohort'],
      ['retention', 'ltv'],
      ['payRate', 'funnel'],
    ],
    ['funnel', 'cohort', 'ltv'],
    [sliderParam(retention), sliderParam(payRate)]);
}

/** biz05 CPM 关键路径与人力负载：延期/人力 → 依赖图/甘特/负载三视图。 */
function buildCpmDelivery(): CanvasDoc {
  const delay = slider('delay', '后端接口延期（天）', 60, 0, 0, 10, 1);
  const cap = slider('cap', '每日人力上限（人）', 220, 4, 2, 8, 1);
  const depGraph = rule('depGraph', 430, 40, {
    title: '依赖图 · 关键路径',
    summary: '任务依赖与关键路径高亮，延期沿依赖传导。',
    preferredView: 'graph',
    code: depGraphRule,
    controls: [
      control('delay', '延期天数（联动滑杆）', 0, 0, 10, 1),
      { key: 'taskSel', label: '延期任务', value: 3, options: [{ value: 3, label: 'T3 后端' }, { value: 2, label: 'T2 前端' }] },
      control('boost', '并行投入系数', 1, 0.5, 1.5, 0.05),
    ],
    presets: [
      { label: '如期交付', params: { delay: 0 } },
      { label: '延期 3 天', params: { delay: 3 } },
      { label: '击穿缓冲 +6', params: { delay: 6 } },
    ],
    presetSource: { param: 'delay' },
    verificationNote: '前推 ES/EF、后推 LS/LF；浮动=0 的链即关键路径。',
  });
  const gantt = rule('gantt', 430, 300, {
    title: '甘特排期推演',
    summary: '逐任务帧看 ES/EF 与浮动，延期如何传导到上线日。',
    preferredView: 'timeline',
    code: ganttRule,
    controls: [
      control('delay', '延期天数（联动滑杆）', 0, 0, 10, 1),
      { key: 'taskSel', label: '延期任务', value: 3, options: [{ value: 3, label: 'T3 后端' }, { value: 2, label: 'T2 前端' }] },
      control('boost', '并行投入系数', 1, 0.5, 1.5, 0.05),
    ],
    presets: [
      { label: '如期交付', params: { delay: 0 } },
      { label: '延期 3 天', params: { delay: 3 } },
      { label: '击穿缓冲 +6', params: { delay: 6 } },
    ],
    presetSource: { param: 'delay' },
    verificationNote: '基准工期 16 天；T3 每延 1 天总工期延 1 天（关键任务）。',
  });
  const load = rule('load', 430, 560, {
    title: '人力负载 vs 上限',
    summary: '每日并发人力需求与红线对比，超载日告警。',
    preferredView: 'chart',
    code: loadRule,
    auxiliaryKind: 'scalar',
    controls: [
      control('cap', '人力上限（联动滑杆）', 4, 2, 8, 1),
      control('delay', 'T3 延期天数', 0, 0, 10, 1),
    ],
    presets: [
      { label: '满编 6 人', params: { cap: 6 } },
      { label: '标准 4 人', params: { cap: 4 } },
      { label: '紧缩 3 人', params: { cap: 3 } },
    ],
    presetSource: { param: 'cap' },
    verificationNote: 'T2+T3+T4 并行期需求峰值 6 人；上限不足需削峰或加人。',
  });
  return board('CPM 关键路径与人力负载',
    [delay, cap, depGraph, gantt, load],
    [
      ['delay', 'depGraph'],
      ['delay', 'gantt'],
      ['delay', 'load', 'aux'],
      ['cap', 'load'],
    ],
    ['depGraph', 'gantt', 'load'],
    [sliderParam(delay), sliderParam(cap)]);
}

const FLAGSHIP: Partial<Record<BusinessSandboxKind, () => CanvasDoc>> = {
  'biz01-unit-economics': buildUnitEconomics,
  'biz02-investment-npv': buildInvestmentNpv,
  'biz03-growth-cohort': buildGrowthCohort,
  'biz05-cpm-delivery': buildCpmDelivery,
};

export const BUSINESS_SANDBOX_BUILDERS: Record<BusinessSandboxKind, () => CanvasDoc> = {
  ...FLAGSHIP as Record<BusinessSandboxKind, () => CanvasDoc>,
  ...BUSINESS_SANDBOX_MORE,
};

export function businessSandboxDoc(kind: BusinessSandboxKind): CanvasDoc {
  return BUSINESS_SANDBOX_BUILDERS[kind]();
}
