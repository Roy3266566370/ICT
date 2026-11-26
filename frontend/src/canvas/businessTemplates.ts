import { buildBusinessPipeline } from './businessPipeline.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import { businessSandboxDoc, type BusinessSandboxKind } from './businessSandboxes.ts';
import type { CanvasDoc } from './types.ts';

export type BusinessKind = BusinessTemplateKind | BusinessSandboxKind;
export type BusinessTopicId = 'biz-finance' | 'biz-growth' | 'biz-delivery' | 'biz-strategy';
export type BusinessPreview = 'sensGrid' | 'npv' | 'cohort' | 'abCurve' | 'gantt' | 'eoqQueue' | 'decMatrix' | 'pareto' | 'pipeline';

interface BusinessTemplate {
  kind: BusinessKind;
  topic: BusinessTopicId;
  name: string;
  desc: string;
  tag: string;
  formula: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
  preview: BusinessPreview;
  panorama?: true;
  legacy?: true;
}

export const BUSINESS_TOPICS: readonly { id: BusinessTopicId; name: string; lead: string }[] = [
  { id: 'biz-finance', name: '财务经营与现金流', lead: '定价敏感性、盈亏回本与投资 NPV 的风险推演。' },
  { id: 'biz-growth', name: '增长、留存与实验', lead: '漏斗 Cohort 复利、LTV 杠杆与 A/B 实验的统计规划。' },
  { id: 'biz-delivery', name: '项目排期与运营产能', lead: '关键路径延期传导、人力负载、库存与排队产能。' },
  { id: 'biz-strategy', name: '战略选型与资源配置', lead: '加权决策翻转阈值、边际分配与收益风险前沿。' },
];

export const BUSINESS_TEMPLATES: readonly BusinessTemplate[] = [
  {
    kind: 'biz01-unit-economics', topic: 'biz-finance', name: '经营盈亏、定价与敏感性热图',
    tag: '办公决策 · 定价', desc: '客单价联动增长销量，同步看净利热图、累计回本与瀑布拆解。',
    formula: '月净利 = 客单价×(1−变动成本率)×销量 − 固定开销 − 营销预算',
    question: '价格与成本率落在哪个区间才能稳定盈利？',
    steps: '拖客单价滑杆，看敏感性热图上的经营点移动；再调节固定开销与营销预算观察回本月份。',
    observation: '贡献毛利越薄，盈亏对价格与成本率越敏感；固定开销决定回本所需的累计销量。',
    keywords: ['盈亏', '定价', '敏感性', '回本', '瀑布图'], preview: 'sensGrid', panorama: true,
  },
  {
    kind: 'biz02-investment-npv', topic: 'biz-finance', name: '投资立项 NPV 与压力测试',
    tag: '办公决策 · 投资', desc: '现金流表驱动情景分叉、折现回本与蒙特卡洛 NPV 分布。',
    formula: 'NPV = −投入 + Σ 现金流 ÷ (1+r/12)^t',
    question: '折现率上行、现金流波动时，这个项目的 NPV 还有多少安全边际？',
    steps: '拖折现率滑杆看 NPV 收窄；切换蒙特卡洛预设换现金流情景，看 P(NPV<0) 变化。',
    observation: '折现率越高 NPV 越低；波动幅度越大，亏损概率尾巴越厚。',
    keywords: ['NPV', '折现', '现金流', '蒙特卡洛', '压力测试'], preview: 'npv', panorama: true,
  },
  {
    kind: 'biz03-growth-cohort', topic: 'biz-growth', name: '增长漏斗与 Cohort 留存复利',
    tag: '办公决策 · 增长', desc: '留存率联动漏斗定位、周龄热图与 LTV 杠杆对照。',
    formula: 'LTV = ARPU ÷ (1 − 周留存率)',
    question: '提升留存 5 个百分点，与曝光翻倍相比谁更能拉动 12 周营收？',
    steps: '拖留存滑杆看 Cohort 热图尾部变厚；切换漏斗预设看最大流失层迁移。',
    observation: '留存是复利：早期 Cohort 在后期仍贡献活跃；LTV/CAC>3 才算健康。',
    keywords: ['漏斗', '留存', 'Cohort', 'LTV', '复购'], preview: 'cohort', panorama: true,
  },
  {
    kind: 'biz04-ab-experiment', topic: 'biz-growth', name: 'A/B 实验规划与早停陷阱',
    tag: '办公决策 · 实验', desc: '流量联动功效曲线、置信区间演化与每日偷看的假阳性模拟。',
    formula: '每组样本 ≈ (z_α·σ₀ + z_β·σ₁)² ÷ Δ²',
    question: '在预期提升与现有流量下，要跑多少天才够 80% 功效？',
    steps: '拖流量滑杆看达标天数；打开早停模拟，看每天偷看 p 值的误判率如何超过名义 α。',
    observation: '功效随 √n 增长；固定时点 α=5%，连续偷看可把误判率推高数倍。',
    keywords: ['AB实验', '样本量', '功效', '置信区间', '早停'], preview: 'abCurve', panorama: true,
  },
  {
    kind: 'biz05-cpm-delivery', topic: 'biz-delivery', name: 'CPM 关键路径与人力负载',
    tag: '办公决策 · 排期', desc: '后端延期联动依赖图、甘特推演与人力红线超载告警。',
    formula: '总浮动 = 最晚开始 − 最早开始；浮动为 0 即关键',
    question: '哪条链上的任务一延期就推迟上线？每日人力会不会超载？',
    steps: '拖延期滑杆看关键路径切换与浮动归零；再拖人力上限看哪些天超载。',
    observation: '非关键任务的浮动能吸收延期；并行高峰可能超过人力上限需要削峰。',
    keywords: ['CPM', '关键路径', '甘特图', '浮动', '人力负载'], preview: 'gantt', panorama: true,
  },
  {
    kind: 'biz06-inventory-queue', topic: 'biz-delivery', name: '库存补货与服务排队',
    tag: '办公决策 · 产能', desc: '日需求联动 EOQ 最优批量、库存锯齿与 M/M/s 等待陡增。',
    formula: 'EOQ = √(2DK/h)；ρ = λ/(sμ)',
    question: '订多少最省钱？客服加多少人才能把等待压下去？',
    steps: '拖需求滑杆看 EOQ 曲线平移；拖坐席数看利用率跨过 85% 后等待陡增。',
    observation: '总成本在 EOQ 处最低且曲线平缓；利用率 >85% 后等待时间非线性爆炸。',
    keywords: ['EOQ', '库存', '安全库存', '排队', '利用率'], preview: 'eoqQueue', panorama: true,
  },
  {
    kind: 'biz07-decision-matrix', topic: 'biz-strategy', name: '多方案加权决策与翻转分析',
    tag: '办公决策 · 选型', desc: '成本权重联动四维雷达、得分曲线与第一名翻转阈值。',
    formula: '得分 = Σ 维度分 × 权重（权重归一化）',
    question: '成本权重加到什么位置，推荐方案就会换人？',
    steps: '拖成本权重看排名变化；在得分曲线里找到第一名翻转的阈值。',
    observation: '当两个方案在阈值附近得分接近时，决策对权重假设非常敏感。',
    keywords: ['决策矩阵', '加权评分', '敏感性', '翻转'], preview: 'decMatrix', panorama: true,
  },
  {
    kind: 'biz08-budget-portfolio', topic: 'biz-strategy', name: '多渠道预算分配与边际收益',
    tag: '办公决策 · 预算', desc: '总预算联动边际 ROI 递减、平分与最优对比、收益波动前沿。',
    formula: '最优分配：各渠道边际 ROI 相等',
    question: '100 万预算怎么分，比三等分多赚多少？',
    steps: '拖总预算看最优分配迁移；对照平分 vs 边际最优的收益差。',
    observation: '边际收益递减时，集中投放单一渠道很快失效；最优解让各渠道边际 ROI 相等。',
    keywords: ['预算', '边际收益', '帕累托', '组合', 'ROI'], preview: 'pareto', panorama: true,
  },
  {
    kind: 'biz-breakeven', topic: 'biz-finance', name: '经营盈亏平衡与定价沙盘',
    tag: '办公决策 · 定价', desc: '调节定价、成本和销量，观察盈亏交点、利润拆解和累计回本月份。',
    formula: '盈亏平衡销量 = (固定开销 + 营销预算) ÷ 单笔贡献毛利',
    question: '当前定价和成本下，每月至少要卖出多少单才能盈亏平衡？',
    steps: '先拖动时间轴查看累计净利，再分别调整客单价和变动成本率，对比盈亏平衡销量与回本月份。',
    observation: '单笔贡献毛利越高，覆盖固定和营销开销所需的销量越低。累计回本还取决于各月销量的增长。',
    keywords: ['盈亏', '定价', '现金流', '回本', '瀑布图', 'ROI'], preview: 'pipeline', legacy: true,
  },
  {
    kind: 'biz-funnel', topic: 'biz-growth', name: '增长漏斗与留存复利推演',
    tag: '办公决策 · 增长', desc: '沿曝光、点击、注册、付费到复购追踪流失，比较转化与留存的营收影响。',
    formula: '活跃付费用户 = 每周新增付费 × (1 + r + r² + …)',
    question: '增加曝光、优化付费转化和提高留存，哪项对 12 周营收的影响更大？',
    steps: '观察各层流失量，再播放 12 周时间轴，对比基准留存和提高 5 个百分点两种情景。',
    observation: '留存改善会累积到此前各周的用户队列。首周和第 12 周的营收增量可能相差很大。',
    keywords: ['漏斗', '留存', '复购', '转化率', '队列', 'Cohort', 'LTV', 'GMV'], preview: 'pipeline', legacy: true,
  },
  {
    kind: 'biz-cpm', topic: 'biz-delivery', name: '项目排期与关键路径风险模拟器（CPM / 甘特图）',
    tag: '办公决策 · 排期', desc: '用甘特图观察六个任务的依赖、延期传导、浮动时间和并行负载。',
    formula: '总浮动时间 = 最晚开始 − 最早开始',
    question: '哪些任务一旦延期就会推迟交付？其他任务还有多少缓冲？',
    steps: '逐步增加前端、后端和 UI 的延期天数，观察关键路径切换，再推进时间轴查看并行任务负载。',
    observation: '非关键任务可用浮动时间吸收延期。多个分支工期相同时，项目可以有多条关键路径。',
    keywords: ['甘特图', '排期', 'CPM', '关键路径', '并行', '项目管理'], preview: 'pipeline', legacy: true,
  },
  {
    kind: 'biz-abtest', topic: 'biz-growth', name: 'A/B 实验样本量与统计显著性计算器',
    tag: '办公决策 · A/B 实验', desc: '根据基准转化、最小提升和流量估算样本量，观察显著性、区间和统计功效。',
    formula: '每组样本量 ≈ [z₍₁₋α⁄₂₎·√(2p̄(1−p̄)) + z₍₀.₈₎·√(p₀(1−p₀)+p₁(1−p₁))]² ÷ (p₁−p₀)²',
    question: '在预期提升和当前流量下，需要运行多久才能获得 80% 的统计功效？',
    steps: '先设置预期相对提升与日流量，再推进实验天数，比较 p 值、95% 置信区间和功效读数。',
    observation: '这些读数来自假定转化率的规划情景。真实发布决策还需预先约定检验时点，并以实际数据核验。',
    keywords: ['AB实验', 'AB测试', 'A/B 测试', '样本量', '置信区间', '统计功效', 'p 值'], preview: 'pipeline', legacy: true,
  },
];

export const VISIBLE_BUSINESS_TEMPLATES: readonly BusinessTemplate[] =
  BUSINESS_TEMPLATES.filter((template) => !template.legacy);

export function isBusinessTemplateKind(kind: string): kind is BusinessKind {
  return BUSINESS_TEMPLATES.some((template) => template.kind === kind);
}

/** 仅旧 4 个流水线 kind（businessStage 节点文档）；沙盘 kind 返回 false。 */
export function isBusinessPipelineKind(kind: string): kind is BusinessTemplateKind {
  return kind === 'biz-breakeven' || kind === 'biz-funnel' || kind === 'biz-cpm' || kind === 'biz-abtest';
}

export function businessTemplateDoc(kind: BusinessKind): CanvasDoc {
  const template = BUSINESS_TEMPLATES.find((item) => item.kind === kind);
  if (!template) throw new Error(`未知办公决策模板：${kind}`);
  if (template.panorama) return businessSandboxDoc(kind as BusinessSandboxKind);
  const note = `探究：${template.question}\n步骤：${template.steps}\n观察：${template.observation}`;
  return buildBusinessPipeline(kind as BusinessTemplateKind, template.name, note);
}
