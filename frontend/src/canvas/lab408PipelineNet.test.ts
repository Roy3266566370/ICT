import assert from 'node:assert/strict';
import test from 'node:test';
import { netPipelines } from './lab408PipelineNet.ts';

function simulate(
  kind: string,
  overrides: Record<string, { text?: string; params?: Record<string, number> }>,
) {
  const pipeline = netPipelines[kind];
  assert.ok(pipeline, `missing ${kind} pipeline`);
  const results = new Map<string, ReturnType<(typeof pipeline.stages)[number]['run']>>();
  for (const stage of pipeline.stages) {
    const override = overrides[stage.id];
    results.set(stage.id, stage.run({
      text: override?.text ?? stage.text ?? '',
      params: { ...Object.fromEntries((stage.controls ?? []).map(control => [control.key, control.value])), ...override?.params },
      upstream: (stage.inputs ?? []).map(id => results.get(id)?.data ?? null),
    }));
  }
  return results;
}

test('TCP Reno exits fast recovery on a new ACK and resets to one on timeout', () => {
  const results = simulate('tcpCongestionLab', {
    source: { text: 'ack ack ack ack 3ack ack@3 timeout', params: { rwnd: 6 } },
  });
  assert.deepEqual(results.get('curves')?.frames[0]?.series, [
    { label: 'cwnd', values: [1, 2, 4, 8, 9, 7, 4, 1] },
    { label: 'ssthresh', values: [8, 8, 8, 8, 8, 4, 4, 2] },
    { label: 'rwnd', values: [6, 6, 6, 6, 6, 6, 3, 3] },
    { label: 'swnd', values: [1, 2, 4, 6, 6, 6, 3, 1] },
  ]);
  assert.deepEqual(results.get('diagnostics')?.data, {
    fastRetransmits: 1, timeouts: 1, flowLimited: 4, congestionLimited: 4,
  });
});

test('TCP ignores invalid event names and shows a closed receive window', () => {
  const results = simulate('tcpCongestionLab', { source: { text: 'nack ack@0' } });
  assert.deepEqual(results.get('curves')?.frames[0]?.series?.find(series => series.label === 'swnd')?.values, [1, 0]);
  assert.match(results.get('source')?.frames[0]?.summary ?? '', /nack/);
});

test('TCP source actions append separate RTT events to the editor text', () => {
  const source = netPipelines.tcpCongestionLab?.stages.find(stage => stage.id === 'source');
  assert.ok(source?.actions);
  const text = 'ack' + source.actions.map(action => action.append).join('');
  const results = simulate('tcpCongestionLab', { source: { text } });
  assert.deepEqual(results.get('source')?.data.events, [
    { event: 'ack', rwnd: 6 }, { event: 'ack', rwnd: 6 },
    { event: '3ack', rwnd: 6 }, { event: 'timeout', rwnd: 6 },
  ]);
});

test('SR buffers out-of-order frames while GBN discards and retransmits them', () => {
  const results = simulate('slidingWindowLab', {
    source: { text: '1', params: { winSize: 4, frameCount: 5, seqBits: 3 } },
  });
  assert.deepEqual(results.get('gbn')?.data.retransmitted, [1, 2, 3, 4]);
  assert.deepEqual(results.get('sr')?.data.retransmitted, [1]);
  assert.equal(results.get('sr')?.data.peakBuffer, 3);
  assert.equal(results.get('comparison')?.data.saved, 3);
});

test('SR reports a sequence space too small for the selected window', () => {
  const results = simulate('slidingWindowLab', {
    source: { text: '1', params: { winSize: 4, frameCount: 5, seqBits: 2 } },
  });
  assert.match(String(results.get('gbn')?.data.error), /3/);
  assert.match(String(results.get('sr')?.data.error), /2/);
  assert.equal(results.get('comparison')?.data.saved, undefined);
});

test('the shared window source accepts the GBN maximum and ignores malformed loss IDs', () => {
  const results = simulate('slidingWindowLab', {
    source: { text: '1oops 2', params: { winSize: 31, frameCount: 32, seqBits: 5 } },
  });
  assert.deepEqual(results.get('source')?.data.losses, [2]);
  assert.equal(results.get('gbn')?.data.sentCount, 62);
  assert.match(String(results.get('sr')?.data.error), /31/);
});

test('IPv4 fragmentation uses aligned payload offsets and routes to the longest matching prefix', () => {
  const results = simulate('ipSubnet', {
    source: { text: '192.168.1.70/26', params: { totalLength: 4000 } },
    fragments: { params: { mtu: 1500 } },
    routing: { text: '0.0.0.0/0 GW\n192.168.1.0/24 A\n192.168.1.64/26 B\n192.168.1.128/25 C' },
  });
  assert.equal(results.get('cidr')?.data.network, '192.168.1.64');
  assert.deepEqual(results.get('fragments')?.data.fragments, [
    { totalLength: 1500, payload: 1480, offset: 0, mf: 1 },
    { totalLength: 1500, payload: 1480, offset: 185, mf: 1 },
    { totalLength: 1040, payload: 1020, offset: 370, mf: 0 },
  ]);
  assert.equal(results.get('routing')?.data.nextHop, 'B');
  assert.deepEqual(results.get('routing')?.data.matches, ['0.0.0.0/0', '192.168.1.0/24', '192.168.1.64/26']);
});

test('IPv4 rejects a malformed destination and routes a host address through the default entry', () => {
  const invalid = simulate('ipSubnet', { source: { text: '192.168.1.256/24' } });
  assert.ok(invalid.get('source')?.data.error);
  assert.equal(invalid.get('routing')?.data.nextHop, undefined);
  const host = simulate('ipSubnet', {
    source: { text: '10.0.0.9/32', params: { totalLength: 68 } },
    fragments: { params: { mtu: 68 } },
    routing: { text: '0.0.0.0/0 默认路由\n10.0.0.1/32 本地出口' },
  });
  assert.equal(host.get('cidr')?.data.network, '10.0.0.9');
  assert.deepEqual(host.get('fragments')?.data.fragments, [
    { totalLength: 68, payload: 48, offset: 0, mf: 0 },
  ]);
  assert.equal(host.get('routing')?.data.nextHop, '默认路由');
});

test('IPv4 allows an unaligned final fragment up to the exact MTU', () => {
  const results = simulate('ipSubnet', {
    source: { text: '192.168.1.70/26', params: { totalLength: 119 } },
    fragments: { params: { mtu: 71 } },
  });
  assert.deepEqual(results.get('fragments')?.data.fragments, [
    { totalLength: 68, payload: 48, offset: 0, mf: 1 },
    { totalLength: 71, payload: 51, offset: 6, mf: 0 },
  ]);
});
