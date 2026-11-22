import test from 'node:test';
import assert from 'node:assert/strict';
import { osPipelines } from './lab408PipelineOs.ts';
import type { PipelineResult } from './lab408PipelineTypes.ts';

function run(kind: string, edits: Record<string, { text?: string; params?: Record<string, number> }> = {}) {
  const results: Record<string, PipelineResult> = {};
  for (const stage of osPipelines[kind]!.stages) {
    results[stage.id] = stage.run({
      text: edits[stage.id]?.text ?? stage.text ?? '',
      params: { ...Object.fromEntries((stage.controls ?? []).map(item => [item.key, item.value])), ...edits[stage.id]?.params },
      upstream: (stage.inputs ?? []).map(id => results[id]?.data ?? null),
    });
  }
  return results;
}

test('CPU shares an edited process table across algorithms and compares their Gantt charts and weighted turnaround', () => {
  const results = run('cpuScheduleLab', { processes: { text: 'A 0 5\nB 1 3\nC 2 1' } });
  assert.deepEqual(results.compare!.frames[0]!.timeline?.map(track => track.segments.map(segment => segment.label)), [
    ['A', 'B', 'C'], ['A', 'C', 'B'], ['A', 'B', 'C', 'B', 'A'], ['A', 'B', 'C', 'A', 'B', 'A'],
  ]);
  assert.deepEqual(results.compare!.frames[0]!.rows?.map(row => row[2]), ['3.44', '2.56', '1.38', '2.38']);
});

test('RR exposes queue order after injecting a simultaneous arrival and requeuing the expired process', () => {
  const results = run('cpuScheduleLab', { processes: { text: 'P1 0 5\nP2 0 5\nP3 1 5\nP4 2 5' } });
  assert.deepEqual(results.rr!.frames[2]!.rows?.map(row => row[0]), ['P2', 'P3', 'P4', 'P1']);
  assert.deepEqual(results.rr!.frames[2]!.rows?.map(row => row[2]), [4, 5, 5, 3]);
});

test('page comparison uses the same references for all four branches and highlights cumulative Belady divergence', () => {
  const results = run('pageReplace', { references: { text: '1 2 3 4 1 2 5 1 2 3 4 5' } });
  const frames = results.compare!.frames;
  assert.equal(frames.length, 12);
  assert.deepEqual(frames[3]!.rows?.map(row => row[3]), ['1', '—', '1', '3']);
  assert.deepEqual(frames[10]!.highlightRows, []);
  assert.deepEqual(frames[11]!.highlightRows, [0, 1]);
  assert.deepEqual(frames[11]!.rows?.map(row => row[4]), [9, 10, 10, 7]);
});

const resources = { text: 'Available: 1\nP0 1 | 1\nP1 1 | 2' };

test('Banker commits a safe tentative request and lists the safe order', () => {
  const results = run('bankerLab', { resources, request: { text: 'P0: 1' } });
  assert.deepEqual(results.request!.data.available, [0]);
  assert.equal(results.decision!.data.status, 'granted');
  assert.deepEqual(results.decision!.data.sequence, ['P0', 'P1']);
  assert.deepEqual(results.decision!.data.available, [0]);
});

test('Banker rolls back an unsafe tentative request without mutating the original matrices', () => {
  const results = run('bankerLab', { resources, request: { text: 'P1: 1' } });
  assert.deepEqual(results.request!.data.available, [0]);
  assert.equal(results.safety!.data.safe, false);
  assert.equal(results.decision!.data.status, 'rolledBack');
  assert.deepEqual(results.decision!.data.available, [1]);
  assert.deepEqual(results.decision!.data.allocation, [[1], [1]]);
  assert.deepEqual(results.decision!.data.need, [[1], [2]]);
});

test('Banker distinguishes excess need from insufficient availability before tentative allocation', () => {
  const exceeded = run('bankerLab', { resources, request: { text: 'P0: 2' } });
  const unavailable = run('bankerLab', { resources, request: { text: 'P1: 2' } });
  assert.equal(exceeded.decision!.data.status, 'exceedsNeed');
  assert.equal(unavailable.decision!.data.status, 'unavailable');
  assert.deepEqual(unavailable.decision!.data.available, [1]);
});
