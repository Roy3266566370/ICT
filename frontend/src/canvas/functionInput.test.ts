import assert from 'node:assert/strict';
import test from 'node:test';
import { latexToPlain } from '../labs/mathLiveBridge.ts';
import { compileFunction, functionExpressionLatex, functionValue } from './calculus.ts';

test('函数源图形编辑往返保留参数、优先级和定义域', () => {
  const params = { a: 2, b: 1, c: -1 };
  for (const expression of [
    'a*x^2+b*x+c', 'a*sin(x+b)+c', 'sin(x)/x', 'ln(x)', 'sqrt(abs(x))', 'exp(a*x)',
    'pi*x+e', '(-x)^2', '(1e-8)^2', 'a-(x-1)', 'factorial(x)', 'acot(x)', 'arccsc(x)',
  ]) {
    const original = compileFunction(functionValue(expression, params));
    const converted = latexToPlain(functionExpressionLatex(expression), true);
    const roundtrip = compileFunction(functionValue(converted, params));
    for (const x of [-2, -0.5, 0, 0.5, 2, 3]) assert.equal(roundtrip(x), original(x), expression);
  }
});

test('数学键盘连续输入的变量和函数转成乘法，非法表达式无法提交', () => {
  assert.equal(latexToPlain('a\\sin\\left(x\\right)', true), 'a*sin(x)');
  assert.equal(latexToPlain('a x+b', true), 'a*x+b');
  assert.throws(() => functionValue(latexToPlain('y+1', true), {}));
  assert.throws(() => functionValue(latexToPlain('\\frac{1}{\\placeholder{}}', true), {}));
});
