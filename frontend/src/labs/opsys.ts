import type { LabCheck, LabModel, LabResultBase, LabResultFrame, LabResultMetric } from './types.ts';
import { readNumber, readString } from './types.ts';

export type OsKind = 'cpu_schedule' | 'page_replace' | 'disk_schedule' | 'banker';

export interface OsFrame extends LabResultFrame {
  action: string;
  pseudocodeLine: number;
}

export interface OsProcess { id: string; arrival: number; burst: number; priority: number | null }
export interface OsGanttSegment { id: string | null; start: number; end: number }
export interface OsProcessRow {
  id: string; arrival: number; burst: number; priority: number | null;
  finish: number; turnaround: number; waiting: number; response: number; weighted: number;
}
export interface OsSchedStats {
  processes: OsProcessRow[]; avg_waiting: number; avg_turnaround: number; avg_weighted: number;
  makespan: number; switches: number; gantt: OsGanttSegment[]; compare: Record<string, number>; quantum: number;
}
export interface OsPageStats {
  faults: number; hits: number; total: number; rate: number; frames_count: number;
  compare: Record<string, number>; series: { frames: number; faults: number }[];
}
export interface OsDiskStats {
  total: number; average: number; served: number[]; path: number[]; compare: Record<string, number>;
  max_track: number; head: number; requests: number[];
}
export interface OsBankerStats {
  safe: boolean; sequence: string[] | null; granted: boolean | null; names: string[];
  state: { available: number[]; allocation: number[][]; need: number[][] };
}

interface OsResultBase extends LabResultBase {
  subject: 'operating_system';
  engine: 'os_sched_v1' | 'os_page_v1' | 'os_disk_v1' | 'os_banker_v1';
  osKind: OsKind;
  status: 'ok' | 'blocked';
  reason?: string;
  algorithm: string;
  answer: string;
  answerValue: number | null;
  answerOrder: string[] | null;
  stopReason: string | null;
  pseudocode: string[];
  frames: OsFrame[];
  trace: OsFrame[];
}
export interface OsSchedResult extends OsResultBase { osKind: 'cpu_schedule'; stats: OsSchedStats }
export interface OsPageResult extends OsResultBase { osKind: 'page_replace'; stats: OsPageStats }
export interface OsDiskResult extends OsResultBase { osKind: 'disk_schedule'; stats: OsDiskStats }
export interface OsBankerResult extends OsResultBase { osKind: 'banker'; stats: OsBankerStats }
export type OsResult = OsSchedResult | OsPageResult | OsDiskResult | OsBankerResult;

const EPS = 1e-9;
const MAX_PROCESSES = 12;
const MAX_REFERENCE = 60;
const MAX_FRAMES = 10;
const MAX_REQUESTS = 40;
const MAX_BANKER_N = 8;
const MAX_BANKER_M = 6;

export const SCHED_LABELS: Record<string, string> = {
  fcfs: '先来先服务 FCFS',
  sjf: '短作业优先 SJF（非抢占）',
  srtf: '最短剩余时间优先 SRTF（抢占）',
  rr: '时间片轮转 RR',
  priority: '优先级调度（非抢占，数小优先）',
};
export const PAGE_LABELS: Record<string, string> = {
  fifo: '先进先出 FIFO', lru: '最近最久未使用 LRU', opt: '最佳置换 OPT',
};
export const DISK_LABELS: Record<string, string> = {
  fcfs: '先来先服务 FCFS', sstf: '最短寻道时间优先 SSTF', scan: 'SCAN（电梯）',
  cscan: 'C-SCAN（循环扫描）', look: 'LOOK', clook: 'C-LOOK',
};

export const OS_PSEUDOCODE: Record<OsKind, string[]> = {
  cpu_schedule: [
    '按到达时间把进程放入就绪队列',
    '按调度规则从就绪队列选出一个进程',
    '运行到完成、被抢占或时间片用完',
    '记录完成时刻并更新就绪队列',
    '周转 = 完成 − 到达；等待 = 周转 − 服务',
  ],
  page_replace: [
    '取下一个页面访问',
    '页面已在物理块中 → 命中，更新记录',
    '否则缺页：有空闲块就直接装入',
    '没有空闲块：按算法选出被置换页面',
    '统计缺页次数与缺页率',
  ],
  disk_schedule: [
    '从当前磁头位置出发',
    '按算法选出下一个服务的磁道（或端点）',
    '移动磁头并累加移动距离',
    '必要时到达末端后换向或回扫',
    '全部请求服务完毕，统计总移动距离',
  ],
  banker: [
    'Need = Max − Allocation，Work = Available',
    '找一个未完成且 Need ≤ Work 的进程',
    '假定它运行完毕：Work = Work + Allocation',
    '重复直到全部完成（安全）或再无可选进程（不安全）',
    '安全序列即各轮选出进程的顺序',
  ],
};

function fmt(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(digits)));
}

function clean(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

type Key = number[];

function compareKey(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function pickMin<T>(items: T[], key: (item: T) => Key): T {
  let best: T = items[0] as T;
  for (const item of items.slice(1)) if (compareKey(key(item), key(best)) < 0) best = item;
  return best;
}

function sortedBy<T>(items: T[], key: (item: T) => Key): T[] {
  return [...items].sort((a, b) => compareKey(key(a), key(b)));
}

function pushFrame(
  store: OsFrame[], action: string, label: string, detail: string, line: number, values: Record<string, unknown>,
): void {
  store.push({ index: store.length, action, label, detail, values, pseudocodeLine: line });
}

function blocked(model: LabModel, reason: string): OsResult {
  const kind = (model.os_kind ?? 'cpu_schedule') as OsKind;
  const engine = ({ cpu_schedule: 'os_sched_v1', page_replace: 'os_page_v1', disk_schedule: 'os_disk_v1',
    banker: 'os_banker_v1' } as const)[kind];
  return {
    subject: 'operating_system', engine, osKind: kind, status: 'blocked', reason, headline: reason,
    algorithm: '', answer: '', answerValue: null, answerOrder: null, stopReason: null, pseudocode: [],
    metrics: [], checks: [], notes: [], frames: [], trace: [], stats: {} as never,
  } as OsResult;
}

function isMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0
    && value.every((row) => Array.isArray(row) && row.length > 0
      && row.every((item) => typeof item === 'number' && Number.isFinite(item)))
    && value.every((row) => row.length === (value[0] as number[]).length);
}

function numberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? (value as number[]) : null;
}

/* ------------------------------------------------------------------ */
/* CPU 调度                                                             */
/* ------------------------------------------------------------------ */

interface Segment { index: number; start: number; end: number; reason: string; ready: number[]; remaining: number[] }

interface SchedSim {
  segments: Segment[]; rows: OsProcessRow[]; first: (number | null)[]; finish: (number | null)[];
  avgWaiting: number; avgTurnaround: number; avgWeighted: number; start: number; makespan: number; switches: number;
}

function simulateSchedule(processes: OsProcess[], algorithm: string, quantum: number): SchedSim {
  const n = processes.length;
  const arrival = processes.map((p) => p.arrival);
  const burst = processes.map((p) => p.burst);
  const priority = processes.map((p) => p.priority);
  const remaining = [...burst];
  const first: (number | null)[] = new Array<number | null>(n).fill(null);
  const finish: (number | null)[] = new Array<number | null>(n).fill(null);
  const segments: Segment[] = [];
  let time = Math.min(...arrival);
  let done = 0;
  const indexes = Array.from({ length: n }, (_, i) => i);

  const add = (index: number, start: number, end: number, reason: string, ready: number[]): void => {
    if (index >= 0 && first[index] === null) first[index] = start;
    const snapshot = remaining.map(clean);
    const last = segments[segments.length - 1];
    if (last && last.index === index && Math.abs(last.end - start) < EPS) {
      last.end = clean(end);
      last.remaining = snapshot;
      return;
    }
    segments.push({ index, start: clean(start), end: clean(end), reason, ready: [...ready], remaining: snapshot });
  };
  const idle = (): number => {
    const next = Math.min(...indexes.filter((i) => finish[i] === null && arrival[i]! > time + EPS).map((i) => arrival[i]!));
    add(-1, time, next, '没有已到达的进程，CPU 空闲', []);
    return clean(next);
  };

  if (algorithm === 'fcfs' || algorithm === 'sjf' || algorithm === 'priority') {
    const key = (i: number): Key => {
      if (algorithm === 'fcfs') return [arrival[i]!, i];
      if (algorithm === 'sjf') return [burst[i]!, arrival[i]!, i];
      return [priority[i] ?? Infinity, arrival[i]!, i];
    };
    while (done < n) {
      const available = indexes.filter((i) => finish[i] === null && arrival[i]! <= time + EPS);
      if (!available.length) { time = idle(); continue; }
      const pick = pickMin(available, key);
      const ready = sortedBy(available.filter((i) => i !== pick), key);
      const reason = algorithm === 'fcfs' ? '就绪进程中最先到达'
        : algorithm === 'sjf' ? `就绪进程中服务时间最短（${fmt(burst[pick])}）`
          : `就绪进程中优先级数最小（${fmt(priority[pick])}）`;
      const start = time;
      time = clean(time + remaining[pick]!);
      remaining[pick] = 0;
      finish[pick] = time;
      done += 1;
      add(pick, start, time, `${reason}，非抢占，运行到完成`, ready);
    }
  } else if (algorithm === 'srtf') {
    let current = -1;
    while (done < n) {
      const available = indexes.filter((i) => finish[i] === null && arrival[i]! <= time + EPS);
      if (!available.length) { time = idle(); current = -1; continue; }
      const key = (i: number): Key => [remaining[i]!, i === current ? 0 : 1, arrival[i]!, i];
      const pick = pickMin(available, key);
      const ready = sortedBy(available.filter((i) => i !== pick), key);
      const future = indexes.filter((i) => finish[i] === null && arrival[i]! > time + EPS).map((i) => arrival[i]!);
      const horizon = future.length ? Math.min(...future) : Infinity;
      const run = Math.min(remaining[pick]!, horizon - time);
      const reason = `剩余时间最短（${fmt(remaining[pick])}），遇到新到达的进程会重新比较`;
      const start = time;
      time = clean(time + run);
      remaining[pick] = clean(remaining[pick]! - run);
      if (remaining[pick]! <= EPS) { remaining[pick] = 0; finish[pick] = time; done += 1; }
      add(pick, start, time, reason, ready);
      current = pick;
    }
  } else {
    const queue: number[] = [];
    const queued = new Set<number>();
    const admit = (upto: number): void => {
      const fresh = sortedBy(indexes.filter((i) => !queued.has(i) && arrival[i]! <= upto + EPS), (i) => [arrival[i]!, i]);
      for (const i of fresh) { queue.push(i); queued.add(i); }
    };
    admit(time);
    while (done < n) {
      if (!queue.length) {
        const next = Math.min(...indexes.filter((i) => !queued.has(i)).map((i) => arrival[i]!));
        add(-1, time, next, '没有已到达的进程，CPU 空闲', []);
        time = clean(next);
        admit(time);
        continue;
      }
      const pick = queue.shift()!;
      const ready = [...queue];
      const run = Math.min(quantum, remaining[pick]!);
      const start = time;
      time = clean(time + run);
      remaining[pick] = clean(remaining[pick]! - run);
      admit(time);
      const finished = remaining[pick]! <= EPS;
      if (finished) { remaining[pick] = 0; finish[pick] = time; done += 1; } else queue.push(pick);
      add(pick, start, time, `队首进程，时间片 q=${fmt(quantum)}，${finished ? '运行完毕' : '时间片用完，排到队尾'}`, ready);
    }
  }

  const rows: OsProcessRow[] = indexes.map((i) => {
    const turnaround = clean(finish[i]! - arrival[i]!);
    return {
      id: processes[i]!.id, arrival: arrival[i]!, burst: burst[i]!, priority: priority[i] ?? null,
      finish: finish[i]!, turnaround, waiting: clean(turnaround - burst[i]!),
      response: clean(first[i]! - arrival[i]!), weighted: clean(turnaround / burst[i]!),
    };
  });
  let switches = 0;
  for (let i = 1; i < segments.length; i += 1) {
    const a = segments[i - 1]!; const b = segments[i]!;
    if (a.index >= 0 && b.index >= 0 && a.index !== b.index) switches += 1;
  }
  const mean = (pick: (row: OsProcessRow) => number): number => clean(rows.reduce((sum, row) => sum + pick(row), 0) / n);
  return {
    segments, rows, first, finish,
    avgWaiting: mean((r) => r.waiting), avgTurnaround: mean((r) => r.turnaround), avgWeighted: mean((r) => r.weighted),
    start: clean(Math.min(...arrival)), makespan: clean(Math.max(...(finish as number[]))), switches,
  };
}

function evalSchedule(model: LabModel, params: Record<string, unknown>): OsResult {
  const processes = (model.processes ?? []).map((p) => ({
    id: String(p.id), arrival: Number(p.arrival), burst: Number(p.burst),
    priority: p.priority === null || p.priority === undefined ? null : Number(p.priority),
  }));
  const algorithm = readString(params.algorithm ?? model.defaults.algorithm, 'fcfs') || 'fcfs';
  const quantum = readNumber(params.quantum ?? model.defaults.quantum, 2);
  const hasPriority = !!model.has_priority;
  if (!processes.length) return blocked(model, '没有可调度的进程，请先补全进程表。');
  if (processes.length > MAX_PROCESSES) return blocked(model, `首版仅支持 ${MAX_PROCESSES} 个以内的进程。`);
  if (new Set(processes.map((p) => p.id)).size !== processes.length) return blocked(model, '进程名称有重复，请先核对进程表。');
  if (processes.some((p) => p.burst <= 0 || p.arrival < 0)) return blocked(model, '到达时间不能为负，服务时间必须大于 0。');
  if (!(algorithm in SCHED_LABELS)) return blocked(model, '未知的调度算法。');
  if (algorithm === 'priority' && !hasPriority) return blocked(model, '优先级调度需要每个进程都有优先级，请在进程表中补充第 4 列。');
  if (quantum <= 0) return blocked(model, '时间片必须大于 0。');

  const sim = simulateSchedule(processes, algorithm, quantum);
  const names = processes.map((p) => p.id);
  const n = processes.length;
  const frames: OsFrame[] = [];

  const table = (time: number, running: number | null, segmentRemaining: number[]): Record<string, unknown>[] =>
    processes.map((p, i) => {
      const finished = sim.finish[i] !== null && sim.finish[i]! <= time + EPS && segmentRemaining[i]! <= EPS;
      const state = finished ? 'done' : p.arrival > time + EPS ? 'pending' : running === i ? 'running' : 'ready';
      return {
        id: names[i], arrival: p.arrival, burst: p.burst, priority: p.priority, remaining: segmentRemaining[i], state,
        finish: finished ? sim.finish[i] : null,
        turnaround: finished ? sim.rows[i]!.turnaround : null,
        waiting: finished ? sim.rows[i]!.waiting : null,
      };
    });
  const gantt = (upto: number): OsGanttSegment[] => sim.segments.slice(0, upto).map((s) => (
    { id: s.index >= 0 ? names[s.index]! : null, start: s.start, end: s.end }));

  pushFrame(frames, 'initial', `写出进程表（${SCHED_LABELS[algorithm]}）`,
    `从最早到达的时刻 t=${fmt(sim.start)} 开始；每一段甘特图都记录选择的理由。`, 1, {
      time: sim.start, gantt: [], running: null, finished: [], algorithm,
      ready: names.filter((_, i) => processes[i]!.arrival <= sim.start + EPS),
      rows: table(sim.start, null, processes.map((p) => p.burst)),
    });
  sim.segments.forEach((seg, offset) => {
    const number = offset + 1;
    const doneNow = names.filter((_, i) => sim.finish[i] !== null && sim.finish[i]! <= seg.end + EPS && seg.remaining[i]! <= EPS);
    let label: string; let detail: string; let running: number | null = null;
    if (seg.index < 0) {
      label = `t=${fmt(seg.start)}–${fmt(seg.end)} · CPU 空闲`;
      detail = `${seg.reason}。`;
    } else {
      const name = names[seg.index]!;
      label = `t=${fmt(seg.start)}–${fmt(seg.end)} · ${name} 运行 ${fmt(seg.end - seg.start)}`;
      detail = `${name}：${seg.reason}。`;
      running = seg.index;
      if (seg.remaining[seg.index]! <= EPS) {
        const row = sim.rows[seg.index]!;
        detail += `${name} 在 t=${fmt(row.finish)} 完成，周转 ${fmt(row.turnaround)}，等待 ${fmt(row.waiting)}。`;
      } else detail += `${name} 还剩 ${fmt(seg.remaining[seg.index])}。`;
    }
    pushFrame(frames, seg.index < 0 ? 'idle' : 'run', label, detail, seg.index >= 0 ? 3 : 2, {
      time: seg.end, gantt: gantt(number), ready: seg.ready.map((i) => names[i]!),
      running: running !== null ? names[running]! : null,
      rows: table(seg.end, running, seg.remaining), finished: doneNow, algorithm, segment: number - 1,
    });
  });
  const answer = `平均等待时间 = ${fmt(sim.avgWaiting)}，平均周转时间 = ${fmt(sim.avgTurnaround)}，平均带权周转时间 = ${fmt(sim.avgWeighted)}`;
  pushFrame(frames, 'result', '结果', answer, 5, {
    time: sim.makespan, gantt: gantt(sim.segments.length), ready: [], running: null,
    rows: table(sim.makespan, null, new Array<number>(n).fill(0)), finished: [...names], algorithm,
  });

  const compare: Record<string, number> = {};
  for (const other of Object.keys(SCHED_LABELS)) {
    if (other === 'priority' && !hasPriority) continue;
    compare[other] = simulateSchedule(processes, other, quantum).avgWaiting;
  }
  const busy = sim.segments.filter((s) => s.index >= 0).reduce((sum, s) => sum + s.end - s.start, 0);
  const totalBurst = processes.reduce((sum, p) => sum + p.burst, 0);
  const checks: LabCheck[] = [
    { id: 'conservation', label: 'CPU 服务时间守恒', status: Math.abs(busy - totalBurst) < 1e-6 ? 'pass' : 'fail',
      detail: `甘特图中运行总时长 ${fmt(busy)} 应等于各进程服务时间之和 ${fmt(totalBurst)}。` },
    { id: 'nonneg', label: '等待时间非负', status: sim.rows.every((r) => r.waiting >= -EPS) ? 'pass' : 'fail',
      detail: '等待时间 = 周转 − 服务，任何进程都不可能为负。' },
  ];
  const metrics: LabResultMetric[] = [
    { id: 'algorithm', label: '算法', value: SCHED_LABELS[algorithm]! },
    { id: 'avg_waiting', label: '平均等待', value: fmt(sim.avgWaiting) },
    { id: 'avg_turnaround', label: '平均周转', value: fmt(sim.avgTurnaround) },
    { id: 'avg_weighted', label: '平均带权周转', value: fmt(sim.avgWeighted) },
    { id: 'makespan', label: '完成时刻', value: fmt(sim.makespan) },
  ];
  return {
    subject: 'operating_system', engine: 'os_sched_v1', osKind: 'cpu_schedule', status: 'ok', algorithm,
    frames, trace: frames, pseudocode: OS_PSEUDOCODE.cpu_schedule, answer, answerValue: sim.avgWaiting, answerOrder: null,
    headline: `${SCHED_LABELS[algorithm]}：平均等待 ${fmt(sim.avgWaiting)}，平均周转 ${fmt(sim.avgTurnaround)}`,
    metrics, checks, stopReason: 'done',
    stats: {
      processes: sim.rows, avg_waiting: sim.avgWaiting, avg_turnaround: sim.avgTurnaround, avg_weighted: sim.avgWeighted,
      makespan: sim.makespan, switches: sim.switches, gantt: gantt(sim.segments.length), compare, quantum,
    },
    notes: ['同一时刻到达的进程按输入顺序入队；RR 中新到达的进程排在被抢占进程之前。',
      '相同条件下优先比较：SJF 看服务时间，SRTF 看剩余时间（并列时不抢占），再依次看到达时间与输入顺序。',
      '切换上方“调度算法”可用同一组进程对照各算法。'],
  };
}

/* ------------------------------------------------------------------ */
/* 页面置换                                                             */
/* ------------------------------------------------------------------ */

interface PageStep {
  index: number; page: string; hit: boolean; frames: (string | null)[]; slot: number; evicted: string | null;
  faults: number; aux_title: string; aux: string[];
}

function simulatePages(reference: string[], framesCount: number, algorithm: string): PageStep[] {
  const slots: (string | null)[] = new Array<string | null>(framesCount).fill(null);
  const loaded = new Array<number>(framesCount).fill(-1);
  const used = new Array<number>(framesCount).fill(-1);
  const steps: PageStep[] = [];
  let faults = 0;
  const slotIds = Array.from({ length: framesCount }, (_, s) => s);
  reference.forEach((page, index) => {
    let evicted: string | null = null;
    let slot: number;
    let hit: boolean;
    if (slots.includes(page)) {
      slot = slots.indexOf(page);
      used[slot] = index;
      hit = true;
    } else {
      hit = false;
      faults += 1;
      if (slots.includes(null)) slot = slots.indexOf(null);
      else {
        if (algorithm === 'fifo') slot = pickMin(slotIds, (s) => [loaded[s]!]);
        else if (algorithm === 'lru') slot = pickMin(slotIds, (s) => [used[s]!]);
        else {
          const nextUse = (s: number): number => {
            for (let later = index + 1; later < reference.length; later += 1) if (reference[later] === slots[s]) return later;
            return Infinity;
          };
          slot = pickMin(slotIds, (s) => [-nextUse(s), loaded[s]!]);
        }
        evicted = slots[slot]!;
      }
      slots[slot] = page;
      loaded[slot] = index;
      used[slot] = index;
    }
    const resident = slotIds.filter((s) => slots[s] !== null);
    let auxTitle: string; let aux: string[];
    if (algorithm === 'fifo') {
      auxTitle = 'FIFO 队列（队首最早装入）';
      aux = sortedBy(resident, (s) => [loaded[s]!]).map((s) => slots[s]!);
    } else if (algorithm === 'lru') {
      auxTitle = 'LRU 栈（左为最近使用）';
      aux = sortedBy(resident, (s) => [-used[s]!]).map((s) => slots[s]!);
    } else {
      auxTitle = '下次访问位置（∞ 表示不再访问）';
      aux = resident.map((s) => {
        let later = -1;
        for (let k = index + 1; k < reference.length; k += 1) if (reference[k] === slots[s]) { later = k; break; }
        return `${slots[s]}:${later >= 0 ? later + 1 : '∞'}`;
      });
    }
    steps.push({ index, page, hit, frames: [...slots], slot, evicted, faults, aux_title: auxTitle, aux });
  });
  return steps;
}

function lastFaults(reference: string[], framesCount: number, algorithm: string): number {
  const steps = simulatePages(reference, framesCount, algorithm);
  return steps[steps.length - 1]!.faults;
}

function evalPage(model: LabModel, params: Record<string, unknown>): OsResult {
  const reference = (model.reference ?? []).map(String);
  const algorithm = readString(params.algorithm ?? model.defaults.algorithm, 'fifo') || 'fifo';
  const framesCount = Math.trunc(readNumber(params.frames ?? model.defaults.frames, 3));
  if (!reference.length) return blocked(model, '没有页面访问序列，请先补全题目数据。');
  if (reference.length > MAX_REFERENCE) return blocked(model, `访问序列超过 ${MAX_REFERENCE} 次；首版逐步演示只支持较短的序列。`);
  if (framesCount < 1 || framesCount > MAX_FRAMES) return blocked(model, `物理块数需在 1–${MAX_FRAMES} 之间。`);
  if (!(algorithm in PAGE_LABELS)) return blocked(model, '未知的置换算法。');

  const steps = simulatePages(reference, framesCount, algorithm);
  const total = reference.length;
  const faults = steps[steps.length - 1]!.faults;
  const frames: OsFrame[] = [];
  pushFrame(frames, 'initial', `${PAGE_LABELS[algorithm]}：${framesCount} 个物理块，初始全空`,
    '每次访问先查物理块；不在其中就产生一次缺页。', 1, {
      reference: [...reference], cursor: -1, frames: new Array<string | null>(framesCount).fill(null),
      hit: null, slot: null, evicted: null, faults: 0, hits: 0, aux_title: '', aux: [], algorithm,
    });
  const reasons: Record<string, string> = {
    fifo: '最早装入的页面', lru: '最近最久没有被使用的页面', opt: '未来最晚才会再次访问（或不再访问）的页面',
  };
  for (const step of steps) {
    const hits = step.index + 1 - step.faults;
    let label: string; let detail: string; let action: string; let line: number;
    if (step.hit) {
      label = `访问 ${step.page}：命中`;
      detail = `页面 ${step.page} 已在物理块中，不产生缺页。`;
      action = 'hit'; line = 2;
    } else if (step.evicted === null) {
      label = `访问 ${step.page}：缺页，装入空闲块`;
      detail = `页面 ${step.page} 不在内存，仍有空闲物理块，直接装入块 ${step.slot + 1}。`;
      action = 'fault'; line = 3;
    } else {
      label = `访问 ${step.page}：缺页，置换 ${step.evicted}`;
      detail = `物理块已满，按 ${algorithm.toUpperCase()} 选择${reasons[algorithm]} ${step.evicted} 换出，页面 ${step.page} 装入块 ${step.slot + 1}。`;
      action = 'replace'; line = 4;
    }
    pushFrame(frames, action, label, detail, line, {
      reference: [...reference], cursor: step.index, frames: step.frames, hit: step.hit, slot: step.slot,
      evicted: step.evicted, faults: step.faults, hits, aux_title: step.aux_title, aux: step.aux, algorithm,
    });
  }
  const rate = faults / total;
  const answer = `缺页 ${faults} 次，命中 ${total - faults} 次，缺页率 ${(rate * 100).toFixed(1)}%`;
  pushFrame(frames, 'result', '结果', answer, 5, {
    reference: [...reference], cursor: total - 1, frames: steps[steps.length - 1]!.frames, hit: null, slot: null,
    evicted: null, faults, hits: total - faults, aux_title: '', aux: [], algorithm,
  });

  const compare: Record<string, number> = {};
  for (const name of Object.keys(PAGE_LABELS)) compare[name] = lastFaults(reference, framesCount, name);
  const series = Array.from({ length: MAX_FRAMES }, (_, k) => (
    { frames: k + 1, faults: lastFaults(reference, k + 1, algorithm) }));
  const checks: LabCheck[] = [{ id: 'accounting', label: '命中 + 缺页 = 访问次数', status: 'pass',
    detail: `${total - faults} + ${faults} = ${total}。` }];
  checks.push(compare.opt! <= Math.min(compare.fifo!, compare.lru!)
    ? { id: 'opt_bound', label: 'OPT 为缺页下界', status: 'pass',
      detail: `OPT ${compare.opt} 次不超过 FIFO ${compare.fifo} 次与 LRU ${compare.lru} 次。` }
    : { id: 'opt_bound', label: 'OPT 为缺页下界', status: 'fail', detail: 'OPT 的缺页次数不应高于其他算法，请核对序列。' });
  if (algorithm === 'fifo') {
    const bigger = series.find((item) => item.frames === framesCount + 1);
    checks.push(bigger && bigger.faults > faults
      ? { id: 'belady', label: 'Belady 异常', status: 'warn',
        detail: `物理块从 ${framesCount} 增加到 ${framesCount + 1}，FIFO 缺页反而从 ${faults} 增加到 ${bigger.faults} 次。` }
      : { id: 'belady', label: 'Belady 异常', status: 'pass',
        detail: '增加一个物理块后缺页次数没有增加；FIFO 不是栈式算法，仍可能在其他序列上出现异常。' });
  } else {
    checks.push({ id: 'belady', label: 'Belady 异常', status: 'pass', detail: 'LRU 与 OPT 是栈式算法，增加物理块不会让缺页变多。' });
  }
  const metrics: LabResultMetric[] = [
    { id: 'algorithm', label: '算法', value: PAGE_LABELS[algorithm]! },
    { id: 'faults', label: '缺页次数', value: String(faults) },
    { id: 'hits', label: '命中次数', value: String(total - faults) },
    { id: 'rate', label: '缺页率', value: `${(rate * 100).toFixed(1)}%` },
  ];
  return {
    subject: 'operating_system', engine: 'os_page_v1', osKind: 'page_replace', status: 'ok', algorithm,
    frames, trace: frames, pseudocode: OS_PSEUDOCODE.page_replace, answer, answerValue: faults, answerOrder: null,
    headline: `${PAGE_LABELS[algorithm]}（${framesCount} 块）：缺页 ${faults} 次 / 访问 ${total} 次`,
    metrics, checks, stopReason: 'done',
    stats: { faults, hits: total - faults, total, rate, frames_count: framesCount, compare, series },
    notes: ['物理块按固定位置显示：被置换页面所在的块直接装入新页面。',
      'OPT 并列时（多个页面都不再访问）置换最早装入的页面；LRU 命中会刷新最近使用时间，FIFO 命中不改变队列。'],
  };
}

/* ------------------------------------------------------------------ */
/* 磁盘调度                                                             */
/* ------------------------------------------------------------------ */

interface Leg { kind: 'request' | 'edge' | 'jump'; pos: number; serve: boolean }

function scanLegs(requests: number[], head: number, maxTrack: number, algorithm: string): Leg[] {
  const upper = requests.filter((r) => r >= head).sort((a, b) => a - b);
  const lower = requests.filter((r) => r < head).sort((a, b) => a - b);
  const legs: Leg[] = upper.map((pos) => ({ kind: 'request', pos, serve: true }));
  const position = upper.length ? upper[upper.length - 1]! : head;
  const reversed = [...lower].reverse();
  if (algorithm === 'scan') {
    if (position < maxTrack) legs.push({ kind: 'edge', pos: maxTrack, serve: false });
    legs.push(...reversed.map((pos): Leg => ({ kind: 'request', pos, serve: true })));
  } else if (algorithm === 'look') {
    legs.push(...reversed.map((pos): Leg => ({ kind: 'request', pos, serve: true })));
  } else if (algorithm === 'cscan') {
    if (position < maxTrack) legs.push({ kind: 'edge', pos: maxTrack, serve: false });
    if (lower.length) {
      legs.push({ kind: 'jump', pos: 0, serve: false });
      legs.push(...lower.map((pos): Leg => ({ kind: 'request', pos, serve: true })));
    }
  } else if (lower.length) {
    legs.push({ kind: 'jump', pos: lower[0]!, serve: true });
    legs.push(...lower.slice(1).map((pos): Leg => ({ kind: 'request', pos, serve: true })));
  }
  return legs;
}

function diskPlan(requests: number[], head: number, maxTrack: number, algorithm: string, direction: string): Leg[] {
  if (algorithm === 'fcfs') return requests.map((pos) => ({ kind: 'request', pos, serve: true }));
  if (algorithm === 'sstf') {
    const pending = requests.map((r, i) => ({ i, r }));
    const legs: Leg[] = [];
    let position = head;
    while (pending.length) {
      const choice = pickMin(pending, (item) => [Math.abs(item.r - position), item.i]);
      pending.splice(pending.indexOf(choice), 1);
      legs.push({ kind: 'request', pos: choice.r, serve: true });
      position = choice.r;
    }
    return legs;
  }
  if (direction === 'down') {
    return scanLegs(requests.map((r) => maxTrack - r), maxTrack - head, maxTrack, algorithm)
      .map((leg) => ({ ...leg, pos: maxTrack - leg.pos }));
  }
  return scanLegs(requests, head, maxTrack, algorithm);
}

interface DiskMove extends Leg { from: number; distance: number; raw: number; total: number }

function simulateDisk(
  requests: number[], head: number, maxTrack: number, algorithm: string, direction: string, returnCost: string,
): { moves: DiskMove[]; total: number; served: number[] } {
  const legs = diskPlan(requests, head, maxTrack, algorithm, direction);
  let position = head;
  let total = 0;
  const moves: DiskMove[] = [];
  for (const leg of legs) {
    const raw = Math.abs(leg.pos - position);
    const distance = leg.kind === 'jump' && returnCost === 'skip' ? 0 : raw;
    total += distance;
    moves.push({ ...leg, from: position, distance, raw, total });
    position = leg.pos;
  }
  return { moves, total, served: moves.filter((m) => m.serve).map((m) => m.pos) };
}

function evalDisk(model: LabModel, params: Record<string, unknown>): OsResult {
  const requests = (model.requests ?? []).map(Number);
  const algorithm = readString(params.algorithm ?? model.defaults.algorithm, 'fcfs') || 'fcfs';
  let direction = readString(params.direction ?? model.defaults.direction, 'up') || 'up';
  const returnCost = readString(params.return_cost ?? model.defaults.return_cost, 'count') || 'count';
  const head = typeof model.head === 'number' ? model.head : NaN;
  const maxTrack = typeof model.max_track === 'number' ? model.max_track : NaN;
  if (!Number.isFinite(head) || !Number.isFinite(maxTrack)) return blocked(model, '没有磁头起始位置或最大磁道号，请先补全题目数据。');
  if (!requests.length) return blocked(model, '没有磁道请求序列，请先补全题目数据。');
  if (requests.length > MAX_REQUESTS) return blocked(model, `请求超过 ${MAX_REQUESTS} 个；首版逐步演示只支持较短的序列。`);
  if (Math.min(...requests) < 0 || Math.max(...requests, head) > maxTrack || head < 0) {
    return blocked(model, `有磁道号超出范围 0–${fmt(maxTrack)}，请核对请求序列、磁头位置或最大磁道号。`);
  }
  if (!(algorithm in DISK_LABELS)) return blocked(model, '未知的磁盘调度算法。');
  if (direction !== 'up' && direction !== 'down') direction = 'up';

  const sim = simulateDisk(requests, head, maxTrack, algorithm, direction, returnCost);
  const frames: OsFrame[] = [];
  const usesDirection = ['scan', 'cscan', 'look', 'clook'].includes(algorithm);
  const startNote = usesDirection ? `，初始向磁道号${direction === 'up' ? '增大' : '减小'}方向` : '';
  pushFrame(frames, 'initial', `${DISK_LABELS[algorithm]}：磁头从 ${fmt(head)} 出发`,
    `共 ${requests.length} 个请求，磁道范围 0–${fmt(maxTrack)}${startNote}。`, 1, {
      head, path: [head], served: [], remaining: [...requests], total: 0, max_track: maxTrack, distance: 0,
      from_pos: head, kind: 'start', algorithm, direction,
    });
  const pending = [...requests];
  const path = [head];
  const served: number[] = [];
  for (const move of sim.moves) {
    path.push(move.pos);
    if (move.serve) { served.push(move.pos); pending.splice(pending.indexOf(move.pos), 1); }
    let label: string; let detail: string; let action: string; let line: number;
    if (move.kind === 'request') {
      label = `磁头 ${fmt(move.from)} → ${fmt(move.pos)}（移动 ${fmt(move.distance)}）`;
      detail = `服务磁道 ${fmt(move.pos)}，累计移动 ${fmt(move.total)}。`;
      action = 'seek'; line = 3;
    } else if (move.kind === 'edge') {
      label = `到达磁盘末端 ${fmt(move.pos)}（移动 ${fmt(move.distance)}）`;
      detail = `${algorithm.toUpperCase()} 必须走到磁盘末端再换向，累计移动 ${fmt(move.total)}。`;
      action = 'edge'; line = 4;
    } else {
      const counted = returnCost === 'count' ? '计入' : '不计入';
      label = `回扫 ${fmt(move.from)} → ${fmt(move.pos)}（${counted} ${fmt(move.raw)}）`;
      detail = `${algorithm.toUpperCase()} 不在回程服务请求，磁头直接跳到另一侧；回扫距离${counted}总移动，累计 ${fmt(move.total)}。`;
      action = 'jump'; line = 4;
    }
    pushFrame(frames, action, label, detail, line, {
      head: move.pos, path: [...path], served: [...served], remaining: [...pending], total: move.total,
      max_track: maxTrack, distance: move.distance, from_pos: move.from, kind: move.kind, algorithm, direction,
    });
  }
  const total = sim.total;
  const average = total / requests.length;
  const order = sim.served.map((v) => fmt(v));
  const answer = `总移动距离 = ${fmt(total)}，平均寻道长度 = ${fmt(average)}；服务顺序 ${order.join(' → ')}`;
  pushFrame(frames, 'result', '结果', answer, 5, {
    head: path[path.length - 1], path: [...path], served: [...served], remaining: [], total, max_track: maxTrack,
    distance: 0, from_pos: path[path.length - 1], kind: 'result', algorithm, direction,
  });
  const compare: Record<string, number> = {};
  for (const name of Object.keys(DISK_LABELS)) compare[name] = simulateDisk(requests, head, maxTrack, name, direction, returnCost).total;
  const sortedServed = [...sim.served].sort((a, b) => a - b);
  const sortedRequests = [...requests].sort((a, b) => a - b);
  const checks: LabCheck[] = [
    { id: 'coverage', label: '每个请求恰好服务一次',
      status: sortedServed.length === sortedRequests.length && sortedServed.every((v, i) => v === sortedRequests[i]) ? 'pass' : 'fail',
      detail: `服务了 ${sim.served.length} 个磁道，请求共 ${requests.length} 个。` },
    { id: 'range', label: '磁头不越界', status: path.every((p) => p >= 0 && p <= maxTrack) ? 'pass' : 'fail',
      detail: `磁头位置始终在 0–${fmt(maxTrack)} 之间。` },
  ];
  const metrics: LabResultMetric[] = [
    { id: 'algorithm', label: '算法', value: DISK_LABELS[algorithm]! },
    { id: 'total', label: '总移动距离', value: fmt(total) },
    { id: 'average', label: '平均寻道长度', value: fmt(average) },
    { id: 'order', label: '服务顺序', value: order.join(' → ') },
  ];
  return {
    subject: 'operating_system', engine: 'os_disk_v1', osKind: 'disk_schedule', status: 'ok', algorithm,
    frames, trace: frames, pseudocode: OS_PSEUDOCODE.disk_schedule, answer, answerValue: total, answerOrder: order,
    headline: `${DISK_LABELS[algorithm]}：总移动 ${fmt(total)}，平均 ${fmt(average)}`,
    metrics, checks, stopReason: 'done',
    stats: { total, average, served: sim.served, path, compare, max_track: maxTrack, head, requests: [...requests] },
    notes: ['SSTF 并列时选请求队列中更靠前的磁道；SCAN / C-SCAN 走到磁盘末端，LOOK / C-LOOK 只走到最远的请求。',
      'C-SCAN / C-LOOK 的回扫是否计入总移动因教材而异，可在“回扫距离”中切换。'],
  };
}

/* ------------------------------------------------------------------ */
/* 银行家算法                                                           */
/* ------------------------------------------------------------------ */

interface SafetyStep { index: number; work_before: number[]; work_after: number[]; finished: boolean[] }

function safety(names: string[], allocation: number[][], need: number[][], available: number[]):
{ steps: SafetyStep[]; sequence: string[] | null } {
  const n = names.length;
  const m = available.length;
  let work = [...available];
  const finished = new Array<boolean>(n).fill(false);
  const steps: SafetyStep[] = [];
  const sequence: string[] = [];
  while (sequence.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      if (!finished[i] && need[i]!.every((value, j) => j >= m || value <= work[j]! + EPS)) { pick = i; break; }
    }
    if (pick < 0) return { steps, sequence: null };
    const before = [...work];
    work = work.map((value, j) => value + allocation[pick]![j]!);
    finished[pick] = true;
    sequence.push(names[pick]!);
    steps.push({ index: pick, work_before: before, work_after: [...work], finished: [...finished] });
  }
  return { steps, sequence };
}

function evalBanker(model: LabModel, params: Record<string, unknown>): OsResult {
  const names = (model.names ?? []).map(String);
  const allocationRaw = isMatrix(model.allocation) ? model.allocation : null;
  const needRaw = isMatrix(model.need) ? model.need : null;
  const availableRaw = numberArray(model.available);
  const resources = (model.resources ?? []).map(String);
  const request = model.request && model.request.process && Array.isArray(model.request.vector)
    ? { process: String(model.request.process), vector: model.request.vector.map(Number) } : null;
  const mode = readString(params.request_mode ?? model.defaults.request_mode, 'ignore') || 'ignore';
  if (!allocationRaw || !needRaw || !availableRaw) {
    return blocked(model, '银行家算法需要 Allocation、Max（或 Need）与 Available，请先补全题目数据。');
  }
  const n = allocationRaw.length;
  const m = allocationRaw[0]!.length;
  if (names.length !== n || needRaw.length !== n || [...needRaw, ...allocationRaw].some((row) => row.length !== m)
    || availableRaw.length !== m || n > MAX_BANKER_N || m > MAX_BANKER_M) {
    return blocked(model, '矩阵形状不一致或超出首版范围，请核对三个输入。');
  }
  let alloc = allocationRaw.map((row) => [...row]);
  let needNow = needRaw.map((row) => [...row]);
  let avail = [...availableRaw];
  const frames: OsFrame[] = [];
  const rows = (finished?: boolean[]): Record<string, unknown>[] => names.map((id, i) => (
    { id, allocation: [...alloc[i]!], need: [...needNow[i]!], finished: finished ? !!finished[i] : false }));
  const vec = (values: number[]): string => `(${values.map((v) => fmt(v)).join(', ')})`;

  pushFrame(frames, 'initial', '写出 Allocation、Need 与 Available',
    `Need = Max − Allocation；可用资源 ${vec(avail)}（资源类型 ${resources.join('、')}）。`, 1,
    { rows: rows(), work: [...avail], resources, picked: null, request: null });
  let granted: boolean | null = null;
  let requestNote = '';
  let steps: SafetyStep[] = [];
  let sequence: string[] | null = null;
  const pickFrames = (list: SafetyStep[], req: typeof request | null): void => {
    list.forEach((step, offset) => {
      const i = step.index;
      pushFrame(frames, 'pick', `第 ${offset + 1} 轮：${names[i]} 可以完成`,
        `Need ${vec(needNow[i]!)} ≤ Work ${vec(step.work_before)}；${names[i]} 运行完毕后归还 Allocation，Work = ${vec(step.work_after)}。`, 3,
        { rows: rows(step.finished), work: step.work_after, resources, picked: i, request: req });
    });
  };
  if (request && mode === 'apply') {
    const index = names.indexOf(request.process);
    const vector = request.vector;
    if (index < 0 || vector.length !== m) return blocked(model, '资源请求的进程名或分量数与矩阵不一致。');
    if (vector.some((v, j) => v > needNow[index]![j]! + EPS)) {
      granted = false;
      requestNote = `${request.process} 的请求 ${vec(vector)} 超过它的 Need ${vec(needNow[index]!)}，出错，拒绝。`;
      pushFrame(frames, 'request_deny', '检查 1：Request ≤ Need 不成立', requestNote, 2,
        { rows: rows(), work: [...avail], resources, picked: null, request });
    } else if (vector.some((v, j) => v > avail[j]! + EPS)) {
      granted = false;
      requestNote = `可用资源 ${vec(avail)} 不能满足请求 ${vec(vector)}，${request.process} 必须等待。`;
      pushFrame(frames, 'request_deny', '检查 2：Request ≤ Available 不成立', requestNote, 2,
        { rows: rows(), work: [...avail], resources, picked: null, request });
    } else {
      pushFrame(frames, 'request_check', '检查 1、2：Request ≤ Need 且 ≤ Available',
        `${request.process} 请求 ${vec(vector)}：Need ${vec(needNow[index]!)}、Available ${vec(avail)}，两项检查均通过。`, 2,
        { rows: rows(), work: [...avail], resources, picked: null, request });
      const backup = { avail: [...avail], alloc: alloc.map((r) => [...r]), need: needNow.map((r) => [...r]) };
      avail = avail.map((v, j) => v - vector[j]!);
      alloc[index] = alloc[index]!.map((v, j) => v + vector[j]!);
      needNow[index] = needNow[index]!.map((v, j) => v - vector[j]!);
      pushFrame(frames, 'request_try', '试分配：Available 减、Allocation 加、Need 减',
        `假设分配成功：Available 变为 ${vec(avail)}，${request.process} 的 Allocation ${vec(alloc[index]!)}、Need ${vec(needNow[index]!)}。`, 2,
        { rows: rows(), work: [...avail], resources, picked: index, request });
      ({ steps, sequence } = safety(names, alloc, needNow, avail));
      pickFrames(steps, request);
      if (sequence === null) {
        granted = false;
        avail = backup.avail; alloc = backup.alloc; needNow = backup.need;
        requestNote = `试分配后系统不安全，撤销分配，${request.process} 必须等待。`;
        pushFrame(frames, 'unsafe', '试分配后不安全，撤销', requestNote, 4,
          { rows: rows(), work: [...avail], resources, picked: null, request });
      } else {
        granted = true;
        requestNote = `试分配后仍安全，可以满足 ${request.process} 的请求。`;
        pushFrame(frames, 'safe', '试分配后仍安全，批准请求', requestNote, 4, {
          rows: rows(new Array<boolean>(n).fill(true)), work: steps.length ? steps[steps.length - 1]!.work_after : [...avail],
          resources, picked: null, request,
        });
      }
    }
  }
  if (granted === null) {
    ({ steps, sequence } = safety(names, alloc, needNow, avail));
    pickFrames(steps, null);
    if (sequence === null) {
      const doneNames = new Set(steps.map((s) => names[s.index]!));
      const stuck = names.filter((name) => !doneNames.has(name));
      pushFrame(frames, 'unsafe', '没有可以完成的进程：不安全',
        `剩余进程 ${stuck.join('、')} 的 Need 都大于当前 Work，系统处于不安全状态（可能死锁）。`, 4, {
          rows: rows(names.map((name) => doneNames.has(name))),
          work: steps.length ? steps[steps.length - 1]!.work_after : [...avail], resources, picked: null, request: null,
        });
    } else {
      pushFrame(frames, 'safe', '全部进程可完成：安全', `安全序列 ${sequence.join(' → ')}。`, 4, {
        rows: rows(new Array<boolean>(n).fill(true)), work: steps[steps.length - 1]!.work_after,
        resources, picked: null, request: null,
      });
    }
  }
  const finalWork = steps.length && granted !== false ? steps[steps.length - 1]!.work_after : [...avail];
  let answer: string;
  if (request && mode === 'apply') {
    answer = `${request.process} 请求 ${vec(request.vector)}：${granted ? '可以分配' : '不能分配'}。`
      + (granted && sequence ? `安全序列 ${sequence.join(' → ')}。` : requestNote);
  } else if (sequence) answer = `系统处于安全状态，安全序列：${sequence.join(' → ')}`;
  else answer = '系统处于不安全状态，找不到安全序列';
  pushFrame(frames, 'result', '结果', answer, 5, {
    rows: rows(sequence ? new Array<boolean>(n).fill(true) : undefined), work: finalWork, resources, picked: null, request,
  });
  const metrics: LabResultMetric[] = [
    { id: 'state', label: '系统状态', value: sequence ? '安全' : '不安全' },
    { id: 'sequence', label: '安全序列', value: sequence ? sequence.join(' → ') : '无' },
    { id: 'available', label: '初始 Available', value: vec(availableRaw) },
    { id: 'shape', label: '规模', value: `${n} 个进程 × ${m} 类资源` },
  ];
  const checks: LabCheck[] = [{ id: 'safety', label: '安全性检查', status: sequence ? 'pass' : 'fail',
    detail: sequence ? '找到安全序列。' : '没有任何一个剩余进程满足 Need ≤ Work。' }];
  if (request && mode === 'apply') {
    checks.push({ id: 'request', label: '资源请求', status: granted ? 'pass' : 'warn', detail: requestNote });
  }
  return {
    subject: 'operating_system', engine: 'os_banker_v1', osKind: 'banker', status: 'ok', algorithm: 'banker',
    frames, trace: frames, pseudocode: OS_PSEUDOCODE.banker, answer, answerValue: null, answerOrder: sequence,
    headline: answer, metrics, checks, stopReason: sequence ? 'done' : 'unsafe',
    stats: { safe: !!sequence, sequence, granted, state: { available: avail, allocation: alloc, need: needNow }, names },
    notes: ['每一轮都从 P0 开始找第一个满足 Need ≤ Work 的进程，因此给出的是其中一个安全序列。',
      '安全序列通常不唯一：只要每一步都满足 Need ≤ Work，任何合法的完成顺序都算正确。'],
  };
}

/** 前端权威计算：与后端 app.labs.opsys 逐帧镜像。 */
export function evaluateOs(model: LabModel, params: Record<string, unknown>): OsResult {
  switch (model.os_kind) {
    case 'page_replace': return evalPage(model, params);
    case 'disk_schedule': return evalDisk(model, params);
    case 'banker': return evalBanker(model, params);
    default: return evalSchedule(model, params);
  }
}
