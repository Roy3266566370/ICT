/** 408 全景沙盘规则（第二批上）：数据结构 ds01/ds02/ds04 + 组成原理 co01/co03/co04。
 * 契约同 lab408SandboxRules.ts：`function run({ text, params, upstream, rand })` → { data, frames }。
 */

import { arrow, auxScalar, box, dot, fmt, graphParse, inAlgo, inScalar, label, labelMid, line, miss408, seqOf } from './lab408SandboxRules.ts';

const numArr = `const numArr = (s) => String(s ?? "").split(/[\\s,，;；]+/).filter(Boolean).map(Number).filter(Number.isFinite);`;

/* ============================== DS · 第 1–3 章：线性表、栈队列与 KMP ============================== */

/** 中缀表达式双栈求值：运算数栈与运算符栈逐步演化。 */
export const exprStackRule = `function run({ params, upstream, text }) {
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const EXPRS = ["3+4*2-6/2", "8-3*2+10/5", "7*2+8/4-3"];
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const expr = (text || EXPRS[variant]).replace(/\\s+/g, "");
  const ops = [], vals = [], trace = [];
  const pri = (c) => c === "+" || c === "-" ? 1 : c === "*" || c === "/" ? 2 : 0;
  const apply = () => {
    const b = vals.pop(), a = vals.pop(), o = ops.pop();
    vals.push(o === "+" ? a + b : o === "-" ? a - b : o === "*" ? a * b : a / b);
    return a + " " + o + " " + b;
  };
  const snapshot = (note) => trace.push({ vals: vals.slice(), ops: ops.slice(), note });
  let i = 0, err = "";
  while (i < expr.length) {
    const c = expr[i];
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
      vals.push(Number(num)); i--;
      snapshot("运算数 " + num + " 入栈");
    } else if (pri(c) > 0) {
      while (ops.length && pri(ops[ops.length - 1]) >= pri(c)) snapshot("弹出计算 " + apply());
      ops.push(c); snapshot("运算符 " + c + " 入栈");
    } else { err = "无法识别符号 " + c; break; }
    i++;
  }
  while (!err && ops.length) snapshot("弹出计算 " + apply());
  if (!trace.length) trace.push({ vals: [NaN], ops: [], note: err || "空表达式" });
  const frames = trace.map((s, k) => {
    const items = [
      label(30, 24, "运算数栈", "#344153", 11), label(240, 24, "运算符栈", "#344153", 11),
    ];
    s.vals.slice(-7).forEach((v, j) => {
      items.push(box(30, 168 - j * 22, 60, 20, j === s.vals.slice(-7).length - 1 ? "#dbe7ff" : "#eef1f5"));
      items.push(labelM(60, 182 - j * 22, String(Math.round(v * 100) / 100), "#344153", 10));
    });
    s.ops.slice(-7).forEach((v, j) => {
      items.push(box(240, 168 - j * 22, 60, 20, j === s.ops.slice(-7).length - 1 ? "#ffe3d6" : "#eef1f5"));
      items.push(labelM(270, 182 - j * 22, String(v), "#344153", 10));
    });
    items.push(label(30, 210, "表达式 " + expr, "#5a6675", 10));
    return { title: "第 " + (k + 1) + " 步", summary: s.note, shapes: { viewBox: [360, 220], items } };
  });
  const result = vals[vals.length - 1];
  return { data: { expr, result: Math.round((err ? NaN : result) * 10000) / 10000, steps: trace.length, err: err || null }, frames };
}`;

/** 循环队列：front/rear 指针环形演化，判满 (rear+1)%m=front 与判空演示。 */
export const queueCycleRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${box}
  ${dot}
  ${label}
  ${labelMid}
  ${fmt}
  const cap = Math.max(4, Math.min(10, Math.round(auxV ?? params.cap ?? 6)));
  const seq = seqOf(inA);
  // 上游序列当入队元素；不足时用 10..19 补；每 4 次入队穿插一次出队
  const items2 = seq.length ? seq.slice(0, 18) : Array.from({ length: 14 }, (_, i) => 10 + i);
  let front = 0, rear = 0, size = 0;
  const cells = Array(cap).fill(null);
  const marks = [];
  items2.forEach((v, i) => {
    if (i > 0 && i % 4 === 0 && size > 0) {
      marks.push({ op: "出队 " + cells[front], front, rear, cells: cells.slice(), size });
      cells[front] = null; front = (front + 1) % cap; size--;
    }
    if (size === cap) { marks.push({ op: "队满拒入 " + v + "（(rear+1)%m=front）", front, rear, cells: cells.slice(), size, full: true }); return; }
    cells[rear] = v; rear = (rear + 1) % cap; size++;
    marks.push({ op: "入队 " + v, front, rear, cells: cells.slice(), size });
  });
  const frames = marks.map((m, k) => {
    const items = [];
    for (let c = 0; c < cap; c++) {
      const x = 40 + c * 52, y = 70;
      const full = m.cells[c] !== null;
      items.push(box(x, y, 48, 34, m.cells[c] !== null ? (m.full ? "#ffd9cc" : "#dbe7ff") : "#f4f6f9", c === m.front ? "#b15236" : c === m.rear ? "#4f46e5" : "#8c95a4"));
      items.push(labelM(x + 24, y + 21, m.cells[c] === null ? "·" : String(m.cells[c]), "#344153", 11));
      if (c === m.front) items.push(labelM(x + 24, y - 8, "front", "#b15236", 9));
      if (c === m.rear) items.push(labelM(x + 24, y + 50, "rear", "#4f46e5", 9));
      items.push(labelM(x + 24, y + 64, String(c), "#9aa7b5", 8));
    }
    items.push(label(40, 150, "判满 (rear+1)%" + cap + "=front · size=" + m.size + "/" + cap, "#5a6675", 10));
    return { title: "第 " + (k + 1) + " 步 " + m.op, summary: m.op + " · 队列元素 " + m.size + "/" + cap, shapes: { viewBox: [400, 170], items } };
  });
  const fullAt = marks.findIndex(m => m.full);
  return { data: { cap, steps: marks.length, fullAt: fullAt < 0 ? null : fullAt + 1, finalSize: marks.at(-1)?.size ?? 0 }, frames };
}`;

/** 朴素 vs KMP(next) vs nextval：比较次数与指针回退轨迹擂台。 */
export const kmpRaceRule = `function run({ params, upstream, text }) {
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const PAIRS = [["ababcabcacbab", "ababc"], ["aaaabaaaab", "aaaab"], ["abcabdabcabe", "abcabe"]];
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const parts = String(text || PAIRS[variant].join("\\n")).split(/\\r?\\n/).map(s => s.trim());
  const T = (parts[0] || PAIRS[variant][0]).replace(/[^a-z]/gi, "").slice(0, 24) || PAIRS[variant][0];
  const P = (parts[1] || PAIRS[variant][1]).replace(/[^a-z]/gi, "").slice(0, 10) || PAIRS[variant][1];
  const next = (p, val2) => {
    const n = p.length, nx = Array(n).fill(-1);
    let j = -1;
    for (let i = 0; i < n - 1; i++) {
      while (j >= 0 && p[i] !== p[j]) j = nx[j];
      nx[i + 1] = ++j;
    }
    if (!val2) return nx;
    const nv = [nx[0]];
    for (let i = 1; i < n; i++) nv.push(p[i] === p[nx[i]] ? nv[nx[i]] : nx[i]);
    return nv;
  };
  const nx = next(P, false), nv = next(P, true);
  const race = (table) => {
    let i = 0, j = 0, cmp = 0, back = 0;
    const hops = [];
    while (i < T.length && j < P.length) {
      cmp++;
      if (T[i] === P[j]) { i++; j++; }
      else {
        j = table[j];
        back++;
        hops.push(i - j);
        if (j < 0) { i++; j = 0; }
      }
    }
    return { cmp, back, found: j === P.length ? i - P.length : -1, hops };
  };
  const naive = (() => { let cmp = 0, back = 0; for (let s = 0; s + P.length <= T.length; s++) { let j = 0; while (j < P.length) { cmp++; if (T[s + j] !== P[j]) break; j++; } if (j === P.length) { return { cmp, back: s, found: s, hops: [] }; } back++; } return { cmp, back, found: -1, hops: [] }; })();
  const k1 = race(nx), k2 = race(nv);
  const row = (name, r) => [name, r.cmp, r.back, r.found < 0 ? "未命中" : "@" + r.found];
  const mkFrames = (name, r, tbl) => {
    const items = [label(24, 22, name + " · 比较 " + r.cmp + " 次 · 回退 " + r.back + " 次", "#344153", 11)];
    T.split("").forEach((c, i) => {
      items.push(box(24 + i * 13, 34, 12, 18, r.found >= 0 && i >= r.found && i < r.found + P.length ? "#d6f0d9" : "#eef1f5"));
      items.push(labelM(30 + i * 13, 47, c, "#344153", 8));
    });
    P.split("").forEach((c, j) => {
      items.push(box(24 + j * 13, 62, 12, 18, "#ffe3d6"));
      items.push(labelM(30 + j * 13, 75, c, "#344153", 8));
      items.push(labelM(30 + j * 13, 92, String(tbl[j]), "#5a6675", 7.5));
    });
    items.push(label(24, 120, "表行 = next/nextval 值", "#9aa7b5", 9));
    return items;
  };
  const frames = [
    { title: "next[] / nextval[]", summary: "next=" + nx.join(",") + "  nextval=" + nv.join(",") + "；nextval 把 P[i]=P[next[i]] 的相等位继续前跳。", columns: ["j", ...P.split("").map((_, i) => i)], rows: [["p[j]", ...P.split("")], ["next", ...nx], ["nextval", ...nv]], shapes: { viewBox: [400, 140], items: mkFrames("模式串 " + P, k1, nx) } },
    { title: "朴素匹配", summary: "i 每失配退回 s+1：比较 " + naive.cmp + " 次、起点回退 " + naive.back + " 次 → " + (naive.found < 0 ? "未命中" : "命中 @" + naive.found), shapes: { viewBox: [400, 140], items: mkFrames("朴素", naive, nx) } },
    { title: "KMP · next", summary: "i 不回退，j 跳 next[j]：比较 " + k1.cmp + " 次 → " + (k1.found < 0 ? "未命中" : "命中 @" + k1.found), shapes: { viewBox: [400, 140], items: mkFrames("KMP next", k1, nx) } },
    { title: "KMP · nextval", summary: "j 跳 nextval[j]（等值再跳）：比较 " + k2.cmp + " 次，比 next 少 " + (k1.cmp - k2.cmp) + " 次 → " + (k2.found < 0 ? "未命中" : "命中 @" + k2.found), shapes: { viewBox: [400, 140], items: mkFrames("KMP nextval", k2, nv) } },
    { title: "三法对比", summary: "朴素 " + naive.cmp + " vs next " + k1.cmp + " vs nextval " + k2.cmp + " 次比较",
      columns: ["算法", "比较次数", "回退次数", "结果"], rows: [row("朴素", naive), row("KMP·next", k1), row("KMP·nextval", k2)],
      series: [{ label: "比较次数", values: [naive.cmp, k1.cmp, k2.cmp] }, { label: "回退次数", values: [naive.back, k1.back, k2.back] }] },
  ];
  return { data: { text: T, pattern: P, next: nx, nextval: nv, naiveCmp: naive.cmp, nextCmp: k1.cmp, nextvalCmp: k2.cmp, found: k2.found }, frames };
}`;

/* ============================== DS · 第 4 章：二叉树、哈夫曼与 AVL ============================== */

const bstInsert = `const bstInsert = (root, v) => {
  if (!root) return { v, l: null, r: null, h: 1, bf: 0 };
  const t = { ...root };
  if (v < t.v) t.l = bstInsert(t.l, v); else t.r = bstInsert(t.r, v);
  return t;
};
const bstLayout = (root) => {
  const pos = {};
  const walk = (t, depth, lo, hi) => {
    if (!t) return;
    const x = (lo + hi) / 2;
    pos[t.v] = { x, y: 12 + depth * 20 };
    walk(t.l, depth + 1, lo, x);
    walk(t.r, depth + 1, x, hi);
  };
  walk(root, 0, 8, 92);
  return pos;
};
const bstGraph = (root, active) => {
  const pos = bstLayout(root);
  const nodes = [], edges = [];
  const walk = (t) => {
    if (!t) return;
    nodes.push({ id: String(t.v), label: String(t.v), x: pos[t.v].x, y: pos[t.v].y, active: active === t.v });
    if (t.l) edges.push({ from: String(t.v), to: String(t.l.v), label: "", active: false });
    if (t.r) edges.push({ from: String(t.v), to: String(t.r.v), label: "", active: false });
    walk(t.l); walk(t.r);
  };
  walk(root);
  return { nodes, edges };
};`;

/** BST 四种遍历：工作栈/队列同步动画与根的访问时机。 */
export const traversalRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${bstInsert}
  ${fmt}
  const seq = seqOf(inA).slice(0, 12);
  if (!seq.length) { ${miss408} }
  let root = null;
  seq.forEach(v => { root = bstInsert(root, v); });
  const order = Math.max(0, Math.min(3, Math.round(params.order ?? 0)));
  const names = ["先序(根左右)", "中序(左根右)", "后序(左右根)", "层序(BFS)"];
  // 栈/队列模拟：记录每步工作栈与已输出
  const marks = [];
  if (order === 3) {
    const q = [root];
    while (q.length) {
      const t = q.shift();
      marks.push({ out: t.v, work: q.map(x => x.v), note: "出队访问 " + t.v + (t.l || t.r ? "，子树入队" : "") });
      if (t.l) q.push(t.l);
      if (t.r) q.push(t.r);
    }
  } else {
    const st = [];
    let cur = root;
    const done2 = new Set();
    let guard = 0;
    while (guard++ < 60 && (cur || st.length)) {
      if (order === 0) {
        while (cur) { marks.push({ out: cur.v, work: st.map(x => x.v), note: "访问 " + cur.v + "，右子压栈后走左" }); if (cur.r) st.push(cur.r); cur = cur.l; }
        cur = st.pop() ?? null;
      } else {
        while (cur) { st.push(cur); cur = cur.l; }
        const t = st.pop();
        if (order === 1) marks.push({ out: t.v, work: st.map(x => x.v), note: "左走尽，访问根 " + t.v + "，转右" });
        if (order === 2) {
          if (t.r && !done2.has(t.r)) { st.push(t); cur = t.r; done2.add(t.r); continue; }
          marks.push({ out: t.v, work: st.map(x => x.v), note: "左右已尽，访问根 " + t.v });
          cur = null;
        } else cur = t.r;
      }
    }
  }
  const visited = [];
  const frames = marks.map((m, k) => {
    visited.push(m.out);
    return {
      title: names[order] + " · 输出 " + m.out, summary: m.note + "；" + (order === 3 ? "队列" : "栈") + " [" + m.work.join(", ") + "]",
      graph: bstGraph(root, m.out),
      columns: ["已输出"], rows: [[visited.join(" → ")]],
    };
  });
  return { data: { order: names[order], sequence: marks.map(m => m.out), insert: seq }, frames };
}`;

/** 哈夫曼树逐轮合并最小两堆与 WPL 核算。 */
export const huffmanRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${fmt}
  const ws = seqOf(inA).slice(0, 8);
  if (!ws.length) { ${miss408} }
  const forest = ws.map((w, i) => ({ id: "n" + i, w, l: -1, r: -1, leaf: true }));
  const frames = [];
  let nextId = ws.length;
  const alive = () => forest.filter(t => t.par === undefined);
  forest.forEach(t => { t.par = undefined; });
  while (forest.filter(t => t.par === undefined).length > 1 && frames.length < 20) {
    const rest = forest.filter(t => t.par === undefined).sort((a, b) => a.w - b.w || a.id.localeCompare(b.id));
    const a = rest[0], b = rest[1];
    const m = { id: "m" + nextId++, w: a.w + b.w, l: forest.indexOf(a), r: forest.indexOf(b), leaf: false };
    a.par = forest.length; b.par = forest.length;
    forest.push(m);
    frames.push({ a: a.id, b: b.id, m: m.id, w: m.w });
  }
  // 布局：叶子按序排底行，内部节点居中
  const pos = {};
  forest.forEach((t, i) => { if (t.leaf) pos[i] = { x: 10 + i * (80 / Math.max(1, ws.length - 1)), y: 88 }; });
  const layoutUp = (i, depth) => {
    const t = forest[i];
    if (t.leaf) return pos[i];
    const pl = layoutUp(t.l, depth + 1), pr = layoutUp(t.r, depth + 1);
    pos[i] = { x: (pl.x + pr.x) / 2, y: 88 - depth * 0 };
    return pos[i];
  };
  layoutUp(forest.length - 1, 0);
  const depthOf = (i) => { let d = 0, t = forest[i]; while (t.par !== undefined) { t = forest[t.par]; d++; } return d; };
  const yOf = (i) => 14 + depthOf(i) * (ws.length > 4 ? 15 : 22);
  const graphOf2 = (upto) => {
    const nodes = [], edges = [];
    forest.slice(0, upto).forEach((t, i) => {
      const active = frames[upto - 1] && (frames[upto - 1].a === t.id || frames[upto - 1].b === t.id || frames[upto - 1].m === t.id);
      nodes.push({ id: t.id, label: (t.leaf ? "" : "Σ") + t.w, x: pos[i].x, y: yOf(i), active });
      if (t.l >= 0) edges.push({ from: t.id, to: forest[t.l].id, label: "", active });
      if (t.r >= 0) edges.push({ from: t.id, to: forest[t.r].id, label: "", active });
    });
    return { nodes, edges };
  };
  const wpl = ws.reduce((s, w, i) => s + w * depthOf(i), 0);
  const outFrames = frames.map((f, k) => ({
    title: "第 " + (k + 1) + " 轮合并", summary: "选最小两堆 " + f.a + "(" + forest.find(t => t.id === f.a).w + ") + " + f.b + "(" + forest.find(t => t.id === f.b).w + ") → " + f.m + "(Σ" + f.w + ")",
    graph: graphOf2(forest.length - frames.length + k + 1),
  }));
  outFrames.push({ title: "WPL 核算", summary: "WPL = Σ 权×深度 = " + ws.map((w, i) => w + "×" + depthOf(i)).join(" + ") + " = " + wpl,
    columns: ["叶子", "权 w", "深度 l", "w×l"], rows: ws.map((w, i) => ["n" + i, w, depthOf(i), w * depthOf(i)]) });
  return { data: { wpl, merges: frames.length, leaves: ws.length }, frames: outFrames };
}`;

/** AVL 插入：BF 失衡定位与 LL/RR/LR/RL 旋转修复。 */
export const avlRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${fmt}
  const seq = seqOf(inA).slice(0, 10);
  if (!seq.length) { ${miss408} }
  const h = (t) => t ? t.h : 0;
  const upd = (t) => { t.h = 1 + Math.max(h(t.l), h(t.r)); t.bf = h(t.l) - h(t.r); return t; };
  const rotR = (t) => { const l = t.l; t.l = l.r; l.r = t; upd(t); upd(l); return l; };
  const rotL = (t) => { const r = t.r; t.r = r.l; r.l = t; upd(t); upd(r); return r; };
  const ins = (t, v, path) => {
    if (!t) return { t: { v, l: null, r: null, h: 1, bf: 0 }, fix: null };
    path.push(t.v);
    let res;
    if (v < t.v) { const s = ins(t.l, v, path); t.l = s.t; res = s; }
    else { const s = ins(t.r, v, path); t.r = s.t; res = s; }
    upd(t);
    if (t.bf > 1) { res.fix = res.fix || { at: t.v, kind: v < t.l.v ? "LL" : "LR" }; t = v < t.l.v ? rotR(t) : (t.l = rotL(t.l), rotR(t)); }
    else if (t.bf < -1) { res.fix = res.fix || { at: t.v, kind: v >= t.r.v ? "RR" : "RL" }; t = v >= t.r.v ? rotL(t) : (t.r = rotR(t.r), rotL(t)); }
    return { t, fix: res.fix };
  };
  const lay = (root) => {
    const pos = {};
    const walk = (t, d, lo, hi) => { if (!t) return; const x = (lo + hi) / 2; pos[t.v] = { x, y: 12 + d * 19 }; walk(t.l, d + 1, lo, x); walk(t.r, d + 1, x, hi); };
    walk(root, 0, 8, 92); return pos;
  };
  const gOf = (root, active) => {
    const pos = lay(root); const nodes = [], edges = [];
    const walk = (t) => { if (!t) return; nodes.push({ id: String(t.v), label: t.v + "(bf" + t.bf + ")", x: pos[t.v].x, y: pos[t.v].y, active: active === t.v }); if (t.l) edges.push({ from: String(t.v), to: String(t.l.v), label: "", active: false }); if (t.r) edges.push({ from: String(t.v), to: String(t.r.v), label: "", active: false }); walk(t.l); walk(t.r); };
    walk(root); return { nodes, edges };
  };
  let root = null;
  const frames = [];
  const fixes = [];
  seq.forEach(v => {
    const path = [];
    const r = ins(root, v, path);
    root = r.t;
    if (r.fix) fixes.push({ v, ...r.fix });
    frames.push({
      title: "插入 " + v, summary: "路径 " + path.join("→") + " → " + v + (r.fix ? "　⚠ " + r.fix.at + " 失衡，" + r.fix.kind + " 旋转修复" : "，全树 |bf|≤1"),
      graph: gOf(root, v),
    });
  });
  frames.push({ title: "AVL 定稿", summary: "终树高 " + h(root) + "，共旋转 " + fixes.length + " 次：" + (fixes.map(f => f.kind + "@" + f.at).join("、") || "无"), graph: gOf(root, null), columns: ["插入", "失衡点", "旋型"], rows: fixes.map(f => [f.v, f.at, f.kind]) });
  return { data: { height: h(root), fixes, count: seq.length }, frames };
}`;

/* ============================== DS · 第 6–7 章：B 树、散列与内部排序 ============================== */

/** m 阶 B 树逐次插入与中间键上移分裂。 */
export const btreeRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${fmt}
  const seq = seqOf(inA).slice(0, 14);
  if (!seq.length) { ${miss408} }
  const m = Math.max(3, Math.min(5, Math.round(auxV ?? params.order ?? 3)));
  const mk = (keys) => ({ keys, kids: [] });
  const ins = (root, v) => {
    const path = [];
    let t = root;
    while (t.kids.length) { path.push(t); const i = t.keys.findIndex(k => v < k); t = t.kids[i < 0 ? t.keys.length : i]; }
    const leaf = t;
    const ix = leaf.keys.findIndex(k => v < k);
    leaf.keys.splice(ix < 0 ? leaf.keys.length : ix, 0, v);
    // 自底向上分裂
    let node2 = leaf;
    const splits = [];
    while (node2.keys.length > m - 1) {
      const mid = Math.floor(node2.keys.length / 2), up = node2.keys[mid];
      const left = mk(node2.keys.slice(0, mid)), right = mk(node2.keys.slice(mid + 1));
      left.kids = node2.kids.slice(0, mid + 1); right.kids = node2.kids.slice(mid + 1);
      splits.push({ up, left: left.keys.slice(), right: right.keys.slice() });
      const par = path.pop();
      if (!par) { root = mk([up]); root.kids = [left, right]; break; }
      const j = par.keys.findIndex(k => up < k);
      par.keys.splice(j < 0 ? par.keys.length : j, 0, up);
      par.kids.splice(j < 0 ? par.kids.length : j, 1, left, right);
      node2 = par;
    }
    return { splits, root };
  };
  const draw = (root, active) => {
    const nodes = [], edges = [];
    const depth = (t) => !t ? 0 : 1 + Math.max(0, ...t.kids.map(depth));
    const h0 = depth(root);
    const place = (t, lo, hi, d) => {
      const id = "n" + nodes.length;
      const w = Math.max(4, t.keys.length * 7);
      nodes.push({ id, label: t.keys.join("·"), x: (lo + hi) / 2, y: 12 + d * (76 / Math.max(1, h0)), active });
      t.kids.forEach((k, i) => { const kid = place(k, lo + (hi - lo) * i / t.kids.length, lo + (hi - lo) * (i + 1) / t.kids.length, d + 1); edges.push({ from: id, to: kid, label: "", active: false }); });
      return id;
    };
    place(root, 8, 92, 0);
    return { nodes, edges };
  };
  let root = mk([]);
  const frames = [];
  const allSplits = [];
  seq.forEach(v => {
    const r = ins(root, v);
    root = r.root;
    const splits = r.splits;
    allSplits.push(...splits.map(s => ({ v, ...s })));
    frames.push({
      title: "插入 " + v, summary: splits.length ? "节点溢出 → 中键 " + splits.map(s => s.up).join(",") + " 上移分裂" : "落入叶子",
      graph: draw(root, v),
    });
  });
  return { data: { order: m, splits: allSplits.length, keys: seq.length, height: (function h(t) { return t.kids.length ? 1 + h(t.kids[0]) : 1; })(root) }, frames };
}`;

/** 散列线性探测：装填因子驱动聚集热图与 ASL 核算。 */
export const hashProbeRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${auxScalar}
  ${fmt}
  const seq = seqOf(inA).slice(0, 16);
  if (!seq.length) { ${miss408} }
  const size = Math.max(5, Math.min(16, Math.round(params.size ?? 11)));
  const alpha = Math.max(0.2, Math.min(1, (auxV ?? params.alpha ?? 7) / 10));
  const n = Math.max(1, Math.min(seq.length, Math.round(size * alpha)));
  const keys = seq.slice(0, n);
  const table = Array(size).fill(-1);
  const probes = [];
  keys.forEach(k => {
    let h = k % size, p = 0;
    while (table[h] >= 0 && p < size) { h = (h + 1) % size; p++; }
    if (p >= size) { probes.push({ k, h0: k % size, p, fail: true }); return; }
    table[h] = k;
    probes.push({ k, h0: k % size, at: h, p });
  });
  const aslS = probes.reduce((s, x) => s + x.p + 1, 0) / Math.max(1, probes.length);
  const frames = probes.map((x, i) => ({
    title: "插入 " + x.k, summary: "h0=" + x.h0 + " → 探测 " + (x.p + 1) + " 次" + (x.fail ? " → 表满失败" : " 落位 " + x.at) + (x.p > 2 ? "（聚集链！）" : ""),
    grid: { cells: [table.slice()], rowLabels: ["槽"], colLabels: table.map((_, j) => String(j)), min: -1, max: Math.max(2, ...table), palette: "heat", showValues: true, activeCell: [0, x.at ?? 0] },
  }));
  const clusters = (() => { let best = 0, cur = 0; table.forEach(v => { cur = v >= 0 ? cur + 1 : 0; best = Math.max(best, cur); }); return best; })();
  frames.push({ title: "装填结果", summary: "α=" + (n / size).toFixed(2) + "（" + n + "/" + size + "）· 成功 ASL=" + aslS.toFixed(2) + " · 最长聚集 " + clusters + " 槽",
    columns: ["键", "h0", "落位", "探测"], rows: probes.map(x => [x.k, x.h0, x.fail ? "失败" : x.at, x.p + 1]) });
  return { data: { size, n, alpha: Math.round(n * 100 / size) / 100, asl: Math.round(aslS * 100) / 100, maxCluster: clusters, table }, frames };
}`;

/** 快排/堆排/归并逐帧柱图与比较交换计数擂台。 */
export const sortRaceRule = `function run({ params, upstream }) {
  ${inAlgo}
  ${seqOf}
  ${box}
  ${label}
  ${fmt}
  const seq = seqOf(inA).slice(0, 14);
  if (!seq.length) { ${miss408} }
  const quick = (a) => {
    const d = a.slice(); let cmp = 0, sw = 0;
    const s = (l, r) => {
      if (l >= r) return;
      const pv = d[r]; let st = l;
      for (let i = l; i < r; i++) { cmp++; if (d[i] <= pv) { [d[st], d[i]] = [d[i], d[st]]; st++; sw++; } }
      [d[st], d[r]] = [d[r], d[st]]; if (st !== r) sw++;
      s(l, st - 1); s(st + 1, r);
    };
    s(0, d.length - 1); return { name: "快速排序", cmp, sw, out: d };
  };
  const heap = (a) => {
    const d = a.slice(); let cmp = 0, sw = 0;
    const sift = (p, e) => {
      while (true) {
        const l = p * 2 + 1, r = l + 1; let big = p;
        if (l <= e) { cmp++; if (d[l] > d[big]) big = l; }
        if (r <= e) { cmp++; if (d[r] > d[big]) big = r; }
        if (big === p) return;
        [d[p], d[big]] = [d[big], d[p]]; sw++; p = big;
      }
    };
    for (let p = Math.floor(d.length / 2) - 1; p >= 0; p--) sift(p, d.length - 1);
    for (let e = d.length - 1; e > 0; e--) { [d[0], d[e]] = [d[e], d[0]]; sw++; sift(0, e - 1); }
    return { name: "堆排序", cmp, sw, out: d };
  };
  const merge = (a) => {
    const d = a.slice(); let cmp = 0, wr = 0;
    const s = (l, r) => {
      if (r - l <= 0) return;
      const m = (l + r) >> 1;
      s(l, m); s(m + 1, r);
      const buf = []; let i = l, j = m + 1;
      while (i <= m && j <= r) { cmp++; buf.push(d[i] <= d[j] ? d[i++] : d[j++]); wr++; }
      while (i <= m) { buf.push(d[i++]); wr++; }
      while (j <= r) { buf.push(d[j++]); wr++; }
      buf.forEach((v, k) => { d[l + k] = v; });
    };
    s(0, d.length - 1); return { name: "归并排序", cmp, sw: wr, out: d };
  };
  const races = [quick(seq), heap(seq), merge(seq)];
  const maxV = Math.max(...seq.map(Math.abs), 1);
  const bar = (arr, hi) => arr.map((v, i) => box(24 + i * (340 / arr.length), 118 - Math.abs(v) * 90 / maxV, Math.max(3, 340 / arr.length - 3), Math.abs(v) * 90 / maxV, hi === i ? "#b15236" : "#4f46e5"));
  const frames = races.map((r, i) => ({
    title: r.name, summary: "比较 " + r.cmp + " · 交换/写入 " + r.sw + " · 结果 " + r.out.join(","),
    columns: ["算法", "比较", "交换/写入"], rows: races.map(x => [x.name, x.cmp, x.sw]), highlightRows: [i],
    shapes: { viewBox: [400, 140], items: [...bar(r.out, -1), label(24, 132, r.out.join(" "), "#5a6675", 9)] },
  }));
  const degrade = races[0].cmp > seq.length * (seq.length - 1) / 4;
  return { data: { quickCmp: races[0].cmp, heapCmp: races[1].cmp, mergeCmp: races[2].cmp, quickSwaps: races[0].sw, sorted: races[0].out }, frames };
}`;

/* ============================== CO · 第 1–2 章：数据表示、IEEE 754 与 ALU ============================== */

/** IEEE 754 单精度 S/E/M 位级拆解与规格化边界。 */
export const ieee754Rule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${box}
  ${label}
  ${labelMid}
  ${fmt}
  const expo = Math.max(0, Math.min(255, Math.round(inV ?? auxV ?? params.expo ?? 126)));
  const frac = Math.max(0, Math.min(8388607, Math.round(params.frac ?? 2097152)));
  const sign = Math.round(params.sign ?? 0) ? 1 : 0;
  const bits = (v, w) => v.toString(2).padStart(w, "0");
  const e = expo, m = frac;
  let kind2, value;
  if (e === 0) { kind2 = m === 0 ? "±0 零" : "非规格化数 (0.M × 2^-126)"; value = m === 0 ? 0 : m / 8388608 * Math.pow(2, -126); }
  else if (e === 255) { kind2 = m === 0 ? "±∞ 无穷" : "NaN 非数"; value = m === 0 ? Infinity : NaN; }
  else { kind2 = "规格化数 (1.M × 2^" + (e - 127) + ")"; value = (1 + m / 8388608) * Math.pow(2, e - 127); }
  if (sign && Number.isFinite(value)) value = -value;
  const seg = (x, y, w, h, parts) => parts.map((p, i) => {
    const ww = Math.max(6, w * p.share);
    const at = parts.slice(0, i).reduce((s, q) => s + Math.max(6, w * q.share), 0);
    return [box(x + at, y, ww, h, p.fill, "#5a6675"), labelM(x + at + ww / 2, y + h / 2 + 4, p.name, "#fff", 10), labelM(x + at + ww / 2, y + h + 11, p.bits2, "#5a6675", 8.5)];
  }).flat();
  const items = [
    label(24, 26, "S", "#344153", 10), ...seg(50, 16, 40, 24, [{ name: bits(sign, 1), share: 1, bits2: "1 位", fill: "#344153" }]),
    label(24, 58, "E", "#344153", 10), ...seg(50, 48, 330, 24, [{ name: bits(e, 8), share: 1, bits2: "8 位 = " + e, fill: "#4f46e5" }]),
    label(24, 90, "M", "#344153", 10), ...seg(50, 80, 330, 20, [{ name: bits(m, 23), share: 1, bits2: "23 位 = " + m, fill: "#b15236" }]),
    label(24, 126, "类别", "#5a6675", 10),
    label(50, 126, kind2 + "　→　真值 " + fmt(value, 6) + (sign ? "（负）" : ""), "#be531a", 12),
    label(24, 156, "E=0 → 0.M×2⁻¹²⁶ 非规格化（隐含位变 0）", "#5a6675", 9.5),
    label(24, 172, "E=255 → M=0 为 ∞，M≠0 为 NaN", "#5a6675", 9.5),
  ];
  const frames = [{
    title: "S/E/M 拆解", summary: "E=" + e + " M=" + m + " → " + kind2 + " = " + fmt(value, 6),
    shapes: { viewBox: [400, 185], items },
    columns: ["位段", "位串", "十进制"], rows: [["S", bits(sign, 1), sign], ["E", bits(e, 8), e], ["M", bits(m, 23), m]],
  }];
  return { data: { sign, expo: e, frac: m, kind: kind2, value: Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : String(value), denorm: e === 0 && m !== 0, inf: e === 255 && m === 0, nan: e === 255 && m !== 0 }, frames };
}`;

/** 补码加减：逐位进位与双符号位溢出检测。 */
export const overflowRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const width = Math.max(4, Math.min(8, Math.round(params.width ?? 8)));
  const a = Math.max(-(1 << (width - 1)), Math.min((1 << (width - 1)) - 1, Math.round(inV ?? params.a ?? 60)));
  const b = Math.max(-(1 << (width - 1)), Math.min((1 << (width - 1)) - 1, Math.round(params.b ?? 70)));
  const sub = Math.round(params.sub ?? 0) === 1;
  const mod = 1 << width, smod = 1 << (width + 1);
  const enc = (v) => ((v % mod) + mod) % mod;
  const enc2 = (v) => ((v % smod) + smod) % smod;
  const x = enc(a), y = enc(sub ? -b : b);
  const sum = (x + y) % mod;
  const sum2 = (enc2(a) + enc2(sub ? -b : b)) % smod;
  const truth = a + (sub ? -b : b);
  const carryOut = x + y >= mod ? 1 : 0;
  const sf1 = (sum2 >> width) & 1, sf0 = (sum2 >> (width - 1)) & 1;
  const ovf = sf1 !== sf0;
  const frames = [{
    title: "双符号位判定", summary: "[" + a + "]补 ⊕ [" + (sub ? -b : b) + "]补：sf1sf0=" + sf1 + sf0 + (ovf ? (sf1 === 0 ? " → 01 正溢出" : " → 10 负溢出") : " → 无溢出，结果 " + (truth === (sum >= (1 << (width - 1)) ? sum - mod : sum) ? truth : "?")),
    columns: ["项", "双符号位码", "值"],
    rows: [
      ["[A]补", enc2(a).toString(2).padStart(width + 1, "0"), a],
      ["[" + (sub ? "-B" : "B") + "]补", enc2(sub ? -b : b).toString(2).padStart(width + 1, "0"), sub ? -b : b],
      ["和", sum2.toString(2).padStart(width + 1, "0"), truth],
      ["判定", "sf1⊕sf0=" + sf1 + "⊕" + sf0, ovf ? "溢出!" : "正常"],
    ],
    highlightRows: [3],
  }];
  return { data: { width, a, b: sub ? -b : b, sum: sum >= (1 << (width - 1)) ? sum - mod : sum, truth, overflow: ovf, sf: sf1 * 10 + sf0, carryOut }, frames };
}`;

/** Booth 补码一位乘：A/Q/Q₋₁ 逐拍移位表。 */
export const boothRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const w = Math.max(4, Math.min(8, Math.round(params.width ?? 8)));
  const x = Math.max(-(1 << (w - 1)), Math.min((1 << (w - 1)) - 1, Math.round(inV ?? params.x ?? 5)));
  const y = Math.max(-(1 << (w - 1)), Math.min((1 << (w - 1)) - 1, Math.round(params.y ?? -3)));
  const qmask = (1 << w) - 1;
  const enc = (v) => ((v % (1 << w)) + (1 << w)) % (1 << w);
  let A = 0, Q = enc(y), Qm = 0;
  const rows = [];
  for (let i = 0; i < w; i++) {
    const pair = (Q & 1) * 2 + Qm;
    let A2 = A, act = "Q₀Q₋₁=" + pair + " → ";
    if (pair === 1) { A2 = A + x; act += "A←A+X"; }
    else if (pair === 2) { A2 = A - x; act += "A←A−X"; }
    else act += "只移位";
    const newQm = Q & 1;
    const newQ = ((Q >> 1) | ((A2 & 1) << (w - 1))) & qmask;
    A = A2 >> 1; Q = newQ; Qm = newQm;
    rows.push([i + 1, act, (A >>> 0).toString(2).slice(-(w + 1)).padStart(w + 1, "0"), Q.toString(2).padStart(w, "0"), Qm]);
  }
  const product = A * (1 << w) + Q;
  const frames = rows.map((r, i) => ({
    title: "第 " + (i + 1) + " 拍", summary: r[1] + "，算术右移；A=" + r[2] + " Q=" + r[3] + " Q₋₁=" + r[4],
    columns: ["拍", "动作", "A", "Q", "Q₋₁"], rows: rows.slice(0, i + 1), highlightRows: [i],
  }));
  frames.push({ title: "结果", summary: "(" + x + ")×(" + y + ") = " + product + "（补码直乘无须改号）",
    columns: ["校验"], rows: [["期望 " + x * y + " ↔ 实得 " + product]] });
  return { data: { width: w, x, y, product, expected: x * y, ok: product === x * y }, frames };
}`;

/* ============================== CO · 第 4–5 章：指令系统与 CPU 数据通路 ============================== */

/** 寻址方式有效地址拆解：立即/直接/寄存器/寄存器间接/基址/变址 EA 连线。 */
export const addrModeRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${box}
  ${label}
  ${labelMid}
  ${arrow}
  ${line}
  ${fmt}
  const mode = Math.max(0, Math.min(5, Math.round(inV ?? params.mode ?? 3)));
  const reg = Math.round(auxV ?? params.reg ?? 100);
  const disp = Math.round(params.disp ?? 20), mem = Math.round(params.mem ?? 777);
  const defs = [
    { name: "立即寻址", ea: "—（操作数即指数字段 " + disp + "）", ops: ["指令.imm=" + disp], path: [[60, 60, 330, 60, "#b15236"]] },
    { name: "直接寻址", ea: "EA = " + disp + " → M[" + disp + "]", ops: ["读内存 @" + disp, "取回 " + mem], path: [[60, 60, 200, 60, "#4f46e5"], [200, 60, 330, 100, "#4f46e5"]] },
    { name: "寄存器寻址", ea: "EA = R = " + reg + "（不访存）", ops: ["R=" + reg], path: [[60, 60, 200, 100, "#4f46e5"]] },
    { name: "寄存器间接", ea: "EA = (R) = " + reg + " → M[" + reg + "]", ops: ["(R)=" + reg, "读内存", "取回 " + mem], path: [[60, 60, 200, 60, "#4f46e5"], [200, 60, 330, 100, "#4f46e5"]] },
    { name: "基址寻址", ea: "EA = (BR) + D = " + reg + " + " + disp + " = " + (reg + disp), ops: ["BR=" + reg, "加偏移 " + disp, "@" + (reg + disp)], path: [[60, 60, 200, 60, "#4f46e5"], [200, 60, 200, 100, "#4f46e5"], [200, 100, 330, 100, "#b15236"]] },
    { name: "变址寻址", ea: "EA = (IX) + D = " + reg + " + " + disp + " = " + (reg + disp), ops: ["IX=" + reg, "加偏移 " + disp, "@" + (reg + disp)], path: [[60, 60, 200, 60, "#4f46e5"], [200, 60, 200, 100, "#4f46e5"], [200, 100, 330, 100, "#b15236"]] },
  ];
  const d = defs[mode];
  const items = [
    label(24, 30, "指令字段", "#344153", 10), box(56, 22, 120, 22, "#eef1f5"),
    labelM(116, 37, "OP | " + (mode === 0 ? "imm " + disp : "D=" + disp + " / R"), "#344153", 9),
    label(200, 30, "寄存器组", "#344153", 10), box(200, 22, 90, 22, "#eef1f5"),
    labelM(245, 37, "R/BR/IX=" + reg, "#344153", 9),
    label(300, 30, "内存", "#344153", 10), box(310, 22, 70, 100, "#f4f6f9"),
    labelM(345, 80, "M[?]=" + mem, "#344153", 9),
  ];
  d.path.forEach((p, i) => items.push(arrow(p[0], p[1], p[2], p[3], p[4])));
  d.ops.forEach((t, i) => items.push(label(56, 140 + i * 16, (i + 1) + ". " + t, "#5a6675", 9.5)));
  items.push(label(24, 196, d.ea, "#be531a", 11));
  const names = defs.map(x => x.name);
  return { data: { mode: names[mode], ea: mode === 0 ? disp : mode === 1 ? disp : mode === 2 ? reg : reg + (mode >= 4 ? disp : 0) },
    frames: [{ title: names[mode], summary: d.ea, shapes: { viewBox: [400, 210], items }, columns: ["寻址方式", "有效地址"], rows: defs.map((x, i) => [x.name + (i === mode ? " ◀" : ""), x.ea]) }] };
}`;

/** 单总线数据通路逐拍高亮：PC/MAR/MDR/IR/ALU/Reg。 */
export const datapathRule = `function run({ params, upstream }) {
  ${inScalar}
  ${box}
  ${label}
  ${labelMid}
  ${arrow}
  ${line}
  const instr = Math.max(0, Math.min(3, Math.round(inV ?? params.instr ?? 0)));
  const names = ["LOAD R1, D", "ADD R1, R2, R3", "STORE R1, D", "BEQ R1, R2, off"];
  const parts = [
    { id: "PC", x: 60, y: 40 }, { id: "MAR", x: 150, y: 40 }, { id: "M", x: 250, y: 40 },
    { id: "MDR", x: 150, y: 95 }, { id: "IR", x: 60, y: 95 }, { id: "Reg", x: 60, y: 150 },
    { id: "ALU", x: 200, y: 150 }, { id: "Bus", x: 320, y: 95 },
  ];
  const phases = [
    { name: "IF 取指", on: ["PC", "MAR", "M", "MDR", "IR"], note: "PC→MAR→M→MDR→IR，PC+1" },
    { name: "ID 译码", on: ["IR", "Reg"], note: "IR 译码，读寄存器操作数" },
    { name: "EX 执行", on: ["Reg", "ALU"], note: instr === 0 ? "ALU 算地址 R+D" : instr === 3 ? "ALU 比较与 PC+off" : "ALU 运算" },
    { name: "MEM 访存", on: instr === 1 || instr === 3 ? [] : ["MAR", "M", "MDR"], note: instr === 0 ? "读数据到 MDR" : instr === 2 ? "MDR 写回内存" : "本指令不访存（空拍）" },
    { name: "WB 写回", on: instr === 2 || instr === 3 ? (instr === 3 ? ["PC"] : []) : ["MDR", "Reg"], note: instr === 2 ? "无写回" : instr === 3 ? "条件成立则 PC←PC+off" : "结果写回寄存器" },
  ];
  const frames = phases.map((p, i) => {
    const items = [line(56, 62, 296, 62, "#9aa7b5"), line(56, 172, 296, 172, "#9aa7b5")];
    parts.forEach(pt => {
      const on = p.on.includes(pt.id);
      items.push(box(pt.x - 18, pt.y - 13, pt.id === "Bus" ? 12 : 46, 26, on ? "#ffe3d6" : "#f4f6f9", on ? "#b15236" : "#8c95a4"));
      items.push(labelM(pt.x + (pt.id === "Bus" ? -12 : 5), pt.y + 4, pt.id, on ? "#b15236" : "#5a6675", 9));
    });
    items.push(label(40, 200, "节拍 " + (i + 1) + "/5 · " + names[instr], "#5a6675", 9.5));
    return { title: p.name, summary: p.note, shapes: { viewBox: [400, 215], items } };
  });
  return { data: { instr: names[instr], phases: phases.map(p => p.name) }, frames };
}`;

/** 微操作控制信号真值表：按指令×阶段列出信号电平。 */
export const microopRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const instr = Math.max(0, Math.min(3, Math.round(inV ?? params.instr ?? 0)));
  const names = ["LOAD", "ADD", "STORE", "BEQ"];
  const sigs = ["PCout", "MARin", "Read", "MDRin", "MDRout", "IRin", "RegRead", "RegWrite", "ALUop", "MemWrite", "PC+off"];
  const table = {
    IF:   { PCout: 1, MARin: 1, Read: 1, MDRin: 1, MDRout: 1, IRin: 1 },
    ID:   { RegRead: 1 },
    EX:   instr === 0 ? { RegRead: 1, ALUop: 1 } : instr === 1 ? { RegRead: 1, ALUop: 1 } : instr === 2 ? { RegRead: 1, MDRin: 1 } : { RegRead: 1, ALUop: 1 },
    MEM:  instr === 0 ? { MARin: 1, Read: 1, MDRin: 1 } : instr === 2 ? { MARin: 1, MDRout: 1, MemWrite: 1 } : {},
    WB:   instr === 0 || instr === 1 ? { MDRout: instr === 0 ? 1 : 0, RegWrite: 1 } : instr === 3 ? { "PC+off": 1 } : {},
  };
  const phases = ["IF", "ID", "EX", "MEM", "WB"];
  const rows = phases.map(ph => [ph, ...sigs.map(s => table[ph]?.[s] ? "1" : "·")]);
  const frames = phases.map((ph, i) => ({
    title: names[instr] + " · " + ph, summary: "本拍拉高信号：" + sigs.filter(s => table[ph]?.[s]).join("、") || "无（空拍）",
    columns: ["阶段", ...sigs], rows, highlightRows: [i],
  }));
  return { data: { instr: names[instr], signals: table }, frames };
}`;

/* ============================== CO · 第 5–7 章：5 级流水线、总线与 I/O ============================== */

const pipeSim = `const pipeSim = (instrs, fwd) => {
  const stages = ["IF", "ID", "EX", "MEM", "WB"];
  const regs = (s) => {
    const nums = s.match(/R\\d+/g) || [];
    const op = (/^\\s*([A-Za-z]+)/.exec(s)?.[1] ?? "").toUpperCase();
    if (/^(SW|BEQ|BNE|J|NOP)/.test(op)) return { rd: null, rs: nums };
    return { rd: nums[0] ?? null, rs: nums.slice(1) };
  };
  const grid = [];
  let cum = 0;
  instrs.forEach((ins, i) => {
    const lane = Array(stages.length).fill(null);
    const mine = regs(ins);
    let hazard = false, stall = 0;
    for (let d = 1; d <= 2 && i - d >= 0; d++) {
      const prev = regs(instrs[i - d]);
      if (!prev.rd || !mine.rs.some(r => r === prev.rd)) continue;
      hazard = true;
      const loadUse = d === 1 && /^\s*LW/i.test(instrs[i - d]);
      const need = !fwd ? 3 - d : (loadUse ? 1 : 0);
      if (need > stall) stall = need;
    }
    cum += stall;
    const start = i + cum;
    for (let s = 0; s < stages.length; s++) lane[s] = start + s;
    grid.push({ ins, lane, hazard, start, stall });
  });
  const total = Math.max(0, ...grid.map(g => g.lane.at(-1))) + 1;
  return { grid, total, stalls: cum };
};`;

/** 5 级流水线时空图：RAW 冒险、Load-Use 气泡与转发开关。 */
export const pipelineGanttRule = `function run({ params, upstream, text }) {
  ${inScalar}
  ${fmt}
  ${pipeSim}
  const fwd = Math.round(inV ?? params.fwd ?? 1) !== 0;
  const STREAMS = [
    "LW R1,0(R2)\\nADD R3,R1,R4\\nSUB R5,R1,R6\\nLW R7,0(R8)",
    "ADD R1,R2,R3\\nSUB R4,R1,R5\\nLW R6,0(R4)\\nADD R7,R6,R2",
    "LW R1,0(R2)\\nLW R3,0(R1)\\nADD R4,R3,R5\\nSW R4,0(R6)",
  ];
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const instrs = String(text || STREAMS[variant]).split(/\\r?\\n/).map(s => s.trim()).filter(Boolean).slice(0, 8);
  const { grid, total, stalls } = pipeSim(instrs, fwd);
  const lanes = grid.map((g, i) => ({
    label: "i" + (i + 1) + " " + g.ins.split(",")[0],
    segments: g.lane.map((c, s) => ({ label: ["IF", "ID", "EX", "MEM", "WB"][s], start: c, end: c + 0.9 })),
  }));
  const stallLane = grid.map((g) => ({ label: "停顿", segments: Array.from({ length: g.stall }, (_, k) => ({ label: "气泡", start: g.start - g.stall + k, end: g.start - g.stall + k + 0.9 })) }));
  const frames = [];
  for (let c = 0; c <= Math.min(total, 24); c++) {
    frames.push({
      title: "时钟 " + c, summary: "转发" + (fwd ? "开" : "关") + " · 总周期 " + total + " · 冒险停顿 " + stalls + " 拍",
      timeline: lanes.map((l, i) => ({ label: l.label, segments: l.segments.filter(s => s.start <= c) }))
        .concat(stallLane.map((l, i) => ({ label: "i" + (i + 1) + " 气泡", segments: l.segments.filter(s => s.start <= c) }))),
    });
  }
  return { data: { forwarding: fwd, total, stalls, cpi: Math.round(total * 100 / instrs.length) / 100 }, frames };
}`;

/** 开/关转发的停顿周期与 CPI 对照。 */
export const cpiRaceRule = `function run({ params, upstream, text }) {
  ${inScalar}
  ${fmt}
  ${pipeSim}
  const STREAMS = [
    "LW R1,0(R2)\\nADD R3,R1,R4\\nSUB R5,R1,R6\\nLW R7,0(R8)",
    "ADD R1,R2,R3\\nSUB R4,R1,R5\\nLW R6,0(R4)\\nADD R7,R6,R2",
    "LW R1,0(R2)\\nLW R3,0(R1)\\nADD R4,R3,R5\\nSW R4,0(R6)",
  ];
  const variant = Math.max(0, Math.min(2, Math.round(params.variant ?? 0)));
  const instrs = String(text || STREAMS[variant]).split(/\\r?\\n/).map(s => s.trim()).filter(Boolean).slice(0, 8);
  const on = pipeSim(instrs, true), off = pipeSim(instrs, false);
  const ideal = instrs.length + 4;
  const rows = [
    ["理想无冒险", ideal, 0, (ideal / instrs.length).toFixed(2)],
    ["开转发", on.total, on.stalls, (on.total / instrs.length).toFixed(2)],
    ["关转发", off.total, off.stalls, (off.total / instrs.length).toFixed(2)],
  ];
  const frames = [{
    title: "CPI 对照", summary: "关转发多停 " + (off.total - on.total) + " 拍；CPI " + rows[1][3] + " → " + rows[2][3],
    columns: ["模式", "总周期", "停顿拍", "CPI"], rows,
    series: [{ label: "总周期", values: [ideal, on.total, off.total] }, { label: "停顿拍", values: [0, on.stalls, off.stalls] }],
  }];
  return { data: { ideal, fwdTotal: on.total, noFwdTotal: off.total, saved: off.total - on.total }, frames };
}`;

/** 程序查询 / 中断 / DMA 的 CPU 占用率对比。 */
export const ioModeRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const transfer = Math.max(1, Math.min(10, Math.round(inV ?? params.blocks ?? 4)));
  const prep = 2, perBlock = 4, done = 1;
  const lanes = [
    { label: "程序查询", segments: [{ label: "查询循环" + transfer * perBlock + "拍", start: 0, end: transfer * perBlock + prep }, { label: "收尾", start: transfer * perBlock + prep, end: transfer * perBlock + prep + done }] },
    { label: "中断驱动", segments: [{ label: "启动", start: 0, end: prep }, ...Array.from({ length: transfer }, (_, i) => ({ label: "中断" + (i + 1), start: prep + i * (perBlock + 1), end: prep + i * (perBlock + 1) + 1 })), { label: "收尾", start: prep + transfer * (perBlock + 1), end: prep + transfer * (perBlock + 1) + done }] },
    { label: "DMA", segments: [{ label: "设置", start: 0, end: prep }, { label: "DMA 搬块×" + transfer + "(CPU 空闲)", start: prep, end: prep + transfer * perBlock }, { label: "中断", start: prep + transfer * perBlock, end: prep + transfer * perBlock + done }] },
  ];
  const busy = [transfer * perBlock + prep + done, prep + transfer + done, prep + done];
  const names = ["程序查询", "中断", "DMA"];
  const frames = [{
    title: "三种 I/O 方式", summary: names.map((n, i) => n + " CPU 占用 " + busy[i] + " 拍").join(" · ") + "；DMA 把占用压到 " + Math.round(100 * busy[2] / busy[0]) + "%",
    timeline: lanes,
    series: [{ label: "CPU 占用拍", values: busy }],
  }];
  return { data: { busy, savedVsQuery: Math.round(100 * (1 - busy[2] / busy[0])) }, frames };
}`;
