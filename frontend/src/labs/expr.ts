/**
 * 受限数学表达式求值器。
 *
 * 只接受数字、已声明变量、常用函数和 + - * / ^ 与括号；不使用 eval/new Function。
 * 后端返回的表达式（如 `2*x - 6`）和教学条件都走这一套解析，保证图形、轨迹与
 * 讲解读取同一份函数。
 */

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Node =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'unary'; op: '-' | '+'; arg: Node }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] };

export type ExpressionNode = Node;

type Token = {
  type: 'number' | 'identifier' | 'operator' | 'left' | 'right' | 'comma';
  value: string;
  position: number;
};

const FUNCTIONS: Record<string, (value: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (value) => 1 / Math.tan(value),
  sec: (value) => 1 / Math.cos(value),
  csc: (value) => 1 / Math.sin(value),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  acot: (value) => value === 0 ? Math.PI / 2 : Math.atan(1 / value),
  asec: (value) => Math.acos(1 / value),
  acsc: (value) => Math.asin(1 / value),
  // Textbook aliases retain their inverse-function meaning.
  arctan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arccot: (value) => value === 0 ? Math.PI / 2 : Math.atan(1 / value),
  arcsec: (value) => Math.acos(1 / value),
  arccsc: (value) => Math.asin(1 / value),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  factorial: (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 170) return NaN;
    let result = 1;
    for (let index = 2; index <= value; index += 1) result *= index;
    return result;
  },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length);
const FUNCTION_NAME_PATTERN = FUNCTION_NAMES.join('|');

function splitJuxtapositionToken(token: string, followedByParen: boolean): string {
  const lowered = token.toLowerCase();
  if (!FUNCTION_NAMES.some((name) => lowered.includes(name))) return token;
  let out = '';
  let cursor = 0;
  while (cursor < token.length) {
    const hit = FUNCTION_NAMES.find((name) => lowered.startsWith(name, cursor));
    if (hit !== undefined) {
      if (out && /[A-Za-z0-9)]$/.test(out)) out += '*';
      out += token.slice(cursor, cursor + hit.length);
      cursor += hit.length;
      if (cursor === token.length) break;
      let nxt = token.length;
      for (let idx = cursor; idx < token.length; idx += 1) {
        if (FUNCTION_NAMES.some((name) => lowered.startsWith(name, idx))) {
          nxt = idx;
          break;
        }
      }
      if (nxt > cursor) {
        out += `(${token.slice(cursor, nxt)})`;
        cursor = nxt;
      } else if (!followedByParen) {
        out += `(${splitJuxtapositionToken(token.slice(cursor), false)})`;
        cursor = token.length;
      } else {
        out += ' ';
      }
      continue;
    }
    out += token[cursor]!;
    cursor += 1;
  }
  return out;
}

/** 规范化输入文本中的 Unicode 符号、空格分隔函数参数及无空格粘连函数（如 lnx -> ln(x)）。 */
export function normalizeExpressionInput(
  source: string,
  variables: readonly string[] = ['x'],
): string {
  const names = new Set(variables.map((item) => item.toLowerCase()));
  let normalized = source
    .replace(/\u2212/g, '-')
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/\u00b7/g, '*')
    .replace(/π/g, 'pi')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .trim();
  if (!normalized) return '';
  normalized = normalized.replace(
    new RegExp(`(${FUNCTION_NAME_PATTERN})\\s+\\(`, 'gi'),
    '$1(',
  );
  normalized = normalized.replace(
    new RegExp(
      `([A-Za-z0-9_]*?(?:${FUNCTION_NAME_PATTERN}))\\s+([A-Za-z0-9]+)(?=$|[\\s+\\-*/^),])`,
      'gi',
    ),
    (full, fnPart: string, argPart: string) =>
      FUNCTION_NAMES.includes(argPart.toLowerCase()) ? full : `${fnPart}(${argPart})`,
  );
  let out = '';
  let lastIndex = 0;
  const idRegex = /[A-Za-z_][A-Za-z_0-9]*/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(normalized)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    out += normalized.slice(lastIndex, start);
    if (names.has(token.toLowerCase()) || token.toLowerCase() in CONSTANTS) {
      out += token;
    } else {
      out += splitJuxtapositionToken(token, normalized[end] === '(');
    }
    lastIndex = end;
  }
  return out + normalized.slice(lastIndex);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = index;
      const text = source.slice(start).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
      if (!text) throw new ExpressionError('数字格式不正确');
      index += text.length;
      if (source[index] === '.') throw new ExpressionError('数字格式不正确');
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError(`数字格式不正确：${text}`);
      tokens.push({ type: 'number', value: text, position: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < source.length && /[A-Za-z_0-9]/.test(source[index]!)) index += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, index), position: start });
      continue;
    }
    if (char === '*' && source[index + 1] === '*') {
      tokens.push({ type: 'operator', value: '^', position: index });
      index += 2;
      continue;
    }
    if ('+-*/^'.includes(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'left', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'right', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: char, position: index });
      index += 1;
      continue;
    }
    throw new ExpressionError(`表达式包含不支持的字符：${char}`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly variables: ReadonlySet<string>;

  constructor(tokens: Token[], variables: ReadonlySet<string>) {
    this.tokens = tokens;
    this.variables = variables;
  }

  parse(): Node {
    const node = this.parseExpression();
    if (this.index !== this.tokens.length) {
      throw new ExpressionError('表达式末尾有多余内容');
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(type?: Token['type'], value?: string): Token {
    const token = this.peek();
    if (!token || (type && token.type !== type) || (value && token.value !== value)) {
      throw new ExpressionError('表达式结构不完整');
    }
    this.index += 1;
    return token;
  }

  private startsPrimary(token: Token | undefined): boolean {
    return !!token && (token.type === 'number' || token.type === 'identifier' || token.type === 'left');
  }

  private parseExpression(): Node {
    let node = this.parseTerm();
    while (this.peek()?.type === 'operator' && ['+', '-'].includes(this.peek()!.value)) {
      const op = this.consume('operator').value as '+' | '-';
      node = { type: 'binary', op, left: node, right: this.parseTerm() };
    }
    return node;
  }

  private parseTerm(): Node {
    let node = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (token?.type === 'operator' && ['*', '/'].includes(token.value)) {
        const op = this.consume('operator').value as '*' | '/';
        node = { type: 'binary', op, left: node, right: this.parseUnary() };
        continue;
      }
      // 隐式乘法：2x、3(x+1)、x y。
      if (this.startsPrimary(token)) {
        node = { type: 'binary', op: '*', left: node, right: this.parseUnary() };
        continue;
      }
      break;
    }
    return node;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      const op = this.consume('operator').value as '+' | '-';
      return { type: 'unary', op, arg: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token?.type === 'operator' && token.value === '^') {
      this.consume('operator');
      return { type: 'binary', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new ExpressionError('表达式缺少操作数');
    if (token.type === 'number') {
      this.consume('number');
      return { type: 'number', value: Number(token.value) };
    }
    if (token.type === 'left') {
      this.consume('left');
      const node = this.parseExpression();
      this.consume('right');
      return node;
    }
    if (token.type === 'identifier') {
      this.consume('identifier');
      const name = token.value.toLowerCase();
      if (this.peek()?.type === 'left') {
        if (!(name in FUNCTIONS)) throw new ExpressionError(`不支持的函数：${token.value}`);
        this.consume('left');
        const args: Node[] = [this.parseExpression()];
        while (this.peek()?.type === 'comma') {
          this.consume('comma');
          args.push(this.parseExpression());
        }
        this.consume('right');
        if (args.length !== 1) throw new ExpressionError(`${token.value} 只需要一个参数`);
        return { type: 'call', name, args };
      }
      if (name in CONSTANTS) return { type: 'number', value: CONSTANTS[name]! };
      if (!this.variables.has(name)) throw new ExpressionError(`未声明的变量：${token.value}`);
      return { type: 'variable', name };
    }
    throw new ExpressionError('表达式缺少操作数');
  }
}

function evaluate(node: Node, values: Readonly<Record<string, number>>): number {
  if (node.type === 'number') return node.value;
  if (node.type === 'variable') {
    const value = values[node.name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ExpressionError(`变量 ${node.name} 没有有限值`);
    }
    return value;
  }
  if (node.type === 'unary') {
    const value = evaluate(node.arg, values);
    return node.op === '-' ? -value : value;
  }
  if (node.type === 'call') {
    const value = evaluate(node.args[0]!, values);
    const result = FUNCTIONS[node.name]!(value);
    if (!Number.isFinite(result)) throw new ExpressionError(`${node.name} 在该点无有限值`);
    return result;
  }
  const left = evaluate(node.left, values);
  const right = evaluate(node.right, values);
  let result: number;
  switch (node.op) {
    case '+': result = left + right; break;
    case '-': result = left - right; break;
    case '*': result = left * right; break;
    case '/':
      if (Math.abs(right) < 1e-14) throw new ExpressionError('除数为 0');
      result = left / right;
      break;
    case '^': result = Math.pow(left, right); break;
    default: throw new ExpressionError('未知运算符');
  }
  if (!Number.isFinite(result)) throw new ExpressionError('结果不是有限数');
  return result;
}

export interface CompiledExpression {
  readonly source: string;
  readonly ast: ExpressionNode;
  eval(values?: Readonly<Record<string, number>>): number;
  evalOrNull(values?: Readonly<Record<string, number>>): number | null;
}

export function compileExpression(
  source: string,
  variables: readonly string[] = ['x'],
): CompiledExpression {
  const normalized = normalizeExpressionInput(source, variables);
  if (!normalized) throw new ExpressionError('表达式为空');
  const names = new Set(variables.map((item) => item.toLowerCase()));
  const node = new Parser(tokenize(normalized), names).parse();
  return {
    source: normalized,
    ast: node,
    eval(values = {}) {
      return evaluate(node, values);
    },
    evalOrNull(values = {}) {
      try {
        return evaluate(node, values);
      } catch {
        return null;
      }
    },
  };
}

export function evaluateExpression(
  source: string,
  values: Record<string, number>,
  variables: readonly string[] = Object.keys(values),
): number | null {
  try {
    return compileExpression(source, variables).evalOrNull(values);
  } catch {
    return null;
  }
}

export function formatNumber(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(3).replace('e+', 'e');
  return Number(value.toFixed(digits)).toString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
