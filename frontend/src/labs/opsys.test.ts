import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOs } from './opsys.ts';
import type { OsBankerResult, OsDiskResult, OsPageResult, OsSchedResult } from './opsys.ts';
import type { LabModel } from './types.ts';

function schedModel(): LabModel {
  return {
    engine: 'os_sched_v1', subject: 'operating_system', os_kind: 'cpu_schedule', has_priority: false,
    processes: [
      { id: 'P1', arrival: 0, burst: 7, priority: null }, { id: 'P2', arrival: 2, burst: 4, priority: null },
      { id: 'P3', arrival: 4, burst: 1, priority: null }, { id: 'P4', arrival: 5, burst: 4, priority: null },
    ],
    defaults: { algorithm: 'fcfs', quantum: 2 }, params: [],
  } as LabModel;
}

test('scheduling averages match the textbook for FCFS, SJF and SRTF', () => {
  const expected: Record<string, [number, number]> = { fcfs: [8.75, 4.75], sjf: [8, 4], srtf: [7, 3] };
  for (const [algorithm, [turnaround, waiting]] of Object.entries(expected)) {
    const result = evaluateOs(schedModel(), { algorithm }) as OsSchedResult;
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.avg_turnaround, turnaround);
    assert.equal(result.stats.avg_waiting, waiting);
    assert.ok(result.checks.every((check) => check.status === 'pass'));
  }
});

test('SRTF merges consecutive slices and counts switches', () => {
  const result = evaluateOs(schedModel(), { algorithm: 'srtf' }) as OsSchedResult;
  assert.deepEqual(result.stats.gantt.map((g) => [g.id, g.start, g.end]),
    [['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 5], ['P2', 5, 7], ['P4', 7, 11], ['P1', 11, 16]]);
  assert.equal(result.stats.switches, 5);
});

test('round robin puts new arrivals before the preempted process', () => {
  const model = {
    ...schedModel(),
    processes: [
      { id: 'P1', arrival: 0, burst: 5, priority: null }, { id: 'P2', arrival: 1, burst: 3, priority: null },
      { id: 'P3', arrival: 2, burst: 1, priority: null },
    ],
  } as LabModel;
  const result = evaluateOs(model, { algorithm: 'rr', quantum: 2 }) as OsSchedResult;
  assert.deepEqual(result.stats.gantt.map((g) => [g.id, g.start, g.end]),
    [['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 5], ['P1', 5, 7], ['P2', 7, 8], ['P1', 8, 9]]);
  assert.ok(Math.abs(result.stats.avg_waiting - 10 / 3) < 1e-6);
});

test('priority scheduling is blocked without priorities and idle gaps are explicit', () => {
  assert.equal(evaluateOs(schedModel(), { algorithm: 'priority' }).status, 'blocked');
  const model = {
    ...schedModel(),
    processes: [{ id: 'P1', arrival: 0, burst: 2, priority: null }, { id: 'P2', arrival: 5, burst: 2, priority: null }],
  } as LabModel;
  const result = evaluateOs(model, {}) as OsSchedResult;
  assert.deepEqual(result.stats.gantt.map((g) => [g.id, g.start, g.end]), [['P1', 0, 2], [null, 2, 5], ['P2', 5, 7]]);
});

function pageModel(reference: string): LabModel {
  return {
    engine: 'os_page_v1', subject: 'operating_system', os_kind: 'page_replace', reference: reference.split(','),
    defaults: { algorithm: 'fifo', frames: 3 }, params: [],
  } as LabModel;
}

test('page replacement reproduces the classic FIFO / LRU / OPT counts', () => {
  const model = pageModel('7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1');
  for (const [algorithm, faults] of Object.entries({ fifo: 15, lru: 12, opt: 9 })) {
    const result = evaluateOs(model, { algorithm }) as OsPageResult;
    assert.equal(result.stats.faults, faults);
    assert.deepEqual(result.stats.compare, { fifo: 15, lru: 12, opt: 9 });
  }
  const replaced = evaluateOs(model, {}).frames.find((frame) => frame.action === 'replace');
  assert.equal(replaced?.values.evicted, '7');
});

test('Belady anomaly is reported for FIFO only', () => {
  const model = pageModel('1,2,3,4,1,2,5,1,2,3,4,5');
  const three = evaluateOs(model, {}) as OsPageResult;
  const four = evaluateOs(model, { frames: 4 }) as OsPageResult;
  assert.deepEqual([three.stats.faults, four.stats.faults], [9, 10]);
  assert.equal(three.checks.find((check) => check.id === 'belady')?.status, 'warn');
  assert.equal((evaluateOs(model, { algorithm: 'lru' }) as OsPageResult).checks.find((c) => c.id === 'belady')?.status, 'pass');
});

function diskModel(): LabModel {
  return {
    engine: 'os_disk_v1', subject: 'operating_system', os_kind: 'disk_schedule',
    requests: [98, 183, 37, 122, 14, 124, 65, 67], head: 53, max_track: 199,
    defaults: { algorithm: 'fcfs', direction: 'up', return_cost: 'count' }, params: [],
  } as LabModel;
}

test('disk scheduling totals match the classic example', () => {
  const totals: Record<string, number> = { fcfs: 640, sstf: 236, scan: 331, look: 299, cscan: 382, clook: 322 };
  for (const [algorithm, total] of Object.entries(totals)) {
    const result = evaluateOs(diskModel(), { algorithm }) as OsDiskResult;
    assert.equal(result.stats.total, total, algorithm);
    assert.ok(result.checks.every((check) => check.status === 'pass'));
  }
  assert.equal((evaluateOs(diskModel(), { algorithm: 'cscan', return_cost: 'skip' }) as OsDiskResult).stats.total, 183);
  assert.equal((evaluateOs(diskModel(), { algorithm: 'scan', direction: 'down' }) as OsDiskResult).stats.total, 236);
  assert.deepEqual((evaluateOs(diskModel(), { algorithm: 'sstf' }) as OsDiskResult).stats.served,
    [65, 67, 37, 14, 98, 122, 124, 183]);
});

function bankerModel(request: { process: string; vector: number[] } | null): LabModel {
  const allocation = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]];
  const max = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]];
  return {
    engine: 'os_banker_v1', subject: 'operating_system', os_kind: 'banker',
    names: ['P0', 'P1', 'P2', 'P3', 'P4'], resources: ['A', 'B', 'C'], allocation,
    need: max.map((row, i) => row.map((value, j) => value - allocation[i]![j]!)), available: [3, 3, 2], request,
    defaults: { request_mode: request ? 'apply' : 'ignore' }, params: [],
  } as LabModel;
}

test('banker finds the safe sequence and handles requests', () => {
  const plain = evaluateOs(bankerModel(null), {}) as OsBankerResult;
  assert.deepEqual(plain.answerOrder, ['P1', 'P3', 'P0', 'P2', 'P4']);
  const granted = evaluateOs(bankerModel({ process: 'P1', vector: [1, 0, 2] }), {}) as OsBankerResult;
  assert.equal(granted.stats.granted, true);
  assert.deepEqual(granted.frames.slice(0, 3).map((frame) => frame.action), ['initial', 'request_check', 'request_try']);
  const denied = evaluateOs(bankerModel({ process: 'P4', vector: [3, 3, 0] }), {}) as OsBankerResult;
  assert.equal(denied.stats.granted, false);
  assert.deepEqual(denied.stats.state.available, [3, 3, 2]);
  const over = evaluateOs(bankerModel({ process: 'P1', vector: [5, 0, 0] }), {}) as OsBankerResult;
  assert.equal(over.frames[1]?.action, 'request_deny');
});

test('banker reports an unsafe state without a sequence', () => {
  const model = {
    ...bankerModel(null), names: ['P0', 'P1'], allocation: [[1, 0], [0, 1]], need: [[2, 3], [3, 2]],
    available: [0, 0], resources: ['A', 'B'],
  } as LabModel;
  const result = evaluateOs(model, {}) as OsBankerResult;
  assert.equal(result.status, 'ok');
  assert.equal(result.stats.safe, false);
  assert.equal(result.answerOrder, null);
  assert.equal(result.stopReason, 'unsafe');
});
