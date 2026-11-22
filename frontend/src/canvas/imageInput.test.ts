import test from 'node:test';
import assert from 'node:assert/strict';
import {
  builtinSampleImage,
  convolvePreview,
  parseCsvDatasetPayload,
  parseCsvText,
  parseRealImagePayload,
  rgbaToMatrix,
} from './imageInput.ts';
import { deepCoreOutput, kernelData, pixelData } from './deepCore.ts';
import type { CanvasNode } from './types.ts';

test('rgbaToMatrix 正确提取灰度与单通道并下采样到目标尺寸', () => {
  // 2×2 全红图 (255, 0, 0, 255)
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255,
  ]);
  const r = rgbaToMatrix(rgba, 2, 2, 2, 'r');
  const g = rgbaToMatrix(rgba, 2, 2, 2, 'g');
  const gray = rgbaToMatrix(rgba, 2, 2, 2, 'gray');
  assert.equal(r[0]![0], 1);
  assert.equal(g[0]![0], 0);
  assert.ok(Math.abs(gray[0]![0]! - 0.299) < 1e-3);
});

test('真实图片 payload 可无缝驱动 pixelGridSource 与 32×32 高清滤波预览', () => {
  const sample = builtinSampleImage('digit7');
  const raw = JSON.stringify(sample);
  const parsed = parseRealImagePayload(raw);
  assert.ok(parsed);
  assert.equal(parsed.data.length, 12);
  assert.equal(parsed.hiRes?.length, 32);

  const node: CanvasNode = { id: 'img', type: 'pixelGridSource', x: 0, y: 0, params: {}, payload: raw };
  const out = deepCoreOutput(node, () => null, 'out');
  assert.equal(out?.kind, 'tensor2d');
  if (out?.kind === 'tensor2d') {
    assert.deepEqual(out.data, pixelData({}, raw));
  }

  const filtered = convolvePreview(sample.hiRes!, kernelData({ kernel: 0 }), 1, 0);
  assert.equal(filtered.length, 30);
  assert.equal(filtered[0]!.length, 30);
});

test('CSV 小数据集导入归一化到 [-1,1] 并支持 dataset2dSource 输出', () => {
  const csv = 'x,y,label\n0,0,0\n10,10,1\n2,3,0\n8,9,1\n1,2,0\n9,8,1';
  const parsed = parseCsvText(csv, 'test.csv');
  assert.equal(parsed.points.length, 6);
  for (const pt of parsed.points) {
    assert.ok(pt.x >= -1 && pt.x <= 1);
    assert.ok(pt.y >= -1 && pt.y <= 1);
  }
  const raw = JSON.stringify(parsed);
  assert.ok(parseCsvDatasetPayload(raw));
  const node: CanvasNode = { id: 'ds', type: 'dataset2dSource', x: 0, y: 0, params: {}, payload: raw };
  const out = deepCoreOutput(node, () => null, 'out');
  assert.equal(out?.kind, 'dataset2d');
  if (out?.kind === 'dataset2d') {
    assert.equal(out.points.length, 6);
  }
});
