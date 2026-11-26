/** 大学物理全景沙盘的确定性规则代码：随画布保存，由既有规则 Worker 沙箱执行。
 *
 * 约定与 calculusSandboxRules.ts 相同：每条规则是 `function run({ params, upstream, rand })`
 * 的字符串，返回 { data, frames }；frames 可含 shapes / grid / series / rows。
 * upstream 中主输入口元素不带 `port` 键，aux 口元素带 `port:"aux"`。
 */

const finite = 'const valid = Number.isFinite;';
const missing = 'return { data: {}, frames: [{ title: "等待输入", summary: "请接入上游滑杆或信号源。" }] };';
const line = 'const line = (x1,y1,x2,y2,stroke,dashed=false) => ({ kind:"line", x1,y1,x2,y2,stroke,dashed,strokeWidth:1.6 });';
const dot = 'const dot = (cx,cy,fill,r=4) => ({ kind:"circle",cx,cy,r,fill });';
const label = 'const label = (x,y,text) => ({ kind:"text",x,y,text,fill:"#344153",size:11 });';
const arrow = 'const arrow = (x1,y1,x2,y2,stroke) => ({ ...line(x1,y1,x2,y2,stroke), kind:"arrow", strokeWidth:2.2 });';
const fmt = 'const fmt = (v, digits=4) => Number.isFinite(v) ? Number(v.toPrecision(digits)).toString() : "—";';
const inScalar = 'const inV = upstream.find(v => v.kind === "scalar" && v.port !== "aux")?.v;';
const auxScalar = 'const auxV = upstream.find(v => v.port === "aux" && v.kind === "scalar")?.v;';

export { dot, label, line, arrow, fmt };

/** 把 nm 波长换算为近似可见光 RGB（380–780 近似分段）。供干涉、偏振、光电共用。 */
const wavelengthRgb = `const waveRgb = (nm) => {
  const x = Math.max(380, Math.min(780, nm));
  let r = 0, g = 0, b = 0;
  if (x < 440) { r = (440 - x) / 60; b = 1; }
  else if (x < 490) { g = (x - 440) / 50; b = 1; }
  else if (x < 510) { g = 1; b = (510 - x) / 20; }
  else if (x < 580) { r = (x - 510) / 70; g = 1; }
  else if (x < 645) { r = 1; g = (645 - x) / 65; }
  else { r = 1; }
  const edge = x < 420 ? 0.55 + 0.45 * (x - 380) / 40 : x > 700 ? 0.55 + 0.45 * (780 - x) / 80 : 1;
  return "rgb(" + Math.round(r * 255 * edge) + "," + Math.round(g * 255 * edge) + "," + Math.round(b * 255 * edge) + ")";
};
const waveName = (nm) => nm < 450 ? "紫" : nm < 495 ? "蓝" : nm < 520 ? "青" : nm < 565 ? "绿" : nm < 590 ? "黄" : nm < 625 ? "橙" : "红";`;

/* ============================== 第 1 章：质点运动、受力与守恒 ============================== */

/** 理想 vs 线性阻力双弹道对照，逐帧播放飞行并显示速度/阻力矢量。 */
export const dragProjectileRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const v0 = Math.max(0.5, inV ?? params.v0), k = Math.max(0, auxV ?? params.k);
  const th = params.angle * Math.PI / 180, g = 9.8, vx0 = v0 * Math.cos(th), vy0 = v0 * Math.sin(th);
  const tIdeal = 2 * vy0 / g, rangeI = vx0 * tIdeal;
  const dragPos = (t) => k < 1e-4
    ? { x: vx0 * t, y: vy0 * t - g * t * t / 2, vx: vx0, vy: vy0 - g * t }
    : { x: vx0 * (1 - Math.exp(-k * t)) / k,
        y: (vy0 + g / k) * (1 - Math.exp(-k * t)) / k - g * t / k,
        vx: vx0 * Math.exp(-k * t), vy: (vy0 + g / k) * Math.exp(-k * t) - g / k };
  let tDrag = tIdeal;
  if (k >= 1e-4) {
    let lo = 0, hi = 3 * tIdeal;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (dragPos(mid).y > 0) lo = mid; else hi = mid;
    }
    tDrag = lo;
  }
  const tEnd = Math.max(tIdeal, tDrag), xMax = Math.max(rangeI, dragPos(tDrag).x) * 1.08 || 1;
  const yMax = Math.max(vy0 * vy0 / (2 * g), dragPos(tIdeal / 2).y) * 1.18 || 1;
  const px = (x) => 34 + 340 * x / xMax, py = (y) => 196 - 172 * y / yMax;
  const path = (fn, tEnd2, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = fn((i / n) * tEnd2);
      if (p.y >= -0.01 * yMax) pts.push([px(p.x), py(Math.max(0, p.y))]);
    }
    return pts;
  };
  const poly = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
  const idealPts = path((t) => ({ x: vx0 * t, y: vy0 * t - g * t * t / 2 }), tIdeal, 40);
  const dragPts = path(dragPos, tDrag, 40);
  const frames = [];
  for (let f = 0; f <= 24; f++) {
    const t = (f / 24) * tEnd;
    const items = [line(20, 196, 392, 196, "#9aa7b5"), line(34, 20, 34, 196, "#c3ccd7")];
    items.push({ kind: "polygon", points: idealPts, fill: "none", stroke: "#a9b8c5", strokeWidth: 1.3, dashed: false });
    items.push({ kind: "polygon", points: dragPts, fill: "none", stroke: "#b45e28", strokeWidth: 1.8 });
    const shownI = idealPts.filter((p, i) => i / 40 * tIdeal <= t);
    const shownD = dragPts.filter((p, i) => i / 40 * tDrag <= t);
    if (shownI.length > 1) items.push({ kind: "polygon", points: shownI, fill: "none", stroke: "#68798c", strokeWidth: 2 });
    if (shownD.length > 1) items.push({ kind: "polygon", points: shownD, fill: "none", stroke: "#b45e28", strokeWidth: 2.4 });
    if (t <= tIdeal + 1e-9) {
      const d = { x: vx0 * t, y: vy0 * t - g * t * t / 2 };
      items.push(dot(px(d.x), py(Math.max(0, d.y)), "#68798c", 4.5));
    }
    const d = dragPos(t);
    if (t <= tDrag + 1e-9) {
      const [cx, cy] = [px(d.x), py(Math.max(0, d.y))];
      items.push(dot(cx, cy, "#b45e28", 5));
      const sp = Math.hypot(d.vx, d.vy) || 1;
      items.push(arrow(cx, cy, cx + 26 * d.vx / sp, cy - 26 * d.vy / sp, "#285a96"));
      if (k > 1e-4) items.push(arrow(cx, cy, cx - 20 * d.vx / sp, cy + 20 * d.vy / sp, "#be531a"));
    }
    items.push(label(24, 216, "灰 理想 · 橙 阻力 · 蓝 v · 红 阻力f=−kv"));
    frames.push({ title: "双弹道对照", shapes: { viewBox: [400, 225], items },
      summary: "t=" + t.toFixed(2) + "s · k=" + k.toFixed(3) +
        " · 射程 理想 " + fmt(rangeI, 4) + "m vs 阻力 " + fmt(dragPos(tDrag).x, 4) + "m（差 " + fmt(rangeI - dragPos(tDrag).x, 3) + "m）" });
  }
  const rangeD = dragPos(tDrag).x;
  return { data: { rangeIdeal: rangeI, rangeDrag: rangeD, loss: rangeI - rangeD, tIdeal, tDrag, k }, frames };
}`;

/** 动能、势能与耗散能账本：验证减小的机械能恰好变成热。 */
export const energyDissipationRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${fmt}
  const k = Math.max(0, inV ?? params.k), v0 = Math.max(0.5, params.v0), th = params.angle * Math.PI / 180, g = 9.8;
  const vx0 = v0 * Math.cos(th), vy0 = v0 * Math.sin(th);
  const pos = (t) => k < 1e-4
    ? { x: vx0 * t, y: vy0 * t - g * t * t / 2, vx: vx0, vy: vy0 - g * t }
    : { x: vx0 * (1 - Math.exp(-k * t)) / k, y: (vy0 + g / k) * (1 - Math.exp(-k * t)) / k - g * t / k,
        vx: vx0 * Math.exp(-k * t), vy: (vy0 + g / k) * Math.exp(-k * t) - g / k };
  let tEnd = 2 * vy0 / g;
  if (k >= 1e-4) {
    let lo = 0, hi = 3 * tEnd;
    for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (pos(mid).y > 0) lo = mid; else hi = mid; }
    tEnd = lo;
  }
  const e0 = v0 * v0 / 2, ke = [], pe = [], heat = [], mech = [], ideal = [];
  for (let i = 0; i <= 48; i++) {
    const p = pos((i / 48) * tEnd);
    const kE = 0.5 * (p.vx * p.vx + p.vy * p.vy), pE = g * Math.max(0, p.y);
    ke.push(kE); pe.push(pE); heat.push(e0 - kE - pE); mech.push(kE + pE); ideal.push(e0);
  }
  const loss = heat.at(-1);
  return { data: { loss, e0, ratio: loss / e0, k }, frames: [
    { title: "能量组成随时间（末帧=落地）", series: [
      { label: "动能 Ek", values: ke }, { label: "势能 Ep", values: pe }, { label: "累计耗散热 Q", values: heat }],
      summary: "k=" + k.toFixed(3) + " · 落地耗散 " + fmt(loss, 4) + " J · 占初机械能 " + fmt(100 * loss / e0, 3) + "%" },
    { title: "机械能账本：E=Ek+Ep 与 Q 互补", series: [
      { label: "理想机械能", values: ideal }, { label: "实际机械能", values: mech }, { label: "耗散热 Q", values: heat }],
      summary: "任意时刻 E(t)+Q(t)=E₀，减少的机械能全部转为热" },
  ] };
}`;

/** 一维碰撞：总动量纹丝不动，总动能随恢复系数下降。 */
export const collisionRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const v1raw = (inV ?? params.v0) / 5, e = Math.max(0, Math.min(1, params.e)), m2 = Math.max(0.3, params.m2), v2 = params.v2;
  const m1 = 1, u1 = v1raw, u2 = v2;
  const rel = u1 - u2, tc = rel > 0 ? 2.2 / rel : 1e9;
  const p0 = m1 * u1 + m2 * u2, ke0 = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  const nv1 = ((m1 - e * m2) * u1 + (1 + e) * m2 * u2) / (m1 + m2);
  const nv2 = ((m2 - e * m1) * u2 + (1 + e) * m1 * u1) / (m1 + m2);
  const p1 = m1 * nv1 + m2 * nv2, ke1 = 0.5 * m1 * nv1 * nv1 + 0.5 * m2 * nv2 * nv2;
  const xc = -1.1 + u1 * tc, tEnd = Math.min(tc + 1.0, tc * 1.35 + 0.4);
  const px = (x) => 200 + 150 * x, py = 128;
  const frames = [];
  for (let f = 0; f <= 24; f++) {
    const t = (f / 24) * tEnd;
    const hit = t >= tc;
    const x1 = hit ? xc + nv1 * (t - tc) : -1.1 + u1 * t;
    const x2 = hit ? xc + nv2 * (t - tc) : 1.1 + u2 * t;
    const s1 = hit ? nv1 : u1, s2 = hit ? nv2 : u2;
    const items = [line(30, py + 16, 380, py + 16, "#9aa7b5"),
      line(px(xc), py - 44, px(xc), py - 30, "#a9b8c5", true),
      label(28, 30, "m1=" + m1.toFixed(1) + "kg → · ← m2=" + m2.toFixed(1) + "kg · e=" + e.toFixed(2)),
      dot(px(x1), py, "#285a96", 13), dot(px(x2), py, "#b45e28", 13)];
    if (Math.abs(s1) > 1e-3) items.push(arrow(px(x1), py - 20, px(x1) + 26 * Math.sign(s1) * Math.min(1.6, Math.abs(s1) / 2), py - 20, "#285a96"));
    if (Math.abs(s2) > 1e-3) items.push(arrow(px(x2), py - 20, px(x2) + 26 * Math.sign(s2) * Math.min(1.6, Math.abs(s2) / 2), py - 20, "#b45e28"));
    items.push(label(28, 176, (hit ? "碰后" : "碰前") + " v1=" + fmt(s1, 3) + " m/s · v2=" + fmt(s2, 3) + " m/s"));
    items.push(label(28, 196, "总动量 p=" + fmt(p0, 4) + " → " + fmt(hit ? p1 : p0, 4) + " kg·m/s（不变）"));
    items.push(label(28, 214, "总动能 " + fmt(ke0, 4) + " → " + fmt(hit ? ke1 : ke0, 4) + " J" + (hit ? " · 损失 " + fmt(100 * (1 - ke1 / ke0), 3) + "%" : "")));
    frames.push({ title: hit ? "碰撞之后" : "相向接近", shapes: { viewBox: [400, 225], items },
      summary: "t=" + t.toFixed(2) + "s · " + (hit ? "已碰撞" : "未碰撞") + " · Σp=" + fmt(p0, 4) + " · ΣEk=" + fmt(hit ? ke1 : ke0, 4) + " J" });
  }
  return { data: { p0, p1, ke0, ke1, e, conserved: Math.abs(p1 - p0) < 1e-9 }, frames };
}`;

/* ============================== 第 5 章：静电场、恒定磁场与带电粒子 ============================== */

/** 速度选择器 + 质谱磁偏转：只有 v=E/B 的粒子直线穿缝。 */
export const emSelectorRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const bField = Math.max(0.05, inV ?? params.b), eField = params.e ?? auxV ?? 1.2;
  const m = Math.max(0.1, params.mass), q = Math.max(0.1, params.charge), v = Math.max(0.1, params.velocity);
  const balance = eField / bField;
  const pass = Math.abs(v - balance) <= 0.06 * balance;
  const spanX = 165, xEnter = 26, xSlit = xEnter + spanX;
  const aNet = q * (v * bField - eField) / m;
  const exitDy = Math.max(-46, Math.min(46, 0.5 * aNet * Math.pow(spanX / 60 / v, 2) * 60));
  const radius = m * v / (q * bField), period = 2 * Math.PI * m / (q * bField);
  const rPx = Math.min(95, Math.max(9, radius * 26));
  const items = [
    line(xEnter, 36, xSlit, 36, "#68798c"), line(xEnter, 116, xSlit, 116, "#68798c"),
    label(xEnter + 46, 28, "极板 E ↓ " + fmt(eField, 3)),
    label(xEnter + 4, 134, "速度选择器 · 缝隙"),
    line(xSlit, 60, xSlit, 92, "#68798c"),
    { kind: "rect", x: xSlit + 6, y: 18, w: 205, h: 150, fill: "#f4f0e8", stroke: "#d8d0c0", rx: 6 }];
  for (let i = 0; i < 5; i++) items.push(arrow(xEnter + 22 + i * 32, 44, xEnter + 22 + i * 32, 100, "#7253a5"));
  for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 4; gy++)
    items.push({ kind: "text", x: xSlit + 26 + gx * 27, y: 42 + gy * 32, text: "×", fill: "#8a94a3", size: 13 });
  items.push(label(xSlit + 26, 164, "匀强磁场 B=" + fmt(bField, 3) + " T（× 表示指向纸内）"));
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, x = xEnter + t * spanX;
    points.push([x, 76 + exitDy * t * t]);
  }
  for (let i = 1; i < points.length; i++) items.push(line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], "#b45e28", i % 2 === 0));
  const exitY = 76 + exitDy;
  items.push(dot(xEnter, 76, "#285a96", 5), arrow(xEnter, 76, xEnter + 24, 76, "#285a96"));
  if (pass) {
    items.push(line(xSlit, exitY, xSlit + 12, exitY, "#b45e28", true));
    const cx0 = xSlit + 12 + rPx, cy0 = exitY;
    items.push({ kind: "circle", cx: cx0, cy: cy0, r: rPx, fill: "none", stroke: "#b45e28", strokeWidth: 1.8, dashed: true });
    const theta0 = Math.PI;
    const arc = [];
    for (let i = 0; i <= 24; i++) {
      const a = theta0 + (i / 24) * Math.PI;
      arc.push([cx0 + rPx * Math.cos(a), cy0 + rPx * Math.sin(a)]);
    }
    for (let i = 1; i < arc.length; i++) items.push(line(arc[i - 1][0], arc[i - 1][1], arc[i][0], arc[i][1], "#be531a"));
    items.push(line(cx0, cy0, cx0 - rPx, cy0, "#be531a", true));
    items.push(label(xSlit + 18, exitY - 6, "R=" + fmt(radius, 3) + " m"));
  } else {
    items.push(label(xSlit + 20, exitY + 3, exitDy > 0 ? "磁力占优 → 向上偏，无法过缝" : "电力占优 → 向下偏，无法过缝"));
    items.push(line(xSlit, exitY, xSlit + 26, exitY + Math.sign(exitDy) * 18, "#be531a", true));
  }
  items.push(label(24, 190, "v=" + fmt(v, 3) + " m/s · 平衡 v=E/B=" + fmt(balance, 3) + " m/s"));
  items.push(label(24, 208, (pass ? "✓ 直线通过选择器" : "✗ 被选择器挡下") + " · 磁区回旋 T=" + fmt(period * 1e6, 4) + " μs · 磁力不做功，|v| 不变"));
  return { data: { pass, radius, period, balance, bField, exitDy }, frames: [
    { title: "速度选择器与磁偏转", shapes: { viewBox: [400, 225], items },
      summary: "v=" + fmt(v, 3) + " vs E/B=" + fmt(balance, 3) + " · " + (pass ? "直穿后按 R=mv/(qB)=" + fmt(radius, 3) + "m 回旋" : "偏离缝隙不能进入磁区") },
  ] };
}`;

/** 回旋半径、周期随 B 的扫描核对：R=mv/(qB)，T=2πm/(qB)，动能守恒。 */
export const orbitAuditRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const bField = Math.max(0.05, inV ?? params.b), m = Math.max(0.1, params.mass), q = Math.max(0.1, params.charge), v = Math.max(0.1, params.velocity);
  const radius = [], period = [], grid = [];
  for (let i = 0; i <= 46; i++) {
    const b = 0.2 + (2.5 - 0.2) * i / 46;
    radius.push(m * v / (q * b));
    period.push(2 * Math.PI * m / (q * b) * 1e6);
  }
  const rNow = m * v / (q * bField), tNow = 2 * Math.PI * m / (q * bField);
  const ke = 0.5 * m * v * v;
  return { data: { radius: rNow, period: tNow, ke, bField }, frames: [
    { title: "回旋半径 R(B) 与周期 T(B)", series: [
      { label: "R (m)", values: radius }, { label: "T (μs)", values: period }],
      summary: "B=" + fmt(bField, 3) + " T → R=" + fmt(rNow, 3) + " m · T=" + fmt(tNow * 1e6, 4) + " μs · R∝1/B，T 与 v 无关" },
    { title: "核对读数", columns: ["量", "数值", "式"], rows: [
      ["磁感应 B", fmt(bField, 4) + " T", "滑杆输入"],
      ["回旋半径 R", fmt(rNow, 4) + " m", "R=mv/(qB)"],
      ["回旋周期 T", fmt(tNow * 1e6, 4) + " μs", "T=2πm/(qB)，与 v 无关"],
      ["动能 Ek", fmt(ke, 4) + " J", "磁力 ⊥ v → 不做功，速率不变"]],
      summary: "半径随 B 反比收缩，周期只由荷质比与 B 决定" },
  ] };
}`;

/* ============================== 第 8 章：干涉、衍射与偏振 ============================== */

/** 双缝条纹屏：波长决定真实颜色与条纹间距 Δy=λL/d。 */
export const interferenceRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${label}
  ${fmt}
  ${wavelengthRgb}
  const lambda = Math.max(380, Math.min(780, inV ?? params.lambda));
  const d = Math.max(0.02, params.slitSep) * 1e-3, L = Math.max(0.2, params.screen);
  const lam = lambda * 1e-9, spacing = lam * L / d;
  const halfMM = 12;
  const items = [line(24, 118, 388, 118, "#9aa7b5"), label(24, 16, "观察屏上的条纹（截面展开）")];
  const intenAt = (ymm) => Math.pow(Math.cos(Math.PI * d * (ymm * 1e-3) / (lam * L)), 2);
  for (let i = 0; i <= 64; i++) {
    const ymm = (i / 64 - 0.5) * 2 * halfMM;
    const inten = intenAt(ymm);
    items.push({ kind: "rect", x: 36 + i * 5.1, y: 118 - 66 * inten - 4, w: 4.6, h: 8 + 66 * inten,
      fill: waveRgb(lambda), opacity: 0.28 + 0.72 * inten });
  }
  for (let i = 1; i <= 64; i++) {
    const i0 = intenAt(((i - 1) / 64 - 0.5) * 2 * halfMM);
    const i1 = intenAt((i / 64 - 0.5) * 2 * halfMM);
    items.push(line(36 + (i - 1) * 5.1, 196 - 34 * i0, 36 + i * 5.1, 196 - 34 * i1, "#285a96"));
  }
  items.push(label(30, 214, "下方蓝线为相对光强 I/I₀"));
  return { data: { lambda, spacing: spacing * 1e3, color: waveName(lambda) }, frames: [
    { title: "双缝干涉条纹（真实颜色）", shapes: { viewBox: [400, 225], items },
      summary: "λ=" + Math.round(lambda) + " nm（" + waveName(lambda) + "光）· Δy=λL/d=" + fmt(spacing * 1e3, 4) + " mm · 波长越长条纹越宽" },
  ] };
}`;

/** 多缝光栅：N 增大时主极大变窄变锐，次级迅速压平，并乘单缝衍射包络。 */
export const gratingRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const nSlits = Math.max(2, Math.min(16, Math.round(inV ?? params.slits)));
  const dOverA = Math.max(1.05, params.dOverA);
  const uMax = Math.PI * 3.2, steps = 121;
  const intensity = [], logI = [];
  for (let i = 0; i < steps; i++) {
    const u = -uMax + 2 * uMax * i / (steps - 1);
    const au = u / dOverA;
    const denom = Math.abs(au) < 1e-9 ? 1 : Math.sin(au) / au;
    const arrayFactor = Math.abs(nSlits * Math.sin(u)) < 1e-9 ? 1 : Math.sin(nSlits * u) / (nSlits * Math.sin(u));
    const envelope = denom * denom, value = arrayFactor * arrayFactor * envelope;
    intensity.push(value);
    logI.push(Math.max(-5, Math.log10(Math.max(1e-5, value))));
  }
  const widthEstimate = 2 * uMax / (nSlits * Math.PI);
  return { data: { slits: nSlits, widthEstimate }, frames: [
    { title: "N=" + nSlits + " 缝光栅强度分布", series: [
      { label: "I/I₀（含单缝包络）", values: intensity }],
      summary: "u=πd·sinθ/λ 扫描 · N=" + nSlits + " · 主极大半宽≈2π/N=" + fmt(2 * Math.PI / nSlits, 3) + " · d/a=" + fmt(dOverA, 3) },
    { title: "对数坐标看次级", series: [{ label: "log₁₀(I/I₀)", values: logI }],
      summary: "N 越大主极大越锐，相邻主极大间有 N−2 个次极大、N−1 个零点" },
  ] };
}`;

/** 马吕斯定律 I=I₀cos²θ；插入 45° 中间片时光重新透出。 */
export const polarizerRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  ${wavelengthRgb}
  const lambda = inV ?? params.lambda, thetaDeg = params.theta, middle = Math.round(params.middle) === 1;
  const th = thetaDeg * Math.PI / 180;
  const direct = Math.pow(Math.cos(th), 2);
  const via45 = Math.pow(Math.cos(Math.PI / 4), 2) * Math.pow(Math.cos(th - Math.PI / 4), 2);
  const beamColor = waveRgb(lambda);
  const draw = (useMiddle) => {
    const plates = useMiddle ? [90, 200, 310] : [90, 310];
    const angles = useMiddle ? [0, 45, thetaDeg] : [0, thetaDeg];
    const items = [label(24, 18, (useMiddle ? "三片偏振：起偏 → 45° 中片 → " : "两片偏振：起偏 → ") + "检偏 θ=" + thetaDeg.toFixed(0) + "°")];
    const amps = useMiddle ? [1, Math.pow(Math.cos(Math.PI / 4), 2), via45] : [1, direct];
    for (let seg = 0; seg < plates.length; seg++) {
      const x0 = seg === 0 ? 24 : plates[seg - 1] + 10, x1 = plates[seg];
      const alpha = 0.18 + 0.82 * amps[seg];
      for (let i = 0; i < 9; i++) {
        const x = x0 + (x1 - x0) * (i + 0.5) / 9;
        const seg2 = line(x, 66 - 13 * amps[seg], x, 66 + 13 * amps[seg], beamColor);
        seg2.opacity = alpha;
        items.push(seg2);
      }
    }
    for (let i = 0; i < plates.length; i++) {
      const x = plates[i], a = angles[i] * Math.PI / 180;
      items.push({ kind: "rect", x: x - 4, y: 34, w: 8, h: 64, fill: "#3b4757", rx: 2 });
      items.push(line(x, 66 - 30 * Math.sin(a + Math.PI / 2), x, 66 + 30 * Math.sin(a + Math.PI / 2), "#eef2f6"));
      items.push(label(x - 12, 112, i === 0 ? "起偏 0°" : i === 1 && useMiddle ? "中片 45°" : "检偏 " + thetaDeg.toFixed(0) + "°"));
    }
    const tail = amps.at(-1);
    for (let i = 0; i < 8; i++) {
      const x = plates.at(-1) + 10 + i * 6.4;
      const tail2 = line(x, 66 - 13 * tail, x, 66 + 13 * tail, beamColor);
      tail2.opacity = 0.18 + 0.82 * tail;
      items.push(tail2);
    }
    items.push(label(24, 136, "透过率 I/I₀ = " + fmt(tail, 4)));
    return items;
  };
  const curve = [];
  for (let i = 0; i <= 36; i++) curve.push(Math.pow(Math.cos(i * Math.PI / 72), 2));
  const curve45 = curve.map((v, i) => Math.pow(Math.cos(Math.PI / 4), 2) * Math.pow(Math.cos(i * Math.PI / 72 - Math.PI / 4), 2));
  return { data: { direct, via45, thetaDeg, middle, lambda }, frames: [
    { title: middle ? "两片之间插入 45° 中片" : "起偏片 + 检偏片", shapes: { viewBox: [400, 165], items: draw(middle) },
      series: [{ label: "直接 I/I₀=cos²θ", values: curve }, { label: "经 45° 中片", values: curve45 }],
      summary: "θ=" + thetaDeg.toFixed(0) + "° · 直接透射 cos²θ=" + fmt(direct, 4) +
        " · 经 45° 中片 cos²45·cos²(θ−45)=" + fmt(via45, 4) + (thetaDeg === 90 ? " · 90° 时直接为零，中片竟让它重亮" : "") },
  ] };
}`;

/* ============================== 第 10 章：相对论与量子物理入门 ============================== */

/** 光钟时间膨胀与飞船尺缩：γ=1/√(1−β²)。 */
export const relativityRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const beta = Math.max(0, Math.min(0.99, inV ?? params.beta));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const items = [label(24, 16, "β=v/c=" + beta.toFixed(3) + " → γ=1/√(1−β²)=" + fmt(gamma, 4))];
  const x0 = 70, x1 = 250;
  items.push({ kind: "rect", x: x0 - 34, y: 30, w: 68, h: 8, fill: "#68798c", rx: 2 },
    { kind: "rect", x: x0 - 34, y: 130, w: 68, h: 8, fill: "#68798c", rx: 2 },
    line(x0, 38, x0, 130, "#285a96", true), arrow(x0, 122, x0, 46, "#285a96"),
    dot(x0, 38, "#be531a", 4), label(x0 - 46, 156, "静止光钟：光子直上直下，T₀"));
  items.push({ kind: "rect", x: x1 - 34, y: 30, w: 68, h: 8, fill: "#68798c", rx: 2 },
    { kind: "rect", x: x1 - 34, y: 130, w: 68, h: 8, fill: "#68798c", rx: 2 },
    line(x1, 130, x1 + 74 * beta, 38, "#b45e28"), line(x1 + 74 * beta, 38, x1 + 148 * beta, 130, "#b45e28", true),
    dot(x1, 130, "#be531a", 4),
    label(x1 - 20, 156, "运动光钟：光子走斜边，T=γT₀"));
  const shipW = 120, shipL = shipW / gamma;
  items.push({ kind: "polygon", points: [[60, 184], [60 + shipW, 184], [60 + shipW + 16, 196], [60 + shipW, 208], [60, 208]],
    fill: "#dbe4ee", stroke: "#68798c", opacity: 0.7 });
  items.push({ kind: "polygon", points: [[235, 186], [235 + shipL, 186], [235 + shipL + 12, 197], [235 + shipL, 208], [235, 208]],
    fill: "#f3ddcf", stroke: "#b45e28" });
  items.push(label(60, 224, "静止长度 L₀"));
  items.push(label(235, 224, "飞船以 βc 经过：L=L₀/γ=" + fmt(1 / gamma, 3) + "L₀"));
  return { data: { beta, gamma, lengthRatio: 1 / gamma }, frames: [
    { title: "时间膨胀与长度收缩", shapes: { viewBox: [400, 235], items },
      summary: "β=" + beta.toFixed(3) + " · γ=" + fmt(gamma, 4) + " · 动钟慢 " + fmt(gamma, 3) + " 倍 · 船长收缩为 " + fmt(100 / gamma, 3) + "%" },
  ] };
}`;

/** 光电效应：I–U 曲线、遏止电压 Us 与截止频率 ν0=W/h。 */
export const photoelectricRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const nu = Math.max(0.5, inV ?? params.nu), work = Math.max(0.5, params.work), intensity = Math.max(0.1, params.intensity);
  const h = 0.41357;
  const energy = h * nu, kMax = Math.max(0, energy - work), nu0 = work / h;
  const emits = energy > work;
  const iSat = emits ? intensity : 0;
  const curve = [], stopping = [];
  for (let i = 0; i <= 48; i++) {
    const u = -3 + 5 * i / 48;
    curve.push(emits ? iSat * (1 - Math.exp(-Math.max(0, u + kMax) / 0.55)) : 0);
  }
  for (let i = 0; i <= 48; i++) {
    const f = 3 + 9 * i / 48;
    stopping.push(Math.max(0, h * f - work));
  }
  return { data: { kMax, stopping: kMax, nu0, emits, energy }, frames: [
    { title: "光电流 I–U（当前 ν=" + fmt(nu, 3) + "×10¹⁴Hz）", series: [
      { label: "光电流（饱和=" + fmt(iSat, 3) + "）", values: curve }],
      summary: emits ? "Kmax=hν−W=" + fmt(kMax, 3) + " eV → 遏止电压 Us=" + fmt(kMax, 3) + " V（U<−Us 电流为零）"
        : "hν=" + fmt(energy, 3) + " eV < W=" + fmt(work, 3) + " eV → 再强光也无光电子" },
    { title: "遏止电压随频率线性增长", series: [{ label: "Us(ν) / V", values: stopping }],
      summary: "ν0=W/h=" + fmt(nu0, 3) + "×10¹⁴Hz 为截止频率 · 斜率即 h/e（×10¹⁴换算）" },
  ] };
}`;

/** 一维无限深势阱：ψn、|ψn|²、能级 En=n²E1 与 hν 跃迁核对。 */
export const quantumWellRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const nu = inV ?? params.nu, n = Math.max(1, Math.min(5, Math.round(params.level))), e1 = Math.max(0.05, params.e1);
  const h = 0.41357, en = n * n * e1, delta = (2 * n + 1) * e1, photon = h * nu;
  const absorbed = Math.abs(photon - delta) < 0.08 * delta;
  const x0 = 60, x1 = 340, base = 176, scale = Math.min(34, 150 / (25 * e1));
  const y0 = base - en * scale;
  const items = [line(x0, 24, x0, 196, "#3b4757"), line(x1, 24, x1, 196, "#3b4757"),
    line(x0, 196, x1, 196, "#3b4757"), label(x0 + 4, 20, "无限深势阱 · n=" + n)];
  const pts = [], area = [];
  for (let i = 0; i <= 60; i++) {
    const x = x0 + (x1 - x0) * i / 60, ph = Math.PI * n * i / 60;
    pts.push([x, y0 - 26 * Math.sin(ph)]);
    area.push([x, y0 - 26 * Math.pow(Math.sin(ph), 2)]);
  }
  for (let i = 1; i < pts.length; i++) items.push(line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], "#285a96"));
  items.push({ kind: "polygon", points: [[x0, y0], ...area, [x1, y0]], fill: "#f3ddcf", stroke: "#be531a", opacity: 0.85 });
  items.push(line(x0, y0, x1, y0, "#8a94a3", true));
  const nodes = n - 1;
  for (let i = 1; i <= nodes; i++) items.push(dot(x0 + (x1 - x0) * i / n, y0, "#3b4757", 3));
  items.push(label(x0 + 4, y0 + 16, "E" + n + "=n²E₁=" + fmt(en, 3) + " eV · 节点 " + nodes + " 个 · 阴影 |ψ|²"));
  items.push(label(24, 216, "hν=" + fmt(photon, 3) + " eV vs ΔE(n→n+1)=" + fmt(delta, 3) + " eV → " +
    (absorbed ? "✓ 共振吸收，可激发跃迁" : "不匹配，该频率光子不被吸收")));
  return { data: { level: n, en, delta, photon, absorbed }, frames: [
    { title: "定态波函数 ψ" + n + " 与概率密度", shapes: { viewBox: [400, 228], items },
      summary: "n=" + n + " · E=" + fmt(en, 3) + " eV · |ψ|² 有 " + (n - 1) + " 个节点 · 能量量子化" },
  ] };
}`;

/* ============================== 第 2 章：刚体转动与角动量 ============================== */

/** 滚落竞赛：实心球/圆盘/圆环同质量同半径，I 越小加速越快先到底。 */
export const rollRaceRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const alpha = Math.max(5, Math.min(70, inV ?? params.alpha)) * Math.PI / 180;
  const radius = Math.max(0.05, auxV ?? params.radius);
  const g = 9.8, len = 2.4;
  const bodies = [
    { name: "实心球 I=2/5mR²", f: 0.4, color: "#285a96" },
    { name: "圆盘 I=1/2mR²", f: 0.5, color: "#21816a" },
    { name: "圆环 I=mR²", f: 1.0, color: "#b45e28" },
  ];
  const accel = bodies.map((b) => g * Math.sin(alpha) / (1 + b.f));
  const times = accel.map((a) => Math.sqrt(2 * len / a));
  const tEnd = Math.max(...times) * 1.02;
  const ramp = (x) => 34 + x / len * 330, yTop = 40, laneDy = 46;
  const inclineY = (x, lane) => yTop + lane * laneDy + x / len * 118;
  const frames = [];
  const order = [...bodies.keys()].sort((i, j) => times[i] - times[j]);
  for (let f = 0; f <= 24; f++) {
    const t = (f / 24) * tEnd;
    const items = [label(24, 16, "α=" + (alpha * 180 / Math.PI).toFixed(0) + "° · 同 m、同 R 无滑滚落 · 半径 R 只影响转动圈数不影响快慢")];
    for (let lane = 0; lane < 3; lane++) {
      const x0 = ramp(0), x1 = ramp(len);
      const yA = inclineY(0, lane), yB = inclineY(len, lane);
      items.push(line(x0, yA, x1, yB, "#9aa7b5"));
      const a = accel[lane], s = Math.min(len, 0.5 * a * t * t);
      const frac = s / len;
      const cx = x0 + (x1 - x0) * frac, cy = yA + (yB - yA) * frac - radius * 30;
      items.push({ kind: "circle", cx, cy, r: radius * 30, fill: "none", stroke: bodies[lane].color, strokeWidth: 2.4 });
      const rot = s / radius;
      items.push(line(cx, cy, cx + radius * 30 * Math.cos(rot), cy + radius * 30 * Math.sin(rot), bodies[lane].color));
      items.push(label(x0 - 6, yA - 16, bodies[lane].name.split(" ")[0]));
      if (s >= len && f % 6 < 3) items.push(label(x1 - 52, yB - 8, "t=" + fmt(times[lane], 3) + "s"));
    }
    frames.push({ title: "滚落竞赛", shapes: { viewBox: [400, 205], items },
      summary: "a=gsinα/(1+I/mR²) · t: 球 " + fmt(times[0], 3) + "s < 盘 " + fmt(times[1], 3) + "s < 环 " + fmt(times[2], 3) + "s · 惯量小者胜" });
  }
  return { data: { tSphere: times[0], tDisk: times[1], tHoop: times[2], alphaDeg: alpha * 180 / Math.PI, order }, frames };
}`;

/** 收臂加速：L=mvr 守恒，I 减小时 ω 猛增且转动动能反而增加。 */
export const spinUpRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const r = Math.max(0.05, inV ?? params.r);
  const m = 1, v0 = params.v0, r0 = 0.6;
  const Lz = m * v0 * r0, I = m * r * r, omega = Lz / I, ke = 0.5 * I * omega * omega;
  const omega0 = v0 / r0, ke0 = 0.5 * m * v0 * v0;
  const cx = 130, cy = 116, rPx = Math.min(92, r * 150);
  const items = [line(cx, 24, cx, 208, "#a9b8c5", true), label(30, 16, "绳穿过管心：拉力不做功也无外力矩 → L 守恒"),
    { kind: "circle", cx, cy, r: rPx, fill: "none", stroke: "#c3ccd7", strokeWidth: 1, dashed: true },
    line(cx, cy, cx + rPx, cy, "#68798c"), dot(cx + rPx, cy, "#b45e28", 9),
    arrow(cx + rPx, cy, cx + rPx, cy - 26, "#285a96"),
    label(cx + rPx + 8, cy - 20, "v"), label(cx + 6, cy - 8, "r=" + fmt(r, 3) + " m")];
  const seriesW = [], seriesK = [];
  for (let i = 0; i <= 48; i++) {
    const rr = 0.1 + 0.5 * i / 48, ii = m * rr * rr, w = Lz / ii;
    seriesW.push(w); seriesK.push(0.5 * ii * w * w);
  }
  items.push(label(24, 216, "ω=" + fmt(omega, 3) + " rad/s = ω₀×(r₀/r)² · 转动动能 Ek=" + fmt(ke, 3) + " J（收臂时反而增加，功来自手的拉力）"));
  return { data: { omega, omegaRatio: omega / omega0, ke, keRatio: ke / ke0, r }, frames: [
    { title: "角动量守恒收臂实验", shapes: { viewBox: [400, 225], items },
      series: [{ label: "ω(r) rad/s", values: seriesW }, { label: "Ek(r) J", values: seriesK }],
      summary: "r=" + fmt(r, 3) + " m · ω=ω₀·(r₀/r)²=" + fmt(omega / omega0, 3) + "ω₀ · Ek=Ek₀·(r₀/r)²=" + fmt(ke / ke0, 3) + "Ek₀" },
  ] };
}`;

/* ============================== 第 3 章：振动、阻尼与共振 ============================== */

/** 单摆能量账本 + 大摆角周期偏离：上游 body 实时 ke/pe/θ。 */
export const pendulumAuditRule = `function run({ params, upstream }) {
  ${line}
  ${label}
  ${fmt}
  const body = upstream.find((v) => v.kind === "body");
  const ke = body?.ke ?? 0, pe = body?.pe ?? 0, theta = body?.theta ?? 0;
  const total = Math.max(1e-6, ke + pe);
  const barY = 150;
  const items = [label(24, 16, "单摆能量实时账本（上游 body）"),
    line(40, barY, 360, barY, "#9aa7b5")];
  items.push({ kind: "rect", x: 80, y: barY - 96 * ke / total, w: 64, h: 96 * ke / total, fill: "#b45e28", rx: 3 });
  items.push({ kind: "rect", x: 220, y: barY - 96 * pe / total, w: 64, h: 96 * pe / total, fill: "#285a96", rx: 3 });
  items.push(label(80, barY + 18, "动能 " + fmt(ke, 3) + "J"), label(220, barY + 18, "势能 " + fmt(pe, 3) + "J"));
  items.push(label(80, 40, "θ=" + fmt(theta * 180 / Math.PI, 4) + "° · E=Ek+Ep≈" + fmt(total, 4) + " J（无阻尼守恒）"));
  const ratio = [], ampDeg = params.thetaAmp * Math.PI / 180;
  for (let i = 0; i <= 34; i++) {
    const a = (i * 2.5) * Math.PI / 180, s = a * a;
    ratio.push(1 + s / 16 + 11 * s * s / 3072 + 173 * s * s * s / 737280);
  }
  const s = ampDeg * ampDeg, tRatio = 1 + s / 16 + 11 * s * s / 3072 + 173 * s * s * s / 737280;
  return { data: { ke, pe, total, thetaDeg: theta * 180 / Math.PI, periodRatio: tRatio }, frames: [
    { title: "动能 ⇌ 势能实时转化", shapes: { viewBox: [400, 190], items },
      summary: "θ=" + fmt(theta * 180 / Math.PI, 3) + "° · Ek " + fmt(ke, 3) + " + Ep " + fmt(pe, 3) + " = " + fmt(total, 3) + " J" },
    { title: "真实周期 / 小角周期 vs 摆幅", series: [{ label: "T/T₀", values: ratio }],
      summary: "摆幅 θ₀=" + params.thetaAmp.toFixed(0) + "° → T/T₀=" + fmt(tRatio, 4) + " · 85° 时真实周期约慢 18%" },
  ] };
}`;

/** 幅频扫描：共振峰被阻尼压低展宽，峰位≈固有频率 ω0。 */
export const resonanceScanRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${fmt}
  const c = Math.max(0.02, inV ?? params.c), wd = Math.max(0.2, auxV ?? params.wd);
  const k = params.k, m = params.m, f0 = params.f0;
  const w0 = Math.sqrt(k / m);
  const amp = (w) => f0 / Math.max(1e-9, Math.hypot(k - m * w * w, c * w));
  const curve = [];
  for (let i = 0; i <= 60; i++) curve.push(amp(0.3 + 7.7 * i / 60));
  const peak = amp(w0), current = amp(wd);
  return { data: { w0, peak, current, c, wd, quality: w0 * m / c }, frames: [
    { title: "稳态振幅 A(ωd)", series: [{ label: "A(ω)", values: curve }],
      summary: "c=" + fmt(c, 3) + " · ω0=√(k/m)=" + fmt(w0, 3) + " · 峰 " + fmt(peak, 3) + " · 当前 ωd=" + fmt(wd, 2) + " → A=" + fmt(current, 3) },
    { title: "核对读数", columns: ["量", "数值"], rows: [
      ["固有频率 ω0", fmt(w0, 4) + " rad/s"], ["共振峰 A_max", fmt(peak, 4) + " m"],
      ["当前驱动 ωd", fmt(wd, 3) + " rad/s"], ["当前振幅 A", fmt(current, 4) + " m"],
      ["品质因数 Q≈mω0/c", fmt(w0 * m / c, 3)]],
      summary: "阻尼 c 越小峰越高越窄；Q 高时对频率更敏感" },
  ] };
}`;

/* ============================== 第 4 章：机械波、叠加与多普勒 ============================== */

/** 行波 vs 驻波：驻波波节钉死不动，行波整体平移输运能量。 */
export const standingWaveRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const freq = Math.max(0.1, inV ?? params.f), lambda = Math.max(0.4, params.lambda);
  const x0 = 30, x1 = 382, amp = 26;
  const grid = (x) => x0 + (x1 - x0) * x / (2 * lambda);
  const frames = [];
  for (let f = 0; f < 24; f++) {
    const phase = f / 24;
    const items = [label(24, 14, "f=" + fmt(freq, 3) + " Hz · 上：行波右行 · 下：驻波（同频同幅反向叠加）"),
      line(x0, 74, x1, 74, "#c3ccd7"), line(x0, 190, x1, 190, "#c3ccd7")];
    for (let i = 1; i <= 80; i++) {
      const xa = (i - 1) / 80 * 2 * lambda, xb = i / 80 * 2 * lambda;
      items.push(line(grid(xa), 74 - amp * Math.sin(2 * Math.PI * (freq * phase - xa / lambda)),
        grid(xb), 74 - amp * Math.sin(2 * Math.PI * (freq * phase - xb / lambda)), "#285a96"));
      const sa = 2 * amp * Math.sin(2 * Math.PI * xa / lambda) * Math.cos(2 * Math.PI * freq * phase);
      const sb = 2 * amp * Math.sin(2 * Math.PI * xb / lambda) * Math.cos(2 * Math.PI * freq * phase);
      items.push(line(grid(xa), 190 - sa, grid(xb), 190 - sb, "#b45e28"));
    }
    for (let nIdx = 0; nIdx <= 4; nIdx++) items.push(dot(grid(nIdx * lambda / 2), 190, "#3b4757", 3.5));
    items.push(label(x0, 216, "驻波波节（黑点）永远不动 · 行波每个点都在传播能量"));
    frames.push({ title: "行波与驻波", shapes: { viewBox: [400, 225], items },
      summary: "t=" + fmt(phase / freq, 3) + "s · 行波以 v=fλ 右移 · 驻波腹幅 2A 振荡，波节恒为零 → 净能流为零" });
  }
  return { data: { freq, lambda, nodeSpacing: lambda / 2 }, frames };
}`;

/** 多普勒：运动波源的波前压缩/拉伸；v_s≥c 时出现马赫锥。 */
export const dopplerRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const vs = Math.max(0, Math.min(1.3, inV ?? params.vs));
  const items = [label(24, 14, "波源速度 vs=" + fmt(vs, 2) + "c（c=波速）· 右行波源")];
  const cy = 118, tSpan = 3, cSpeed = 60;
  const srcX = 70 + vs * cSpeed * tSpan;
  for (let i = 0; i < 8; i++) {
    const emitT = i * tSpan / 8, x = 70 + vs * cSpeed * emitT, r = cSpeed * (tSpan - emitT);
    items.push({ kind: "circle", cx: x, cy, r, fill: "none", stroke: "#8fa7bd", strokeWidth: 1.2 });
  }
  items.push(dot(srcX, cy, "#b45e28", 6), arrow(srcX - 30, cy - 14, srcX - 6, cy - 14, "#b45e28"));
  if (vs > 1) {
    const mach = Math.asin(1 / vs);
    items.push(line(srcX, cy, srcX - 150 * Math.cos(mach), cy - 150 * Math.sin(mach), "#be531a"));
    items.push(line(srcX, cy, srcX - 150 * Math.cos(mach), cy + 150 * Math.sin(mach), "#be531a"));
    items.push(label(24, 26, "马赫锥半角 θ=asin(c/vs)=" + fmt(mach * 180 / Math.PI, 3) + "°"));
  }
  const fAhead = vs < 0.985 ? 1 / (1 - vs) : 1 / (1 - 0.985), fBehind = 1 / (1 + vs);
  items.push(label(24, 210, "前方 f′=f·c/(c−vs)=" + fmt(fAhead, 3) + "f · 后方 f′=f·c/(c+vs)=" + fmt(fBehind, 3) + "f"));
  const ahead = [], behind = [];
  for (let i = 0; i <= 48; i++) {
    const s = 1.05 * i / 48;
    ahead.push(1 / Math.max(0.02, 1 - s)); behind.push(1 / (1 + s));
  }
  return { data: { vs, fAhead, fBehind, machDeg: vs > 1 ? Math.asin(1 / vs) * 180 / Math.PI : null }, frames: [
    { title: "波前挤压与多普勒频移", shapes: { viewBox: [400, 225], items },
      series: [{ label: "前方 f′/f", values: ahead }, { label: "后方 f′/f", values: behind }],
      summary: "vs=" + fmt(vs, 2) + "c · 前方升频 ×" + fmt(fAhead, 3) + " · 后方降频 ×" + fmt(fBehind, 3) +
        (vs > 1 ? " · 超声速形成马赫锥" : " · vs→c 时前方波前堆成激波") },
  ] };
}`;

/* ============================== 第 6 章：电磁感应与交流暂态 ============================== */

/** 动生电动势：导体棒被安培力刹停，初始动能全部变成焦耳热。 */
export const motionalEmfRule = `function run({ params, upstream }) {
  ${inScalar}
  ${auxScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const bField = Math.max(0.05, inV ?? params.b), ohm = Math.max(0.5, auxV ?? params.r);
  const rail = Math.max(0.1, params.rail), mass = Math.max(0.1, params.mass), v0 = Math.max(0.5, params.v0);
  const tau = mass * ohm / (bField * bField * rail * rail);
  const xEnd = v0 * tau, emf0 = bField * rail * v0, ke0 = 0.5 * mass * v0 * v0;
  const px = (x) => 46 + Math.min(0.96, x / Math.max(xEnd * 1.15, 0.4)) * 320;
  const frames = [];
  for (let f = 0; f <= 24; f++) {
    const t = (f / 24) * 4.5 * tau;
    const x = v0 * tau * (1 - Math.exp(-t / tau)), v = v0 * Math.exp(-t / tau);
    const items = [label(24, 14, "B=" + fmt(bField, 2) + "T（×）· R=" + fmt(ohm, 2) + "Ω · τ=mR/(B²L²)=" + fmt(tau, 3) + "s")];
    for (let gx = 0; gx < 9; gx++) for (let gy = 0; gy < 3; gy++)
      items.push({ kind: "text", x: 60 + gx * 34, y: 58 + gy * 30, text: "×", fill: "#a0aabb", size: 12 });
    items.push(line(40, 120, 386, 120, "#68798c"), line(40, 166, 386, 166, "#68798c"));
    items.push({ kind: "rect", x: px(x) - 4, y: 112, w: 8, h: 62, fill: "#b45e28", rx: 2 });
    if (v > 0.02 * v0) items.push(arrow(px(x) + 8, 128, px(x) + 8 + 34 * v / v0, 128, "#285a96"));
    items.push(arrow(px(x) - 8, 158, px(x) - 8 - 30 * v / v0, 158, "#be531a"));
    items.push(label(24, 196, "v=" + fmt(v, 3) + " m/s · ε=BLv=" + fmt(bField * rail * v, 3) + " V · 安培力向左刹车"));
    frames.push({ title: "无摩擦自动刹停", shapes: { viewBox: [400, 215], items },
      summary: "t=" + fmt(t, 3) + "s · v=v₀e^(−t/τ)=" + fmt(v, 3) + " · 焦耳热已达 " + fmt(ke0 * (1 - Math.exp(-2 * t / tau)), 3) + " J" });
  }
  const vel = [], heat = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * 4.5 * tau;
    vel.push(v0 * Math.exp(-t / tau));
    heat.push(ke0 * (1 - Math.exp(-2 * t / tau)));
  }
  frames[0].series = [
    { label: "v(t) m/s", values: vel }, { label: "累计焦耳热 Q(t) J", values: heat }];
  return { data: { tau, emf0, ke0, xEnd, heat: ke0 }, frames };
}`;

/** RC 充放电：τ=RC 决定暂态快慢，储能 ½CU² 与焦耳热对账。 */
export const rcChargeRule = `function run({ params, upstream }) {
  ${inScalar}
  ${fmt}
  const ohm = Math.max(1, inV ?? params.r), cap = Math.max(0.1, params.cap), u0 = params.u0;
  const tau = ohm * cap;
  const volts = [], amps = [], stored = [], dissipated = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * 5 * tau;
    const u = u0 * (1 - Math.exp(-t / tau)), cur = (u0 / ohm) * Math.exp(-t / tau);
    volts.push(u); amps.push(cur * 1000);
    stored.push(0.5 * cap * u * u);
    dissipated.push(0.5 * cap * u0 * u0 - 0.5 * cap * u * u);
  }
  return { data: { tau, uEnd: volts.at(-1), iStart: u0 / ohm, stored: stored.at(-1) }, frames: [
    { title: "充电：Uc(t) 与 I(t)", series: [
      { label: "电容电压 Uc (V)", values: volts }, { label: "充电电流 I (mA)", values: amps }],
      summary: "C 单位 mF → τ=RC=" + fmt(tau, 3) + "ms · Uc→" + fmt(u0, 2) + "V 渐近 · I(0)=" + fmt(u0 / ohm * 1000, 3) + " mA 指数衰减" },
    { title: "能量去向：½CU² vs 电阻热", series: [
      { label: "电容储能 ½CU² (mJ)", values: stored }, { label: "电阻累计焦耳热 (mJ)", values: dissipated }],
      summary: "电源输出一半储能、一半发热：充饱时储能=½CU₀²，电阻耗散也为 ½CU₀²" },
  ] };
}`;

/* ============================== 第 7 章：折射、全反射与透镜 ============================== */

/** 斯涅尔折射与全反射：跨过临界角折射光消失，光被锁进光纤。 */
export const snellRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const thetaDeg = Math.max(0, Math.min(89, inV ?? params.theta));
  const n1 = Math.max(1, params.n1), n2 = Math.max(1, params.n2);
  const th = thetaDeg * Math.PI / 180;
  const sinT = n1 / n2 * Math.sin(th);
  const tir = sinT > 1, thetaC = n1 > n2 ? Math.asin(n2 / n1) * 180 / Math.PI : null;
  const cx = 150, cy = 110, Lr = 84;
  const items = [line(20, cy, 384, cy, "#68798c"), line(cx, 22, cx, 208, "#a9b8c5", true),
    { kind: "rect", x: 20, y: cy, w: 364, h: 98, fill: "#eef4f8" },
    line(20, cy, 384, cy, "#68798c"),
    label(24, cy + 18, "n₂=" + fmt(n2, 2) + "（光疏）"), label(24, cy - 8, "n₁=" + fmt(n1, 2) + "（光密）")];
  items.push(line(cx, cy, cx - Lr * Math.sin(th), cy - Lr * Math.cos(th), "#285a96"));
  items.push(arrow(cx - Lr * 0.55 * Math.sin(th), cy - Lr * 0.55 * Math.cos(th), cx - Lr * Math.sin(th) * 0.97, cy - Lr * Math.cos(th) * 0.97, "#285a96"));
  if (!tir) {
    const th2 = Math.asin(Math.min(1, sinT));
    items.push(line(cx, cy, cx + Lr * Math.sin(th2), cy + Lr * Math.cos(th2), "#b45e28"));
    items.push(label(cx + 14, cy + 34, "折射角 θ₂=" + fmt(th2 * 180 / Math.PI, 3) + "°"));
  } else {
    items.push(line(cx, cy, cx + Lr * Math.sin(th), cy - Lr * Math.cos(th), "#be531a"));
    items.push({ kind: "rect", x: cx + 20, y: cy + 44, w: 208, h: 40, fill: "#eef4f8", stroke: "#8a94a3" });
    let fx = cx + 26, fy = cy + 50, fdir = 1;
    for (let i = 0; i < 4; i++) {
      const nx = fx + 52, ny = fdir > 0 ? cy + 78 : cy + 50;
      items.push(line(fx, fy, nx, ny, "#be531a"));
      fx = nx; fy = ny; fdir = -fdir;
    }
    items.push(arrow(fx - 26, fdir > 0 ? cy + 50 : cy + 78, fx, fy, "#be531a"));
    items.push(label(cx + 30, 42, "全反射：折射光消失，光被锁进介质/光纤"));
  }
  items.push(label(24, 216, "入射角 θ=" + thetaDeg.toFixed(0) + "° · 临界角 θc=" + (thetaC === null ? "∞（从光疏到光密无全反射）" : fmt(thetaC, 3) + "°") +
    " · " + (tir ? "θ>θc 全反射" : "斯涅尔 n₁sinθ=n₂sinθ₂")));
  return { data: { thetaDeg, thetaC, tir, theta2: tir ? null : Math.asin(Math.min(1, sinT)) * 180 / Math.PI }, frames: [
    { title: "折射 → 全反射临界", shapes: { viewBox: [400, 225], items },
      summary: "θ=" + thetaDeg.toFixed(0) + "° · θc=" + (thetaC === null ? "无" : fmt(thetaC, 3) + "°") +
        (tir ? " · 跨过临界角：全部能量反射回原介质" : " · 折射角 " + fmt(Math.asin(Math.min(1, sinT)) * 180 / Math.PI, 3) + "°") },
  ] };
}`;

/** 薄透镜三条特殊光线：物距跨过 f 时实像翻成正立放大虚像。 */
export const thinLensRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${arrow}
  ${fmt}
  const u = Math.max(5, inV ?? params.u), f = Math.max(5, params.focal);
  const vFinite = Math.abs(u - f) > 0.5;
  const v = vFinite ? u * f / (u - f) : 0, mag = vFinite ? -v / u : 0;
  const real = vFinite && v > 0;
  const scale = 1.55, cx = 200, cy = 108, objH = 44;
  const ox = cx - u * scale;
  const items = [line(20, cy, 384, cy, "#9aa7b5"),
    { kind: "rect", x: cx - 5, y: 42, w: 10, h: 132, rx: 5, fill: "#dfe8f3", stroke: "#68798c" }];
  for (const side of [-1, 1]) {
    items.push(dot(cx + side * f * scale, cy, "#3b4757", 3));
    items.push(label(cx + side * f * scale - 4, cy + 16, "F"));
    items.push(dot(cx + side * 2 * f * scale, cy, "#8a94a3", 2.5));
    items.push(label(cx + side * 2 * f * scale - 8, cy + 16, "2F"));
  }
  items.push(line(ox, cy - objH, ox, cy, "#285a96"), arrow(ox, cy - objH + 24, ox, cy - objH, "#285a96"));
  items.push(label(ox - 6, cy + 16, "物 u=" + fmt(u, 3)));
  if (vFinite) {
    const ix = cx + v * scale, ih = objH * Math.abs(mag);
    if (real) {
      items.push(line(ox, cy - objH, cx, cy - objH, "#b45e28"), line(cx, cy - objH, ix, cy + ih, "#b45e28"));
      items.push(line(ox, cy - objH, ix, cy + ih, "#8a94a3"));
      items.push(line(ix, cy, ix, cy + ih, "#be531a"), arrow(ix, cy + ih - 24, ix, cy + ih, "#be531a"));
      items.push(label(Math.min(340, ix - 8), cy + ih + 16, "实像 v=" + fmt(v, 3) + " · m=" + fmt(mag, 3)));
    } else {
      const dx = (cx - ox) * 0.8;
      items.push(line(ox, cy - objH, cx, cy - objH, "#b45e28"));
      items.push(line(cx, cy - objH, cx + dx, cy - objH - dx * objH / (f * scale), "#b45e28"));
      items.push(line(ox, cy - objH, cx + dx, cy + dx * objH / (u * scale), "#8a94a3"));
      items.push(line(cx, cy - objH, ix, cy - ih, "#b45e28", true));
      items.push(line(cx, cy, ix, cy - ih, "#8a94a3", true));
      items.push(line(ix, cy, ix, cy - ih, "#be531a", true), arrow(ix, cy - ih + 24, ix, cy - ih, "#be531a"));
      items.push(label(Math.max(24, ix - 26), cy - ih - 8, "虚像（正立放大）m=" + fmt(mag, 3)));
    }
  }
  items.push(label(24, 216, "1/f=1/u+1/v · f=" + fmt(f, 3) + " · " +
    (vFinite ? (real ? "u>f 倒立实像" : "u<f 正立放大虚像") : "u≈f 像距趋于无穷")));
  const curve = [];
  for (let i = 0; i <= 60; i++) {
    const uu = 10 + 150 * i / 60;
    curve.push(Math.max(-240, Math.min(240, uu * f / (uu - f))));
  }
  return { data: { u, f, v, mag, kind: vFinite ? (real ? "real" : "virtual") : "none" }, frames: [
    { title: "三条特殊光线成像", shapes: { viewBox: [400, 228], items },
      series: [{ label: "像距 v(u)", values: curve }],
      summary: "u=" + fmt(u, 3) + " → v=" + (vFinite ? fmt(v, 3) : "∞") + " · m=" + fmt(mag, 3) +
        " · 跨过 f 瞬间实像翻成虚像" },
  ] };
}`;

/* ============================== 第 9 章：分子动理论与热力学循环 ============================== */

/** 麦克斯韦速率分布 + 分子热运动盒：rand() 播种的确定性模拟。 */
export const maxwellRule = `function run({ params, upstream, rand }) {
  ${inScalar}
  ${dot}
  ${line}
  ${label}
  ${fmt}
  const tHot = Math.max(50, inV ?? params.tHot);
  const kb = 1.380649e-23, m = 4.65e-26;
  const a = Math.sqrt(kb * tHot / m), vp = a * Math.SQRT2, vrms = a * Math.sqrt(3);
  const dist = [];
  for (let i = 0; i <= 60; i++) {
    const v = i / 60 * 3 * vp;
    const f = v * v * Math.exp(-v * v / (2 * a * a));
    dist.push(f / (a * a * Math.exp(-1)) || 0);
  }
  const box = { x: 40, y: 30, w: 200, h: 130 };
  const parts = [];
  for (let i = 0; i < 34; i++) {
    const sp = a * Math.sqrt(2) * Math.sqrt(-Math.log(Math.max(1e-9, rand())));
    const ang = rand() * 2 * Math.PI;
    parts.push({ x: box.x + rand() * box.w, y: box.y + rand() * box.h, vx: sp * Math.cos(ang), vy: sp * Math.sin(ang) });
  }
  const frames = [];
  const dt = 0.006;
  for (let f = 0; f < 18; f++) {
    const items = [label(24, 16, "T=" + fmt(tHot, 4) + " K · 分子盒（点速 ∝ √T）"),
      { kind: "rect", x: box.x, y: box.y, w: box.w, h: box.h, fill: "none", stroke: "#68798c", rx: 4 }];
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < box.x + 4 || p.x > box.x + box.w - 4) p.vx = -p.vx;
      if (p.y < box.y + 4 || p.y > box.y + box.h - 4) p.vy = -p.vy;
      p.x = Math.max(box.x + 4, Math.min(box.x + box.w - 4, p.x));
      p.y = Math.max(box.y + 4, Math.min(box.y + box.h - 4, p.y));
      items.push(dot(p.x, p.y, "#285a96", 2.6));
    }
    items.push(label(258, 52, "vp=√(2kT/m)=" + fmt(vp, 4)));
    items.push(label(258, 72, "vrms=√(3kT/m)=" + fmt(vrms, 4)));
    items.push(label(258, 92, "T↑ → 峰右移变宽"));
    frames.push({ title: "分子热运动", shapes: { viewBox: [400, 190], items },
      summary: "T=" + fmt(tHot, 4) + "K · vp=" + fmt(vp, 4) + " m/s · vrms=" + fmt(vrms, 4) + " m/s" });
  }
  frames[0].series = [{ label: "麦克斯韦速率分布 f(v)", values: dist }];
  return { data: { tHot, vp, vrms }, frames };
}`;

/** 卡诺循环 P–V 闭合面积 = 净功，η=1−Tc/Th 与实测 Q/W 对账。 */
export const carnotAuditRule = `function run({ params, upstream }) {
  ${inScalar}
  ${line}
  ${dot}
  ${label}
  ${fmt}
  const tHot = Math.max(200, inV ?? params.tHot), tCold = Math.max(80, Math.min(tHot - 20, params.cold));
  const gamma = 1.4, comp = Math.max(1.2, params.r), nR = 1;
  const v1 = 1, v2 = v1 * comp, expo = 1 / (gamma - 1);
  const v3 = v2 * Math.pow(tHot / tCold, expo), v4 = v1 * Math.pow(tHot / tCold, expo);
  const st = (v, t) => ({ v, p: nR * t / v });
  const states = [st(v1, tHot), st(v2, tHot), st(v3, tCold), st(v4, tCold)];
  const w12 = nR * tHot * Math.log(v2 / v1), w34 = nR * tCold * Math.log(v4 / v3);
  const qH = w12, qC = -w34;
  const wNet = qH - qC, eta = 1 - tCold / tHot;
  const vMax = v3 * 1.04, pMax = Math.max(...states.map((s) => s.p)) * 1.1;
  const px = (v) => 34 + (v / vMax) * 340, py = (p) => 190 - (p / pMax) * 160;
  const seg = (a, b, iso) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const v = a.v + (b.v - a.v) * i / 20;
      const p = iso ? a.p * a.v / v : a.p * Math.pow(a.v / v, gamma);
      pts.push([px(v), py(p)]);
    }
    return pts;
  };
  const items = [line(34, 190, 380, 190, "#9aa7b5"), line(34, 30, 34, 190, "#9aa7b5"),
    label(368, 202, "V"), label(8, 40, "P"),
    { kind: "polygon", points: [...seg(states[0], states[1], true), ...seg(states[1], states[2], false),
      ...seg(states[2], states[3], true), ...seg(states[3], states[0], false)],
      fill: "#f3ddcf", stroke: "#b45e28", opacity: 0.35 }];
  const legs = [[0, 1, true, "#285a96"], [1, 2, false, "#21816a"], [2, 3, true, "#7253a5"], [3, 0, false, "#be531a"]];
  for (const [a, b, iso, color] of legs) {
    const pts = seg(states[a], states[b], iso);
    for (let i = 1; i < pts.length; i++) items.push(line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], color));
  }
  states.forEach((s, i) => items.push(dot(px(s.v), py(s.p), "#3b4757", 3.5)));
  items.push(label(24, 212, "蓝 等温Th · 绿 绝热 · 紫 等温Tc · 橙 绝热 · 闭合面积=W净"));
  return { data: { eta, work: wNet, heatIn: qH, heatOut: qC, ratio: wNet / qH, tHot, tCold }, frames: [
    { title: "卡诺循环 P–V 图", shapes: { viewBox: [400, 225], items },
      summary: "Th=" + fmt(tHot, 4) + "K Tc=" + fmt(tCold, 4) + "K · η=1−Tc/Th=" + fmt(eta, 4) +
        " · W净=" + fmt(wNet, 4) + "=Qh−Qc=" + fmt(qH, 4) + "−" + fmt(qC, 4) },
    { title: "热量与功对账", columns: ["量", "数值"], rows: [
      ["高温吸热 Qh", fmt(qH, 4)], ["低温放热 Qc", fmt(qC, 4)], ["净功 W=Qh−Qc", fmt(wNet, 4)],
      ["效率 η=1−Tc/Th", fmt(eta, 4)], ["实测 W/Qh", fmt(wNet / qH, 4)]],
      summary: "W/Qh 与卡诺效率一致；提高 Th 或降低 Tc 都提高效率" },
  ] };
}`;
