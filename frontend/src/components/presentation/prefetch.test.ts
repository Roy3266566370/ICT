import assert from 'node:assert/strict';
import test from 'node:test';
import { newPrefetchUrls, planPrefetch, prefetchAllowed } from './prefetch.ts';

const urls = ['a', 'b', 'c', 'd', 'e', 'f'];

test('planPrefetch 立即取 ±1 与下一页的 +2，空闲取 -2', () => {
  assert.deepEqual(planPrefetch(urls, 2), { immediate: ['d', 'b', 'e'], idle: ['a'] });
});

test('planPrefetch 越界与重复 URL 会去重', () => {
  assert.deepEqual(planPrefetch(['a', 'a', 'a'], 0), { immediate: ['a'], idle: [] });
  assert.deepEqual(planPrefetch(urls, 0), { immediate: ['b', 'c'], idle: [] });
  assert.deepEqual(planPrefetch(urls, urls.length - 1), { immediate: ['e'], idle: ['d'] });
});

test('planPrefetch 省流量时跳过 ±2', () => {
  assert.deepEqual(planPrefetch(urls, 3, false), { immediate: ['e', 'c'], idle: [] });
  assert.deepEqual(planPrefetch(urls, 0, false), { immediate: ['b'], idle: [] });
});

test('newPrefetchUrls 过滤已预取并保持顺序', () => {
  assert.deepEqual(newPrefetchUrls(['b', 'a', 'b', ''], new Set(['a'])), ['b']);
  assert.deepEqual(newPrefetchUrls(['a'], new Set(['a'])), []);
});

test('prefetchAllowed 尊重 saveData 与 2G', () => {
  assert.equal(prefetchAllowed(undefined), true);
  assert.equal(prefetchAllowed({ saveData: true }), false);
  assert.equal(prefetchAllowed({ effectiveType: '2g' }), false);
  assert.equal(prefetchAllowed({ effectiveType: 'slow-2g' }), false);
  assert.equal(prefetchAllowed({ effectiveType: '3g' }), true);
  assert.equal(prefetchAllowed({ saveData: false, effectiveType: '4g' }), true);
});
