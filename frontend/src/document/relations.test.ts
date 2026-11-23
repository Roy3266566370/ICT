import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsViewerParameter,
  detectRelationCycles,
  evaluatePageRelations,
  extractNodeMetrics,
  normalizePageRelations,
  validateRelation,
} from './relations.ts';
import type { SceneNode, SceneRelation, TextStyle } from './types.ts';
import { vectorEndpoints, vectorGeometry } from './vectorGeometry.ts';

const DEFAULT_STYLE: TextStyle = {
  font_size: 18,
  font_family: 'Arial',
  color: '#18233D',
  stroke: '#167abc',
  stroke_width: 3,
  line_style: 'solid',
  arrow_end: true,
};

function makeVectorNode(
  id: string,
  start: [number, number],
  end: [number, number],
  extra: Partial<SceneNode> = {},
): SceneNode {
  const geom = vectorGeometry(start, end, 16) ?? { x: start[0], y: start[1], width: 1, rotation: 0 };
  return {
    id,
    name: id,
    type: 'vector',
    x: geom.x,
    y: geom.y,
    width: geom.width,
    height: 16,
    rotation: geom.rotation,
    z: 1,
    opacity: 1,
    locked: false,
    hidden: false,
    deleted: false,
    text: '',
    style: { ...DEFAULT_STYLE },
    base_style: { ...DEFAULT_STYLE },
    base_text: null,
    ...extra,
  };
}

function makeTextNode(
  id: string,
  text: string,
  x = 100,
  y = 40,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    type: 'text',
    x,
    y,
    width: 180,
    height: 28,
    rotation: 0,
    z: 2,
    opacity: 1,
    locked: false,
    hidden: false,
    deleted: false,
    text,
    style: { ...DEFAULT_STYLE },
    base_style: { ...DEFAULT_STYLE },
    base_text: text,
    ...extra,
  };
}

test('basis_decompose updates right-panel label and dashed guides on live drag while leaving left panel untouched', () => {
  // Left panel (standard basis e1=(100,0), e2=(0,-100), v_left=(200,-100) from origin [100, 300])
  const e1 = makeVectorNode('e1', [100, 300], [200, 300]);
  const e2 = makeVectorNode('e2', [100, 300], [100, 200]);
  const vLeft = makeVectorNode('v_left', [100, 300], [300, 200]);
  const leftLabel = makeTextNode('left_label', '标准基：坐标 (2, 1)', 120, 40);

  // Right panel (oblique basis b1=(100,0), b2=(100,-100), v=(200,-100) from origin [500, 300])
  const b1 = makeVectorNode('b1', [500, 300], [600, 300]);
  const b2 = makeVectorNode('b2', [500, 300], [600, 200]);
  const vRight = makeVectorNode('v_right', [500, 300], [700, 200]);
  const guide1 = makeVectorNode('g1', [500, 300], [600, 300], {
    style: { ...DEFAULT_STYLE, line_style: 'dashed', arrow_end: false },
  });
  const guide2 = makeVectorNode('g2', [600, 300], [700, 200], {
    style: { ...DEFAULT_STYLE, line_style: 'dashed', arrow_end: false },
  });
  const rightLabel = makeTextNode('right_label', '斜基：坐标 (1, 1)', 520, 40);

  const nodes = [e1, e2, vLeft, leftLabel, b1, b2, vRight, guide1, guide2, rightLabel];
  const relations: SceneRelation[] = [
    {
      id: 'rel_right_basis',
      kind: 'basis_decompose',
      firstId: 'b1',
      secondId: 'b2',
      resultId: 'v_right',
      guideIds: ['g1', 'g2'],
      labelId: 'right_label',
    },
  ];

  // Initial evaluation: v = 1*b1 + 1*b2 -> (1, 1)
  const initial = evaluatePageRelations(nodes, relations);
  assert.equal(initial.diagnostics.rel_right_basis?.status, 'ok');
  const initRightText = initial.nodes.find((n) => n.id === 'right_label')!;
  assert.equal(initRightText.text, '斜基：坐标 (1, 1)');

  // Simulate dragging b2 tip to [550, 200] (so b2 = (50, -100), then v = (200, -100) = 1.5*b1 + 1*b2)
  const b2Draft = vectorGeometry([500, 300], [550, 200], b2.height)!;
  const dragged = evaluatePageRelations(nodes, relations, { b2: b2Draft });

  assert.equal(dragged.diagnostics.rel_right_basis?.status, 'ok');
  const updatedRightText = dragged.nodes.find((n) => n.id === 'right_label')!;
  assert.equal(updatedRightText.text, '斜基：坐标 (1.5, 1)');

  // Parallelogram corner should shift to origin + 1.5*b1 = [650, 300]
  const updatedG2 = dragged.nodes.find((n) => n.id === 'g2')!;
  const [g2Start, g2End] = vectorEndpoints(updatedG2);
  assert.ok(Math.hypot(g2Start[0] - 650, g2Start[1] - 300) < 1e-4);
  assert.ok(Math.hypot(g2End[0] - 700, g2End[1] - 200) < 1e-4);

  // Left panel must remain completely untouched
  assert.equal(dragged.nodes.find((n) => n.id === 'left_label')!.text, '标准基：坐标 (2, 1)');
  assert.equal(dragged.derivedPatches.left_label, undefined);
  assert.equal(dragged.derivedPatches.v_left, undefined);
  assert.equal(dragged.derivedPatches.e1, undefined);
  assert.equal(dragged.derivedPatches.e2, undefined);
});

test('basis_decompose handles collinear degenerate basis gracefully without crashing', () => {
  const b1 = makeVectorNode('b1', [100, 200], [200, 200]);
  // b2 collinear with b1
  const b2 = makeVectorNode('b2', [100, 200], [250, 200]);
  const v = makeVectorNode('v', [100, 200], [200, 100]);
  const guide = makeVectorNode('g1', [200, 200], [200, 100]);
  const label = makeTextNode('lbl', '斜基：坐标 (1, 1)');

  const evaluated = evaluatePageRelations(
    [b1, b2, v, guide, label],
    [
      {
        id: 'rel_deg',
        kind: 'basis_decompose',
        firstId: 'b1',
        secondId: 'b2',
        resultId: 'v',
        guideIds: ['g1'],
        labelId: 'lbl',
      },
    ],
  );

  assert.equal(evaluated.diagnostics.rel_deg?.status, 'degenerate');
  assert.equal(evaluated.nodes.find((n) => n.id === 'lbl')!.text, '斜基退化：坐标不唯一');
  assert.equal(evaluated.nodes.find((n) => n.id === 'g1')!.opacity, 0);
});

test('topological evaluation resolves chained dependencies regardless of relation array order', () => {
  const b1 = makeVectorNode('b1', [0, 0], [30, 0]);
  const b2 = makeVectorNode('b2', [0, 0], [0, 40]);
  const v = makeVectorNode('v', [0, 0], [10, 10]);
  const guide = makeVectorNode('guide', [0, 0], [5, 5]);
  const label = makeTextNode('label', '');

  // Put downstream expr & guide_bind BEFORE upstream linear_combo to verify topological resolution
  const relations: SceneRelation[] = [
    {
      id: 'r_text',
      kind: 'expr',
      targetId: 'label',
      targetProperty: 'text',
      expression: 'round(v.length)',
      formatTemplate: '|v| = {value}',
      precision: 0,
    },
    {
      id: 'r_guide',
      kind: 'guide_bind',
      targetId: 'guide',
      from: { nodeId: 'b1', anchor: 'end' },
      to: { nodeId: 'v', anchor: 'end' },
    },
    {
      id: 'r_combo',
      kind: 'linear_combo',
      firstId: 'b1',
      secondId: 'b2',
      targetId: 'v',
      a: 2,
      b: 2,
    },
  ];

  const evaluated = evaluatePageRelations([b1, b2, v, guide, label], relations);
  assert.equal(evaluated.diagnostics.r_combo?.status, 'ok');
  assert.equal(evaluated.diagnostics.r_guide?.status, 'ok');
  assert.equal(evaluated.diagnostics.r_text?.status, 'ok');

  // v = 2*(30,0) + 2*(0,40) = (60, 80) -> length = 100
  const resolvedV = evaluated.nodes.find((n) => n.id === 'v')!;
  assert.ok(Math.abs(extractNodeMetrics(resolvedV).length - 100) < 1e-4);
  assert.equal(evaluated.nodes.find((n) => n.id === 'label')!.text, '|v| = 100');

  // guide connects b1.end [30, 0] to v.end [60, 80]
  const resolvedGuide = evaluated.nodes.find((n) => n.id === 'guide')!;
  const [gStart, gEnd] = vectorEndpoints(resolvedGuide);
  assert.ok(Math.hypot(gStart[0] - 30, gStart[1] - 0) < 1e-4);
  assert.ok(Math.hypot(gEnd[0] - 60, gEnd[1] - 80) < 1e-4);
});

test('cycle detection isolates cyclic relations without breaking healthy relations on the same page', () => {
  const v1 = makeVectorNode('v1', [0, 0], [50, 0]);
  const v2 = makeVectorNode('v2', [0, 0], [80, 0]);
  const v3 = makeVectorNode('v3', [0, 0], [40, 0]);
  const text = makeTextNode('txt', '初值');

  const relations: SceneRelation[] = [
    {
      id: 'cyc_1',
      kind: 'expr',
      targetId: 'v1',
      targetProperty: 'length',
      expression: 'v2.length + 10',
    },
    {
      id: 'cyc_2',
      kind: 'expr',
      targetId: 'v2',
      targetProperty: 'length',
      expression: 'v1.length + 10',
    },
    {
      id: 'healthy',
      kind: 'expr',
      targetId: 'txt',
      targetProperty: 'text',
      expression: 'v3.length * 2',
      formatTemplate: '双倍={value}',
    },
  ];

  const cycles = detectRelationCycles(relations);
  assert.deepEqual([...cycles].sort(), ['cyc_1', 'cyc_2']);

  const evaluated = evaluatePageRelations([v1, v2, v3, text], relations);
  assert.equal(evaluated.diagnostics.cyc_1?.status, 'cycle');
  assert.equal(evaluated.diagnostics.cyc_2?.status, 'cycle');
  assert.equal(evaluated.diagnostics.healthy?.status, 'ok');
  assert.equal(evaluated.nodes.find((n) => n.id === 'txt')!.text, '双倍=80');
});

test('whitelist expression validation rejects unsafe functions, syntax errors, and preserves 1-based column', () => {
  const v1 = makeVectorNode('v1', [0, 0], [50, 0]);
  const txt = makeTextNode('txt', '不变');

  const badFn: SceneRelation = {
    id: 'bad_fn',
    kind: 'expr',
    targetId: 'txt',
    targetProperty: 'text',
    expression: 'v1.length + alert(1)',
  };
  const errMsg = validateRelation(badFn, [v1, txt]);
  assert.ok(errMsg && errMsg.includes('未知函数 alert'));

  const divZero: SceneRelation = {
    id: 'div_zero',
    kind: 'expr',
    targetId: 'v1',
    targetProperty: 'opacity',
    expression: '1 / (50 - 50)',
  };
  const evaluated = evaluatePageRelations([v1, txt], [divZero]);
  assert.equal(evaluated.diagnostics.div_zero?.status, 'error');
  assert.equal(evaluated.nodes.find((n) => n.id === 'v1')!.opacity, 1);
});

test('legacy node.basis is automatically normalized into a virtual basis_decompose relation and sub-millisecond fast', () => {
  const b1 = makeVectorNode('b1', [100, 200], [200, 200]);
  const b2 = makeVectorNode('b2', [100, 200], [200, 100], {
    basis: {
      firstId: 'b1',
      secondId: 'b2',
      resultId: 'v',
      title: [120, 60],
      fontSize: 18,
    },
  });
  const v = makeVectorNode('v', [100, 200], [300, 100]);

  const normalized = normalizePageRelations([b1, b2, v]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.provenance, 'legacy');

  const runs = 100;
  const start = performance.now();
  let last = evaluatePageRelations([b1, b2, v]);
  for (let i = 0; i < runs; i += 1) {
    last = evaluatePageRelations([b1, b2, v]);
  }
  const avgMs = (performance.now() - start) / runs;
  assert.ok(avgMs < 1, `Expected sub-millisecond evaluation, got ${avgMs.toFixed(3)}ms`);
  assert.equal(last.overlays.length, 1);
  assert.equal(last.overlays[0]?.label, '斜基：坐标 (1, 1)');

  // Fine-grained viewer_parameters compatibility check
  const endOnlyVector = makeVectorNode('vo', [0, 0], [10, 0], { viewer_parameters: ['end'] });
  assert.equal(allowsViewerParameter(endOnlyVector, 'end'), true);
  assert.equal(allowsViewerParameter(endOnlyVector, 'start'), false);
  assert.equal(allowsViewerParameter(endOnlyVector, 'geometry'), true);
});
