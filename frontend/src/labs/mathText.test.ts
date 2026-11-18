import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionValueText, mathSpanToLatex, segmentProblemText, type ProblemTextPart } from './mathText.ts';

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

test('识别出的 LaTeX 公式按完整片段排版，不露出命令和定界符', () => {
  for (const [text, expected] of [
    [String.raw`计算 $\frac{1}{\sqrt{1+x^2}}$，说明理由。`, String.raw`\frac{1}{\sqrt{1+x^2}}`],
    [String.raw`计算 \(\int_0^1 x^2\,dx\)。`, String.raw`\int_0^1 x^2\,dx`],
    [String.raw`结果为 \[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]。`, String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`],
    ['求 $$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\n$$。', String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2}`],
    [String.raw`计算 \int_0^1 \frac{x}{\sqrt{1+x^2}}\,dx。`, String.raw`\int_0^1 \frac{x}{\sqrt{1+x^2}}\,dx`],
  ]) {
    const parts = segmentProblemText(text!);
    assert.deepEqual(mathOf(parts), [expected], text);
    assert.equal(parts.map(part => part.kind === 'math' ? part.source : part.value).join(''), text);
  }
});

test('带中文说明的公式可以排版，坏公式与普通美元金额保留原文', () => {
  assert.deepEqual(mathOf(segmentProblemText(String.raw`其中 $x>0\quad\text{且}\quad y\le 1$。`)),
    [String.raw`x>0\quad\text{且}\quad y\le 1`]);
  for (const text of [String.raw`结果 $\frac{1}{$。`, String.raw`结果 $\unknown{x}$。`, '费用 $20，另付 $30。']) {
    assert.equal(mathOf(segmentProblemText(text)).length, 0, text);
    assert.equal(segmentProblemText(text).map(part => part.kind === 'math' ? part.source : part.value).join(''), text);
  }
});

test('显式公式支持加减式、负数与换行，Python 幂符号按指数显示', () => {
  assert.deepEqual(mathOf(segmentProblemText('结果为 $a+b$，系数为 $-1$。')), ['a+b', '-1']);
  assert.deepEqual(mathOf(segmentProblemText('求 $\\lim_{x\\to 0}\n\\frac{\\sin x}{x}$。')),
    [String.raw`\lim_{x\to 0}
\frac{\sin x}{x}`]);
  assert.equal(mathSpanToLatex('x**2/2'), '\\frac{x^{2}}{2}');
  assert.deepEqual(mathOf(segmentProblemText('条件为 $α≤1$。')), ['α≤1']);
});

test('结构化条件保留矩阵行、对象内容与空值，不显示 object Object', () => {
  assert.equal(conditionValueText([[1, 2], [3, 4]]), '[[1, 2], [3, 4]]');
  assert.equal(conditionValueText({ lower: 'sqrt(2)', enabled: true }), 'lower: sqrt(2)；enabled: 是');
  assert.equal(conditionValueText(null), '—');
});

test('转义美元符号不会提前结束公式，不匹配残缺的双美元定界符', () => {
  assert.deepEqual(mathOf(segmentProblemText(String.raw`价格 $p=\$20$，因此选 B。`)), [String.raw`p=\$20`]);
  for (const text of ['结果 $$x^2$，因此选 B。', '结果 $x^2$$，因此选 B。']) {
    const parts = segmentProblemText(text);
    assert.equal(mathOf(parts).length, 0);
    assert.equal(parts.map(part => part.kind === 'math' ? part.source : part.value).join(''), text);
  }
});

test('内核返回的反三角函数和绝对值写法也按公式显示', () => {
  assert.equal(mathSpanToLatex('x*atan(x)'), 'x\\arctan\\left(x\\right)');
  assert.equal(mathSpanToLatex('asin(x)'), '\\arcsin\\left(x\\right)');
  assert.equal(mathSpanToLatex('Abs(x)'), '\\left|x\\right|');
});
