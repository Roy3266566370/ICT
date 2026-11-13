import assert from 'node:assert/strict';
import test from 'node:test';
import { pageDisplayUrl, pageThumbUrl, pageUrl } from './pageUrls.ts';

test('pageUrl 只给 /api 与 fixtures 补前缀', () => {
  assert.equal(pageUrl(null), '');
  assert.equal(pageUrl('/api/v1/materials/m/renders/s01.png'), '/api/v1/materials/m/renders/s01.png');
  assert.equal(pageUrl('fixtures/pages/s01.png'), '/fixtures/pages/s01.png');
  assert.equal(pageUrl('https://cdn.example.com/s01.png'), 'https://cdn.example.com/s01.png');
  assert.equal(pageUrl('blob:https://example.com/id'), 'blob:https://example.com/id');
});

test('pageDisplayUrl 使用 1600 宽 WebP，不动分享页与 fixtures', () => {
  const raw = '/api/v1/materials/mat_1/renders/s01.png';
  assert.equal(pageDisplayUrl(raw, 81234), `${raw}?w=1600&v=81234`);
  assert.equal(pageDisplayUrl('/api/v1/p/share_1/pages/1', 1), '/api/v1/p/share_1/pages/1');
  assert.equal(pageDisplayUrl('fixtures/pages/s01.png', 1), '/fixtures/pages/s01.png');
});

test('pageThumbUrl 给渲染页图追加 w 与可选 v', () => {
  const raw = '/api/v1/materials/mat_1/renders/s01.png';
  assert.equal(pageThumbUrl(raw), '/api/v1/materials/mat_1/renders/s01.png?w=320');
  assert.equal(pageThumbUrl(raw, 240), '/api/v1/materials/mat_1/renders/s01.png?w=240');
  assert.equal(
    pageThumbUrl(raw, 480, 81234),
    '/api/v1/materials/mat_1/renders/s01.png?w=480&v=81234',
  );
  assert.equal(
    pageThumbUrl(raw, 320, ''),
    '/api/v1/materials/mat_1/renders/s01.png?w=320',
  );
});

test('pageThumbUrl 不改动分享页、fixtures 与绝对地址', () => {
  assert.equal(pageThumbUrl('/fixtures/pages/s01.png'), '/fixtures/pages/s01.png');
  assert.equal(pageThumbUrl('fixtures/pages/s01.png'), '/fixtures/pages/s01.png');
  assert.equal(pageThumbUrl('/api/v1/p/share_1/pages/1'), '/api/v1/p/share_1/pages/1');
  assert.equal(
    pageThumbUrl('https://cdn.example.com/files/s01.png'),
    'https://cdn.example.com/files/s01.png',
  );
  assert.equal(pageThumbUrl('/api/v1/materials/m/assets/a_1'), '/api/v1/materials/m/assets/a_1');
});

test('pageThumbUrl 兼容带查询串的渲染地址', () => {
  assert.equal(
    pageThumbUrl('/api/v1/materials/m/renders/s01.png?x=1', 320),
    '/api/v1/materials/m/renders/s01.png?x=1&w=320',
  );
});
