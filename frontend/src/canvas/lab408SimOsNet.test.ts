import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_REFERENCE, pageReplacement } from './lab408.ts';
import {
  bankerFrames,
  cpuScheduleFrames,
  pageFrames,
  parseBankerText,
  parseProcessTable,
  parseSeqList,
  parseTcpEvents,
  slidingWindowFrames,
  subnetBits,
  tcpCongestionFrames,
  type CpuProcess,
} from './lab408SimOsNet.ts';

const PROCESSES: readonly CpuProcess[] = [
  { id: 'P1', arrival: 0, burst: 5 },
  { id: 'P2', arrival: 1, burst: 3 },
  { id: 'P3', arrival: 2, burst: 1 },
];

const ALLOCATION = [
  [0, 1, 0],
  [2, 0, 0],
  [3, 0, 2],
  [2, 1, 1],
  [0, 0, 2],
];
const NEED = [
  [7, 4, 3],
  [1, 2, 2],
  [6, 0, 0],
  [0, 1, 1],
  [4, 3, 1],
];

test('pageFrames 与 pageReplacement 缺页一致且 cursor 指向实际物理块', () => {
  const player = pageFrames(0, 3, PAGE_REFERENCE);
  const sim = pageReplacement(0, 3, PAGE_REFERENCE);
  assert.equal(player.frames.length, sim.steps.length);
  assert.equal(player.frames.filter(frame => frame.fault).length, sim.faults);
  assert.equal(sim.faults, 9);
  player.frames.forEach((frame, index) => {
    const step = sim.steps[index]!;
    assert.deepEqual(frame.frames, step.frames);
    assert.equal(frame.evicted, step.evicted);
    assert.equal(frame.frames[frame.cursor], frame.page);
  });
  assert.equal(player.frames[3]!.evicted, 1);
  assert.equal(player.frames[3]!.cursor, 0);
  assert.equal(pageFrames(1, 3, PAGE_REFERENCE).frames.filter(frame => frame.fault).length, pageReplacement(1, 3).faults);
  assert.equal(pageFrames(2, 3, PAGE_REFERENCE).frames.filter(frame => frame.fault).length, pageReplacement(2, 3).faults);
});

test('cpuScheduleFrames 的 FCFS / SJF / SRTF 周转指标', () => {
  const fcfs = cpuScheduleFrames(PROCESSES, 'FCFS', 2);
  assert.deepEqual(fcfs.metrics.map(item => item.finish), [5, 8, 9]);
  assert.ok(Math.abs(fcfs.avgTurnaround - 19 / 3) < 1e-6);
  assert.ok(Math.abs(fcfs.avgWeighted - 3.4444) < 1e-3);

  const sjf = cpuScheduleFrames(PROCESSES, 'SJF', 2);
  assert.deepEqual(sjf.metrics.map(item => item.finish), [5, 9, 6]);
  assert.ok(Math.abs(sjf.avgTurnaround - 17 / 3) < 1e-6);

  const srtf = cpuScheduleFrames(PROCESSES, 'SRTF', 2);
  assert.deepEqual(srtf.metrics.map(item => item.finish), [9, 5, 3]);
  assert.ok(Math.abs(srtf.avgTurnaround - 14 / 3) < 1e-6);
});

test('cpuScheduleFrames 轮转按时间片推进且甘特图首尾相接', () => {
  const rr = cpuScheduleFrames(PROCESSES, 'RR', 2);
  assert.ok(Math.abs(rr.avgTurnaround - 19 / 3) < 1e-6);
  assert.equal(rr.metrics.find(item => item.pid === 'P1')!.finish, 9);
  assert.equal(rr.frames[0]!.tick, 0);
  rr.frames.forEach((frame, index) => assert.equal(frame.tick, index));
  rr.gantt.forEach((segment, index) => {
    if (index > 0) assert.equal(segment.start, rr.gantt[index - 1]!.end);
  });
  assert.equal(rr.gantt[rr.gantt.length - 1]!.end, Math.max(...rr.metrics.map(item => item.finish)));
});

test('parseProcessTable 解析带标识与纯数字表格', () => {
  assert.deepEqual(parseProcessTable('P1 0 5\nP2, 1, 3\nP3 2 1'), PROCESSES);
  assert.deepEqual(parseProcessTable('0 5\n1 3'), [
    { id: 'P1', arrival: 0, burst: 5 },
    { id: 'P2', arrival: 1, burst: 3 },
  ]);
});

test('bankerFrames 判定经典安全实例与卡死实例', () => {
  const safe = bankerFrames([3, 3, 2], ALLOCATION, NEED);
  const lastSafe = safe.frames[safe.frames.length - 1]!;
  assert.equal(lastSafe.safe, true);
  assert.equal(lastSafe.finish.length, 5);
  assert.ok(lastSafe.finish.every(Boolean));
  assert.equal(lastSafe.sequence.length, 5);

  const unsafe = bankerFrames([1, 1, 1], ALLOCATION, NEED);
  const lastUnsafe = unsafe.frames[unsafe.frames.length - 1]!;
  assert.equal(lastUnsafe.safe, false);
  assert.ok(lastUnsafe.finish.some(done => !done));
  assert.ok(unsafe.frames.some(frame => frame.note.includes('不安全')));
});

test('parseBankerText 解析可用资源与分配/需求矩阵', () => {
  const text = [
    'available: 3,3,2',
    'P0 0 1 0 | 7 4 3',
    'P1 2 0 0 | 1 2 2',
    'P2 3 0 2 | 6 0 0',
    'P3 2 1 1 | 0 1 1',
    'P4 0 0 2 | 4 3 1',
  ].join('\n');
  const parsed = parseBankerText(text);
  assert.deepEqual(parsed.available, [3, 3, 2]);
  assert.deepEqual(parsed.allocation, ALLOCATION);
  assert.deepEqual(parsed.need, NEED);
  assert.deepEqual(parseBankerText('可用: 1 1 1\nP0 0 1 0 7 4 3').need, [[7, 4, 3]]);
});

test('subnetBits 给出 26 位掩码二进制与子网占比', () => {
  const bits = subnetBits(26, 0);
  assert.equal(bits.prefix, 26);
  assert.equal(bits.count, 4);
  assert.equal(bits.maskInt, 0xffffffc0);
  assert.equal(bits.maskBinary, '11111111111111111111111111000000');
  assert.equal(bits.networkBinary, '11000000101010000000000100000000');
  assert.equal(bits.broadcastBinary, '11000000101010000000000100111111');
  assert.equal(bits.share, 0.25);
  assert.deepEqual([bits.shareStart, bits.shareEnd], [0, 63]);
  assert.equal(bits.info.network, '192.168.1.0');
  assert.deepEqual([subnetBits(26, 1).shareStart, subnetBits(26, 1).shareEnd], [64, 127]);
});

test('tcpCongestionFrames 走完慢开始、拥塞避免、快重传与超时', () => {
  const tcp = tcpCongestionFrames(8, ['ack', 'ack', 'ack', 'ack', '3ack', 'timeout']);
  assert.deepEqual(tcp.frames.map(frame => frame.cwnd), [1, 2, 4, 8, 9, 4, 1]);
  assert.deepEqual(tcp.frames.map(frame => frame.rtt), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(tcp.frames[4]!.state, 'congestion_avoidance');
  assert.equal(tcp.frames[5]!.ssthresh, 4);
  assert.equal(tcp.frames[5]!.cwnd, 4);
  assert.equal(tcp.frames[5]!.state, 'fast_recovery');
  assert.equal(tcp.frames[6]!.ssthresh, 2);
  assert.equal(tcp.frames[6]!.cwnd, 1);
  assert.equal(tcp.frames[6]!.state, 'slow_start');
});

test('parseTcpEvents 解析 ACK / 三次重复 ACK / 超时', () => {
  assert.deepEqual(parseTcpEvents('ack, ack, 3ack, timeout'), ['ack', 'ack', '3ack', 'timeout']);
  assert.deepEqual(parseTcpEvents('ack 3 ack 超时'), ['ack', '3ack', 'timeout']);
});

test('slidingWindowFrames 区分 GBN 与 SR 的重传范围', () => {
  const gbn = slidingWindowFrames(4, 'GBN', [2]);
  assert.deepEqual(gbn.frames[0]!.sendWindow, [0, 1, 2, 3]);
  assert.equal(gbn.frames[0]!.event, 'send');
  assert.deepEqual(gbn.frames[1]!.sendWindow, [1, 2, 3, 4]);
  assert.deepEqual(gbn.frames[2]!.sendWindow, [2, 3, 4, 5]);
  const gbnTimeout = gbn.frames.find(frame => frame.event === 'timeout');
  assert.ok(gbnTimeout);
  assert.deepEqual(gbnTimeout.inFlight, [2, 3, 4, 5]);
  assert.deepEqual(gbnTimeout.recvWindow, [2]);

  const sr = slidingWindowFrames(4, 'SR', [2]);
  assert.deepEqual(sr.frames[2]!.sendWindow, [2, 3, 4, 5]);
  const srTimeout = sr.frames.find(frame => frame.event === 'timeout');
  assert.ok(srTimeout);
  assert.deepEqual(srTimeout.inFlight, [2]);
  assert.deepEqual(srTimeout.recvWindow, [2, 3, 4, 5]);
});

test('parseSeqList 解析逗号与空白分隔的序号', () => {
  assert.deepEqual(parseSeqList('2, 5 7；9'), [2, 5, 7, 9]);
  assert.deepEqual(parseSeqList(''), []);
});