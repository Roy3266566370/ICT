/** AI 规则方块的隔离执行沙箱：Blob Worker、300ms 熔断与输出清洗。 */

import type { FrameGrid, FrameShape, FrameShapes, PipelineFrame, PipelineResult } from './lab408PipelineTypes.ts';

export const RULE_TIMEOUT_MS = 300;
export const MAX_RULE_FRAMES = 200;
export const MAX_RULE_ROWS = 200;
export const MAX_RULE_GRAPH_NODES = 120;

export class RuleSandboxError extends Error {
  readonly code: 'timeout' | 'runtime' | 'unavailable' | 'output';

  constructor(code: RuleSandboxError['code'], message: string) {
    super(message);
    this.name = 'RuleSandboxError';
    this.code = code;
  }
}

export interface RuleWorkerSource {
  type: 'run';
  code: string;
  input: { text: string; params: Record<string, number>; upstream: Record<string, unknown>[] };
  nonce: string;
}

interface SandboxWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface RuleSandboxOptions {
  timeoutMs?: number;
  workerFactory?: (source: string) => SandboxWorkerLike;
}

const SHADOWED_API = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'navigator', 'location',
  'indexedDB', 'BroadcastChannel', 'localStorage', 'sessionStorage', 'document', 'window', 'parent',
  'top', 'self', 'globalThis', 'postMessage', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'Function', 'Deno', 'process', 'performance', 'crypto',
];

const WORKER_PARAMS = `'input', 'Math', ${SHADOWED_API.map((name) => `'${name}'`).join(', ')}`;

const HARDENED_GLOBALS = [
  ...SHADOWED_API.filter((name) => name !== 'self' && name !== 'globalThis'),
  'eval', 'Date', 'Worker', 'SharedWorker', 'MessageChannel', 'MessagePort', 'WebTransport', 'caches',
];

export const RULE_WORKER_SOURCE = String.raw`
'use strict';
var __post = self.postMessage.bind(self);
var __now = self.performance && typeof self.performance.now === 'function'
  ? self.performance.now.bind(self.performance)
  : Date.now.bind(Date);
var __compile = Function;
${JSON.stringify(HARDENED_GLOBALS)}.forEach(function (name) {
  try {
    Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
  } catch (error) {
    try { self[name] = undefined; } catch (ignored) {}
  }
});
try { Object.defineProperty(Math, 'random', { value: undefined, writable: false, configurable: false }); } catch (error) {}
self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'run') return;
  try {
    var started = __now();
    var safeMath = {};
    Object.getOwnPropertyNames(Math).forEach(function (key) {
      if (key === 'random') return;
      var value = Math[key];
      safeMath[key] = typeof value === 'function' ? value.bind(Math) : value;
    });
    Object.freeze(safeMath);
    function deny(name) {
      return function () { throw new Error('沙箱禁止访问 ' + name); };
    }
    var denied = new Proxy({}, {
      get: function (target, property) { throw new Error('沙箱禁止访问 ' + String(property)); },
      set: function (target, property) { throw new Error('沙箱禁止修改 ' + String(property)); }
    });
    var runner = new __compile(
      ${WORKER_PARAMS},
      '"use strict";\n' + data.code + '\nreturn run(input);'
    );
    var seed = data.input.params && data.input.params.seed;
    seed = Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 42;
    function rand() {
      seed = (seed + 0x6D2B79F5) >>> 0;
      var value = Math.imul(seed ^ (seed >>> 15), seed | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
    var output = runner(
      { ...data.input, rand: rand },
      safeMath,
      deny('fetch'), deny('XMLHttpRequest'), deny('WebSocket'), deny('EventSource'),
      deny('importScripts'), denied, denied, denied, denied, denied, denied, denied, denied,
      denied, denied, denied, denied, denied, denied, deny('postMessage'), deny('setTimeout'),
      deny('setInterval'), deny('queueMicrotask'), deny('requestAnimationFrame'), deny('Function'),
      denied, denied, deny('performance'), deny('crypto')
    );
    if (output && typeof output.then === 'function') throw new Error('规则必须是同步计算，不能返回 Promise');
    if (!output || typeof output !== 'object' || !Array.isArray(output.frames)) {
      throw new Error('run 必须返回 { data, frames }');
    }
    __post({ type: 'result', nonce: data.nonce, output: output, elapsedMs: __now() - started });
  } catch (error) {
    __post({ type: 'error', nonce: data.nonce, message: String((error && error.message) || error) });
  }
};
`;

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clipText(value: unknown, limit: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, limit) : fallback;
}

function sanitizeCell(value: unknown): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '—';
  if (typeof value === 'string') return value.slice(0, 400);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return '—';
}

const SAFE_COLOR_NAMES = new Set([
  'none', 'transparent', 'black', 'white', 'gray', 'grey', 'red', 'orange', 'yellow', 'green',
  'blue', 'purple', 'pink', 'brown', 'cyan', 'magenta', 'navy', 'teal', 'lime', 'gold', 'silver',
  'maroon', 'olive', 'aqua', 'fuchsia', 'coral', 'indigo', 'tomato', 'steelblue', 'royalblue',
  'rebeccapurple', 'seagreen', 'slategray', 'lightgray', 'darkgray', 'skyblue', 'crimson',
]);
const COLOR_NUMBER = String.raw`[+-]?(?:\d{1,3}(?:\.\d{1,4})?|\.\d{1,4})%?`;
const RGB_COLOR = new RegExp(`^rgb\\(\\s*${COLOR_NUMBER}\\s*,\\s*${COLOR_NUMBER}\\s*,\\s*${COLOR_NUMBER}\\s*\\)$`);
const RGBA_COLOR = new RegExp(`^rgba\\(\\s*${COLOR_NUMBER}\\s*,\\s*${COLOR_NUMBER}\\s*,\\s*${COLOR_NUMBER}\\s*,\\s*${COLOR_NUMBER}\\s*\\)$`);
const MODERN_RGB_COLOR = new RegExp(`^rgba?\\(\\s*${COLOR_NUMBER}\\s+${COLOR_NUMBER}\\s+${COLOR_NUMBER}(?:\\s*\/\\s*${COLOR_NUMBER})?\\s*\\)$`);

function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const color = value.trim().toLowerCase();
  if (SAFE_COLOR_NAMES.has(color) || /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/.test(color)
      || RGB_COLOR.test(color) || RGBA_COLOR.test(color) || MODERN_RGB_COLOR.test(color)) return color;
  return undefined;
}

function bounded(value: unknown, min: number, max: number, fallback = 0): number {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function sanitizeShape(raw: unknown): FrameShape[] {
  const s = record(raw);
  const coord = (v: unknown) => bounded(v, -4000, 4000);
  const extent = (v: unknown) => bounded(v, 0, 4000);
  const fill = sanitizeColor(s.fill);
  const style = {
    stroke: sanitizeColor(s.stroke),
    strokeWidth: s.strokeWidth === undefined ? undefined : bounded(s.strokeWidth, 0, 40),
    opacity: s.opacity === undefined ? undefined : bounded(s.opacity, 0, 1, 1),
    label: clipText(s.label, 40) || undefined,
  };
  switch (s.kind) {
    case 'circle':
      return [{ ...style, kind: s.kind, cx: coord(s.cx), cy: coord(s.cy), r: extent(s.r), fill }];
    case 'rect':
      return [{ ...style, kind: s.kind, x: coord(s.x), y: coord(s.y), w: extent(s.w), h: extent(s.h), rx: extent(s.rx), fill }];
    case 'line':
    case 'arrow':
      return [{ ...style, kind: s.kind, x1: coord(s.x1), y1: coord(s.y1), x2: coord(s.x2), y2: coord(s.y2), dashed: s.kind === 'line' && s.dashed === true }];
    case 'polygon': {
      const points = Array.isArray(s.points) ? s.points.slice(0, 64).flatMap((p): [number, number][] =>
        Array.isArray(p) && p.length >= 2 ? [[coord(p[0]), coord(p[1])]] : []) : [];
      return points.length >= 3 ? [{ ...style, kind: s.kind, points, fill }] : [];
    }
    case 'text':
      return [{
        kind: s.kind, x: coord(s.x), y: coord(s.y), text: clipText(s.text, 80), fill,
        size: bounded(s.size, 6, 80, 14),
        anchor: s.anchor === 'middle' || s.anchor === 'end' ? s.anchor : 'start',
      }];
    default:
      return [];
  }
}

function sanitizeShapes(raw: unknown): FrameShapes | undefined {
  const { viewBox, items } = record(raw);
  if (!Array.isArray(items)) return undefined;
  const size = Array.isArray(viewBox) ? viewBox : [];
  return {
    viewBox: [bounded(size[0], 100, 1000, 400), bounded(size[1], 80, 800, 240)],
    items: items.slice(0, 160).flatMap(sanitizeShape),
  };
}

function sanitizeGrid(raw: unknown): FrameGrid | undefined {
  const grid = record(raw);
  if (!Array.isArray(grid.cells)) return undefined;
  const cells = Array.from(grid.cells.slice(0, 32), (row) =>
    Array.isArray(row) ? Array.from(row.slice(0, 32), (v) => finite(v)) : []);
  const columns = Math.max(0, ...cells.map((row) => row.length));
  const [r, c] = Array.isArray(grid.activeCell) ? grid.activeCell : [];
  return {
    cells,
    rowLabels: Array.isArray(grid.rowLabels) ? grid.rowLabels.slice(0, cells.length).map((label) => clipText(label, 40)) : undefined,
    colLabels: Array.isArray(grid.colLabels) ? grid.colLabels.slice(0, columns).map((label) => clipText(label, 40)) : undefined,
    min: Number.isFinite(grid.min) ? grid.min as number : undefined,
    max: Number.isFinite(grid.max) ? grid.max as number : undefined,
    palette: grid.palette === 'diverging' || grid.palette === 'binary' ? grid.palette : 'heat',
    showValues: typeof grid.showValues === 'boolean' ? grid.showValues : undefined,
    activeCell: Number.isInteger(r) && Number.isInteger(c) && c >= 0 && c < (cells[r]?.length ?? 0) ? [r, c] : undefined,
  };
}

function sanitizeFrame(raw: unknown, index: number): PipelineFrame {
  const frame = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const columns = Array.isArray(frame.columns)
    ? frame.columns.slice(0, 40).map((cell) => clipText(cell, 80))
    : undefined;
  const rows = Array.isArray(frame.rows)
    ? frame.rows.slice(0, MAX_RULE_ROWS).map((row) => Array.isArray(row) ? row.slice(0, 40).map(sanitizeCell) : [sanitizeCell(row)])
    : undefined;
  const series = Array.isArray(frame.series)
    ? frame.series.slice(0, 20).map((line) => {
      const item = line && typeof line === 'object' ? line as Record<string, unknown> : {};
      return {
        label: clipText(item.label, 80, '序列'),
        values: Array.isArray(item.values) ? item.values.slice(0, 400).map((value) => finite(value)) : [],
      };
    })
    : undefined;
  const timeline = Array.isArray(frame.timeline)
    ? frame.timeline.slice(0, 20).map((lane) => {
      const item = lane && typeof lane === 'object' ? lane as Record<string, unknown> : {};
      const segments = Array.isArray(item.segments) ? item.segments.slice(0, 100).flatMap((segment) => {
        if (!segment || typeof segment !== 'object') return [];
        const span = segment as Record<string, unknown>;
        const start = Math.max(0, finite(span.start));
        const end = Math.max(start, finite(span.end));
        return [{ label: clipText(span.label, 40), start, end }];
      }) : [];
      return { label: clipText(item.label, 40, '轨道'), segments };
    })
    : undefined;
  const graphRaw = frame.graph && typeof frame.graph === 'object' ? frame.graph as Record<string, unknown> : undefined;
  const graph = graphRaw ? {
    nodes: Array.isArray(graphRaw.nodes) ? graphRaw.nodes.slice(0, MAX_RULE_GRAPH_NODES).flatMap((node) => {
      if (!node || typeof node !== 'object') return [];
      const item = node as Record<string, unknown>;
      const id = clipText(item.id, 48);
      if (!id) return [];
      return [{
        id,
        label: clipText(item.label, 48, id),
        x: Math.max(-20, Math.min(120, finite(item.x))),
        y: Math.max(-20, Math.min(120, finite(item.y))),
        active: Boolean(item.active),
      }];
    }) : [],
    edges: Array.isArray(graphRaw.edges) ? graphRaw.edges.slice(0, 300).flatMap((edge) => {
      if (!edge || typeof edge !== 'object') return [];
      const item = edge as Record<string, unknown>;
      const from = clipText(item.from, 48);
      const to = clipText(item.to, 48);
      if (!from || !to) return [];
      return [{ from, to, active: Boolean(item.active), label: clipText(item.label, 40) }];
    }) : [],
  } : undefined;
  const shapes = sanitizeShapes(frame.shapes);
  const grid = sanitizeGrid(frame.grid);
  const highlightRows = Array.isArray(frame.highlightRows)
    ? frame.highlightRows.slice(0, 40).map((row) => Math.max(0, Math.round(finite(row)))).filter((row) => !rows || row < rows.length)
    : undefined;
  return {
    title: clipText(frame.title, 200, `第 ${index + 1} 帧`),
    ...(clipText(frame.summary, 600) ? { summary: clipText(frame.summary, 600) } : {}),
    ...(columns ? { columns } : {}),
    ...(rows ? { rows } : {}),
    ...(highlightRows ? { highlightRows } : {}),
    ...(series ? { series } : {}),
    ...(timeline ? { timeline } : {}),
    ...(graph ? { graph } : {}),
    ...(shapes ? { shapes } : {}),
    ...(grid ? { grid } : {}),
  };
}

function sanitizeData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  try {
    const serialized = JSON.stringify(raw);
    if (serialized && serialized.length <= 24000) return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    /* Non-serializable data is dropped below. */
  }
  return {};
}

export function sanitizePipelineResult(raw: unknown): PipelineResult {
  if (!raw || typeof raw !== 'object') throw new RuleSandboxError('output', '规则必须返回对象');
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.frames)) throw new RuleSandboxError('output', '规则返回缺少 frames 数组');
  if (!value.frames.length) throw new RuleSandboxError('output', '规则至少需要 1 帧');
  return {
    data: sanitizeData(value.data),
    frames: value.frames.slice(0, MAX_RULE_FRAMES).map(sanitizeFrame),
  };
}

function nonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const FORBIDDEN_CODE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|indexedDB|BroadcastChannel|localStorage|sessionStorage|document|window|parent|top|globalThis|self|postMessage|eval|async|await|Date|performance|crypto|Worker|SharedWorker|MessageChannel|MessagePort|WebTransport|caches)\b|Math\.random|import\s*\(|new\s+Function\s*\(/;

export async function runRuleInSandbox(
  code: string,
  input: RuleWorkerSource['input'],
  options: RuleSandboxOptions = {},
): Promise<{ result: PipelineResult; elapsedMs: number }> {
  if (!code.trim()) throw new RuleSandboxError('runtime', '规则代码为空');
  if (FORBIDDEN_CODE.test(code)) throw new RuleSandboxError('runtime', '规则包含被禁用的浏览器或异步能力');
  const timeoutMs = options.timeoutMs ?? RULE_TIMEOUT_MS;
  const blobUrl = options.workerFactory ? null : typeof URL !== 'undefined' && typeof Blob !== 'undefined'
    ? URL.createObjectURL(new Blob([RULE_WORKER_SOURCE], { type: 'text/javascript' })) : null;
  let worker: SandboxWorkerLike;
  try {
    worker = options.workerFactory
      ? options.workerFactory(RULE_WORKER_SOURCE)
      : typeof Worker === 'undefined' || !blobUrl
        ? (() => { throw new RuleSandboxError('unavailable', '当前环境不支持 Web Worker 规则沙箱'); })()
        : new Worker(blobUrl);
  } catch (error) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    if (error instanceof RuleSandboxError) throw error;
    throw new RuleSandboxError('unavailable', error instanceof Error ? error.message : '规则沙箱启动失败');
  }
  const token = nonce();
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finish();
      worker.terminate();
      reject(new RuleSandboxError('timeout', '计算超时（可能存在死循环），请检查规则逻辑'));
    }, Math.max(10, timeoutMs));
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    worker.onmessage = (event) => {
      const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
      if (data.nonce !== token) return;
      finish();
      worker.terminate();
      if (data.type === 'error') {
        reject(new RuleSandboxError('runtime', clipText(data.message, 600, '规则执行失败')));
        return;
      }
      try {
        resolve({ result: sanitizePipelineResult(data.output), elapsedMs: Math.max(0, finite(data.elapsedMs)) });
      } catch (error) {
        reject(error instanceof RuleSandboxError ? error : new RuleSandboxError('output', '规则输出校验失败'));
      }
    };
    worker.onerror = (event) => {
      finish();
      worker.terminate();
      reject(new RuleSandboxError('runtime', event.message || '规则 Worker 执行失败'));
    };
    worker.postMessage({ type: 'run', code, input, nonce: token } satisfies RuleWorkerSource);
  });
}
