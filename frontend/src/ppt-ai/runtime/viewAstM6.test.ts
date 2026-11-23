import test from 'node:test';
import assert from 'node:assert/strict';
import { validateViewAst } from '../sandbox/protocol.ts';
import { extractDragHandles, mapDragPointToParams } from './viewAstDrag.ts';

test('validateViewAst accepts arrow, polygon, formula and drag-handle', () => {
  const ast = {
    version: 'ppt-ai.view.1',
    width: 720,
    height: 420,
    nodes: [
      { id: 'poly1', type: 'polygon', points: [[100, 300], [260, 300], [260, 180]], style: { fill: '#3b82f6', opacity: 0.2 } },
      { id: 'arr1', type: 'arrow', x1: 100, y1: 300, x2: 260, y2: 180, label: 'v', style: { stroke: '#c4622d', strokeWidth: 3 } },
      { id: 'eq1', type: 'formula', x: 400, y: 90, tex: '\\vec{v} = (2, 1)', style: { fill: '#0f172a', fontSize: 16 } },
    ],
    interactions: [
      {
        type: 'drag-handle',
        id: 'h_v',
        label: '拖动 v',
        x: 260,
        y: 180,
        xParam: 'vx',
        yParam: 'vy',
        bounds: { xMin: 100, xMax: 500, yMin: 60, yMax: 300 },
        valueRange: { x: [0, 4], y: [0, 3] },
      },
    ],
  };
  assert.deepEqual(validateViewAst(ast), []);
  const handles = extractDragHandles(ast);
  assert.equal(handles.length, 1);

  // 中心点映射校验（x 线性增，y 数学轴向上增）
  assert.deepEqual(mapDragPointToParams(handles[0]!, 300, 180), { vx: 2, vy: 1.5 });
  // 越界自动钳制到 valueRange
  assert.deepEqual(mapDragPointToParams(handles[0]!, 999, -50), { vx: 4, vy: 3 });
  assert.deepEqual(mapDragPointToParams(handles[0]!, -10, 999), { vx: 0, vy: 0 });
});

test('validateViewAst blocks unsafe formula tex, bad polygon and unbound drag-handle', () => {
  const badFormula = validateViewAst({
    version: 'ppt-ai.view.1',
    nodes: [{ id: 'f1', type: 'formula', x: 10, y: 10, tex: '\\href{javascript:alert(1)}{click}' }],
    interactions: [],
  });
  assert.ok(badFormula.some((msg) => msg.includes('formula.tex')));

  const badPoly = validateViewAst({
    version: 'ppt-ai.view.1',
    nodes: [{ id: 'p1', type: 'polygon', points: [[0, 0], [10, 10]] }],
    interactions: [],
  });
  assert.ok(badPoly.some((msg) => msg.includes('polygon.points')));

  const badHandle = validateViewAst({
    version: 'ppt-ai.view.1',
    nodes: [],
    interactions: [
      { type: 'drag-handle', id: 'h1', x: 50, y: 50, bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 }, valueRange: {} },
    ],
  });
  assert.ok(badHandle.some((msg) => msg.includes('至少需要绑定')));
});
