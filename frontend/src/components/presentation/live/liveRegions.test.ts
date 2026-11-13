import assert from 'node:assert/strict';
import test from 'node:test';
import type { ISpec } from '../../../ispec/types.ts';
import { dragValue, isOffBaseline, planLive } from './liveRegions.ts';

const src = (el: string, bbox: { x: number; y: number; w: number; h: number } | null, page = 6) =>
  ({ page, element_id: el, bbox, status: 'original', excerpt: 'x' });
const MATRIX = { x: 7010400, y: 1200150, w: 1061720, h: 885825 };
const ANCHOR = { x: 533400, y: 1162050, w: 6096000, h: 4286250 };

function matrixSpec(over: Partial<ISpec> = {}): ISpec {
  return {
    spec_version: '1.0', object_id: 'o1', kind: 'geometric', title: '矩阵变形',
    anchor: { page: 6, element_id: 'p06_fig', bbox: ANCHOR },
    parameters: ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, default: 2, source: src('p06_s05', MATRIX) })),
    expressions: [{ id: 'det', expr: 'a*d-b*c', label: '行列式' }, { id: 'u1', expr: 'a+b' }],
    views: [{ type: 'figure', spec_ref: 'circle_ellipse' }, { type: 'text', template: 't' }],
    ...over,
  } as ISpec;
}

test('同一元素的参数合并成一个簇，图形取 anchor，结果只取带标签的派生量', () => {
  const plan = planLive(matrixSpec(), 6);
  assert.equal(plan.fallback, false);
  assert.equal(plan.clusters.length, 1);
  assert.deepEqual(plan.clusters[0]!.paramIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(plan.clusters[0]!.bbox, MATRIX);
  assert.equal(plan.figure?.draggable, true);
  assert.deepEqual(plan.results.map(r => r.id), ['det']);
});

test('参数与图在同一元素时进入图下方参数条，不再另生成簇', () => {
  const spec = matrixSpec({ parameters: ['a', 'b'].map(id => ({ id, label: id, default: 1, source: src('p06_fig', ANCHOR) })) });
  const plan = planLive(spec, 6);
  assert.equal(plan.clusters.length, 0);
  assert.deepEqual(plan.figure?.paramIds, ['a', 'b']);
});

test('待核对、其他页、无位置的 spec 回退为原热区；带专用场景的 spec 仍原位化（展开才进专用页）', () => {
  assert.equal(planLive(matrixSpec({ availability: 'needs_review' }), 6).fallback, true);
  assert.equal(planLive(matrixSpec({ scene: { scene_type: 'svd_process', version: '1' } }), 6).fallback, false);
  const noBox = matrixSpec({ anchor: undefined, parameters: [{ id: 'a', label: 'a', default: 1, source: src('e', null) }] });
  assert.equal(planLive(noBox, 6).fallback, true);
  const other = planLive(matrixSpec({ anchor: undefined }), 9);
  assert.equal(other.fallback, true);
});

test('step_diagram 不做原位图，但参数簇仍可用', () => {
  const plan = planLive(matrixSpec({ views: [{ type: 'figure', spec_ref: 'step_diagram' }] }), 6);
  assert.equal(plan.figure, null);
  assert.equal(plan.clusters.length, 1);
});

test('布尔/枚举参数不进入数字簇', () => {
  const spec = matrixSpec({ anchor: undefined, parameters: [
    { id: 'a', label: 'a', default: 1, source: src('e1', MATRIX) },
    { id: 'flag', label: 'f', type: 'boolean', default: true, source: src('e1', MATRIX) }] });
  assert.deepEqual(planLive(spec, 6).clusters[0]!.paramIds, ['a']);
});

const SCENE = {
  v: 1, page: 6, element_id: 'p06_fig', bbox_emu: ANCHOR, image_px: [852, 570],
  origin: [185, 495], unit_px: 150, baseline: [2, 0, 0, 3],
  bind: { a: 'a', b: 'b', c: 'c', d: 'd' },
  checks: [{ id: 'iou', title: 't', pass: true }], confidence: 'high',
};

test('读图场景校验通过时原位重建，绑定参数不再生成簇，通用图被替换', () => {
  const spec = matrixSpec({ scene: { scene_type: 'x', version: '1', figure_scenes: [SCENE] } });
  const plan = planLive(spec, 6);
  assert.equal(plan.fallback, false);
  assert.equal(plan.recognized.length, 1);
  assert.equal(plan.recognized[0]!.elementId, 'p06_fig');
  assert.equal(plan.figure, null);
  assert.equal(plan.clusters.length, 0);
});

test('读图场景校验失败或绑定缺失时不替换原图', () => {
  const failed = { ...SCENE, checks: [{ id: 'iou', title: 't', pass: false }] };
  assert.equal(planLive(matrixSpec({ scene: { scene_type: 'x', version: '1', figure_scenes: [failed] } }), 6).recognized.length, 0);
  const partial = { ...SCENE, bind: { a: 'a', b: 'b', c: 'c', d: 'missing' } };
  const plan = planLive(matrixSpec({ scene: { scene_type: 'x', version: '1', figure_scenes: [partial] } }), 6);
  assert.equal(plan.recognized.length, 0);
  assert.equal(plan.clusters.length, 1);
  const lowConf = { ...SCENE, confidence: 'low' };
  assert.equal(planLive(matrixSpec({ scene: { scene_type: 'x', version: '1', figure_scenes: [lowConf] } }), 6).recognized.length, 0);
});

test('偏离基线判断与拖动换算', () => {
  const p = { id: 'a', label: 'a', default: 3, source_default: 2, source: src('e', MATRIX) };
  assert.equal(isOffBaseline(p, 2), false);
  assert.equal(isOffBaseline(p, 2.5), true);
  assert.equal(dragValue(1, 12, 0.5, false), 2);
  assert.equal(dragValue(1, 12, 0.5, true), 11);
  assert.equal(dragValue(1, -6, undefined, false), 0.9);
});
