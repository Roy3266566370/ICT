/** 408 全景沙盘规则（第二批下）：操作系统 os01/os02/os04 + 计算机网络 cn01/cn02/cn04。
 * 契约同 lab408SandboxRules.ts：`function run({ text, params, upstream, rand })` → { data, frames }。
 */

import { arrow, auxScalar, box, dot, fmt, inAlgo, inScalar, label, labelMid, line, miss408, seqOf } from './lab408SandboxRules.ts';

/* ============================== OS · 第 1–2 章：进程状态与 CPU 调度 ============================== */

const schedSim = `const schedSim = (procs, algo, quantum) => {
  const remaining = procs.map(p => p.burst);
  const pending = procs.map((_, i) => i).sort((a, b) => procs[a].arrive - procs[b].arrive || a - b);
  const ready = [], segs = [], finishAt = [];
  let next = 0, t = 0, switches = 0;
  const enqueueArrivals = () => {
    while (next < pending.length && procs[pending[next]].arrive <= t) ready.push(pending[next++]);
  };
  while (next < pending.length || ready.length) {
    if (!ready.length) t = Math.max(t, procs[pending[next]].arrive);
    enqueueArrivals();
    if (algo === 1 || algo === 2) ready.sort((a, b) => remaining[a] - remaining[b]);
    const current = ready.shift();
    const untilArrival = next < pending.length ? procs[pending[next]].arrive - t : Infinity;
    let duration = remaining[current];
    if (algo === 2) duration = Math.min(duration, untilArrival);
    if (algo === 3) {
      // Skip consecutive time slices when nobody else can run.
      const untilRotation = ready.length ? quantum : Math.ceil(untilArrival / quantum) * quantum;
      duration = Math.min(duration, untilRotation);
    }
    const last = segs.at(-1);
    if (last && last.e === t) {
      if (last.p === current) last.e = t + duration;
      else {
        switches++;
        segs.push({ p: current, s: t, e: t + duration });
      }
    } else segs.push({ p: current, s: t, e: t + duration });
    t += duration;
    remaining[current] -= duration;
    if (remaining[current] === 0) finishAt[current] = t;
    // Arrivals at a quantum boundary go ahead of the expired process in RR.
    enqueueArrivals();
    if (remaining[current] > 0) {
      if (algo === 2) ready.unshift(current);
      else ready.push(current);
    }
  }
  const turn = procs.map((p, i) => finishAt[i] - p.arrive);
  const wturn = procs.map((p, i) => turn[i] / p.burst);
  return { segs, turn, wturn, finishAt, switches, end: t };
};`;

/** 四调度算法甘特图逐帧推演 + 周转核算表。 */
export const schedGanttRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${schedSim}
  ${fmt}
  const vals = seqOf(inA);
  if (vals.length < 2) { ${miss408} }
  const procs = [];
  for (let i = 0; i + 1 < vals.length && procs.length < 8; i += 2) procs.push({ id: "P" + (procs.length + 1), arrive: Math.max(0, vals[i]), burst: Math.max(1, vals[i + 1]) });
  if (procs.some(p => p.arrive > 1e9) || procs.reduce((total, p) => total + p.burst, 0) > 10000) {
    return { data: {}, frames: [{ title: "进程表超出范围", summary: "到达时间最多 10 亿，服务时间合计最多 10000。" }] };
  }
  const algo = Math.max(0, Math.min(3, Math.round(params.algo ?? 0)));
  const quantum = Math.max(1, Math.min(8, Math.round(auxV ?? params.q ?? 2)));
  const names = ["FCFS", "SJF(非抢占)", "SRTF(抢占SJF)", "RR q=" + quantum];
  const sim = schedSim(procs, algo, quantum);
  const lanes = [{ label: "CPU", segments: sim.segs.map(g => ({ label: "P" + (g.p + 1), start: g.s, end: g.e })) }];
  const frames = [];
  for (let t = 0; t <= Math.min(sim.end, 40); t++) {
    const running = sim.segs.find(g => g.s <= t && t < g.e);
    frames.push({
      title: "t=" + t, summary: running ? "运行 P" + (running.p + 1) : "CPU 空闲",
      timeline: [{ label: "CPU", segments: sim.segs.filter(g => g.s < t).map(g => ({ label: "P" + (g.p + 1), start: g.s, end: Math.min(g.e, t) })) }],
    });
  }
  frames.push({
    title: names[algo] + " 汇总", summary: "平均周转 " + fmt(sim.turn.reduce((a, b) => a + b, 0) / procs.length, 4) + " · 带权 " + fmt(sim.wturn.reduce((a, b) => a + b, 0) / procs.length, 4) + " · 切换 " + sim.switches + " 次",
    ...(sim.segs.length <= 100 ? { timeline: lanes } : {}),
    columns: ["进程", "到达", "服务", "完成", "周转", "带权"],
    rows: procs.map((p, i) => [p.id, p.arrive, p.burst, sim.finishAt[i], sim.turn[i], fmt(sim.wturn[i], 3)]),
  });
  return { data: { algo: names[algo], end: sim.end, avgTurn: Math.round(sim.turn.reduce((a, b) => a + b, 0) / procs.length * 100) / 100, avgWTurn: Math.round(sim.wturn.reduce((a, b) => a + b, 0) / procs.length * 100) / 100, switches: sim.switches, perProc: sim.turn }, frames };
}`;

/** 四算法同进程表指标擂台：平均周转 / 带权周转 / 切换数。 */
export const schedRaceRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${schedSim}
  ${fmt}
  const vals = seqOf(inA);
  if (vals.length < 2) { ${miss408} }
  const procs = [];
  for (let i = 0; i + 1 < vals.length && procs.length < 8; i += 2) procs.push({ id: "P" + (procs.length + 1), arrive: Math.max(0, vals[i]), burst: Math.max(1, vals[i + 1]) });
  if (procs.some(p => p.arrive > 1e9) || procs.reduce((total, p) => total + p.burst, 0) > 10000) {
    return { data: {}, frames: [{ title: "进程表超出范围", summary: "到达时间最多 10 亿，服务时间合计最多 10000。" }] };
  }
  const quantum = Math.max(1, Math.min(8, Math.round(auxV ?? params.q ?? 2)));
  const names = ["FCFS", "SJF", "SRTF", "RR q=" + quantum];
  const races = [0, 1, 2, 3].map(a => ({ name: names[a], sim: schedSim(procs, a, quantum) }));
  const avgT = races.map(r => Math.round(r.sim.turn.reduce((a, b) => a + b, 0) / procs.length * 100) / 100);
  const avgW = races.map(r => Math.round(r.sim.wturn.reduce((a, b) => a + b, 0) / procs.length * 100) / 100);
  const sw = races.map(r => r.sim.switches);
  const frames = races.map((r, k) => ({
    title: r.name, summary: "平均周转 " + avgT[k] + " · 带权 " + avgW[k] + " · 切换 " + sw[k] + " 次 · 总耗时 " + r.sim.end,
    columns: ["算法", "平均周转", "平均带权", "切换", "总耗时"],
    rows: races.map((x, i) => [x.name, avgT[i], avgW[i], sw[i], x.sim.end]), highlightRows: [k],
    series: [{ label: "平均周转", values: avgT }, { label: "平均带权", values: avgW }, { label: "切换次数", values: sw }],
  }));
  const best = avgT.indexOf(Math.min(...avgT));
  return { data: { avgTurn: avgT, avgWTurn: avgW, switches: sw, bestAlgo: names[best] }, frames };
}`;

/* ============================== OS · 第 2 章：PV 同步互斥与银行家 ============================== */

/** 生产者-消费者 PV 逐帧演化：mutex/empty/full 三信号量，错序复现死锁。 */
export const pvSimRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const buf = Math.max(1, Math.min(6, Math.round(inV ?? params.buf ?? 2)));
  const wrong = Math.round(params.wrong ?? 0) === 1;
  const steps = Math.max(4, Math.min(14, Math.round(params.steps ?? 10)));
  // 信号量：empty=空位数, full=满位数, mutex=1
  let mutex = 1, empty = buf, full = 0;
  const pq = [], cq = []; // 阻塞队列
  let deadlockAt = -1;
  const frames = [];
  const snap = (note, k) => frames.push({ title: "第 " + (k + 1) + " 事件", summary: note + "；empty=" + empty + " full=" + full + " mutex=" + mutex, shapes: draw(k) });
  const draw = (k) => {
    const items = [label(20, 20, "缓冲区 n=" + buf, "#344153", 11)];
    for (let i = 0; i < buf; i++) { items.push(box(60 + i * 50, 30, 44, 26, i < full ? "#dbe7ff" : "#f4f6f9", "#8c95a4")); items.push(labelM(82 + i * 50, 47, i < full ? "满" : "空", "#5a6675", 9)); }
    items.push(label(20, 86, "mutex=" + mutex + "  empty=" + empty + "  full=" + full, "#be531a", 11));
    items.push(label(20, 108, "生产者阻塞队列 [" + pq.join(",") + "]", "#5a6675", 9.5));
    items.push(label(20, 126, "消费者阻塞队列 [" + cq.join(",") + "]", "#5a6675", 9.5));
    if (deadlockAt >= 0) items.push(label(20, 156, "☠ 死锁：一方持 mutex 等资源信号量，另一方卡在 P(mutex)", "#b15236", 10.5));
    return { viewBox: [380, 170], items };
  };
  if (wrong) {
    // 错序固定剧本：P(mutex) 先于资源信号量 → 空缓冲 + 消费者先抢 mutex 即死锁
    snap("初始：缓冲空，empty=" + buf + " full=0 mutex=1", 0);
    mutex = 0; snap("C1: P(mutex) ✓ 抢占互斥锁（mutex=0），还未检查 full", 1);
    cq.push("C1"); deadlockAt = 2;
    snap("C1: P(full)：full=0 → C1 阻塞，且仍持有 mutex！", 2);
    pq.push("P1");
    snap("P1: P(mutex)：mutex=0 → P1 也阻塞。双方互等 → 死锁", 3);
    frames.push({ title: "对比", summary: "正确顺序先 P(资源) 后 P(mutex)：阻塞在 empty/full 时不占锁，另一方仍可推进", shapes: draw(4) });
    return { data: { buf, wrong, deadlockAt: deadlockAt + 1, events: frames.length }, frames };
  }
  // 正确顺序：P(资源信号量) → P(mutex) → 临界区 → V(mutex) → V(资源)
  let pIx = 0, cIx = 0;
  for (let k = 0; k < steps; k++) {
    const isP = k % 2 === 0;
    if (isP) {
      pIx++;
      if (empty <= 0) { pq.push("P" + pIx); snap("P" + pIx + " P(empty) 阻塞（empty=0，未持锁）", k); continue; }
      empty--; full++;
      if (cq.length) { cq.shift(); }
      snap("P" + pIx + " P(empty)→P(mutex)→生产→V(mutex)→V(full)" + (cq.length || full ? "" : ""), k);
    } else {
      cIx++;
      if (full <= 0) { cq.push("C" + cIx); snap("C" + cIx + " P(full) 阻塞（full=0，未持锁）", k); continue; }
      full--; empty++;
      if (pq.length) pq.shift();
      snap("C" + cIx + " P(full)→P(mutex)→消费→V(mutex)→V(empty)", k);
    }
  }
  frames.push({ title: "汇总", summary: "正确顺序：先资源信号量后互斥量，全程无死锁", shapes: draw(steps - 1) });
  return { data: { buf, wrong, deadlockAt: null, events: frames.length }, frames };
}`;

/** 银行家算法安全判定：Allocation/Max/Need/Available 与逐进程推进。 */
export const bankerRule = `function run({ params, upstream }) {
  ${fmt}
  const procs = [
    { id: "P0", alloc: [0, 1, 0], max: [7, 5, 3] },
    { id: "P1", alloc: [2, 0, 0], max: [3, 2, 2] },
    { id: "P2", alloc: [3, 0, 2], max: [9, 0, 2] },
    { id: "P3", alloc: [2, 1, 1], max: [2, 2, 2] },
    { id: "P4", alloc: [0, 0, 2], max: [4, 3, 3] },
  ];
  const avail0 = [Math.max(0, Math.round(params.a ?? 3)), Math.max(0, Math.round(params.b ?? 3)), Math.max(0, Math.round(params.c ?? 2))];
  const need = procs.map(p => p.max.map((m, j) => m - p.alloc[j]));
  let work = avail0.slice();
  const done = Array(procs.length).fill(false);
  const order = [];
  const frames = [];
  let guard = 0;
  while (order.length < procs.length && guard++ < 12) {
    const pick = procs.findIndex((p, i) => !done[i] && need[i].every((nd, j) => nd <= work[j]));
    if (pick < 0) break;
    done[pick] = true; order.push(procs[pick].id);
    work = work.map((w, j) => w + procs[pick].alloc[j]);
    frames.push({
      title: "放行 " + procs[pick].id, summary: "Need(" + need[pick].join(",") + ") ≤ Available → 放行后 Available=" + work.join(","),
      columns: ["进程", "Allocation", "Max", "Need", "可用"],
      rows: procs.map((p, i) => [p.id, p.alloc.join(","), p.max.join(","), need[i].join(","), done[i] ? work.join(",") : "…"]),
      highlightRows: [pick],
    });
  }
  const safe = order.length === procs.length;
  frames.push({ title: safe ? "安全" : "不安全", summary: safe ? "存在安全序列 " + order.join(" → ") : "推进 " + order.length + " 步后无可放行进程 → 死锁风险", columns: ["安全序列"], rows: [[order.join(" → ") || "无"]] });
  return { data: { safe, order, avail: avail0 }, frames };
}`;

/* ============================== OS · 第 4–5 章：文件索引与磁盘调度 ============================== */

const diskSims = `const diskSims = (reqs, start, maxTrack) => {
  const dir = (a, b) => Math.abs(a - b);
  const fcfs = () => { let cur = start, tot = 0; const trace = [start]; reqs.forEach(r => { tot += dir(cur, r); cur = r; trace.push(r); }); return { name: "FCFS", total: tot, trace }; };
  const sstf = () => { const left = reqs.slice(); let cur = start, tot = 0; const trace = [start]; while (left.length) { let bi = 0; left.forEach((r, i) => { if (dir(cur, r) < dir(cur, left[bi])) bi = i; }); tot += dir(cur, left[bi]); cur = left.splice(bi, 1)[0]; trace.push(cur); } return { name: "SSTF", total: tot, trace }; };
  const scan = (circular) => {
    const up = reqs.filter(r => r >= start).sort((a, b) => a - b), down = reqs.filter(r => r < start).sort((a, b) => b - a);
    let tot = 0, cur = start; const trace = [start];
    up.forEach(r => { tot += dir(cur, r); cur = r; trace.push(r); });
    if (down.length) { if (!circular) { tot += dir(cur, maxTrack); trace.push(maxTrack); cur = maxTrack; } down.forEach(r => { tot += dir(cur, r); cur = r; trace.push(r); }); }
    return { name: circular ? "C-SCAN" : "SCAN", total: tot, trace };
  };
  return [fcfs(), sstf(), scan(false), scan(true)];
};`;

/** 磁头轨迹擂台：FCFS / SSTF / SCAN / C-SCAN 同序列路径与总寻道。 */
export const diskTraceRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${diskSims}
  ${fmt}
  const reqs = seqOf(inA).map(v => Math.max(0, Math.min(199, Math.round(v)))).slice(0, 12);
  if (!reqs.length) { ${miss408} }
  const maxTrack = 199;
  const start = Math.max(0, Math.min(maxTrack, Math.round(auxV ?? params.head ?? 50)));
  const races = diskSims(reqs, start, maxTrack);
  const frames = races.map((r, k) => ({
    title: r.name, summary: "磁头从 " + start + " 出发，轨迹 " + r.trace.join("→") + "，总寻道 " + r.total + " 磁道",
    timeline: [{ label: r.name + " 总=" + r.total, segments: r.trace.map((v, i) => ({ label: String(v), start: i, end: i + 0.85 })) }],
    columns: ["算法", "总寻道", "最长跳", "轨迹"], rows: races.map(x => [x.name, x.total, Math.max(...x.trace.slice(1).map((v, i) => Math.abs(v - x.trace[i])), 0), x.trace.join("→").slice(0, 42)]), highlightRows: [k],
    series: [{ label: "总寻道磁道数", values: races.map(x => x.total) }],
  }));
  const best = races.reduce((a, b) => a.total <= b.total ? a : b);
  return { data: { start, totals: Object.fromEntries(races.map(r => [r.name, r.total])), best: best.name }, frames };
}`;

/** inode 混合索引容量核算 + 位示图分配。 */
export const inodeRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const blkKB = Math.max(1, Math.min(8, Math.round(inV ?? params.blk ?? 4)));
  const addrB = 4, perBlk = blkKB * 1024 / addrB;
  const direct = 10;
  const lv1 = perBlk, lv2 = perBlk * perBlk, lv3 = perBlk * perBlk * perBlk;
  const maxFile = (direct + lv1 + lv2 + lv3) * blkKB;
  const fileKB = Math.max(1, Math.round(auxV ?? params.fileKB ?? 20000));
  const needBlk = Math.ceil(fileKB / blkKB);
  const rest = needBlk - direct;
  const use1 = Math.min(Math.max(0, rest), lv1), rest2 = needBlk - direct - use1;
  const use2 = Math.min(Math.max(0, rest2), lv2), rest3 = needBlk - direct - use1 - use2;
  const use3 = Math.min(Math.max(0, rest3), lv3);
  const fits = needBlk <= direct + lv1 + lv2 + lv3;
  const items = [
    label(20, 22, "UNIX inode 混合索引（块 " + blkKB + "KB · 地址 4B · 每块 " + perBlk + " 项）", "#344153", 10.5),
  ];
  const rows2 = [
    ["直接 ×" + direct, direct + " 块", Math.min(needBlk, direct) + " 块", "最小 " + direct * blkKB + "KB"],
    ["一级间接", "1×" + perBlk + "=" + lv1 + " 块", use1 + " 块", "到 " + (direct + lv1) * blkKB + "KB"],
    ["二级间接", perBlk + "²=" + lv2 + " 块", use2 + " 块", "到 " + (direct + lv1 + lv2) * blkKB + "KB"],
    ["三级间接", perBlk + "³=" + lv3 + " 块", use3 + " 块", "上限 " + maxFile + "KB"],
  ];
  rows2.forEach((r, i) => {
    const y = 40 + i * 24;
    items.push(box(20, y, 100, 20, ["#dbe7ff", "#d6f0d9", "#ffe3d6", "#f3e8ff"][i], "#8c95a4"));
    items.push(label(26, y + 14, r[0], "#344153", 9.5));
    items.push(label(130, y + 14, r[1], "#5a6675", 9.5));
    items.push(label(260, y + 14, "本文件用 " + r[2], "#be531a", 9.5));
    items.push(label(370, y + 14, r[3], "#9aa7b5", 8.5));
  });
  items.push(label(20, 150, "文件 " + fileKB + "KB 需 " + needBlk + " 块 → " + (fits ? "装得下" : "超出 inode 上限！"), "#be531a", 11));
  const frames = [{
    title: "混合索引容量", summary: "每块 " + perBlk + " 个地址项；最大文件 = (10 + " + perBlk + " + " + perBlk + "² + " + perBlk + "³)×" + blkKB + "KB = " + maxFile + "KB（约 " + fmt(maxFile / 1048576, 4) + "GB）",
    shapes: { viewBox: [440, 165], items },
    columns: ["索引级", "容量", "本文件", "累计覆盖"], rows: rows2,
  }];
  return { data: { blkKB, perBlk, maxFileKB: maxFile, needBlk, fits }, frames };
}`;

/* ============================== CN · 第 2–3 章：编码、滑动窗口与 CSMA/CD ============================== */

/** NRZ / 曼彻斯特 / 差分曼彻斯特波形对照。 */
export const manchesterRule = `function run({ params, upstream, text }) {
  ${line}
  ${dot}
  ${label}
  ${labelMid}
  const BITSETS = ["10110011", "01001110", "11110000"];
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const bits = (String(text || "").replace(/[^01]/g, "") || BITSETS[variant]).slice(0, 12);
  const X0 = 30, W = 28, Y = [30, 90, 150];
  const draw = (levelSeq, yIx, name, color) => {
    const items = [label(24, Y[yIx] - 14, name, "#344153", 10)];
    items.push(line(X0, Y[yIx] + 22, X0 + bits.length * W, Y[yIx] + 22, "#dfe5ec"));
    for (let i = 0; i < bits.length; i++) {
      const x = X0 + i * W;
      items.push(line(x, Y[yIx] - 8, x, Y[yIx] + 22, "#eef1f5", true));
      items.push(labelM(x + W / 2, Y[yIx] + 34, bits[i], "#9aa7b5", 8));
    }
    let px = X0, py = Y[yIx] + (levelSeq[0] ? 0 : 20);
    items.push(dot(px, py, color, 2.5));
    levelSeq.forEach((lv, i) => {
      const nx = X0 + (i + 1) * W, ny = Y[yIx] + (lv ? 0 : 20);
      items.push(line(px, py, nx, py, color));
      if (ny !== py) items.push(line(nx, py, nx, ny, color));
      px = nx; py = ny;
      items.push(dot(px, py, color, 2.5));
    });
    return items;
  };
  const nrz = bits.split("").map(b => b === "1");
  const manch = bits.split("").flatMap(b => b === "1" ? [false, true] : [true, false]);
  let last = false;
  const diff = bits.split("").flatMap(b => { if (b === "0") last = !last; return [last, last]; });
  const frames = [
    { title: "NRZ 不归零", summary: "1=高 0=低，长连 0/1 会丢时钟同步", shapes: { viewBox: [400, 200], items: draw(nrz, 0, "NRZ", "#4f46e5") } },
    { title: "曼彻斯特", summary: "每位中间必跳变：1=高→低跳（以太网约定）——自带时钟但带宽×2", shapes: { viewBox: [400, 200], items: draw(manch, 1, "曼彻斯特", "#b15236") } },
    { title: "差分曼彻斯特", summary: "位中总有跳变；0=位首再跳，1=位首不跳——抗极性反转", shapes: { viewBox: [400, 200], items: draw(diff, 2, "差分曼彻斯特", "#1f7a3d") } },
  ];
  return { data: { bits, nrzTransitions: nrz.filter((v, i) => i && v !== nrz[i - 1]).length }, frames };
}`;

/** 停等 / GBN / SR 丢帧重传轨迹与信道利用率擂台。 */
export const arqRaceRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${fmt}
  const delay = Math.max(1, Math.min(8, Math.round(inV ?? params.delay ?? 3)));
  const total = Math.max(4, Math.min(10, Math.round(params.frames ?? 6)));
  const lossAt = Math.max(1, Math.min(total, Math.round(params.lossAt ?? 3)));
  const w = Math.min(delay + 1, 4);
  const resend = Math.min(w, total - lossAt + 1); // GBN 丢失帧起连窗重发
  const races = [
    { name: "停等", sends: total + 1, time: (total + 1) * 2 * delay,
      lanes: Array.from({ length: total + 1 }, (_, i) => ({ label: "f" + Math.min(i + 1, i === lossAt ? lossAt : i + (i > lossAt ? 0 : 1)), segments: [{ label: i === lossAt ? "超时重发 f" + lossAt : "f" + Math.min(i + 1, i > lossAt ? i : i + 1) + "→ACK", start: i * 2 * delay, end: i * 2 * delay + 2 * delay }] })) },
    { name: "GBN w=" + w, sends: total + resend, time: (Math.ceil((total + resend) / w) + 1) * 2 * delay,
      lanes: [{ label: "管道", segments: [{ label: "批量 w=" + w + " 帧", start: 0, end: (Math.ceil((total + resend) / w) + 1) * 2 * delay }] }, { label: "丢 f" + lossAt + " 回退重传 " + resend + " 帧", segments: [{ label: "回退N", start: 2 * delay, end: (2 + w) * delay }] }] },
    { name: "SR w=" + w, sends: total + 1, time: Math.ceil(total / w) * 2 * delay + delay,
      lanes: [{ label: "管道", segments: [{ label: "只补 f" + lossAt, start: 0, end: Math.ceil(total / w) * 2 * delay + delay }] }] },
  ];
  const util = races.map(r => Math.round(1000 * total * 1 / Math.max(1, r.time)) / 10);
  const frames2 = races.map((r, k) => ({
    title: r.name, summary: "发 " + r.sends + " 帧送 " + total + " 帧，丢帧 #" + lossAt + "；利用率≈" + util[k] + "%",
    columns: ["协议", "发送帧数", "耗时", "利用率%"], rows: races.map((x, i) => [x.name, x.sends, x.time, util[i]]), highlightRows: [k],
    timeline: r.lanes,
    series: [{ label: "利用率%", values: util }, { label: "发送帧数", values: races.map(x => x.sends) }],
  }));
  return { data: { delay, lossAt, util, sends: races.map(r => r.sends) }, frames: frames2 };
}`;

/** CSMA/CD 争用期 2τ、最短帧长与冲突检测时序。 */
export const csmaRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${line}
  ${arrow}
  ${dot}
  ${label}
  ${labelMid}
  ${fmt}
  const dist = Math.max(0.1, Math.min(10, (inV ?? params.dist ?? 1) ));
  const rate = Math.max(1, Math.min(10000, Math.round(auxV ?? params.mbps ?? 100)));
  const v = 2e8; // 传播速度 m/s
  const tau = dist * 1000 / v; // s
  const contention = 2 * tau;
  const minBits = Math.ceil(contention * rate * 1e6);
  const minBytes = Math.ceil(minBits / 8);
  const y = 90;
  const items = [
    labelM(60, 40, "A", "#344153", 12), labelM(340, 40, "B", "#344153", 12),
    line(60, 60, 60, 130, "#344153"), line(340, 60, 340, 130, "#344153"),
    line(60, 95, 340, 95, "#dfe5ec", true),
    labelM(200, 60, "距离 " + dist + " km · τ=" + fmt(tau * 1e6, 4) + "μs", "#5a6675", 9.5),
    arrow(66, 80, 250, 80, "#4f46e5"), labelM(160, 72, "A 的信号传向 B", "#4f46e5", 9),
    arrow(334, 112, 160, 112, "#b15236"), labelM(245, 120, "B 在 τ−ε 抢发，碰撞回传", "#b15236", 9),
    dot(255, 95, "#be531a", 5), labelM(255, 88, "碰撞", "#be531a", 9),
    label(30, 160, "最坏情形：B 在信号到达前 ε 抢发 → A 要在 2τ 内才知碰撞", "#5a6675", 9.5),
    label(30, 178, "争用期 2τ = " + fmt(contention * 1e6, 4) + " μs → 最短帧 " + minBits + " bit ≈ " + minBytes + " B", "#be531a", 10.5),
    label(30, 196, "速率 " + rate + "Mbps 时帧长不足 " + minBytes + "B 的帧检测不到远端冲突", "#9aa7b5", 9),
  ];
  return { data: { dist, rate, tauUs: Math.round(tau * 1e9) / 1000, contentionUs: Math.round(contention * 1e9) / 1000, minBytes },
    frames: [{ title: "CSMA/CD 争用期", summary: "2τ=" + fmt(contention * 1e6, 4) + "μs · 最短帧长=" + minBytes + "B", shapes: { viewBox: [400, 210], items } }] };
}`;

/* ============================== CN · 第 4 章：IPv4 子网、分片与路由收敛 ============================== */

/** CIDR 位段拆解：网络/主机位、可用地址数与最长前缀匹配。 */
export const subnetRule = `function run({ params, upstream }) {
  ${inScalar}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const plen = Math.max(8, Math.min(30, Math.round(inV ?? params.plen ?? 26)));
  const ip = [192, 168, Math.round(params.c ?? 1), Math.round(params.d ?? 37)];
  const mask = plen >= 32 ? 0xffffffff : (0xffffffff << (32 - plen)) >>> 0;
  const ipN = ip.reduce((a, o) => ((a << 8) | (o & 255)) >>> 0, 0);
  const net = (ipN & mask) >>> 0, bcast = (net | (~mask >>> 0)) >>> 0;
  const hostBits = 32 - plen, hosts = Math.max(0, (1 << hostBits) - 2);
  const toIp = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
  const items = [
    label(24, 26, "IP " + ip.join(".") + " /" + plen, "#344153", 11),
    box(24, 36, 300 * plen / 32, 22, "#4f46e5", "#4f46e5"), box(24 + 300 * plen / 32, 36, 300 * (32 - plen) / 32, 22, "#eef1f5", "#8c95a4"),
    labelM(24 + 150 * plen / 32, 51, "网络位 " + plen, "#fff", 9), labelM(24 + 300 * plen / 32 + 150 * (32 - plen) / 32, 51, "主机位 " + hostBits, "#344153", 9),
    label(24, 84, "网络地址 " + toIp(net), "#344153", 10),
    label(24, 102, "广播地址 " + toIp(bcast), "#344153", 10),
    label(24, 120, "可用主机 2^" + hostBits + " − 2 = " + hosts, "#be531a", 11),
    label(24, 144, "FIB 最长前缀匹配：多表项命中时选 / 数最大者", "#5a6675", 9.5),
  ];
  const fib = [["192.168.0.0/16", "R1"], ["192.168.1.0/24", "R2"], [toIp(net) + "/" + plen, "R3★"], ["0.0.0.0/0", "默认"]];
  return { data: { plen, net: toIp(net), bcast: toIp(bcast), hosts, hostBits },
    frames: [{ title: "/" + plen + " 子网切分", summary: "主机位 " + hostBits + " → " + hosts + " 可用地址；该 IP 属 " + toIp(net) + "/" + plen, shapes: { viewBox: [400, 160], items }, columns: ["路由表项", "出接口"], rows: fib, highlightRows: [2] }] };
}`;

/** IP 分片：MF/DF/片偏移字段核算表。 */
export const fragRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const mtu = Math.max(256, Math.min(9000, Math.round(inV ?? params.mtu ?? 1500)));
  const dgram = Math.max(mtu, Math.min(9000, Math.round(params.size ?? 4000)));
  const head = 20;
  const dataBytes = dgram - head;
  const perFrag = Math.floor((mtu - head) / 8) * 8;
  const n = Math.ceil(dataBytes / perFrag);
  const rows = [];
  let off = 0;
  for (let i = 0; i < n; i++) {
    const len = Math.min(perFrag, dataBytes - off);
    rows.push([i + 1, len + head, off, off / 8, i < n - 1 ? 1 : 0]);
    off += len;
  }
  const frames = rows.map((r, i) => ({
    title: "片 " + (i + 1) + "/" + n, summary: "数据 " + r[1] - 20 + "B · 偏移 " + r[2] + "B → 字段值 " + r[3] + "（÷8）· MF=" + r[4],
    columns: ["片", "总长", "数据偏移B", "片偏移字段", "MF"], rows: rows.slice(0, i + 1), highlightRows: [i],
  }));
  frames.push({ title: "分片汇总", summary: dgram + "B 数据报过 MTU " + mtu + " → " + n + " 片；片偏移以 8B 为单位（13 位字段）", columns: ["片", "总长", "偏移B", "字段", "MF"], rows });
  return { data: { mtu, dgram, frags: n, offsets: rows.map(r => r[3]), lastLen: rows.at(-1)?.[1] }, frames };
}`;

/** 链路故障后的收敛对照：RIP 计数到无穷 vs OSPF 一轮泛洪重算。 */
export const ripOspfRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const linkDown = Math.max(1, Math.min(6, Math.round(inV ?? params.hops ?? 3)));
  // 线性拓扑 A-B-C-D-E 断 A-B 链路：RIP 以毒化逆转仍要若干轮才置 16
  const ripRounds = Math.min(16, linkDown * 2 + 2);
  const ripMarks = Array.from({ length: ripRounds }, (_, i) => ({
    round: i + 1,
    metric: Math.min(16, i + linkDown),
    note: i + linkDown >= 16 ? "度量=16 不可达，删路由" : "收到邻居更大度量 " + (i + linkDown) + " → 更新再广播",
  }));
  const ospfMarks = [{ round: 1, metric: "LSA", note: "检测到断链 → 泛洪 LSA" }, { round: 2, metric: "SPF", note: "各自重跑 Dijkstra → 新路由" }];
  const frames = [
    ...ripMarks.map(m => ({
      title: "RIP 第 " + m.round + " 轮", summary: m.note + "（坏消息传得慢）",
      columns: ["轮次", "到 A 的度量"], rows: ripMarks.slice(0, m.round).map(x => [x.round, x.metric]),
      series: [{ label: "RIP 度量", values: ripMarks.slice(0, m.round).map(x => x.metric) }, { label: "OSPF 收敛", values: ripMarks.slice(0, m.round).map(() => 2) }],
    })),
    { title: "OSPF 对照", summary: "断链后 " + ospfMarks.map(m => m.note).join("；") + " —— 2 步即收敛",
      columns: ["协议", "收敛轮次", "机制"], rows: [["RIP", ripRounds + " 轮", "只与邻居换距离向量，慢收敛"], ["OSPF", "≈2 步", "泛洪链路状态 + 本地 Dijkstra"]] },
  ];
  return { data: { linkDown, ripRounds, ospfSteps: 2 }, frames };
}`;

/* ============================== CN · 第 6 章：DNS、HTTP 与五层全栈贯通 ============================== */

/** DNS 递归解析 + HTTP 三种连接模式 RTT 时间轴。 */
export const dnsHttpRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const rtt = Math.max(1, Math.min(200, Math.round(inV ?? params.rtt ?? 30)));
  const objs = Math.max(2, Math.min(8, Math.round(params.objs ?? 4)));
  const dnsSteps = Math.max(2, Math.min(4, Math.round(params.dns ?? 3)));
  const modes = [
    { name: "非持久连接", cost: dnsSteps * rtt + objs * 2 * rtt, note: "每对象 TCP(1RTT)+HTTP(1RTT)" },
    { name: "持久·串行", cost: dnsSteps * rtt + 1 * rtt + objs * rtt, note: "TCP 一次 + 每对象 1RTT" },
    { name: "持久·流水线", cost: dnsSteps * rtt + 1 * rtt + 1 * rtt + rtt, note: "TCP + 首页 + 流水线批量" },
  ];
  const lanes = modes.map((m, i) => ({ label: m.name, segments: [
    { label: "DNS " + dnsSteps + "跳", start: 0, end: dnsSteps * rtt },
    { label: "TCP", start: dnsSteps * rtt, end: dnsSteps * rtt + rtt },
    { label: "HTTP×" + objs, start: dnsSteps * rtt + rtt, end: m.cost },
  ] }));
  const frames = modes.map((m, i) => ({
    title: m.name, summary: m.note + " → 总 " + m.cost + "ms（RTT=" + rtt + "ms, " + objs + " 对象）",
    columns: ["模式", "总耗时ms", "节省"], rows: modes.map((x, j) => [x.name, x.cost, j === 0 ? "基准" : Math.round(100 * (1 - x.cost / modes[0].cost)) + "%"]), highlightRows: [i],
    timeline: lanes.slice(0, i + 1),
    series: [{ label: "总耗时 ms", values: modes.map(x => x.cost) }],
  }));
  return { data: { rtt, objs, dnsSteps, costs: modes.map(m => m.cost), saved: modes.map(m => Math.round(100 * (1 - m.cost / modes[0].cost))) }, frames };
}`;

/** 五层封装：报文穿过应用→物理各层加/去首部。 */
export const stackRule = `function run({ params, upstream, text }) {
  ${box}
  ${label}
  ${labelMid}
  ${arrow}
  ${line}
  ${fmt}
  const payload = String(text || "GET /index.html").slice(0, 14);
  const layers = [
    { name: "应用层", unit: "报文", head: "HTTP: " + payload, fill: "#dbe7ff" },
    { name: "传输层", unit: "报文段", head: "TCP: sport,dport,seq,ack", fill: "#d6f0d9" },
    { name: "网络层", unit: "数据报", head: "IP: srcIP,dstIP,TTL", fill: "#ffe3d6" },
    { name: "链路层", unit: "帧", head: "MAC: srcMAC,dstMAC,FCS", fill: "#f3e8ff" },
    { name: "物理层", unit: "比特", head: "→ 010110…", fill: "#eef1f5" },
  ];
  const focus = Math.round(params.focus ?? -1);
  const frames = layers.map((L, i) => {
    const items = [label(24, 24, "第 " + (i + 1) + " 层 " + L.name + "（" + L.unit + "）" + (focus === i ? " ◀ 聚焦" : ""), "#344153", 11)];
    for (let k = 0; k <= i; k++) {
      const y = 40 + (i - k) * 26;
      items.push(box(40 + (i - k) * 26, y, 260 - (i - k) * 26, 22, focus >= 0 && focus !== k ? "#f4f6f9" : layers[k].fill, "#8c95a4"));
      items.push(label(46 + (i - k) * 26, y + 15, layers[k].head, focus >= 0 && focus !== k ? "#aab4c0" : "#344153", 8.5));
    }
    if (i > 0) items.push(arrow(150, 40 + i * 26 - 4, 150, 40 + i * 26 - 26 + 22, "#b15236"));
    items.push(label(24, 200, "逐层加首部（发送）/ 剥首部（接收）——PDU 名：报文→段→数据报→帧→比特", "#5a6675", 9.5));
    return { title: L.name + " 封装", summary: L.unit + "：" + L.head + (i < 4 ? "，交给下一层继续加首" : "，物理层比特流上链路"), shapes: { viewBox: [400, 210], items } };
  });
  return { data: { layers: layers.map(l => l.name + "/" + l.unit), focus }, frames };
}`;

/** DNS 递归 vs 迭代查询跳数对照。 */
export const rttRaceRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const rtt = Math.max(1, Math.min(200, Math.round(inV ?? params.rtt ?? 30)));
  const rec = [{ s: "本地→根", c: 1 }, { s: "根→本地(.com)", c: 1 }, { s: "本地→.com", c: 1 }, { s: ".com→本地(auth)", c: 1 }, { s: "本地→auth", c: 1 }, { s: "auth→本地(IP)", c: 1 }];
  const iter = [{ s: "本地→根", c: 1 }, { s: "本地→.com", c: 1 }, { s: "本地→auth", c: 1 }];
  const frames = [
    { title: "递归查询", summary: "本地 DNS 替你跑腿：" + rec.length + " 跳 ≈ " + rec.length * rtt + "ms", columns: ["跳", "耗时"], rows: rec.map((s, i) => [(i + 1) + " " + s.s, s.c * rtt + "ms"]), series: [{ label: "递归累计ms", values: rec.map((s, i) => (i + 1) * rtt) }] },
    { title: "迭代查询", summary: "根只指路，本地自己逐跳问：" + iter.length + " 次请求 ≈ " + iter.length * rtt + "ms", columns: ["跳", "耗时"], rows: iter.map((s, i) => [(i + 1) + " " + s.s, s.c * rtt + "ms"]), series: [{ label: "迭代累计ms", values: iter.map((s, i) => (i + 1) * rtt) }] },
    { title: "对照", summary: "递归服务器侧共 " + rec.length + " 跳（对客户透明）；迭代客户侧 " + iter.length + " 跳", columns: ["方式", "查询方", "跳数", "总耗时"], rows: [["递归", "本地DNS", rec.length, rec.length * rtt + "ms"], ["迭代", "客户", iter.length, iter.length * rtt + "ms"]], series: [{ label: "总耗时", values: [rec.length * rtt, iter.length * rtt] }] },
  ];
  return { data: { rtt, recursiveHops: rec.length, iterativeHops: iter.length }, frames };
}`;
