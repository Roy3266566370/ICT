import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferReturnLabel,
  readStoredReturnOrigin,
  recordVisitedOrigin,
  resolveCanvasReturnOrigin,
} from './returnOrigin.ts';

function withMockSessionStorage(fn: () => void): void {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: mockStorage, configurable: true });
  try {
    fn();
  } finally {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
}

test('inferReturnLabel: 按常见站内路由自动生成中文返回文案', () => {
  assert.equal(inferReturnLabel('/'), '← 返回首页');
  assert.equal(inferReturnLabel('/workshop?subject=physics'), '← 返回定象坊目录');
  assert.equal(inferReturnLabel('/space'), '← 返回个人空间');
  assert.equal(inferReturnLabel('/living'), '← 返回通文册');
  assert.equal(inferReturnLabel('/work-shares/sh_123'), '← 返回作品分享');
  assert.equal(inferReturnLabel('/materials/m1/work'), '← 返回课件工作台');
});

test('recordVisitedOrigin & resolveCanvasReturnOrigin: 自动记忆来源、忽略登录与画布自身、刷新后仍保留', () => {
  withMockSessionStorage(() => {
    // 无历史时兜底回定象坊目录
    assert.deepEqual(resolveCanvasReturnOrigin(null), {
      from: '/workshop',
      fromLabel: '← 定象坊目录',
    });

    // 访问首页后跳进画布（未显式传 state），自动记住回首页
    recordVisitedOrigin('/', '');
    assert.deepEqual(resolveCanvasReturnOrigin(null), {
      from: '/',
      fromLabel: '← 返回首页',
    });

    // 访问带筛选参数的个人空间后进入登录页再进画布，登录页与画布自身不应覆盖记忆
    recordVisitedOrigin('/space', '?tab=works');
    recordVisitedOrigin('/login', '');
    recordVisitedOrigin('/canvas', '?template=foo');
    assert.deepEqual(resolveCanvasReturnOrigin(null), {
      from: '/space?tab=works',
      fromLabel: '← 返回个人空间',
      restoreScroll: true,
    });

    // 显式传入 navigationState.from 优先并写回 sessionStorage，模拟画布刷新（state 变为 null）后仍不丢失
    const explicit = resolveCanvasReturnOrigin({
      from: '/workshop?subject=408',
      fromLabel: '← 返回 408 目录',
      restoreScroll: true,
    });
    assert.equal(explicit.from, '/workshop?subject=408');
    assert.equal(explicit.fromLabel, '← 返回 408 目录');
    assert.deepEqual(readStoredReturnOrigin(), explicit);
    assert.deepEqual(resolveCanvasReturnOrigin(null), explicit);

    // 拒绝外链或协议相对路径注入
    const safe = resolveCanvasReturnOrigin({ from: '//evil.example.com/x' });
    assert.equal(safe.from, '/workshop?subject=408');
  });
});
