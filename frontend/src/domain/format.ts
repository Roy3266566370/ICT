/**
 * format.ts —— 数值格式化与容差工具（纯函数，无副作用）
 *
 * 精度约定（plan §2.3.6）：
 *  - 矩阵与力：比较容差 1e-9
 *  - rank：1e-12
 *  - 金额：由 budget.ts 的定点十进制实现，禁用二进制浮点
 */

/** 通用比较容差（矩阵、力） */
export const EPSILON = 1e-9;
/** rank / 可逆性判定用的更小容差 */
export const RANK_EPSILON = 1e-12;

/**
 * 四舍五入到 digits 位小数，并把 `-0` 归一为 `0`。
 * 用于满足 §2.2.3「结果按 round(v, 10) 归一，避免 -0」。
 */
export function round(value: number, digits = 10): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** 把浮点噪声量级的值压成 0，避免表格里出现 `-1.2e-16`。 */
export function normalizeZero(value: number, epsilon = EPSILON): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) <= epsilon ? 0 : value;
}

export function nearlyEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** 固定小数位格式化；非有限数返回 "—"，绝不输出 "NaN"/"Infinity"（R7-AC3）。 */
export function fixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(digits);
  // toFixed 可能产生 "-0.00"，统一为 "0.00"
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** 去掉十进制字符串里无意义的尾随零："9400.00" → "9400"，"9400.50" → "9400.5"。 */
export function trimDecimalString(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** 千分位展示（仅用于界面，不参与任何计算）。 */
export function groupThousands(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (match === null) return value;
  const [, sign = '', intPart = '', frac = ''] = match;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${frac}`;
}

/** `(2, 1)` 形式的向量展示。 */
export function formatVector2(vector: readonly [number, number], digits = 2): string {
  return `(${fixed(vector[0], digits)}, ${fixed(vector[1], digits)})`;
}

/** `[[1, 1], [0, 1]]` 形式的矩阵展示。 */
export function formatMatrix2(
  matrix: readonly [readonly [number, number], readonly [number, number]],
  digits = 2,
): string {
  return `[[${fixed(matrix[0][0], digits)}, ${fixed(matrix[0][1], digits)}], [${fixed(
    matrix[1][0],
    digits,
  )}, ${fixed(matrix[1][1], digits)}]]`;
}

/** 单位展示：无量纲单位 "1" 不显示（矩阵/向量）。 */
export function displayUnit(unit: string): string {
  const trimmed = unit.trim();
  return trimmed === '' || trimmed === '1' ? '' : trimmed;
}

/** 形如 `(−3 ~ 3，步长 0.1)` 的范围文案（ParamControl 使用）。 */
export function formatRange(range: {
  min: number | null;
  max: number | null;
  step: number | null;
}): string {
  const parts: string[] = [];
  const hasMin = range.min !== null;
  const hasMax = range.max !== null;
  if (hasMin && hasMax) {
    parts.push(`${fixed(range.min as number, 2).replace(/\.00$/, '')} ~ ${fixed(
      range.max as number,
      2,
    ).replace(/\.00$/, '')}`);
  } else if (hasMin) {
    parts.push(`≥ ${fixed(range.min as number, 2)}`);
  } else if (hasMax) {
    parts.push(`≤ ${fixed(range.max as number, 2)}`);
  }
  if (range.step !== null) {
    parts.push(`步长 ${fixed(range.step, 2).replace(/\.00$/, '')}`);
  }
  return parts.join('，');
}

/** 安全取百分比整数（进度条用）；分母为 0 时返回 null，不编造百分比。 */
export function percentOf(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}

/** ISO 时间到本地可读文案；无法解析时原样返回。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
/* -------------------------------------------------------------------------- */
/* C-UI@1 P1 澄清的冻结签名（§2.2.11，T5/T6 直接 import）                     */
/* -------------------------------------------------------------------------- */

/**
 * 金额展示：`"9400.00"` → `"9,400"`、`"9400.50"` → `"9,400.5"`、`"-600.00"` → `"-600"`。
 * 只做展示，不参与计算（金额运算在 budget.ts 的 BigInt 定点域完成）。
 */
export function formatMoney(value: string): string {
  const trimmed = trimDecimalString(value.trim());
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return value;
  return groupThousands(trimmed);
}

/** 固定小数位展示（舍入值与精度说明都用它），非有限数返回 "—"。 */
export function formatNumber(value: number, digits: number): string {
  return fixed(value, digits);
}
