import assert from 'node:assert/strict';
import test from 'node:test';
import { integralTitleFormula, readableProblemTitle } from './problemTitle.ts';
import { segmentProblemText } from './mathText.ts';
import type { LabProblem } from './types.ts';

function problem(title: string, expression = 'x*atan(x)', teaching = false): LabProblem {
  return {title, model:{subject:'calculus',kind:'antiderivative',variable:'x',expression,teaching},
    recognition:{formulas:[{tex:String.raw`\int x\operatorname{atan}{\left(x\right)}\,\mathrm{d}x`}]}} as LabProblem;
}

test('OCR formula-only title uses the recognized integral, preserving its sign and differential', () => {
  const result=integralTitleFormula(problem('xarctanxdx'));
  assert.ok(result);
  assert.match(result.tex,/^\\int /);
  assert.match(result.tex,/\\arctan/);
  assert.match(result.tex,/\\mathrm\{d\}x/);
  assert.equal(result.prefix,'');
});

test('question numbering is retained around a recovered title formula', () => {
  assert.equal(integralTitleFormula(problem('第 2 题 · xarctanxdx'))?.prefix,'第 2 题 · ');
});

test('equivalent power spellings still match the recognized formula', () => {
  const p=problem('x**2dx','x^2');
  p.recognition.formulas[0]!.tex=String.raw`\int x^{2}\,\mathrm{d}x`;
  assert.ok(integralTitleFormula(p));
});

test('normal prose and unrelated custom titles are not replaced by model formulas', () => {
  for(const title of ['求不定积分并说明方法','My calculus exercise','xarctanxdx compared with another function']) {
    assert.equal(integralTitleFormula(problem(title)),null);
  }
});

test('teaching models and OCR titles that disagree with the recognized integrand stay unchanged', () => {
  assert.equal(integralTitleFormula(problem('xarctanxdx','x^2',true)),null);
  assert.equal(integralTitleFormula(problem('xarctanxdx','x^2')),null);
});

test('a saved title truncated inside a limit formula is restored from the matching question', () => {
  const text = String.raw`求 $\lim_{x\to 0}\frac{(1+ax^2)^{\sin x}-1}{x^3}$，说明计算过程。`;
  const p = { title: text.slice(0, 47) + '…', text } as LabProblem;
  const title = readableProblemTitle(p);
  assert.equal(title, text);
  const parts = segmentProblemText(title);
  assert.deepEqual(parts.filter(part => part.kind === 'math').map(part => part.tex),
    [String.raw`\lim_{x\to 0}\frac{(1+ax^2)^{\sin x}-1}{x^3}`]);
  assert.ok(!parts.some(part => part.kind === 'text' && part.value.includes('$')));
});

test('title recovery preserves question numbering and restores multiline math', () => {
  const text = '求极限 $$\n\\lim_{x\\to 0}\\frac{\\sin x}{x}\n$$，说明理由。';
  assert.equal(readableProblemTitle({ title: '第 2 题 · 求极限 $$', text } as LabProblem), `第 2 题 · ${text}`);
});

test('ordinary and custom titles are not replaced by a different question', () => {
  for (const title of ['求函数的极值', '另一道题 $\\lim…', '普通文字标题…']) {
    assert.equal(readableProblemTitle({ title, text: '求 $\\lim_{x\\to 0} x$。' } as LabProblem), title);
  }
  assert.equal(readableProblemTitle({ title: '求 $x^2$', text: '求 $x^2$ 的最小值。' } as LabProblem), '求 $x^2$');
});
