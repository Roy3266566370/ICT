import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateOs } from './opsys.ts';
import type { LabModel } from './types.ts';

test('front-end OS replays embedded generic results', () => {
  const model = {
    subject: 'operating_system',
    engine: 'os_sync_v1',
    os_kind: 'sync',
    defaults: {},
    os_result: {
      subject: 'operating_system',
      engine: 'os_sync_v1',
      os_kind: 'sync',
      status: 'ok',
      algorithm: 'semaphore_trace',
      answer: 'S=0，等待 0 个',
      headline: 'S=0，等待 0 个',
      answer_value: null,
      answer_order: null,
      metrics: [],
      checks: [],
      notes: [],
      pseudocode: ['P(S)：S=S−1'],
      frames: [{ index: 0, action: 'p', label: 'P(S)', detail: 'S=0', values: { value: 0 }, pseudocodeLine: 1 }],
      stats: { values: { S: 0 } },
    },
  } as unknown as LabModel;
  const result = evaluateOs(model, {});
  assert.equal(result.osKind, 'sync');
  assert.equal(result.answer, 'S=0，等待 0 个');
  assert.equal(result.frames.length, 1);
});

test('front-end HRRN matches the expected waiting time', () => {
  const model = {
    subject: 'operating_system',
    engine: 'os_sched_v1',
    os_kind: 'cpu_schedule',
    processes: [
      { id: 'P1', arrival: 0, burst: 7, priority: null },
      { id: 'P2', arrival: 2, burst: 4, priority: null },
      { id: 'P3', arrival: 4, burst: 1, priority: null },
    ],
    has_priority: false,
    defaults: { algorithm: 'hrrn', quantum: 2 },
    params: [],
  } as unknown as LabModel;
  const result = evaluateOs(model, {});
  assert.equal(result.osKind, 'cpu_schedule');
  assert.equal(result.answerValue, 3);
});
