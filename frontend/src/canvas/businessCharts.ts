import { CPM_CAPACITY, normalDensity, type calculateAbTest, type calculateBreakeven,
  type calculateCpm, type calculateFunnel } from './businessModels.ts';
import type { ScienceFrame, ScienceLabel, SciencePath, ScienceScene } from './sciencePipelineTypes.ts';

const BLUE = '#2458b5';
const GREEN = '#00796c';
const RED = '#bc4038';
const ORANGE = '#a95a13';
const INK = '#39465a';
const GRID = '#c4cbd6';
const FAINT = '#dde6f2';

const integers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const integer = (value: number) => integers.format(value);
const money = (value: number, currency: string) =>
  currency === '元' ? '¥' + decimals.format(value) : decimals.format(value) + ' ' + currency;
const compact = (value: number) => Math.abs(value) >= 10_000 ? (value / 10_000).toFixed(1) + '万' : decimals.format(value);
const percent = (value: number) => (100 * value).toFixed(1) + '%';
const pp = (value: number) => (100 * value).toFixed(2) + ' 个百分点';

type Point = [number, number];
type Plot = ReturnType<typeof plot>;

function line(points: Point[], stroke = INK, dashed = false): SciencePath {
  return { points, stroke, dashed };
}

function label(x: number, y: number, text: string, color = INK, anchor: ScienceLabel['anchor'] = 'start', size = 10): ScienceLabel {
  return { x, y, text, color, anchor, size };
}

function chartName(x: number, y: number, text: string, width: number): ScienceLabel {
  return label(x, y, text, INK, 'start', Math.min(10, width / [...text].length));
}

function plot(
  ariaLabel: string, xMin: number, xMax: number, yMin: number, yMax: number,
  xLabel: string, yLabel: string, yTick = compact, xTick = compact,
) {
  const x = (value: number) => 55 + (value - xMin) / (xMax - xMin) * 320;
  const y = (value: number) => 202 - (value - yMin) / (yMax - yMin) * 151;
  const paths: SciencePath[] = [line([[55, 51], [55, 202], [375, 202]], GRID)];
  const labels = [label(55, 18, yLabel), label(375, 238, xLabel, INK, 'end')];
  for (const fraction of [0, .25, .5, .75, 1]) {
    const xValue = xMin + fraction * (xMax - xMin);
    const yValue = yMin + fraction * (yMax - yMin);
    if (fraction > 0) paths.push(line([[55, y(yValue)], [375, y(yValue)]], GRID, true));
    labels.push(label(x(xValue), 222, xTick(xValue), INK, 'middle', 9), label(50, y(yValue) + 3, yTick(yValue), INK, 'end', 9));
  }
  return { x, y, paths, labels, scene: { ariaLabel, paths, labels } satisfies ScienceScene };
}

function timePlot(chart: Plot, current: number, lines: SciencePath[], labels: ScienceLabel[] = []): ScienceScene {
  return { ...chart.scene, paths: [...chart.paths, ...lines, line([[chart.x(current), 51], [chart.x(current), 202]], ORANGE, true)],
    labels: [...chart.labels, ...labels] };
}

function band(points: Point[], fill: string): SciencePath {
  return { points, fill, stroke: 'none', closed: true };
}

function extent(values: number[]): [number, number] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const padding = Math.max(1e-9, (max - min) * .08);
  return [min < 0 ? min - padding : 0, max + padding];
}

function frame(title: string, scene: ScienceScene, metrics: ScienceFrame['metrics'], summary: string): ScienceFrame {
  return { title, scene, metrics, summary };
}

function signedBars(
  names: string[], values: number[], bounds: { top: number; bottom: number }, maximum: number, currency: string,
) {
  const zero = 237;
  const rowHeight = (bounds.bottom - bounds.top) / names.length;
  const labels = names.map((name, i) => chartName(22, bounds.top + rowHeight * (i + .64), name, 120));
  const rects = values.map((value, i) => {
    const width = 88 * value / maximum;
    const y = bounds.top + i * rowHeight;
    const color = value < 0 ? RED : GREEN;
    labels.push(label(zero + width + (value < 0 ? -4 : 4), y + rowHeight * .64,
      (value >= 0 ? '+' : '−') + compact(Math.abs(value)) + ' ' + currency, color, value < 0 ? 'end' : 'start'));
    return { x: zero + Math.min(width, 0), y: y + rowHeight * .14, width: Math.abs(width), height: rowHeight * .7, fill: color, stroke: 'none', opacity: .78 };
  });
  return { labels, rects, paths: [line([[zero, bounds.top], [zero, bounds.bottom]], GRID)] };
}

export function breakevenFrames(
  model: ReturnType<typeof calculateBreakeven>, stage: 'main' | 'analysis' | 'summary',
  { currency = '元', orders = '单' }: Record<string, string>,
): ScienceFrame[] {
  const { months, fixed, price, varRate, breakEvenSales, paybackMonth } = model;
  const maxSales = Math.max(1, breakEvenSales, ...months.map((month) => month.sales)) * 1.12;
  const financial = plot('收入线与总成本线盈亏平衡图', 0, maxSales, 0,
    Math.max(price * maxSales, fixed + varRate * price * maxSales) * 1.05, '销量（' + orders + '）', '金额（' + currency + '）');
  const revenue = (q: number): Point => [financial.x(q), financial.y(price * q)];
  const cost = (q: number): Point => [financial.x(q), financial.y(fixed + varRate * price * q)];
  const crossing = revenue(breakEvenSales);
  const financialPaths = [
    ...financial.paths,
    band([revenue(0), cost(0), crossing], '#f8dfdc'),
    band([crossing, cost(maxSales), revenue(maxSales)], '#d6f0e9'),
    line([revenue(0), revenue(maxSales)], BLUE), line([cost(0), cost(maxSales)], RED),
  ];
  const balances = months.map(({ cumulativeProfit }) => cumulativeProfit);
  const cash = plot('24 个月累计净现金流', 0, 24, ...extent(balances), '月份', '累计净现金流（' + currency + '）');
  const cashPaths = [line([[cash.x(0), cash.y(0)], [cash.x(24), cash.y(0)]], INK, true),
    line([[cash.x(0), cash.y(0)], ...months.map(({ month, cumulativeProfit }): Point => [cash.x(month), cash.y(cumulativeProfit)])], BLUE)];
  const payback = paybackMonth === undefined ? undefined : months[paybackMonth - 1];
  return months.map((month) => {
    const metrics = [
      { label: '本月净利', value: money(month.profit, currency), emphasis: true },
      { label: '累计净现金流', value: money(month.cumulativeProfit, currency) },
      { label: '盈亏平衡销量', value: integer(Math.ceil(breakEvenSales)) + ' ' + orders },
      { label: '当前销量', value: integer(month.sales) + ' ' + orders },
      { label: '毛利率', value: percent(1 - varRate) },
      { label: '经营 ROI', value: month.roi === null ? '—' : percent(month.roi) },
      { label: '回本月份', value: paybackMonth === undefined ? '24 个月内未回本' : '第 ' + paybackMonth + ' 月' },
    ];
    let scene: ScienceScene;
    if (stage === 'main') {
      const [x, y] = revenue(month.sales);
      scene = {
        ...financial.scene,
        paths: [...financialPaths, line([[x, 51], [x, 202]], ORANGE, true)],
        points: [{ x: crossing[0], y: crossing[1], color: GREEN }, { x, y, color: ORANGE }],
        labels: [...financial.labels, label(171, 18, '收入', BLUE), label(217, 18, '总成本', RED),
          label(273, 18, '盈亏平衡点', GREEN), label(343, 18, '本月', ORANGE)],
      };
    } else if (stage === 'analysis') {
      const [r, g, n] = [month.revenue, month.grossProfit, month.profit];
      const waterfallMin = Math.min(0, n);
      const waterfallY = (amount: number) => 110 - 74 * (amount - waterfallMin) / (r - waterfallMin || 1);
      const steps = [
        { name: '营收', from: 0, to: r, color: BLUE },
        { name: '变动成本', from: r, to: g, color: RED },
        { name: '毛利', from: 0, to: g, color: BLUE },
        { name: '固定＋营销', from: g, to: n, color: RED },
        { name: '净利', from: 0, to: n, color: n < 0 ? RED : GREEN },
      ];
      const sensitivity = signedBars(['客单价 +10%', '客单价 −10%', '成本率 +10%', '成本率 −10%'],
        month.sensitivity, { top: 150, bottom: 233 }, Math.max(1, ...month.sensitivity.map(Math.abs)), currency);
      scene = {
        ariaLabel: '利润瀑布和单因素敏感性',
        paths: [...sensitivity.paths, line([[17, waterfallY(0)], [383, waterfallY(0)]], GRID)],
        labels: [label(18, 18, '利润瀑布（' + currency + '）'), label(18, 145, '本月净利变动（相对调整）'), ...sensitivity.labels,
          ...steps.flatMap(({ name, from, to }, i) => [label(54 + i * 73, 125, name, INK, 'middle'),
            label(54 + i * 73, Math.max(29, waterfallY(Math.max(from, to)) - 4), compact(to - from), INK, 'middle', 9)])],
        rects: [...sensitivity.rects, ...steps.map(({ from, to, color }, i) => ({
          x: 36 + i * 73, y: waterfallY(Math.max(from, to)), width: 36,
          height: Math.max(1, Math.abs(waterfallY(from) - waterfallY(to))), fill: color, stroke: 'none', opacity: .8,
        }))],
      };
    } else {
      scene = timePlot(cash, month.month, cashPaths, payback
        ? [label(370, 18, '第 ' + payback.month + ' 月回本', GREEN, 'end')]
        : [label(370, 18, '未回本', RED, 'end')]);
      scene.points = [{ x: cash.x(month.month), y: cash.y(month.cumulativeProfit), color: ORANGE }];
      if (payback) scene.points.push({ x: cash.x(payback.month), y: cash.y(payback.cumulativeProfit), color: GREEN });
    }
    return frame('第 ' + month.month + ' 个月 / 24', scene, metrics, '销量按月复合增长。累计净利润以 0 为期初现金流，ROI 按净利除以总经营成本计算。');
  });
}

export function funnelFrames(
  model: ReturnType<typeof calculateFunnel>, stage: 'main' | 'analysis' | 'summary',
  { currency = '元', impressions = '次', people = '人' }: Record<string, string>,
): ScienceFrame[] {
  const { funnel, names, weeks, ltv, conversion } = model;
  const [reach, , , paid, repeat] = names;
  const payingUsers = paid === '付费' ? '付费用户' : paid;
  const colors = [BLUE, '#3b68ba', '#5179c0', GREEN, '#319381'];
  const bars = funnel.map((value, i) => {
    const width = 145 * value / Math.max(1, funnel[0]!);
    const visibleWidth = width > 0 ? Math.max(1, width) : 0;
    return { x: 188 - visibleWidth / 2, y: 51 + i * 33, width: visibleWidth, height: 19, fill: colors[i], stroke: 'none' };
  });
  const funnelScene: ScienceScene = {
    ariaLabel: names.join('、') + '漏斗',
    rects: bars,
    labels: [label(20, 31, '漏斗环节'), label(188, 31, '相对首层规模', INK, 'middle'), label(270, 31, '数量 / 转化率 / 流失'),
      ...funnel.flatMap((value, i) => {
        const prior = funnel[i - 1];
        const y = 65 + i * 33;
        const unit = i < 2 ? impressions : people;
        return [chartName(20, y, names[i]!, 88), label(270, y - 4, integer(value) + ' ' + unit, INK, 'start', 9),
          label(270, y + 8, prior ? percent(value / prior) + ' / −' + integer(prior - value) : '— / —', INK, 'start', 9)];
      })],
  };
  const count = plot('12 周 Cohort 衰减与累计活跃对照', 1, 12, 0,
    Math.max(1, weeks.at(-1)!.improvedActive * 1.05), '周', '活跃' + payingUsers + '（' + people + '）',
    compact, (value) => value.toFixed(1).replace(/\.0$/, ''));
  const cohort = line(weeks.map(({ week, cohort }): Point => [count.x(week), count.y(cohort)]), BLUE, true);
  const improvedCohort = line(weeks.map(({ week, improvedCohort }): Point => [count.x(week), count.y(improvedCohort)]), GREEN, true);
  const active = line(weeks.map(({ week, active }): Point => [count.x(week), count.y(active)]), BLUE);
  const improved = line(weeks.map(({ week, improvedActive }): Point => [count.x(week), count.y(improvedActive)]), GREEN);
  const maximum = Math.max(1, ...weeks.flatMap(({ increments }) => increments));
  return weeks.map((week) => {
    const metrics = [
      { label: '累计预计营收', value: money(week.revenue, currency), emphasis: true },
      { label: '本周活跃' + paid, value: integer(week.active) + ' ' + people },
      { label: '本周首批队列', value: integer(week.cohort) + ' ' + people },
      { label: '留存提升新增活跃', value: integer(week.improvedActive - week.active) + ' ' + people },
      { label: '综合' + paid + '转化率', value: (conversion * 100).toFixed(3) + '%' },
      { label: payingUsers + '收入 LTV', value: money(ltv, currency) },
    ];
    const sensitivity = stage === 'analysis'
      ? signedBars([reach + ' +20%', paid + '率 +1 个百分点', (repeat === '次周复购' ? '留存' : repeat + '率') + ' +5 个百分点'],
        week.increments, { top: 65, bottom: 215 }, maximum, currency)
      : undefined;
    const scene = stage === 'main'
      ? { ...funnelScene, labels: [...funnelScene.labels!, label(20, 227, '第 ' + week.week + ' 周活跃' + paid + '：' + integer(week.active) + ' ' + people, BLUE)] }
      : sensitivity ? { ariaLabel: '增长杠杆的累计 GMV 增量', ...sensitivity,
        labels: [label(22, 29, '单因素对照 · 截至第 ' + week.week + ' 周的累计 GMV 增量'), ...sensitivity.labels] }
        : timePlot(count, week.week, [cohort, improvedCohort, active, improved], [
          label(176, 18, '基准', BLUE), label(213, 18, '留存 +5 个百分点', GREEN), label(174, 37, '实线 · 总活跃 / 虚线 · 首批队列'),
        ]);
    return frame('第 ' + week.week + ' 周 / 12', scene, metrics,
      '每周新增的' + payingUsers + '数量固定，每位留存活跃用户每周贡献一次 ARPU。');
  });
}

export function cpmFrames(
  model: ReturnType<typeof calculateCpm>, stage: 'main' | 'analysis' | 'summary',
  { time = '天' }: Record<string, string>,
): ScienceFrame[] {
  const { tasks, totalDays, paths, load, delay } = model;
  const nameWidth = Math.min(132, Math.max(80, ...tasks.map(({ id, name }) => [...id + ' ' + name].length * 9)));
  const plotLeft = 17 + nameWidth;
  const x = (day: number) => plotLeft + (374 - plotLeft) * day / totalDays;
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(totalDays * i / 4));
  const tickLabels = ticks.map((day) => label(x(day), 219, String(day), INK, 'middle'));
  const ganttPaths = ticks.map((day) => line([[x(day), 42], [x(day), 203]], GRID, true));
  const ganttRects = tasks.map((task, i) => ({
    x: x(task.es), y: 47 + i * 26, width: x(task.ef) - x(task.es), height: 16,
    fill: task.slack === 0 ? RED : BLUE, stroke: 'none',
  }));
  const slackPaths = tasks.flatMap((task, i) => {
    if (!task.slack) return [];
    const left = x(task.ef);
    const right = x(task.lf);
    const top = 47 + i * 26;
    return [line([[left, top], [right, top], [right, top + 16], [left, top + 16], [left, top]], BLUE, true)];
  });
  const slackMaximum = Math.max(1, ...tasks.map(({ slack }) => slack));
  const slackScene: ScienceScene = {
    ariaLabel: '各任务总浮动时间（Float）',
    paths: [line([[plotLeft + 8, 38], [plotLeft + 8, 210]], GRID)],
    rects: tasks.map(({ slack }, i) => ({
      x: plotLeft + 8, y: 46 + i * 27, width: slack * 184 / slackMaximum, height: 15, fill: BLUE, stroke: 'none',
    })),
    labels: [label(20, 23, '总浮动时间 · LS − ES（' + time + '）'),
      ...tasks.flatMap(({ id, name, slack }, i) => [chartName(20, 58 + i * 27, id + ' ' + name, nameWidth - 4),
        label(plotLeft + 13 + slack * 184 / slackMaximum, 58 + i * 27, slack === 0 ? '0 · 关键任务' : String(slack), slack === 0 ? RED : BLUE)])],
  };
  const workload = plot('并行人力负载', 0, totalDays, 0, 4, time, '并行任务数');
  const loadRects = load.slice(0, -1).map((count, day) => ({
    x: workload.x(day) + .6, y: workload.y(count), width: workload.x(day + 1) - workload.x(day) - 1.2,
    height: workload.y(0) - workload.y(count), fill: count > CPM_CAPACITY ? RED : BLUE, stroke: 'none', opacity: .8,
  }));
  const capacity = line([[workload.x(0), workload.y(CPM_CAPACITY)], [workload.x(totalDays), workload.y(CPM_CAPACITY)]], RED, true);
  const taskNames = Object.fromEntries(tasks.map(({ id, name }) => [id, name]));
  const criticalPaths = paths.map((path) => path.map((id) => id + ' ' + taskNames[id]).join(' → ')).join(' / ');
  return load.map((parallel, day) => {
    const active = tasks.filter(({ es, ef }) => es <= day && day < ef).map(({ name }) => name);
    const metrics = [
      { label: '总工期', value: totalDays + ' ' + time, emphasis: true },
      { label: '相对基准交付变化', value: (delay > 0 ? '+' : '') + delay + ' ' + time },
      { label: '关键路径', value: criticalPaths },
      { label: '当前并行任务', value: parallel + ' 项' },
      { label: '负载', value: parallel > CPM_CAPACITY ? '超负荷' : '正常' },
    ];
    const scene: ScienceScene = stage === 'main' ? {
      ariaLabel: '动态甘特图，关键路径与任务缓冲',
      paths: [...ganttPaths, ...slackPaths, line([[x(day), 40], [x(day), 203]], ORANGE, true)],
      rects: ganttRects,
      labels: [label(17, 24, '项目任务'), label(221, 24, '关键路径', RED), label(280, 24, '虚线 · 缓冲', BLUE),
        label(376, 235, time, INK, 'end'), ...tickLabels,
        ...tasks.map(({ id, name }, i) => chartName(16, 58 + i * 26, id + ' ' + name, nameWidth - 4))],
    } : stage === 'analysis' ? slackScene : {
      ...timePlot(workload, day, [capacity], [label(373, 18, '容量 · ' + CPM_CAPACITY + ' 项', RED, 'end')]),
      rects: loadRects,
    };
    return frame('第 ' + day + ' ' + time + ' / ' + totalDays, scene, metrics,
      (active.length ? '当前任务：' + active.join('、') + '。' : '项目已完成。') + '红色任务的总浮动时间为 0。');
  });
}

function formatP(value: number): string {
  if (value === 0) return '< 1e−300';
  return value < .001 ? value.toExponential(2) : value.toFixed(4);
}

export function abFrames(
  model: ReturnType<typeof calculateAbTest>, stage: 'main' | 'analysis' | 'summary',
  { samples = '人', time = '天' }: Record<string, string>,
): ScienceFrame[] {
  const { days, baseRate, experimentalRate, difference, alpha, requiredSamples } = model;
  const first = days[0]!;
  const rateMin = Math.min(baseRate - 4 * first.controlSE, baseRate - first.criticalDifference);
  const rateMax = Math.max(experimentalRate + 4 * first.experimentalSE, baseRate + first.criticalDifference);
  const upper = Math.min(1, Math.max(alpha, first.pValue) * 1.1);
  const timeAxis = '实验进度（' + time + '）';
  const pHistory = plot('双侧 p 值随实验进度变化', 1, 30, 0, upper, timeAxis, '预计双侧 p 值', (value) => value === 0 ? '0' : formatP(value));
  const pPath = line(days.map(({ day, pValue }): Point => [pHistory.x(day), pHistory.y(pValue)]), BLUE);
  const alphaLine = line([[pHistory.x(1), pHistory.y(alpha)], [pHistory.x(30), pHistory.y(alpha)]], RED, true);
  const [ciLow, ciHigh] = extent(first.confidenceInterval);
  const ciPlot = plot('实验组相对对照组的 95% 置信区间收敛带', 1, 30, ciLow, ciHigh, timeAxis,
    '转化率差（百分点）', (value) => (value * 100).toFixed(2));
  const lower = days.map(({ day, confidenceInterval }): Point => [ciPlot.x(day), ciPlot.y(confidenceInterval[0])]);
  const higher = days.map(({ day, confidenceInterval }): Point => [ciPlot.x(day), ciPlot.y(confidenceInterval[1])]);
  const interval = band([...lower, ...higher.reverse()], FAINT);
  const trueDiff = line([[ciPlot.x(1), ciPlot.y(difference)], [ciPlot.x(30), ciPlot.y(difference)]], BLUE);
  const zero = line([[ciPlot.x(1), ciPlot.y(0)], [ciPlot.x(30), ciPlot.y(0)]], RED, true);
  return days.map((day) => {
    const metrics = [
      { label: '预计 p 值', value: formatP(day.pValue), emphasis: true },
      { label: '统计功效', value: percent(day.power) },
      { label: '每组样本量', value: decimals.format(day.samples) + ' ' + samples },
      { label: '80% 功效所需每组样本', value: integer(requiredSamples) + ' ' + samples },
      { label: '95% 置信区间', value: day.confidenceInterval.map(pp).join(' 至 ') },
      { label: '建议继续观察', value: day.remaining + ' ' + time },
      { label: '全量发布判断', value: !day.adequateCounts ? '期望事件数不足' : day.significant && day.remaining === 0
        ? '模拟达标，待实测验证' : '尚未达到计划条件' },
    ];
    let scene: ScienceScene;
    if (stage === 'main') {
      const peak = normalDensity(0) / Math.min(day.controlSE, day.experimentalSE);
      const distribution = plot('对照组与实验组转化率抽样分布', rateMin, rateMax, 0, peak * 1.08,
        '样本转化率', '概率密度', compact, percent);
      function curve(mean: number, se: number): Point[] {
        const points: Point[] = [[distribution.x(rateMin), distribution.y(0)]];
        for (let i = -25; i <= 25; i++) {
          const rate = Math.max(rateMin, Math.min(rateMax, mean + i / 5 * se));
          points.push([distribution.x(rate), distribution.y(normalDensity((rate - mean) / se) / se)]);
        }
        return [...points, [distribution.x(rateMax), distribution.y(0)]];
      }
      const xLow = distribution.x(baseRate - day.criticalDifference);
      const xHigh = distribution.x(baseRate + day.criticalDifference);
      scene = {
        ...distribution.scene,
        rects: [
          { x: 55, y: 51, width: xLow - 55, height: 151, fill: '#f8dfdc', stroke: 'none', opacity: .65 },
          { x: xHigh, y: 51, width: 375 - xHigh, height: 151, fill: '#f8dfdc', stroke: 'none', opacity: .65 },
        ],
        paths: [...distribution.paths, line(curve(baseRate, day.controlSE), BLUE), line(curve(experimentalRate, day.experimentalSE), GREEN),
          line([[xLow, 51], [xLow, 202]], RED, true), line([[xHigh, 51], [xHigh, 202]], RED, true)],
        labels: [...distribution.labels, label(174, 18, 'A 组', BLUE), label(224, 18, 'B 组', GREEN),
          label(376, 18, '拒绝域边界', RED, 'end'), label(376, 37, '差值阈值以 A 组基准为原点', INK, 'end')],
      };
    } else if (stage === 'analysis') {
      scene = timePlot(ciPlot, day.day, [interval, trueDiff, zero],
        [label(375, 18, '95% 区间', BLUE, 'end')]);
      scene.points = day.confidenceInterval.map((limit) => ({ x: ciPlot.x(day.day), y: ciPlot.y(limit), color: ORANGE }));
    } else {
      scene = timePlot(pHistory, day.day, [pPath, alphaLine],
        [label(375, 18, '显著性线 α = ' + alpha.toFixed(2), RED, 'end')]);
      scene.points = [{ x: pHistory.x(day.day), y: pHistory.y(day.pValue), color: ORANGE }];
    }
    return frame('第 ' + day.day + ' ' + time + ' / 30', scene, metrics, !day.adequateCounts
      ? '至少一组期望事件数不足 5，正态近似较弱。'
      : '数值基于设定的真实转化率和固定样本双侧检验。实际发布判断需要预定样本结束后的观测数据。');
  });
}
