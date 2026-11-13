/**
 * `safeReturnTo` 的纯函数单测（契约 `C-LOGINPAGE@1` §1 的 8 类输入）。
 *
 * 运行：`cd frontend && node --test src/components/auth/returnTo.test.ts`
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_RETURN_TO, safeReturnTo } from './returnTo.ts';

test('默认回退目标是 /space', () => {
  assert.equal(DEFAULT_RETURN_TO, '/space');
});

test('第 1 类：站内路径原样返回（含编码与未编码两种写法）', () => {
  assert.equal(safeReturnTo('?returnTo=/space'), '/space');
  assert.equal(safeReturnTo('?returnTo=%2Fspace'), '/space');
});

test('第 2 类：多段站内路径原样返回，查询串不被改写', () => {
  assert.equal(safeReturnTo('?returnTo=/materials/mat_1/work'), '/materials/mat_1/work');
  assert.equal(safeReturnTo('?returnTo=%2Fmaterials%2Fmat_1%2Fwork'), '/materials/mat_1/work');
  assert.equal(safeReturnTo('?returnTo=/materials/mat_1/work%3Fview%3Dinteractive'), '/materials/mat_1/work?view=interactive');
});

test('第 3 类：协议相对地址 //evil.com 一律回退', () => {
  assert.equal(safeReturnTo('?returnTo=//evil.com'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=%2F%2Fevil.com'), DEFAULT_RETURN_TO);
});

test('第 4 类：外站绝对地址 https://evil.com 一律回退', () => {
  assert.equal(safeReturnTo('?returnTo=https://evil.com'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=https%3A%2F%2Fevil.com'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=javascript%3Aalert(1)'), DEFAULT_RETURN_TO);
});

test('第 5 类：回跳登录页自身（含带 query）一律回退，避免登录循环', () => {
  assert.equal(safeReturnTo('?returnTo=/login'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=/login?x=1'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=%2Flogin%3Fx%3D1'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=/login/'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=/LOGIN'), DEFAULT_RETURN_TO);
});

test('第 6 类：空查询串 / 缺参数 / 空值一律回退', () => {
  assert.equal(safeReturnTo(''), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?foo=bar'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo='), DEFAULT_RETURN_TO);
});

test('第 7 类：含反斜杠或控制字符的路径一律回退', () => {
  assert.equal(safeReturnTo('?returnTo=/a\\b'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=%2Fa%5Cb'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=%2Fa%00b'), DEFAULT_RETURN_TO);
});

test('第 8 类：非法百分号编码不抛异常，直接回退', () => {
  assert.doesNotThrow(() => safeReturnTo('?returnTo=%E0%A4%A'));
  assert.equal(safeReturnTo('?returnTo=%E0%A4%A'), DEFAULT_RETURN_TO);
  assert.equal(safeReturnTo('?returnTo=%ZZ'), DEFAULT_RETURN_TO);
});

test('自定义 fallback 生效，且不改变合法路径的返回', () => {
  assert.equal(safeReturnTo('', '/examples'), '/examples');
  assert.equal(safeReturnTo('?returnTo=//evil.com', '/examples'), '/examples');
  assert.equal(safeReturnTo('?returnTo=/labs', '/examples'), '/labs');
});

test('不带前导 ? 的查询串同样可用；重复参数取第一个', () => {
  assert.equal(safeReturnTo('returnTo=/space'), '/space');
  assert.equal(safeReturnTo('?returnTo=/space&returnTo=/evil'), '/space');
});