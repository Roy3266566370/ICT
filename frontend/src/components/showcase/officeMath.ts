export const PRICE_MIN = 70;
export const PRICE_MAX = 220;
export const PRICE_STEP = 1;
export const REFERENCE_PRICE = 100;
export const REFERENCE_DEMAND = 10000;

export interface OfficeInputs {
  price: number;
  elasticity: number;
  variableCost: number;
  fixedCost: number;
  capacity: number;
}

export interface OfficeResult {
  demand: number;
  sales: number;
  revenue: number;
  variableCostTotal: number;
  contribution: number;
  marginPerUnit: number;
  profit: number;
  marginRate: number;
  utilization: number;
  unmet: number;
  capacityBinding: boolean;
  breakEvenVolume: number;
  breakEvenPrice: number | null;
  safetyMargin: number;
  optimalPrice: number;
  optimalProfit: number;
}

export const DEFAULT_INPUTS: OfficeInputs = {
  price: 100,
  elasticity: 1.5,
  variableCost: 55,
  fixedCost: 420000,
  capacity: 12000,
};

export function demandAt(price: number, elasticity: number): number {
  return REFERENCE_DEMAND * Math.pow(price / REFERENCE_PRICE, -elasticity);
}

export function evaluateOffice(inputs: OfficeInputs): OfficeResult {
  const demand = demandAt(inputs.price, inputs.elasticity);
  const sales = Math.min(demand, inputs.capacity);
  const revenue = inputs.price * sales;
  const variableCostTotal = inputs.variableCost * sales;
  const contribution = (inputs.price - inputs.variableCost) * sales;
  const profit = contribution - inputs.fixedCost;
  const marginPerUnit = inputs.price - inputs.variableCost;
  const breakEvenVolume = marginPerUnit > 0 ? inputs.fixedCost / marginPerUnit : Number.POSITIVE_INFINITY;
  const safetyMargin = sales > 0 ? (sales - breakEvenVolume) / sales : Number.NEGATIVE_INFINITY;

  let breakEvenPrice: number | null = null;
  let previous = PRICE_MIN;
  if (profitAt(previous, inputs) >= 0) breakEvenPrice = previous;
  else {
    for (let price = PRICE_MIN + 0.25; price <= PRICE_MAX; price += 0.25) {
      if (profitAt(price, inputs) >= 0) {
        let low = previous;
        let high = price;
        for (let i = 0; i < 40; i += 1) {
          const mid = (low + high) / 2;
          if (profitAt(mid, inputs) >= 0) high = mid;
          else low = mid;
        }
        breakEvenPrice = high;
        break;
      }
      previous = price;
    }
  }

  let optimalPrice = PRICE_MIN;
  let optimalProfit = Number.NEGATIVE_INFINITY;
  for (let price = PRICE_MIN; price <= PRICE_MAX; price += 0.5) {
    const profitHere = profitAt(price, inputs);
    if (profitHere > optimalProfit) {
      optimalProfit = profitHere;
      optimalPrice = price;
    }
  }

  return {
    demand,
    sales,
    revenue,
    variableCostTotal,
    contribution,
    marginPerUnit,
    profit,
    marginRate: revenue > 0 ? profit / revenue : 0,
    utilization: inputs.capacity > 0 ? demand / inputs.capacity : 0,
    unmet: Math.max(0, demand - inputs.capacity),
    capacityBinding: demand > inputs.capacity,
    breakEvenVolume,
    breakEvenPrice,
    safetyMargin,
    optimalPrice,
    optimalProfit,
  };
}

export function profitAt(price: number, inputs: OfficeInputs): number {
  const demand = demandAt(price, inputs.elasticity);
  const sales = Math.min(demand, inputs.capacity);
  return (price - inputs.variableCost) * sales - inputs.fixedCost;
}

export interface Scenario {
  id: string;
  name: string;
  note: string;
  inputs: OfficeInputs;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'price',
    name: '提价 165',
    note: '以需求弹性换取单位贡献',
    inputs: { price: 165, elasticity: 1.5, variableCost: 55, fixedCost: 420000, capacity: 12000 },
  },
  {
    id: 'cost',
    name: '降本增效',
    note: '单位变动成本 −10，固定成本 −40k',
    inputs: { price: 100, elasticity: 1.5, variableCost: 45, fixedCost: 380000, capacity: 12000 },
  },
  {
    id: 'expand',
    name: '扩产促销',
    note: '产能 +33%，价格下探到 92',
    inputs: { price: 92, elasticity: 1.5, variableCost: 55, fixedCost: 460000, capacity: 16000 },
  },
] as const;

export interface SensitivityRow {
  key: keyof OfficeInputs;
  label: string;
  lowProfit: number;
  highProfit: number;
  delta: number;
}

const SENSITIVITY_LABELS: readonly { key: keyof OfficeInputs; label: string }[] = [
  { key: 'price', label: '价格' },
  { key: 'elasticity', label: '需求弹性' },
  { key: 'variableCost', label: '单位变动成本' },
  { key: 'fixedCost', label: '固定成本' },
  { key: 'capacity', label: '产能' },
];

export function sensitivity(inputs: OfficeInputs): SensitivityRow[] {
  return SENSITIVITY_LABELS.map(({ key, label }) => {
    const low = inputs[key] * 0.9;
    const high = inputs[key] * 1.1;
    const lowProfit = profitAtWith(inputs, key, low);
    const highProfit = profitAtWith(inputs, key, high);
    return {
      key,
      label,
      lowProfit,
      highProfit,
      delta: Math.abs(highProfit - lowProfit),
    };
  }).sort((a, b) => b.delta - a.delta);
}

function profitAtWith(inputs: OfficeInputs, key: keyof OfficeInputs, value: number): number {
  const next: OfficeInputs = { ...inputs, [key]: value };
  return profitAt(next.price, next);
}

export interface Advice {
  tone: 'good' | 'warn' | 'bad';
  headline: string;
  bullets: string[];
}

export function adviceFor(inputs: OfficeInputs, result: OfficeResult): Advice {
  const bullets: string[] = [];
  const priceGap = (result.optimalPrice - inputs.price) / inputs.price;
  const nearOptimal = Math.abs(priceGap) <= 0.06;
  const costProfit = profitAt(inputs.price, { ...inputs, variableCost: inputs.variableCost * 0.9 });
  const costGain = costProfit - result.profit;
  const expandProfit = profitAt(inputs.price, { ...inputs, capacity: inputs.capacity * 1.1 });
  const expandGain = expandProfit - result.profit;

  if (result.profit < 0) {
    bullets.push(
      `盈亏平衡销量 Q* = F / (p − v) = ${formatUnits(Number.isFinite(result.breakEvenVolume) ? result.breakEvenVolume : 0)}；当前销量 ${formatUnits(result.sales)}。`,
    );
    if (inputs.price <= inputs.variableCost) {
      bullets.push('单价不高于单位变动成本，每卖一件都在扩大亏损；先调价或降本，再谈规模。');
    } else if (result.breakEvenPrice !== null) {
      bullets.push(`当前需求下，价格至少要到 ¥${result.breakEvenPrice.toFixed(1)} 才能覆盖固定成本。`);
    }
    return {
      tone: 'bad',
      headline: '当前方案未过盈亏平衡',
      bullets,
    };
  }

  if (result.capacityBinding) {
    bullets.push(
      `需求 ${formatUnits(result.demand)} 超过产能 ${formatUnits(inputs.capacity)}，缺货 ${formatUnits(result.unmet)}；利用率 ${(result.utilization * 100).toFixed(0)}%。`,
    );
    bullets.push(`提价或扩产都能释放被产能截断的利润；建议价 ¥${result.optimalPrice.toFixed(0)}。`);
  } else if (!nearOptimal) {
    bullets.push(
      `利润曲线在 ¥${result.optimalPrice.toFixed(0)} 附近达到最高，预计利润 ${formatMoney(result.optimalProfit)}；当前价格${priceGap > 0 ? '低于' : '高于'}建议价 ${Math.abs(priceGap * 100).toFixed(0)}%。`,
    );
  } else {
    bullets.push('当前价格已在利润曲线的峰顶附近；继续提价会因需求下降而减少总利润。');
  }

  bullets.push(
    `单位变动成本下降 10% → 利润 +${formatMoney(costGain)}；产能提高 10% → 利润 ${expandGain >= 0 ? '+' : '−'}${formatMoney(Math.abs(expandGain))}。`,
  );
  bullets.push(
    `每单位贡献 ${formatMoney(result.marginPerUnit)}，安全边际 ${(result.safetyMargin * 100).toFixed(1)}%（销量超出盈亏平衡的比例）。`,
  );

  return {
    tone: result.capacityBinding ? 'warn' : 'good',
    headline: result.capacityBinding
      ? '需求被产能截断'
      : nearOptimal
        ? '方案已接近最优'
        : '方案已盈利，仍有优化空间',
    bullets,
  };
}

export function formatMoney(value: number): string {
  return `¥${Math.round(value).toLocaleString('zh-CN')}`;
}

export function formatMoneyWan(value: number): string {
  const wan = value / 10000;
  return `${wan >= 0 ? '' : '−'}${Math.abs(wan).toFixed(1)} 万`;
}

export function formatSignedWan(value: number): string {
  if (Math.abs(value) < 500) return '≈0';
  if (Math.abs(value) < 10000) return `${value >= 0 ? '+' : '−'}¥${Math.round(Math.abs(value)).toLocaleString('zh-CN')}`;
  return `${value >= 0 ? '+' : '−'}${(Math.abs(value) / 10000).toFixed(1)} 万`;
}

export function formatUnits(value: number): string {
  return `${Math.round(value).toLocaleString('zh-CN')} 件`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}
