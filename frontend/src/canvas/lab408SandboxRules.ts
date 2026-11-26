/** 408 计算机综合全景沙盘的确定性规则代码：随画布保存，由既有规则 Worker 沙箱执行。
 *
 * 约定与 physicsSandboxRules.ts 相同：每条规则是 `function run({ text, params, upstream, rand })`
 * 的字符串，返回 { data, frames }；frames 可含 shapes / grid / series / rows / timeline / graph。
 * upstream 中主输入口元素不带 `port` 键，aux 口元素带 `port:"aux"`；
 * algoData 序列化为 { kind:"algoData", mode, values?/edges?/addresses? }。
 */

const line = 'const line = (x1,y1,x2,y2,stroke,dashed=false) => ({ kind:"line", x1,y1,x2,y2,stroke,dashed,strokeWidth:1.6 });';
const dot = 'const dot = (cx,cy,fill,r=4) => ({ kind:"circle",cx,cy,r,fill });';
const box = 'const box = (x,y,w,h,fill,stroke="#8c95a4") => ({ kind:"rect",x,y,w,h,rx:4,fill,stroke });';
const label = 'const label = (x,y,text,fill="#344153",size=11) => ({ kind:"text",x,y,text,fill,size });';
const labelMid = 'const labelM = (x,y,text,fill="#344153",size=11) => ({ kind:"text",x,y,text,fill,size,anchor:"middle" });';
const arrow = 'const arrow = (x1,y1,x2,y2,stroke) => ({ kind:"arrow", x1,y1,x2,y2,stroke,strokeWidth:2 });';
const fmt = 'const fmt = (v, digits=4) => Number.isFinite(v) ? Number(v.toPrecision(digits)).toString() : "—";';
const inScalar = 'const inV = upstream.find(v => v.kind === "scalar" && v.port !== "aux")?.v;';
const auxScalar = 'const auxV = upstream.find(v => v.port === "aux" && v.kind === "scalar")?.v;';
const inAlgo = 'const inA = upstream.find(v => v.kind === "algoData" && v.port !== "aux");';
const miss408 = 'return { data: {}, frames: [{ title: "等待输入", summary: "请把「序列/图/地址流」源的 algoData 输出接到本积木 in 口。" }] };';

/** 序列提取：algoData array → values，addrStream → addresses。 */
const seqOf = `const seqOf = (a) => {
  if (!a) return [];
  if (a.mode === "array" && Array.isArray(a.values)) return a.values.map(v => Math.round(Number(v))).filter(Number.isFinite);
  if (a.mode === "addrStream" && Array.isArray(a.addresses)) return a.addresses.map(v => Math.round(Number(v))).filter(Number.isFinite);
  return [];
};`;

/** 图解析：algoData edges → {nodes, edges}，与 graphSource 同源语义。 */
const graphParse = `const gParse = (a) => {
  const edges = (a && Array.isArray(a.edges) ? a.edges : [])
    .filter(e => e && typeof e.u === "string" && typeof e.v === "string" && e.u !== e.v && Number.isFinite(Number(e.w)))
    .map(e => ({ u: e.u, v: e.v, w: Number(e.w) }));
  const set = new Set();
  edges.forEach(e => { set.add(e.u); set.add(e.v); });
  return { nodes: [...set].sort(), edges };
};
const gLayout = (nodes) => {
  const pos = {};
  nodes.forEach((n, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, nodes.length);
    pos[n] = { x: 50 + 36 * Math.cos(a), y: 50 + 34 * Math.sin(a) };
  });
  return pos;
};
const gNodes = (g, pos, activeSet, current) => g.nodes.map(n => ({
  id: n, label: n, x: pos[n].x, y: pos[n].y,
  active: n === current ? true : activeSet ? activeSet.has(n) : false,
}));
const gEdges = (g, pos, activeSet, dashed) => g.edges.map(e => ({
  from: e.u, to: e.v, label: String(e.w), active: activeSet ? activeSet.has(e.u + "|" + e.v) || activeSet.has(e.v + "|" + e.u) : false,
}));`;

export { line, dot, box, label, labelMid, arrow, fmt, inScalar, auxScalar, inAlgo, seqOf, graphParse, miss408 };

/* ============================== DS · 第 5 章：图 —— 遍历、生成树与最短路 ============================== */

/** Prim 最小生成树 vs Dijkstra 最短路径树逐帧对照：同图同起点，证明两棵树可以不同。 */
export const mstVsSptRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${auxScalar}
  ${graphParse}
  ${fmt}
  const g = gParse(inA);
  if (!g.nodes.length) { ${miss408} }
  const names = g.nodes;
  const startIx = Math.max(0, Math.min(names.length - 1, Math.round(auxV ?? params.start ?? 0)));
  const src = names[startIx];
  const key = (a, b) => a < b ? a + "|" + b : b + "|" + a;
  // Prim：每步把连接已选集合与未选集合的最小权边并入
  const inTree = new Set([src]);
  const primSteps = [];
  let mstW = 0;
  while (inTree.size < names.length && primSteps.length < 80) {
    let best = null;
    for (const e of g.edges) {
      const uIn = inTree.has(e.u), vIn = inTree.has(e.v);
      if (uIn === vIn) continue;
      if (!best || e.w < best.w || (e.w === best.w && key(e.u, e.v) < key(best.u, best.v))) best = e;
    }
    if (!best) break;
    const added = inTree.has(best.u) ? best.v : best.u;
    inTree.add(added); mstW += best.w;
    primSteps.push({ edge: best, added, inTree: new Set(inTree), w: mstW });
  }
  // Dijkstra（无向）：dist 松弛与父指针回溯最短路径树
  const dist = {}; const prev = {};
  names.forEach(n => { dist[n] = Infinity; });
  dist[src] = 0;
  const done = new Set();
  const dikSteps = [];
  while (done.size < names.length && dikSteps.length < 80) {
    let cur = null, bestD = Infinity;
    for (const n of names) if (!done.has(n) && dist[n] < bestD) { bestD = dist[n]; cur = n; }
    if (!cur) break;
    done.add(cur);
    const relaxed = [];
    for (const e of g.edges) {
      const other = e.u === cur ? e.v : e.v === cur ? e.u : null;
      if (!other || done.has(other)) continue;
      if (dist[cur] + e.w < dist[other] - 1e-9) { dist[other] = dist[cur] + e.w; prev[other] = cur; relaxed.push(other); }
    }
    dikSteps.push({ cur, done: new Set(done), dist: { ...dist }, relaxed });
  }
  const sptEdges = new Set();
  let sptW = 0;
  names.forEach(n => { if (prev[n]) { sptEdges.add(key(n, prev[n])); } });
  for (const e of g.edges) if (sptEdges.has(key(e.u, e.v))) sptW += e.w;
  const pos = gLayout(names);
  const primEdgeSet = (k) => new Set(primSteps.slice(0, k).map(s => key(s.edge.u, s.edge.v)));
  const distRow = (dd) => names.map(n => [n, Number.isFinite(dd[n]) ? Math.round(dd[n] * 100) / 100 : "∞", prev[n] ?? "—"]);
  const frames = [];
  const total = Math.max(primSteps.length, dikSteps.length);
  for (let k = 0; k <= total; k++) {
    if (k <= primSteps.length) {
      const sel = primEdgeSet(k);
      frames.push({
        title: "Prim · 第 " + k + " 步", summary: k ? "并入 " + primSteps[k - 1].edge.u + "—" + primSteps[k - 1].edge.v + " (w=" + primSteps[k - 1].edge.w + ")，累计 " + mstW0(primSteps, k) : "从 " + src + " 开始，每一步选跨割的最小边。",
        graph: { nodes: gNodes(g, pos, new Set(primSteps.slice(0, k).map(s => s.added).concat([src])), primSteps[k - 1]?.added), edges: gEdges(g, pos, sel) },
      });
    }
    if (k <= dikSteps.length) {
      const distNow = dikSteps[k - 1]?.dist ?? Object.fromEntries(names.map(n => [n, n === src ? 0 : Infinity]));
      const prevEdges = new Set();
      names.forEach(n => {
        if (prev[n] && (dikSteps[k - 1]?.done.has(n))) prevEdges.add(key(n, prev[n]));
      });
      frames.push({
        title: "Dijkstra · 第 " + k + " 步", summary: k ? "确定 " + dikSteps[k - 1].cur + "，dist=" + fmt(dikSteps[k - 1].dist[dikSteps[k - 1].cur], 5) : "dist[" + src + "]=0，每步锁定当前最小 dist。",
        columns: ["顶点", "dist", "前驱"], rows: distRow(distNow),
        graph: { nodes: gNodes(g, pos, dikSteps[k - 1]?.done ?? new Set([src]), dikSteps[k - 1]?.cur), edges: gEdges(g, pos, prevEdges) },
      });
    }
  }
  function mstW0(steps, k) { return steps.slice(0, k).reduce((s, x) => s + x.edge.w, 0); }
  const same = primSteps.length === names.length - 1 && sptEdges.size === primSteps.length
    && primSteps.every(s => sptEdges.has(key(s.edge.u, s.edge.v)));
  return { data: { source: src, mstWeight: mstW, sptWeight: sptW, distSum: names.reduce((s, n) => s + (Number.isFinite(dist[n]) ? dist[n] : 0), 0), sameTree: same, distances: dist }, frames };
}`;

/** 邻接矩阵 + Floyd 全源最短路径距离矩阵：每个中间点迭代一帧热图。 */
export const floydMatrixRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${graphParse}
  ${fmt}
  const g = gParse(inA);
  if (!g.nodes.length) { ${miss408} }
  const names = g.nodes.slice(0, 12);
  const n = names.length;
  const ix = {}; names.forEach((name, i) => { ix[name] = i; });
  const INF = 1e9;
  const d = Array.from({ length: n }, () => Array.from({ length: n }, () => INF));
  for (let i = 0; i < n; i++) d[i][i] = 0;
  for (const e of g.edges) {
    const a = ix[e.u], b = ix[e.v];
    if (a === undefined || b === undefined) continue;
    const w = e.w;
    if (w < d[a][b]) { d[a][b] = w; d[b][a] = w; }
  }
  const adj = d.map(row => row.map(v => v));
  const cap = 98;
  const clip = (v) => v >= INF / 2 ? cap + 1 : Math.round(v * 10) / 10;
  const cellOf = (v) => v >= INF / 2 ? 99 : Math.round(v * 10) / 10;
  const frames = [{
    title: "邻接矩阵", summary: "∞ 记为 99+（不可达），自环 0；随后逐个引入中间点 k 做松弛。",
    grid: { cells: adj.map(row => row.map(cellOf)), rowLabels: names, colLabels: names, min: 0, max: cap, showValues: true, palette: "heat" },
  }];
  for (let k = 0; k < n; k++) {
    let changed = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const via = d[i][k] + d[k][j];
      if (via < d[i][j] - 1e-9) { d[i][j] = via; changed += 1; }
    }
    frames.push({
      title: "k = " + names[k], summary: "经 " + names[k] + " 中转松弛了 " + changed + " 个距离；d[i][j] = min(d[i][j], d[i][k]+d[k][j])",
      grid: { cells: d.map(row => row.map(cellOf)), rowLabels: names, colLabels: names, min: 0, max: cap, showValues: true, palette: "heat", activeCell: [k, k] },
    });
    if (frames.length > 60) break;
  }
  frames.push({
    title: "Floyd 距离矩阵", summary: "任意顶点对的最短路长度；∞ 表示不连通。",
    columns: ["", ...names],
    rows: names.map((name, i) => [name, ...d[i].map(v => v >= INF / 2 ? "∞" : Math.round(v * 100) / 100)]),
  });
  return { data: { nodes: names, dist: d.map(row => row.map(v => v >= INF / 2 ? null : Math.round(v * 100) / 100)) }, frames };
}`;

/** AOV 拓扑排序 + AOE 关键路径：把同一文本当「有向工程网」解读。 */
export const topoCpmRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${graphParse}
  ${fmt}
  const g = gParse(inA);
  if (!g.nodes.length) { ${miss408} }
  const names = g.nodes;
  const ix = {}; names.forEach((n, i) => { ix[n] = i; });
  const n = names.length;
  const indeg = Array(n).fill(0);
  const adj = Array.from({ length: n }, () => []);
  for (const e of g.edges) { adj[ix[e.u]].push({ to: ix[e.v], w: e.w, edge: e }); indeg[ix[e.v]] += 1; }
  // Kahn 拓扑排序，记录每帧队列
  const queue = names.filter((_, i) => indeg[i] === 0).map(nm => ix[nm]);
  const order = [];
  const work = [...indeg];
  const frames = [];
  const topoNote = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    const popped = names[cur];
    const freed = [];
    for (const { to } of adj[cur]) { work[to] -= 1; if (work[to] === 0) { queue.push(to); freed.push(names[to]); } }
    topoNote.push("弹出 " + popped + (freed.length ? "，释放 " + freed.join("、") : ""));
    frames.push({
      title: "拓扑 · 第 " + order.length + " 步", summary: topoNote[topoNote.length - 1] + "；队列 [" + queue.map(i => names[i]).join(", ") + "]",
      columns: ["次序", "顶点", "剩余入度"], rows: names.map((nm, i) => [order.indexOf(i) >= 0 ? order.indexOf(i) + 1 : "·", nm, work[i]]),
    });
    if (frames.length > 40) break;
  }
  const cyclic = order.length < n;
  // AOE：拓扑序求 ve，逆序求 vl；活动 a(u→v,w)：e=ve[u]，l=vl[v]−w
  let cpmLen = 0, critNames = [];
  if (!cyclic) {
    const ve = Array(n).fill(0);
    for (const u of order) for (const { to, w } of adj[u]) ve[to] = Math.max(ve[to], ve[u] + w);
    const vl = Array(n).fill(ve[order[n - 1]]);
    for (let t = n - 1; t >= 0; t--) {
      const v = order[t];
      for (const e of g.edges) if (ix[e.v] === v) vl[ix[e.u]] = Math.min(vl[ix[e.u]], vl[v] - e.w);
    }
    cpmLen = ve[order[n - 1]];
    const lanes = [];
    const critEdges = new Set();
    g.edges.forEach((e, idx) => {
      const ee = ve[ix[e.u]], ll = vl[ix[e.v]] - e.w, slack = ll - ee;
      const critical = Math.abs(slack) < 1e-9;
      if (critical) { critEdges.add(e.u + "|" + e.v); critNames.push(e.u + "→" + e.v); }
      lanes.push({ label: "a" + (idx + 1) + " " + e.u + "→" + e.v, segments: [{ label: critical ? "关键 w=" + e.w : "松弛 " + fmt(slack, 3), start: ee, end: ll + e.w }] });
    });
    frames.push({
      title: "AOE 关键路径", summary: "工程最短期 " + fmt(cpmLen, 5) + "；关键活动：" + (critNames.join("、") || "无") + "（条形 [最早开始, 最迟完成]，松弛 0 即关键）",
      timeline: lanes.slice(0, 18),
    });
    const pos = gLayout(names);
    frames.push({
      title: "关键路径图", summary: "红色标注的边组成关键路径，总权 " + fmt(cpmLen, 5),
      graph: { nodes: gNodes(g, pos, new Set(critNames.flatMap(s => s.split("→"))), null), edges: g.edges.map(e => ({ from: e.u, to: e.v, label: String(e.w), active: critEdges.has(e.u + "|" + e.v) })) },
    });
  } else {
    frames.push({ title: "存在环", summary: "图中检测到回路，无法拓扑排序——AOV/AOE 要求有向无环图（把边文本改成 DAG 再试）。", columns: ["状态"], rows: [["环", "拓扑中断于第 " + order.length + " 步"]] });
  }
  return { data: { topoOrder: order.map(i => names[i]), cyclic, critLen: cpmLen, critical: critNames }, frames };
}`;

/* ============================== CO · 第 3 章：主存、Cache 与虚拟存储 ============================== */

/** 虚地址 → 页表 → 物理地址 → tag/index/offset 三段切分位带图。 */
export const addrSplitRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${box}
  ${label}
  ${labelMid}
  ${arrow}
  ${fmt}
  const addrs = seqOf(inA);
  if (!addrs.length) { ${miss408} }
  const pow2 = (v, fb, lo, hi) => { let p = Math.round(Math.max(lo, Math.min(hi, v || fb))); let r = 1; while (r * 2 <= p) r *= 2; return r; };
  const pageSize = pow2(params.pageSize, 256, 64, 8192);
  const blockBytes = pow2(params.blockBytes, 64, 8, 1024);
  const cacheKB = pow2(params.cacheKB, 4, 1, 1024);
  const ways = pow2(params.ways, 4, 1, 16);
  const blocks = Math.max(ways, Math.floor(cacheKB * 1024 / blockBytes));
  const sets = Math.max(1, Math.floor(blocks / ways));
  const offB = Math.round(Math.log2(blockBytes)), idxB = Math.round(Math.log2(sets)), tagB = Math.max(0, 32 - offB - idxB);
  const pgB = Math.round(Math.log2(pageSize));
  const vpnB = 32 - pgB;
  const pfnOf = (vpn) => (vpn * 17 + 5) % 1024;
  const band = (x, y, w, h, parts) => {
    const items = [];
    let at = x;
    for (const p of parts) {
      const ww = Math.max(6, w * p.share);
      items.push(box(at, y, ww, h, p.fill, "#5a6675"));
      items.push(labelM(at + ww / 2, y + h / 2 + 3.5, p.name, "#fff", 10));
      items.push(labelM(at + ww / 2, y + h + 11, p.bits + "位", "#5a6675", 8.5));
      at += ww;
    }
    return items;
  };
  const hex = (v) => "0x" + Math.max(0, Math.round(v)).toString(16).toUpperCase().padStart(8, "0");
  const frames = [];
  addrs.slice(0, 8).forEach((addr, i) => {
    const va = Math.max(0, Math.round(addr)) >>> 0;
    const vpn = Math.floor(va / pageSize), pgOff = va % pageSize;
    const pfn = pfnOf(vpn);
    const pa = (pfn * pageSize + pgOff) >>> 0;
    const block = Math.floor(pa / blockBytes), off = pa % blockBytes;
    const index = block % sets, tag = Math.floor(block / sets);
    const items = [
      label(24, 26, "虚地址 " + hex(va), "#344153", 12),
      ...band(24, 40, 350, 22, [
        { name: "VPN " + vpn, share: vpnB / 32, bits: vpnB, fill: "#4f46e5" },
        { name: "页内偏移 " + pgOff, share: pgB / 32, bits: pgB, fill: "#8c95a4" },
      ]),
      arrow(199, 74, 199, 96, "#b15236"),
      labelM(199, 90, "页表: VPN→PFN " + pfn, "#b15236", 10),
      label(24, 112, "物理地址 " + hex(pa), "#344153", 12),
      ...band(24, 126, 350, 22, [
        { name: "tag " + tag, share: tagB / 32, bits: tagB, fill: "#4f46e5" },
        { name: "index " + index, share: idxB / 32, bits: idxB, fill: "#b15236" },
        { name: "offset " + off, share: offB / 32, bits: offB, fill: "#8c95a4" },
      ]),
      label(24, 178, "Cache: " + cacheKB + "KB ÷ " + blockBytes + "B = " + blocks + " 块 · " + sets + " 组 × " + ways + " 路", "#5a6675", 10),
    ];
    frames.push({
      title: "第 " + (i + 1) + " 次访存", summary: hex(va) + " → VPN " + vpn + " 换 PFN " + pfn + " → tag " + tag + " / 组 " + index + " / 偏移 " + off,
      shapes: { viewBox: [400, 190], items },
    });
  });
  return { data: { tagBits: tagB, indexBits: idxB, offsetBits: offB, vpnBits: vpnB, pageOffBits: pgB, sets, blocks, ways }, frames };
}`;

/** Cache 组相联网格：逐帧 Hit/Miss/LRU 淘汰演化。 */
export const cacheGridRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${fmt}
  const addrs = seqOf(inA);
  if (!addrs.length) { ${miss408} }
  const pow2 = (v, fb, lo, hi) => { let p = Math.round(Math.max(lo, Math.min(hi, v || fb))); let r = 1; while (r * 2 <= p) r *= 2; return r; };
  const blockBytes = pow2(params.blockBytes, 64, 8, 1024);
  const cacheKB = pow2(params.cacheKB, 1, 1, 1024);
  const ways = pow2(auxV ?? params.ways, 2, 1, 16);
  const policy = Math.round(params.policy ?? 1) === 0 ? 0 : 1;
  const blocks = Math.max(ways, Math.floor(cacheKB * 1024 / blockBytes));
  const sets = Math.max(1, Math.floor(blocks / ways));
  const slots = Array.from({ length: sets }, () => []);
  let hits = 0, misses = 0, tick = 0;
  const snapshot = (activeSet, activeWay) => {
    const cells = [], mask = [], rowLabels = [], colLabels = [];
    for (let s = 0; s < sets; s++) {
      rowLabels.push("组" + s);
      cells.push(slots[s].map(e => e.tag));
      mask.push(slots[s].map(() => false));
      while (cells[s].length < ways) { cells[s].push(-1); mask[s].push(true); }
    }
    for (let w = 0; w < ways; w++) colLabels.push("路" + w);
    return { cells, mask, rowLabels, colLabels, min: -1, max: Math.max(2, ...cells.flat()), palette: "heat", showValues: true,
      activeCell: activeWay >= 0 ? [activeSet, activeWay] : undefined };
  };
  const frames = [];
  let lastEvict = null;
  addrs.slice(0, 48).forEach((raw, i) => {
    const addr = Math.max(0, Math.round(raw));
    const block = Math.floor(addr / blockBytes), index = block % sets, tag = Math.floor(block / sets);
    const set = slots[index];
    tick += 1;
    const hitIx = set.findIndex(e => e.tag === tag);
    let note, evict = null, wayIx = hitIx;
    if (hitIx >= 0) {
      hits += 1;
      if (policy === 1) set[hitIx].last = tick;
      note = "HIT · 组" + index + " 路" + hitIx + " tag=" + tag;
    } else {
      misses += 1;
      if (set.length < ways) { set.push({ tag, last: tick }); wayIx = set.length - 1; note = "MISS · 装入组" + index + " 路" + wayIx + " tag=" + tag; }
      else {
        let vic = 0;
        for (let w = 1; w < set.length; w++) if (set[w].last < set[vic].last) vic = w;
        evict = set[vic].tag;
        set[vic] = { tag, last: tick }; wayIx = vic;
        note = "MISS · 淘汰 tag=" + evict + "（" + (policy ? "LRU" : "FIFO") + "）装入组" + index + " 路" + vic;
      }
    }
    lastEvict = evict;
    frames.push({
      title: "访存 #" + (i + 1) + " 地址 0x" + addr.toString(16).toUpperCase(), summary: note + "；累计 命中 " + hits + " / 缺失 " + misses,
      grid: snapshot(index, wayIx),
    });
  });
  return { data: { hits, misses, hitRate: Math.round(hits * 1000 / Math.max(1, hits + misses)) / 10, sets, blocks, ways, policy }, frames };
}`;

/** 同地址流下 1/2/4/8 路命中率与 AMAT 对照。 */
export const amatRaceRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${fmt}
  const addrs = seqOf(inA);
  if (!addrs.length) { ${miss408} }
  const pow2 = (v, fb, lo, hi) => { let p = Math.round(Math.max(lo, Math.min(hi, v || fb))); let r = 1; while (r * 2 <= p) r *= 2; return r; };
  const blockBytes = pow2(params.blockBytes, 64, 8, 1024);
  const cacheKB = pow2(params.cacheKB, 1, 1, 1024);
  const hitCyc = Math.max(1, params.hitCyc ?? 1), missPen = Math.max(1, params.missPen ?? 40);
  const sim = (ways) => {
    const blocks = Math.max(ways, Math.floor(cacheKB * 1024 / blockBytes));
    const sets = Math.max(1, Math.floor(blocks / ways));
    const slots = Array.from({ length: sets }, () => []);
    let hits = 0, tick = 0;
    for (const raw of addrs.slice(0, 60)) {
      const addr = Math.max(0, Math.round(raw));
      const block = Math.floor(addr / blockBytes), index = block % sets, tag = Math.floor(block / sets);
      const set = slots[index]; tick += 1;
      const hitIx = set.findIndex(e => e.tag === tag);
      if (hitIx >= 0) { hits += 1; set[hitIx].last = tick; continue; }
      if (set.length < ways) set.push({ tag, last: tick });
      else { let vic = 0; for (let w = 1; w < set.length; w++) if (set[w].last < set[vic].last) vic = w; set[vic] = { tag, last: tick }; }
    }
    const total = Math.min(addrs.length, 60);
    const rate = hits / Math.max(1, total);
    return { ways, sets, hits, misses: total - hits, rate, amat: hitCyc + (1 - rate) * missPen };
  };
  const races = [1, 2, 4, 8].map(sim);
  const frames = races.map((r, k) => ({
    title: r.ways + " 路组相联", summary: "命中率 " + fmt(r.rate * 100, 4) + "% · AMAT = " + hitCyc + " + " + fmt(1 - r.rate, 4) + "×" + missPen + " = " + fmt(r.amat, 4) + " 周期",
    columns: ["路数", "组数", "命中", "缺失", "命中率%", "AMAT"],
    rows: races.map(x => [x.ways, x.sets, x.hits, x.misses, Math.round(x.rate * 1000) / 10, Math.round(x.amat * 100) / 100]),
    highlightRows: [k],
    series: [{ label: "命中率%", values: races.map(x => Math.round(x.rate * 1000) / 10) }, { label: "AMAT", values: races.map(x => Math.round(x.amat * 10) / 10) }],
  }));
  const best = races.reduce((a, b) => a.amat <= b.amat ? a : b);
  return { data: { rates: races.map(r => Math.round(r.rate * 1000) / 10), amats: races.map(r => Math.round(r.amat * 100) / 100), bestWays: best.ways, bestAmat: Math.round(best.amat * 100) / 100 }, frames };
}`;

/* ============================== OS · 第 3 章：内存分配、分页与页面置换 ============================== */

const pageSim = `const pageSim = (algo, cap, refs) => {
  const framesSt = [];
  const marks = [];
  let hand = 0, faults = 0;
  const order = [];
  refs.forEach((p, t) => {
    const hitIx = framesSt.findIndex(f => f.p === p);
    let victim = -1, fault = false;
    if (hitIx >= 0) {
      if (algo === 1) framesSt[hitIx].last = t;
      if (algo === 3) framesSt[hitIx].ref = 1;
    } else {
      fault = true; faults += 1;
      if (framesSt.length < cap) {
        victim = framesSt.length;
        framesSt.push({ p, last: t, load: t, ref: 1 });
      } else {
        if (algo === 0) { let o = 0; for (let i = 1; i < cap; i++) if (framesSt[i].load < framesSt[o].load) o = i; victim = o; }
        else if (algo === 1) { let o = 0; for (let i = 1; i < cap; i++) if (framesSt[i].last < framesSt[o].last) o = i; victim = o; }
        else if (algo === 2) {
          let o = 0, far = -1;
          for (let i = 0; i < cap; i++) {
            const nx = refs.indexOf(framesSt[i].p, t + 1);
            const d = nx < 0 ? Infinity : nx;
            if (d > far) { far = d; o = i; }
          }
          victim = o;
        } else {
          let guard = 0;
          while (guard++ < 3 * cap) {
            const f = framesSt[hand];
            if (f.ref === 0) { victim = hand; break; }
            f.ref = 0; hand = (hand + 1) % cap;
          }
          if (victim < 0) victim = hand;
          hand = (victim + 1) % cap;
        }
        framesSt[victim] = { p, last: t, load: t, ref: 1 };
      }
    }
    marks.push({ p, fault, victim, frames: framesSt.map(f => f.p) });
  });
  return { faults, marks };
};`;

/** 物理页框逐帧置换网格：行=页框槽位，列=时间，缺页格置红。 */
export const pageGridRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${pageSim}
  ${fmt}
  const refs = seqOf(inA);
  if (!refs.length) { ${miss408} }
  const cap = Math.max(1, Math.min(6, Math.round(auxV ?? params.frames ?? 3)));
  const algo = Math.round(params.algo ?? 0);
  const { faults, marks } = pageSim(algo, cap, refs.slice(0, 24));
  const names = ["FIFO", "LRU", "OPT", "Clock"];
  const frames = marks.map((m, t) => {
    const cells = [], mask = [], colLabels = refs.slice(0, t + 1).map((_, i) => "#" + (i + 1));
    for (let s = 0; s < cap; s++) {
      cells.push(marks.slice(0, t + 1).map(mm => mm.frames[s] ?? -1));
      mask.push(marks.slice(0, t + 1).map((mm, i2) => mm.fault && mm.victim === s && i2 === t));
    }
    return {
      title: "第 " + (t + 1) + " 次访问 页 " + m.p,
      summary: (m.fault ? "缺页 ✗ → " + (m.frames.length < cap ? "装入空槽" : "淘汰槽 " + m.victim) : "命中 ✓") + "；累计缺页 " + marks.slice(0, t + 1).filter(x => x.fault).length,
      grid: { cells, mask, rowLabels: Array.from({ length: cap }, (_, s) => "框" + s), colLabels, min: -1, max: Math.max(...cells.flat(), 2), palette: "error", showValues: true, activeCell: m.victim >= 0 ? [m.victim, t] : undefined },
    };
  });
  frames.push({ title: names[algo] + " 汇总", summary: "缺页 " + faults + " 次 / 共 " + marks.length + " 次访问", columns: ["算法", "页框", "缺页"], rows: [[names[algo], cap, faults]] });
  return { data: { algo: names[algo], cap, faults, hits: marks.length - faults }, frames };
}`;

/** OPT/LRU/FIFO/Clock 缺页数同台竞赛，扫描 3–6 框直击 Belady 异常。 */
export const beladyRaceRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${pageSim}
  ${fmt}
  const refs = seqOf(inA);
  if (!refs.length) { ${miss408} }
  const seq = refs.slice(0, 24);
  const capNow = Math.max(1, Math.min(6, Math.round(auxV ?? params.frames ?? 3)));
  const names = ["FIFO", "LRU", "OPT", "Clock"];
  const table = [3, 4, 5, 6].map(cap => ({ cap, faults: [0, 1, 2, 3].map(a => pageSim(a, cap, seq).faults) }));
  const rows = table.map(r => [r.cap, ...r.faults.map((f, a) => f + (a === 0 && r.cap > 3 && f > table.find(t => t.cap === r.cap - 1)?.faults[0] ? " ⚠" : ""))]);
  const beladyAt = table.filter(r => r.cap > 3).find(r => r.faults[0] > table.find(t => t.cap === r.cap - 1).faults[0])?.cap ?? null;
  const series = names.map((nm, a) => ({ label: nm, values: table.map(r => r.faults[a]) }));
  const frames = table.map(r => ({
    title: r.cap + " 个物理页框", summary: names.map((nm, a) => nm + "=" + r.faults[a]).join(" · ") + (r.cap === beladyAt ? "　⚠ Belady 异常：FIFO 框增反劣！" : ""),
    columns: ["页框", ...names], rows, highlightRows: [table.indexOf(r)],
    series,
  }));
  frames.push({ title: "Belady 判决", summary: beladyAt ? "FIFO 在 " + (beladyAt - 1) + "→" + beladyAt + " 框出现 Belady 异常（缺页 " + table.find(t => t.cap === beladyAt - 1).faults[0] + "→" + table.find(t => t.cap === beladyAt).faults[0] + "）。OPT/LRU 是栈式算法永不异常。" : "本序列未触发 Belady 异常；换成经典串 1,2,3,4,1,2,5,1,2,3,4,5 试 3→4 框。",
    columns: ["页框", ...names], rows, series });
  const now = table.find(r => r.cap === capNow) ?? table[0];
  return { data: { cap: capNow, fifo: now.faults[0], lru: now.faults[1], opt: now.faults[2], clock: now.faults[3], table, beladyAt }, frames };
}`;

/** 连续分配 FF / BF / WF 三条内存条碎片对照（上游数组可覆盖作业尺寸）。 */
export const allocFragRule = `function run({ params, upstream, text }) {
  ${inAlgo}
  ${seqOf}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const SCENARIOS = [
    { holes: [100, 500, 200, 300, 600], jobs: [212, 417, 112, 426] },
    { holes: [60, 100, 40, 80, 50], jobs: [50, 90, 60, 30, 70] },
    { holes: [100, 200, 150], jobs: [220, 80, 60, 90] },
  ];
  const nums = (s) => (s || "").split(/[\\s,，]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const seg = { holes: SCENARIOS[variant].holes.slice(), jobs: SCENARIOS[variant].jobs.slice() };
  const m = /holes\s*[:：]\s*([\\d\\s,，]+)/i.exec(text || "");
  const j = /jobs\s*[:：]\s*([\\d\\s,，]+)/i.exec(text || "");
  if (m) seg.holes = nums(m[1]).slice(0, 10);
  if (j) seg.jobs = nums(j[1]).slice(0, 10);
  const total = seg.holes.reduce((a, b) => a + b, 0);
  const place = (policy) => {
    const holes = seg.holes.map((size, i) => ({ start: seg.holes.slice(0, i).reduce((a, b) => a + b, 0), size }));
    const marks = seg.jobs.map(job => {
      let pick = -1;
      if (policy === 0) pick = holes.findIndex(h => h.size >= job);
      else if (policy === 1) { holes.forEach((h, i) => { if (h.size >= job && (pick < 0 || h.size < holes[pick].size)) pick = i; }); }
      else { holes.forEach((h, i) => { if (h.size >= job && (pick < 0 || h.size > holes[pick].size)) pick = i; }); }
      if (pick < 0) return { job, ok: false };
      const h = holes[pick];
      const at = h.start;
      h.start += job; h.size -= job;
      return { job, ok: true, at, left: h.size, holeIx: pick };
    });
    return { marks, holes };
  };
  const races = [place(0), place(1), place(2)];
  const names = ["首次适应 FF", "最佳适应 BF", "最坏适应 WF"];
  const colors = ["#4f46e5", "#b15236", "#1f7a3d"];
  const frames = [];
  seg.jobs.forEach((job, k) => {
    const items = [label(20, 18, "作业 J" + (k + 1) + " 申请 " + job + "K", "#344153", 12)];
    const xs = (v) => 70 + 300 * v / total;
    races.forEach((r, lane) => {
      const y = 34 + lane * 62;
      items.push(label(20, y + 14, names[lane].slice(0, 2), "#5a6675", 9));
      // 重放到第 k 步画内存条
      const st = seg.holes.map((size, i) => ({ start: seg.holes.slice(0, i).reduce((a, b) => a + b, 0), size }));
      const placed = [];
      seg.jobs.slice(0, k + 1).forEach((jb) => {
        let pick = -1;
        if (lane === 0) pick = st.findIndex(h => h.size >= jb);
        else if (lane === 1) { st.forEach((h, i) => { if (h.size >= jb && (pick < 0 || h.size < st[pick].size)) pick = i; }); }
        else { st.forEach((h, i) => { if (h.size >= jb && (pick < 0 || h.size > st[pick].size)) pick = i; }); }
        if (pick >= 0) { placed.push({ start: st[pick].start, size: jb }); st[pick] = { start: st[pick].start + jb, size: st[pick].size - jb }; }
      });
      items.push(box(70, y, 300, 22, "#eef1f5", "#8c95a4"));
      seg.holes.forEach((size, i) => {
        const start = seg.holes.slice(0, i).reduce((a, b) => a + b, 0);
        items.push(box(xs(start), y, Math.max(1, 300 * size / total), 22, "#dfe5ec", "#aab4c0"));
      });
      placed.forEach((p, i2) => {
        items.push(box(xs(p.start), y, Math.max(1, 300 * p.size / total), 22, colors[i2 === k ? 1 : 0], "#5a6675"));
      });
      const m = r.marks[k];
      items.push(label(70, y + 34, m ? (m.ok ? "✓ 已放入 @偏移 " + m.at : "✗ 无足够空闲区") : "—", m && !m.ok ? "#be531a" : "#1f7a3d", 10));
    });
    items.push(label(20, 224, "同一作业序列：FF 扫到低址即放 · BF 挑最小够放孔 · WF 挑最大孔", "#5a6675", 9.5));
    frames.push({ title: "J" + (k + 1) + " 分配结果", summary: "J" + (k + 1) + "(" + job + "K)：" + races.map((r, i) => names[i].slice(0, 2) + (r.marks[k].ok ? "✓" : "✗")).join(" · "), shapes: { viewBox: [400, 235], items } });
  });
  const frag = races.map(r => r.holes.reduce((s, h) => s + h.size, 0));
  return { data: { ffPlaced: races[0].marks.filter(m => m.ok).length, bfPlaced: races[1].marks.filter(m => m.ok).length, wfPlaced: races[2].marks.filter(m => m.ok).length, ffLeft: frag[0], bfLeft: frag[1], wfLeft: frag[2] }, frames };
}`;

/* ============================== CN · 第 5 章：TCP 连接管理、流量与拥塞控制 ============================== */

const tcpReno = `const tcpReno = (ssth0, rounds, lossAt, lossType) => {
  let cwnd = 1, ssth = ssth0, phase = "slow";
  const trace = [{ rtt: 0, cwnd, ssth, phase, event: "" }];
  for (let rtt = 1; rtt <= rounds; rtt++) {
    let event = "";
    if (rtt === lossAt) {
      if (lossType === 1) { ssth = Math.max(2, Math.floor(cwnd / 2)); cwnd = 1; phase = "slow"; event = "超时→cwnd=1"; }
      else { ssth = Math.max(2, Math.floor(cwnd / 2)); cwnd = ssth; phase = "ca"; event = "3-ACK→cwnd=ssthresh"; }
    } else if (phase === "slow") {
      cwnd *= 2;
      if (cwnd >= ssth) { cwnd = ssth; phase = "ca"; event = "达 ssthresh→拥塞避免"; }
    } else {
      cwnd += 1;
    }
    trace.push({ rtt, cwnd, ssth, phase, event });
  }
  return trace;
};`;

/** TCP Reno 拥塞窗口锯齿演化：慢开始翻倍、拥塞避免线性、超时归 1、3-ACK 减半。 */
export const cwndCurveRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${fmt}
  ${tcpReno}
  const ssth0 = Math.max(2, Math.round(inV ?? auxV ?? params.ssthresh ?? 8));
  const rounds = Math.max(6, Math.min(40, Math.round(params.rounds ?? 24)));
  const lossAt = Math.max(2, Math.min(rounds - 2, Math.round(params.lossAt ?? 10)));
  const lossType = Math.round(params.lossType ?? 0) === 1 ? 1 : 0;
  const trace = tcpReno(ssth0, rounds, lossAt, lossType);
  const frames = trace.map(t => ({
    title: "RTT " + t.rtt, summary: "cwnd=" + t.cwnd + " · ssthresh=" + t.ssth + " · " + (t.phase === "slow" ? "慢开始" : "拥塞避免") + (t.event ? "　⚡" + t.event : ""),
    columns: ["RTT", "cwnd", "ssthresh", "阶段", "事件"],
    rows: trace.slice(0, t.rtt + 1).map(x => [x.rtt, x.cwnd, x.ssth, x.phase === "slow" ? "慢开始" : "拥塞避免", x.event || "—"]),
    highlightRows: [t.rtt],
    series: [{ label: "cwnd", values: trace.slice(0, t.rtt + 1).map(x => x.cwnd) }, { label: "ssthresh", values: trace.slice(0, t.rtt + 1).map(x => x.ssth) }],
  }));
  const atLoss = trace[lossAt];
  return { data: { ssth0, lossAt, lossType, cwndTrace: trace.map(t => t.cwnd), cwndAtLoss: atLoss.cwnd, ssthAfter: atLoss.ssth, peak: Math.max(...trace.map(t => t.cwnd)) }, frames };
}`;

/** 三次握手与四次挥手报文时序 + TCP 状态机迁移。 */
export const handshakeRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  ${line}
  ${dot}
  ${label}
  ${labelMid}
  ${arrow}
  const rwnd = Math.max(1, Math.round(inV ?? params.rwnd ?? 16));
  const steps = [
    { who: "c→s", seg: "SYN seq=x", cs: "SYN_SENT", ss: "LISTEN→SYN_RCVD" },
    { who: "s→c", seg: "SYN+ACK seq=y,ack=x+1", cs: "SYN_SENT", ss: "SYN_RCVD" },
    { who: "c→s", seg: "ACK seq=x+1,ack=y+1", cs: "ESTABLISHED", ss: "ESTABLISHED" },
    { who: "c→s", seg: "DATA + ACK (通告窗口 rwnd=" + rwnd + ")", cs: "ESTABLISHED", ss: "ESTABLISHED" },
    { who: "c→s", seg: "FIN seq=u", cs: "FIN_WAIT_1", ss: "ESTABLISHED" },
    { who: "s→c", seg: "ACK ack=u+1", cs: "FIN_WAIT_2", ss: "CLOSE_WAIT" },
    { who: "s→c", seg: "FIN seq=v", cs: "FIN_WAIT_2", ss: "LAST_ACK" },
    { who: "c→s", seg: "ACK ack=v+1 → TIME_WAIT(2MSL)", cs: "TIME_WAIT", ss: "CLOSED" },
  ];
  const frames = steps.map((s, i) => {
    const items = [
      labelM(110, 20, "客户机", "#344153", 12), labelM(290, 20, "服务器", "#344153", 12),
      line(110, 28, 110, 210, "#9aa7b5"), line(290, 28, 290, 210, "#9aa7b5"),
      label(110, 226, s.cs, "#4f46e5", 10), label(290, 226, s.ss, "#b15236", 10),
    ];
    steps.slice(0, i + 1).forEach((m, k) => {
      const y = 44 + k * 20;
      const c2s = m.who === "c→s";
      items.push(arrow(c2s ? 116 : 284, y, c2s ? 284 : 116, y, k === i ? "#be531a" : "#8c95a4"));
      items.push(labelM(200, y - 4, m.seg, k === i ? "#be531a" : "#5a6675", 8.5));
    });
    return { title: "报文 " + (i + 1) + "/" + steps.length, summary: s.who + "：" + s.seg + "　客户 " + s.cs + " · 服务 " + s.ss, shapes: { viewBox: [400, 240], items } };
  });
  return { data: { msgs: steps.length, rwnd, timeWait: "2MSL" }, frames };
}`;

/** 发送窗口 min(cwnd,rwnd) 与在途管道利用率。 */
export const winLimitRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${fmt}
  ${tcpReno}
  const rwnd = Math.max(2, Math.round(inV ?? params.rwnd ?? 16));
  const ssth0 = Math.max(2, Math.round(auxV ?? params.ssthresh ?? 8));
  const rounds = Math.max(6, Math.min(40, Math.round(params.rounds ?? 24)));
  const lossAt = Math.max(2, Math.min(rounds - 2, Math.round(params.lossAt ?? 10)));
  const trace = tcpReno(ssth0, rounds, lossAt, 0);
  const eff = trace.map(t => Math.min(t.cwnd, rwnd));
  const limited = trace.map((t, i) => t.cwnd > rwnd ? "rwnd" : "cwnd");
  const byRwnd = limited.filter(x => x === "rwnd").length;
  const lanes = [
    { label: "cwnd", segments: trace.map(t => ({ label: String(t.cwnd), start: t.rtt, end: t.rtt + 0.9 })) },
    { label: "min(cwnd,rwnd)", segments: trace.map((t, i) => ({ label: String(eff[i]), start: t.rtt, end: t.rtt + 0.9 })) },
    { label: "受限方", segments: trace.filter((t, i) => i > 0).map((t, i) => ({ label: limited[i + 1] === "rwnd" ? "rwnd!" : "cwnd", start: t.rtt, end: t.rtt + 0.9 })) },
  ];
  const util = eff.map((e, i) => Math.round(1000 * e / Math.max(trace[i].cwnd, 1)) / 10);
  const frames = trace.filter((_, i) => i % 3 === 0 || trace[i].event || i === trace.length - 1).map((t) => ({
    title: "RTT " + t.rtt, summary: "cwnd=" + t.cwnd + " rwnd=" + rwnd + " → 发送窗 " + Math.min(t.cwnd, rwnd) + (t.cwnd > rwnd ? "（接收窗卡脖子！）" : "") + (t.event ? " ⚡" + t.event : ""),
    timeline: lanes,
    series: [{ label: "利用率%", values: util }],
  }));
  return { data: { rwnd, ssth0, limitedByRwnd: byRwnd, effWindow: eff, minUtil: Math.min(...util) }, frames };
}`;
