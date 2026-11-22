import test from 'node:test';
import assert from 'node:assert/strict';
import { latexToPlain, plainToLatex } from './mathLiveBridge.ts';

test('latexToPlain converts fractions, roots, trig, and constants cleanly', () => {
  assert.equal(latexToPlain('\\frac{x^2+1}{x-1}'), '(x^2+1)/(x-1)');
  assert.equal(latexToPlain('\\sqrt{x+1}'), 'sqrt(x+1)');
  assert.equal(latexToPlain('\\frac{\\pi}{2}'), 'pi/2');
  assert.equal(latexToPlain('\\infty'), 'oo');
  assert.equal(latexToPlain('-\\infty'), '-oo');
  assert.equal(latexToPlain('\\sin(x)'), 'sin(x)');
  assert.equal(latexToPlain('\\ln(x)'), 'ln(x)');
});

test('latexToPlain preserves ODE prime notation and equations', () => {
  assert.equal(latexToPlain("y''+y=0"), "y''+y=0");
  assert.equal(latexToPlain('x^2+y^2=1'), 'x^2+y^2=1');
});

test('plainToLatex renders infinity and standard expressions', () => {
  assert.equal(plainToLatex('oo', [], true), '\\infty');
  assert.equal(plainToLatex('-oo', [], true), '-\\infty');
  const tex = plainToLatex('x^2+1', ['x']);
  assert.ok(tex.includes('x'));
});
