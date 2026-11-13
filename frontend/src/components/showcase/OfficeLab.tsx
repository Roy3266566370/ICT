import { useMemo, useRef, useState } from 'react';
import Formula from './Formula';
import { LabSlider, Stat } from './controls';
import {
  DEFAULT_INPUTS,
  PRICE_MAX,
  PRICE_MIN,
  SCENARIOS,
  adviceFor,
  demandAt,
  evaluateOffice,
  formatMoney,
  formatMoneyWan,
  formatPercent,
  formatSignedWan,
  formatUnits,
  profitAt,
  sensitivity,
  type OfficeInputs,
  type OfficeResult,
} from './officeMath';
import styles from './office.module.css';

/* -------------------------------------------------------------------------- */
/* 主图：需求与利润                                                            */
/* -------------------------------------------------------------------------- */

const CHART = {
  x: 64,
  w: 664,
  demandTop: 30,
  demandH: 132,
  profitTop: 202,
  profitH: 132,
  width: 760,
  height: 360,
};

function niceStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  const factor = normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10;
  return factor * power;
}

function PriceProfitChart({
  inputs,
  result,
  onChangePrice,
}: {
  inputs: OfficeInputs;
  result: OfficeResult;
  onChangePrice: (price: number) => void;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);
  const priceSamples = useMemo(
    () =>
      Array.from({ length: 151 }, (_, index) => {
        const price = PRICE_MIN + ((PRICE_MAX - PRICE_MIN) * index) / 150;
        return { price, demand: demandAt(price, inputs.elasticity), profit: profitAt(price, inputs) };
      }),
    [inputs.elasticity, inputs.capacity, inputs.fixedCost, inputs.variableCost],
  );
  const demandMax = Math.max(inputs.capacity, ...priceSamples.map((point) => point.demand), 1) * 1.08;
  const profits = priceSamples.map((point) => point.profit);
  const profitMin = Math.min(0, ...profits);
  const profitMax = Math.max(0, ...profits);
  const profitPad = (profitMax - profitMin || 1) * 0.12;
  const profitLow = profitMin - profitPad;
  const profitHigh = profitMax + profitPad;
  const profitStep = niceStep(profitHigh - profitLow);
  const profitTicks: number[] = [];
  for (let tick = Math.ceil(profitLow / profitStep) * profitStep; tick <= profitHigh; tick += profitStep) {
    profitTicks.push(tick);
  }
  const px = (price: number): number =>
    CHART.x + ((price - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * CHART.w;
  const demandY = (value: number): number =>
    CHART.demandTop + CHART.demandH - (value / demandMax) * CHART.demandH;
  const profitY = (value: number): number =>
    CHART.profitTop + CHART.profitH - ((value - profitLow) / (profitHigh - profitLow)) * CHART.profitH;

  const demandPath = priceSamples
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point.price).toFixed(2)},${demandY(point.demand).toFixed(2)}`)
    .join(' ');
  const profitPath = priceSamples
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point.price).toFixed(2)},${profitY(point.profit).toFixed(2)}`)
    .join(' ');

  const updateFromEvent = (clientX: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const local = ((clientX - rect.left) / rect.width) * CHART.width;
    const ratio = Math.max(0, Math.min(1, (local - CHART.x) / CHART.w));
    const next = Math.round(PRICE_MIN + ratio * (PRICE_MAX - PRICE_MIN));
    onChangePrice(Math.max(PRICE_MIN, Math.min(PRICE_MAX, next)));
  };

  return (
    <div className={styles.priceChart}>
      <div className={styles.chartHead}>
        <div>
          <h3>价格 → 需求 → 利润</h3>
          <p>拖动橙色圆点，或点击曲线任意位置改变价格；产能上限同时约束销量。</p>
        </div>
        <span className={styles.chartHint}>当前价 ¥{inputs.price}</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={`价格 ${inputs.price} 元时需求 ${Math.round(result.demand)} 件、利润 ${Math.round(result.profit)} 元；可拖动改变价格`}
        style={{ touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromEvent(event.clientX);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) updateFromEvent(event.clientX);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <defs>
          <linearGradient id="office-demand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6c5ff0"/>
            <stop offset="100%" stopColor="#4f46e5"/>
          </linearGradient>
        </defs>

        {/* 需求面板 */}
        <text x={CHART.x} y={16} className={styles.axisTitle}>需求 D(p) 与产能</text>
        {[0, 0.5, 1].map((tick) => {
          const y = CHART.demandTop + CHART.demandH * tick;
          return <line key={`dg-${tick}`} x1={CHART.x} y1={y} x2={CHART.x + CHART.w} y2={y} className={styles.gridLine}/>;
        })}
        <line
          x1={CHART.x}
          y1={demandY(inputs.capacity)}
          x2={CHART.x + CHART.w}
          y2={demandY(inputs.capacity)}
          className={styles.capacityLine}
        />
        <text x={CHART.x + CHART.w - 2} y={demandY(inputs.capacity) - 5} textAnchor="end" className={styles.capacityLabel}>
          产能 {formatUnits(inputs.capacity)}
        </text>
        <path d={demandPath} className={styles.demandPath}/>
        <text x={CHART.x + 8} y={CHART.demandTop + 14} className={styles.panelNote}>
          {result.capacityBinding ? '需求高于产能，销量被截断' : '需求在产能以内，销量等于需求'}
        </text>
        <line x1={px(inputs.price)} y1={CHART.demandTop} x2={px(inputs.price)} y2={CHART.profitTop + CHART.profitH} className={styles.currentLine}/>
        <circle cx={px(inputs.price)} cy={demandY(result.demand)} r={4.2} className={styles.demandDot}/>
        <text x={px(inputs.price) + 7} y={demandY(result.demand) - 7} className={styles.currentLabel}>
          D = {Math.round(result.demand).toLocaleString('zh-CN')}
        </text>

        {/* 利润面板 */}
        <text x={CHART.x} y={CHART.profitTop - 12} className={styles.axisTitle}>利润 π(p)</text>
        {profitTicks.map((tick) => (
          <g key={`pt-${tick}`}>
            <line
              x1={CHART.x}
              y1={profitY(tick)}
              x2={CHART.x + CHART.w}
              y2={profitY(tick)}
              className={tick === 0 ? styles.zeroLine : styles.gridLine}
            />
            <text x={CHART.x - 8} y={profitY(tick) + 3} textAnchor="end" className={styles.tickLabel}>
              {tick === 0 ? '0' : formatMoneyWan(tick)}
            </text>
          </g>
        ))}
        <path d={profitPath} className={styles.profitPath}/>
        {([PRICE_MIN, 100, 130, 160, 190, 220] as const).map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={px(tick)} y1={CHART.profitTop} x2={px(tick)} y2={CHART.profitTop + CHART.profitH} className={styles.gridLine}/>
            <text x={px(tick)} y={CHART.profitTop + CHART.profitH + 18} textAnchor="middle" className={styles.tickLabel}>
              {tick}
            </text>
          </g>
        ))}
        {result.breakEvenPrice !== null ? (
          <g>
            <line
              x1={px(result.breakEvenPrice)}
              y1={CHART.profitTop}
              x2={px(result.breakEvenPrice)}
              y2={CHART.profitTop + CHART.profitH}
              className={styles.breakEvenLine}
            />
            <text x={px(result.breakEvenPrice) + 4} y={CHART.profitTop + 12} className={styles.breakEvenLabel}>
              平衡 ¥{result.breakEvenPrice.toFixed(0)}
            </text>
          </g>
        ) : null}
        <circle cx={px(result.optimalPrice)} cy={profitY(result.optimalProfit)} r={4.5} className={styles.optimalDot}/>
        <text x={px(result.optimalPrice)} y={profitY(result.optimalProfit) - 9} textAnchor="middle" className={styles.optimalLabel}>
          最优 ¥{result.optimalPrice.toFixed(0)}
        </text>
        <circle cx={px(inputs.price)} cy={profitY(result.profit)} r={6.5} className={styles.currentDot}/>
        <text
          x={px(inputs.price) + (px(inputs.price) > CHART.x + CHART.w - 92 ? -11 : 11)}
          y={profitY(result.profit) + 4}
          textAnchor={px(inputs.price) > CHART.x + CHART.w - 92 ? 'end' : 'start'}
          className={styles.currentProfitLabel}
        >
          {formatMoney(result.profit)}
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 利润瀑布                                                                    */
/* -------------------------------------------------------------------------- */

function Waterfall({ result }: { result: OfficeResult }): JSX.Element {
  const fixedCost = result.revenue - result.variableCostTotal - result.profit;
  const steps = [
    { label: '收入', value: result.revenue, start: 0, end: result.revenue, tone: 'revenue' },
    {
      label: '变动成本',
      value: -result.variableCostTotal,
      start: result.revenue,
      end: result.revenue - result.variableCostTotal,
      tone: 'cost',
    },
    {
      label: '固定成本',
      value: -fixedCost,
      start: result.revenue - result.variableCostTotal,
      end: result.profit,
      tone: 'cost',
    },
    { label: '营业利润', value: result.profit, start: 0, end: result.profit, tone: result.profit >= 0 ? 'profit' : 'loss' },
  ];
  const values = steps.flatMap((step) => [step.start, step.end, 0]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = (max - min || 1) * 0.16;
  const top = 34;
  const height = 180;
  const width = 760;
  const y = (value: number): number => top + height - ((value - (min - pad)) / (max - min + 2 * pad)) * height;
  const barWidth = 92;
  const gap = (width - 80 - barWidth * steps.length) / (steps.length - 1);
  const xFor = (index: number): number => 52 + index * (barWidth + gap);

  return (
    <div className={styles.smallChart}>
      <div className={styles.chartHead}>
        <div>
          <h3>收入 → 利润瀑布</h3>
          <p>每一段成本从上一段余额中扣除，最后落到营业利润。</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} 240`} role="img" aria-label="收入减去变动成本与固定成本得到营业利润的瀑布图">
        <line x1={40} y1={y(0)} x2={width - 24} y2={y(0)} className={styles.zeroLine}/>
        {steps.map((step, index) => {
          const topY = Math.min(y(step.start), y(step.end));
          const barHeight = Math.max(2, Math.abs(y(step.start) - y(step.end)));
          const x = xFor(index);
          const next = steps[index + 1];
          return (
            <g key={step.label}>
              {next ? (
                <line
                  x1={x + barWidth}
                  y1={y(step.end)}
                  x2={xFor(index + 1)}
                  y2={y(step.end)}
                  className={styles.waterfallConnector}
                />
              ) : null}
              <rect
                x={x}
                y={topY}
                width={barWidth}
                height={barHeight}
                rx={4}
                className={styles.waterfallBar}
                data-tone={step.tone}
              />
              <text x={x + barWidth / 2} y={topY - 6} textAnchor="middle" className={styles.waterfallValue}>
                {formatMoneyWan(step.value)}
              </text>
              <text x={x + barWidth / 2} y={top + height + 20} textAnchor="middle" className={styles.waterfallLabel}>
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 敏感性龙卷风图                                                              */
/* -------------------------------------------------------------------------- */

function Tornado({
  inputs,
  baseProfit,
}: {
  inputs: OfficeInputs;
  baseProfit: number;
}): JSX.Element {
  const rows = useMemo(() => sensitivity(inputs), [inputs]);
  const maxDelta = Math.max(1, ...rows.flatMap((row) => [
    Math.abs(row.lowProfit - baseProfit),
    Math.abs(row.highProfit - baseProfit),
  ]));
  const width = 760;
  const rowHeight = 34;
  const top = 48;
  const center = 400;
  const half = 250;
  const x = (delta: number): number => center + (delta / maxDelta) * half;
  const height = top + rows.length * rowHeight + 18;

  return (
    <div className={styles.smallChart}>
      <div className={styles.chartHead}>
        <div>
          <h3>敏感性：谁在撬动利润</h3>
          <p>每个变量单独 ±10%，其余保持不变；按利润变化幅度排序。</p>
        </div>
        <div className={styles.legend}>
          <span data-tone="low"><i/>−10% 情形</span>
          <span data-tone="high"><i/>+10% 情形</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="价格、弹性、成本、产能对利润的敏感性龙卷风图">
        <line x1={center} y1={30} x2={center} y2={height - 8} className={styles.zeroLine}/>
        <text x={center} y={22} textAnchor="middle" className={styles.tickLabel}>基准利润 {formatMoneyWan(baseProfit)}</text>
        <text x={100} y={22} textAnchor="end" className={styles.tickLabel}>变量</text>
        {rows.map((row, index) => {
          const y = top + index * rowHeight;
          const lowDelta = row.lowProfit - baseProfit;
          const highDelta = row.highProfit - baseProfit;
          const lowX = x(lowDelta);
          const highX = x(highDelta);
          return (
            <g key={row.key}>
              <text x={100} y={y + 13} textAnchor="end" className={styles.tornadoLabel}>{row.label}</text>
              <rect
                x={Math.min(center, lowX)}
                y={y}
                width={Math.max(1, Math.abs(center - lowX))}
                height={9}
                rx={3}
                className={styles.tornadoBar}
                data-tone="low"
              />
              <rect
                x={Math.min(center, highX)}
                y={y + 12}
                width={Math.max(1, Math.abs(center - highX))}
                height={9}
                rx={3}
                className={styles.tornadoBar}
                data-tone="high"
              />
              <text
                x={lowDelta >= 0 ? lowX + 4 : lowX - 4}
                y={y + 8}
                textAnchor={lowDelta >= 0 ? 'start' : 'end'}
                className={styles.tornadoValue}
              >
                {formatSignedWan(lowDelta)}
              </text>
              <text
                x={highDelta >= 0 ? highX + 4 : highX - 4}
                y={y + 20}
                textAnchor={highDelta >= 0 ? 'start' : 'end'}
                className={styles.tornadoValue}
              >
                {formatSignedWan(highDelta)}
              </text>
            </g>
          );
        })}
        <text x={width - 12} y={height - 8} textAnchor="end" className={styles.tickLabel}>
          条形端点为相对基准的利润变化
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 情景对比                                                                    */
/* -------------------------------------------------------------------------- */

function ScenarioTable({
  inputs,
  onApply,
}: {
  inputs: OfficeInputs;
  onApply: (inputs: OfficeInputs) => void;
}): JSX.Element {
  const rows = useMemo(
    () =>
      [{ id: 'current', name: '当前方案', note: '正在推演的参数', inputs }, ...SCENARIOS].map((scenario) => ({
        ...scenario,
        result: evaluateOffice(scenario.inputs),
      })),
    [inputs],
  );
  const baseProfit = rows[0]?.result.profit ?? 0;
  return (
    <div className={styles.scenarioBlock}>
      <div className={styles.chartHead}>
        <div>
          <h3>情景对比</h3>
          <p>点击任意一行把该方案载入左侧沙盘，继续微调。</p>
        </div>
      </div>
      <div className={styles.scenarioScroll}>
        <table className={styles.scenarioTable}>
          <thead>
            <tr>
              <th>方案</th>
              <th>价格</th>
              <th>单位成本</th>
              <th>固定成本</th>
              <th>产能</th>
              <th>利润</th>
              <th>利润率</th>
              <th>较当前</th>
              <th aria-label="操作"/>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const delta = row.result.profit - baseProfit;
              const active = index === 0;
              const applied =
                !active &&
                (Object.keys(inputs) as (keyof OfficeInputs)[]).every(
                  (key) => row.inputs[key] === inputs[key],
                );
              return (
                <tr key={row.id} data-active={active || applied || undefined}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.note}</small>
                  </td>
                  <td>¥{row.inputs.price}</td>
                  <td>¥{row.inputs.variableCost}</td>
                  <td>{formatMoneyWan(row.inputs.fixedCost)}</td>
                  <td>{formatUnits(row.inputs.capacity)}</td>
                  <td className={row.result.profit >= 0 ? styles.moneyGood : styles.moneyBad}>{formatMoney(row.result.profit)}</td>
                  <td>{formatPercent(row.result.marginRate)}</td>
                  <td className={delta >= 0 ? styles.moneyGood : styles.moneyBad}>
                    {active || applied ? '—' : `${delta >= 0 ? '+' : '−'}${formatMoneyWan(Math.abs(delta))}`}
                  </td>
                  <td>
                    {active ? (
                      <span className={styles.currentTag}>当前</span>
                    ) : applied ? (
                      <span className={styles.currentTag}>已应用</span>
                    ) : (
                      <button type="button" onClick={() => onApply(row.inputs)}>应用</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 主组件                                                                      */
/* -------------------------------------------------------------------------- */

export function OfficeLab(): JSX.Element {
  const [inputs, setInputs] = useState<OfficeInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => evaluateOffice(inputs), [inputs]);
  const advice = useMemo(() => adviceFor(inputs, result), [inputs, result]);

  const set = <K extends keyof OfficeInputs>(key: K, value: OfficeInputs[K]): void => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  return (
    <article className={styles.lab} aria-labelledby="office-lab-title">
      <header className={styles.labHeader}>
        <div className={styles.headerText}>
          <p className={styles.kicker}>办公 · 经营推演</p>
          <h2 id="office-lab-title">把一页定价方案，变成可推演的董事会模型</h2>
          <p className={styles.lead}>
            调节价格、需求弹性、成本与产能，利润曲线、瀑布图、敏感性排序与建议会同时更新。
            这不是一张静态报表：每个数字都能沿着“需求 → 销量 → 收入 → 利润”追溯。
          </p>
        </div>
        <div className={styles.headerBadge}>
          <span>季度经营分析 · 情景版</span>
          <strong>π = (p − v)·min(D, C) − F</strong>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.stage}>
          <PriceProfitChart inputs={inputs} result={result} onChangePrice={(price) => set('price', price)} />

          <div className={styles.metrics}>
            <Stat
              label="营业利润"
              value={formatMoney(result.profit)}
              note={`利润率 ${formatPercent(result.marginRate)}`}
              tone={result.profit >= 0 ? 'good' : 'bad'}
            />
            <Stat label="销量" value={formatUnits(result.sales)} note={`需求 ${formatUnits(result.demand)}`} />
            <Stat
              label="产能利用率"
              value={formatPercent(result.utilization)}
              note={result.capacityBinding ? `缺货 ${formatUnits(result.unmet)}` : '需求未超产能'}
              tone={result.capacityBinding ? 'accent' : 'default'}
            />
            <Stat
              label="盈亏平衡价"
              value={result.breakEvenPrice === null ? '—' : `¥${result.breakEvenPrice.toFixed(1)}`}
              note={`平衡销量 ${Number.isFinite(result.breakEvenVolume) ? formatUnits(result.breakEvenVolume) : '不可达'}`}
            />
            <Stat
              label="建议价"
              value={`¥${result.optimalPrice.toFixed(0)}`}
              note={`预计利润 ${formatMoney(result.optimalProfit)}`}
              tone="accent"
            />
            <Stat
              label="安全边际"
              value={formatPercent(result.safetyMargin)}
              note="销量超出盈亏平衡的比例"
              tone={result.safetyMargin >= 0 ? 'good' : 'bad'}
            />
          </div>
        </div>

        <aside className={styles.rail}>
          <section className={styles.controlCard} aria-label="经营参数">
            <div className={styles.panelHead}>
              <h3>经营参数</h3>
              <button type="button" onClick={() => setInputs(DEFAULT_INPUTS)}>恢复基准</button>
            </div>
            <LabSlider
              label="销售价格 p"
              value={inputs.price}
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={1}
              onChange={(value) => set('price', value)}
              format={(value) => `¥${value}`}
              hint="价格改变需求，也改变单位贡献；利润曲线会出现峰顶。"
            />
            <LabSlider
              label="需求弹性 e"
              value={inputs.elasticity}
              min={0.8}
              max={2.4}
              step={0.05}
              onChange={(value) => set('elasticity', value)}
              format={(value) => value.toFixed(2)}
              hint="e 越大，涨价让需求下降得越快；基准需求 10,000 件（p₀ = ¥100）。"
            />
            <LabSlider
              label="单位变动成本 v"
              value={inputs.variableCost}
              min={35}
              max={80}
              step={1}
              onChange={(value) => set('variableCost', value)}
              format={(value) => `¥${value}`}
              hint="每卖出一件发生的成本，直接决定单位贡献 p − v。"
            />
            <LabSlider
              label="固定成本 F"
              value={inputs.fixedCost}
              min={200000}
              max={700000}
              step={10000}
              onChange={(value) => set('fixedCost', value)}
              format={(value) => formatMoneyWan(value)}
              hint="不随销量变化的费用；决定盈亏平衡销量。"
            />
            <LabSlider
              label="产能 C"
              value={inputs.capacity}
              min={6000}
              max={16000}
              step={500}
              onChange={(value) => set('capacity', value)}
              format={(value) => formatUnits(value)}
              hint="需求超过产能时会缺货，销量被截断，利润曲线出现平台/拐点。"
            />
          </section>

          <section className={styles.adviceCard} data-tone={advice.tone} aria-label="决策建议">
            <div className={styles.adviceHead}>
              <span>决策建议</span>
              <em>{advice.tone === 'good' ? '可执行' : advice.tone === 'warn' ? '需关注' : '风险'}</em>
            </div>
            <h3>{advice.headline}</h3>
            <ul>
              {advice.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.applyAdvice}
              disabled={Math.abs(result.optimalPrice - inputs.price) < 0.6}
              onClick={() => set('price', result.optimalPrice)}
            >
              {Math.abs(result.optimalPrice - inputs.price) < 0.6
                ? '当前已在建议价'
                : `采用建议价 ¥${result.optimalPrice.toFixed(0)}`}
            </button>
          </section>
        </aside>
      </div>

      <div className={styles.chartPair}>
        <Waterfall result={result}/>
        <Tornado inputs={inputs} baseProfit={result.profit}/>
      </div>

      <ScenarioTable inputs={inputs} onApply={setInputs}/>

      <section className={styles.derivation} aria-labelledby="office-formulas-title">
        <div className={styles.derivationHead}>
          <div>
            <p className={styles.kicker}>公式与推导</p>
            <h3 id="office-formulas-title">每个结论都能被复算</h3>
          </div>
          <span>需求函数 · 利润恒等式 · 盈亏平衡 · 最优价 · 敏感性</span>
        </div>
        <div className={styles.formulaGrid}>
          <article>
            <h4>1. 需求与销量</h4>
            <Formula block tex={String.raw`D(p)=D_0\left(\frac{p}{p_0}\right)^{-e},\qquad S=\min(D(p),C)`} />
            <p>
              恒定弹性需求曲线；<Formula tex={String.raw`D_0=10{,}000`}/>、
              <Formula tex={String.raw`p_0=100`}/>。产能 C 是硬上限，需求超过它时销量只能等于 C。
            </p>
          </article>
          <article>
            <h4>2. 利润恒等式</h4>
            <Formula block tex={String.raw`\pi(p)=(p-v)\,S-F`} />
            <p>
              单位贡献 <Formula tex={String.raw`p-v`}/> 乘销量再减固定成本。瀑布图就是这条恒等式的逐项展开：
              收入 − 变动成本 − 固定成本 = 营业利润。
            </p>
          </article>
          <article>
            <h4>3. 盈亏平衡</h4>
            <Formula block tex={String.raw`Q^\ast=\frac{F}{p-v},\qquad \pi(p_{be})=0`} />
            <p>
              当前方案 <Formula tex={String.raw`Q^\ast=${Number.isFinite(result.breakEvenVolume) ? Math.round(result.breakEvenVolume).toLocaleString('zh-CN') : '—'}`}/>，
              销量 <Formula tex={String.raw`S=${Math.round(result.sales).toLocaleString('zh-CN')}`}/>。
              安全边际 <Formula tex={String.raw`(S-Q^\ast)/S`}/> 为正才说明销量留有余量。
            </p>
          </article>
          <article>
            <h4>4. 最优价格</h4>
            <Formula block tex={String.raw`\frac{d\pi}{dp}=0\;\Longrightarrow\;p^\ast=\frac{e\,v}{e-1}`} />
            <p>
              在产能不约束时，对 <Formula tex={String.raw`(p-v)D(p)`}/> 求导可得闭式解；
              若产能约束生效，则先到 <Formula tex={String.raw`p_{cap}=p_0(C/D_0)^{-1/e}`}/>，
              取 <Formula tex={String.raw`p^\ast=\max(ev/(e-1),\,p_{cap})`}/>。当前建议价 ¥
              {result.optimalPrice.toFixed(0)} 来自离散扫描（含产能约束）。
            </p>
          </article>
          <article>
            <h4>5. 敏感性</h4>
            <Formula block tex={String.raw`\Delta\pi_x=\pi(x\pm10\%)-\pi(x)`} />
            <p>
              龙卷风图逐项重算利润，不引入近似；条形越长，说明该变量对利润的杠杆越大。
              当前影响最大的变量是 <strong>{sensitivity(inputs)[0]?.label ?? '—'}</strong>。
            </p>
          </article>
          <article>
            <h4>6. 经营读数</h4>
            <Formula block tex={String.raw`U=\frac{D}{C},\qquad M=\frac{S-Q^\ast}{S},\qquad \text{利润率}=\frac{\pi}{pS}`} />
            <p>
              利用率回答“产能是否成为瓶颈”，安全边际回答“销量下滑多少才会亏损”，
              利润率回答“每一元收入留下多少利润”。三个读数共同决定建议的优先级。
            </p>
          </article>
        </div>
      </section>
    </article>
  );
}

export default OfficeLab;
