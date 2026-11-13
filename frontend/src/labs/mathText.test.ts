import assert from 'node:assert/strict';
import test from 'node:test';
import { mathSpanToLatex, segmentProblemText, type ProblemTextPart } from './mathText.ts';

function mathOf(parts: ProblemTextPart[]): string[] {
  return parts.filter((part): part is Extract<ProblemTextPart, { kind: 'math' }> => part.kind === 'math').map((part) => part.tex);
}

test('集合描述式题目把分式、根号和不等式转成 LaTeX，文字保持原样', () => {
  const text = '已知平面区域 D={(x,y)|0<=y<=1/(x*sqrt(1+x^2)), x>=1}。';
  const parts = segmentProblemText(text);
  const math = mathOf(parts);
  assert.equal(math.length, 1);
  assert.match(math[0]!, /^D=/);
  assert.match(math[0]!, /\\frac\{1\}\{x\\sqrt\{1\+x\^\{2\}\}\}/);
  assert.match(math[0]!, /\\le y\\le/);
  assert.match(math[0]!, /x\\ge 1/);
  assert.equal(parts[0]!.kind, 'text');
  assert.equal(parts.at(-1)!.kind, 'text');
  assert.equal(
    parts.map((part) => (part.kind === 'math' ? part.source : part.value)).join(''),
    text,
  );
});

test('乘法与幂次按数学写法显示，不与正文混在一起', () => {
  const text = '曲线 3*x^3=y^5+2*y^3 在 x=1 对应点处的法线斜率为多少？';
  const math = mathOf(segmentProblemText(text));
  assert.deepEqual(math, ['3x^{3}=y^{5}+2y^{3}', 'x=1']);
});

test('函数调用、指数函数与分式保持原有结构', () => {
  const math = mathOf(segmentProblemText('求函数 f(x,y)=x*exp(cos(y))+x^2/2 的极值。'));
  assert.equal(math.length, 1);
  assert.match(math[0]!, /\\exp/);
  assert.match(math[0]!, /\\cos/);
  assert.match(math[0]!, /\\frac\{x\^\{2\}\}\{2\}/);
});

test('积分上下限与微分记号转成 LaTeX', () => {
  const math = mathOf(segmentProblemText('计算定积分 ∫_0^2 x^2 dx，并观察分割数的影响。'));
  assert.deepEqual(math, ['\\int_{0}^{2}x^{2}\\,\\mathrm{d}x']);
});

test('常见下标、上标数字和 Unicode 比较符也能识别', () => {
  const math = mathOf(segmentProblemText('初始点为 x0=0，曲线 y=-x²+x²+2x，且 X≥1。'));
  assert.deepEqual(math, ['x_{0}=0', 'y=-x^{2}+x^{2}+2x', 'X\\ge 1']);
});

test('OCR 残缺公式不硬转，保留原文避免改写题意', () => {
  for (const text of ['已知平面区域D=（x.y0≤y', 'x√1+x2', 'D=（x.y0≤y']) {
    const parts = segmentProblemText(text);
    assert.equal(mathOf(parts).length, 0, text);
    assert.equal(parts.map((part) => (part.kind === 'math' ? part.source : part.value)).join(''), text);
  }
});

test('编号、选项列表和年份不会被当成公式', () => {
  for (const text of [
    '28,22,20,19,8,12,15,5 是大根堆',
    'A.20,19,15,12,8,5',
    '2026-11-09 更新',
    '（19）（本题满分12分）',
    '对下图从 A 开始执行广度优先搜索。边：A-B, A-C, B-D, C-D, D-E。',
  ]) {
    assert.equal(mathOf(segmentProblemText(text)).length, 0, text);
  }
});

test('括号不配对或未知多字母记号时保留原文', () => {
  assert.equal(mathSpanToLatex('f(x=(x-3)^2'), null);
  assert.equal(mathSpanToLatex('x=abc+1'), null);
  assert.equal(mathSpanToLatex('x=1+'), null);
  assert.equal(mathSpanToLatex('f(x)'), null, '没有公式特征时不应转换');
});

test('纯文字题目输出单段原文，不改变字节', () => {
  const text = '求函数 f 在区间上的极值。\n（I）写出过程；\n（II）说明理由。';
  assert.deepEqual(segmentProblemText(text), [{ kind: 'text', value: text }]);
});
