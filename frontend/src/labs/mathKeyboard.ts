import { compileExpression, normalizeExpressionInput } from './expr.ts';
import { mathSpanToLatex } from './mathText.ts';

export interface MathEdit { value: string; start: number; end: number }
const FUNCTIONS = new Set(['sqrt', 'abs', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'ln', 'log', 'exp', 'sinh', 'cosh', 'tanh']);

/** Apply a keypad action to the current input selection. Templates keep operands grouped. */
export function editMath(state: MathEdit, key: string): MathEdit {
  const { value } = state;
  const start = Math.max(0, Math.min(state.start, value.length));
  const end = Math.max(start, Math.min(state.end, value.length));
  const caret = (position: number): MathEdit => ({ value, start: position, end: position });
  const insert = (text: string, offset = text.length): MathEdit => ({
    value: value.slice(0, start) + text + value.slice(end), start: start + offset, end: start + offset,
  });
  const selected = value.slice(start, end);
  const operand = (text: string, offset = text.length): MathEdit => {
    const prefix = /[A-Za-z0-9)]$/.test(value.slice(0, start)) ? '*' : '';
    return insert(prefix + text, prefix.length + offset);
  };
  if (key === 'clear') return { value: '', start: 0, end: 0 };
  if (key === 'left') return caret(start === end ? Math.max(0, start - 1) : start);
  if (key === 'right') return caret(start === end ? Math.min(value.length, end + 1) : end);
  if (key === 'next') {
    const blank = value.indexOf('()', end);
    if (blank >= 0) return caret(blank + 1);
    const closing = value.indexOf(')', end);
    return caret(closing >= 0 ? closing + 1 : value.length);
  }
  if (key === 'backspace') {
    if (start !== end) return insert('');
    const from = Math.max(0, start - 1);
    return { value: value.slice(0, from) + value.slice(end), start: from, end: from };
  }
  if (key === 'fraction') return operand(`(${selected})/()`, selected ? selected.length + 4 : 1);
  if (key === 'power') return insert(selected ? `(${selected})^()` : '^()', selected ? selected.length + 4 : 2);
  if (key === 'group') return operand(`(${selected})`, selected ? selected.length + 2 : 1);
  if (FUNCTIONS.has(key)) return operand(`${key}(${selected})`, key.length + 1 + selected.length + (selected ? 1 : 0));
  if (/^[A-Za-z]+$/.test(key)) return operand(key);
  if (/^[0-9.]$/.test(key) && /[A-Za-z)]$/.test(value.slice(0, start))) return insert(`*${key}`);
  return insert(key);
}

/** Validate syntax without evaluating at a point (e.g. ln(x) is valid even if x=0 is not). */
export function inspectMath(value: string, variables: readonly string[] = ['x']): { error: string | null; tex: string | null } {
  try {
    const normalized = normalizeExpressionInput(value, variables);
    compileExpression(normalized, variables);
    const display = normalized.replace(/\b(atan|asin|acos|acot|asec|acsc)\b/g, (name) => ({
      atan: 'arctan', asin: 'arcsin', acos: 'arccos', acot: 'arccot', asec: 'arcsec', acsc: 'arccsc',
    })[name]!);
    // The assignment supplies a formula cue for single letters/numbers as well.
    const tex = mathSpanToLatex(`f=${display}`)?.slice(2) ?? null;
    return { error: null, tex };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '请检查公式结构', tex: null };
  }
}
