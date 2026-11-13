import assert from 'node:assert/strict';
import test from 'node:test';
import { integralTitleFormula } from './problemTitle.ts';
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
