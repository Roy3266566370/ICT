import assert from 'node:assert/strict';
import test from 'node:test';
import {clampZoom, fitZoom, stepZoom, wheelZoom} from './zoom.ts';

test('缩放百分比限制在允许范围内', () => {
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(5), 4);
  assert.equal(clampZoom(1.23456), 1.235);
});

test('按钮按步长缩放并在边界停住', () => {
  assert.equal(stepZoom(1, 0.1), 1.1);
  assert.equal(stepZoom(3.95, 0.1), 4);
  assert.equal(stepZoom(0.3, -0.1), 0.25, '低于最小值时停在 25%');
});

test('滚轮向上放大、向下缩小', () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(3.9, -100), 4, '滚轮放大不会超过最大值');
});

test('适应窗口按可用区域与页面比例计算', () => {
  const scale = fitZoom({width: 1404, height: 793}, {width: 960, height: 540}, 40);
  assert.ok(Math.abs(960 * scale - 1338.67) < 1);
  assert.ok(540 * scale <= 753, '页面完整落入可用高度');
  assert.equal(fitZoom({width: 3000, height: 2000}, {width: 960, height: 540}, 80, 0.15, 1.7), 1.7,
    '编辑器适配不会无限放大');
});
