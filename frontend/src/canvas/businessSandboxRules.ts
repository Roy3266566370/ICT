/** 办公决策全景沙盘的确定性 aiRuleBlock 规则代码：随画布保存，由既有规则 Worker 沙箱执行。
 *
 * 约定与 physics/lab408 沙盘相同：每条规则是 `function run({ text, params, upstream, rand })`
 * 的字符串，返回 { data, frames }；frames 可含 shapes / grid / series / rows / timeline / graph。
 * upstream 中主输入口元素不带 `port` 键，aux 口元素带 `port:"aux"`；
 * series 上游序列化为 { kind:"series", title, labels, values }。
 */

const line = 'const line = (x1,y1,x2,y2,stroke,dashed=false) => ({ kind:"line", x1,y1,x2,y2,stroke,dashed,strokeWidth:1.6 });';
const dot = 'const dot = (cx,cy,fill,r=4) => ({ kind:"circle",cx,cy,r,fill });';
const box = 'const box = (x,y,w,h,fill,stroke="#8c95a4") => ({ kind:"rect",x,y,w,h,rx:4,fill,stroke });';
const label = 'const label = (x,y,text,fill="#344153",size=11) => ({ kind:"text",x,y,text,fill,size });';
const labelMid = 'const labelM = (x,y,text,fill="#344153",size=11) => ({ kind:"text",x,y,text,fill,size,anchor:"middle" });';
const arrow = 'const arrow = (x1,y1,x2,y2,stroke) => ({ kind:"arrow", x1,y1,x2,y2,stroke,strokeWidth:2 });';
const fmt = 'const fmt = (v, digits=3) => Number.isFinite(v) ? Number(v.toPrecision(digits)) : 0;';
const wan = 'const wan = (v) => Math.abs(v) >= 10000 ? (Math.round(v / 1000) / 10) + " 万" : String(Math.round(v));';
const inScalar = 'const inV = upstream.find(v => v.kind === "scalar" && v.port !== "aux")?.v;';
const auxScalar = 'const auxV = upstream.find(v => v.port === "aux" && v.kind === "scalar")?.v;';
const inSeries = 'const inS = upstream.find(v => v.kind === "series" && v.port !== "aux");';
const missSeries = 'return { data: {}, frames: [{ title: "等待输入", summary: "请把「表格/增长曲线」源的 series 输出接到本积木 in 口。" }] };';

export { line, dot, box, label, labelMid, arrow, fmt, wan, inScalar, auxScalar, inSeries, missSeries };

/* ============================== 财务 · 盈亏敏感性与回本 ============================== */

/** 客单价 × 变动成本率二维月净利敏感性热图（diverging 盈亏分界），activeCell 标记当前经营点。 */
export const sensGridRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${wan}
  const price = Math.max(1, Math.round(inV ?? params.price ?? 120));
  const varRate = Math.max(0, Math.min(0.9, params.varRate ?? 0.35));
  const fixed = Math.max(0, (params.fixedCost ?? 200000) + (params.adBudget ?? 50000));
  const sales = Math.max(1, Math.round(params.monthlySales ?? 2500));
  const profit = (p, r) => p * (1 - r) * sales - fixed;
  const prices = Array.from({ length: 9 }, (_, i) => Math.max(1, Math.round(price * 0.7 * (1 + i * 0.107))));
  const rates = Array.from({ length: 8 }, (_, i) => Math.round((0.15 + i * 0.05) * 100) / 100);
  const cells = prices.map((p) => rates.map((r) => Math.round(profit(p, r) / 1000)));
  const bound = Math.max(10, ...cells.flat().map(Math.abs));
  const ri = prices.reduce((b, p, i) => Math.abs(p - price) < Math.abs(prices[b] - price) ? i : b, 0);
  const ci = rates.reduce((b, r, j) => Math.abs(r - varRate) < Math.abs(rates[b] - varRate) ? j : b, 0);
  return { data: { price, varRate, monthlyNet: Math.round(profit(price, varRate)), breakEvenPrice: fmt(fixed / ((1 - varRate) * sales), 4) },
    frames: [{
      title: "月净利敏感性（千元）", summary: "当前价 " + price + " 元、变动成本率 " + Math.round(varRate * 100) + "% → 月净利 " + wan(profit(price, varRate)) + " 元；红盈蓝亏，框选为当前经营点",
      grid: {
        colLabels: rates.map((r) => Math.round(r * 100) + "%"),
        rowLabels: prices.map((p) => "¥" + p),
        cells, palette: "diverging", min: -bound, max: bound, showValues: true,
        activeCell: [ri, ci],
      },
      columns: ["变动成本率", "盈亏平衡客单价"],
      rows: rates.map((r) => [Math.round(r * 100) + "%", Math.round(fixed / Math.max(1e-9, (1 - r) * sales)) + " 元"]),
    }] };
}`;

/** 销量序列驱动的累计净利曲线：回本月份、盈亏平衡销量、单笔贡献毛利。 */
export const paybackRule = `function run({ params, upstream }) {
  ${inSeries}
  ${auxScalar}
  ${fmt}
  ${wan}
  if (!inS) { ${missSeries} }
  const price = Math.max(1, auxV ?? params.price ?? 120);
  const varRate = Math.max(0, Math.min(0.9, params.varRate ?? 0.35));
  const fixed = Math.max(0, (params.fixedCost ?? 200000) + (params.adBudget ?? 50000));
  const margin = price * (1 - varRate);
  const beSales = Math.ceil(fixed / Math.max(1e-9, margin));
  let cum = 0;
  const profits = inS.values.map((s) => s * margin - fixed);
  const curve = profits.map((p) => (cum += p));
  const ix = curve.findIndex((v) => v >= 0);
  return { data: { breakEvenSales: beSales, marginPerUnit: fmt(margin, 4), paybackMonth: ix < 0 ? -1 : ix + 1, finalCum: Math.round(cum), monthlyNet0: Math.round(profits[0] ?? 0) },
    frames: [{
      title: "累计净利曲线", summary: ix < 0
        ? "固定开销 " + wan(fixed) + " 元需月销 ≥" + beSales + " 单才平衡；当前走势 " + curve.length + " 期内未回本（期末 " + wan(cum) + "）"
        : "单笔贡献毛利 " + fmt(margin, 4) + " 元 → 第 " + (ix + 1) + " 期累计转正；盈亏平衡销量 " + beSales + " 单/期",
      series: [
        { label: "累计净利", values: curve.map(Math.round) },
        { label: "当期净利", values: profits.map(Math.round) },
        { label: "零线", values: curve.map(() => 0) },
      ],
      labels: inS.labels,
      columns: ["期", "销量", "当期净利", "累计净利"],
      rows: inS.labels.slice(0, 16).map((l, i) => [l, Math.round(inS.values[i] ?? 0), Math.round(profits[i] ?? 0), Math.round(curve[i] ?? 0)]),
      highlightRows: ix >= 0 && ix < 16 ? [ix] : [],
    }] };
}`;

/* ============================== 财务 · NPV 与蒙特卡洛风险 ============================== */

/** 蒙特卡洛 NPV 分布：现金流序列 × 波动幅度抽样，P(NPV<0) 与 P10/P50/P90 分位。 */
export const mcRiskRule = `function run({ params, upstream, rand }) {
  ${inSeries}
  ${auxScalar}
  ${fmt}
  ${wan}
  if (!inS) { ${missSeries} }
  const R = typeof rand === "function" ? rand : () => 0.5;
  const wacc = Math.max(0, Math.min(0.5, auxV ?? params.wacc ?? 0.1));
  const invest = Math.max(0, params.investment ?? 1000000);
  const spread = Math.max(0.05, Math.min(0.8, params.spread ?? 0.25));
  const sims = Math.max(100, Math.min(800, Math.round(params.sims ?? 500)));
  const disc = wacc / 12;
  const npvs = [];
  for (let s = 0; s < sims; s++) {
    let npv = -invest;
    inS.values.forEach((cf, i) => { npv += cf * (1 + (R() * 2 - 1) * spread) / Math.pow(1 + disc, i + 1); });
    npvs.push(npv);
  }
  npvs.sort((a, b) => a - b);
  const q = (p) => npvs[Math.min(sims - 1, Math.max(0, Math.round(p * (sims - 1))))];
  const pLoss = npvs.filter((v) => v < 0).length / sims;
  const bins = 20;
  const lo = npvs[0], hi = npvs[sims - 1], width = Math.max(1e-6, (hi - lo) / bins);
  const hist = Array.from({ length: bins }, (_, i) => npvs.filter((v) => v >= lo + i * width && (i === bins - 1 ? v <= hi : v < lo + (i + 1) * width)).length);
  return { data: { sims, pLoss: fmt(pLoss, 4), p10: Math.round(q(0.1)), p50: Math.round(q(0.5)), p90: Math.round(q(0.9)), mean: Math.round(npvs.reduce((a, b) => a + b, 0) / sims) },
    frames: [{
      title: "NPV 蒙特卡洛分布（" + sims + " 次）", summary: "每期现金流 ±" + Math.round(spread * 100) + "% 波动 · 年折现 " + (wacc * 100).toFixed(1) + "% → P(NPV<0)=" + (pLoss * 100).toFixed(1) + "%，P50=" + wan(q(0.5)) + " 元",
      series: [{ label: "频次", values: hist }],
      labels: hist.map((_, i) => fmt((lo + (i + 0.5) * width) / 10000, 3) + "万"),
      columns: ["指标", "值"],
      rows: [["P10（悲观）", wan(q(0.1))], ["P50（中位）", wan(q(0.5))], ["P90（乐观）", wan(q(0.9))], ["P(NPV<0)", (pLoss * 100).toFixed(1) + "%"], ["期初投入", wan(invest)]],
    }] };
}`;

/* ============================== 增长 · 漏斗、Cohort 与 LTV ============================== */

/** 五层增长漏斗与最大流失瓶颈高亮。 */
export const funnelRule = `function run({ params, upstream }) {
  ${inScalar}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const imp = Math.max(1000, Math.round(params.impressions ?? 200000));
  const ctr = Math.max(0.005, Math.min(0.5, params.ctr ?? 0.05));
  const reg = Math.max(0.02, Math.min(0.9, params.regRate ?? 0.25));
  const pay = Math.max(0.002, Math.min(0.6, inV ?? params.payRate ?? 0.08));
  const repeat = Math.max(0.05, Math.min(0.95, params.retention ?? 0.65));
  const layers = [
    { name: "曝光", v: imp }, { name: "点击", v: imp * ctr },
    { name: "注册", v: imp * ctr * reg }, { name: "付费", v: imp * ctr * reg * pay },
    { name: "次周复购", v: imp * ctr * reg * pay * repeat },
  ];
  const rates = [ctr, reg, pay, repeat];
  const names = ["点击率", "注册率", "付费转化率", "复购留存"];
  const worst = rates.indexOf(Math.min(...rates));
  const colors = ["#dbe7ff", "#c9dcf8", "#b4cff2", "#ffd9c2", "#ffe3d6"];
  const items = [];
  layers.forEach((l, i) => {
    const w = 300 * Math.pow(Math.max(0.05, l.v / imp), 0.35);
    items.push(box(50 + (300 - w) / 2, 14 + i * 34, w, 26, colors[i], i - 1 === worst ? "#b15236" : "#8c95a4"));
    items.push(labelM(200, 31 + i * 34, l.name + "  " + (l.v >= 10000 ? fmt(l.v / 10000, 3) + "万" : String(Math.round(l.v))), "#344153", 10));
    if (i > 0) items.push(label(356, 31 + i * 34, Math.round(rates[i - 1] * 100) + "%" + (i - 1 === worst ? " 瓶颈" : ""), i - 1 === worst ? "#b15236" : "#8c95a4", 9));
  });
  return { data: { paid: Math.round(layers[3].v), bottleneck: names[worst], overallConv: fmt(ctr * reg * pay, 4) },
    frames: [{
      title: "五层增长漏斗", summary: "曝光→付费整体转化 " + fmt(ctr * reg * pay * 100, 3) + "%；最大流失瓶颈：" + names[worst],
      shapes: { viewBox: [450, 190], items },
    }] };
}`;

/** 12 周 Cohort 留存三角热图：行=获客周、列=存活周龄，上三角 mask 隐藏。 */
export const cohortGridRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const r = Math.max(0.05, Math.min(0.98, inV ?? params.retention ?? 0.65));
  const weeks = Math.max(8, Math.min(12, Math.round(params.weeks ?? 12)));
  const cells = Array.from({ length: weeks }, (_, c) => Array.from({ length: weeks }, (_, a) => Math.round(Math.pow(r, a) * 1000) / 1000));
  const mask = cells.map((row, c) => row.map((_, a) => c + a >= weeks));
  const w12 = Math.pow(r, weeks - 1);
  const half = r > 0 && r < 1 ? Math.log(0.5) / Math.log(r) : 0;
  return { data: { retention: r, week12Rate: fmt(w12, 4), halfLifeWeeks: fmt(half, 3) },
    frames: [{
      title: "Cohort 留存热图", summary: "周留存 " + Math.round(r * 100) + "% → 第 " + weeks + " 周龄仅剩 " + (w12 * 100).toFixed(1) + "%；半衰期 ≈ " + fmt(half, 3) + " 周",
      grid: {
        colLabels: Array.from({ length: weeks }, (_, i) => "W" + i),
        rowLabels: Array.from({ length: weeks }, (_, i) => "W" + (i + 1) + "新增"),
        cells, mask, palette: "heat", min: 0, max: 1, showValues: true,
      },
      columns: ["周龄", "存活率"],
      rows: [0, 1, 3, 7, weeks - 1].filter((a) => a < weeks).map((a) => ["W" + a, (Math.pow(r, a) * 100).toFixed(1) + "%"]),
    }] };
}`;

/** 留存 +5pp vs 曝光翻倍的 12 周累计 GMV 对照与 LTV/CAC。 */
export const ltvCurveRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${wan}
  const r = Math.max(0.05, Math.min(0.95, inV ?? params.retention ?? 0.65));
  const imp = Math.max(1000, Math.round(params.impressions ?? 200000));
  const conv = Math.max(1e-6, (params.ctr ?? 0.05) * (params.regRate ?? 0.25) * (params.payRate ?? 0.08));
  const arpu = Math.max(1, params.arpu ?? 120);
  const cac = Math.max(1, params.cac ?? 400);
  const weeks = 12;
  const paid = imp * conv;
  const weekly = (np, rr) => { let act = 0; return Array.from({ length: weeks }, () => (act = np + act * rr) * arpu); };
  const cum = (arr) => { let s = 0; return arr.map((v) => (s += v)); };
  const base = cum(weekly(paid, r));
  const upRet = cum(weekly(paid, Math.min(0.98, r + 0.05)));
  const upReach = cum(weekly(paid * 2, r));
  const ltv = arpu / (1 - r);
  const labels = Array.from({ length: weeks }, (_, i) => "W" + (i + 1));
  return { data: { ltv: fmt(ltv, 4), ltvCac: fmt(ltv / cac, 3), gmvBase: Math.round(base[weeks - 1]), gainRet5: Math.round(upRet[weeks - 1] - base[weeks - 1]), gainReach2x: Math.round(upReach[weeks - 1] - base[weeks - 1]) },
    frames: [{
      title: "12 周累计 GMV 三情景", summary: "留存+5pp 增益 " + wan(upRet[weeks - 1] - base[weeks - 1]) + " 元 vs 曝光×2 增益 " + wan(upReach[weeks - 1] - base[weeks - 1]) + " 元；LTV=" + wan(ltv) + "，LTV/CAC=" + fmt(ltv / cac, 3),
      series: [
        { label: "基准 r=" + Math.round(r * 100) + "%", values: base.map(Math.round) },
        { label: "留存+5pp", values: upRet.map(Math.round) },
        { label: "曝光×2", values: upReach.map(Math.round) },
      ],
      labels,
      columns: ["杠杆", "12周累计增量", "LTV"],
      rows: [["留存 +5pp", wan(upRet[weeks - 1] - base[weeks - 1]), wan(arpu / (1 - Math.min(0.98, r + 0.05)))], ["曝光 ×2", wan(upReach[weeks - 1] - base[weeks - 1]), wan(ltv)]],
    }] };
}`;

/* ============================== 交付 · CPM 关键路径与人力负载 ============================== */

const cpmSim = `const TASKS = [
  { id: "T1", name: "需求评审", dur: 3, after: [], staff: 1 },
  { id: "T2", name: "前端开发", dur: 6, after: ["T1"], staff: 2, scalable: 1 },
  { id: "T3", name: "后端接口", dur: 7, after: ["T1"], staff: 3, scalable: 1 },
  { id: "T4", name: "UI 设计", dur: 4, after: ["T1"], staff: 1 },
  { id: "T5", name: "联调测试", dur: 4, after: ["T2", "T3", "T4"], staff: 2 },
  { id: "T6", name: "灰度上线", dur: 2, after: ["T5"], staff: 1 },
];
const cpm = (delay, boost, taskSel) => {
  const tasks = []; const byId = {};
  TASKS.forEach((t) => {
    const base = t.scalable ? Math.ceil(t.dur / boost) : t.dur;
    const dur = base + (t.id === "T" + (taskSel || 3) ? delay : 0);
    const es = Math.max(0, ...t.after.map((a) => byId[a].ef));
    const task = { id: t.id, name: t.name, dur, staff: t.staff, after: t.after, es, ef: es + dur, ls: 0, lf: 0, slack: 0 };
    byId[task.id] = task; tasks.push(task);
  });
  const total = Math.max(...tasks.map((t) => t.ef));
  [...tasks].reverse().forEach((t) => {
    t.lf = Math.min(total, ...tasks.filter((s) => s.after.includes(t.id)).map((s) => s.ls));
    t.ls = t.lf - t.dur;
    t.slack = t.ls - t.es;
  });
  const crit = new Set(tasks.filter((t) => t.slack === 0).map((t) => t.id));
  const load = Array.from({ length: total + 1 }, (_, d) => tasks.filter((t) => t.es <= d && d < t.ef).reduce((s, t) => s + t.staff, 0));
  return { tasks, total, crit, load };
};`;

/** 依赖图：关键路径 active 高亮，节点标签含工期与浮动。 */
export const depGraphRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${cpmSim}
  const delay = Math.max(0, Math.min(10, Math.round(inV ?? params.delay ?? 0)));
  const boost = Math.max(0.5, Math.min(1.5, params.boost ?? 1));
  const taskSel = Math.round(params.taskSel ?? 3);
  const { tasks, total, crit } = cpm(delay, boost, taskSel);
  const pos = { T1: [12, 50], T2: [38, 14], T3: [38, 50], T4: [38, 86], T5: [66, 50], T6: [88, 50] };
  return { data: { totalDays: total, critical: tasks.filter((t) => crit.has(t.id)).map((t) => t.id), slacks: Object.fromEntries(tasks.map((t) => [t.id, t.slack])) },
    frames: [{
      title: "依赖图 · 关键路径", summary: "T" + taskSel + " 延期 " + delay + " 天 → 总工期 " + total + " 天；高亮为关键路径（浮动=0，一延全延）",
      graph: {
        nodes: tasks.map((t) => ({ id: t.id, x: pos[t.id][0], y: pos[t.id][1], label: t.name + " " + t.dur + "d·浮" + t.slack, active: crit.has(t.id) })),
        edges: tasks.flatMap((t) => t.after.map((a) => ({ from: a, to: t.id, label: "", active: crit.has(a) && crit.has(t.id) }))),
      },
      columns: ["任务", "工期", "最早开始", "最晚开始", "浮动"],
      rows: tasks.map((t) => [t.name, t.dur + "d", "D" + t.es, "D" + t.ls, t.slack + "d"]),
    }] };
}`;

/** CPM 甘特排期：延期沿依赖传导、关键路径切换逐帧推演。 */
export const ganttRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${cpmSim}
  const delay = Math.max(0, Math.min(10, Math.round(inV ?? params.delay ?? 0)));
  const boost = Math.max(0.5, Math.min(1.5, params.boost ?? 1));
  const taskSel = Math.round(params.taskSel ?? 3);
  const { tasks, total, crit } = cpm(delay, boost, taskSel);
  const frames = tasks.map((t) => ({
    title: "排期 · " + t.name,
    summary: t.id + "：" + t.dur + " 天，ES=D" + t.es + " EF=D" + t.ef + "，浮动 " + t.slack + " 天" + (crit.has(t.id) ? " · 关键任务" : " · 有缓冲"),
    timeline: tasks.map((x) => ({
      label: x.name + (crit.has(x.id) ? " ★" : ""),
      segments: [{ label: x.id === t.id ? "◀ " + x.dur + "d" : x.dur + "d", start: x.es, end: x.ef }],
    })),
  }));
  return { data: { totalDays: total, critical: tasks.filter((t) => crit.has(t.id)).map((t) => t.id), delayEffect: total - 16 }, frames };
}`;

/** 每日并发人力需求 vs 上限红线（超载日告警）。 */
export const loadRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${fmt}
  ${cpmSim}
  const cap = Math.max(1, Math.min(8, Math.round(inV ?? params.cap ?? 4)));
  const delay = Math.max(0, Math.min(10, Math.round(auxV ?? params.delay ?? 0)));
  const { load, total } = cpm(delay, 1, 3);
  const over = load.map((v, d) => (v > cap ? d : -1)).filter((d) => d >= 0);
  const peak = Math.max(...load);
  return { data: { cap, peak, overDays: over, totalDays: total, util: fmt(load.reduce((a, b) => a + b, 0) / ((total + 1) * cap), 3) },
    frames: [{
      title: "人力负载 vs 上限 " + cap + " 人", summary: "峰值并发 " + peak + " 人" + (over.length ? "，第 " + over.map((d) => "D" + d).join("/") + " 天超载 " + (peak - cap) + " 人——削峰或加人" : "，未超载"),
      series: [
        { label: "并发人力需求", values: load },
        { label: "人力上限", values: load.map(() => cap) },
      ],
      labels: load.map((_, d) => "D" + d),
      columns: ["日", "需求(人)", "超载"], rows: load.map((v, d) => [d, v]).filter((p) => p[1] > cap).map((p) => ["D" + p[0], p[1], "+" + (p[1] - cap)]),
    }] };
}`;

/* ============================== 增长 · A/B 实验 ============================== */

const abMath = `const Z = { "0.01": 2.5758293035489004, "0.05": 1.959963984540054, "0.1": 1.6448536269514722 };
const Z80 = 0.8416212335729143;
const nTail = (z) => {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const rem = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return z < 0 ? 1 - 0.5 * rem : 0.5 * rem;
};
const abCalc = (p0, lift, traffic, alpha) => {
  const p1 = p0 * (1 + lift), diff = p1 - p0;
  const pooled = (p0 + p1) / 2;
  const nullS = Math.sqrt(2 * pooled * (1 - pooled));
  const altS = Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1));
  const zc = Z[alpha.toFixed(2)] ?? Z["0.05"];
  const reqN = Math.ceil(Math.pow((zc * nullS + Z80 * altS) / Math.max(1e-9, diff), 2));
  const days = Array.from({ length: 30 }, (_, i) => {
    const n = traffic * (i + 1) / 2, rn = Math.sqrt(n);
    const crit = zc * nullS / rn;
    return { day: i + 1, n, power: nTail((crit - diff) * rn / altS) + nTail((crit + diff) * rn / altS), p: 2 * nTail(diff * rn / nullS) };
  });
  return { reqN, days, daysReq: Math.ceil(reqN * 2 / traffic), p1, altS };
};`;

/** A/B 样本量与功效随天数增长曲线，标注 80% 功效达标日。 */
export const abPowerRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${abMath}
  const traffic = Math.max(100, Math.round(inV ?? params.traffic ?? 4000));
  const p0 = Math.max(0.005, Math.min(0.7, params.baseRate ?? 0.1));
  const lift = Math.max(0.01, Math.min(0.5, params.lift ?? 0.12));
  const alpha = Math.abs(params.alpha - 0.01) < 1e-9 ? 0.01 : Math.abs(params.alpha - 0.1) < 1e-9 ? 0.1 : 0.05;
  const { reqN, days, daysReq, p1 } = abCalc(p0, lift, traffic, alpha);
  return { data: { requiredSamples: reqN, daysRequired: daysReq, power30: fmt(days[29].power, 4), experimentalRate: fmt(p1, 4) },
    frames: [{
      title: "统计功效增长曲线", summary: "p0=" + (p0 * 100).toFixed(1) + "% 相对提升 " + (lift * 100).toFixed(0) + "% → 每组需 " + reqN.toLocaleString() + " 样本；日流量 " + traffic.toLocaleString() + " 约 " + daysReq + " 天达 80% 功效",
      series: [
        { label: "统计功效", values: days.map((d) => fmt(d.power, 4)) },
        { label: "80% 功效线", values: days.map(() => 0.8) },
      ],
      labels: days.map((d) => "D" + d.day),
      columns: ["指标", "值"], rows: [["每组所需样本", reqN.toLocaleString()], ["达标天数(近似)", daysReq + " 天"], ["30 天功效", fmt(days[29].power, 3)]],
    }] };
}`;

/** 95% 置信区间随天数收窄演化：下沿跨 0 即显著。 */
export const ciEvolutionRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${abMath}
  ${label}
  ${dot}
  ${line}
  const traffic = Math.max(100, Math.round(inV ?? params.traffic ?? 4000));
  const p0 = Math.max(0.005, Math.min(0.7, params.baseRate ?? 0.1));
  const lift = Math.max(0.01, Math.min(0.5, params.lift ?? 0.12));
  const { altS } = abCalc(p0, lift, traffic, 0.05);
  const diff = p0 * lift;
  const marks = [1, 3, 7, 14, 21, 30];
  const scale = 300 / Math.max(0.02, diff * 3);
  const x0 = 60;
  const items = [
    label(16, 16, "95% CI 演化（效应差 " + fmt(diff * 100, 3) + "pp）", "#344153", 10),
    line(x0, 24, x0, 172, "#b15236"), label(x0 - 4, 184, "0", "#b15236", 9),
  ];
  marks.forEach((d, i) => {
    const n = traffic * d / 2;
    const m = 1.959964 * altS / Math.sqrt(n);
    const lo = diff - m, hi = diff + m;
    const y = 32 + i * 24;
    items.push(line(Math.max(x0 + 2, x0 + lo * scale), y, Math.min(390, x0 + hi * scale), y, lo > 0 ? "#1f7a3d" : "#4f46e5"));
    items.push(dot(x0 + diff * scale, y, "#344153", 3));
    items.push(label(20, y + 4, "D" + d, "#8c95a4", 9));
    items.push(label(350, y + 4, lo > 0 ? "显著" : "跨0", lo > 0 ? "#1f7a3d" : "#8c95a4", 9));
  });
  const sig = marks.find((d) => diff - 1.959964 * altS / Math.sqrt(traffic * d / 2) > 0);
  return { data: { effectPp: fmt(diff * 100, 3), firstSignificantDay: sig ?? -1 },
    frames: [{ title: "置信区间收窄", summary: "区间随 √n 收窄，下沿跨过 0 即达显著；最早显著日：" + (sig ? "第 " + sig + " 天" : "30 天内未显著"), shapes: { viewBox: [400, 195], items } }] };
}`;

/** 早停陷阱：A/A 实验每日偷看 p<0.05，部分和过程模拟假阳性率飙升。 */
export const peekTrapRule = `function run({ params, upstream, rand }) {
  ${inScalar}
  ${fmt}
  const traffic = Math.max(100, Math.round(inV ?? params.traffic ?? 4000));
  const sims = Math.max(100, Math.min(500, Math.round(params.sims ?? 300)));
  const days = 30;
  const R = typeof rand === "function" ? rand : () => 0.5;
  const gauss = () => (R() + R() + R() + R() + R() + R() - 3) * 1.4142;
  const hitBy = Array(days).fill(0);
  for (let s = 0; s < sims; s++) {
    let sum = 0;
    for (let d = 1; d <= days; d++) {
      sum += gauss();
      if (Math.abs(sum / Math.sqrt(d)) > 1.959964) { hitBy[d - 1]++; break; }
    }
  }
  let acc = 0;
  const fp = hitBy.map((h) => (acc += h) / sims);
  return { data: { sims, days, fpRate30: fmt(fp[days - 1], 4), fpRate7: fmt(fp[6], 4), traffic },
    frames: [{
      title: "每日偷看 p 值的假阳性率", summary: "A/A 真实无差异：" + sims + " 次模拟中每天检验 p<0.05 → " + (fp[days - 1] * 100).toFixed(1) + "% 曾误报显著（固定时点名义 α 仅 5%）——必须定好样本量再看",
      series: [
        { label: "累计误判率（每日偷看）", values: fp.map((v) => fmt(v, 4)) },
        { label: "固定时点名义 α=5%", values: fp.map(() => 0.05) },
      ],
      labels: fp.map((_, i) => "D" + (i + 1)),
    }] };
}`;

/* ============================== 交付 · EOQ 与排队 ============================== */

/** EOQ 经济订货批量：总成本 U 型曲线与最优批量（上游日需求×300 折算年需求）。 */
export const eoqRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${wan}
  const daily = Math.max(5, inV ?? params.demand ?? 120);
  const D = Math.round(daily * 300);
  const K = Math.max(1, params.orderCost ?? 300);
  const h = Math.max(0.1, params.holdCost ?? 6);
  const eoq = Math.sqrt(2 * D * K / h);
  const tc = (q) => D / q * K + q / 2 * h;
  const qs = Array.from({ length: 24 }, (_, i) => Math.round(eoq * (0.2 + i * 0.1)));
  const tcs = qs.map((q) => Math.round(tc(q)));
  return { data: { eoq: Math.round(eoq), minCost: Math.round(tc(eoq)), costAtHalf: Math.round(tc(eoq / 2)), costAt2x: Math.round(tc(eoq * 2)) },
    frames: [{
      title: "EOQ 总成本曲线", summary: "年需求 " + wan(D) + " 件 · 单次订货费 " + K + " 元 · 年持有费 " + h + " 元/件 → EOQ=" + Math.round(eoq) + " 件，最低年成本 " + wan(tc(eoq)) + " 元",
      series: [
        { label: "总成本 TC(Q)", values: tcs },
        { label: "最低成本线", values: qs.map(() => Math.round(tc(eoq))) },
      ],
      labels: qs.map((q) => "Q=" + q),
      columns: ["订货量", "相对 EOQ", "年总成本"],
      rows: [[Math.round(eoq / 2), "0.5×", wan(tc(eoq / 2))], [Math.round(eoq), "EOQ", wan(tc(eoq))], [Math.round(eoq * 2), "2×", wan(tc(eoq * 2))]],
    }] };
}`;

/** 随机日需求下的库存锯齿、再订点补货与缺货警报（确定性种子）。 */
export const stockSimRule = `function run({ params, upstream, rand }) {
  ${inScalar}
  ${fmt}
  const mean = Math.max(10, Math.round(inV ?? params.demand ?? 120));
  const sd = Math.max(1, params.sd ?? 30);
  const q = Math.max(50, Math.round(params.reorderQ ?? 400));
  const rop = Math.max(0, Math.round(params.rop ?? 300));
  const lead = Math.max(1, Math.round(params.leadTime ?? 3));
  const days = Math.max(20, Math.min(60, Math.round(params.days ?? 40)));
  const R = typeof rand === "function" ? rand : () => 0.5;
  const gauss = () => (R() + R() + R() + R() + R() + R() - 3) / 1.5;
  let stock = rop + q, pending = -1;
  const inv = [], events = [];
  let stockouts = 0, orders = 0;
  for (let d = 0; d < days; d++) {
    if (pending >= 0 && d >= pending) { stock += q; pending = -1; events.push("D" + (d + 1) + " 到货 +" + q); }
    const dem = Math.max(0, Math.round(mean + gauss() * sd));
    stock -= dem;
    if (stock < 0) { stockouts++; events.push("D" + (d + 1) + " 缺货 " + -stock + " 单"); stock = 0; }
    if (stock <= rop && pending < 0) { pending = d + lead; orders++; events.push("D" + (d + 1) + " 下单 " + q); }
    inv.push(stock);
  }
  return { data: { stockouts, orders, serviceLevel: fmt(1 - stockouts / days, 4), endStock: stock },
    frames: [{
      title: "库存锯齿模拟（再订点 " + rop + "）", summary: "日需求 ~N(" + mean + "," + sd + "²) · 批量 " + q + " · 提前期 " + lead + "天 → " + days + " 天缺货 " + stockouts + " 次，服务水平 " + ((1 - stockouts / days) * 100).toFixed(0) + "%",
      series: [
        { label: "库存水位", values: inv },
        { label: "再订点", values: inv.map(() => rop) },
        { label: "零线", values: inv.map(() => 0) },
      ],
      labels: inv.map((_, i) => "D" + (i + 1)),
      columns: ["事件"], rows: events.slice(0, 16).map((e) => [e]),
    }] };
}`;

/** M/M/s 排队：客服数 vs 平均等待，利用率逼近 100% 等待时间爆炸。 */
export const queueRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const lam = Math.max(0.5, params.lambda ?? 20);
  const mu = Math.max(0.5, params.mu ?? 8);
  const maxS = Math.max(3, Math.min(10, Math.round(params.maxS ?? 8)));
  const cur = Math.max(1, Math.min(12, Math.round(inV ?? params.agents ?? 3)));
  const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const wq = (s) => {
    const a = lam / mu, rho = a / s;
    if (rho >= 1) return -1;
    let sum = 0;
    for (let k = 0; k < s; k++) sum += Math.pow(a, k) / fact(k);
    const p0 = 1 / (sum + Math.pow(a, s) / (fact(s) * (1 - rho)));
    return Math.pow(a, s) / (fact(s) * (1 - rho)) * p0 / (s * mu - lam);
  };
  const curve = Array.from({ length: maxS }, (_, i) => { const w = wq(i + 1); return w < 0 ? 90 : Math.min(90, fmt(w * 60, 3)); });
  const rho = lam / (cur * mu);
  const wNow = wq(cur);
  return { data: { agents: cur, rho: fmt(rho, 3), waitMin: wNow < 0 ? -1 : fmt(wNow * 60, 3), stable: rho < 1 },
    frames: [{
      title: "M/M/s 平均排队时间", summary: "λ=" + lam + "/时，μ=" + mu + "/时·人 → s=" + cur + " 利用率 " + Math.round(rho * 100) + "%" + (rho >= 1 ? "，系统发散（队列无限增长）" : "，平均排队 " + fmt(wNow * 60, 2) + " 分钟") + "；ρ>85% 后等待陡增",
      series: [{ label: "平均排队(分，发散记90)", values: curve }],
      labels: curve.map((_, i) => "s=" + (i + 1)),
      columns: ["客服数", "利用率", "平均等待"],
      rows: curve.map((w, i) => ["s=" + (i + 1), Math.round(lam / ((i + 1) * mu) * 100) + "%", wq(i + 1) < 0 ? "∞ 发散" : w + " 分"]),
    }] };
}`;

/* ============================== 战略 · 决策矩阵与预算 ============================== */

const DECISIONS = [
  { name: "稳健方案", s: [72, 64, 86, 68] },
  { name: "增长方案", s: [56, 70, 58, 92] },
  { name: "低成本方案", s: [92, 82, 66, 55] },
  { name: "平衡方案", s: [76, 74, 74, 78] },
];

const decScore = `const DEC = ${JSON.stringify(DECISIONS)};
const dScore = (d, w) => { const ws = [w, (1 - w) / 3, (1 - w) / 3, (1 - w) / 3]; return d.s.reduce((t, v, i) => t + v * ws[i], 0); };
const dFirst = (w) => DEC.reduce((b, d) => dScore(d, w) > dScore(b, w) ? d : b, DEC[0]);`;

/** 方案得分随成本权重变化：找到第一名翻转阈值。 */
export const weightFlipRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${decScore}
  const w = Math.max(0, Math.min(1, inV ?? params.costW ?? 0.25));
  const xs = Array.from({ length: 21 }, (_, i) => i / 20);
  const lines = DEC.map((d) => ({ label: d.name, values: xs.map((x) => fmt(dScore(d, x), 3)) }));
  let flip = -1;
  for (let i = 1; i < xs.length; i++) { if (dFirst(xs[i]).name !== dFirst(xs[i - 1]).name) { flip = xs[i]; break; } }
  const ranked = DEC.map((d) => ({ name: d.name, score: dScore(d, w) })).sort((a, b) => b.score - a.score);
  return { data: { costW: fmt(w, 3), winner: ranked[0].name, flipAt: flip < 0 ? -1 : fmt(flip, 2), scores: Object.fromEntries(ranked.map((r) => [r.name, fmt(r.score, 3)])) },
    frames: [{
      title: "得分 vs 成本权重", summary: "w=" + fmt(w, 2) + " 第一名：" + ranked[0].name + (flip < 0 ? "；扫描区间内无翻转" : "；w≈" + fmt(flip, 2) + " 处第一名翻转（权重敏感性临界点）"),
      series: lines,
      labels: xs.map((x) => fmt(x, 2)),
      columns: ["排名", "方案", "当前得分"], rows: ranked.map((r, i) => ["#" + (i + 1), r.name, fmt(r.score, 2)]),
    }] };
}`;

/** 成本/工期/风险/收益四维方案对比条形图。 */
export const matrixCompareRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${decScore}
  ${box}
  ${label}
  const w = Math.max(0, Math.min(1, inV ?? params.costW ?? 0.25));
  const DIMS = ["成本", "工期", "风险", "收益"];
  const COLORS = ["#4f46e5", "#0d9488", "#b15236", "#c08814"];
  const ranked = DEC.map((d) => ({ name: d.name, s: d.s, score: dScore(d, w) })).sort((a, b) => b.score - a.score);
  const items = [label(16, 18, "四维打分（成本权重 w=" + fmt(w, 2) + "，其余均分）", "#344153", 10)];
  DIMS.forEach((d, i) => items.push(label(246 + i * 42, 32, d, COLORS[i], 9)));
  ranked.forEach((d, r) => {
    const y = 44 + r * 38;
    items.push(label(16, y + 15, (r === 0 ? "▶ " : "") + d.name, r === 0 ? "#b15236" : "#5a6675", 10));
    items.push(label(196, y + 15, fmt(d.score, 3), r === 0 ? "#b15236" : "#344153", 10));
    d.s.forEach((v, i) => items.push(box(242 + i * 42, y + 3, Math.max(4, v * 0.36), 18, COLORS[i], COLORS[i])));
  });
  return { data: { winner: ranked[0].name, scores: Object.fromEntries(ranked.map((d) => [d.name, fmt(d.score, 3)])) },
    frames: [{ title: "四维加权对比", summary: "第一名 " + ranked[0].name + "（" + fmt(ranked[0].score, 2) + " 分）；拖动成本权重看排名翻转", shapes: { viewBox: [430, 205], items } }] };
}`;

const CHANNELS = `const CH = [
  { name: "搜索广告", a: 3.2, k: 0.011 },
  { name: "信息流", a: 2.4, k: 0.008 },
  { name: "内容营销", a: 1.8, k: 0.004 },
];
const ret = (c, x) => c.a * (1 - Math.exp(-c.k * x)) * 100;
const mroi = (c, x) => c.a * c.k * Math.exp(-c.k * x) * 100;
const optAlloc = (B) => {
  const al = [0, 0, 0];
  for (let i = 0; i < 300; i++) {
    let best = 0;
    for (let j = 1; j < 3; j++) if (mroi(CH[j], al[j]) > mroi(CH[best], al[best])) best = j;
    al[best] += B / 300;
  }
  return al;
};`;

/** 三渠道边际 ROI 递减曲线与边际相等最优分配。 */
export const marginalRoiRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${wan}
  ${CHANNELS}
  const B = Math.max(10, Math.round(inV ?? params.budget ?? 100));
  const alloc = optAlloc(B);
  const xs = Array.from({ length: 25 }, (_, i) => i * 4);
  const gain = CH.reduce((s, c, j) => s + ret(c, alloc[j]), 0);
  return { data: { budget: B, alloc: alloc.map((v) => Math.round(v)), gain: Math.round(gain) },
    frames: [{
      title: "边际 ROI 递减曲线", summary: "预算 " + B + " 万 → 边际相等最优 ≈ 搜" + Math.round(alloc[0]) + "/信" + Math.round(alloc[1]) + "/内" + Math.round(alloc[2]) + " 万（收益 " + wan(gain * 10000) + " 元）",
      series: CH.map((c) => ({ label: c.name, values: xs.map((x) => fmt(mroi(c, x), 4)) })),
      labels: xs.map((x) => x + "万"),
      columns: ["渠道", "最优分配", "边际 ROI"], rows: CH.map((c, j) => [c.name, Math.round(alloc[j]) + " 万", fmt(mroi(c, alloc[j]), 3)]),
    }] };
}`;

/** 等额平分 vs 边际最优分配的收益对比。 */
export const allocCompareRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${wan}
  ${CHANNELS}
  ${box}
  ${label}
  const B = Math.max(30, Math.round(inV ?? params.budget ?? 90));
  const equal = B / 3;
  const opt = optAlloc(B);
  const revE = CH.reduce((s, c) => s + ret(c, equal), 0);
  const revO = CH.reduce((s, c, j) => s + ret(c, opt[j]), 0);
  const CC = ["#4f46e5", "#0d9488", "#b15236"];
  const items = [label(16, 20, "预算 " + B + " 万 · 两种分法", "#344153", 11)];
  [{ nm: "三等分", al: [equal, equal, equal], rev: revE }, { nm: "边际最优", al: opt, rev: revO }].forEach((row, ri) => {
    const y = 42 + ri * 62;
    items.push(label(16, y + 14, row.nm, "#5a6675", 10));
    let x = 92;
    row.al.forEach((v, j) => {
      const w = v / B * 210;
      items.push(box(x, y, Math.max(2, w), 20, CC[j], CC[j]));
      x += w;
    });
    items.push(label(314, y + 14, wan(row.rev * 10000) + " 元", ri ? "#1f7a3d" : "#8c95a4", 10));
    CH.forEach((c, j) => items.push(label(92 + j * 74, y + 36, c.name.slice(0, 2) + " " + Math.round(row.al[j]) + "万", "#8c95a4", 8)));
  });
  return { data: { equalRev: Math.round(revE), optRev: Math.round(revO), uplift: fmt((revO - revE) / revE * 100, 3), alloc: opt.map(Math.round) },
    frames: [{
      title: "平分 vs 边际最优", summary: "边际最优多赚 " + wan((revO - revE) * 10000) + " 元（+" + fmt((revO - revE) / revE * 100, 3) + "%）",
      shapes: { viewBox: [430, 178], items },
      columns: ["渠道", "三等分", "边际最优"], rows: CH.map((c, j) => [c.name, Math.round(equal) + " 万", Math.round(opt[j]) + " 万"]),
    }] };
}`;

/** 双资产收益-波动帕累托前沿：混合比例扫描，最小方差点标注。 */
export const paretoRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${dot}
  ${label}
  ${line}
  const B = Math.max(10, Math.round(inV ?? params.budget ?? 100));
  const A = { r: 0.20, sd: 0.16 };
  const Bx = { r: 0.09, sd: 0.10 };
  const corr = Math.max(-0.9, Math.min(0.9, params.corr ?? 0.1));
  const pts = Array.from({ length: 21 }, (_, i) => {
    const w = i / 20;
    return {
      w, r: w * A.r + (1 - w) * Bx.r,
      sd: Math.sqrt(w * w * A.sd * A.sd + (1 - w) * (1 - w) * Bx.sd * Bx.sd + 2 * w * (1 - w) * A.sd * Bx.sd * corr),
    };
  });
  const sx = (sd) => 48 + sd * 1500;
  const sy = (r) => 156 - r * 640;
  const items = [
    label(14, 18, "收益-波动前沿（进攻/稳健，ρ=" + corr + "）", "#344153", 10),
    line(36, 156, 392, 156, "#9aa7b5"), line(36, 156, 36, 24, "#9aa7b5"),
    label(360, 174, "σ 波动", "#8c95a4", 9), label(8, 34, "年化", "#8c95a4", 9),
  ];
  const mv = pts.reduce((b, p) => p.sd < b.sd ? p : b, pts[0]);
  for (let i = 0; i < pts.length - 1; i++) items.push(line(sx(pts[i].sd), sy(pts[i].r), sx(pts[i + 1].sd), sy(pts[i + 1].r), "#c9d2e0"));
  pts.forEach((p, i) => {
    items.push(dot(sx(p.sd), sy(p.r), i === 0 ? "#1f7a3d" : i === pts.length - 1 ? "#b15236" : "#4f46e5", 4));
    if (i % 5 === 0) items.push(label(sx(p.sd) - 10, sy(p.r) - 10, Math.round(p.w * 100) + "%", "#8c95a4", 8));
  });
  items.push(dot(sx(mv.sd), sy(mv.r), "#c08814", 6));
  items.push(label(sx(mv.sd) + 8, sy(mv.r) + 4, "最小方差 ≈" + Math.round(mv.w * 100) + "% 进攻", "#c08814", 9));
  return { data: { minVarW: fmt(mv.w, 2), minVarSd: fmt(mv.sd, 4), minVarRet: fmt(mv.r, 4), budget: B, minVarGain: Math.round(B * mv.r) },
    frames: [{ title: "帕累托前沿", summary: "100% 进攻年化 " + Math.round(A.r * 100) + "%/σ" + Math.round(A.sd * 100) + "%，100% 稳健 " + Math.round(Bx.r * 100) + "%/σ" + Math.round(Bx.sd * 100) + "%；最小方差组合 ≈" + Math.round(mv.w * 100) + "% 进攻（预算 " + B + " 万 → 预期年收益 ≈" + fmt(B * mv.r, 3) + " 万）——分散化在同等波动下换取更高收益", shapes: { viewBox: [400, 185], items } }] };
}`;
