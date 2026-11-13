import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from './compute.ts';
import type { LabModel, LabProblem, LabSolution } from './types.ts';

function problem(model: Partial<LabModel>, solution: Partial<LabSolution> = {}): LabProblem {
  return {
    problem_id: 'p4', number: '1', title: 'P4', text: 'P4', subject: 'calculus', subject_label: '微积分',
    confidence: 0.9, status: 'ready',
    source: { page_from: 1, page_to: 1, file_names: [], label: '文本', excerpt: 'P4' }, source_pages: [],
    recognition: { method: 'typed_text', raw_text: 'P4', conditions: [], ambiguities: [], formulas: [], recognized_subject: 'calculus' },
    model: { engine: 'test', subject: 'calculus', defaults: {}, params: [], ...model },
    solution: { summary: '', answer: '', steps: [], ...solution },
    states: { params: {}, step: 0, mode: 'explore', notes: '', observations: [], events: [], scenarios: [], active_scenario_id: 'baseline', attempts: [], evaluated: null },
  };
}

test('数项级数绘制部分和并显示绝对/条件敛散', () => {
  const result = computeLab(problem({
    engine: 'series_v1', kind: 'series_convergence', task: 'series_convergence',
    term: '1/n^2', index_start: 1, defaults: { start: 1 },
  }, {
    answer: '绝对收敛', series_status: 'absolutely_convergent', series_method: 'p 级数',
    series_sum: 'pi^2/6', solution_complete: true,
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'series_convergence');
  if (result.subject !== 'calculus') return;
  assert.ok((result.seriesPartial?.length ?? 0) > 5);
  assert.equal(result.metrics.find(item => item.id === 'status')?.value, '绝对收敛');
});

test('幂级数展示半径、区间和端点点位', () => {
  const result = computeLab(problem({
    engine: 'power_series_v1', kind: 'power_series', task: 'power_series', goal: 'radius',
    coefficient: '1/n', center: '0', defaults: { center: 0 },
  }, {
    answer: '收敛半径 R=1', power_goal: 'radius', radius: '1', interval: '[-1, 1)',
    endpoint_status: [{ label: '右端点', point: '1', status: 'divergent', included: false }],
    solution_complete: true,
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'power_series');
  if (result.subject !== 'calculus') return;
  assert.equal(result.power?.interval, '[-1, 1)');
  assert.equal(result.power?.endpoints?.length, 1);
});

test('傅里叶级数同时绘制原函数与部分和', () => {
  const result = computeLab(problem({
    engine: 'fourier_v1', kind: 'fourier_series', task: 'fourier_series', expression: 'x',
    defaults: { lower: -Math.PI, upper: Math.PI, order: 3 },
  }, {
    answer: 'Fourier 级数', solution_complete: true,
    fourier: { a0: '0', coefficients: [{ n: 1, an: '0', bn: '2' }], partial: '2*sin(x)',
      order: 3, lower: '-pi', upper: 'pi', period: '2*pi', discontinuities: [], endpoint_jump: true,
      convergence_note: '端点按 Dirichlet 定理。' },
  }), {});
  assert.equal(result.subject === 'calculus' ? result.kind : '', 'fourier_series');
  if (result.subject !== 'calculus') return;
  assert.ok((result.overlays?.[0]?.series.length ?? 0) > 100);
  assert.match(result.checks.find(item => item.id === 'convergence')?.detail ?? '', /Dirichlet/);
});
