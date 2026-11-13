/** 截断幂级数自动微分：第 k 项直接表示 f^(k)(x₀)/k!。
 * abs 在中心为 0 时分别沿左右分支传播，最终比较所需阶数的系数。
 */
import type { ExpressionNode } from '../labs/expr.ts';

type Series = number[];

export function localSeries(ast: ExpressionNode, values: Record<string, number>, order: number): number[] {
  const n = order;
  const constant = (v: number): Series => [v, ...Array<number>(n).fill(0)];
  const scale = (a: Series, k: number): Series => a.map((v) => v * k);
  const add = (a: Series, b: Series): Series => a.map((v, i) => v + b[i]!);
  const mul = (a: Series, b: Series): Series => a.map((_, k) => {
    let sum = 0; for (let j = 0; j <= k; j++) sum += a[j]! * b[k - j]!; return sum;
  });
  const inverse = (a: Series): Series => {
    if (a[0] === 0) throw new Error('展开中心的分母为 0');
    const out = constant(1 / a[0]!);
    for (let k = 1; k <= n; k++) {
      let sum = 0; for (let j = 1; j <= k; j++) sum += a[j]! * out[k - j]!;
      out[k] = -sum / a[0]!;
    }
    return out;
  };
  const derivative = (a: Series): Series => a.map((_, k) => (k + 1) * (a[k + 1] ?? 0));
  const primitive = (a: Series, value: number): Series => [value, ...a.slice(0, n).map((v, k) => v / (k + 1))];
  const exponential = (a: Series): Series => {
    const out = constant(Math.exp(a[0]!));
    for (let k = 1; k <= n; k++) {
      let sum = 0; for (let j = 1; j <= k; j++) sum += j * a[j]! * out[k - j]!;
      out[k] = sum / k;
    }
    return out;
  };
  const logarithm = (a: Series): Series => {
    if (a[0]! <= 0) throw new Error('对数或非整数幂在展开中心附近不满足实数定义域');
    return primitive(mul(derivative(a), inverse(a)), Math.log(a[0]!));
  };
  const power = (a: Series, b: Series, constantExponent = true): Series => {
    if (constantExponent && b.slice(1).every((v) => v === 0) && Number.isInteger(b[0])) {
      let exponent = Math.abs(b[0]!), out = constant(1), base = a;
      while (exponent > 0) {
        if (exponent % 2) out = mul(out, base);
        exponent = Math.floor(exponent / 2);
        if (exponent) base = mul(base, base);
      }
      return b[0]! < 0 ? inverse(out) : out;
    }
    return exponential(mul(b, logarithm(a)));
  };
  const dependsOnX = (node: ExpressionNode): boolean => {
    if (node.type === 'variable') return node.name === 'x';
    if (node.type === 'unary') return dependsOnX(node.arg);
    if (node.type === 'call') return node.args.some(dependsOnX);
    if (node.type === 'binary') return dependsOnX(node.left) || dependsOnX(node.right);
    return false;
  };
  const trig = (a: Series): [Series, Series] => {
    const sin = constant(Math.sin(a[0]!)), cos = constant(Math.cos(a[0]!));
    for (let k = 1; k <= n; k++) {
      let s = 0, c = 0;
      for (let j = 1; j <= k; j++) { s += j * a[j]! * cos[k - j]!; c -= j * a[j]! * sin[k - j]!; }
      sin[k] = s / k; cos[k] = c / k;
    }
    return [sin, cos];
  };
  const call = (name: string, a: Series, side: number): Series => {
    if (name === 'abs') {
      const k = a.findIndex((v) => v !== 0);
      return k < 0 ? a : scale(a, Math.sign(a[k]! * side ** k));
    }
    if (name === 'exp') return exponential(a);
    if (name === 'ln' || name === 'log') return logarithm(a);
    if (name === 'sqrt') return power(a, constant(0.5));
    if (['sin', 'cos', 'tan', 'cot', 'sec', 'csc'].includes(name)) {
      const [s, c] = trig(a);
      if (name === 'sin') return s;
      if (name === 'cos') return c;
      if (name === 'tan') return mul(s, inverse(c));
      if (name === 'cot') return mul(c, inverse(s));
      return inverse(name === 'sec' ? c : s);
    }
    if (['sinh', 'cosh', 'tanh'].includes(name)) {
      const positive = exponential(a), negative = exponential(scale(a, -1));
      const s = scale(add(positive, scale(negative, -1)), 0.5), c = scale(add(positive, negative), 0.5);
      return name === 'sinh' ? s : name === 'cosh' ? c : mul(s, inverse(c));
    }
    const aliases: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccot: 'acot', arcsec: 'asec', arccsc: 'acsc' };
    const key = aliases[name] ?? name;
    if (key === 'asin' || key === 'acos') {
      const factor = key === 'asin' ? 1 : -1;
      const denominator = power(add(constant(1), scale(mul(a, a), -1)), constant(-0.5));
      return primitive(scale(mul(derivative(a), denominator), factor), key === 'asin' ? Math.asin(a[0]!) : Math.acos(a[0]!));
    }
    if (key === 'atan' || key === 'acot') {
      if (key === 'acot' && a[0] === 0) throw new Error('acot 在该中心涉及分支，请改用 atan 或避开 0');
      return primitive(scale(mul(derivative(a), inverse(add(constant(1), mul(a, a)))), key === 'atan' ? 1 : -1), key === 'atan' ? Math.atan(a[0]!) : Math.atan(1 / a[0]!));
    }
    if (key === 'asec' || key === 'acsc') return call(key === 'asec' ? 'acos' : 'asin', inverse(a), side);
    throw new Error(`暂不支持 ${name} 的自动微分`);
  };
  const visit = (node: ExpressionNode, side: number): Series => {
    if (node.type === 'number') return constant(node.value);
    if (node.type === 'variable') {
      const result = constant(values[node.name]!);
      if (node.name === 'x' && n > 0) result[1] = 1;
      return result;
    }
    if (node.type === 'unary') return scale(visit(node.arg, side), node.op === '-' ? -1 : 1);
    if (node.type === 'call') return call(node.name, visit(node.args[0]!, side), side);
    const a = visit(node.left, side), b = visit(node.right, side);
    switch (node.op) {
      case '+': return add(a, b);
      case '-': return add(a, scale(b, -1));
      case '*': return mul(a, b);
      case '/': return mul(a, inverse(b));
      case '^': return power(a, b, !dependsOnX(node.right));
    }
  };
  const left = visit(ast, -1), right = visit(ast, 1);
  if (left.some((v, k) => !Number.isFinite(v) || !Number.isFinite(right[k]) || Math.abs(v - right[k]!) > 1e-9 * Math.max(Math.abs(v), Math.abs(right[k]!), 1e-300))) {
    throw new Error('所需阶数的左右导数不一致或超出定义域；请检查尖点与光滑性');
  }
  return left.map((v, k) => v / 2 + right[k]! / 2);
}
