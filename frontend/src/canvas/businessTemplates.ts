import { buildBusinessPipeline } from './businessPipeline.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import type { CanvasDoc } from './types.ts';

interface BusinessTemplate {
  kind: BusinessTemplateKind;
  topic: 'biz-operations' | 'biz-delivery';
  name: string;
  desc: string;
  tag: string;
  formula: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
}

export const BUSINESS_TOPICS: readonly { id: BusinessTemplate['topic']; name: string; lead: string }[] = [
  { id: 'biz-operations', name: '经营与增长', lead: '推演定价、成本、转化与留存如何影响盈亏和营收。' },
  { id: 'biz-delivery', name: '项目与实验', lead: '比较排期缓冲、交付风险和实验所需的样本量。' },
];

export const BUSINESS_TEMPLATES: readonly BusinessTemplate[] = [
  {
    kind: 'biz-breakeven', topic: 'biz-operations', name: '经营盈亏平衡与定价沙盘',
    tag: '办公决策 · 定价', desc: '调节定价、成本和销量，观察盈亏交点、利润拆解和累计回本月份。',
    formula: '盈亏平衡销量 = (固定开销 + 营销预算) ÷ 单笔贡献毛利',
    question: '当前定价和成本下，每月至少要卖出多少单才能盈亏平衡？',
    steps: '先拖动时间轴查看累计净利，再分别调整客单价和变动成本率，对比盈亏平衡销量与回本月份。',
    observation: '单笔贡献毛利越高，覆盖固定和营销开销所需的销量越低。累计回本还取决于各月销量的增长。',
    keywords: ['盈亏', '定价', '现金流', '回本', '瀑布图', 'ROI'],
  },
  {
    kind: 'biz-funnel', topic: 'biz-operations', name: '增长漏斗与留存复利推演',
    tag: '办公决策 · 增长', desc: '沿曝光、点击、注册、付费到复购追踪流失，比较转化与留存的营收影响。',
    formula: '活跃付费用户 = 每周新增付费 × (1 + r + r² + …)',
    question: '增加曝光、优化付费转化和提高留存，哪项对 12 周营收的影响更大？',
    steps: '观察各层流失量，再播放 12 周时间轴，对比基准留存和提高 5 个百分点两种情景。',
    observation: '留存改善会累积到此前各周的用户队列。首周和第 12 周的营收增量可能相差很大。',
    keywords: ['漏斗', '留存', '复购', '转化率', '队列', 'Cohort', 'LTV', 'GMV'],
  },
  {
    kind: 'biz-cpm', topic: 'biz-delivery', name: '项目排期与关键路径风险模拟器（CPM / 甘特图）',
    tag: '办公决策 · 排期', desc: '用甘特图观察六个任务的依赖、延期传导、浮动时间和并行负载。',
    formula: '总浮动时间 = 最晚开始 − 最早开始',
    question: '哪些任务一旦延期就会推迟交付？其他任务还有多少缓冲？',
    steps: '逐步增加前端、后端和 UI 的延期天数，观察关键路径切换，再推进时间轴查看并行任务负载。',
    observation: '非关键任务可用浮动时间吸收延期。多个分支工期相同时，项目可以有多条关键路径。',
    keywords: ['甘特图', '排期', 'CPM', '关键路径', '并行', '项目管理'],
  },
  {
    kind: 'biz-abtest', topic: 'biz-delivery', name: 'A/B 实验样本量与统计显著性计算器',
    tag: '办公决策 · A/B 实验', desc: '根据基准转化、最小提升和流量估算样本量，观察显著性、区间和统计功效。',
    formula: '每组样本量 ≈ [z₍₁₋α⁄₂₎·√(2p̄(1−p̄)) + z₍₀.₈₎·√(p₀(1−p₀)+p₁(1−p₁))]² ÷ (p₁−p₀)²',
    question: '在预期提升和当前流量下，需要运行多久才能获得 80% 的统计功效？',
    steps: '先设置预期相对提升与日流量，再推进实验天数，比较 p 值、95% 置信区间和功效读数。',
    observation: '这些读数来自假定转化率的规划情景。真实发布决策还需预先约定检验时点，并以实际数据核验。',
    keywords: ['AB实验', 'AB测试', 'A/B 测试', '样本量', '置信区间', '统计功效', 'p 值'],
  },
];

export function isBusinessTemplateKind(kind: string): kind is BusinessTemplateKind {
  return BUSINESS_TEMPLATES.some((template) => template.kind === kind);
}

export function businessTemplateDoc(kind: BusinessTemplateKind): CanvasDoc {
  const template = BUSINESS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知办公决策模板：${kind}`);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildBusinessPipeline(kind, template.name, note);
}
