/** 工坊 408 模块的确定性小内核（纯函数，画布与测试共用）。 */

export const TRAVERSAL_LABELS = ['先序', '中序', '后序', '层序'] as const;

export interface TreeNodeVisual {
  id: string;
  x: number;
  y: number;
}

export const TREE_VISUALS: readonly TreeNodeVisual[] = [
  { id: 'A', x: 100, y: 22 },
  { id: 'B', x: 58, y: 58 },
  { id: 'C', x: 142, y: 58 },
  { id: 'D', x: 34, y: 94 },
  { id: 'E', x: 82, y: 94 },
  { id: 'F', x: 164, y: 94 },
];

export const TREE_EDGES: readonly (readonly [string, string])[] = [
  ['A', 'B'], ['A', 'C'], ['B', 'D'], ['B', 'E'], ['C', 'F'],
];

const LEFT: Record<string, string | undefined> = { A: 'B', B: 'D', C: undefined, D: undefined, E: undefined, F: undefined };
const RIGHT: Record<string, string | undefined> = { A: 'C', B: 'E', C: 'F', D: undefined, E: undefined, F: undefined };

function walk(id: string, order: number, out: string[]): void {
  if (order === 0) out.push(id);
  const left = LEFT[id];
  if (left) walk(left, order, out);
  if (order === 1) out.push(id);
  const right = RIGHT[id];
  if (right) walk(right, order, out);
  if (order === 2) out.push(id);
}

export function treeTraversal(order: number): string[] {
  const kind = Math.max(0, Math.min(3, Math.round(order)));
  if (kind !== 3) {
    const out: string[] = [];
    walk('A', kind, out);
    return out;
  }
  const out: string[] = [];
  const queue = ['A'];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    const left = LEFT[id];
    if (left) queue.push(left);
    const right = RIGHT[id];
    if (right) queue.push(right);
  }
  return out;
}

export interface CacheSplitResult {
  valid: boolean;
  message: string;
  offset: number;
  index: number;
  tag: number;
  blocks: number;
  sets: number;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function cacheSplit(addrBits: number, blockBytes: number, cacheKB: number, ways: number): CacheSplitResult {
  const empty: CacheSplitResult = { valid: false, message: '', offset: 0, index: 0, tag: 0, blocks: 0, sets: 0 };
  if (!Number.isInteger(addrBits) || addrBits < 8 || addrBits > 64) return { ...empty, message: '地址位数需为 8～64 的整数' };
  if (!isPowerOfTwo(blockBytes) || blockBytes < 8 || blockBytes > 1024) return { ...empty, message: '块大小需为 8～1024 的 2 的幂' };
  if (!isPowerOfTwo(cacheKB) || cacheKB < 1 || cacheKB > 4096) return { ...empty, message: 'Cache 容量需为 1～4096 KB 的 2 的幂' };
  if (!isPowerOfTwo(ways) || ways < 1 || ways > 16) return { ...empty, message: '相联路数需为 1～16 的 2 的幂' };
  const blocks = cacheKB * 1024 / blockBytes;
  if (!Number.isInteger(blocks) || !isPowerOfTwo(blocks)) return { ...empty, message: '块数不是 2 的幂，请调整容量或块大小' };
  const sets = blocks / ways;
  if (!Number.isInteger(sets) || !isPowerOfTwo(sets)) return { ...empty, message: '组数不是 2 的幂，请调整路数' };
  const offset = Math.round(Math.log2(blockBytes));
  const index = Math.round(Math.log2(sets));
  const tag = addrBits - offset - index;
  if (tag < 0) return { ...empty, message: 'tag 位数为负：地址位数不足以覆盖 index 与 offset' };
  return { valid: true, message: '', offset, index, tag, blocks, sets };
}

export const PAGE_REFERENCE: readonly number[] = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
export const PAGE_ALGORITHMS = ['FIFO', 'LRU', 'OPT'] as const;

export interface PageStep {
  page: number;
  frames: (number | null)[];
  fault: boolean;
  evicted: number | null;
}

export interface PageSimulation {
  steps: PageStep[];
  faults: number;
  hits: number;
  rate: number;
}

/** 解析逗号/空格/顿号分隔的页面访问序列；空输入回退到内置示例。 */
export function parseReference(text: string | undefined): number[] {
  const values = (text ?? '')
    .split(/[\s,，、;；]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return values.length ? values.slice(0, 60) : [...PAGE_REFERENCE];
}

export function pageReplacement(algorithm: number, capacity: number, reference: readonly number[] = PAGE_REFERENCE): PageSimulation {
  const refs = reference.length ? reference : PAGE_REFERENCE;
  const cap = Math.max(1, Math.min(4, Math.round(capacity)));
  const kind = algorithm === 1 ? 1 : algorithm === 2 ? 2 : 0;
  const frames: (number | null)[] = Array.from({ length: cap }, () => null);
  const loadedAt: number[] = Array.from({ length: cap }, () => -1);
  const lastUsed: number[] = Array.from({ length: cap }, () => -1);
  const steps: PageStep[] = [];
  let faults = 0;

  refs.forEach((page, access) => {
    let slot = frames.indexOf(page);
    const fault = slot < 0;
    let evicted: number | null = null;
    if (!fault) {
      lastUsed[slot] = access;
    } else {
      faults += 1;
      slot = frames.indexOf(null);
      if (slot < 0) {
        if (kind === 0) {
          slot = 0;
          for (let s = 1; s < cap; s += 1) {
            if (loadedAt[s]! < loadedAt[slot]!) slot = s;
          }
        } else if (kind === 1) {
          slot = 0;
          for (let s = 1; s < cap; s += 1) {
            if (lastUsed[s]! < lastUsed[slot]!) slot = s;
          }
        } else {
          let farthest = -1;
          slot = 0;
          for (let s = 0; s < cap; s += 1) {
            const held = frames[s];
            const next = held === null ? -1 : refs.findIndex((value, index) => index > access && value === held);
            const distance = held === null ? Infinity : next < 0 ? Infinity : next;
            if (distance > farthest) {
              farthest = distance;
              slot = s;
            }
          }
        }
        evicted = frames[slot] ?? null;
      }
      frames[slot] = page;
      loadedAt[slot] = access;
      lastUsed[slot] = access;
    }
    steps.push({ page, frames: [...frames], fault, evicted });
  });

  const hits = refs.length - faults;
  return { steps, faults, hits, rate: faults / refs.length };
}

export interface SubnetResult {
  valid: boolean;
  message: string;
  prefix: number;
  count: number;
  index: number;
  mask: string;
  network: string;
  broadcast: string;
  first: string;
  last: string;
  hosts: number;
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
}

export function subnetInfo(prefix: number, index: number): SubnetResult {
  const p = Math.max(24, Math.min(30, Math.round(prefix)));
  const count = 2 ** (p - 24);
  const idx = Math.max(0, Math.min(count - 1, Math.round(index)));
  const base = ((192 * 256 + 168) * 256 + 1) * 256;
  const block = 2 ** (32 - p);
  const network = base + idx * block;
  const broadcast = network + block - 1;
  const maskInt = p === 32 ? 0xffffffff : (0xffffffff << (32 - p)) >>> 0;
  return {
    valid: true,
    message: '',
    prefix: p,
    count,
    index: idx,
    mask: intToIp(maskInt),
    network: intToIp(network),
    broadcast: intToIp(broadcast),
    first: intToIp(network + 1),
    last: intToIp(broadcast - 1),
    hosts: Math.max(0, block - 2),
  };
}
