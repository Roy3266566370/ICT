import assert from 'node:assert/strict';
import test from 'node:test';
import { resizeVector, vectorEndpoints, vectorGeometry } from './vectorGeometry.ts';
import { basisComposition } from './basisComposition.ts';
import { diffDocuments, newNode, patchNodes } from './model.ts';
import type { SceneDocument, ScenePage } from './types.ts';

test('changing b2 changes the coordinates and corner while keeping the resultant fixed', () => {
  const target: [number, number] = [2, -1];
  assert.deepEqual(basisComposition([0, 0], [1, 0], [1, -1], target),
    { coefficients: [1, 1], corner: [1, 0], target });
  const shifted = basisComposition([0, 0], [1, 0], [2, -1], target);
  assert.equal(shifted?.coefficients[0], 0);
  assert.equal(shifted?.coefficients[1], 1);
  assert.equal(shifted?.target, target);
  assert.equal(basisComposition([0, 0], [1, 0], [2, 0], target), null);
});

test('dragging either endpoint preserves the opposite endpoint', () => {
  const geometry = vectorGeometry([200, 100], [100, 200], 16)!;
  const result = vectorEndpoints({ ...geometry, height: 16 });
  const round = (point: number[]) => point.map(Math.round);
  assert.deepEqual(result.map(round), [[200, 100], [100, 200]]);
  assert.deepEqual(vectorEndpoints({ ...vectorGeometry([50, 150], result[1], 16)!, height: 16 }).map(round),
    [[50, 150], [100, 200]]);
  assert.equal(vectorGeometry([1, 1], [1, 1], 16), null);
});

test('vector linkage style, animation step, and basis diff cleanly across document edits', () => {
  const emptyPage: ScenePage = { page_no: 1, width: 960, height: 540, nodes: [] };
  const vec = newNode(emptyPage, 'u_v1', 'vector');
  const baseDoc: SceneDocument = {
    schema_version: '1.0',
    revision: 1,
    title: 'Vector Test',
    pages: [{ ...emptyPage, nodes: [vec] }],
  };
  const updated = patchNodes(baseDoc, 1, ['u_v1'], {
    locked: true,
    style: { bind_mode: 'scale', anim_step: 2 },
    basis: { firstId: 'u_b1', secondId: 'u_v1', resultId: 'u_res', title: [40, 30], fontSize: 20 },
  });
  const changes = diffDocuments(baseDoc, updated);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.patch?.locked, true);
  assert.equal(changes[0]?.patch?.style?.bind_mode, 'scale');
  assert.equal(changes[0]?.patch?.style?.anim_step, 2);
  assert.equal(changes[0]?.patch?.basis?.secondId, 'u_v1');

  const scaled = resizeVector(vec, vec.width * 1.5, vec.rotation + 30)!;
  assert.equal(Math.round(scaled.width), 300);
  assert.equal(Math.round(scaled.rotation), 30);
});
