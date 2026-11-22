/** 408 工坊的操作系统与网络步进内核（纯函数，画布与测试共用）。 */

import { PAGE_ALGORITHMS, pageReplacement, subnetInfo, type SubnetResult } from './lab408.ts';
import type { FramePlayer } from './lab408Sim.ts';

export interface PageFrame {
  page: number;
  frames: (number | null)[];
  fault: boolean;
  evicted: number | null;
  cursor: number;
}

export function pageFrames(algorithm: number, capacity: number, reference: readonly number[]): FramePlayer<PageFrame> {
  const kind = algorithm === 1 ? 1 : algorithm === 2 ? 2 : 0;
  const cap = Math.max(1, Math.min(4, Math.round(capacity)));
  const sim = pageReplacement(kind, cap, reference);
  let previous: (number | null)[] | null = null;
  const frames: PageFrame[] = sim.steps.map(step => {
    const changed = previous ? step.frames.findIndex((value, index) => value !== previous![index]) : -1;
    const cursor = step.fault
      ? (changed >= 0 ? changed : step.frames.indexOf(step.page))
      : step.frames.indexOf(step.page);
    previous = step.frames;
    return {
      page: step.page,
      frames: [...step.frames],
      fault: step.fault,
      evicted: step.evicted,
      cursor: cursor >= 0 ? cursor : 0,
    };
  });
  return {
    frames,
    summary: `${PAGE_ALGORITHMS[kind] ?? 'FIFO'} 容量 ${cap}：缺页 ${sim.faults} 次，命中 ${sim.hits} 次`,
  };
}

export interface CpuProcess {
  id: string;
  arrival: number;
  burst: number;
}

export interface CpuGantt {
  pid: string;
  start: number;
  end: number;
}

export interface CpuMetrics {
  pid: string;
  finish: number;
  turnaround: number;
  weighted: number;
}

export interface CpuTick {
  tick: number;
  running: string | null;
  ready: string[];
  gantt: CpuGantt[];
}

type CpuAlgo = 'FCFS' | 'SJF' | 'SRTF' | 'RR';

interface CpuWork extends CpuProcess {
  order: number;
  remaining: number;
  finish: number;
}

function compareRemaining(a: CpuWork, b: CpuWork): number {
  return a.remaining - b.remaining || a.arrival - b.arrival || a.order - b.order;
}

function simulateCpu(processes: readonly CpuProcess[], algo: CpuAlgo, quantum: number) {
  const list: CpuWork[] = processes.map((process, order) => {
    const burst = Math.max(1, Math.round(process.burst));
    return {
      id: process.id,
      arrival: Math.max(0, Math.round(process.arrival)),
      burst,
      order,
      remaining: burst,
      finish: -1,
    };
  });
  const quantumSlice = Math.max(1, Math.round(quantum));
  const ticks: CpuTick[] = [];
  const gantt: CpuGantt[] = [];
  const queue: number[] = [];
  let current: number | null = null;
  let sliceUsed = 0;
  const maxTime = list.reduce((sum, process) => sum + process.burst, 0)
    + Math.max(0, ...list.map(process => process.arrival)) + 2;

  const appendGantt = (pid: string, time: number) => {
    const last = gantt[gantt.length - 1];
    if (last && last.pid === pid && last.end === time) last.end = time + 1;
    else gantt.push({ pid, start: time, end: time + 1 });
  };

  for (let time = 0; time <= maxTime; time += 1) {
    if (list.every(process => process.finish >= 0)) break;
    const runnable = list.filter(process => process.arrival <= time && process.finish < 0);

    if (algo === 'RR') {
      for (const process of list) {
        if (process.arrival === time && process.finish < 0) queue.push(process.order);
      }
    }

    let running = -1;
    if (algo === 'RR') {
      if (current !== null && list[current]!.finish < 0 && sliceUsed < quantumSlice) {
        running = current;
        sliceUsed += 1;
      } else {
        if (current !== null && list[current]!.finish < 0) queue.push(current);
        current = null;
        sliceUsed = 0;
        while (queue.length) {
          const candidate = list[queue.shift()!]!;
          if (candidate.finish >= 0 || candidate.arrival > time) continue;
          current = candidate.order;
          running = candidate.order;
          sliceUsed = 1;
          break;
        }
      }
    } else if (algo !== 'SRTF' && current !== null && list[current]!.finish < 0) {
      running = current;
    } else if (runnable.length) {
      const pick = algo === 'SRTF'
        ? runnable.reduce((best, process) => (compareRemaining(process, best) < 0 ? process : best))
        : algo === 'SJF'
          ? runnable.reduce((best, process) => (
            process.burst - best.burst || process.arrival - best.arrival || process.order - best.order) < 0
            ? process
            : best)
          : runnable.reduce((best, process) => (
            process.arrival - best.arrival || process.order - best.order) < 0 ? process : best);
      current = pick.order;
      running = pick.order;
    }

    if (running >= 0) {
      const process = list[running]!;
      process.remaining -= 1;
      if (process.remaining === 0) process.finish = time + 1;
      appendGantt(process.id, time);
    }

    const ready = algo === 'RR'
      ? queue.map(index => list[index]!.id)
      : list
        .filter(process => process.arrival <= time && process.finish < 0 && process.order !== running)
        .sort((a, b) => a.arrival - b.arrival || a.order - b.order)
        .map(process => process.id);
    ticks.push({
      tick: time,
      running: running >= 0 ? list[running]!.id : null,
      ready,
      gantt: gantt.map(segment => ({ ...segment })),
    });
  }

  const metrics: CpuMetrics[] = list.map(process => {
    const turnaround = process.finish - process.arrival;
    return {
      pid: process.id,
      finish: process.finish,
      turnaround,
      weighted: turnaround / process.burst,
    };
  });
  const totalTurnaround = metrics.reduce((sum, item) => sum + item.turnaround, 0);
  const totalWeighted = metrics.reduce((sum, item) => sum + item.weighted, 0);
  return {
    ticks,
    gantt,
    metrics,
    avgTurnaround: metrics.length ? totalTurnaround / metrics.length : 0,
    avgWeighted: metrics.length ? totalWeighted / metrics.length : 0,
  };
}

export function cpuScheduleFrames(
  processes: readonly CpuProcess[],
  algo: 'FCFS' | 'SJF' | 'SRTF' | 'RR',
  quantum: number,
): FramePlayer<CpuTick> & { gantt: CpuGantt[]; metrics: CpuMetrics[]; avgTurnaround: number; avgWeighted: number } {
  const result = simulateCpu(processes, algo, quantum);
  const label = algo === 'RR' ? `RR(q=${Math.max(1, Math.round(quantum))})` : algo;
  return {
    frames: result.ticks,
    summary: processes.length
      ? `${label}：平均周转 ${result.avgTurnaround.toFixed(2)}，平均带权周转 ${result.avgWeighted.toFixed(2)}`
      : `${label}：无进程`,
    gantt: result.gantt,
    metrics: result.metrics,
    avgTurnaround: result.avgTurnaround,
    avgWeighted: result.avgWeighted,
  };
}

/** 解析“标识 + 到达 + 运行”三列表格；无标识前缀时按行取前两个数字并命名 P1…Pn。 */
export function parseProcessTable(text: string): CpuProcess[] {
  const source = text ?? '';
  const rows: CpuProcess[] = [];
  for (const match of source.matchAll(/([A-Za-z][\w-]*)\s*[^A-Za-z0-9-]*\s*(\d+)\s*[^0-9]+\s*(\d+)/g)) {
    rows.push({ id: match[1]!, arrival: Number(match[2]), burst: Number(match[3]) });
  }
  if (rows.length) return rows;
  source
    .split(/[\n;；]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const numbers = (line.match(/\d+/g) ?? []).map(Number);
      if (numbers.length >= 2) rows.push({ id: `P${index + 1}`, arrival: numbers[0]!, burst: numbers[1]! });
    });
  return rows;
}

export interface BankerFrame {
  work: number[];
  finish: boolean[];
  sequence: number[];
  trial: number | null;
  safe: boolean;
  note: string;
}

export function bankerFrames(
  available: readonly number[],
  allocation: readonly (readonly number[])[],
  need: readonly (readonly number[])[],
): FramePlayer<BankerFrame> {
  const count = Math.min(allocation.length, need.length);
  const work = [...available];
  const finish: boolean[] = Array.from({ length: count }, () => false);
  const sequence: number[] = [];
  const frames: BankerFrame[] = [{
    work: [...work],
    finish: [...finish],
    sequence: [...sequence],
    trial: null,
    safe: false,
    note: '初始可用资源',
  }];

  while (count > 0 && !finish.every(Boolean)) {
    let picked = -1;
    for (let index = 0; index < count; index += 1) {
      const demand = need[index]!;
      if (finish[index] || !demand.every((value, dimension) => value <= work[dimension]!)) continue;
      picked = index;
      break;
    }
    if (picked < 0) {
      frames.push({
        work: [...work],
        finish: [...finish],
        sequence: [...sequence],
        trial: null,
        safe: false,
        note: '无可安全推进的进程，系统处于不安全状态',
      });
      break;
    }
    const granted = allocation[picked]!;
    granted.forEach((value, dimension) => {
      work[dimension] = work[dimension]! + value;
    });
    finish[picked] = true;
    sequence.push(picked);
    frames.push({
      work: [...work],
      finish: [...finish],
      sequence: [...sequence],
      trial: picked,
      safe: finish.every(Boolean),
      note: `P${picked} 需求可满足，回收资源后继续`,
    });
  }

  const safe = frames[frames.length - 1]!.safe;
  return {
    frames,
    summary: count === 0
      ? '无进程，无需安全性检查'
      : safe
        ? `系统安全：存在安全序列 ${sequence.map(index => `P${index}`).join(' → ')}`
        : '系统不安全：找不到完整安全序列',
  };
}

/** 解析 available 行 + 每行「分配 | 需求」或「标识 + 3 分配 + 3 需求」的银行家表格。 */
export function parseBankerText(text: string): { available: number[]; allocation: number[][]; need: number[][] } {
  const available: number[] = [];
  const allocation: number[][] = [];
  const need: number[][] = [];
  const lines = (text ?? '')
    .split(/[\n;；]+/)
    .map(line => line.trim())
    .filter(Boolean);
  let section: 'alloc' | 'need' | null = null;
  for (const line of lines) {
    // 先剥掉行首的进程标识（P0 / 进程A 等），否则标识里的数字会被当成第一维资源
    const stripped = line.replace(/^\s*[A-Za-z\u4e00-\u9fa5]+\d*\s*/, '');
    const values = (stripped.match(/\d+/g) ?? []).map(Number);
    if (/avail|可用/i.test(line)) {
      available.push(...values);
      continue;
    }
    if (/^(allocation|分配)/i.test(line)) { section = 'alloc'; continue; }
    if (/^(need|需求)/i.test(line)) { section = 'need'; continue; }
    if (!values.length) continue;
    const sides = stripped.split(/[|｜]/);
    if (sides.length >= 2) {
      allocation.push((sides[0]!.match(/\d+/g) ?? []).map(Number));
      need.push((sides[1]!.match(/\d+/g) ?? []).map(Number));
      continue;
    }
    if (values.length >= 6) {
      allocation.push(values.slice(0, 3));
      need.push(values.slice(3, 6));
    } else if (values.length >= 3) {
      if (section === 'need') need.push(values.slice(0, 3));
      else allocation.push(values.slice(0, 3));
    }
  }
  return { available, allocation, need };
}

export interface SubnetBits {
  prefix: number;
  index: number;
  count: number;
  maskInt: number;
  maskBinary: string;
  networkBinary: string;
  broadcastBinary: string;
  shareStart: number;
  shareEnd: number;
  share: number;
  info: SubnetResult;
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | (Number(part) & 0xff)) >>> 0, 0);
}

function bits32(value: number): string {
  return (value >>> 0).toString(2).padStart(32, '0');
}

export function subnetBits(prefix: number, index: number): SubnetBits {
  const info = subnetInfo(prefix, index);
  const p = info.prefix;
  const block = 2 ** (32 - p);
  const maskInt = p === 32 ? 0xffffffff : (0xffffffff << (32 - p)) >>> 0;
  const shareStart = info.index * block;
  const shareEnd = shareStart + block - 1;
  return {
    prefix: p,
    index: info.index,
    count: info.count,
    maskInt,
    maskBinary: bits32(maskInt),
    networkBinary: bits32(ipToInt(info.network)),
    broadcastBinary: bits32(ipToInt(info.broadcast)),
    shareStart,
    shareEnd,
    share: block / 256,
    info,
  };
}

export type TcpState = 'slow_start' | 'congestion_avoidance' | 'fast_recovery';

export interface TcpFrame {
  rtt: number;
  cwnd: number;
  ssthresh: number;
  state: TcpState;
  event: string;
}

function normalizeTcpEvent(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (/超时|timeout|rto/.test(token)) return 'timeout';
  const duplicated = token.match(/(\d+)\s*(?:ack|a)/);
  if (/重复|快重传|dupack|fast/.test(token)) return '3ack';
  if (duplicated && Number(duplicated[1]) >= 3) return '3ack';
  if (/ack|确认/.test(token)) return 'ack';
  return token;
}

export function parseTcpEvents(text: string): string[] {
  const events: string[] = [];
  for (const raw of (text ?? '').replace(/(\d+)\s*ack/gi, '$1ack').split(/[\s,，、;；/]+/)) {
    if (!raw) continue;
    const event = normalizeTcpEvent(raw);
    if (event === 'ack' || event === '3ack' || event === 'timeout') events.push(event);
  }
  return events;
}

export function tcpCongestionFrames(initSsthresh: number, events: readonly string[]): FramePlayer<TcpFrame> {
  let ssthresh = Math.max(2, Math.round(initSsthresh));
  let cwnd = 1;
  let state: TcpState = 'slow_start';
  const frames: TcpFrame[] = [{ rtt: 0, cwnd, ssthresh, state, event: 'start' }];

  for (const raw of events) {
    const event = normalizeTcpEvent(raw);
    if (event === '3ack') {
      ssthresh = Math.max(Math.floor(cwnd / 2), 2);
      cwnd = ssthresh;
      state = 'fast_recovery';
    } else if (event === 'timeout') {
      ssthresh = Math.max(Math.floor(cwnd / 2), 2);
      cwnd = 1;
      state = 'slow_start';
    } else if (state === 'slow_start') {
      cwnd *= 2;
      if (cwnd >= ssthresh) state = 'congestion_avoidance';
    } else {
      cwnd += 1;
      if (state === 'fast_recovery') state = 'congestion_avoidance';
    }
    frames.push({ rtt: frames.length, cwnd, ssthresh, state, event });
  }

  const last = frames[frames.length - 1]!;
  return {
    frames,
    summary: `TCP 拥塞窗口：第 ${last.rtt} 个 RTT 后 cwnd=${last.cwnd}、ssthresh=${last.ssthresh}（${last.state}）`,
  };
}

export type WindowMode = 'GBN' | 'SR';

export interface WindowFrame {
  tick: number;
  sendWindow: number[];
  recvWindow: number[];
  inFlight: number[];
  acked: number[];
  event: 'send' | 'ack' | 'timeout' | 'drop';
}

export function slidingWindowFrames(
  winSize: number,
  mode: WindowMode,
  droppedSeqs: readonly number[],
): FramePlayer<WindowFrame> {
  const size = Math.max(1, Math.round(winSize));
  const drops = new Set(droppedSeqs.filter(seq => Number.isInteger(seq) && seq >= 0));
  const frames: WindowFrame[] = [];
  const acked: number[] = [];
  const resent = new Set<number>();
  let base = 0;
  let tick = 0;

  const sendWindow = () => Array.from({ length: size }, (_, offset) => base + offset);
  const recvWindow = () => (mode === 'GBN' ? [base] : sendWindow());
  const push = (event: WindowFrame['event'], inFlight: number[]) => {
    frames.push({
      tick: tick++,
      sendWindow: sendWindow(),
      recvWindow: recvWindow(),
      inFlight: [...inFlight],
      acked: [...acked],
      event,
    });
  };

  push('send', sendWindow());
  const limit = size * 2 + drops.size;
  while (base < limit) {
    if (drops.has(base) && !resent.has(base)) {
      resent.add(base);
      push('timeout', mode === 'GBN' ? sendWindow() : [base]);
      continue;
    }
    acked.push(base);
    base += 1;
    push('ack', sendWindow());
  }

  return {
    frames,
    summary: `${mode} 窗口 ${size}：丢帧 ${drops.size ? [...drops].join('、') : '无'}，共 ${frames.length} 个事件`,
  };
}

export function parseSeqList(text: string): number[] {
  return (text ?? '')
    .split(/[\s,，、;；]+/)
    .map(item => Number.parseInt(item, 10))
    .filter(value => Number.isInteger(value) && value >= 0);
}
