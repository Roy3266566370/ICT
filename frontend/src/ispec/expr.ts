/**
 * expr.ts —— iSpec 受限表达式的词法分析、递归下降解析与纯函数求值。
 *
 * 为什么自写而不用动态代码执行（`eval` / `Function` 构造器）：
 *  - iSpec 是可被上传/识别的外部数据，直接用 JS 求值等于执行任意代码；
 *  - 受限文法只允许数字、标识符、`+ - * / % **`、一元 `- + !`、比较、`&& ||`、
 *    三元 `? :`、括号与白名单函数，语义完全可控、可审计；
 *  - 求值失败要能定位到列号，动态求值拿不到这种位置信息。
 *
 * 约定：
 *  - 所有函数都是纯函数、无副作用；
 *  - 除零 / 负数开方等得到 `Infinity` / `NaN`，仍然返回 `ok: true`，
 *    由约束层（`constraints`）决定是否算违规；
 *  - 错误信息统一以「第 N 列：」开头，N 为 1-based 列号。
 *
 * 文法（自低到高优先级）：
 *   expression   := ternary
 *   ternary      := logicalOr ('?' expression ':' ternary)?
 *   logicalOr    := logicalAnd ('||' logicalAnd)*
 *   logicalAnd   := equality ('&&' equality)*
 *   equality     := comparison (('==' | '!=') comparison)*
 *   comparison   := additive (('>' | '>=' | '<' | '<=') additive)*
 *   additive     := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary        := ('-' | '+' | '!') unary | power
 *   power        := primary ('**' unary)?
 *   primary      := NUMBER | STRING | identifier | identifier '(' args ')' | '(' expression ')'
 */

/** 表达式可产生的值：数值、布尔或文本（文本用于枚举参数的比较）。 */
export type ExprValue = number | boolean | string;

export type UnaryOperator = '-' | '+' | '!';

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '**'
  | '>'
  | '>='
  | '<'
  | '<='
  | '=='
  | '!='
  | '&&'
  | '||';

/** 抽象语法树节点。`pos` 为 0-based 字符下标，报错时转成 1-based 列号。 */
export type ExprNode =
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'string'; value: string; pos: number }
  | { kind: 'identifier'; name: string; pos: number }
  | { kind: 'unary'; op: UnaryOperator; operand: ExprNode; pos: number }
  | { kind: 'binary'; op: BinaryOperator; left: ExprNode; right: ExprNode; pos: number }
  | { kind: 'call'; name: string; args: ExprNode[]; pos: number }
  | { kind: 'conditional'; test: ExprNode; consequent: ExprNode; alternate: ExprNode; pos: number };

export interface ExprSuccess {
  ok: true;
  value: ExprValue;
}

export interface ExprFailure {
  ok: false;
  error: string;
  position: number;
}

export type ExprResult = ExprSuccess | ExprFailure;

export interface ParsedExpression {
  ok: true;
  ast: ExprNode;
  /** 表达式中出现的所有标识符（去重、按出现顺序），供依赖分析与循环检测使用 */
  identifiers: string[];
}

export type ParseResult = ParsedExpression | ExprFailure;

/* -------------------------------------------------------------------------- */
/* 语法错误与运行时错误（内部使用，对外只暴露可读字符串 + 列号）                 */
/* -------------------------------------------------------------------------- */

class ExprSyntaxError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'ExprSyntaxError';
    this.position = position;
  }
}

class ExprRuntimeError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'ExprRuntimeError';
    this.position = position;
  }
}

/* -------------------------------------------------------------------------- */
/* 函数白名单                                                                  */
/* -------------------------------------------------------------------------- */

interface FunctionSignature {
  min: number;
  max: number;
}

const FUNCTION_SIGNATURES: Readonly<Record<string, FunctionSignature>> = {
  abs: { min: 1, max: 1 },
  min: { min: 1, max: Number.POSITIVE_INFINITY },
  max: { min: 1, max: Number.POSITIVE_INFINITY },
  sqrt: { min: 1, max: 1 },
  pow: { min: 2, max: 2 },
  round: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  asin: { min: 1, max: 1 },
  acos: { min: 1, max: 1 },
  atan2: { min: 2, max: 2 },
  log: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
};

/** 白名单函数名（按定义顺序），用于把非法函数名的错误信息说清楚。 */
export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTION_SIGNATURES);

/** 取第 index 个参数（已经过调用点与参数个数校验，这里只做类型收窄）。 */
function argAt(args: readonly number[], index: number): number {
  const value = args[index];
  return value === undefined ? Number.NaN : value;
}

const FUNCTION_IMPL: Readonly<Record<string, (args: readonly number[]) => number>> = {
  abs: (args) => Math.abs(argAt(args, 0)),
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  sqrt: (args) => Math.sqrt(argAt(args, 0)),
  pow: (args) => Math.pow(argAt(args, 0), argAt(args, 1)),
  round: (args) => Math.round(argAt(args, 0)),
  floor: (args) => Math.floor(argAt(args, 0)),
  ceil: (args) => Math.ceil(argAt(args, 0)),
  sin: (args) => Math.sin(argAt(args, 0)),
  cos: (args) => Math.cos(argAt(args, 0)),
  tan: (args) => Math.tan(argAt(args, 0)),
  asin: (args) => Math.asin(argAt(args, 0)),
  acos: (args) => Math.acos(argAt(args, 0)),
  atan2: (args) => Math.atan2(argAt(args, 0), argAt(args, 1)),
  log: (args) => Math.log(argAt(args, 0)),
  exp: (args) => Math.exp(argAt(args, 0)),
};

/* -------------------------------------------------------------------------- */
/* 词法分析                                                                    */
/* -------------------------------------------------------------------------- */

type Token =
  | { kind: 'number'; text: string; position: number; value: number }
  | { kind: 'string'; text: string; position: number; value: string }
  | { kind: 'identifier'; text: string; position: number }
  | { kind: 'punct'; text: string; position: number }
  | { kind: 'eof'; text: ''; position: number };

/** 按长度降序排列，保证 `**` / `>=` 先于 `*` / `>` 命中。 */
const OPERATORS: readonly string[] = ['**', '>=', '<=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '>', '<', '!'];

const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/;
const DIGIT_PATTERN = /[0-9]/;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && DIGIT_PATTERN.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    // 数字：允许 12 / 12.5 / .5 / 1e-3
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1]))) {
      const match = NUMBER_PATTERN.exec(source.slice(index));
      if (match === null) {
        throw new ExprSyntaxError(`第 ${index + 1} 列：无法识别数字`, index);
      }
      const text = match[0];
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ExprSyntaxError(`第 ${index + 1} 列：数字「${text}」超出可表示范围`, index);
      }
      tokens.push({ kind: 'number', text, position: index, value });
      index += text.length;
      continue;
    }

    // 文本字面量：'A' / "全部"，用于枚举参数比较
    if (char === '"' || char === "'") {
      const quote = char;
      let cursor = index + 1;
      let text = '';
      let closed = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === undefined) break;
        if (current === '\\') {
          const next = source[cursor + 1];
          if (next === undefined) break;
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          cursor += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          cursor += 1;
          break;
        }
        text += current;
        cursor += 1;
      }
      if (!closed) {
        throw new ExprSyntaxError(`第 ${index + 1} 列：文本缺少结束引号`, index);
      }
      tokens.push({ kind: 'string', text, position: index, value: text });
      index = cursor;
      continue;
    }

    // 标识符（参数 / 派生量 / 函数名）
    if (/[A-Za-z_]/.test(char)) {
      const match = IDENTIFIER_PATTERN.exec(source.slice(index));
      if (match === null) {
        throw new ExprSyntaxError(`第 ${index + 1} 列：无法识别标识符`, index);
      }
      const text = match[0];
      tokens.push({ kind: 'identifier', text, position: index });
      index += text.length;
      continue;
    }

    // 运算符
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator !== undefined) {
      tokens.push({ kind: 'punct', text: operator, position: index });
      index += operator.length;
      continue;
    }

    // 括号 / 逗号 / 三元符号
    if (char === '(' || char === ')' || char === ',' || char === '?' || char === ':') {
      tokens.push({ kind: 'punct', text: char, position: index });
      index += 1;
      continue;
    }

    throw new ExprSyntaxError(`第 ${index + 1} 列：无法识别的字符「${char}」`, index);
  }

  tokens.push({ kind: 'eof', text: '', position: source.length });
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* 语法分析                                                                    */
/* -------------------------------------------------------------------------- */

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    const token = this.tokens[this.index];
    return token === undefined ? { kind: 'eof', text: '', position: 0 } : token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== 'eof') this.index += 1;
    return token;
  }

  /** 命中运算符时返回它的位置，否则返回 null（不消费）。 */
  private matchOperator(text: string): number | null {
    const token = this.peek();
    if (token.kind === 'punct' && token.text === text) {
      this.index += 1;
      return token.position;
    }
    return null;
  }

  private expect(text: string, context: string): void {
    const token = this.peek();
    if (token.kind === 'punct' && token.text === text) {
      this.index += 1;
      return;
    }
    throw new ExprSyntaxError(`第 ${token.position + 1} 列：${context}缺少「${text}」`, token.position);
  }

  parseAll(): ExprNode {
    const first = this.peek();
    if (first.kind === 'eof') {
      throw new ExprSyntaxError('第 1 列：表达式为空', 0);
    }
    const node = this.parseExpression();
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      throw new ExprSyntaxError(`第 ${rest.position + 1} 列：多余的「${rest.text}」`, rest.position);
    }
    return node;
  }

  private parseExpression(): ExprNode {
    return this.parseTernary();
  }

  private parseTernary(): ExprNode {
    const test = this.parseOr();
    const pos = this.matchOperator('?');
    if (pos === null) return test;
    const consequent = this.parseExpression();
    this.expect(':', '三元运算符 ?: ');
    const alternate = this.parseTernary();
    return { kind: 'conditional', test, consequent, alternate, pos };
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    for (;;) {
      const pos = this.matchOperator('||');
      if (pos === null) return left;
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right, pos };
    }
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality();
    for (;;) {
      const pos = this.matchOperator('&&');
      if (pos === null) return left;
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&&', left, right, pos };
    }
  }

  private parseEquality(): ExprNode {
    let left = this.parseComparison();
    for (;;) {
      const pos = this.matchOperator('==') ?? this.matchOperator('!=');
      if (pos === null) return left;
      const op: BinaryOperator = this.tokens[this.index - 1]?.text === '==' ? '==' : '!=';
      const right = this.parseComparison();
      left = { kind: 'binary', op, left, right, pos };
    }
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive();
    const operators: ReadonlyArray<BinaryOperator> = ['>=', '<=', '>', '<'];
    for (;;) {
      let matched: BinaryOperator | null = null;
      let pos: number | null = null;
      for (const operator of operators) {
        const candidate = this.matchOperator(operator);
        if (candidate !== null) {
          matched = operator;
          pos = candidate;
          break;
        }
      }
      if (matched === null || pos === null) return left;
      const right = this.parseAdditive();
      left = { kind: 'binary', op: matched, left, right, pos };
    }
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const pos = this.matchOperator('+') ?? this.matchOperator('-');
      if (pos === null) return left;
      const op: BinaryOperator = this.tokens[this.index - 1]?.text === '+' ? '+' : '-';
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right, pos };
    }
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const pos =
        this.matchOperator('*') ?? this.matchOperator('/') ?? this.matchOperator('%');
      if (pos === null) return left;
      const raw = this.tokens[this.index - 1]?.text;
      const op: BinaryOperator = raw === '/' ? '/' : raw === '%' ? '%' : '*';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right, pos };
    }
  }

  private parseUnary(): ExprNode {
    const token = this.peek();
    if (token.kind === 'punct' && (token.text === '-' || token.text === '+' || token.text === '!')) {
      this.index += 1;
      const operand = this.parseUnary();
      return { kind: 'unary', op: token.text, operand, pos: token.position };
    }
    return this.parsePower();
  }

  private parsePower(): ExprNode {
    const base = this.parsePrimary();
    const pos = this.matchOperator('**');
    if (pos === null) return base;
    // 右结合，并允许 `2 ** -1`
    const exponent = this.parseUnary();
    return { kind: 'binary', op: '**', left: base, right: exponent, pos };
  }

  private parsePrimary(): ExprNode {
    const token = this.advance();

    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: token.value, pos: token.position };

      case 'string':
        return { kind: 'string', value: token.value, pos: token.position };

      case 'identifier': {
        // 函数调用
        if (this.matchOperator('(') !== null) {
          const args: ExprNode[] = [];
          if (this.matchOperator(')') === null) {
            for (;;) {
              args.push(this.parseExpression());
              if (this.matchOperator(',') !== null) continue;
              this.expect(')', `函数 ${token.text} 的参数列表`);
              break;
            }
          }
          const signature = FUNCTION_SIGNATURES[token.text];
          if (signature === undefined) {
            throw new ExprSyntaxError(
              `第 ${token.position + 1} 列：未知函数 ${token.text}（白名单：${FUNCTION_NAMES.join('、')}）`,
              token.position,
            );
          }
          const arity =
            signature.max === signature.min
              ? `${signature.min} 个参数`
              : Number.isFinite(signature.max)
                ? `${signature.min}~${signature.max} 个参数`
                : `至少 ${signature.min} 个参数`;
          if (args.length < signature.min || args.length > signature.max) {
            throw new ExprSyntaxError(
              `第 ${token.position + 1} 列：函数 ${token.text} 需要${arity}，实际 ${args.length} 个`,
              token.position,
            );
          }
          return { kind: 'call', name: token.text, args, pos: token.position };
        }
        return { kind: 'identifier', name: token.text, pos: token.position };
      }

      case 'punct': {
        if (token.text === '(') {
          const inner = this.parseExpression();
          this.expect(')', '括号表达式');
          return inner;
        }
        throw new ExprSyntaxError(
          `第 ${token.position + 1} 列：此处需要数字、标识符或括号，实际是「${token.text}」`,
          token.position,
        );
      }

      case 'eof':
        throw new ExprSyntaxError(`第 ${token.position + 1} 列：表达式意外结束`, token.position);
    }

    throw new ExprSyntaxError('第 1 列：无法解析的记号', 0);
  }
}

/* -------------------------------------------------------------------------- */
/* 依赖收集                                                                    */
/* -------------------------------------------------------------------------- */

function walk(node: ExprNode, visit: (node: ExprNode) => void): void {
  visit(node);
  switch (node.kind) {
    case 'unary':
      walk(node.operand, visit);
      return;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      return;
    case 'call':
      node.args.forEach((arg) => walk(arg, visit));
      return;
    case 'conditional':
      walk(node.test, visit);
      walk(node.consequent, visit);
      walk(node.alternate, visit);
      return;
    default:
      return;
  }
}

/** 表达式里引用到的标识符（去重，按首次出现顺序）。 */
export function collectIdentifiers(ast: ExprNode): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  walk(ast, (node) => {
    if (node.kind !== 'identifier') return;
    if (seen.has(node.name)) return;
    seen.add(node.name);
    ordered.push(node.name);
  });
  return ordered;
}

/* -------------------------------------------------------------------------- */
/* 求值                                                                        */
/* -------------------------------------------------------------------------- */

function isTruthyValue(value: ExprValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  return value.length > 0;
}

/** 宽松数值转换（用于比较）：无法转换时返回 NaN，不抛错。 */
function safeNumber(value: ExprValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/** 严格数值转换（用于算术）：文本无法转成数字时报可读错误。 */
function requireNumber(value: ExprValue, pos: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const trimmed = value.trim();
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new ExprRuntimeError(
      `第 ${pos + 1} 列：算术运算需要数值，文本「${value}」无法转换为数字`,
      pos,
    );
  }
  return parsed;
}

function equals(left: ExprValue, right: ExprValue): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left === right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right;
  return safeNumber(left) === safeNumber(right);
}

function relational(
  op: '>' | '>=' | '<' | '<=',
  left: ExprValue,
  right: ExprValue,
): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    if (op === '>') return left > right;
    if (op === '>=') return left >= right;
    if (op === '<') return left < right;
    return left <= right;
  }
  const a = safeNumber(left);
  const b = safeNumber(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  return a <= b;
}

function applyBinary(op: BinaryOperator, left: ExprValue, right: ExprValue, pos: number): ExprValue {
  switch (op) {
    case '+':
      return requireNumber(left, pos) + requireNumber(right, pos);
    case '-':
      return requireNumber(left, pos) - requireNumber(right, pos);
    case '*':
      return requireNumber(left, pos) * requireNumber(right, pos);
    case '/':
      // 除零得到 Infinity / NaN，但仍然是合法结果（约束层负责判定）
      return requireNumber(left, pos) / requireNumber(right, pos);
    case '%':
      return requireNumber(left, pos) % requireNumber(right, pos);
    case '**':
      return Math.pow(requireNumber(left, pos), requireNumber(right, pos));
    case '==':
      return equals(left, right);
    case '!=':
      return !equals(left, right);
    case '>':
    case '>=':
    case '<':
    case '<=':
      return relational(op, left, right);
    default:
      return Number.NaN;
  }
}

function evalNode(node: ExprNode, scope: Record<string, ExprValue>, finiteOnly=false): ExprValue {
  const value=evalNodeUnchecked(node,scope,finiteOnly);
  if(finiteOnly && typeof value==='number' && !Number.isFinite(value)) throw new ExprRuntimeError('当前输入超出公式定义域或产生非有限数值',node.pos);
  return value;
}

function evalNodeUnchecked(node: ExprNode, scope: Record<string, ExprValue>, finiteOnly:boolean): ExprValue {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'identifier': {
      const value = scope[node.name];
      if (value === undefined) {
        throw new ExprRuntimeError(`第 ${node.pos + 1} 列：未知标识符 ${node.name}`, node.pos);
      }
      return value;
    }
    case 'unary': {
      const operand = evalNode(node.operand, scope, finiteOnly);
      if (node.op === '!') return !isTruthyValue(operand);
      const numeric = requireNumber(operand, node.pos);
      return node.op === '-' ? -numeric : numeric;
    }
    case 'binary': {
      if (node.op === '&&') {
        const left = evalNode(node.left, scope, finiteOnly);
        if (!isTruthyValue(left)) return false;
        return isTruthyValue(evalNode(node.right, scope, finiteOnly));
      }
      if (node.op === '||') {
        const left = evalNode(node.left, scope, finiteOnly);
        if (isTruthyValue(left)) return true;
        return isTruthyValue(evalNode(node.right, scope, finiteOnly));
      }
      const left = evalNode(node.left, scope, finiteOnly);
      const right = evalNode(node.right, scope, finiteOnly);
      return applyBinary(node.op, left, right, node.pos);
    }
    case 'call': {
      const impl = FUNCTION_IMPL[node.name];
      if (impl === undefined) {
        throw new ExprRuntimeError(
          `第 ${node.pos + 1} 列：未知函数 ${node.name}（白名单：${FUNCTION_NAMES.join('、')}）`,
          node.pos,
        );
      }
      const args = node.args.map((arg) => requireNumber(evalNode(arg, scope, finiteOnly), arg.pos));
      return impl(args);
    }
    case 'conditional':
      return isTruthyValue(evalNode(node.test, scope, finiteOnly))
        ? evalNode(node.consequent, scope, finiteOnly)
        : evalNode(node.alternate, scope, finiteOnly);
    default:
      return Number.NaN;
  }
}

/** 求值一棵已解析的语法树。纯函数：只读 `scope`，不修改任何外部状态。 */
export function evaluateAst(node: ExprNode, scope: Record<string, ExprValue>, finiteOnly=false): ExprResult {
  try {
    return { ok: true, value: evalNode(node, scope, finiteOnly) };
  } catch (error) {
    if (error instanceof ExprRuntimeError) {
      return { ok: false, error: error.message, position: error.position };
    }
    return { ok: false, error: `第 ${node.pos + 1} 列：表达式求值失败`, position: node.pos };
  }
}

/** 解析表达式源码。 */
export function parseExpression(source: string): ParseResult {
  try {
    const ast = new Parser(tokenize(source)).parseAll();
    return { ok: true, ast, identifiers: collectIdentifiers(ast) };
  } catch (error) {
    if (error instanceof ExprSyntaxError) {
      return { ok: false, error: error.message, position: error.position };
    }
    return { ok: false, error: '第 1 列：表达式解析失败', position: 0 };
  }
}

/** 解析并求值：`parseExpression` + `evaluateAst` 的便捷入口。 */
export function evaluateExpression(source: string, scope: Record<string, ExprValue>): ExprResult {
  const parsed = parseExpression(source);
  if (!parsed.ok) return parsed;
  return evaluateAst(parsed.ast, scope);
}

/** 供约束层复用：判断表达式结果是否为「通过」。 */
export { isTruthyValue };