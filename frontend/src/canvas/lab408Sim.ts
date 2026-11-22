/** 408 工坊的数据结构与计算机组成原理确定性步进内核（纯函数，画布与测试共用）。 */

import { cacheSplit } from './lab408.ts';

export interface FramePlayer<F> {
  frames: F[];
  summary: string;
  note?: string;
}

const DEFAULT_TREE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const TRAVERSAL_NAMES = ['先序', '中序', '后序', '层序'] as const;

/** 固定 6 节点结构：A(B(D,E), C(·,F))，下标 A=0 B=1 C=2 D=3 E=4 F=5。 */
const TREE_CHILDREN: readonly (readonly [number | null, number | null])[] = [
  [1, 2],
  [3, 4],
  [null, 5],
  [null, null],
  [null, null],
  [null, null],
];

export interface TreeFrame {
  activeId: string;
  visited: string[];
  stackOrQueue: string[];
}

export function dsTraversalFrames(order: number, labels?: readonly string[]): FramePlayer<TreeFrame> {
  const names = labels && labels.length >= TREE_CHILDREN.length ? labels : DEFAULT_TREE_LABELS;
  const kind = Math.max(0, Math.min(3, Math.round(Number.isFinite(order) ? order : 0)));
  const frames: TreeFrame[] = [];
  const visited: string[] = [];

  const record = (id: number, stack: readonly number[]) => {
    const name = names[id]!;
    visited.push(name);
    frames.push({ activeId: name, visited: [...visited], stackOrQueue: stack.map(node => names[node]!) });
  };

  if (kind === 3) {
    const queue: number[] = [0];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const [left, right] = TREE_CHILDREN[id]!;
      if (left !== null) queue.push(left);
      if (right !== null) queue.push(right);
      visited.push(names[id]!);
      frames.push({ activeId: names[id]!, visited: [...visited], stackOrQueue: queue.map(node => names[node]!) });
    }
  } else {
    const walk = (id: number, path: readonly number[]) => {
      const stack = [...path, id];
      if (kind === 0) record(id, stack);
      const [left, right] = TREE_CHILDREN[id]!;
      if (left !== null) walk(left, stack);
      if (kind === 1) record(id, stack);
      if (right !== null) walk(right, stack);
      if (kind === 2) record(id, stack);
    };
    walk(0, []);
  }

  return { frames, summary: `${TRAVERSAL_NAMES[kind]}遍历 · 共 ${frames.length} 个节点` };
}

const DEFAULT_KMP_TEXT = 'ABABABC';
const DEFAULT_KMP_PATTERN = 'ABABC';

export interface KmpFrame {
  i: number;
  j: number;
  next: number[];
  matched: boolean;
  shiftedBy: number;
}

function prefixFunction(pattern: string): number[] {
  const next: number[] = Array.from({ length: pattern.length }, () => 0);
  for (let i = 1; i < pattern.length; i += 1) {
    let k = next[i - 1]!;
    while (k > 0 && pattern[i] !== pattern[k]) k = next[k - 1]!;
    if (pattern[i] === pattern[k]) k += 1;
    next[i] = k;
  }
  return next;
}

export function kmpFrames(text: string, pattern: string): FramePlayer<KmpFrame> {
  const source = text && pattern ? text : DEFAULT_KMP_TEXT;
  const needle = text && pattern ? pattern : DEFAULT_KMP_PATTERN;
  const next = prefixFunction(needle);
  const frames: KmpFrame[] = [];
  let i = 0;
  let j = 0;

  while (i < source.length) {
    if (source[i] === needle[j]) {
      i += 1;
      j += 1;
      const matched = j === needle.length;
      frames.push({ i, j, next: [...next], matched, shiftedBy: matched ? i - j : 0 });
      if (matched) break;
    } else if (j > 0) {
      j = next[j - 1]!;
      frames.push({ i, j, next: [...next], matched: false, shiftedBy: 0 });
    } else {
      i += 1;
      frames.push({ i, j: 0, next: [...next], matched: false, shiftedBy: 0 });
    }
  }

  const last = frames[frames.length - 1];
  const summary = last?.matched
    ? `命中于起点 ${last.shiftedBy} · 比较 ${frames.length} 次`
    : `未命中 · 比较 ${frames.length} 次`;
  return { frames, summary, note: `前缀函数 ${next.join(',')}` };
}

export type SortAlgo = 'quicksort' | 'heapsort';

export interface SortFrame {
  values: number[];
  compare: [number, number] | null;
  swap: [number, number] | null;
  pivot: number | null;
  bounds?: [number, number];
  heapEnd: number | null;
  sorted: number[];
}

const DEFAULT_SORT_VALUES = [5, 2, 9, 1, 5, 6] as const;

export function sortFrames(values: readonly number[], algo: SortAlgo): FramePlayer<SortFrame> {
  const arr = values.length > 0 ? [...values] : [...DEFAULT_SORT_VALUES];
  const sorted = new Set<number>();
  const frames: SortFrame[] = [];

  const push = (compare: [number, number] | null, swap: [number, number] | null, pivot: number | null, heapEnd: number | null, bounds?: [number, number]) => {
    frames.push({ values: [...arr], compare, swap, pivot, heapEnd, sorted: [...sorted].sort((a, b) => a - b), ...(bounds && { bounds }) });
  };
  const exchange = (a: number, b: number) => {
    const temporary = arr[a]!;
    arr[a] = arr[b]!;
    arr[b] = temporary;
  };

  if (algo === 'heapsort') {
    const siftDown = (start: number, end: number) => {
      let root = start;
      while (root * 2 + 1 <= end) {
        const child = root * 2 + 1;
        let target = child;
        if (child + 1 <= end) {
          push([target, child + 1], null, null, end);
          if (arr[child + 1]! > arr[target]!) target = child + 1;
        }
        push([root, target], null, null, end);
        if (arr[target]! > arr[root]!) {
          exchange(root, target);
          push(null, [root, target], null, end);
          root = target;
        } else {
          return;
        }
      }
    };
    for (let start = Math.floor(arr.length / 2) - 1; start >= 0; start -= 1) siftDown(start, arr.length - 1);
    for (let end = arr.length - 1; end > 0; end -= 1) {
      exchange(0, end);
      push(null, [0, end], null, end);
      sorted.add(end);
      siftDown(0, end - 1);
    }
    sorted.add(0);
  } else {
    const quick = (lo: number, hi: number) => {
      if (lo > hi) return;
      const bounds: [number, number] = [lo, hi];
      if (lo === hi) {
        sorted.add(lo);
        push(null, null, lo, null, bounds);
        return;
      }
      const pivotValue = arr[hi]!;
      let store = lo;
      for (let scan = lo; scan < hi; scan += 1) {
        push([scan, hi], null, hi, null, bounds);
        if (arr[scan]! < pivotValue) {
          if (store !== scan) {
            exchange(store, scan);
            push(null, [store, scan], hi, null, bounds);
          }
          store += 1;
        }
      }
      if (store !== hi) {
        exchange(store, hi);
        push(null, [store, hi], hi, null, bounds);
      }
      sorted.add(store);
      push(null, null, store, null, bounds);
      quick(lo, store - 1);
      quick(store + 1, hi);
    };
    quick(0, arr.length - 1);
    for (let index = 0; index < arr.length; index += 1) sorted.add(index);
  }

  push(null, null, null, null);
  const label = algo === 'heapsort' ? '堆排序' : '快速排序';
  return { frames, summary: `${label} · ${frames.length} 帧 · 终态 ${arr.join(',')}` };
}

const DEFAULT_GRAPH_EDGES: readonly (readonly [number, number, number])[] = [
  [0, 1, 7], [0, 2, 9], [0, 5, 14], [1, 2, 10], [1, 3, 15], [2, 3, 11], [2, 5, 2], [3, 4, 6], [4, 5, 9],
];

export interface GraphFrame {
  dist: number[];
  prev: (number | null)[];
  active: number | null;
  relaxed: number | null;
  visited: number[];
}

export function graphDijkstraFrames(
  graph: { nodes: number; edges: readonly (readonly [number, number, number])[] },
  start: number,
): FramePlayer<GraphFrame> {
  const edges = graph.edges.length > 0 ? graph.edges : DEFAULT_GRAPH_EDGES;
  const nodes = Number.isInteger(graph.nodes) && graph.nodes > 0 ? graph.nodes : 6;
  const source = Math.max(0, Math.min(nodes - 1, Math.round(Number.isFinite(start) ? start : 0)));

  const adjacency: (readonly [number, number])[][] = Array.from({ length: nodes }, () => []);
  for (const [from, to, weight] of edges) {
    if (from < 0 || from >= nodes || to < 0 || to >= nodes) continue;
    adjacency[from]!.push([to, weight]);
  }

  const dist: number[] = Array.from({ length: nodes }, () => Infinity);
  const prev: (number | null)[] = Array.from({ length: nodes }, () => null);
  const settled = new Set<number>();
  const frames: GraphFrame[] = [];
  dist[source] = 0;

  for (let round = 0; round < nodes; round += 1) {
    let active = -1;
    for (let node = 0; node < nodes; node += 1) {
      if (settled.has(node) || dist[node] === Infinity) continue;
      if (active < 0 || dist[node]! < dist[active]!) active = node;
    }
    if (active < 0) break;
    settled.add(active);
    for (const [to, weight] of adjacency[active]!) {
      if (settled.has(to)) continue;
      const candidate = dist[active]! + weight;
      if (candidate < dist[to]!) {
        dist[to] = candidate;
        prev[to] = active;
        frames.push({
          dist: [...dist],
          prev: [...prev],
          active,
          relaxed: to,
          visited: [...settled].sort((a, b) => a - b),
        });
      }
    }
  }

  return {
    frames,
    summary: `Dijkstra 从 ${source} 出发 · ${frames.length} 次松弛 · 最短路 ${dist.map(value => (value === Infinity ? '∞' : value)).join(',')}`,
  };
}

const DEFAULT_CACHE_ACCESS = '0x0, 0x40, 0x80, 0x0, 0x1000, 0x1040, 0x2000, 0x0';

/** 解析逗号/空格/顿号分隔的地址串，支持 `0x` 前缀，纯十六进制数字按 16 进制处理。 */
export function parseHexList(text: string): number[] {
  return (text ?? '')
    .split(/[\s,，、;；]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
    .map(token => {
      if (/^0x/i.test(token)) return Number.parseInt(token.slice(2), 16);
      if (/^[0-9a-f]+$/i.test(token) && /[a-f]/i.test(token)) return Number.parseInt(token, 16);
      return Number.parseInt(token, 10);
    })
    .filter(value => Number.isInteger(value) && value >= 0);
}

export interface CacheLineState {
  tag: number;
  valid: boolean;
  lru: number;
}

export interface CacheFrame {
  addrHex: string;
  tag: number;
  index: number;
  offset: number;
  hit: boolean;
  way: number | null;
  evictedWay: number | null;
  sets: CacheLineState[][];
  hits: number;
  misses: number;
}

const MAX_CACHE_LINES = 65536;

export function cacheTraceFrames(
  addrBits: number,
  blockBytes: number,
  cacheKB: number,
  ways: number,
  accessHexList: string,
): FramePlayer<CacheFrame> {
  const split = cacheSplit(addrBits, blockBytes, cacheKB, ways);
  if (!split.valid) return { frames: [], summary: split.message };
  if (split.sets * ways > MAX_CACHE_LINES) {
    return { frames: [], summary: `Cache 行数 ${split.sets * ways} 超出演示上限 ${MAX_CACHE_LINES}` };
  }

  const parsed = parseHexList(accessHexList);
  const addresses = parsed.length > 0 ? parsed : parseHexList(DEFAULT_CACHE_ACCESS);
  const sets: CacheLineState[][] = Array.from({ length: split.sets }, () =>
    Array.from({ length: ways }, () => ({ tag: 0, valid: false, lru: 0 })));
  const frames: CacheFrame[] = [];
  let hits = 0;
  let misses = 0;
  let clock = 0;

  for (const address of addresses) {
    const setIndex = Math.floor(address / 2 ** split.offset) % split.sets;
    const tagValue = Math.floor(address / 2 ** (split.offset + split.index));
    const set = sets[setIndex]!;
    clock += 1;

    let way = set.findIndex(line => line.valid && line.tag === tagValue);
    const hit = way >= 0;
    let evictedWay: number | null = null;

    if (hit) {
      hits += 1;
      set[way]!.lru = clock;
    } else {
      misses += 1;
      const emptyWay = set.findIndex(line => !line.valid);
      if (emptyWay >= 0) {
        way = emptyWay;
      } else {
        way = 0;
        for (let slot = 1; slot < set.length; slot += 1) {
          if (set[slot]!.lru < set[way]!.lru) way = slot;
        }
        evictedWay = way;
      }
      set[way] = { tag: tagValue, valid: true, lru: clock };
    }

    frames.push({
      addrHex: `0x${address.toString(16)}`,
      tag: split.tag,
      index: split.index,
      offset: split.offset,
      hit,
      way,
      evictedWay,
      sets: sets.map(group => group.map(line => ({ ...line }))),
      hits,
      misses,
    });
  }

  return { frames, summary: `拓扑 ${split.tag}+${split.index}+${split.offset} 位 · 命中 ${hits} / 缺失 ${misses}` };
}

export type IeeeCategory = 'normal' | 'denorm' | 'inf' | 'nan' | 'zero';

export interface Ieee754Result {
  bits: number;
  signBit: number;
  expBits: number;
  mantissaBits: number;
  biasExp: number;
  category: IeeeCategory;
  actualValue: number;
  error: number | null;
}

function zeroIeeeResult(width: 32 | 64): Ieee754Result {
  const bias = width === 32 ? 127 : 1023;
  return { bits: 0, signBit: 0, expBits: 0, mantissaBits: 0, biasExp: 1 - bias, category: 'zero', actualValue: 0, error: null };
}

export function ieee754Decode(valueOrExpr: string, bits?: 32 | 64): Ieee754Result {
  const text = (valueOrExpr ?? '').trim();
  const isHex = /^0x/i.test(text);
  const hexDigits = isHex ? text.slice(2).replace(/^0+(?=.)/, '') : '';
  const width: 32 | 64 = bits === 32 || bits === 64 ? bits : hexDigits.length > 8 ? 64 : 32;
  const bias = width === 32 ? 127 : 1023;
  const exponentMax = width === 32 ? 0xff : 0x7ff;
  const mantissaMask = width === 32 ? 0x7fffffn : 0xfffffffffffffn;
  const rawMask = width === 32 ? 0xffffffffn : 0xffffffffffffffffn;
  const exponentShift = BigInt(width === 32 ? 23 : 52);
  const signShift = BigInt(width - 1);

  const view = new DataView(new ArrayBuffer(8));
  let raw: bigint;
  let inputValue: number | null = null;

  if (isHex) {
    if (!/^[0-9a-f]+$/i.test(hexDigits)) return zeroIeeeResult(width);
    raw = BigInt(`0x${hexDigits}`) & rawMask;
  } else {
    const numeric = Number(text);
    if (text.length === 0 || Number.isNaN(numeric)) return zeroIeeeResult(width);
    inputValue = numeric;
    if (width === 32) {
      view.setFloat32(0, numeric, false);
      raw = BigInt(view.getUint32(0, false));
    } else {
      view.setFloat64(0, numeric, false);
      raw = view.getBigUint64(0, false);
    }
  }

  const signBit = Number((raw >> signShift) & 1n);
  const expBits = Number((raw >> exponentShift) & BigInt(exponentMax));
  const mantissaBits = Number(raw & mantissaMask);

  let category: IeeeCategory;
  if (expBits === 0) category = mantissaBits === 0 ? 'zero' : 'denorm';
  else if (expBits === exponentMax) category = mantissaBits === 0 ? 'inf' : 'nan';
  else category = 'normal';

  let actualValue: number;
  if (width === 32) {
    view.setUint32(0, Number(raw), false);
    actualValue = view.getFloat32(0, false);
  } else {
    view.setBigUint64(0, raw, false);
    actualValue = view.getFloat64(0, false);
  }

  const biasExp = category === 'denorm' || category === 'zero' ? 1 - bias : expBits - bias;
  let error: number | null;
  if (inputValue === null) error = category === 'inf' || category === 'nan' ? null : 0;
  else if (Number.isNaN(actualValue)) error = null;
  else error = inputValue - actualValue;

  return {
    bits: Number(raw),
    signBit,
    expBits,
    mantissaBits,
    biasExp,
    category,
    actualValue,
    error,
  };
}

const PIPELINE_STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
const DEFAULT_PIPELINE_INSTRUCTIONS: readonly string[] = ['ADD R1,R2,R3', 'SUB R4,R1,R5', 'LW R6,0(R7)', 'ADD R8,R6,R9'];

export interface PipelineConflict {
  a: number;
  b: number;
  register: string;
}

export interface PipelineFrame {
  cycle: number;
  stages: (string | null)[][];
  conflicts: PipelineConflict[];
  stalls: { instruction: number; cycle: number }[];
  drains: number;
}

interface DecodedInstruction {
  dest: string | null;
  sources: string[];
  load: boolean;
}

const LOAD_PATTERN = /^(LW|LD|LB|LH|LOAD)\b/;

function decodeInstruction(line: string): DecodedInstruction {
  const op = (line.trim().split(/[\s,]+/)[0] ?? '').toUpperCase();
  const registers = (line.match(/[Rr]\d+/g) ?? []).map(register => register.toUpperCase());
  const isStore = /^(SW|ST|STORE|SD|SB)\b/.test(op);
  return {
    dest: isStore ? null : registers[0] ?? null,
    sources: registers.slice(1),
    load: LOAD_PATTERN.test(op),
  };
}

/** 按行/分号拆分指令串，空输入回退到内置 4 条示例。 */
export function parseInstructionList(text: string): string[] {
  const list = (text ?? '')
    .split(/[\n;；]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  return list.length > 0 ? list : [...DEFAULT_PIPELINE_INSTRUCTIONS];
}

export function pipelineFrames(instructions: readonly string[], forwarding: boolean): FramePlayer<PipelineFrame> {
  const list = instructions.length > 0 ? instructions : [...DEFAULT_PIPELINE_INSTRUCTIONS];
  const decoded = list.map(decodeInstruction);
  const count = list.length;

  const startOf: number[] = [];
  const idOf: number[] = [];
  const stalls: { instruction: number; cycle: number }[] = [];
  const conflicts: PipelineConflict[] = [];

  for (let index = 0; index < count; index += 1) {
    startOf[index] = index + 1;
    const baseline = index > 0
      ? Math.max(startOf[index]! + 1, idOf[index - 1]! + 1)
      : startOf[index]! + 1;
    let idCycle = baseline;

    let changed = true;
    while (changed) {
      changed = false;
      for (let producer = 0; producer < index; producer += 1) {
        const written = decoded[producer]!.dest;
        if (!written || !decoded[index]!.sources.includes(written)) continue;
        if (!forwarding && !conflicts.some(item => item.a === producer && item.b === index && item.register === written)) {
          conflicts.push({ a: producer, b: index, register: written });
        }
        const producerLoad = decoded[producer]!.load;
        // 无转发：消费者 ID 必须晚于生产者 WB（ID+3）；有转发：ALU 结果 EX 后可转发（ID+1），
        // load 结果要到 MEM 才可用（ID+2，load-use 停顿一周期）。
        const needed = forwarding
          ? idOf[producer]! + (producerLoad ? 2 : 1)
          : idOf[producer]! + 3;
        if (idCycle < needed) {
          idCycle = needed;
          changed = true;
        }
      }
    }

    if (idCycle > baseline) stalls.push({ instruction: index, cycle: idCycle });
    idOf[index] = idCycle;
  }

  const lastCycle = idOf[count - 1]! + 3;
  const stages: (string | null)[][] = Array.from({ length: lastCycle + 1 }, () =>
    Array.from({ length: count }, () => null));
  for (let index = 0; index < count; index += 1) {
    // IF 按序每周期取一条；停顿只推迟 ID 及其后续阶段，IF 与 ID 之间留出空拍。
    stages[startOf[index]!]![index] = PIPELINE_STAGES[0];
    const idCycle = idOf[index]!;
    for (let offset = 1; offset < PIPELINE_STAGES.length; offset += 1) {
      stages[idCycle + offset - 1]![index] = PIPELINE_STAGES[offset]!;
    }
  }

  const frames: PipelineFrame[] = Array.from({ length: lastCycle }, (_, offset) => ({
    cycle: offset + 1,
    stages,
    conflicts,
    stalls,
    drains: lastCycle - count,
  }));

  return {
    frames,
    summary: `5 级流水线（${forwarding ? '含转发' : '无转发'}）· ${count} 条指令 · ${lastCycle} 周期 · 停顿 ${stalls.length}`,
  };
}

export * from './lab408SimOsNet.ts';
