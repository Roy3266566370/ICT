import assert from 'node:assert/strict';
import test from 'node:test';

import { applyKeypadKey, KEYPAD_KEYS } from './mathKeypadActions.ts';

function findKey(id: string) {
  for (const list of Object.values(KEYPAD_KEYS)) {
    const found = list.find((item) => item.id === id);
    if (found) return found;
  }
  throw new Error(`未找到按键 ${id}`);
}

test('mathKeypadActions: 表达式模式支持光标落点插入、包裹选区与退格移动', () => {
  // 空输入框插入 sqrt(|)
  let state = applyKeypadKey({ value: '', start: 0, end: 0 }, findKey('sqrt'), 'expr');
  assert.deepEqual(state, { value: 'sqrt()', start: 5, end: 5 });

  // 在光标处输入 x 与 ^2
  state = applyKeypadKey(state, findKey('x'), 'expr');
  state = applyKeypadKey(state, findKey('pow2'), 'expr');
  assert.deepEqual(state, { value: 'sqrt(x^2)', start: 8, end: 8 });

  // 选中 "x^2" 按分数键，自动包裹进分子并定位到分子后
  const wrapped = applyKeypadKey({ value: 'x^2', start: 0, end: 3 }, findKey('frac'), 'expr');
  assert.deepEqual(wrapped, { value: '(x^2)/()', start: 4, end: 4 });

  // 退格与清空
  const back = applyKeypadKey({ value: 'sin(x)', start: 5, end: 5 }, findKey('backspace'), 'expr');
  assert.deepEqual(back, { value: 'sin()', start: 4, end: 4 });
  assert.deepEqual(applyKeypadKey(back, findKey('clear'), 'expr'), { value: '', start: 0, end: 0 });
});

test('mathKeypadActions: LaTeX 模式输出标准 LaTeX 并定位光标到占位处', () => {
  const frac = applyKeypadKey({ value: '', start: 0, end: 0 }, findKey('frac'), 'latex');
  assert.deepEqual(frac, { value: '\\frac{}{}', start: 6, end: 6 });

  const alpha = applyKeypadKey({ value: 'f(', start: 2, end: 2 }, findKey('alpha'), 'latex');
  assert.deepEqual(alpha, { value: 'f(\\alpha', start: 8, end: 8 });
});
