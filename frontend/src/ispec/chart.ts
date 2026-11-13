/**
 * chart.ts —— 图表/几何视图共用的纯数学工具（坐标映射、刻度、带状布局、SVG 路径）。
 *
 * 设计约束：
 *  - 不依赖 DOM / React，可在 SSR 自检里直接调用；
 *  - 全部返回具体类型（`Vec2` 而不是 `number[]`），禁止 `any`；
 *  - 视图层只负责把这里算出的坐标拼成 SVG，不在组件里做数学。
 */

export type Vec2 = readonly [number, number];

export interface PlotArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MathBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface NumericDomain {
  min: number;
  max: number;
}

/** 把 min/max 规整成可用于绘图的区间：含零时强制跨零，零宽区间自动加边距。 */
export function paddingDomain(min: number, max: number, includeZero: boolean): NumericDomain {
  let low = includeZero ? Math.min(0, min) : min;
  let high = includeZero ? Math.max(0, max) : max;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    low = 0;
    high = 1;
  }
  if (high - low < 1e-9) {
    const padding = Math.max(1, Math.abs(high) * 0.5);
    low -= padding;
    high += padding;
  }
  return { min: low, max: high };
}

/** 「好看」的刻度：步长取 1 / 2 / 5 × 10^n。 */
export function niceTicks(domain: NumericDomain, count = 5): number[] {
  const span = domain.max - domain.min;
  if (!(span > 0)) return [];
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  const step = factor * magnitude;
  const ticks: number[] = [];
  const start = Math.ceil(domain.min / step) * step;
  for (let value = start; value <= domain.max + step * 1e-6 && ticks.length < 20; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** 线性映射：domain → [from, to]（可反向，用于 y 轴翻转）。 */
export function linearScale(
  domain: NumericDomain,
  from: number,
  to: number,
): (value: number) => number {
  const span = domain.max - domain.min;
  if (!(Math.abs(span) > 1e-12)) return () => (from + to) / 2;
  return (value: number) => from + ((value - domain.min) / span) * (to - from);
}

export interface BandLayout {
  /** 每个分类占据的宽度（含间隔） */
  step: number;
  /** 柱宽 */
  bandwidth: number;
  /** 第 index 个分类的中心像素位置 */
  center: (index: number) => number;
}

/** 分类轴：把 count 个分类均匀铺在 [start, end] 上。 */
export function bandLayout(count: number, start: number, end: number): BandLayout {
  const span = end - start;
  const step = count > 0 ? span / count : 0;
  return {
    step,
    bandwidth: step * 0.62,
    center: (index: number) => start + step * (index + 0.5),
  };
}

/**
 * 数学坐标 → SVG 像素的投影函数（y 轴向上）。
 * 保持等比（`preserveAspectRatio` 的语义），图形不会被拉伸。
 */
export function createProjector(area: PlotArea, bounds: MathBounds): (x: number, y: number) => Vec2 {
  const width = Math.max(1e-9, bounds.xMax - bounds.xMin);
  const height = Math.max(1e-9, bounds.yMax - bounds.yMin);
  const scale = Math.min(area.w / width, area.h / height);
  const offsetX = area.x + (area.w - width * scale) / 2 - bounds.xMin * scale;
  const offsetY = area.y + (area.h - height * scale) / 2 + bounds.yMax * scale;
  return (x: number, y: number): Vec2 => [offsetX + x * scale, offsetY - y * scale];
}

/** 点集转 SVG path（`close` 为 true 时闭合）。 */
export function svgPath(points: readonly Vec2[], close = false): string {
  if (points.length === 0) return '';
  const body = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(2)},${point[1].toFixed(2)}`)
    .join(' ');
  return close ? `${body} Z` : body;
}

/* -------------------------------------------------------------------------- */
/* 标注布局（SSR 安全：不依赖 getBBox，只用字宽估算）                          */
/* -------------------------------------------------------------------------- */

export type TextAnchor = 'start' | 'middle' | 'end';

/** 标注语义色板：具体颜色由视图层 CSS 决定，这里只负责可读的 tone 名。 */
export type LabelTone =
  | 'primary'
  | 'ghost'
  | 'image'
  | 'scale'
  | 'merged'
  | 'meta'
  | 'tick'
  | 'panel';

export interface LabelAlternative {
  x: number;
  y: number;
  anchor?: TextAnchor;
}

/**
 * 一个待布局的文字标注。
 *
 * `priority` 越小越重要（1 = 必须显示）。冲突时的降级顺序由 `layoutLabels` 统一执行：
 * 先在候选位置里换位，仍失败则隐藏低优先级标注（刻度数字 priority 最高值 5）。
 */
export interface LabelRequest {
  id: string;
  text: string;
  /** 基线坐标（与 SVG `<text>` 的 x / y 一致）。 */
  x: number;
  y: number;
  fontSize: number;
  anchor?: TextAnchor;
  tone?: LabelTone;
  priority?: number;
  /** true 时视图层会给文字加 `#F6F3EC` 描边，避免压在线上。 */
  background?: boolean;
  alternatives?: readonly LabelAlternative[];
}

export interface PlacedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  anchor: TextAnchor;
  tone: LabelTone;
  background: boolean;
}

export interface RectArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 字宽估算（CJK 按 1em、拉丁/数字按 0.58em、空格 0.32em）。
 * 故意略微偏宽：宁可让标注提前换位，也不要在 SSR 里压线。
 */
export function measureText(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x20) {
      units += 0.32;
    } else if (code >= 0x2e80) {
      units += 1;
    } else if ('.,:;()[]{}|'.includes(char)) {
      units += 0.34;
    } else if (char === '-' || char === '×' || char === '·') {
      units += 0.45;
    } else {
      units += 0.58;
    }
  }
  return units * fontSize;
}

function labelBox(text: string, x: number, y: number, fontSize: number, anchor: TextAnchor): LabelBox {
  const width = measureText(text, fontSize);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  const ascender = fontSize * 0.86;
  const descender = fontSize * 0.26;
  return { left, top: y - ascender, right: left + width, bottom: y + descender };
}

function inflate(box: LabelBox, amount: number): LabelBox {
  return {
    left: box.left - amount,
    top: box.top - amount,
    right: box.right + amount,
    bottom: box.bottom + amount,
  };
}

function boxInside(box: LabelBox, area: RectArea, margin: number): boolean {
  return (
    Number.isFinite(box.left) &&
    Number.isFinite(box.top) &&
    box.left >= area.x + margin &&
    box.right <= area.x + area.w - margin &&
    box.top >= area.y + margin &&
    box.bottom <= area.y + area.h - margin
  );
}

function boxesOverlap(first: LabelBox, second: LabelBox): boolean {
  return !(
    first.right <= second.left ||
    first.left >= second.right ||
    first.bottom <= second.top ||
    first.top >= second.bottom
  );
}

/**
 * 标注布局：按优先级依次放置，主位置失败时尝试 `alternatives`；
 * 仍放不下则隐藏（priority ≤ 1 的标注不允许隐藏，会夹回区域内）。
 * 返回顺序与入参一致，视图层可以直接 map 成 `<text>`。
 */
export function layoutLabels(requests: readonly LabelRequest[], area: RectArea): PlacedLabel[] {
  const sorted = requests
    .map((request, index) => ({ request, index }))
    .sort(
      (first, second) =>
        (first.request.priority ?? 3) - (second.request.priority ?? 3) || first.index - second.index,
    );

  const occupied: LabelBox[] = [];
  const placedByIndex = new Map<number, PlacedLabel>();

  for (const { request, index } of sorted) {
    const anchorDefault = request.anchor ?? 'start';
    const candidates: LabelAlternative[] = [
      { x: request.x, y: request.y, anchor: anchorDefault },
      ...(request.alternatives ?? []),
    ];

    let chosen: { x: number; y: number; anchor: TextAnchor; box: LabelBox } | null = null;
    for (const candidate of candidates) {
      const anchor = candidate.anchor ?? anchorDefault;
      const raw = labelBox(request.text, candidate.x, candidate.y, request.fontSize, anchor);
      const box = inflate(raw, 1.5);
      if (!boxInside(box, area, 1)) continue;
      if (occupied.some((other) => boxesOverlap(other, box))) continue;
      chosen = { x: candidate.x, y: candidate.y, anchor, box };
      break;
    }

    const priority = request.priority ?? 3;
    if (chosen === null) {
      if (priority > 1) continue;
      // 最高优先级：夹回区域，宁可略微压线也不能让关键结论消失。
      let x = request.x;
      let y = request.y;
      const raw = labelBox(request.text, x, y, request.fontSize, anchorDefault);
      if (raw.right > area.x + area.w - 1) x -= raw.right - (area.x + area.w - 1);
      if (raw.left < area.x + 1) x += area.x + 1 - raw.left;
      if (raw.bottom > area.y + area.h - 1) y -= raw.bottom - (area.y + area.h - 1);
      if (raw.top < area.y + 1) y += area.y + 1 - raw.top;
      chosen = {
        x,
        y,
        anchor: anchorDefault,
        box: inflate(labelBox(request.text, x, y, request.fontSize, anchorDefault), 1.5),
      };
    }

    occupied.push(chosen.box);
    placedByIndex.set(index, {
      id: request.id,
      text: request.text,
      x: chosen.x,
      y: chosen.y,
      fontSize: request.fontSize,
      anchor: chosen.anchor,
      tone: request.tone ?? 'primary',
      background: request.background ?? false,
    });
  }

  return requests
    .map((_request, index) => placedByIndex.get(index))
    .filter((label): label is PlacedLabel => label !== undefined);
}

/* -------------------------------------------------------------------------- */
/* 自适应视域与线段裁剪                                                        */
/* -------------------------------------------------------------------------- */

export interface BoundsOptions {
  /** 四周额外留白（数学单位）。 */
  padding?: number;
  /** 最小跨度，避免单点图形被放大到失真。 */
  minSpan?: number;
}

/**
 * 用一组点（通常包含原点）拟合对称视域：长边决定跨度，短边同样居中。
 * 这样参数取极值时图形不会被 viewBox 裁掉，默认参数下也不会贴边。
 */
export function boundsFromPoints(points: readonly Vec2[], options: BoundsOptions = {}): MathBounds {
  const padding = options.padding ?? 0.6;
  const minSpan = options.minSpan ?? 4;
  // 初值取原点：无论传入什么点集，原点（以及从原点出发的向量）都必须在视域内。
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const point of points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  const span = Math.max(maxX - minX, maxY - minY, minSpan);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const half = span / 2 + padding;
  return {
    xMin: centerX - half,
    xMax: centerX + half,
    yMin: centerY - half,
    yMax: centerY + half,
  };
}

/** 屏幕（SVG）坐标下的单位方向；长度过小时返回 null。 */
export function unitDirection(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return [dx / length, dy / length];
}

export interface ClippedSegment {
  point: Vec2;
  clipped: boolean;
}

/**
 * 把从 `from` 出发的线段裁到矩形内（Liang–Barsky）。
 * 向量端点跑出画布时用裁剪后的点画箭头，避免箭头浮在区域外。
 */
export function clipSegmentToRect(
  from: Vec2,
  to: Vec2,
  area: RectArea,
  inset = 0,
): ClippedSegment {
  const minX = area.x + inset;
  const maxX = area.x + area.w - inset;
  const minY = area.y + inset;
  const maxY = area.y + area.h - inset;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let enter = 0;
  let exit = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [from[0] - minX, maxX - from[0], from[1] - minY, maxY - from[1]];
  for (let index = 0; index < 4; index += 1) {
    const pValue = p[index] ?? 0;
    const qValue = q[index] ?? 0;
    if (Math.abs(pValue) < 1e-12) {
      if (qValue < 0) return { point: from, clipped: true };
      continue;
    }
    const ratio = qValue / pValue;
    if (pValue < 0) {
      if (ratio > exit) return { point: from, clipped: true };
      if (ratio > enter) enter = ratio;
    } else {
      if (ratio < enter) return { point: from, clipped: true };
      if (ratio < exit) exit = ratio;
    }
  }
  const point: Vec2 = [from[0] + dx * exit, from[1] + dy * exit];
  return { point, clipped: exit < 1 - 1e-9 };
}

/** 箭头头部（三角形）路径；起止点重合时返回空串，避免出现无意义的图形。 */
export function arrowHeadPath(from: Vec2, to: Vec2, size = 9): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return '';
  const ux = dx / length;
  const uy = dy / length;
  const baseX = to[0] - ux * size;
  const baseY = to[1] - uy * size;
  const halfWidth = size * 0.42;
  const leftX = baseX - uy * halfWidth;
  const leftY = baseY + ux * halfWidth;
  const rightX = baseX + uy * halfWidth;
  const rightY = baseY - ux * halfWidth;
  return `M${to[0].toFixed(2)},${to[1].toFixed(2)} L${leftX.toFixed(2)},${leftY.toFixed(2)} L${rightX.toFixed(2)},${rightY.toFixed(2)} Z`;
}

/** 截断过长的分类标签（保留完整内容作为 `title` 提示）。 */
export function truncateLabel(label: string, maxLength = 8): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}