import test from 'node:test';
import assert from 'node:assert/strict';

import { NET_KIND_LABELS, replayNetwork } from './network.ts';
import type { LabProblem } from './types.ts';

function problemWith(result: Record<string, unknown> | undefined): LabProblem {
  return {
    model: {
      subject: 'computer_network', engine: 'net_perf_v1', net_kind: 'performance',
      defaults: {}, params: [], net_result: result,
    },
    solution: {},
    recognition: {},
  } as unknown as LabProblem;
}

test('front-end replays the embedded network result', () => {
  const result = replayNetwork(problemWith({
    subject: 'computer_network', engine: 'net_perf_v1', net_kind: 'performance', status: 'ok',
    answer: '总时延 5.08 ms', headline: '总时延 5.08 ms', answer_value: 5.08, answer_order: null,
    metrics: [], checks: [], notes: [], pseudocode: ['发送时延 = L/R'],
    frames: [{ index: 0, action: 'delay', label: '发送时延与传播时延', detail: '5.08 ms', values: { 总时延: '5.08 ms' }, pseudocodeLine: 1 }],
    stats: { delay: { total_s: 0.00508 } },
  }));
  assert.equal(result.netKind, 'performance');
  assert.equal(result.answer, '总时延 5.08 ms');
  assert.equal(result.answerValue, 5.08);
  assert.equal(result.frames.length, 1);
});

test('new IP results replay with their own kind and answer', () => {
  const result = replayNetwork(problemWith({
    subject: 'computer_network', engine: 'net_ip_v1', net_kind: 'ip', status: 'ok',
    answer: '网络地址 192.168.1.0', headline: '网络地址 192.168.1.0', answer_value: null,
    answer_order: null, metrics: [], checks: [], notes: [], pseudocode: ['掩码'],
    frames: [{ index: 0, action: 'subnet', label: 'IPv4 子网计算', detail: '掩码 /24', values: { 网络地址: '192.168.1.0' }, pseudocodeLine: 1 }],
    stats: { subnet: { network: '192.168.1.0' } },
  }));
  assert.equal(result.netKind, 'ip');
  assert.equal(result.answer, '网络地址 192.168.1.0');
});

test('missing network result is explicit', () => {
  assert.throws(() => replayNetwork(problemWith(undefined)), /执行记录尚未生成/);
});

test('network kind labels cover all supported modules', () => {
  assert.deepEqual(Object.keys(NET_KIND_LABELS).sort(),
    ['application', 'architecture', 'error_control', 'ethernet', 'ip', 'mac', 'network_layer',
      'performance', 'physical', 'sliding_window', 'tcp_control', 'transport']);
});
