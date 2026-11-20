/**
 * 题目原文中的公式展示。
 *
 * 题目实验室保存的原文来自用户输入或 OCR，公式和中文混在同一条文本里
 * （例如 `已知平面区域 D={(x,y)|0<=y<=1/(x*sqrt(1+x^2)), x>=1}。`）。
 * 直接按纯文本显示时，`<=`、`sqrt(...)`、`x^2` 这些结构和普通文字很难一眼区分。
 * 本模块只负责“展示”：把能确认的公式片段转成 LaTeX，交给 KaTeX 排版；其余文字原样保留。
 *
 * 边界：
 * - 不修改题目原文，也不参与求解；题目模型、条件、答案和分享快照都不读这里的结果；
 * - 转换失败、括号不配对、出现未知的多字母标识符（常见于 OCR 乱码）时保留原文，
 *   不用猜测出来的公式冒充分式、根号或指数结构。
 */

import katex from 'katex';

export function conditionValueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toFixed(6))) : '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return `[${value.map(conditionValueText).join(', ')}]`;
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${conditionValueText(item)}`).join('；');
  return String(value);
}

export type ProblemTextPart =
  | { kind: 'text'; value: string }
  | { kind: 'math'; tex: string; source: string; block?: boolean };

const SUP_DIGITS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

const SUB_DIGITS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

const FUNCTIONS: Record<string, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  sec: '\\sec',
  csc: '\\csc',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  asin: '\\arcsin',
  acos: '\\arccos',
  atan: '\\arctan',
  acot: '\\operatorname{arccot}',
  asec: '\\operatorname{arcsec}',
  acsc: '\\operatorname{arccsc}',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  log: '\\log',
  ln: '\\ln',
  exp: '\\exp',
  lim: '\\lim',
  max: '\\max',
  min: '\\min',
};

const CONSTANTS: Record<string, string> = {
  pi: '\\pi',
  inf: '\\infty',
  infty: '\\infty',
};

/** 微积分里常见的微分记号：`dx` 显示为 `\mathrm{d}x`。 */
const DIFFERENTIALS = new Set(['dx', 'dy', 'dz', 'dt', 'du', 'dv', 'ds']);

const COMPARISONS: Record<string, string> = {
  '=': '=',
  '<': '<',
  '>': '>',
  '<=': '\\le ',
  '>=': '\\ge ',
  '!=': '\\ne ',
  '~=': '\\approx ',
};

/** 公式片段必须至少有一个这样的“强特征”，避免把年份、编号、选项列表当成公式。 */
const FORMULA_CUE =
  /[=<>≤≥≠≈∞π∫√∑^*/]|\b(?:sqrt|abs|exp|log|ln|sin|cos|tan|arcsin|arccos|arctan|asin|acos|atan|acot|asec|acsc|sinh|cosh|tanh|max|min|lim)\s*\(/i;

const GREEK_SYMBOLS: Record<string, string> = {
  'θ': '\\theta', 'ω': '\\omega', 'φ': '\\varphi', 'λ': '\\lambda', 'μ': '\\mu',
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'η': '\\eta', 'τ': '\\tau',
  'Δ': '\\Delta', 'Φ': '\\Phi', 'Ω': '\\Omega', 'ε': '\\varepsilon',
};

const TRAILING_PHYSICS_UNIT = /\s+(?:kg·m\/s|m\/s\^2|m\/s²|m\/s|rad\/s|W\/m\^2|W\/m²|N\/m|N\/C|N·s|N·m|m\^2|m\^3|m²|m³|kJ|eV|Hz|cm|mm|nm|μF|μC|kg|J|N|V|A|T|K|W|C|s|m|Ω)$/;
const PAREN_PHYSICS_UNIT = /\s*\((?:kg·m\/s|m\/s\^2|m\/s²|m\/s|rad\/s|W\/m\^2|W\/m²|N\/m|N\/C|N·s|N·m|m\^2|m\^3|m²|m³|kJ|eV|Hz|cm|mm|nm|μF|μC|kg|J|N|V|A|T|K|W|C|s|m|Ω|°)\)$/;

/** 展示层允许出现在公式片段里的字符；中文和中文标点会切断片段。 */
function isMathChar(char: string): boolean {
  if (char === '\\') return true;
  if (/[A-Za-z0-9+\-*/^=<>()_.[\]{}'!%|,]/.test(char)) return true;
  if (char === ' ' || char === '\t') return true;
  if (SUP_DIGITS[char] !== undefined || SUB_DIGITS[char] !== undefined) return true;
  if (GREEK_SYMBOLS[char] !== undefined || char === '°') return true;
  return '≤≥≠≈∞π∫√∑×÷−·–′″'.includes(char);
}

/** 片段两端允许去掉的标点和空白；不能去掉公式内部的实义字符。 */
function trimEdge(value: string): { lead: string; core: string; trail: string } {
  let start = 0;
  let end = value.length;
  while (start < end && /[\s,，。.;；:：!?？]/.test(value[start]!)) {
    // `.5` 这种以小数点开头的数字保留小数点。
    if (value[start] === '.' && /[0-9]/.test(value[start + 1] ?? '')) break;
    start += 1;
  }
  while (end > start && /[\s,，。.;；:：!?？]/.test(value[end - 1]!)) {
    end -= 1;
  }
  return { lead: value.slice(0, start), core: value.slice(start, end), trail: value.slice(end) };
}

/** 括号是否按总数量配对（允许 `[1,+∞)` 这类左闭右开区间）。 */
function bracketsBalanced(source: string): boolean {
  let depth = 0;
  for (const char of source) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function endsWithOperator(source: string): boolean {
  const last = source.trimEnd().slice(-1);
  return last !== '' && '+-*/^=<>_,|.'.includes(last);
}

/** 先做便宜的排除，再交给解析器；解析器本身还会拒绝未知标识符等结构。 */
function looksLikeFormula(source: string): boolean {
  if (source.length < 2 || source.length > 160) return false;
  if (!/[0-9A-Za-z]/.test(source)) return false;
  if (!FORMULA_CUE.test(source)) return false;
  if (/\d+\.\d+\.\d+/.test(source)) return false;
  if (/\s\/\s/.test(source)) return false;
  if (/^[A-Z]{1,4}\/[A-Z]{1,4}$/.test(source.trim())) return false;
  if (endsWithOperator(source)) return false;
  if (!bracketsBalanced(source)) return false;
  return true;
}

interface Token {
  kind:
    | 'number'
    | 'identifier'
    | 'op'
    | 'delimiter'
    | 'comma'
    | 'bar'
    | 'int'
    | 'sum'
    | 'sqrt'
    | 'prime'
    | 'bang'
    | 'percent';
  value: string;
  position: number;
}

class MathParseError extends Error {}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z]/.test(char);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const start = index;
      while (isDigit(source[index])) index += 1;
      if (source[index] === '.' && isDigit(source[index + 1])) {
        index += 1;
        while (isDigit(source[index])) index += 1;
      }
      const mantissa = source.slice(start, index);
      // 识别科学计数法（如 `2e-6`、`2.023e6`、`1.25e+19`），避免把 `e-6` 误拆成 `e - 6` 或 `e_6`。
      const expMatch = /^[eE]([+-]?\d+)(?![A-Za-z])/.exec(source.slice(index));
      if (expMatch) {
        const expText = expMatch[1]!.replace(/^\+/, '');
        index += expMatch[0].length;
        tokens.push({ kind: 'number', value: mantissa, position: start });
        tokens.push({ kind: 'op', value: '*', position: start });
        tokens.push({ kind: 'number', value: '10', position: start });
        tokens.push({ kind: 'op', value: '^', position: start });
        if (expText.startsWith('-')) {
          tokens.push({ kind: 'delimiter', value: '{', position: start });
          tokens.push({ kind: 'op', value: '-', position: start });
          tokens.push({ kind: 'number', value: expText.slice(1), position: start });
          tokens.push({ kind: 'delimiter', value: '}', position: start });
        } else {
          tokens.push({ kind: 'number', value: expText, position: start });
        }
        continue;
      }
      tokens.push({ kind: 'number', value: mantissa, position: start });
      continue;
    }
    if (GREEK_SYMBOLS[char] !== undefined) {
      const start = index;
      index += 1;
      let digits = '';
      while (isDigit(source[index])) {
        digits += source[index]!;
        index += 1;
      }
      tokens.push({ kind: 'identifier', value: digits ? `${char}${digits}` : char, position: start });
      continue;
    }
    if (char === '°') {
      tokens.push({ kind: 'op', value: '^', position: index });
      tokens.push({ kind: 'identifier', value: 'circ', position: index });
      index += 1;
      continue;
    }
    if (isLetter(char)) {
      const start = index;
      while (isLetter(source[index])) index += 1;
      while (isDigit(source[index])) index += 1;
      tokens.push({ kind: 'identifier', value: source.slice(start, index), position: start });
      continue;
    }
    const superscript = SUP_DIGITS[char];
    if (superscript !== undefined) {
      let digits = '';
      while (SUP_DIGITS[source[index]!] !== undefined) {
        digits += SUP_DIGITS[source[index]!];
        index += 1;
      }
      tokens.push({ kind: 'op', value: '^', position: index });
      tokens.push({ kind: 'number', value: digits, position: index });
      continue;
    }
    const subscript = SUB_DIGITS[char];
    if (subscript !== undefined) {
      let digits = '';
      while (SUB_DIGITS[source[index]!] !== undefined) {
        digits += SUB_DIGITS[source[index]!];
        index += 1;
      }
      tokens.push({ kind: 'op', value: '_', position: index });
      tokens.push({ kind: 'number', value: digits, position: index });
      continue;
    }
    if (char === '<' || char === '>' || char === '=' || char === '!') {
      if (source[index + 1] === '=') {
        tokens.push({ kind: 'op', value: `${char}=`, position: index });
        index += 2;
        continue;
      }
      if (char === '=') {
        tokens.push({ kind: 'op', value: '=', position: index });
        index += 1;
        continue;
      }
      if (char === '!') {
        tokens.push({ kind: 'bang', value: '!', position: index });
        index += 1;
        continue;
      }
      tokens.push({ kind: 'op', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === '~' && source[index + 1] === '=') {
      tokens.push({ kind: 'op', value: '~=', position: index });
      index += 2;
      continue;
    }
    if ('+-*/^_'.includes(char)) {
      tokens.push({ kind: 'op', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === '(' || char === ')' || char === '[' || char === ']' || char === '{' || char === '}') {
      tokens.push({ kind: 'delimiter', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', value: ',', position: index });
      index += 1;
      continue;
    }
    if (char === '|') {
      tokens.push({ kind: 'bar', value: '|', position: index });
      index += 1;
      continue;
    }
    if (char === "'" || char === '′') {
      tokens.push({ kind: 'prime', value: "'", position: index });
      index += 1;
      continue;
    }
    if (char === '″') {
      tokens.push({ kind: 'prime', value: "'", position: index });
      tokens.push({ kind: 'prime', value: "'", position: index });
      index += 1;
      continue;
    }
    if (char === '%') {
      tokens.push({ kind: 'percent', value: '%', position: index });
      index += 1;
      continue;
    }
    if (char === '∫') {
      tokens.push({ kind: 'int', value: '∫', position: index });
      index += 1;
      continue;
    }
    if (char === '∑') {
      tokens.push({ kind: 'sum', value: '∑', position: index });
      index += 1;
      continue;
    }
    if (char === '√') {
      tokens.push({ kind: 'sqrt', value: '√', position: index });
      index += 1;
      continue;
    }
    if (char === '≤') {
      tokens.push({ kind: 'op', value: '<=', position: index });
      index += 1;
      continue;
    }
    if (char === '≥') {
      tokens.push({ kind: 'op', value: '>=', position: index });
      index += 1;
      continue;
    }
    if (char === '≠') {
      tokens.push({ kind: 'op', value: '!=', position: index });
      index += 1;
      continue;
    }
    if (char === '≈') {
      tokens.push({ kind: 'op', value: '~=', position: index });
      index += 1;
      continue;
    }
    if (char === '∞') {
      tokens.push({ kind: 'identifier', value: 'infty', position: index });
      index += 1;
      continue;
    }
    if (char === 'π') {
      tokens.push({ kind: 'identifier', value: 'pi', position: index });
      index += 1;
      continue;
    }
    if (char === '×' || char === '·' || char === '⋅') {
      tokens.push({ kind: 'op', value: '*', position: index });
      index += 1;
      continue;
    }
    if (char === '÷') {
      tokens.push({ kind: 'op', value: '/', position: index });
      index += 1;
      continue;
    }
    if (char === '−' || char === '–') {
      tokens.push({ kind: 'op', value: '-', position: index });
      index += 1;
      continue;
    }
    throw new MathParseError(`不支持的公式字符：${char}`);
  }
  return tokens;
}

interface Expression {
  tex: string;
  /** 是否为纯数字：用于决定乘法写不写 `\cdot`，避免 `2*3` 显示成 `23`。 */
  number: boolean;
}

function other(tex: string): Expression {
  return { tex, number: false };
}

function product(left: Expression, right: Expression): Expression {
  // 科学计数法或带幂底数（如 `2×10^8`）右边以数字开头，必须保留 `\cdot` 避免粘连成 `210^8`。
  const separator = right.number || /^[0-9]/.test(right.tex) ? '\\cdot ' : '';
  return other(`${left.tex}${separator}${right.tex}`);
}

/** 分母整体带一层括号时去掉，`1/(x*sqrt(...))` 显示成 `\frac{1}{x\sqrt{...}}`。 */
function stripOuterParens(tex: string): string {
  if (tex.startsWith('\\left(') && tex.endsWith('\\right)')) {
    return tex.slice('\\left('.length, tex.length - '\\right)'.length);
  }
  return tex;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseDocument(): Expression {
    const expression = this.parseList([]);
    if (this.index !== this.tokens.length) {
      throw new MathParseError('公式末尾有多余内容');
    }
    return expression;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index];
    if (!token) throw new MathParseError('公式不完整');
    this.index += 1;
    return token;
  }

  private isOp(token: Token | undefined, value: string): boolean {
    return token !== undefined && token.kind === 'op' && token.value === value;
  }

  private isDelimiter(token: Token | undefined, value: string): boolean {
    return token !== undefined && token.kind === 'delimiter' && token.value === value;
  }

  private expectDelimiter(value: string): void {
    const token = this.consume();
    if (token.kind !== 'delimiter' || token.value !== value) {
      throw new MathParseError(`缺少 ${value}`);
    }
  }

  /** 逗号分隔的表达式列表；`close` 为空时用于整段文本。 */
  private parseList(close: string[]): Expression {
    let expression = this.parseExpression();
    while (this.peek()?.kind === 'comma') {
      this.consume();
      const next = this.parseExpression();
      expression = other(`${expression.tex},\\ ${next.tex}`);
    }
    const token = this.peek();
    if (token !== undefined && close.length > 0) {
      const isClose =
        (token.kind === 'delimiter' && close.includes(token.value)) || (token.kind === 'bar' && close.includes('|'));
      if (!isClose) throw new MathParseError('括号没有闭合');
    }
    return expression;
  }

  /** 集合描述符 `{...|...}` 里的 `|` 读作“满足”，其余位置按普通竖线交给主元处理。 */
  private parseExpression(): Expression {
    let expression = this.parseComparison();
    while (this.peek()?.kind === 'bar') {
      this.consume();
      const right = this.parseComparison();
      expression = other(`${expression.tex}\\mid ${right.tex}`);
    }
    return expression;
  }

  private parseComparison(): Expression {
    let expression = this.parseAdditive();
    while (true) {
      const token = this.peek();
      if (!token || token.kind !== 'op') break;
      const comparison = COMPARISONS[token.value];
      if (comparison === undefined) break;
      this.consume();
      const right = this.parseAdditive();
      expression = other(`${expression.tex}${comparison}${right.tex}`);
    }
    return expression;
  }

  private parseAdditive(): Expression {
    let expression = this.parseMultiplicative();
    while (true) {
      const token = this.peek();
      if (!this.isOp(token, '+') && !this.isOp(token, '-')) break;
      this.consume();
      const right = this.parseMultiplicative();
      expression = other(`${expression.tex}${token!.value}${right.tex}`);
    }
    return expression;
  }

  private parseMultiplicative(): Expression {
    let expression = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (this.isOp(token, '*')) {
        this.consume();
        expression = product(expression, this.parseUnary());
        continue;
      }
      if (this.isOp(token, '/')) {
        this.consume();
        const right = this.parseUnary();
        expression = other(`\\frac{${expression.tex}}{${stripOuterParens(right.tex)}}`);
        continue;
      }
      if (this.startsPrimary(token)) {
        expression = product(expression, this.parseUnary());
        continue;
      }
      break;
    }
    return expression;
  }

  private startsPrimary(token: Token | undefined): boolean {
    if (!token) return false;
    if (token.kind === 'number' || token.kind === 'identifier') return true;
    if (token.kind === 'int' || token.kind === 'sum' || token.kind === 'sqrt') return true;
    if (token.kind === 'delimiter' && (token.value === '(' || token.value === '[' || token.value === '{')) return true;
    return false;
  }

  private parseUnary(): Expression {
    const token = this.peek();
    if (this.isOp(token, '+') || this.isOp(token, '-')) {
      this.consume();
      const argument = this.parseUnary();
      return other(`${token!.value}${argument.tex}`);
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    let expression = this.parsePrimary();
    while (true) {
      const token = this.peek();
      if (this.isOp(token, '^') || this.isOp(token, '_')) {
        this.consume();
        const script = this.parseScript();
        expression = other(`${expression.tex}${token!.value === '^' ? '^{' : '_{'}${script.tex}}`);
        continue;
      }
      if (token?.kind === 'prime') {
        this.consume();
        expression = other(`${expression.tex}'`);
        continue;
      }
      if (token?.kind === 'bang') {
        this.consume();
        expression = other(`${expression.tex}!`);
        continue;
      }
      if (token?.kind === 'percent') {
        this.consume();
        expression = other(`${expression.tex}\\%`);
        continue;
      }
      break;
    }
    return expression;
  }

  private parseScript(): Expression {
    if (this.isDelimiter(this.peek(), '{')) {
      this.consume();
      const inner = this.parseExpression();
      this.expectDelimiter('}');
      return inner;
    }
    // 上下限只吃一个主元：`∫_0^2` 拆成 `_0` 与 `^2` 两个附标，不能把 `0^2` 当成整体。
    if (this.isOp(this.peek(), '+') || this.isOp(this.peek(), '-')) {
      const sign = this.consume().value;
      const argument = this.parseScript();
      return other(`${sign}${argument.tex}`);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.consume();
    if (token.kind === 'number') return { tex: token.value, number: true };
    if (token.kind === 'identifier') return this.parseIdentifier(token);
    if (token.kind === 'int') return other('\\int');
    if (token.kind === 'sum') return other('\\sum');
    if (token.kind === 'sqrt') return this.parseSquareRoot();
    if (token.kind === 'bar') {
      // 绝对值内部只解析到比较层，`|` 要留给右竖线；表达式层的 `|` 是集合描述符。
      const inner = this.parseComparison();
      const close = this.consume();
      if (close.kind !== 'bar') throw new MathParseError('绝对值缺少右竖线');
      return other(`\\left|${inner.tex}\\right|`);
    }
    if (token.kind === 'delimiter' && (token.value === '(' || token.value === '[' || token.value === '{')) {
      return this.parseDelimited(token.value);
    }
    throw new MathParseError(`无法识别的公式片段：${token.value}`);
  }

  private parseDelimited(open: string): Expression {
    const closeValues = open === '{' ? ['}'] : [')', ']'];
    const inner = this.parseList(closeValues);
    const close = this.consume();
    if (close.kind !== 'delimiter' || !closeValues.includes(close.value)) {
      throw new MathParseError('括号没有闭合');
    }
    const openTex = open === '(' ? '\\left(' : open === '[' ? '\\left[' : '\\{';
    const closeTex = close.value === ')' ? '\\right)' : close.value === ']' ? '\\right]' : '\\}';
    return other(`${openTex}${inner.tex}${closeTex}`);
  }

  private parseSquareRoot(): Expression {
    // 只有写清括号的根号才转换：OCR 常见 `x√1+x2` 这类缺括号的片段无法可靠还原，
    // 宁可保留原文，也不用 `\sqrt{1}+x` 改写原题含义。
    if (!this.isDelimiter(this.peek(), '(')) throw new MathParseError('根号缺少括号');
    this.consume();
    const inner = this.parseExpression();
    this.expectDelimiter(')');
    return other(`\\sqrt{${inner.tex}}`);
  }

  private parseIdentifier(token: Token): Expression {
    const name = token.value === 'Abs' ? 'abs' : token.value;
    if (name === 'circ') return other('\\circ');
    const greekLead = name.slice(0, 1);
    if (GREEK_SYMBOLS[greekLead] !== undefined && /^[0-9]*$/.test(name.slice(1))) {
      const digits = name.slice(1);
      return other(digits === '' ? GREEK_SYMBOLS[greekLead]! : `${GREEK_SYMBOLS[greekLead]}_{${digits}}`);
    }
    if (/^[A-Za-z][0-9]*$/.test(name)) {
      const letter = name.slice(0, 1);
      const digits = name.slice(1);
      return other(digits === '' ? letter : `${letter}_{${digits}}`);
    }
    if (CONSTANTS[name] !== undefined) return other(CONSTANTS[name]);
    if (DIFFERENTIALS.has(name)) {
      return other(`\\,\\mathrm{d}${name.slice(1)}`);
    }
    if (name === 'sqrt' || name === 'abs') return this.parseNamedGroup(name);
    if (FUNCTIONS[name] !== undefined) {
      if (this.isDelimiter(this.peek(), '(')) return this.parseNamedGroup(name);
      const argument = this.parseUnary();
      return other(`${FUNCTIONS[name]} ${argument.tex}`);
    }
    throw new MathParseError(`未知的多字母公式记号：${name}`);
  }

  private parseNamedGroup(name: string): Expression {
    this.expectDelimiter('(');
    const inner = this.parseList([')']);
    this.expectDelimiter(')');
    if (name === 'sqrt') return other(`\\sqrt{${inner.tex}}`);
    if (name === 'abs') return other(`\\left|${inner.tex}\\right|`);
    return other(`${FUNCTIONS[name]}\\left(${inner.tex}\\right)`);
  }
}

/** 把一个候选公式片段转成 LaTeX；不可靠时返回 null，由调用方保留原文。 */
export function mathSpanToLatex(source: string): string | null {
  if (/\\[a-zA-Z]+/.test(source)) return validLatex(source);
  if (!looksLikeFormula(source)) return null;
  try {
    const tokens = tokenize(source.replace(/\*\*/g, '^'));
    return new Parser(tokens).parseDocument().tex;
  } catch {
    return null;
  }
}

/**
 * 把题目原文切成“普通文字 / 公式”片段。
 * 只在能完整解析的片段上输出 LaTeX；其余内容与原文逐字一致。
 */
function segmentPlainText(text: string): ProblemTextPart[] {
  const parts: ProblemTextPart[] = [];
  let textBuffer = '';
  let index = 0;
  const flushText = (): void => {
    if (textBuffer !== '') {
      parts.push({ kind: 'text', value: textBuffer });
      textBuffer = '';
    }
  };
  while (index < text.length) {
    const char = text[index]!;
    if (char === '\n' || char === '\r' || !isMathChar(char)) {
      textBuffer += char;
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && isMathChar(text[end]!)) end += 1;
    const run = text.slice(index, end);
    const { lead, core: rawCore, trail: rawTrail } = trimEdge(run);
    let core = rawCore;
    let trail = rawTrail;
    const parenUnit = PAREN_PHYSICS_UNIT.exec(core);
    if (parenUnit) {
      core = core.slice(0, parenUnit.index);
      trail = parenUnit[0] + trail;
    } else {
      const unitMatch = TRAILING_PHYSICS_UNIT.exec(core);
      if (unitMatch && /[0-9°]$/.test(core.slice(0, unitMatch.index))) {
        core = core.slice(0, unitMatch.index);
        trail = unitMatch[0] + trail;
      }
    }
    textBuffer += lead;
    const latex = core === '' ? null : mathSpanToLatex(core);
    if (latex !== null) {
      flushText();
      parts.push({ kind: 'math', tex: latex, source: core });
    } else if (/\\[A-Za-z]+/.test(core)) {
      flushText();
      parts.push({ kind: 'text', value: core });
    } else {
      textBuffer += core;
    }
    textBuffer += trail;
    index = end;
  }
  flushText();
  return parts;
}

/** Validate before rendering so malformed OCR does not become a red KaTeX error. */
export function validLatex(source: string, displayMode = false): string | null {
  source = source.trim();
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (source.startsWith(open!) && source.endsWith(close!) && source.length > open!.length + close!.length) {
      source = source.slice(open!.length, -close!.length).trim();
      break;
    }
  }
  if (!source.trim() || source.length > 4000) return null;
  try {
    katex.renderToString(source, { displayMode, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000 });
    return source.trim();
  } catch {
    return null;
  }
}

export function segmentProblemText(text: string): ProblemTextPart[] {
  const parts: ProblemTextPart[] = [];
  const delimiters = /\$\$|\$|\\\[|\\\(/g;
  const escaped = (index: number): boolean => {
    let count = 0;
    while (index > 0 && text[--index] === '\\') count += 1;
    return count % 2 === 1;
  };
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = delimiters.exec(text)) !== null) {
    if (escaped(match.index)) continue;
    const open = match[0];
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open;
    let end = text.indexOf(close, delimiters.lastIndex);
    while (end >= 0 && (escaped(end) || (close.startsWith('$') && (text[end - 1] === '$' || text[end + close.length] === '$')))) {
      end = text.indexOf(close, end + 1);
    }
    parts.push(...segmentPlainText(text.slice(start, match.index)));
    if (end < 0) {
      // Preserve the prose following an incomplete formula instead of hiding the sentence.
      const boundary = text.slice(delimiters.lastIndex).search(/[\n\u3400-\u9fff，。；：！？]/);
      const stop = boundary < 0 ? text.length : delimiters.lastIndex + boundary;
      parts.push({ kind: 'text', value: text.slice(match.index, stop) });
      start = delimiters.lastIndex = stop;
      continue;
    }
    const candidate = text.slice(delimiters.lastIndex, end);
    const source = text.slice(match.index, end + close.length);
    const block = open === '$$' || open === '\\[';
    // A pair of currency signs alone is not evidence of a formula.
    const tex = /\\[a-zA-Z]+/.test(candidate) || (!/[\u3400-\u9fff，。；]/.test(candidate) && /[\p{L}\p{N}]/u.test(candidate))
      ? validLatex(candidate, block) : null;
    parts.push(tex === null ? { kind: 'text', value: source } : { kind: 'math', tex, source, ...(block ? { block } : {}) });
    start = delimiters.lastIndex = end + close.length;
  }
  parts.push(...segmentPlainText(text.slice(start)));
  return parts;
}
