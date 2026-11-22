import type { LabCheck, LabModel, LabResultBase, LabResultFrame, LabResultMetric } from './types.ts';
import { readNumber, readString } from './types.ts';

export type OsKind = 'cpu_schedule' | 'page_replace' | 'disk_schedule' | 'banker'
  | 'os_basics' | 'process_thread' | 'sync' | 'deadlock' | 'memory_alloc'
  | 'tlb' | 'file_dir' | 'file_alloc' | 'device_mgmt';

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

export interface ManualScheduleRow {
  id: string; arrival: number; burst: number; finish: number | null;
  turnaround: number | null; waiting: number | null; remaining: number;
  state: 'pending' | 'ready' | 'done';
}
export interface ManualScheduleIssue { time: number; process: string | null; reason: string }
export interface ManualScheduleAudit {
  segments: OsGanttSegment[];
  rows: ManualScheduleRow[];
  errors: ManualScheduleIssue[];
  warnings: string[];
  complete: boolean;
  makespan: number;
  avgWaiting: number | null;
  avgTurnaround: number | null;
  idleSlots: number;
}
export interface OsPageStats {
  faults: number; hits: number; total: number; rate: number; frames_count: number;
  initial_frames: string[]; window: number; working_set: string[]; max_working_set: number;
  avg_working_set: number; thrash: boolean;
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
  engine: string;
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
export interface OsGenericResult extends OsResultBase {
  osKind: 'os_basics' | 'process_thread' | 'sync' | 'deadlock' | 'memory_alloc'
    | 'tlb' | 'file_dir' | 'file_alloc' | 'device_mgmt';
  stats: Record<string, unknown>;
}
export type OsResult = OsSchedResult | OsPageResult | OsDiskResult | OsBankerResult | OsGenericResult;

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
  hrrn: '高响应比优先 HRRN（非抢占）',
};
export const PAGE_LABELS: Record<string, string> = {
  fifo: '先进先出 FIFO', lru: '最近最久未使用 LRU', opt: '最佳置换 OPT',
  clock: '时钟置换 Clock（二次机会）',
};
export const DISK_LABELS: Record<string, string> = {
  fcfs: '先来先服务 FCFS', sstf: '最短寻道时间优先 SSTF', scan: 'SCAN（电梯）',
  cscan: 'C-SCAN（循环扫描）', look: 'LOOK', clook: 'C-LOOK',
};

export const OS_KIND_LABELS: Record<string, string> = {
  cpu_schedule: 'CPU 调度', page_replace: '虚拟内存与页面置换', disk_schedule: '磁盘调度',
  banker: '银行家算法', os_basics: '操作系统基础', process_thread: '进程与线程', sync: '同步与互斥',
  deadlock: '死锁', memory_alloc: '连续内存分配', tlb: 'TLB 与访问性能',
  file_dir: '文件与目录', file_alloc: '文件存储与空间管理', device_mgmt: '磁盘与设备管理',
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
  os_basics: [
    '用户态只能执行非特权指令',
    '系统调用/中断/异常进入内核态',
    '内核处理完成后返回用户态',
  ],
  process_thread: [
    '创建 → 就绪 → 运行 → 阻塞 → 就绪 → 终止',
    'PCB 保存进程状态、寄存器和资源信息',
    '同进程线程共享地址空间，栈/PC 独立',
  ],
  sync: [
    'P(S)：S=S−1；S<0 则阻塞',
    'V(S)：S=S+1；S≤0 则唤醒等待进程',
    '临界区前后成对使用 P/V 或 lock/unlock',
  ],
  deadlock: [
    '判断互斥、占有并等待、非抢占、循环等待四个必要条件',
    '用资源分配图/银行家算法检测或避免',
    '可预防、避免、检测或解除死锁',
  ],
  memory_alloc: [
    '按首次/最佳/最坏/邻近适应选择空闲区',
    '切分空闲区完成分配',
    '回收并合并相邻空闲区',
    '统计碎片与内存利用率',
  ],
  tlb: [
    '虚拟地址拆成 VPN + 页内偏移',
    '用 VPN 查 TLB：命中直接得到页框号',
    'TLB 未命中则逐级访问页表',
    '页表项有效则装入 TLB；无效则触发缺页',
    '物理地址 = 页框号 × 页大小 + 页内偏移',
    '有效访问时间按命中率和缺页开销加权',
  ],
  file_dir: [
    '按路径从根目录（或当前目录）逐级查找目录项',
    '目录项给出文件名到 inode 号的映射',
    '读取 inode 得到文件属性和数据块位置',
    'open 建立文件描述符→系统打开文件表→inode 的关联',
    'read/write 使用文件偏移，close 释放表项',
    '权限按文件主、同组、其他三类检查 rwx',
  ],
  file_alloc: [
    '文件大小与盘块大小决定所需块数',
    '连续分配记录起始块与长度；链接分配沿指针串联',
    '索引分配在索引块中存数据块号；FAT 把链接指针集中存放',
    '多级索引逐级计算可寻址块数与最大文件长度',
    '访问第 k 块时累加索引块与数据块的访盘次数',
    '位示图中 0 表示空闲块，按位号映射盘块号',
  ],
  device_mgmt: [
    '磁盘访问时间 = 寻道时间 + 旋转延迟 + 传输时间',
    '平均旋转延迟 = 半圈旋转时间 = 30 / 转速（秒）',
    '传输时间 = 数据量 / 数据传输率',
    '单缓冲与双缓冲按设备输入和 CPU 处理的并行关系计算',
    '假脱机用输入井/输出井和守护进程把独占设备虚拟成共享设备',
    '设备分配检查设备独立性、独占性与安全性',
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
    banker: 'os_banker_v1', os_basics: 'os_basics_v1', process_thread: 'os_process_v1',
    sync: 'os_sync_v1', deadlock: 'os_deadlock_v1', memory_alloc: 'os_memory_v1',
    tlb: 'os_tlb_v1', file_dir: 'os_file_dir_v1', file_alloc: 'os_file_alloc_v1',
    device_mgmt: 'os_device_v1' } as const)[kind];
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

  if (algorithm === 'fcfs' || algorithm === 'sjf' || algorithm === 'priority' || algorithm === 'hrrn') {
    const key = (i: number): Key => {
      if (algorithm === 'fcfs') return [arrival[i]!, i];
      if (algorithm === 'sjf') return [burst[i]!, arrival[i]!, i];
      if (algorithm === 'hrrn') return [-(Math.max(0, time - arrival[i]!) + burst[i]!) / burst[i]!, arrival[i]!, i];
      return [priority[i] ?? Infinity, arrival[i]!, i];
    };
    while (done < n) {
      const available = indexes.filter((i) => finish[i] === null && arrival[i]! <= time + EPS);
      if (!available.length) { time = idle(); continue; }
      const pick = pickMin(available, key);
      const ready = sortedBy(available.filter((i) => i !== pick), key);
      const ratio = (Math.max(0, time - arrival[pick]!) + burst[pick]!) / burst[pick]!;
      const reason = algorithm === 'fcfs' ? '就绪进程中最先到达'
        : algorithm === 'sjf' ? `就绪进程中服务时间最短（${fmt(burst[pick])}）`
          : algorithm === 'hrrn'
            ? `就绪进程中响应比最高（(${fmt(Math.max(0, time - arrival[pick]!))}+${fmt(burst[pick])})/${fmt(burst[pick])}≈${fmt(ratio)}）`
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

/**
 * 审计学生手工排列的时间片（每格 1 个时间单位）。
 * 只读：不修改内核结果，也不把非法调度静默修正成合法。
 */
export function auditManualSchedule(
  processes: OsProcess[],
  timeline: (string | null)[],
  step = 1,
): ManualScheduleAudit {
  const quantum = Number.isFinite(step) && step > 0 ? step : 1;
  const byId = new Map(processes.map((process) => [process.id, process]));
  const remaining = new Map(processes.map((process) => [process.id, process.burst]));
  const finish = new Map<string, number | null>(processes.map((process) => [process.id, null]));
  const errors: ManualScheduleIssue[] = [];
  const warnings: string[] = [];
  const segments: OsGanttSegment[] = [];
  let idleSlots = 0;
  let idleWarningShown = false;
  const push = (id: string | null, slot: number): void => {
    const start = clean(slot * quantum);
    const end = clean((slot + 1) * quantum);
    const last = segments[segments.length - 1];
    if (last && last.id === id && Math.abs(last.end - start) < EPS) last.end = end;
    else segments.push({ id, start, end });
  };
  timeline.forEach((id, slot) => {
    const time = clean(slot * quantum);
    if (id === null) {
      idleSlots += 1;
      const ready = processes.some((process) => process.arrival <= time + EPS && finish.get(process.id) === null);
      if (ready && !idleWarningShown) {
        warnings.push(`t=${fmt(time)}：就绪队列非空时选择了空闲，CPU 被浪费。`);
        idleWarningShown = true;
      }
      push(null, slot);
      return;
    }
    const process = byId.get(id);
    if (!process) {
      errors.push({ time, process: id, reason: `进程 ${id} 不在本题进程表中，t=${fmt(time)} 的这一格按空闲处理。` });
      push(null, slot);
      return;
    }
    if (process.arrival > time + EPS) {
      errors.push({ time, process: id, reason: `❌ 非法调度：t=${fmt(time)} 时进程 ${id} 尚未到达（到达时间 ${fmt(process.arrival)}）。` });
      push(null, slot);
      return;
    }
    const left = remaining.get(id) ?? 0;
    if (left <= EPS) {
      errors.push({ time, process: id, reason: `❌ 非法调度：进程 ${id} 已在 t=${fmt(finish.get(id) ?? 0)} 前完成，不能再运行。` });
      push(null, slot);
      return;
    }
    const next = clean(Math.max(0, left - quantum));
    remaining.set(id, next);
    if (next <= EPS) finish.set(id, clean((slot + 1) * quantum));
    push(id, slot);
    idleWarningShown = false;
  });

  const rows: ManualScheduleRow[] = processes.map((process) => {
    const left = remaining.get(process.id) ?? 0;
    const finishedAt = finish.get(process.id) ?? null;
    const done = finishedAt !== null && left <= EPS;
    const turnaround = done ? clean(finishedAt! - process.arrival) : null;
    return {
      id: process.id,
      arrival: process.arrival,
      burst: process.burst,
      finish: done ? finishedAt : null,
      turnaround,
      waiting: turnaround === null ? null : clean(turnaround - process.burst),
      remaining: left,
      state: done ? 'done' : process.arrival <= timeline.length * quantum + EPS ? 'ready' : 'pending',
    };
  });
  const complete = rows.every((row) => row.finish !== null);
  if (!complete) warnings.push('还没有为所有进程分配足够的时间片；补齐后才能比较平均等待时间。');
  const finishedRows = rows.filter((row): row is ManualScheduleRow & { finish: number; turnaround: number; waiting: number } =>
    row.finish !== null && row.turnaround !== null && row.waiting !== null);
  const mean = (pick: (row: ManualScheduleRow & { turnaround: number; waiting: number }) => number): number =>
    clean(finishedRows.reduce((sum, row) => sum + pick(row), 0) / finishedRows.length);
  return {
    segments,
    rows,
    errors,
    warnings,
    complete,
    makespan: Math.max(clean(timeline.length * quantum), ...finishedRows.map((row) => row.finish), 0),
    avgWaiting: complete && finishedRows.length ? mean((row) => row.waiting) : null,
    avgTurnaround: complete && finishedRows.length ? mean((row) => row.turnaround) : null,
    idleSlots,
  };
}

/** 用同一组进程生成参考算法的时间片序列，供“第一次分歧”提示使用。 */
export function referenceScheduleGantt(
  processes: OsProcess[],
  algorithm = 'srtf',
  quantum = 1,
): OsGanttSegment[] {
  if (!processes.length || !(algorithm in SCHED_LABELS)) return [];
  try {
    const sim = simulateSchedule(processes, algorithm, quantum);
    return sim.segments.map((segment) => ({
      id: segment.index >= 0 ? processes[segment.index]!.id : null,
      start: segment.start,
      end: segment.end,
    }));
  } catch {
    return [];
  }
}

/** 找到学生的第一格与参考算法不同的时间点。 */
export function firstScheduleDivergence(
  timeline: (string | null)[],
  reference: OsGanttSegment[],
  step = 1,
): { time: number; manual: string | null; reference: string | null } | null {
  const quantum = Number.isFinite(step) && step > 0 ? step : 1;
  const end = Math.max(timeline.length * quantum, ...reference.map((segment) => segment.end), 0);
  for (let time = 0; time < end; time += quantum) {
    const slot = Math.round(time / quantum);
    const manual = timeline[slot] ?? null;
    const segment = reference.find((item) => time >= item.start - EPS && time < item.end - EPS);
    const expected = segment?.id ?? null;
    if (manual !== expected) return { time: clean(time), manual, reference: expected };
  }
  return null;
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
  faults: number; aux_title: string; aux: string[]; refs: number[]; hand: number;
}

export function simulatePages(
  reference: string[], framesCount: number, algorithm: string, initialFrames: string[] = [],
): PageStep[] {
  const initial = initialFrames.slice(0, framesCount);
  const slots: (string | null)[] = [
    ...initial, ...new Array<string | null>(framesCount - initial.length).fill(null),
  ];
  const loaded = [
    ...initial.map((_, offset) => offset - initial.length),
    ...new Array<number>(framesCount - initial.length).fill(-1),
  ];
  const used = [
    ...initial.map((_, offset) => offset - initial.length),
    ...new Array<number>(framesCount - initial.length).fill(-1),
  ];
  const refs = slots.map((page) => (page === null ? 0 : 1));
  let hand = 0;
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
      refs[slot] = 1;
      hit = true;
    } else {
      hit = false;
      faults += 1;
      if (slots.includes(null)) slot = slots.indexOf(null);
      else {
        if (algorithm === 'fifo') slot = pickMin(slotIds, (s) => [loaded[s]!]);
        else if (algorithm === 'lru') slot = pickMin(slotIds, (s) => [used[s]!]);
        else if (algorithm === 'clock') {
          while (refs[hand] === 1) {
            refs[hand] = 0;
            hand = (hand + 1) % framesCount;
          }
          slot = hand;
          hand = (slot + 1) % framesCount;
        } else {
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
      refs[slot] = 1;
    }
    const resident = slotIds.filter((s) => slots[s] !== null);
    let auxTitle: string; let aux: string[];
    if (algorithm === 'fifo') {
      auxTitle = 'FIFO 队列（队首最早装入）';
      aux = sortedBy(resident, (s) => [loaded[s]!]).map((s) => slots[s]!);
    } else if (algorithm === 'lru') {
      auxTitle = 'LRU 栈（左为最近使用）';
      aux = sortedBy(resident, (s) => [-used[s]!]).map((s) => slots[s]!);
    } else if (algorithm === 'clock') {
      auxTitle = 'Clock 指针与访问位（→ 为下一检查位置）';
      aux = slotIds.map((s) => `${s === hand ? '→' : ''}块${s + 1}:${slots[s] ?? '空'}(R=${refs[s]})`);
    } else {
      auxTitle = '下次访问位置（∞ 表示不再访问）';
      aux = resident.map((s) => {
        let later = -1;
        for (let k = index + 1; k < reference.length; k += 1) if (reference[k] === slots[s]) { later = k; break; }
        return `${slots[s]}:${later >= 0 ? later + 1 : '∞'}`;
      });
    }
    steps.push({ index, page, hit, frames: [...slots], slot, evicted, faults,
      aux_title: auxTitle, aux, refs: [...refs], hand });
  });
  return steps;
}

function lastFaults(reference: string[], framesCount: number, algorithm: string, initialFrames: string[] = []): number {
  const steps = simulatePages(reference, framesCount, algorithm, initialFrames);
  return steps[steps.length - 1]!.faults;
}

function workingSet(reference: string[], window: number): string[][] {
  return reference.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const seen: string[] = [];
    for (const page of reference.slice(start, index + 1)) if (!seen.includes(page)) seen.push(page);
    return seen;
  });
}

function evalPage(model: LabModel, params: Record<string, unknown>): OsResult {
  const reference = (model.reference ?? []).map(String);
  const initialFrames = (model.initial_frames ?? []).map(String);
  const algorithm = readString(params.algorithm ?? model.defaults.algorithm, 'fifo') || 'fifo';
  const framesCount = Math.trunc(readNumber(params.frames ?? model.defaults.frames, 3));
  const window = Math.trunc(readNumber(params.window ?? model.defaults.window, 4));
  if (!reference.length) return blocked(model, '没有页面访问序列，请先补全题目数据。');
  if (reference.length > MAX_REFERENCE) return blocked(model, `访问序列超过 ${MAX_REFERENCE} 次；首版逐步演示只支持较短的序列。`);
  if (framesCount < 1 || framesCount > MAX_FRAMES) return blocked(model, `物理块数需在 1–${MAX_FRAMES} 之间。`);
  if (window < 1 || window > MAX_REFERENCE) return blocked(model, `工作集窗口需在 1–${MAX_REFERENCE} 次访问之间。`);
  if (initialFrames.length > framesCount) {
    return blocked(model, `初始已调入 ${initialFrames.length} 个页面，超过物理块数 ${framesCount}，请核对原题。`);
  }
  if (new Set(initialFrames).size !== initialFrames.length) return blocked(model, '初始已调入的页面有重复，请核对原题。');
  if (!(algorithm in PAGE_LABELS)) return blocked(model, '未知的置换算法。');

  const steps = simulatePages(reference, framesCount, algorithm, initialFrames);
  const total = reference.length;
  const faults = steps[steps.length - 1]!.faults;
  const wsSets = workingSet(reference, window);
  const workingSetFinal = wsSets[wsSets.length - 1]!;
  const maxWorkingSet = Math.max(...wsSets.map((item) => item.length));
  const avgWorkingSet = wsSets.reduce((sum, item) => sum + item.length, 0) / wsSets.length;
  const thrash = maxWorkingSet > framesCount;
  const frames: OsFrame[] = [];
  const startFrames: (string | null)[] = [
    ...initialFrames, ...new Array<string | null>(framesCount - initialFrames.length).fill(null),
  ];
  pushFrame(frames, 'initial', initialFrames.length
    ? `${PAGE_LABELS[algorithm]}：${framesCount} 个物理块，初始已装入 ${initialFrames.join(', ')}`
    : `${PAGE_LABELS[algorithm]}：${framesCount} 个物理块，初始全空`,
  initialFrames.length
    ? '初始驻留页面不产生缺页；每次访问先查物理块，不在其中才产生一次缺页。'
    : '每次访问先查物理块；不在其中就产生一次缺页。', 1, {
    reference: [...reference], cursor: -1, frames: startFrames,
    hit: null, slot: null, evicted: null, faults: 0, hits: 0, aux_title: '', aux: [], algorithm,
    initial_frames: [...initialFrames], window, working_set: [], ws_max: 0,
  });
  const reasons: Record<string, string> = {
    fifo: '最早装入的页面', lru: '最近最久没有被使用的页面',
    opt: '未来最晚才会再次访问（或不再访问）的页面', clock: '访问位为 0 且被指针扫到的页面',
  };
  for (const step of steps) {
    const hits = step.index + 1 - step.faults;
    const ws = wsSets[step.index]!;
    let label: string; let detail: string; let action: string; let line: number;
    if (step.hit) {
      label = `访问 ${step.page}：命中`;
      detail = `页面 ${step.page} 已在物理块中，不产生缺页。`;
      if (algorithm === 'clock') detail += ' Clock 将该页访问位置 1。';
      action = 'hit'; line = 2;
    } else if (step.evicted === null) {
      label = `访问 ${step.page}：缺页，装入空闲块`;
      detail = `页面 ${step.page} 不在内存，仍有空闲物理块，直接装入块 ${step.slot + 1}。`;
      if (algorithm === 'clock') detail += ' 新装入页面的访问位置 1。';
      action = 'fault'; line = 3;
    } else {
      label = `访问 ${step.page}：缺页，置换 ${step.evicted}`;
      detail = `物理块已满，按 ${algorithm.toUpperCase()} 选择${reasons[algorithm]} ${step.evicted} 换出，页面 ${step.page} 装入块 ${step.slot + 1}。`;
      if (algorithm === 'clock') detail += ' 指针扫描时把经过页面的访问位清零，被换出页面重新装入后访问位置 1，指针移到下一块。';
      action = 'replace'; line = 4;
    }
    pushFrame(frames, action, label, detail, line, {
      reference: [...reference], cursor: step.index, frames: step.frames, hit: step.hit, slot: step.slot,
      evicted: step.evicted, faults: step.faults, hits, aux_title: step.aux_title, aux: step.aux,
      algorithm, refs: step.refs, hand: step.hand, window, working_set: ws, ws_max: maxWorkingSet,
    });
  }
  const rate = faults / total;
  const workingSetNote = `工作集 Δ=${window}：最大 ${maxWorkingSet} 页，`
    + (thrash ? `超过物理块数 ${framesCount}，可能发生抖动` : `不超过物理块数 ${framesCount}，无明显抖动`);
  const answer = `缺页 ${faults} 次，命中 ${total - faults} 次，缺页率 ${(rate * 100).toFixed(1)}%；${workingSetNote}`;
  pushFrame(frames, 'result', '结果', answer, 5, {
    reference: [...reference], cursor: total - 1, frames: steps[steps.length - 1]!.frames, hit: null, slot: null,
    evicted: null, faults, hits: total - faults, aux_title: '', aux: [], algorithm,
    refs: steps[steps.length - 1]!.refs, hand: steps[steps.length - 1]!.hand, window,
    working_set: workingSetFinal, ws_max: maxWorkingSet,
  });

  const compare: Record<string, number> = {};
  for (const name of Object.keys(PAGE_LABELS)) {
    compare[name] = lastFaults(reference, framesCount, name, initialFrames);
  }
  const series = Array.from({ length: MAX_FRAMES }, (_, k) => (
    { frames: k + 1, faults: lastFaults(reference, k + 1, algorithm, initialFrames) }))
    .filter((item) => item.frames >= Math.max(1, initialFrames.length));
  const checks: LabCheck[] = [{ id: 'accounting', label: '命中 + 缺页 = 访问次数', status: 'pass',
    detail: `${total - faults} + ${faults} = ${total}。` }];
  const bestOther = Math.min(compare.fifo!, compare.lru!, compare.clock!);
  checks.push(compare.opt! <= bestOther
    ? { id: 'opt_bound', label: 'OPT 为缺页下界', status: 'pass',
      detail: `OPT ${compare.opt} 次不超过 FIFO ${compare.fifo}、LRU ${compare.lru}、Clock ${compare.clock} 的缺页次数。` }
    : { id: 'opt_bound', label: 'OPT 为缺页下界', status: 'fail', detail: 'OPT 的缺页次数不应高于其他算法，请核对序列。' });
  if (algorithm === 'fifo' || algorithm === 'clock') {
    const bigger = series.find((item) => item.frames === framesCount + 1);
    const label = algorithm === 'fifo' ? 'FIFO' : 'Clock';
    checks.push(bigger && bigger.faults > faults
      ? { id: 'belady', label: 'Belady 异常', status: 'warn',
        detail: `物理块从 ${framesCount} 增加到 ${framesCount + 1}，${label} 缺页反而从 ${faults} 增加到 ${bigger.faults} 次。` }
      : { id: 'belady', label: 'Belady 异常', status: 'pass',
        detail: `增加一个物理块后缺页次数没有增加；${label} 不是栈式算法，仍可能在其他序列上出现异常。` });
  } else {
    checks.push({ id: 'belady', label: 'Belady 异常', status: 'pass', detail: 'LRU 与 OPT 是栈式算法，增加物理块不会让缺页变多。' });
  }
  checks.push({
    id: 'working_set', label: '工作集与抖动', status: thrash ? 'warn' : 'pass',
    detail: `窗口 Δ=${window} 时最大工作集 ${maxWorkingSet} 页，物理块 ${framesCount} 块；`
      + (thrash ? '驻留集小于工作集，可能发生抖动。' : '驻留集不小于工作集，没有明显抖动。'),
  });
  const metrics: LabResultMetric[] = [
    { id: 'algorithm', label: '算法', value: PAGE_LABELS[algorithm]! },
    { id: 'faults', label: '缺页次数', value: String(faults) },
    { id: 'hits', label: '命中次数', value: String(total - faults) },
    { id: 'rate', label: '缺页率', value: `${(rate * 100).toFixed(1)}%` },
    { id: 'working_set', label: `工作集 Δ=${window}`, value: `${workingSetFinal.join(',')}（最大 ${maxWorkingSet}）` },
  ];
  return {
    subject: 'operating_system', engine: 'os_page_v1', osKind: 'page_replace', status: 'ok', algorithm,
    frames, trace: frames, pseudocode: OS_PSEUDOCODE.page_replace, answer, answerValue: faults, answerOrder: null,
    headline: `${PAGE_LABELS[algorithm]}（${framesCount} 块）：缺页 ${faults} 次 / 访问 ${total} 次`,
    metrics, checks, stopReason: 'done',
    stats: { faults, hits: total - faults, total, rate, frames_count: framesCount,
      initial_frames: [...initialFrames], window, working_set: workingSetFinal,
      max_working_set: maxWorkingSet, avg_working_set: avgWorkingSet, thrash, compare, series },
    notes: ['物理块按固定位置显示：被置换页面所在的块直接装入新页面。',
      'OPT 并列时（多个页面都不再访问）置换最早装入的页面；LRU 命中会刷新最近使用时间，FIFO 命中不改变队列。',
      'Clock 指针初始指向块 1；命中或装入空闲块只把访问位置 1，只有置换扫描会移动指针。',
      '初始驻留页面按给定顺序视为从早到晚装入；对初态页面的访问按命中处理，不计缺页。'],
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

/* ------------------------------------------------------------------ */
/* 手动接管审计（页面置换 / 磁盘调度 / 银行家）                              */
/* ------------------------------------------------------------------ */

export interface ManualPageRow {
  index: number;
  page: string;
  /** 学生选择的物理块（0 基）；非法块号原样保留供 UI 展示。 */
  slot: number | null;
  hit: boolean;
  evicted: string | null;
  /** 本次访问处理后的物理块快照。 */
  frames: (string | null)[];
  error: string | null;
}
export interface ManualPageAudit {
  rows: ManualPageRow[];
  /** 处理完学生的全部选择后的物理块状态。 */
  frames: (string | null)[];
  faults: number;
  hits: number;
  errors: { index: number; page: string; reason: string }[];
  warnings: string[];
  /** 每次访问都已给出选择（错误不阻止完成判定，但会在 errors 中列出）。 */
  complete: boolean;
}

/**
 * 审计学生手工填入的页面置换表。
 * choices[i] 表示第 i 次访问把页面装入的物理块（0 基）。
 * 命中是客观事实：页面已在内存时选错块不会变成合法装入，而是记录错误。
 * 只读：不修改内核结果，也不把非法选择静默修正成合法。
 */
export function auditManualPageReplace(
  framesCount: number,
  initialFrames: string[],
  reference: string[],
  choices: number[],
): ManualPageAudit {
  const slots: (string | null)[] = [
    ...initialFrames.slice(0, framesCount),
    ...new Array<string | null>(Math.max(0, framesCount - initialFrames.length)).fill(null),
  ];
  const rows: ManualPageRow[] = [];
  const errors: ManualPageAudit['errors'] = [];
  const warnings: string[] = [];
  let faults = 0;
  let hits = 0;
  const limit = Math.min(choices.length, reference.length);
  for (let index = 0; index < limit; index += 1) {
    const page = reference[index]!;
    const pick = choices[index]!;
    if (!Number.isInteger(pick) || pick < 0 || pick >= framesCount) {
      // 块号越界：页面没有装入，访问仍按缺页计。
      faults += 1;
      const reason = `第 ${index + 1} 次访问 ${page}：块 ${pick + 1} 不存在（本题只有 ${framesCount} 个物理块），页面没有装入。`;
      errors.push({ index, page, reason });
      rows.push({ index, page, slot: pick, hit: false, evicted: null, frames: [...slots], error: reason });
      continue;
    }
    if (slots.includes(page)) {
      hits += 1;
      const own = slots.indexOf(page);
      if (pick === own) {
        rows.push({ index, page, slot: pick, hit: true, evicted: null, frames: [...slots], error: null });
      } else {
        const reason = `第 ${index + 1} 次访问 ${page}：页面已在块 ${own + 1} 中，属于命中；`
          + `你又把它装入块 ${pick + 1}，同一页面被装了两份，物理块状态不合法。`;
        errors.push({ index, page, reason });
        rows.push({ index, page, slot: pick, hit: true, evicted: null, frames: [...slots], error: reason });
      }
      continue;
    }
    faults += 1;
    const evicted = slots[pick] ?? null;
    if (evicted !== null && reference[index + 1] === evicted) {
      warnings.push(`第 ${index + 1} 次访问换出了 ${evicted}，而下一次访问马上又是它——这一页刚换出去就要换回来。`);
    }
    slots[pick] = page;
    rows.push({ index, page, slot: pick, hit: false, evicted, frames: [...slots], error: null });
  }
  if (choices.length < reference.length) {
    warnings.push('还没有处理完整个访问序列；每次访问都指定物理块后才能对照缺页次数。');
  }
  return { rows, frames: slots, faults, hits, errors, warnings, complete: choices.length >= reference.length };
}

/**
 * 找到学生的置换表与参考算法（默认 OPT，即理论最优）第一次不同的访问。
 * 只要之前的选择一致，命中/缺页状态必然一致，所以只需比较缺页时选的块；
 * 学生的非法选择本身也算作分歧点并直接返回原因。
 */
export function firstPageDivergence(
  choices: number[],
  reference: string[],
  framesCount: number,
  initialFrames: string[] = [],
  algorithm = 'opt',
): { index: number; page: string; manual: string; reference: string } | null {
  if (!(algorithm in PAGE_LABELS)) return null;
  const steps = simulatePages(reference, framesCount, algorithm, initialFrames);
  const audit = auditManualPageReplace(framesCount, initialFrames, reference, choices);
  const limit = Math.min(audit.rows.length, steps.length);
  for (let index = 0; index < limit; index += 1) {
    const mine = audit.rows[index]!;
    const theirs = steps[index]!;
    const page = reference[index]!;
    if (mine.error) {
      return { index, page, manual: mine.error, reference: theirs.hit ? '命中（页已在内存）' : `缺页，装入块 ${theirs.slot + 1}` };
    }
    const describe = (hit: boolean, slot: number, evicted: string | null): string => hit
      ? '命中'
      : `缺页，装入块 ${slot + 1}${evicted ? `（换出 ${evicted}）` : '（空闲块）'}`;
    if (mine.hit !== theirs.hit) {
      return {
        index, page,
        manual: describe(mine.hit, mine.slot ?? -1, mine.evicted),
        reference: describe(theirs.hit, theirs.slot, theirs.evicted),
      };
    }
    if (!mine.hit && mine.slot !== theirs.slot) {
      return {
        index, page,
        manual: describe(false, mine.slot!, mine.evicted),
        reference: describe(false, theirs.slot, theirs.evicted),
      };
    }
  }
  return null;
}

export interface ManualDiskAudit {
  /** 磁头走过的完整位置序列（含起点）。 */
  path: number[];
  /** 已服务磁道顺序。 */
  served: number[];
  /** 合法（未重复、未越界）的请求下标。 */
  picks: number[];
  total: number;
  errors: string[];
  complete: boolean;
}

/**
 * 审计学生手工点选的磁盘服务顺序。
 * picks 是请求下标序列；重复点选与越界下标记为错误并跳过，不替学生改顺序。
 */
export function auditManualDiskOrder(
  head: number,
  requests: number[],
  picks: number[],
): ManualDiskAudit {
  const used = new Set<number>();
  const path = [head];
  const served: number[] = [];
  const errors: string[] = [];
  let position = head;
  let total = 0;
  for (const pick of picks) {
    if (!Number.isInteger(pick) || pick < 0 || pick >= requests.length) {
      errors.push(`请求编号 ${pick + 1} 不在请求表里，跳过。`);
      continue;
    }
    if (used.has(pick)) {
      errors.push(`磁道 ${requests[pick]} 已经服务过一次，重复点选不移动磁头，按忽略处理。`);
      continue;
    }
    used.add(pick);
    const pos = requests[pick]!;
    total += Math.abs(pos - position);
    position = pos;
    path.push(pos);
    served.push(pos);
  }
  return { path, served, picks: [...used], total: clean(total), errors, complete: used.size === requests.length };
}

/** 找到学生的服务顺序与参考算法（默认 SSTF）第一个不同的请求。 */
export function firstDiskDivergence(
  picks: number[],
  requests: number[],
  head: number,
  algorithm = 'sstf',
): { index: number; manual: number; reference: number } | null {
  if (!(algorithm in DISK_LABELS) || !requests.length) return null;
  const maxTrack = Math.max(...requests, head);
  const expected = simulateDisk(requests, head, maxTrack, algorithm, 'up', 'count').served;
  const limit = Math.min(picks.length, expected.length);
  for (let index = 0; index < limit; index += 1) {
    const manual = requests[picks[index]!];
    if (manual === undefined) continue;
    if (manual !== expected[index]!) return { index, manual, reference: expected[index]! };
  }
  return null;
}

export interface ManualBankerRow {
  index: number;
  name: string;
  workBefore: number[];
  workAfter: number[];
}
export interface ManualBankerAudit {
  rows: ManualBankerRow[];
  /** 当前 Work（学生最后一次成功选择之后）。 */
  work: number[];
  finished: boolean[];
  /** 第一次 Need > Work 的选择；序列在此无法继续。 */
  violation: { step: number; name: string; need: number[]; deficient: number[]; work: number[] } | null;
  duplicate: { step: number; name: string } | null;
  errors: string[];
  complete: boolean;
  safe: boolean;
}

/**
 * 审计学生手工排出的安全序列。
 * picks 是进程下标序列；每一步检查 Need ≤ Work，不满足则标出缺口并停止，
 * 已完成的进程不能重复选入。任何合法的完成顺序都判对，不要求与内核序列一致。
 */
export function auditManualBanker(
  available: number[],
  allocation: number[][],
  need: number[][],
  picks: number[],
  names: string[],
): ManualBankerAudit {
  const n = names.length;
  const work = [...available];
  const finished = new Array<boolean>(n).fill(false);
  const rows: ManualBankerRow[] = [];
  const errors: string[] = [];
  let violation: ManualBankerAudit['violation'] = null;
  let duplicate: ManualBankerAudit['duplicate'] = null;
  for (let step = 0; step < picks.length; step += 1) {
    const index = picks[step]!;
    if (!Number.isInteger(index) || index < 0 || index >= n) {
      errors.push(`第 ${step + 1} 个选择不是合法进程，跳过。`);
      continue;
    }
    const name = names[index]!;
    if (finished[index]) {
      if (!duplicate) duplicate = { step, name };
      errors.push(`${name} 已经排在序列中并完成过，不能重复选入。`);
      continue;
    }
    const needRow = need[index]!;
    const deficient = needRow.map((value, j) => clean(Math.max(0, value - work[j]!)));
    if (deficient.some((value) => value > EPS)) {
      violation = { step, name, need: [...needRow], deficient, work: [...work] };
      errors.push(`${name} 的 Need 超过了当前 Work：假定它先完成会导致死锁，序列在此中断。`);
      break;
    }
    rows.push({
      index, name, workBefore: [...work], workAfter: work.map((value, j) => clean(value + allocation[index]![j]!)),
    });
    for (let j = 0; j < work.length; j += 1) work[j] = clean(work[j]! + allocation[index]![j]!);
    finished[index] = true;
  }
  const complete = finished.every(Boolean);
  return { rows, work, finished, violation, duplicate, errors, complete, safe: complete && violation === null };
}

/** 前端权威计算：与后端 app.labs.opsys 逐帧镜像。 */
export function evaluateOs(model: LabModel, params: Record<string, unknown>): OsResult {
  const kind = String(model.os_kind ?? 'cpu_schedule') as OsKind;
  const genericKinds = new Set<OsKind>(['os_basics', 'process_thread', 'sync', 'deadlock', 'memory_alloc',
    'tlb', 'file_dir', 'file_alloc', 'device_mgmt']);
  if (genericKinds.has(kind) || (kind === 'page_replace' && !(model.reference?.length))) {
    const embedded = (model as unknown as { os_result?: Record<string, unknown> }).os_result;
    if (!embedded || !Array.isArray(embedded.frames) || embedded.frames.length === 0) {
      return blocked(model, '该操作系统题型的执行记录尚未生成，请重新打开或重建题目。');
    }
    const raw = embedded;
    const frames = raw.frames as OsFrame[];
    return {
      subject: 'operating_system',
      engine: String(raw.engine ?? `os_${kind}_v1`),
      osKind: kind,
      status: raw.status === 'ok' ? 'ok' : 'blocked',
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      algorithm: String(raw.algorithm ?? ''),
      answer: String(raw.answer ?? ''),
      answerValue: typeof raw.answer_value === 'number' ? raw.answer_value
        : (typeof raw.answerValue === 'number' ? raw.answerValue : null),
      answerOrder: Array.isArray(raw.answer_order) ? raw.answer_order as string[]
        : (Array.isArray(raw.answerOrder) ? raw.answerOrder as string[] : null),
      stopReason: typeof raw.stop_reason === 'string' ? raw.stop_reason : null,
      pseudocode: Array.isArray(raw.pseudocode) ? raw.pseudocode as string[] : [],
      frames,
      trace: frames,
      headline: String(raw.headline ?? raw.answer ?? ''),
      metrics: Array.isArray(raw.metrics) ? raw.metrics as OsResult['metrics'] : [],
      checks: Array.isArray(raw.checks) ? raw.checks as OsResult['checks'] : [],
      notes: Array.isArray(raw.notes) ? raw.notes as string[] : [],
      stats: typeof raw.stats === 'object' && raw.stats !== null ? raw.stats as Record<string, unknown> : {},
    } as OsGenericResult;
  }
  switch (model.os_kind) {
    case 'page_replace': return evalPage(model, params);
    case 'disk_schedule': return evalDisk(model, params);
    case 'banker': return evalBanker(model, params);
    default: return evalSchedule(model, params);
  }
}
