/**
 * mathKeypadActions.ts —— 悬浮数学公式键盘的按键定义与纯文本选区编辑逻辑
 *
 * 支持两种插入模式：
 *  - expr：适配画布函数源 f(x)、二元函数 f(x,y)、AI 积木参数等表达式输入框；
 *  - latex：适配公式卡（latexNote / math-field）或需要标准 LaTeX 源码的输入框。
 */

export type KeypadMode = 'expr' | 'latex';
export type KeypadTab = 'common' | 'calculus' | 'greek';

export interface KeypadKeySpec {
  id: string;
  /** 按键上展示的符号或名称 */
  label: string;
  /** 悬停中文说明 */
  title: string;
  /** 表达式模式插入内容，使用 `|` 标记插入后光标落点（缺省落在末尾） */
  expr?: string;
  /** LaTeX 模式插入内容，使用 `|` 标记插入后光标落点（缺省同 expr） */
  latex?: string;
  /** 特殊控制动作 */
  action?: 'backspace' | 'left' | 'right' | 'clear';
  /** 视觉强调类型 */
  tone?: 'op' | 'fn' | 'ctrl';
}

export interface TextEditState {
  value: string;
  start: number;
  end: number;
}

export const KEYPAD_TABS: readonly { id: KeypadTab; label: string }[] = [
  { id: 'common', label: '常用公式' },
  { id: 'calculus', label: '微积分 · 符号' },
  { id: 'greek', label: '希腊字母' },
];

export const KEYPAD_KEYS: Record<KeypadTab, readonly KeypadKeySpec[]> = {
  common: [
    { id: 'frac', label: 'a/b', title: '分数', expr: '(|)/()', latex: '\\frac{|}{}', tone: 'fn' },
    { id: 'pow2', label: 'x²', title: '平方', expr: '^2', latex: '^{2}', tone: 'fn' },
    { id: 'pown', label: 'xⁿ', title: '任意次幂', expr: '^(|)', latex: '^{|}', tone: 'fn' },
    { id: 'sub', label: 'xₙ', title: '下标', expr: '_(|)', latex: '_{|}', tone: 'fn' },
    { id: 'sqrt', label: '√', title: '平方根', expr: 'sqrt(|)', latex: '\\sqrt{|}', tone: 'fn' },
    { id: 'abs', label: '|x|', title: '绝对值', expr: 'abs(|)', latex: '\\left| | \\right|', tone: 'fn' },
    { id: 'parens', label: '( )', title: '括号', expr: '(|)', latex: '\\left(|\\right)', tone: 'op' },
    { id: 'backspace', label: '⌫', title: '退格删除', action: 'backspace', tone: 'ctrl' },

    { id: 'sin', label: 'sin', title: '正弦', expr: 'sin(|)', latex: '\\sin(|)', tone: 'fn' },
    { id: 'cos', label: 'cos', title: '余弦', expr: 'cos(|)', latex: '\\cos(|)', tone: 'fn' },
    { id: 'tan', label: 'tan', title: '正切', expr: 'tan(|)', latex: '\\tan(|)', tone: 'fn' },
    { id: 'ln', label: 'ln', title: '自然对数', expr: 'ln(|)', latex: '\\ln(|)', tone: 'fn' },
    { id: 'log', label: 'log', title: '对数', expr: 'log(|)', latex: '\\log(|)', tone: 'fn' },
    { id: 'exp', label: 'eˣ', title: '指数函数', expr: 'exp(|)', latex: 'e^{|}', tone: 'fn' },
    { id: 'pi', label: 'π', title: '圆周率 π', expr: 'pi', latex: '\\pi', tone: 'op' },
    { id: 'left', label: '←', title: '光标左移', action: 'left', tone: 'ctrl' },

    { id: 'x', label: 'x', title: '变量 x', expr: 'x', latex: 'x' },
    { id: 'y', label: 'y', title: '变量 y', expr: 'y', latex: 'y' },
    { id: 't', label: 't', title: '变量 t', expr: 't', latex: 't' },
    { id: 'plus', label: '+', title: '加', expr: '+', latex: '+', tone: 'op' },
    { id: 'minus', label: '−', title: '减', expr: '-', latex: '-', tone: 'op' },
    { id: 'mul', label: '×', title: '乘', expr: '*', latex: '\\times ', tone: 'op' },
    { id: 'eq', label: '=', title: '等于', expr: '=', latex: '=', tone: 'op' },
    { id: 'right', label: '→', title: '光标右移', action: 'right', tone: 'ctrl' },
  ],
  calculus: [
    { id: 'int', label: '∫', title: '不定积分', expr: '∫', latex: '\\int | \\,dx', tone: 'fn' },
    { id: 'dint', label: '∫ₐᵇ', title: '定积分', expr: '∫', latex: '\\int_{a}^{b} | \\,dx', tone: 'fn' },
    { id: 'iint', label: '∬', title: '二重积分', expr: '∬', latex: '\\iint_{D} | \\,dA', tone: 'fn' },
    { id: 'oint', label: '∮', title: '环路积分', expr: '∮', latex: '\\oint_{C} | \\,ds', tone: 'fn' },
    { id: 'sum', label: '∑', title: '求和', expr: '∑', latex: '\\sum_{i=1}^{n} |', tone: 'fn' },
    { id: 'prod', label: '∏', title: '连乘', expr: '∏', latex: '\\prod_{i=1}^{n} |', tone: 'fn' },
    { id: 'lim', label: 'lim', title: '极限', expr: 'lim', latex: '\\lim_{x \\to 0} |', tone: 'fn' },
    { id: 'backspace2', label: '⌫', title: '退格删除', action: 'backspace', tone: 'ctrl' },

    { id: 'partial', label: '∂', title: '偏导符号', expr: '∂', latex: '\\partial ', tone: 'fn' },
    { id: 'ddx', label: 'd/dx', title: '导数算子', expr: 'd/dx', latex: '\\frac{d}{dx}|', tone: 'fn' },
    { id: 'ppx', label: '∂/∂x', title: '偏导算子', expr: '∂/∂x', latex: '\\frac{\\partial |}{\\partial x}', tone: 'fn' },
    { id: 'nabla', label: '∇', title: '梯度算子', expr: '∇', latex: '\\nabla ', tone: 'fn' },
    { id: 'prime', label: '′', title: '一阶导撇号', expr: '\'', latex: '\'', tone: 'op' },
    { id: 'inf', label: '∞', title: '无穷大', expr: '∞', latex: '\\infty', tone: 'op' },
    { id: 'to', label: '→', title: '趋近于', expr: '→', latex: '\\to ', tone: 'op' },
    { id: 'pm', label: '±', title: '正负号', expr: '±', latex: '\\pm ', tone: 'op' },

    { id: 'le', label: '≤', title: '小于等于', expr: '≤', latex: '\\le ', tone: 'op' },
    { id: 'ge', label: '≥', title: '大于等于', expr: '≥', latex: '\\ge ', tone: 'op' },
    { id: 'ne', label: '≠', title: '不等于', expr: '≠', latex: '\\ne ', tone: 'op' },
    { id: 'approx', label: '≈', title: '约等于', expr: '≈', latex: '\\approx ', tone: 'op' },
    { id: 'cdot', label: '·', title: '点乘', expr: '*', latex: '\\cdot ', tone: 'op' },
    { id: 'in', label: '∈', title: '属于', expr: '∈', latex: '\\in ', tone: 'op' },
    { id: 'forall', label: '∀', title: '任意', expr: '∀', latex: '\\forall ', tone: 'op' },
    { id: 'clear', label: '清空', title: '清空当前输入框', action: 'clear', tone: 'ctrl' },
  ],
  greek: [
    { id: 'alpha', label: 'α', title: 'alpha', expr: 'α', latex: '\\alpha' },
    { id: 'beta', label: 'β', title: 'beta', expr: 'β', latex: '\\beta' },
    { id: 'gamma', label: 'γ', title: 'gamma', expr: 'γ', latex: '\\gamma' },
    { id: 'delta', label: 'δ', title: 'delta', expr: 'δ', latex: '\\delta' },
    { id: 'eps', label: 'ε', title: 'epsilon', expr: 'ε', latex: '\\varepsilon' },
    { id: 'zeta', label: 'ζ', title: 'zeta', expr: 'ζ', latex: '\\zeta' },
    { id: 'eta', label: 'η', title: 'eta', expr: 'η', latex: '\\eta' },
    { id: 'theta', label: 'θ', title: 'theta', expr: 'θ', latex: '\\theta' },

    { id: 'lambda', label: 'λ', title: 'lambda', expr: 'λ', latex: '\\lambda' },
    { id: 'mu', label: 'μ', title: 'mu', expr: 'μ', latex: '\\mu' },
    { id: 'nu', label: 'ν', title: 'nu', expr: 'ν', latex: '\\nu' },
    { id: 'xi', label: 'ξ', title: 'xi', expr: 'ξ', latex: '\\xi' },
    { id: 'pi2', label: 'π', title: 'pi', expr: 'pi', latex: '\\pi' },
    { id: 'rho', label: 'ρ', title: 'rho', expr: 'ρ', latex: '\\rho' },
    { id: 'sigma', label: 'σ', title: 'sigma', expr: 'σ', latex: '\\sigma' },
    { id: 'tau', label: 'τ', title: 'tau', expr: 'τ', latex: '\\tau' },

    { id: 'phi', label: 'φ', title: 'phi', expr: 'φ', latex: '\\varphi' },
    { id: 'psi', label: 'ψ', title: 'psi', expr: 'ψ', latex: '\\psi' },
    { id: 'omega', label: 'ω', title: 'omega', expr: 'ω', latex: '\\omega' },
    { id: 'Delta', label: 'Δ', title: 'Delta', expr: 'Δ', latex: '\\Delta' },
    { id: 'Sigma', label: 'Σ', title: 'Sigma', expr: 'Σ', latex: '\\Sigma' },
    { id: 'Omega', label: 'Ω', title: 'Omega', expr: 'Ω', latex: '\\Omega' },
    { id: 'Phi', label: 'Φ', title: 'Phi', expr: 'Φ', latex: '\\Phi' },
    { id: 'backspace3', label: '⌫', title: '退格删除', action: 'backspace', tone: 'ctrl' },
  ],
};

/** 对普通输入框的文本与光标选区应用一次键盘按键 */
export function applyKeypadKey(
  state: TextEditState,
  spec: KeypadKeySpec,
  mode: KeypadMode,
): TextEditState {
  const { value } = state;
  const start = Math.max(0, Math.min(state.start, value.length));
  const end = Math.max(start, Math.min(state.end, value.length));

  if (spec.action === 'clear') {
    return { value: '', start: 0, end: 0 };
  }
  if (spec.action === 'left') {
    const pos = start === end ? Math.max(0, start - 1) : start;
    return { value, start: pos, end: pos };
  }
  if (spec.action === 'right') {
    const pos = start === end ? Math.min(value.length, end + 1) : end;
    return { value, start: pos, end: pos };
  }
  if (spec.action === 'backspace') {
    if (start !== end) {
      return { value: value.slice(0, start) + value.slice(end), start, end: start };
    }
    if (start === 0) return state;
    return { value: value.slice(0, start - 1) + value.slice(end), start: start - 1, end: start - 1 };
  }

  const template = (mode === 'latex' ? (spec.latex ?? spec.expr) : spec.expr) ?? '';
  if (!template) return state;

  const selected = value.slice(start, end);
  const markerIndex = template.indexOf('|');
  if (markerIndex >= 0) {
    const before = template.slice(0, markerIndex);
    const after = template.slice(markerIndex + 1);
    const inserted = before + selected + after;
    const caret = start + before.length + selected.length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      start: caret,
      end: caret,
    };
  }
  const caret = start + template.length;
  return {
    value: value.slice(0, start) + template + value.slice(end),
    start: caret,
    end: caret,
  };
}
