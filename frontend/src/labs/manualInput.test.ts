import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualInputError, manualConditions, manualInputKey } from './manualInput.ts';

const draft = { task: 'integral' as const, expression: 'sin(x)', variable: 'x', lower: '0', upper: 'pi' };

test('手动积分必须填写全部条件，不把缺失上下限补成示例值', () => {
  assert.equal(manualInputError(draft), null);
  assert.match(manualInputError({ ...draft, lower: '' })!, /下限/);
  assert.match(manualInputError({ ...draft, expression: 'sin(' })!, /公式/);
  assert.match(manualInputError({ ...draft, upper: 'x' })!, /上限/);
});

test('不定积分不发送隐藏的上下限，变量和条件变化使确认失效', () => {
  const indefinite = { ...draft, task: 'antiderivative' as const };
  assert.deepEqual(manualConditions(indefinite), { expression: 'sin(x)', variable: 'x' });
  assert.notEqual(manualInputKey(draft), manualInputKey({ ...draft, upper: '2' }));
  assert.notEqual(manualInputKey(draft), manualInputKey(indefinite));
  assert.equal(manualInputError({ ...draft, expression: 't^2', variable: 't' }), null);
});
