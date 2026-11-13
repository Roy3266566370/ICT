/**
 * deckState 纯逻辑单测。
 *
 * 运行：`cd frontend && node --test src/components/home/deck/deckState.test.ts`
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCommand,
  clampPosition,
  describePosition,
  gotoSlide,
  keyToCommand,
  nextPosition,
  parseDeckLocation,
  prevPosition,
  resolveSlideRef,
  swipeDirection,
  wheelDirection,
  withSlideQuery,
} from './deckState.ts';

const SLIDES = [
  { id: 'cover', builds: 0 },
  { id: 'demo', builds: 0 },
  { id: 'abilities', builds: 3 },
  { id: 'workflow', builds: 4 },
  { id: 'closing', builds: 0 },
] as const;

test('钳制：页码与步骤都不越界，非有限数当作 0', () => {
  assert.deepEqual(clampPosition({ slide: -3, step: 9 }, SLIDES), { slide: 0, step: 0 });
  assert.deepEqual(clampPosition({ slide: 99, step: 99 }, SLIDES), { slide: 4, step: 0 });
  assert.deepEqual(clampPosition({ slide: 2, step: 99 }, SLIDES), { slide: 2, step: 3 });
  assert.deepEqual(clampPosition({ slide: Number.NaN, step: Number.NaN }, SLIDES), { slide: 0, step: 0 });
});

test('前进：先逐步显示本页内容，再进入下一页', () => {
  assert.deepEqual(nextPosition({ slide: 1, step: 0 }, SLIDES), { slide: 2, step: 0 });
  assert.deepEqual(nextPosition({ slide: 2, step: 0 }, SLIDES), { slide: 2, step: 1 });
  assert.deepEqual(nextPosition({ slide: 2, step: 2 }, SLIDES), { slide: 2, step: 3 });
  assert.deepEqual(nextPosition({ slide: 2, step: 3 }, SLIDES), { slide: 3, step: 0 });
});

test('前进：最后一页保持不动', () => {
  assert.deepEqual(nextPosition({ slide: 4, step: 0 }, SLIDES), { slide: 4, step: 0 });
});

test('后退：先收起本页内容；回到上一页时该页完整显示', () => {
  assert.deepEqual(prevPosition({ slide: 3, step: 2 }, SLIDES), { slide: 3, step: 1 });
  assert.deepEqual(prevPosition({ slide: 3, step: 0 }, SLIDES), { slide: 2, step: 3 });
  assert.deepEqual(prevPosition({ slide: 1, step: 0 }, SLIDES), { slide: 0, step: 0 });
  assert.deepEqual(prevPosition({ slide: 0, step: 0 }, SLIDES), { slide: 0, step: 0 });
});

test('跳页与首尾命令', () => {
  assert.deepEqual(gotoSlide(3, SLIDES), { slide: 3, step: 0 });
  assert.deepEqual(gotoSlide(42, SLIDES), { slide: 4, step: 0 });
  assert.deepEqual(applyCommand({ slide: 2, step: 1 }, 'first', SLIDES), { slide: 0, step: 0 });
  assert.deepEqual(applyCommand({ slide: 2, step: 1 }, 'last', SLIDES), { slide: 4, step: 0 });
});

test('没有页面时位置稳定为 0/0', () => {
  assert.deepEqual(nextPosition({ slide: 0, step: 0 }, []), { slide: 0, step: 0 });
  assert.deepEqual(prevPosition({ slide: 0, step: 0 }, []), { slide: 0, step: 0 });
});

test('按键映射：翻页键、空格与 Shift+空格，其余按键不处理', () => {
  assert.equal(keyToCommand('ArrowRight'), 'next');
  assert.equal(keyToCommand('PageDown'), 'next');
  assert.equal(keyToCommand(' '), 'next');
  assert.equal(keyToCommand(' ', true), 'prev');
  assert.equal(keyToCommand('ArrowLeft'), 'prev');
  assert.equal(keyToCommand('PageUp'), 'prev');
  assert.equal(keyToCommand('Home'), 'first');
  assert.equal(keyToCommand('End'), 'last');
  assert.equal(keyToCommand('Tab'), null);
  assert.equal(keyToCommand('a'), null);
});

test('页面引用：1 起始数字、页面 id、历史锚点别名', () => {
  assert.equal(resolveSlideRef('1', SLIDES), 0);
  assert.equal(resolveSlideRef('5', SLIDES), 4);
  assert.equal(resolveSlideRef('6', SLIDES), null);
  assert.equal(resolveSlideRef('0', SLIDES), null);
  assert.equal(resolveSlideRef('demo', SLIDES), 1);
  assert.equal(resolveSlideRef('guide', SLIDES), 3);
  assert.equal(resolveSlideRef('explore', SLIDES), 1);
  assert.equal(resolveSlideRef('upload', SLIDES), null);
  assert.equal(resolveSlideRef('', SLIDES), null);
  assert.equal(resolveSlideRef(null, SLIDES), null);
});

test('地址解析：?s= 优先，#guide 兜底，#upload 不改变页码', () => {
  assert.equal(parseDeckLocation('?s=3', '', SLIDES), 2);
  assert.equal(parseDeckLocation('?s=demo', '#guide', SLIDES), 1);
  assert.equal(parseDeckLocation('', '#guide', SLIDES), 3);
  assert.equal(parseDeckLocation('?s=99', '#guide', SLIDES), 3);
  assert.equal(parseDeckLocation('', '#upload', SLIDES), null);
  assert.equal(parseDeckLocation('', '', SLIDES), null);
});

test('写回查询串：保留其它参数，第一页不写参数', () => {
  assert.equal(withSlideQuery('', 2), '?s=3');
  assert.equal(withSlideQuery('?a=1', 2), '?a=1&s=3');
  assert.equal(withSlideQuery('?s=3&a=1', 0), '?a=1');
  assert.equal(withSlideQuery('?s=3', 0), '');
});

test('滚轮：小幅滚动与锁定期内忽略，其余按方向翻页', () => {
  assert.equal(wheelDirection(10, 0, 5000), null);
  assert.equal(wheelDirection(120, 4800, 5000), null);
  assert.equal(wheelDirection(120, 0, 5000), 'next');
  assert.equal(wheelDirection(-120, 0, 5000), 'prev');
});

test('滑动：以横向为主且超过阈值才翻页', () => {
  assert.equal(swipeDirection(-100, 10), 'next');
  assert.equal(swipeDirection(100, 10), 'prev');
  assert.equal(swipeDirection(-30, 0), null);
  assert.equal(swipeDirection(-80, 90), null);
});

test('播报文案', () => {
  assert.equal(describePosition(2, 8, '实时演示'), '第 3 页，共 8 页：实时演示');
});
