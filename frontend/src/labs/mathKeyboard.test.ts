import assert from 'node:assert/strict';
import test from 'node:test';
import { editMath, inspectMath, type MathEdit } from './mathKeyboard.ts';
import { compileExpression } from './expr.ts';

test('按钮可从空白构造 x arctan(x)，括号内光标和最终求值正确', () => {
  let state: MathEdit = { value: '', start: 0, end: 0 };
  for (const key of ['x', '*', 'arctan', 'x']) state = editMath(state, key);
  assert.equal(state.value, 'x*arctan(x)');
  assert.equal(state.start, 10);
  assert.ok(Math.abs(compileExpression(state.value).eval({ x: 1 }) - Math.PI / 4) < 1e-10);
  assert.match(inspectMath(state.value).tex!, /\\arctan/);
});

test('分式模板分别填写分子分母，保持分组含义', () => {
  let state: MathEdit = { value: '', start: 0, end: 0 };
  for (const key of ['fraction', '1', 'next', 'x', '+', '1']) state = editMath(state, key);
  assert.equal(state.value, '(1)/(x+1)');
  assert.equal(compileExpression(state.value).eval({ x: 3 }), 0.25);
  assert.match(inspectMath(state.value).tex!, /\\frac/);
});

test('选中内容整体加幂或包裹函数，不改变运算优先级', () => {
  const state = editMath({ value: 'x+1', start: 0, end: 3 }, 'power');
  assert.equal(state.value, '(x+1)^()');
  const squared = editMath(state, '2');
  assert.equal(compileExpression(squared.value).eval({ x: 2 }), 9);
  const rooted = editMath({ value: 'x+1', start: 0, end: 3 }, 'sqrt');
  assert.equal(rooted.value, 'sqrt(x+1)');
  assert.equal(rooted.start, rooted.value.length);
});

test('退格删除选择或前一个字符，左右移动不会越界', () => {
  assert.deepEqual(editMath({ value: 'x+1', start: 1, end: 3 }, 'backspace'), { value: 'x', start: 1, end: 1 });
  assert.deepEqual(editMath({ value: 'x', start: 0, end: 0 }, 'backspace'), { value: 'x', start: 0, end: 0 });
  assert.equal(editMath({ value: 'x', start: 0, end: 1 }, 'right').start, 1);
  assert.equal(editMath({ value: 'x', start: 0, end: 0 }, 'left').start, 0);
});

test('不完整和未知函数提示错误，合法函数在定义域外仍可输入', () => {
  assert.ok(inspectMath('sqrt()').error);
  assert.ok(inspectMath('x+').error);
  assert.ok(inspectMath('unknown(x)').error);
  assert.ok(inspectMath('').error);
  assert.equal(inspectMath('ln(x)').error, null);
  assert.equal(inspectMath('lnx').error, null);
  assert.match(inspectMath('lnx').tex!, /\\ln/);
  assert.equal(inspectMath('(x^x-1)/(lnx*ln(1-x))').error, null);
  assert.match(inspectMath('(x^x-1)/(lnx*ln(1-x))').tex!, /\\ln/);
  assert.ok(Math.abs(compileExpression('(x^x-1)/(lnx*ln(1-x))').eval({ x: 0.5 }) - ((0.5 ** 0.5 - 1) / (Math.log(0.5) * Math.log(0.5)))) < 1e-12);
  assert.equal(inspectMath('x*y', ['x', 'y']).error, null);
  assert.equal(inspectMath('2').tex, '2');
});

test('相邻的变量、常数和函数自动补乘号，连续数字仍组成一个数', () => {
  let state: MathEdit = { value: '', start: 0, end: 0 };
  for (const key of ['2', '3', 'x', 'arctan', 'x']) state = editMath(state, key);
  assert.equal(state.value, '23*x*arctan(x)');
  assert.equal(inspectMath(state.value).error, null);
  const group = editMath({ value: 'x', start: 1, end: 1 }, 'group');
  assert.equal(group.value, 'x*()');
  assert.equal(group.start, 3);
});
