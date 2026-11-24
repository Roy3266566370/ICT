/** AI 规则方块的隔离执行沙箱：Blob Worker、80ms 熔断与输出清洗。 */

import type { PipelineFrame, PipelineResult } from './lab408PipelineTypes.ts';

export const RULE_TIMEOUT_MS = 80;
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
  'requestAnimationFrame', 'Function', 'Deno', 'process',
];

const WORKER_PARAMS = `'input', 'Math', ${SHADOWED_API.map((name) => `'${name}'`).join(', ')}`;

export const RULE_WORKER_SOURCE = String.raw`
'use strict';
self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'run') return;
  try {
    var started = performance.now();
    var safeMath = {};
    Object.getOwnPropertyNames(Math).forEach(function (key) {
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
    var runner = new Function(
      ${WORKER_PARAMS},
      '"use strict";\n' + data.code + '\nreturn run(input);'
    );
    var output = runner(
      data.input,
      safeMath,
      deny('fetch'), deny('XMLHttpRequest'), deny('WebSocket'), deny('EventSource'),
      deny('importScripts'), denied, denied, denied, denied, denied, denied, denied, denied,
      denied, denied, denied, denied, denied, denied, deny('postMessage'), deny('setTimeout'),
      deny('setInterval'), deny('queueMicrotask'), deny('requestAnimationFrame'), deny('Function'),
      denied, denied
    );
    if (output && typeof output.then === 'function') throw new Error('规则必须是同步计算，不能返回 Promise');
    if (!output || typeof output !== 'object' || !Array.isArray(output.frames)) {
      throw new Error('run 必须返回 { data, frames }');
    }
    self.postMessage({ type: 'result', nonce: data.nonce, output: output, elapsedMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ type: 'error', nonce: data.nonce, message: String((error && error.message) || error) });
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

const FORBIDDEN_CODE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|indexedDB|BroadcastChannel|localStorage|sessionStorage|document|window|parent|top|globalThis|postMessage|eval|async|await|Date|performance)\b|Math\.random|import\s*\(|new\s+Function\s*\(/;

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
