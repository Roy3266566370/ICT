import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateOs } from './opsys.ts';
import type { OsPageResult } from './opsys.ts';
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

test('front-end Clock replacement drives reference bits and working set', () => {
  const model = {
    subject: 'operating_system', engine: 'os_page_v1', os_kind: 'page_replace',
    reference: '1,2,3,2,1,4,1,2,5'.split(','), initial_frames: [],
    defaults: { algorithm: 'clock', frames: 3, window: 4 }, params: [],
  } as unknown as LabModel;
  const result = evaluateOs(model, {}) as OsPageResult;
  assert.equal(result.stats.faults, 7);
  assert.equal(result.stats.max_working_set, 4);
  assert.equal(result.stats.thrash, true);
  const replacement = result.frames.find((frame) => frame.action === 'replace');
  assert.ok(Array.isArray(replacement?.values.refs));
  assert.equal(typeof replacement?.values.hand, 'number');
});

test('front-end page replacement honors preloaded frames', () => {
  const model = {
    subject: 'operating_system', engine: 'os_page_v1', os_kind: 'page_replace',
    reference: '0,1,2,0,5,1,4,3,0,2,3,2,0'.split(','), initial_frames: ['0', '1', '2'],
    defaults: { algorithm: 'lru', frames: 3, window: 4 }, params: [],
  } as unknown as LabModel;
  const result = evaluateOs(model, {}) as OsPageResult;
  assert.equal(result.stats.faults, 6);
  assert.deepEqual(result.stats.initial_frames, ['0', '1', '2']);
  assert.equal(result.frames[0]?.values.frames[0], '0');
  assert.equal(result.frames[1]?.action, 'hit');
});

test('new file kinds replay the embedded kernel result', () => {
  const model = {
    subject: 'operating_system', engine: 'os_file_alloc_v1', os_kind: 'file_alloc',
    defaults: {}, params: [],
    os_result: {
      subject: 'operating_system', engine: 'os_file_alloc_v1', os_kind: 'file_alloc', status: 'ok',
      algorithm: '', answer: '空闲块 4 个，首个空闲块号 2', headline: '空闲块 4 个，首个空闲块号 2',
      answer_value: 2, answer_order: null, metrics: [], checks: [], notes: [], pseudocode: ['位示图'],
      frames: [{ index: 0, action: 'bitmap', label: '位示图', detail: '0 为空闲', values: { 空闲块数: '4' }, pseudocodeLine: 1 }],
      stats: { bitmap: { free: [2, 3, 5, 6] } },
    },
  } as unknown as LabModel;
  const result = evaluateOs(model, {});
  assert.equal(result.osKind, 'file_alloc');
  assert.equal(result.answer, '空闲块 4 个，首个空闲块号 2');
  assert.equal(result.frames.length, 1);
});

test('page concept results without a reference replay the embedded kernel result', () => {
  const model = {
    subject: 'operating_system', engine: 'os_page_v1', os_kind: 'page_replace', reference: [],
    defaults: {}, params: [],
    os_result: {
      subject: 'operating_system', engine: 'os_page_v1', os_kind: 'page_replace', status: 'ok',
      algorithm: '', answer: '请求分页与缺页处理', headline: '请求分页与缺页处理', answer_value: null,
      answer_order: null, metrics: [], checks: [], notes: [], pseudocode: ['查页表'],
      frames: [{ index: 0, action: 'concept', label: '请求分页', detail: '查页表', values: { 模式: '请求分页' }, pseudocodeLine: 1 }],
      stats: { concept: true },
    },
  } as unknown as LabModel;
  const result = evaluateOs(model, {});
  assert.equal(result.osKind, 'page_replace');
  assert.equal(result.answer, '请求分页与缺页处理');
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
