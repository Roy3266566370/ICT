/**
 * matrixOrder/scene.ts —— S10「乘法顺序：先转后拉 / 先拉后转」的纯计算与标注布局。
 *
 * 施工依据：docs/rebuild-spec.md §4（区域 / 坐标）、§7（视觉与线宽）、§7.1（标注防遮挡）、
 * §9（S10：两条路径同步播放，现场必须看到"先转后拉 / 先拉后转"的差别）。
 *
 * 分工：本文件不依赖 React / DOM，SSR（`react-dom/server`）可直接调用；
 * 渲染与参数面板在 `index.tsx`。
 *
 * 教学语义（§9「组合变换分两步；不得把任意系数的插值解释成运算过程」）：
 *  - 路径 1「先执行 B，再执行 A」：x → Bx（中间态）→ A(Bx)（结果）
 *  - 路径 2「先执行 A，再执行 B」：x → Ax（中间态）→ B(Ax)（结果）
 *  中间态一律由**真实的一步矩阵作用**得到（`applyMatrix`），不做插值近似。
 *
 * 坐标：`region.coordinate_system` 给出 viewBox / origin / unit / y 轴方向。
 * 本组件在同一 viewBox 内并排两个面板，两面板共用同一 `unit`（等比、可比），
 * 但各自的数学原点居中排布——宿主缩放只改容器尺寸，不改内部坐标（§5）。
 */
import type { RegionCoordinateSystem } from '@/regions/types';

export type Vec2 = [number, number];

/** 2×2 矩阵（按行存放，避免二维数组的索引歧义）。 */
export interface Mat2 {
  a11: number;
  a12: number;
  a21: number;
  a22: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 参数允许范围与步长（与 C-MX@1 规则 7 一致：-3..3，步长 0.1）。 */
export const PARAM_MIN = -3;
export const PARAM_MAX = 3;
export const PARAM_STEP = 0.1;

export const EPS = 1e-9;

/** `region.coordinate_system` 缺失/非法时的兜底（与 spec §4 / prototype 一致）。 */
export const DEFAULT_CS: RegionCoordinateSystem = {
  view_box: [1920, 1350],
  origin: [640, 770],
  unit: 150,
  y_axis: 'up',
};

/** 页内原值：A 是先拉后转的剪切，B 是先转后拉的剪切，两者不可交换。 */
export const DEFAULT_A: Mat2 = { a11: 1, a12: 1, a21: 0, a22: 1 };
export const DEFAULT_B: Mat2 = { a11: 1, a12: 0, a21: 1, a22: 1 };
export const DEFAULT_INPUT: Vec2 = [1, 1];

export interface OrderParams {
  A: Mat2;
  B: Mat2;
  x: Vec2;
  /**
   * 步骤的中文注解（如 `旋转 90°` / `沿 x 拉伸 ×2`）。
   * 来自 region.original_params.steps；读不到时为空串，界面只显示 A / B。
   */
  labelA: string;
  labelB: string;
}

export const DEFAULT_PARAMS: OrderParams = {
  A: DEFAULT_A,
  B: DEFAULT_B,
  x: DEFAULT_INPUT,
  labelA: '',
  labelB: '',
};

/* -------------------------------------------------------------------------- */
/* 参数读取（容错：任何字段缺失 / 非法都退回 fallback，绝不抛异常）             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 读取 `unknown` 数组的第 index 项（`noUncheckedIndexedAccess` 下的安全访问）。 */
function item(values: readonly unknown[], index: number): unknown {
  return index >= 0 && index < values.length ? values[index] : undefined;
}

/** 把 `unknown` 读成有限数，否则 null。 */
function readFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 把二维数组 / `{a11..a22}` 对象读成 `Mat2`；不合法返回 null。 */
function readMatrixCandidate(value: unknown): Mat2 | null {
  if (Array.isArray(value)) {
    const rows: unknown[] = value;
    const row0 = item(rows, 0);
    const row1 = item(rows, 1);
    if (Array.isArray(row0) && Array.isArray(row1)) {
      const cells: unknown[] = [item(row0, 0), item(row0, 1), item(row1, 0), item(row1, 1)];
      const a11 = readFinite(cells[0]);
      const a12 = readFinite(cells[1]);
      const a21 = readFinite(cells[2]);
      const a22 = readFinite(cells[3]);
      if (a11 !== null && a12 !== null && a21 !== null && a22 !== null) {
        return { a11, a12, a21, a22 };
      }
    }
    return null;
  }
  if (isRecord(value)) {
    const record = value;
    if (['a11', 'a12', 'a21', 'a22'].every((key) => typeof record[key] === 'number')) {
      return {
        a11: num(record['a11'], 0),
        a12: num(record['a12'], 0),
        a21: num(record['a21'], 0),
        a22: num(record['a22'], 0),
      };
    }
  }
  return null;
}

function readVec2(value: unknown, fallback: Vec2): Vec2 {
  if (Array.isArray(value)) {
    const values: unknown[] = value;
    const [x, y] = [item(values, 0), item(values, 1)];
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }
  return [fallback[0], fallback[1]];
}

/**
 * 读取矩阵参数：优先 `params.A`（二维数组或 `{a11..}`），
 * 其次扁平字段 `a11..a22`（参数抽屉写单个元素时用这种形状）。
 */
function readMat2(
  params: Record<string, unknown>,
  nestedKey: 'A' | 'B',
  flatPrefix: 'a' | 'b',
  fallback: Mat2,
): Mat2 {
  const nested = readMatrixCandidate(params[nestedKey]);
  if (nested !== null) return nested;
  const flatKeys = [`${flatPrefix}11`, `${flatPrefix}12`, `${flatPrefix}21`, `${flatPrefix}22`] as const;
  if (flatKeys.some((key) => typeof params[key] === 'number')) {
    return {
      a11: num(params[flatKeys[0]], fallback.a11),
      a12: num(params[flatKeys[1]], fallback.a12),
      a21: num(params[flatKeys[2]], fallback.a21),
      a22: num(params[flatKeys[3]], fallback.a22),
    };
  }
  return { ...fallback };
}

function readName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 从 `params.steps.<key>.matrix` 读一个步骤矩阵（S10 真实产物用 rotate / stretch）。 */
function readStepMatrix(steps: unknown, key: string | null): Mat2 | null {
  if (key === null || !isRecord(steps)) return null;
  const step = steps[key];
  if (!isRecord(step)) return null;
  return readMatrixCandidate(step['matrix']);
}

/**
 * 读步骤的中文注解：
 *  - 旋转类步骤有 `angle_deg` → `旋转 90°`；
 *  - 拉伸类步骤有 `factor_x` / `factor_y` → `沿 x 拉伸 ×2` / `沿 x ×2、沿 y ×0.5`。
 * 读不到返回空串（不伪造说明）。
 */
function readStepLabel(steps: unknown, key: string | null): string {
  if (key === null || !isRecord(steps)) return '';
  const step = steps[key];
  if (!isRecord(step)) return '';
  const angle = step['angle_deg'];
  if (typeof angle === 'number' && Number.isFinite(angle)) return `旋转 ${fmt(angle)}°`;
  const factorX = step['factor_x'];
  const factorY = step['factor_y'];
  const hasX = typeof factorX === 'number' && Number.isFinite(factorX);
  const hasY = typeof factorY === 'number' && Number.isFinite(factorY);
  if (hasX && hasY) {
    // 只标注真正改变的方向；两个方向都变才逐一列出
    const xChanged = Math.abs(factorX - 1) > EPS;
    const yChanged = Math.abs(factorY - 1) > EPS;
    if (xChanged && yChanged) return `沿 x ×${fmt(factorX)}、沿 y ×${fmt(factorY)}`;
    if (xChanged) return `沿 x 拉伸 ×${fmt(factorX)}`;
    if (yChanged) return `沿 y 拉伸 ×${fmt(factorY)}`;
    return '';
  }
  if (hasX) return `沿 x 拉伸 ×${fmt(factorX)}`;
  if (hasY) return `沿 y 拉伸 ×${fmt(factorY)}`;
  return '';
}

/**
 * 读取两条路径的两个矩阵与输入向量。
 *
 * 支持三种形状（从具体到通用）：
 * 1. `{ A: [[..]], B: [[..]] }` 或扁平 `{a11..a22, b11..b22, x}`；
 * 2. 真实产物 `{probe, steps:{rotate,stretch}, sequences:[[rotate,stretch],[stretch,rotate]]}`
 *    —— 第 1 条序列的第一、二步分别就是"路径 1 的 B / A"（先 B 后 A），因此
 *    B = steps[sequences[0][0]]（旋转），A = steps[sequences[0][1]]（拉伸）；
 * 3. 缺省 → 组件默认 A / B。
 */
export function readParams(
  params: Record<string, unknown>,
  fallback: OrderParams = DEFAULT_PARAMS,
): OrderParams {
  const steps = params['steps'];
  const sequences = params['sequences'];
  const sequence = Array.isArray(sequences) ? sequences[0] : undefined;
  const nameFirst = Array.isArray(sequence) ? readName(item(sequence, 0)) : null;
  const nameSecond = Array.isArray(sequence) ? readName(item(sequence, 1)) : null;
  const stepB = readStepMatrix(steps, nameFirst);
  const stepA = readStepMatrix(steps, nameSecond);

  const labelB = readName(params['label_B']) ?? readStepLabel(steps, nameFirst) ?? '';
  const labelA = readName(params['label_A']) ?? readStepLabel(steps, nameSecond) ?? '';

  return {
    A: readMat2(params, 'A', 'a', stepA ?? { ...fallback.A }),
    B: readMat2(params, 'B', 'b', stepB ?? { ...fallback.B }),
    x: readVec2(params['probe'] ?? params['x'] ?? params['vector_x'] ?? params['vector'], fallback.x),
    labelA: labelA || fallback.labelA,
    labelB: labelB || fallback.labelB,
  };
}

/** 校验并归一 `coordinate_system`；任何异常字段退回兜底值。 */
export function readCoordinateSystem(raw: unknown): RegionCoordinateSystem {
  if (!isRecord(raw)) return { ...DEFAULT_CS, view_box: [...DEFAULT_CS.view_box], origin: [...DEFAULT_CS.origin] };
  const viewBox = Array.isArray(raw['view_box']) ? raw['view_box'] : [];
  const origin = Array.isArray(raw['origin']) ? raw['origin'] : [];
  const width = num(item(viewBox, 0), DEFAULT_CS.view_box[0]);
  const height = num(item(viewBox, 1), DEFAULT_CS.view_box[1]);
  const originX = num(item(origin, 0), DEFAULT_CS.origin[0]);
  const originY = num(item(origin, 1), DEFAULT_CS.origin[1]);
  return {
    view_box: [width > 0 ? width : DEFAULT_CS.view_box[0], height > 0 ? height : DEFAULT_CS.view_box[1]],
    origin: [originX, originY],
    unit: num(raw['unit'], DEFAULT_CS.unit) > 0 ? num(raw['unit'], DEFAULT_CS.unit) : DEFAULT_CS.unit,
    y_axis: raw['y_axis'] === 'down' ? 'down' : 'up',
  };
}

/* -------------------------------------------------------------------------- */
/* 数值与文本                                                                 */
/* -------------------------------------------------------------------------- */

/** 去掉浮点尾差与 `-0`，最多保留 3 位小数；非有限数显示 "—"。 */
export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—';
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (Math.abs(rounded) < 1e-12) return '0';
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/** `(2, 1)` 形式的向量文本（与原页标注习惯一致）。 */
export function vecText(vector: Vec2): string {
  return `(${fmt(vector[0])}, ${fmt(vector[1])})`;
}

export function matText(matrix: Mat2): string {
  return `[[${fmt(matrix.a11)}, ${fmt(matrix.a12)}], [${fmt(matrix.a21)}, ${fmt(matrix.a22)}]]`;
}

/**
 * 是否偏离原值（决定宿主是否把原位文字标成"当前值"）。
 * 容差 1e-9：滑块步长 0.1，任何一次真实改动都远超该阈值。
 */
export function isOffOriginal(current: OrderParams, original: OrderParams): boolean {
  const pairs: Array<[number, number]> = [
    [current.A.a11, original.A.a11],
    [current.A.a12, original.A.a12],
    [current.A.a21, original.A.a21],
    [current.A.a22, original.A.a22],
    [current.B.a11, original.B.a11],
    [current.B.a12, original.B.a12],
    [current.B.a21, original.B.a21],
    [current.B.a22, original.B.a22],
    [current.x[0], original.x[0]],
    [current.x[1], original.x[1]],
  ];
  return pairs.some(([left, right]) => Math.abs(left - right) > EPS);
}

/** 占位符替换：`"{a} → {b}"` + `{a:'1'}` → `"1 → {b}"`（未提供的占位符原样保留）。 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    const replacement = values[key];
    return replacement === undefined ? whole : replacement;
  });
}

/* -------------------------------------------------------------------------- */
/* 线性代数（只用到 2×2 乘向量）                                               */
/* -------------------------------------------------------------------------- */

/** `M·v`：按行点乘，`(a11·x + a12·y, a21·x + a22·y)`。 */
export function applyMatrix(matrix: Mat2, vector: Vec2): Vec2 {
  return [
    matrix.a11 * vector[0] + matrix.a12 * vector[1],
    matrix.a21 * vector[0] + matrix.a22 * vector[1],
  ];
}

/* -------------------------------------------------------------------------- */
/* 两条路径                                                                   */
/* -------------------------------------------------------------------------- */

export interface PathView {
  /** 路径标识：先 B 后 A / 先 A 后 B。 */
  id: 'b_then_a' | 'a_then_b';
  /** 面向读者的顺序说明（不写 AB/BA 符号糊弄）；只写两个符号，保证面板标题不跨列。 */
  orderText: string;
  /** 顺序注解（如 `B：旋转 90°　A：沿 x 拉伸 ×2`），无注解时为空串。 */
  orderDetail: string;
  /** 中间态符号，如 `Bx`。 */
  intermediateSymbol: string;
  /** 结果表达式，如 `A(Bx)`。 */
  resultExpression: string;
  /** 输入向量 x。 */
  input: Vec2;
  /** 第一步之后（中间态）。 */
  intermediate: Vec2;
  /** 第二步之后（结果）。 */
  result: Vec2;
}

/**
 * 计算两条路径。
 * 注意 `A(Bx)` 的语义是「先用 B，再用 A」，与矩阵乘积 `AB` 的"先执行 B"一致；
 * 这里不显示 `AB/BA`，只显示真实的两步结果。
 */
export function computePaths(params: OrderParams): [PathView, PathView] {
  const { A, B, x } = params;
  const bx = applyMatrix(B, x);
  const ax = applyMatrix(A, x);
  const suffixA = params.labelA.length > 0 ? `（${params.labelA}）` : '';
  const suffixB = params.labelB.length > 0 ? `（${params.labelB}）` : '';
  return [
    {
      id: 'b_then_a',
      orderText: '先执行 B，再执行 A',
      orderDetail: params.labelB.length > 0 || params.labelA.length > 0
        ? `B${suffixB}　A${suffixA}`
        : '',
      intermediateSymbol: 'Bx',
      resultExpression: 'A(Bx)',
      input: [x[0], x[1]],
      intermediate: bx,
      result: applyMatrix(A, bx),
    },
    {
      id: 'a_then_b',
      orderText: '先执行 A，再执行 B',
      orderDetail: params.labelA.length > 0 || params.labelB.length > 0
        ? `A${suffixA}　B${suffixB}`
        : '',
      intermediateSymbol: 'Ax',
      resultExpression: 'B(Ax)',
      input: [x[0], x[1]],
      intermediate: ax,
      result: applyMatrix(B, ax),
    },
  ];
}

/** 两条路径结果是否一致（A、B 可交换时成立；用于给出"此参数下恰好相同"的说明）。 */
export function resultsAgree(paths: readonly [PathView, PathView]): boolean {
  const [first, second] = paths;
  return (
    Math.abs(first.result[0] - second.result[0]) <= EPS &&
    Math.abs(first.result[1] - second.result[1]) <= EPS
  );
}

/* -------------------------------------------------------------------------- */
/* 几何布局                                                                   */
/* -------------------------------------------------------------------------- */

export interface PanelGeometry {
  /** 面板数学原点在 SVG 中的像素坐标。 */
  cx: number;
  cy: number;
  /** 1 个数学单位对应的像素数（两面板共用，保证可比）。 */
  unit: number;
  /** 轴半宽 / 向上、向下的可用像素长度。 */
  axisHalf: number;
  axisUp: number;
  axisDown: number;
  /** 刻度步长（保证刻度数字间距 ≥ 46px）。 */
  tickStep: number;
}

/** 数学坐标 → 面板内像素坐标（y 轴方向由 coordinate_system 决定）。 */
export function project(
  geometry: PanelGeometry,
  yAxis: 'up' | 'down',
  point: Vec2,
): Point {
  const sign = yAxis === 'up' ? -1 : 1;
  return {
    x: geometry.cx + point[0] * geometry.unit,
    y: geometry.cy + sign * point[1] * geometry.unit,
  };
}

/**
 * 两个面板的几何：并排、共用 unit。
 * unit 由"所有要画的向量的最大分量"反推，保证任何参数组合都不出 viewBox；
 * 上限取 `coordinate_system.unit`（默认 150），避免默认参数下图形过大。
 */
export function buildGeometry(
  paths: readonly [PathView, PathView],
  cs: RegionCoordinateSystem,
): [PanelGeometry, PanelGeometry] {
  const [width, height] = cs.view_box;
  let maxAbs = 0.8;
  for (const path of paths) {
    for (const point of [path.input, path.intermediate, path.result]) {
      maxAbs = Math.max(maxAbs, Math.abs(point[0]), Math.abs(point[1]));
    }
  }
  // 纵向基线沿用契约 origin.y，但不贴边（给标题与底部说明留空间）
  const cy = Math.min(height - 320, Math.max(430, cs.origin[1]));
  const axisHalf = Math.min(380, width * 0.185);
  const axisUp = Math.min(430, cy - 250);
  const axisDown = Math.min(430, height - cy - 130);
  const unit = Math.min(cs.unit, axisHalf / maxAbs, Math.min(axisUp, axisDown) / maxAbs);
  const safeUnit = unit > 8 ? unit : 8;
  const tickStep = Math.max(1, Math.ceil(46 / safeUnit));
  const centers: Array<number> = [width * 0.26, width * 0.74];
  const cx0 = centers[0] ?? width * 0.26;
  const cx1 = centers[1] ?? width * 0.74;
  return [
    { cx: cx0, cy, unit: safeUnit, axisHalf, axisUp, axisDown, tickStep },
    { cx: cx1, cy, unit: safeUnit, axisHalf, axisUp, axisDown, tickStep },
  ];
}

/* -------------------------------------------------------------------------- */
/* 标注布局（spec §7.1：不得出界、不得互相重叠）                               */
/* -------------------------------------------------------------------------- */

export interface LabelItem {
  id: string;
  text: string;
  /** 期望锚点（碰撞消解后会微调 y）。 */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fontSize: number;
  fill: string;
  weight: number;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 估算文本宽度：CJK 按 1em，其余按 0.56em（偏保守，宁可留白也不要重叠）。 */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.56;
  }
  return units * fontSize;
}

function boxOf(label: LabelItem): LabelBox {
  const width = textWidth(label.text, label.fontSize);
  const height = label.fontSize * 1.2;
  const left =
    label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;
  return { left, right: left + width, top: label.y - label.fontSize, bottom: label.y - label.fontSize + height };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 碰撞消解：按优先级（调用方给的顺序）逐个放置，冲突时沿 y 方向试探偏移。
 * 所有标签先被夹到 viewBox 内（留 10px 边距），因此不会出界。
 */
export function resolveLabelCollisions(
  labels: readonly LabelItem[],
  viewBox: [number, number],
): LabelItem[] {
  const [width, height] = viewBox;
  const margin = 10;
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, -32],
    [0, 32],
    [0, -64],
    [0, 64],
    [0, -96],
    [0, 96],
  ];
  const placed: LabelBox[] = [];
  const result: LabelItem[] = [];
  for (const label of labels) {
    const anchorWidth = textWidth(label.text, label.fontSize);
    const half = label.anchor === 'middle' ? anchorWidth / 2 : 0;
    const minX = margin + (label.anchor === 'end' ? anchorWidth : half);
    const maxX = width - margin - (label.anchor === 'start' ? anchorWidth : half);
    let best: LabelItem | null = null;
    for (const [dx, dy] of offsets) {
      const candidate: LabelItem = {
        ...label,
        x: Math.min(Math.max(label.x + dx, minX), Math.max(minX, maxX)),
        y: Math.min(Math.max(label.y + dy, label.fontSize + margin), height - margin),
      };
      const box = boxOf(candidate);
      if (!placed.some((other) => overlaps(box, other))) {
        best = candidate;
        break;
      }
    }
    const finalLabel = best ?? {
      ...label,
      x: Math.min(Math.max(label.x, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(label.y, label.fontSize + margin), height - margin),
    };
    placed.push(boxOf(finalLabel));
    result.push(finalLabel);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 原位文字                                                                   */
/* -------------------------------------------------------------------------- */

export interface LinkedTextDraft {
  element_id: string;
  text: string;
  changed: boolean;
}

export interface LinkedTextInput {
  element_id: string;
  template: string;
  kind: 'result' | 'hint';
}

/**
 * 生成要回传宿主的原位文字（§8）：`A(Bx) = (3, 1)` / `B(Ax) = (2, 3)`。
 *
 * 覆盖规则：
 *  - 逐条取 `linked_texts` 中 `kind === 'result'` 的元素，按顺序对应路径 1 / 路径 2；
 *  - 若模板含占位符，则只替换已知键（`abx` / `bax` / `x0..y1` 等），未知占位符原样保留，
 *    此时宿主按契约不会覆盖原页（types.ts 注释），不会产生错字；
 *  - 页面未给出 result 元素时，用稳定的虚拟 element_id 回传，宿主匹配不到即忽略。
 */
export function buildLinkedTexts(
  linkedTexts: readonly LinkedTextInput[],
  paths: readonly [PathView, PathView],
  changed: boolean,
): LinkedTextDraft[] {
  const first = paths[0];
  const second = paths[1];
  const values: Record<string, string> = {
    abx: vecText(first.result),
    A_Bx: vecText(first.result),
    bax: vecText(second.result),
    B_Ax: vecText(second.result),
    bx: vecText(first.intermediate),
    ax: vecText(second.intermediate),
    x0: fmt(first.input[0]),
    y0: fmt(first.input[1]),
    x1: fmt(first.result[0]),
    y1: fmt(first.result[1]),
    u0: fmt(second.result[0]),
    v0: fmt(second.result[1]),
    order1: first.orderText,
    order2: second.orderText,
  };
  const defaults: Array<[string, string]> = [
    ['s10_path_b_then_a', `${first.resultExpression} = ${vecText(first.result)}`],
    ['s10_path_a_then_b', `${second.resultExpression} = ${vecText(second.result)}`],
  ];
  /** 模板里出现这些占位符，才说明它是一份"可代入"的模板，否则用组件自带文案。 */
  const placeholderPattern = /\{(abx|A_Bx|bax|B_Ax|bx|ax|x0|y0|x1|y1|u0|v0|order1|order2)\}/;
  const resultElements = linkedTexts.filter((item) => item.kind === 'result');
  const drafts: LinkedTextDraft[] = [];
  for (let index = 0; index < defaults.length; index += 1) {
    const fallback = defaults[index];
    if (fallback === undefined) continue;
    const [fallbackId, fallbackText] = fallback;
    const element = resultElements[index];
    if (element === undefined) {
      drafts.push({ element_id: fallbackId, text: fallbackText, changed });
      continue;
    }
    const filled = placeholderPattern.test(element.template)
      ? fillTemplate(element.template, values)
      : fallbackText;
    drafts.push({
      element_id: element.element_id,
      text: filled.includes('{') ? fallbackText : filled,
      changed,
    });
  }
  return drafts;
}