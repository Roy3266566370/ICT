import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'p5', number: '1', title: 'P5', text: 'P5', subject: 'calculus', subject_label: '微积分',
    confidence: 0.9, status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '文本', excerpt: 'P5' }, source_pages: [],
    recognition: { method: 'typed_text', raw_text: 'P5', conditions: [], ambiguities: [], formulas: [], recognized_subject: 'calculus' },
    model: { engine: 'space_v1', subject: 'calculus', defaults: {}, params: [], ...model },
    solution: { summary: '', answer: '', steps: [], ...solution },
    states: { params: {}, step: 0, mode: 'explore', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: 'baseline', attempts: [], evaluated: null },
  };
}

test('空间对象结果包含曲线/曲面网格并分派到 space', () => {
  const result = computeLab(problem({
    kind: 'space', task: 'green', conditions: {},
  }, {
    answer: '2', answer_value: 2, solution_complete: true, summary: 'Green 公式',
    space: { kind: 'curve', curves: [{ id: 'boundary', label: '边界曲线', points: [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
    ] }] },
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'space');
  if (result.subject !== 'calculus') return;
  assert.equal(result.space?.curves?.length, 1);
  assert.equal(result.metrics.find(item => item.id === 'value')?.value, '2');
});

test('空间几何点/线对象可投影展示', () => {
  const result = computeLab(problem({
    kind: 'space', task: 'space_geometry', conditions: {},
  }, {
    answer: '点到平面距离 2', answer_value: 2, solution_complete: true,
    space: { kind: 'geometry', points: [{ id: 'P', x: 0, y: 0, z: 0 }, { id: '投影', x: 2, y: 0, z: 0 }],
      line: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
  }), {});
  if (result.subject !== 'calculus') return;
  assert.equal(result.space?.points?.length, 2);
  assert.equal(result.space?.line?.length, 2);
});
