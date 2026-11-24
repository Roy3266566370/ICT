import { useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortSpec } from './types.ts';
import { readTableFile } from './spreadsheetImport.ts';
import {
  BUSINESS_SAMPLES,
  businessSampleText,
  businessTableSeries,
  discountSeries,
  formatBusinessValue,
  growthSeries,
  parseBusinessTable,
  scenarioSeries,
  waterfallData,
  weightedDecision,
  type DecisionResult,
  type SeriesValue,
} from './officeBlocks.ts';
import {
  BLOCK_COLORS,
  KpiRow,
  LineChart,
  Notice,
  RangeControl,
  TextAreaField,
} from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

const seriesOut: PortSpec = { id: 'out', label: '数据序列', kind: 'series' };
const seriesIn: PortSpec = { id: 'in', label: '数据序列', kind: 'series' };

export function inputSeries(props: NodeBodyProps, port = 'in'): SeriesValue | null {
  const value = props.values[port];
  return value?.kind === 'series' ? value : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '当前数据无法计算。';
}

function SeriesTable({ series }: { series: SeriesValue }): JSX.Element {
  const rows = series.values.slice(0, 12).map((value, index) => ({
    label: series.labels[index] ?? `#${index + 1}`,
    value,
    secondary: series.secondary?.map((item) => item.values[index] ?? 0),
  }));
  return <table className={styles.table}>
    <thead><tr><th>标签</th><th>数值</th>{series.secondary?.map((item) => <th key={item.name}>{item.name}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.label}>
      <td>{row.label}</td><td>{formatBusinessValue(row.value, series.unit)}</td>
      {row.secondary?.map((value, index) => <td key={index}>{formatBusinessValue(value)}</td>)}
    </tr>)}</tbody>
  </table>;
}

export function BizTableSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, inCard, onText, onParams } = props;
  const [importState, setImportState] = useState<{ busy: boolean; message: string; error: string }>({
    busy: false, message: '', error: '',
  });
  const sample = Math.round(node.params.sample ?? 0);
  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setImportState({ busy: true, message: '', error: '' });
    try {
      const imported = await readTableFile(file);
      const parsed = parseBusinessTable(imported.text);
      onText?.(imported.text);
      onParams?.({ sample: -1 });
      setImportState({ busy: false, message: `已导入 ${imported.name} · ${parsed.values.length} 行数值`, error: '' });
    } catch (cause) {
      setImportState({ busy: false, message: '', error: errorText(cause) });
    }
  };
  let series: SeriesValue | null = null;
  let error = '';
  try {
    series = businessTableSeries(node.text ?? '', sample);
  } catch (cause) {
    error = errorText(cause);
  }
  return <div className={styles.root}>
    {error ? <Notice>{error}</Notice> : series ? <>
      <LineChart labels={series.labels} series={[{ name: series.title, values: series.values }]} compact={inCard}
        ariaLabel={'业务数据折线，共 ' + series.values.length + ' 个点'} />
      {!inCard && <>
        <KpiRow items={[
          { label: '数据点', value: String(series.values.length) },
          { label: '合计', value: formatBusinessValue(series.values.reduce((sum, value) => sum + value, 0)) },
          { label: '峰值', value: formatBusinessValue(Math.max(...series.values)) },
        ]} />
        <SeriesTable series={series} />
      </>}
    </> : null}
    {!inCard && <>
      <div className={styles.presets} role="group" aria-label="内置业务样例">
        {BUSINESS_SAMPLES.map((item, index) => <button key={item.id} type="button"
          aria-pressed={sample === index} onClick={() => { onParams?.({ sample: index }); onText?.(item.text); }}>{item.label}</button>)}
      </div>
      {onText ? <div className={styles.fileRow}>
        <label className={styles.fileLabel}>
          {importState.busy ? '读取中…' : '导入 Excel / CSV'}
          <input type="file" className={styles.fileInput} aria-label="导入 Excel 或 CSV 文件"
            accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={importState.busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void importFile(file);
              event.currentTarget.value = '';
            }} />
        </label>
        {importState.message ? <span className={styles.fileStatus}>{importState.message}</span> : null}
        {importState.error ? <span className={styles.fileStatus} data-error="true" role="alert">{importState.error}</span> : null}
      </div> : null}
      <TextAreaField label="粘贴或编辑两列数据" rows={6}
        value={node.text ?? businessSampleText(sample)}
        onChange={onText} placeholder={'月份,营收\n1月,128\n2月,136'} />
      <p className={styles.tip}>支持 .xlsx 首个工作表、.csv/.tsv/.txt 与直接粘贴；兼容带引号的逗号、表头自动跳过，最多保留 60 行。旧版 .xls 请先另存为 .xlsx 或 CSV。</p>
    </>}
  </div>;
}

export function BizGrowthSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, inCard } = props;
  const wiredGrowth = values.growth?.kind === 'scalar' && Number.isFinite(values.growth.v) ? values.growth.v : undefined;
  const series = growthSeries({
    initial: node.params.initial ?? 100,
    monthlyRate: node.params.rate ?? 0.06,
    months: node.params.months ?? 12,
    seasonality: node.params.seasonality ?? 0.08,
    overrideRate: wiredGrowth,
  });
  const controls = <>
    <RangeControl label="初值" value={node.params.initial ?? 100} min={0} max={10000} step={10}
      onChange={(value) => onParams?.({ initial: value })} />
    <RangeControl label="月增速" value={node.params.rate ?? 0.06} min={-0.5} max={0.5} step={0.01}
      disabled={wiredGrowth !== undefined} onChange={(value) => onParams?.({ rate: value })}
      format={(value) => `${(value * 100).toFixed(0)}%`} />
    <RangeControl label="周期数" value={node.params.months ?? 12} min={1} max={24} step={1}
      onChange={(value) => onParams?.({ months: value })} />
    <RangeControl label="季节波动" value={node.params.seasonality ?? 0.08} min={0} max={0.6} step={0.01}
      onChange={(value) => onParams?.({ seasonality: value })} format={(value) => `${(value * 100).toFixed(0)}%`} />
    {wiredGrowth !== undefined ? <p className={styles.tip}>月增速由上游滑杆驱动：{(wiredGrowth * 100).toFixed(1)}%</p> : null}
  </>;
  return <div className={styles.root}>
    <LineChart labels={series.labels} series={[{ name: '预期值', values: series.values }]} compact={inCard}
      ariaLabel="增长曲线" />
    {!inCard && controls}
    {!inCard ? <SeriesTable series={series} /> : null}
  </div>;
}

export function BizScenarioForkBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const input = inputSeries(props);
  if (!input) return <Notice>把「业务表格源」或「增长曲线源」的 series 输出接到情景分叉器。</Notice>;
  const series = scenarioSeries(input, {
    spread: node.params.spread ?? 0.2,
    drift: node.params.drift ?? 0.02,
  });
  const secondary = series.secondary ?? [];
  return <div className={styles.root}>
    <LineChart labels={series.labels} compact={inCard} ariaLabel="基准、乐观与悲观情景对比"
      series={[
        { name: '基准', values: series.values, color: BLOCK_COLORS[0] },
        ...secondary.map((item, index) => ({ name: item.name, values: item.values, color: BLOCK_COLORS[index + 1], dashed: true })),
      ]} />
    {!inCard && <>
      <RangeControl label="情景幅度" value={node.params.spread ?? 0.2} min={0} max={0.8} step={0.01}
        onChange={(value) => onParams?.({ spread: value })} format={(value) => `±${(value * 100).toFixed(0)}%`} />
      <RangeControl label="逐期漂移" value={node.params.drift ?? 0.02} min={-0.2} max={0.2} step={0.005}
        onChange={(value) => onParams?.({ drift: value })} format={(value) => `${(value * 100).toFixed(1)}%/期`} />
      <SeriesTable series={series} />
    </>}
  </div>;
}

export function BizDiscountOpBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, inCard } = props;
  const input = inputSeries(props);
  if (!input) return <Notice>把 series 数据接到复利与折现算子。</Notice>;
  const rateFromInput = values.rate?.kind === 'scalar' && Number.isFinite(values.rate.v) ? values.rate.v : undefined;
  let result;
  try {
    result = discountSeries(input, {
      annualRate: rateFromInput ?? node.params.rate ?? 0.08,
      initialInvestment: node.params.investment ?? 0,
    });
  } catch (cause) {
    return <Notice>{errorText(cause)}</Notice>;
  }
  return <div className={styles.root}>
    <LineChart labels={result.series.labels} series={[{ name: '累计净现值', values: result.series.values }]} compact={inCard}
      ariaLabel="累计净现值曲线" />
    <KpiRow items={[
      { label: 'NPV', value: formatBusinessValue(result.npv), tone: result.npv >= 0 ? 'good' : 'warn' },
      { label: '回本点', value: result.paybackIndex === null ? '未回本' : result.series.labels[result.paybackIndex] ?? `#${result.paybackIndex + 1}` },
      { label: '期末累计', value: formatBusinessValue(result.series.values[result.series.values.length - 1] ?? 0) },
    ]} />
    {!inCard && <>
      <RangeControl label="年折现率" value={rateFromInput ?? node.params.rate ?? 0.08} min={-0.5} max={1} step={0.005}
        disabled={rateFromInput !== undefined} onChange={(value) => onParams?.({ rate: value })}
        format={(value) => `${(value * 100).toFixed(1)}%`} />
      <RangeControl label="期初投入" value={node.params.investment ?? 0} min={0} max={1e7} step={100}
        onChange={(value) => onParams?.({ investment: value })} format={(value) => formatBusinessValue(value)} />
      <p className={styles.tip}>按月折现，rate / 12 逐期贴现；NPV 与输出序列的末值一致。</p>
    </>}
  </div>;
}

function radarPolygon(row: DecisionResult['rows'][number], cx: number, cy: number, radius: number): string {
  return row.parts.map((value, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 2;
    const r = radius * Math.max(0, Math.min(1, value / 100));
    return `${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`;
  }).join(' ');
}

function DecisionRadar({ result, compact }: { result: DecisionResult; compact: boolean }): JSX.Element {
  const size = compact ? 140 : 210;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const radius = size * 0.34;
  return <svg className={styles.chart} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="方案加权评分雷达对比">
    {[0.33, 0.66, 1].map((ratio) => <polygon key={ratio} points={Array.from({ length: 4 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 2;
      return `${(cx + Math.cos(angle) * radius * ratio).toFixed(1)},${(cy + Math.sin(angle) * radius * ratio).toFixed(1)}`;
    }).join(' ')} fill="none" stroke="#dedfd6" strokeWidth="0.8" />)}
    {(['成本', '周期', '风险', '收益'] as const).map((label, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 2;
      return <g key={label}>
        <line x1={cx} y1={cy} x2={cx + Math.cos(angle) * radius} y2={cy + Math.sin(angle) * radius} stroke="#e8e2d5" strokeWidth="0.8" />
        <text x={cx + Math.cos(angle) * (radius + 12)} y={cy + Math.sin(angle) * (radius + 12) + 3} textAnchor="middle">{label}</text>
      </g>;
    })}
    {result.rows.slice(0, 4).map((row, index) => <polygon key={row.name} points={radarPolygon(row, cx, cy, radius)}
      fill={BLOCK_COLORS[index % BLOCK_COLORS.length]} fillOpacity="0.08"
      stroke={BLOCK_COLORS[index % BLOCK_COLORS.length]} strokeWidth="1.2" />)}
  </svg>;
}

export function BizDecisionMatrixBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, inCard } = props;
  const wired = [values.cost, values.time, values.risk, values.benefit]
    .map((value) => value?.kind === 'scalar' && Number.isFinite(value.v) ? value.v : undefined);
  const weights: [number, number, number, number] = [
    wired[0] ?? node.params.costWeight ?? 0.25,
    wired[1] ?? node.params.timeWeight ?? 0.25,
    wired[2] ?? node.params.riskWeight ?? 0.25,
    wired[3] ?? node.params.benefitWeight ?? 0.25,
  ];
  const result = weightedDecision(weights);
  const top = result.rows[0];
  const maxScore = Math.max(1, ...result.rows.map((row) => row.score));
  return <div className={styles.root}>
    <div className={styles.barList}>{result.rows.map((row, index) => <div key={row.name} className={styles.barRow}>
      <span title={row.name}>{row.name}</span>
      <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${(row.score / maxScore) * 100}%`, background: BLOCK_COLORS[index % BLOCK_COLORS.length] }} /></div>
      <b>{row.score.toFixed(1)}</b>
    </div>)}</div>
    {!inCard && <DecisionRadar result={result} compact={false} />}
    {!inCard && <>
      <KpiRow items={[
        { label: '推荐方案', value: top?.name ?? '—', tone: 'good' },
        { label: '最高得分', value: top ? top.score.toFixed(1) : '—' },
        { label: '权重合计', value: '1.000' },
      ]} />
      <RangeControl label="成本权重" value={weights[0]} min={0} max={1} step={0.01} disabled={wired[0] !== undefined}
        onChange={(value) => onParams?.({ costWeight: value })} />
      <RangeControl label="周期权重" value={weights[1]} min={0} max={1} step={0.01} disabled={wired[1] !== undefined}
        onChange={(value) => onParams?.({ timeWeight: value })} />
      <RangeControl label="风险权重" value={weights[2]} min={0} max={1} step={0.01} disabled={wired[2] !== undefined}
        onChange={(value) => onParams?.({ riskWeight: value })} />
      <RangeControl label="收益权重" value={weights[3]} min={0} max={1} step={0.01} disabled={wired[3] !== undefined}
        onChange={(value) => onParams?.({ benefitWeight: value })} />
      <p className={styles.tip}>四个权重会归一化；上游 cost / time / risk / benefit 标量接线时优先使用接线值。</p>
      <table className={styles.table}>
        <thead><tr><th>方案</th><th>成本效率</th><th>交付周期</th><th>风险控制</th><th>预期收益</th><th>加权</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.name}>
          <td>{row.name}</td>{row.parts.map((value, index) => <td key={index}>{value}</td>)}<td>{row.score.toFixed(1)}</td>
        </tr>)}</tbody>
      </table>
    </>}
  </div>;
}

function WaterfallChart({ series }: { series: SeriesValue }): JSX.Element {
  const result = waterfallData(series);
  const lows = result.bars.map((bar) => Math.min(bar.start, bar.end));
  const highs = result.bars.map((bar) => Math.max(bar.start, bar.end));
  const low = Math.min(0, ...lows);
  const high = Math.max(0, ...highs);
  const span = high - low || 1;
  const left = 28;
  const top = 12;
  const width = 284;
  const height = 92;
  const slot = width / Math.max(1, result.bars.length);
  const py = (value: number) => top + height - ((value - low) / span) * height;
  const base = py(0);
  return <svg className={styles.chart} viewBox="0 0 320 132" role="img" aria-label="动态瀑布图">
    <line x1={left} x2={left + width} y1={base} y2={base} stroke="#aaa496" strokeWidth="0.9" />
    {result.bars.map((bar, index) => {
      const x = left + index * slot + slot * 0.16;
      const barWidth = Math.max(2, slot * 0.68);
      const y = py(Math.max(bar.start, bar.end));
      const h = Math.max(0.6, Math.abs(py(bar.start) - py(bar.end)));
      const color = bar.kind === 'total' ? '#4f46e5' : bar.delta >= 0 ? '#0d9488' : '#b15236';
      return <g key={`${bar.label}-${index}`}>
        <rect x={x} y={y} width={barWidth} height={h} rx="2" fill={color} opacity="0.82" />
        {Math.abs(bar.delta) > 0.01 ? <text x={x + barWidth / 2} y={y - 3} textAnchor="middle">{bar.delta > 0 ? '+' : ''}{formatBusinessValue(bar.delta)}</text> : null}
      </g>;
    })}
    {result.bars.filter((_, index) => index % Math.max(1, Math.ceil(result.bars.length / 6)) === 0).map((bar, index) => {
      const source = result.bars.indexOf(bar);
      return <text key={`${bar.label}-label-${index}`} x={left + source * slot + slot / 2} y={top + height + 14} textAnchor="middle">{bar.label.slice(0, 6)}</text>;
    })}
    {result.bars.length > 8 ? <text x={left + width} y={top + height + 26} textAnchor="end">仅显示前 {Math.min(6, result.bars.length)} 个标签</text> : null}
  </svg>;
}

export function BizWaterfallViewBody(props: NodeBodyProps): JSX.Element {
  const input = inputSeries(props);
  if (!input) return <Notice>把任意 series 数据接到瀑布图 / KPI 视图。</Notice>;
  const result = waterfallData(input);
  return <div className={styles.root}>
    <WaterfallChart series={input} />
    <KpiRow items={[
      { label: '期末总量', value: formatBusinessValue(result.total), tone: result.total >= 0 ? 'good' : 'warn' },
      { label: '峰值', value: formatBusinessValue(result.peak) },
      { label: '增长率', value: result.growth === null ? '—' : `${(result.growth * 100).toFixed(1)}%`, tone: (result.growth ?? 0) >= 0 ? 'good' : 'warn' },
    ]} />
    {!props.inCard ? <table className={styles.table}>
      <thead><tr><th>阶段</th><th>增量</th><th>累计</th></tr></thead>
      <tbody>{result.bars.slice(0, 16).map((bar, index) => <tr key={`${bar.label}-${index}`}>
        <td>{bar.label}</td><td>{bar.delta > 0 ? '+' : ''}{formatBusinessValue(bar.delta)}</td><td>{formatBusinessValue(bar.end)}</td>
      </tr>)}</tbody>
    </table> : null}
  </div>;
}

const scalar = (id: string, label: string): PortSpec => ({ id, label, kind: 'scalar' });

export const OFFICE_BLOCK_DEFS: Partial<Record<NodeType, NodeDef>> = {
  bizTableSource: {
    title: '业务表格源', badge: '源', width: 320,
    outputs: [seriesOut], Body: BizTableSourceBody,
  },
  bizGrowthSource: {
    title: '增长曲线源', badge: '源', width: 320,
    inputs: [{ id: 'growth', label: '月增速', kind: 'scalar' }],
    outputs: [seriesOut], Body: BizGrowthSourceBody,
  },
  bizScenarioFork: {
    title: '情景对比分叉器', badge: '变换', width: 330,
    inputs: [seriesIn], outputs: [seriesOut], Body: BizScenarioForkBody,
  },
  bizDiscountOp: {
    title: '复利与折现算子', badge: '变换', width: 330,
    inputs: [seriesIn, { id: 'rate', label: '年折现率', kind: 'scalar' }],
    outputs: [seriesOut, { id: 'npv', label: 'NPV', kind: 'scalar' }], Body: BizDiscountOpBody,
  },
  bizDecisionMatrix: {
    title: '加权评分决策卡', badge: '实验', width: 340,
    inputs: [scalar('cost', '成本权重'), scalar('time', '周期权重'), scalar('risk', '风险权重'), scalar('benefit', '收益权重')],
    outputs: [seriesOut], Body: BizDecisionMatrixBody,
  },
  bizWaterfallView: {
    title: '动态瀑布图 / KPI', badge: '视图', width: 330,
    inputs: [seriesIn], Body: BizWaterfallViewBody,
  },
};

export const OFFICE_DEFAULTS: Partial<Record<NodeType, Record<string, number>>> = {
  bizTableSource: { sample: 0 },
  bizGrowthSource: { initial: 100, rate: 0.06, months: 12, seasonality: 0.08 },
  bizScenarioFork: { spread: 0.2, drift: 0.02 },
  bizDiscountOp: { rate: 0.08, investment: 0 },
  bizDecisionMatrix: { costWeight: 0.25, timeWeight: 0.25, riskWeight: 0.25, benefitWeight: 0.25 },
  bizWaterfallView: {},
};

