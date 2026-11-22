import test from 'node:test';
import assert from 'node:assert/strict';
import { DEEP_TEMPLATES, DEEP_TOPICS, deepTemplateDoc } from './deepTemplates.ts';
import type { CanvasDoc } from './types.ts';

function assertDoc(doc: CanvasDoc): void {
  const ids = new Set(doc.nodes.map((node) => node.id));
  assert.equal(ids.size, doc.nodes.length, '节点 id 必须唯一');
  for (const wire of doc.wires) {
    assert.ok(ids.has(wire.from), `悬空 from ${wire.from}`);
    assert.ok(ids.has(wire.to), `悬空 to ${wire.to}`);
  }
  assert.ok(doc.panel, '模板必须带仪器面板');
  for (const id of doc.panel!.view_node_ids) assert.ok(ids.has(id), `面板视图节点缺失 ${id}`);
  for (const entry of doc.panel!.exposed_params) {
    assert.ok(ids.has(entry.node_id), `外露参数节点缺失 ${entry.node_id}`);
    if (entry.min !== undefined && entry.max !== undefined) assert.ok(entry.min < entry.max, `${entry.param_key} 范围非法`);
    if (entry.step !== undefined) assert.ok(entry.step > 0, `${entry.param_key} 步长非法`);
  }
  assert.ok(doc.panel!.view_node_ids.length > 0);
  assert.ok(doc.panel!.exposed_params.length > 0);
  assert.equal(JSON.parse(JSON.stringify(doc)).nodes.length, doc.nodes.length);
}

test('four topics and fourteen templates with unique kinds', () => {
  assert.equal(DEEP_TOPICS.length, 4);
  assert.equal(DEEP_TEMPLATES.length, 14);
  assert.equal(new Set(DEEP_TEMPLATES.map((template) => template.kind)).size, 14);
  for (const template of DEEP_TEMPLATES) assert.ok(DEEP_TOPICS.some((topic) => topic.id === template.topic), template.kind);
  for (const topic of DEEP_TOPICS) assert.ok(DEEP_TEMPLATES.some((template) => template.topic === topic.id), topic.id);
});

test('every template document has valid wiring and a usable instrument panel', () => {
  for (const template of DEEP_TEMPLATES) assertDoc(deepTemplateDoc(template.kind));
});

test('new attention workshop graph uses independent Q K V and both scaled and raw branches', async () => {
  const { deepWorkshopDoc } = await import('./deepWorkshop.ts');
  const { makeCtx, evalOutput } = await import('./engine.ts');
  const doc = deepWorkshopDoc('dlAttention');
  const ctx = makeCtx(doc, new Map());
  assert.equal(doc.nodes.filter((node) => node.type === 'studyProjection').length, 3);
  const branches = doc.nodes.filter((node) => node.type === 'studySoftmax');
  assert.equal(branches.length, 2);
  const values = branches.map((node) => evalOutput(ctx, node.id));
  assert.ok(values.every((value) => value?.kind === 'tensor2d'));
  assert.notDeepEqual(values[0], values[1]);
  const scores = doc.nodes.find((node) => node.type === 'studyScores')!;
  const missing = { ...doc, wires: doc.wires.filter((wire) => wire.to !== scores.id || wire.toPort !== 'K') };
  assert.equal(evalOutput(makeCtx(missing, new Map()), branches[0]!.id), null);
});

test('every revised template evaluates all connected observation inputs with its defaults', async () => {
  const { deepWorkshopDoc } = await import('./deepWorkshop.ts');
  const { makeCtx, inputValues, evalOutput } = await import('./engine.ts');
  const { traces } = await import('./deepCore.ts');
  for (const template of DEEP_TEMPLATES) {
    const doc = deepWorkshopDoc(template.kind);
    assertDoc(doc);
    assert.ok(doc.wires.length > 1, template.kind);
    const ctx = makeCtx(doc, new Map());
    for (const id of doc.panel!.view_node_ids) {
      const node = doc.nodes.find((n) => n.id === id)!;
      const values = Object.values(inputValues(ctx, node));
      assert.ok(values.length > 0 && values.every(Boolean), `${template.kind}:${node.type}`);
    }
    if (template.kind === 'dlCnn') {
      const second = doc.nodes.filter((node) => node.type === 'conv2dOp')[1]!;
      const output = evalOutput(ctx, second.id);
      assert.equal(output?.kind, 'tensor2d');
      if (output?.kind === 'tensor2d') assert.equal(traces.get(output.data)?.[2]?.[2]?.sources.length, 25);
    }
  }
});

test('disconnecting and replacing a computation changes results in all four topics', async () => {
  const { deepWorkshopDoc } = await import('./deepWorkshop.ts');
  const { makeCtx, evalOutput } = await import('./engine.ts');
  for (const [kind, sourceKind, outputKind, patch] of [
    ['dlActivation', 'studyActivation', 'studyGradient', {}],
    ['dlCnn', 'conv2dOp', 'studyPool', { kernel: 2 }],
    ['dlAttention', 'studyScores', 'studyScale', {}],
    ['dlDiffusion', 'studyScore', 'studyReverse', {}],
  ] as const) {
    const doc = deepWorkshopDoc(kind);
    const target = doc.nodes.find((node) => node.type === outputKind)!;
    const inputWire = doc.wires.find((wire) => wire.to === target.id
      && doc.nodes.find((node) => node.id === wire.from)?.type === sourceKind)!;
    const output = (graph: CanvasDoc) => evalOutput(makeCtx(graph, new Map()), target.id);
    assert.ok(output(doc), kind);
    const disconnected = { ...doc, wires: doc.wires.filter((wire) => wire !== inputWire) };
    assert.equal(output(disconnected), null, kind);
    const source = doc.nodes.find((node) => node.id === inputWire.from)!;
    const replacement = { ...source, id: 'replacement', params: { ...source.params, ...patch } };
    const restored = { ...disconnected, nodes: [...doc.nodes, replacement], wires: [
      ...disconnected.wires,
      ...doc.wires.filter((wire) => wire.to === source.id).map((wire) => ({ ...wire, id: `replace-${wire.id}`, to: replacement.id })),
      { ...inputWire, from: replacement.id },
    ] };
    assert.ok(output(restored), kind);
    if (kind === 'dlCnn') assert.notDeepEqual(output(restored), output(doc));
    else assert.deepEqual(output(restored), output(doc));
  }
});
