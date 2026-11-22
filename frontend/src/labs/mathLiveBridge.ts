/**
 * MathLive ↔ 实验室受限表达式（plain math）双向桥接层。
 *
 * 使用 `@cortex-js/compute-engine` 解析 LaTeX 为 MathJSON 并序列化为标准
 * SymPy/实验室 ASCII 表达式；对正在输入中的不完整公式或微分方程记号（如 y''=0）
 * 提供确定性 LaTeX 清洗兜底，确保输入过程不卡顿、不丢字。
 */
import { ComputeEngine } from '@cortex-js/compute-engine';
import { inspectMath } from './mathKeyboard.ts';

let sharedEngine: ComputeEngine | null = null;

function getEngine(): ComputeEngine | null {
  if (sharedEngine) return sharedEngine;
  try {
    sharedEngine = new ComputeEngine();
    return sharedEngine;
  } catch {
    return null;
  }
}

/** 把实验室纯文本公式转成 MathLive 可渲染的 LaTeX。 */
export function plainToLatex(
  plain: string,
  variables: readonly string[],
  allowInfinity = false,
): string {
  const trimmed = plain.trim();
  if (!trimmed) return '';
  if (allowInfinity && /^[+-]?(?:oo|inf|∞)$/i.test(trimmed)) {
    return trimmed.startsWith('-') ? '-\\infty' : '\\infty';
  }
  const inspected = inspectMath(trimmed, variables);
  if (inspected.tex) return inspected.tex;
  return trimmed
    .replace(/\*\*/g, '^')
    .replace(/\*/g, '\\cdot ')
    .replace(/\bpi\b/g, '\\pi')
    .replace(/\btheta\b/g, '\\theta')
    .replace(/\boo\b/g, '\\infty');
}

const FN_MAP: Record<string, string> = {
  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Cot: 'cot',
  Sec: 'sec',
  Csc: 'csc',
  Arcsin: 'arcsin',
  Arccos: 'arccos',
  Arctan: 'arctan',
  Sinh: 'sinh',
  Cosh: 'cosh',
  Tanh: 'tanh',
  Ln: 'ln',
  Log: 'ln',
  Exp: 'exp',
  Sqrt: 'sqrt',
  Abs: 'abs',
};

function mathJsonToPlain(node: unknown): string | null {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) return node > 0 ? 'oo' : '-oo';
    return String(node);
  }
  if (typeof node === 'string') {
    if (node === 'Pi') return 'pi';
    if (node === 'ExponentialE') return 'e';
    if (node === 'PositiveInfinity' || node === 'ComplexInfinity') return 'oo';
    if (node === 'NegativeInfinity') return '-oo';
    if (node === 'Theta') return 'theta';
    if (node === 'Nothing' || node === 'Error') return null;
    return node;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj.num === 'string') return obj.num;
    if (typeof obj.sym === 'string') return mathJsonToPlain(obj.sym);
    return null;
  }
  if (!Array.isArray(node) || node.length === 0) return null;
  const [head, ...args] = node;
  if (typeof head !== 'string') return null;

  if (head === 'Error' || head === 'Sequence' || head === 'InvisibleOperator') return null;

  if (head === 'Delimiter') {
    const inner = mathJsonToPlain(args[0]);
    return inner ? `(${inner})` : null;
  }
  if (head === 'Negate') {
    const inner = mathJsonToPlain(args[0]);
    if (!inner) return null;
    return /^[A-Za-z0-9_.()]+$/.test(inner) ? `-${inner}` : `-(${inner})`;
  }
  if (head === 'Add') {
    const parts = args.map(mathJsonToPlain);
    if (parts.some((p) => p === null)) return null;
    return (parts as string[])
      .map((part, idx) => (idx > 0 && !part.startsWith('-') ? `+${part}` : part))
      .join('');
  }
  if (head === 'Subtract') {
    const a = mathJsonToPlain(args[0]);
    const b = mathJsonToPlain(args[1]);
    if (!a || !b) return null;
    const rhs = /[+-]/.test(b) && !b.startsWith('(') ? `(${b})` : b;
    return `${a}-${rhs}`;
  }
  if (head === 'Multiply') {
    const parts = args.map((arg) => {
      const text = mathJsonToPlain(arg);
      if (!text) return null;
      return Array.isArray(arg) && (arg[0] === 'Add' || arg[0] === 'Subtract')
        ? `(${text})`
        : text;
    });
    if (parts.some((p) => p === null)) return null;
    return (parts as string[]).join('*');
  }
  if (head === 'Divide' || head === 'Rational') {
    const a = mathJsonToPlain(args[0]);
    const b = mathJsonToPlain(args[1]);
    if (!a || !b) return null;
    const lhs = /^[A-Za-z0-9_.]+$/.test(a) ? a : `(${a})`;
    const rhs = /^[A-Za-z0-9_.]+$/.test(b) ? b : `(${b})`;
    return `${lhs}/${rhs}`;
  }
  if (head === 'Power') {
    const base = mathJsonToPlain(args[0]);
    const exp = mathJsonToPlain(args[1]);
    if (!base || !exp) return null;
    if (base === 'e') return `exp(${exp})`;
    const lhs = /^[A-Za-z0-9_.]+$/.test(base) ? base : `(${base})`;
    const rhs = /^[A-Za-z0-9_.]+$/.test(exp) ? exp : `(${exp})`;
    return `${lhs}^${rhs}`;
  }
  if (head === 'Root') {
    const base = mathJsonToPlain(args[0]);
    const degree = mathJsonToPlain(args[1]);
    if (!base || !degree) return null;
    return degree === '2' ? `sqrt(${base})` : `(${base})^(1/(${degree}))`;
  }
  if (head === 'Equal') {
    const a = mathJsonToPlain(args[0]);
    const b = mathJsonToPlain(args[1]);
    return a && b ? `${a}=${b}` : null;
  }
  if (head in FN_MAP) {
    const arg = mathJsonToPlain(args[0]);
    return arg ? `${FN_MAP[head]}(${arg})` : null;
  }
  return null;
}

/** 轻量 LaTeX 清洗兜底：处理 ComputeEngine 暂未解析的局部写法或等式。 */
function fallbackLatexToPlain(latex: string): string {
  let s = latex.trim();
  if (!s) return '';
  s = s
    .replace(/\\left\s*\|([^|]+)\\right\s*\|/g, 'abs($1)')
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\(?:displaystyle|textstyle|quad|qquad|,|;|!)/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pi\b/g, 'pi')
    .replace(/\\theta\b/g, 'theta')
    .replace(/\\infty\b/g, 'oo')
    .replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|exp)\b/g, '$1')
    .replace(/\^\{([^{}]+)\}/g, '^($1)')
    .replace(/\{([^{}]+)\}/g, '($1)')
    .replace(/\s+/g, '');
  return s;
}

/** 把 MathLive 输出的 LaTeX 转换为实验室标准纯文本表达式。 */
export function latexToPlain(latex: string): string {
  const trimmed = latex.trim();
  if (!trimmed) return '';
  if (/^[+-]?\\infty$/.test(trimmed)) {
    return trimmed.startsWith('-') ? '-oo' : 'oo';
  }
  // 含导数撇号（如 ODE: y''+y=0）直接走轻量清洗，避免 ComputeEngine 误判为微积分算子
  if (/'|\\prime/.test(trimmed)) {
    return fallbackLatexToPlain(trimmed.replace(/\\prime/g, "'"));
  }
  const ce = getEngine();
  if (ce) {
    try {
      const expr = ce.parse(trimmed, { form: 'raw' });
      const converted = mathJsonToPlain(expr.json);
      if (converted && !converted.includes('Error')) {
        return converted;
      }
    } catch {
      /* 降级到轻量 LaTeX 清洗 */
    }
  }
  return fallbackLatexToPlain(trimmed);
}
