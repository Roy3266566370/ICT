/**
 * format.ts —— iSpec 取值展示的格式化与文本模板替换（纯函数，供 SSR 自检复用）。
 *
 * 数字规则（「保留合适位数」）：
 *  - 整数直接输出；
 *  - 极大 / 极小数用 3 位有效数字的科学计数法；
 *  - 其余四舍五入到 `digits` 位（默认 4），去掉浮点尾差与末尾 0；
 *  - NaN 显示「—」，无穷显示「∞」/「−∞」，避免把异常值当结论展示。
 */

/** iSpec 运行时里一个取值：数字、布尔或文本。 */
export type SpecCell = number | boolean | string;

/** 去科学计数法尾部的 0：`1.230e+7` → `1.23e+7`。 */
function trimExponential(text: string): string {
  return text.replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
}

export function formatNumberSmart(value: number, digits = 4): string {
  if (Number.isNaN(value)) return '—';
  if (value === Number.POSITIVE_INFINITY) return '∞';
  if (value === Number.NEGATIVE_INFINITY) return '−∞';

  const normalized = Object.is(value, -0) ? 0 : value;
  const abs = Math.abs(normalized);
  if (Number.isInteger(normalized) && abs < 1e9) return String(normalized);
  // sin/cos(90°) 这类三角运算会留下 1e-16 量级的残差；当作 0 展示，
  // 否则界面会出现 "1.225e-16" 这种既不好读、也不表达数学事实的数字。
  if (abs < 1e-12) return '0';
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return trimExponential(normalized.toExponential(3));

  const rounded = Number(normalized.toFixed(digits));
  return String(rounded);
}

/** 统一取值展示：布尔按技术字面量、文本原样、缺失给「—」。 */
export function formatSpecValue(value: SpecCell | undefined, digits = 4): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return formatNumberSmart(value, digits);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value === '' ? '—' : value;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export interface RenderedTemplate {
  text: string;
  /** 模板中出现但作用域里没有的标识符，用于给出可读提示（而不是静默留空） */
  missing: string[];
}

/**
 * 把 `det = {{det}}，秩 = {{rank}}` 这类模板替换成当前值。
 * 未知占位符替换为「—」并记入 `missing`，避免整段文字消失。
 */
export function renderTemplate(
  template: string,
  scope: Record<string, SpecCell>,
  digits = 4,
): RenderedTemplate {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER_PATTERN, (_match: string, id: string) => {
    const value = scope[id];
    if (value === undefined) {
      missing.push(id);
      return '—';
    }
    return formatSpecValue(value, digits);
  });
  return { text, missing };
}

/** 只要渲染文本的便捷版本。 */
export function renderTemplateText(template: string, scope: Record<string, SpecCell>): string {
  return renderTemplate(template, scope).text;
}