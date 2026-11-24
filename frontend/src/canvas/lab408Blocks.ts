/** 408 可连线积木的确定性内核：数组、排序竞赛、图算法、地址流、TLB 与 Cache。 */

import type { PortValue } from './types.ts';
import { clampNumber } from './officeBlocks.ts';

export type AlgoData = Extract<PortValue, { kind: 'algoData' }>;
export type GraphEdge = { u: string; v: string; w: number };
export type GraphData = { nodes: string[]; edges: GraphEdge[] };

const MAX_VALUES = 60;
const MAX_EDGES = 40;

export function parseNumberArray(text: string): number[] {
  const tokens = String(text ?? '').split(/[\s,，、;；]+/).filter(Boolean);
  if (!tokens.length) throw new Error('请输入至少一个数值');
  if (tokens.length > 120) throw new Error('数值超过 120 个，请先缩短序列');
  return tokens.map((token) => {
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`无法解析数值「${token}」`);
    return value;
  });
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function arrayFromParams(params: Record<string, number>, text = ''): AlgoData {
  const mode = Math.round(clampNumber(params.mode ?? 0, 0, 0, 3));
  const length = Math.round(clampNumber(params.length ?? 12, 12, 4, 40));
  const seed = Math.round(Number.isFinite(params.seed ?? Number.NaN) ? params.seed! : 7);
  let values: number[];
  if (mode === 3) {
    if (!text.trim()) throw new Error('手动数组模式需要输入至少一个数值');
    values = parseNumberArray(text);
  } else if (mode === 1) values = Array.from({ length }, (_, index) => index + 1);
  else if (mode === 2) values = Array.from({ length }, (_, index) => length - index);
  else {
    const random = mulberry32(seed);
    values = Array.from({ length }, () => 1 + Math.round(random() * 98));
  }
  values = values.slice(0, MAX_VALUES).map((value) => Math.round(value));
  return { kind: 'algoData', mode: 'array', values };
}

export interface SortRace {
  name: string;
  comparisons: number;
  swaps: number;
  steps: number[];
}

function record(steps: number[], comparisons: number, swaps: number): void {
  if (steps.length < 160) steps.push(comparisons + swaps);
}

export function sortRace(values: readonly number[]): SortRace[] {
  const input = values.slice(0, 40).map((value) => Math.round(value));
  return [quickRace(input), mergeRace(input), heapRace(input)];
}

function quickRace(input: number[]): SortRace {
  const data = [...input];
  let comparisons = 0;
  let swaps = 0;
  const steps: number[] = [];
  const swap = (left: number, right: number): void => {
    if (left === right) return;
    const value = data[left]!;
    data[left] = data[right]!;
    data[right] = value;
    swaps += 1;
    record(steps, comparisons, swaps);
  };
  const sort = (low: number, high: number): void => {
    if (low >= high) return;
    const pivot = data[high]!;
    let store = low;
    for (let index = low; index < high; index += 1) {
      comparisons += 1;
      record(steps, comparisons, swaps);
      if (data[index]! <= pivot) {
        swap(store, index);
        store += 1;
      }
    }
    swap(store, high);
    sort(low, store - 1);
    sort(store + 1, high);
  };
  sort(0, data.length - 1);
  return { name: '快速排序', comparisons, swaps, steps };
}

function mergeRace(input: number[]): SortRace {
  const data = [...input];
  let comparisons = 0;
  let writes = 0;
  const steps: number[] = [];
  const sort = (left: number, right: number): void => {
    if (right - left <= 0) return;
    const middle = Math.floor((left + right) / 2);
    sort(left, middle);
    sort(middle + 1, right);
    const merged: number[] = [];
    let i = left;
    let j = middle + 1;
    while (i <= middle && j <= right) {
      comparisons += 1;
      if (data[i]! <= data[j]!) merged.push(data[i++]!);
      else merged.push(data[j++]!);
      writes += 1;
      record(steps, comparisons, writes);
    }
    while (i <= middle) { merged.push(data[i++]!); writes += 1; record(steps, comparisons, writes); }
    while (j <= right) { merged.push(data[j++]!); writes += 1; record(steps, comparisons, writes); }
    for (let index = 0; index < merged.length; index += 1) data[left + index] = merged[index]!;
  };
  sort(0, data.length - 1);
  return { name: '归并排序', comparisons, swaps: writes, steps };
}

function heapRace(input: number[]): SortRace {
  const data = [...input];
  let comparisons = 0;
  let swaps = 0;
  const steps: number[] = [];
  const swap = (left: number, right: number): void => {
    if (left === right) return;
    const value = data[left]!;
    data[left] = data[right]!;
    data[right] = value;
    swaps += 1;
    record(steps, comparisons, swaps);
  };
  const sift = (root: number, end: number): void => {
    let parent = root;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let largest = parent;
      if (left <= end) { comparisons += 1; if (data[left]! > data[largest]!) largest = left; }
      if (right <= end) { comparisons += 1; if (data[right]! > data[largest]!) largest = right; }
      record(steps, comparisons, swaps);
      if (largest === parent) return;
      swap(parent, largest);
      parent = largest;
    }
  };
  for (let index = Math.floor(data.length / 2) - 1; index >= 0; index -= 1) sift(index, data.length - 1);
  for (let end = data.length - 1; end > 0; end -= 1) {
    swap(0, end);
    sift(0, end - 1);
  }
  return { name: '堆排序', comparisons, swaps, steps };
}

export const DEFAULT_GRAPH_TEXT = 'A B 4\nA C 2\nB C 1\nB D 5\nC D 8\nC E 10\nD E 2\nE F 3';

export function parseGraph(text: string): GraphData {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请输入至少一条边，例如 A B 4');
  const edges: GraphEdge[] = [];
  const labels = new Set<string>();
  for (const line of lines) {
    const cells = line.split(/[\s,，;；]+/).filter(Boolean);
    if (cells.length < 2) throw new Error(`边格式不完整：${line}`);
    const u = cells[0]!;
    const v = cells[1]!;
    const weight = cells[2] === undefined ? 1 : Number(cells[2]);
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`边权必须是非负有限数：${line}`);
    if (u === v) continue;
    labels.add(u);
    labels.add(v);
    edges.push({ u, v, w: weight });
    if (edges.length >= MAX_EDGES) break;
  }
  if (!edges.length) throw new Error('没有有效边');
  return { edges, nodes: [...labels].sort() };
}

export function graphFromText(text: string): AlgoData {
  const graph = parseGraph(text.trim() ? text : DEFAULT_GRAPH_TEXT);
  return { kind: 'algoData', mode: 'graph', edges: graph.edges };
}

export function graphOf(data: AlgoData | null): GraphData | null {
  if (!data || data.mode !== 'graph' || !data.edges?.length) return null;
  const labels = new Set<string>();
  for (const edge of data.edges) { labels.add(edge.u); labels.add(edge.v); }
  return { edges: data.edges, nodes: [...labels].sort() };
}

export interface ShortestStep {
  current: string | null;
  visited: string[];
  distances: Record<string, number>;
  active: string[];
  note: string;
}

export interface ShortestResult {
  algorithm: 'dijkstra' | 'prim';
  distances: Record<string, number>;
  order: string[];
  edges: GraphEdge[];
  frames: ShortestStep[];
  totalWeight: number;
}

function makeEdgeKey(edge: GraphEdge): string {
  return `${edge.u}-${edge.v}-${edge.w}`;
}

export function dijkstraSteps(graph: GraphData, source: string): ShortestResult {
  const distances: Record<string, number> = Object.fromEntries(graph.nodes.map((node) => [node, Number.POSITIVE_INFINITY]));
  if (!graph.nodes.includes(source)) source = graph.nodes[0] ?? '';
  if (source) distances[source] = 0;
  const visited = new Set<string>();
  const order: string[] = [];
  const frames: ShortestStep[] = [];
  while (visited.size < graph.nodes.length) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const node of graph.nodes) {
      if (!visited.has(node) && (distances[node] ?? Number.POSITIVE_INFINITY) < best) {
        best = distances[node] ?? Number.POSITIVE_INFINITY;
        current = node;
      }
    }
    if (!current) break;
    visited.add(current);
    order.push(current);
    const active: string[] = [];
    for (const edge of graph.edges) {
      if (edge.u === current && !visited.has(edge.v)) {
        const candidate = (distances[current] ?? 0) + edge.w;
        if (candidate < (distances[edge.v] ?? Number.POSITIVE_INFINITY)) {
          distances[edge.v] = candidate;
          active.push(makeEdgeKey(edge));
        }
      } else if (edge.v === current && !visited.has(edge.u)) {
        const candidate = (distances[current] ?? 0) + edge.w;
        if (candidate < (distances[edge.u] ?? Number.POSITIVE_INFINITY)) {
          distances[edge.u] = candidate;
          active.push(makeEdgeKey(edge));
        }
      }
    }
    frames.push({ current, visited: [...visited], distances: { ...distances }, active, note: `确定 ${current} 的最短距离` });
    if (frames.length > 80) break;
  }
  return { algorithm: 'dijkstra', distances, order, edges: [], frames, totalWeight: 0 };
}

export function primSteps(graph: GraphData, source: string): ShortestResult {
  if (!graph.nodes.includes(source)) source = graph.nodes[0] ?? '';
  const visited = new Set<string>(source ? [source] : []);
  const order = source ? [source] : [];
  const edges: GraphEdge[] = [];
  const frames: ShortestStep[] = [];
  let totalWeight = 0;
  while (visited.size < graph.nodes.length) {
    let best: GraphEdge | null = null;
    for (const edge of graph.edges) {
      const uIn = visited.has(edge.u);
      const vIn = visited.has(edge.v);
      if (uIn === vIn) continue;
      if (!best || edge.w < best.w) best = edge;
    }
    if (!best) break;
    edges.push(best);
    totalWeight += best.w;
    const added = visited.has(best.u) ? best.v : best.u;
    visited.add(added);
    order.push(added);
    frames.push({
      current: added, visited: [...visited],
      distances: Object.fromEntries([...visited].map((node) => [node, 0])),
      active: [makeEdgeKey(best)],
      note: `接入 ${added}，边权 ${best.w}`,
    });
    if (frames.length > 80) break;
  }
  return { algorithm: 'prim', distances: {}, order, edges, frames, totalWeight };
}

export function shortestPathSteps(graph: GraphData, algorithm: number, source: string): ShortestResult {
  return Math.round(algorithm) === 1 ? primSteps(graph, source) : dijkstraSteps(graph, source);
}

export function memoryAddressStream(params: Record<string, number>, text = ''): AlgoData {
  const count = Math.round(clampNumber(params.count ?? 16, 16, 1, 60));
  if (Math.round(params.mode ?? 0) === 1) {
    if (!text.trim()) throw new Error('手动地址模式需要输入至少一个地址');
    const values = parseNumberArray(text).slice(0, MAX_VALUES);
    return { kind: 'algoData', mode: 'addrStream', addresses: values.map((value) => Math.max(0, Math.round(value))) };
  }
  const base = Math.round(clampNumber(params.base ?? 4096, 4096, 0, 0x7fffffff));
  const stride = Math.round(clampNumber(params.stride ?? 96, 96, 1, 65536));
  const seed = Math.round(Number.isFinite(params.seed ?? Number.NaN) ? params.seed! : 7);
  const random = mulberry32(seed);
  const addresses = Array.from({ length: count }, (_, index) =>
    base + index * stride + Math.round(random() * Math.max(8, stride)));
  return { kind: 'algoData', mode: 'addrStream', addresses: addresses.map((value) => Math.max(0, Math.round(value))) };
}

export interface AddrTranslateConfig {
  pageSize: number;
  tlbEntries: number;
  policy: number;
}

export interface AddrTranslateRow {
  address: number;
  vpn: number;
  offset: number;
  pfn: number;
  physical: number;
  tlbHit: boolean;
  pageWalk: boolean;
  tlbIndex: number;
}

export interface AddrTranslateResult {
  rows: AddrTranslateRow[];
  tlbHits: number;
  pageWalks: number;
  tlb: number[];
}

function powerOfTwo(value: number, fallback: number, min: number, max: number): number {
  const clamped = Math.round(clampNumber(value, fallback, min, max));
  let result = 1;
  while (result * 2 <= clamped) result *= 2;
  return Math.max(min, Math.min(max, result));
}

export function translateAddresses(addresses: readonly number[], config: Partial<AddrTranslateConfig>): AddrTranslateResult {
  const pageSize = powerOfTwo(config.pageSize ?? 256, 256, 64, 8192);
  const tlbEntries = Math.round(clampNumber(config.tlbEntries ?? 4, 4, 1, 8));
  const policy = Math.round(clampNumber(config.policy ?? 0, 0, 0, 1));
  const tlb: number[] = [];
  let tlbHits = 0;
  let pageWalks = 0;
  const rows = addresses.slice(0, MAX_VALUES).map((raw) => {
    const address = Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
    const vpn = Math.floor(address / pageSize);
    const offset = address % pageSize;
    const pfn = (vpn * 17 + 5) % 1024;
    const physical = pfn * pageSize + offset;
    const hitIndex = tlb.indexOf(vpn);
    if (hitIndex >= 0) {
      tlbHits += 1;
      if (policy === 1) {
        tlb.splice(hitIndex, 1);
        tlb.push(vpn);
      }
    } else {
      pageWalks += 1;
      tlb.push(vpn);
      if (tlb.length > tlbEntries) tlb.shift();
    }
    return {
      address, vpn, offset, pfn, physical,
      tlbHit: hitIndex >= 0,
      pageWalk: hitIndex < 0,
      tlbIndex: tlb.indexOf(vpn),
    };
  });
  return { rows, tlbHits, pageWalks, tlb: [...tlb] };
}

export interface CacheConfig {
  blockBytes: number;
  cacheKB: number;
  ways: number;
  policy: number;
}

export interface CacheRow {
  address: number;
  tag: number;
  index: number;
  offset: number;
  hit: boolean;
  evictedTag: number | null;
}

export interface CacheResult {
  rows: CacheRow[];
  hits: number;
  misses: number;
  hitRate: number;
  sets: number;
  blocks: number;
  ways: number;
}

export function cacheMap(addresses: readonly number[], config: Partial<CacheConfig>): CacheResult {
  const blockBytes = powerOfTwo(config.blockBytes ?? 64, 64, 8, 1024);
  const cacheKB = powerOfTwo(config.cacheKB ?? 4, 4, 1, 1024);
  const ways = powerOfTwo(config.ways ?? 2, 2, 1, 16);
  const policy = Math.round(clampNumber(config.policy ?? 0, 0, 0, 1));
  const blocks = Math.max(ways, Math.floor(cacheKB * 1024 / blockBytes));
  const sets = Math.max(1, Math.floor(blocks / ways));
  const slots: { tag: number; last: number }[][] = Array.from({ length: sets }, () => []);
  let tick = 0;
  let hits = 0;
  let misses = 0;
  const rows = addresses.slice(0, MAX_VALUES).map((raw) => {
    const address = Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
    const block = Math.floor(address / blockBytes);
    const offset = address % blockBytes;
    const index = block % sets;
    const tag = Math.floor(block / sets);
    const set = slots[index]!;
    const hit = set.find((entry) => entry.tag === tag);
    tick += 1;
    if (hit) {
      hits += 1;
      if (policy === 1) hit.last = tick;
      return { address, tag, index, offset, hit: true, evictedTag: null };
    }
    misses += 1;
    let evictedTag: number | null = null;
    if (set.length < ways) {
      set.push({ tag, last: tick });
    } else {
      const victim = set.reduce((oldest, entry) => entry.last < oldest.last ? entry : oldest, set[0]!);
      evictedTag = victim.tag;
      victim.tag = tag;
      victim.last = tick;
    }
    return { address, tag, index, offset, hit: false, evictedTag };
  });
  return { rows, hits, misses, hitRate: rows.length ? hits / rows.length : 0, sets, blocks, ways };
}

export function graphStepCount(result: ShortestResult): number {
  return Math.max(1, result.frames.length);
}
