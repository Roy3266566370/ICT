/**
 * 专用视图隔离协议（T09）。
 *
 * 主应用不加载模型生成的 script/HTML；程序只在 sandbox iframe 内的 Worker 中执行，
 * 返回值必须是经白名单校验的 ViewAST。opaque origin 的 origin 可能为 null，因此
 * 同时校验 event.source、每次实例随机 nonce、类型、版本与大小。
 */

export const PROTOCOL_VERSION = 'ppt-ai.sandbox.1';
export const MAX_NODES = 2000;
export const MAX_MESSAGE_BYTES = 256 * 1024;

const NODE_TYPES = new Set([
  'group', 'text', 'point', 'line', 'polyline', 'rect', 'circle', 'axes', 'curve', 'heatmap', 'scene3d', 'mermaid', 'chart',
]);
const MERMAID_HEAD_RE = /^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap)\b/i;
const MERMAID_FORBIDDEN_RE = /(?:^\s*click\s+|\bjavascript:|<script\b|\bhref\s*=|\bonclick\s*=|\bforeignObject\b)/im;
const MERMAID_NODE_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const CHART_TYPES = new Set(['bar', 'line', 'area', 'scatter', 'pie']);
const FORBIDDEN_KEYS = new Set([
  'script', 'onclick', 'onload', 'onerror', 'onmouseover', 'href', 'src',
  'foreignobject', 'dangerouslysetinnerhtml', 'innerhtml',
]);

export interface SandboxInit {
  type: 'init';
  protocol: typeof PROTOCOL_VERSION;
  nonce: string;
  artifactId: string;
  revision: string;
  program: string;
  input: Record<string, unknown>;
  timeoutMs: number;
}

export interface SandboxResult {
  type: 'sandbox-result';
  protocol: typeof PROTOCOL_VERSION;
  nonce: string;
  artifactId: string;
  revision: string;
  ast: Record<string, unknown>;
  elapsedMs: number;
}

export interface SandboxFailure {
  type: 'sandbox-failure';
  protocol: typeof PROTOCOL_VERSION;
  nonce: string;
  artifactId: string;
  revision: string;
  message: string;
}

export type SandboxMessage = SandboxResult | SandboxFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteTree(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (isRecord(value)) return Object.entries(value).every(([key, item]) => typeof key === 'string' && finiteTree(item));
  return false;
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateViewAst(ast: unknown, bindings: string[] = []): string[] {
  const errors: string[] = [];
  if (!isRecord(ast)) return ['ViewAST 必须是对象'];
  if (ast.version !== 'ppt-ai.view.1') errors.push('ViewAST 版本不匹配');
  if (!Array.isArray(ast.nodes)) errors.push('nodes 必须是数组');
  if (!finiteTree(ast)) errors.push('ViewAST 包含非有限数值');
  if (errors.length) return errors;
  const nodes = ast.nodes as unknown[];
  if (nodes.length > MAX_NODES) errors.push('节点数超过上限');
  const allowedBindings = new Set(bindings);
  const seen = new Set<string>();
  const walk = (items: unknown[]) => {
    for (const item of items) {
      if (!isRecord(item)) { errors.push('节点必须是对象'); continue; }
      const id = item.id;
      if (typeof id !== 'string' || !id) { errors.push('节点缺少 id'); continue; }
      if (seen.has(id)) errors.push(`节点 id 重复：${id}`);
      seen.add(id);
      if (seen.size > MAX_NODES) { errors.push('节点数超过上限'); return; }
      if (typeof item.type !== 'string' || !NODE_TYPES.has(item.type)) errors.push(`节点类型未登记：${String(item.type)}`);
      Object.keys(item).forEach((key) => {
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) errors.push(`禁止字段：${key}`);
      });
      if (isRecord(item.style)) {
        Object.entries(item.style).forEach(([key, value]) => {
          if (['fill', 'stroke'].includes(key) && typeof value === 'string' && !/^(#[0-9a-fA-F]{6}|transparent|none)$/.test(value)) {
            errors.push(`非法颜色：${value}`);
          }
        });
      }
      if (typeof item.binding === 'string' && item.binding && !allowedBindings.has(item.binding)) {
        errors.push(`绑定未登记：${item.binding}`);
      }
      if (item.type === 'mermaid') {
        const m = item.mermaid;
        if (!isRecord(m) || typeof m.code !== 'string' || !m.code.trim() || m.code.length > 4000) {
          errors.push('mermaid 节点缺少合法的 code');
        } else {
          if (!MERMAID_HEAD_RE.test(m.code)) errors.push('mermaid.code 必须以受支持的图类型开头');
          if (MERMAID_FORBIDDEN_RE.test(m.code)) errors.push('mermaid.code 包含禁止的脚本或跳转指令');
        }
        if (m && isRecord(m) && m.activeNodes !== undefined) {
          if (!Array.isArray(m.activeNodes) || m.activeNodes.length > 16 ||
            m.activeNodes.some((n) => typeof n !== 'string' || !MERMAID_NODE_ID_RE.test(n))) {
            errors.push('mermaid.activeNodes 包含非法节点 ID');
          }
        }
      }
      if (item.type === 'chart') {
        const c = item.chart;
        if (!isRecord(c) || typeof c.chartType !== 'string' || !CHART_TYPES.has(c.chartType)) {
          errors.push('chart 节点缺少合法的 chartType');
        } else if (!Array.isArray(c.series) || c.series.length < 1 || c.series.length > 6) {
          errors.push('chart.series 必须包含 1~6 个系列');
        } else if (c.chartType !== 'scatter') {
          if (!Array.isArray(c.categories) || c.categories.length < 1 || c.categories.length > 40) {
            errors.push('非散点图必须提供 1~40 个 categories');
          } else {
            for (const s of c.series) {
              if (!isRecord(s) || !Array.isArray(s.values) || s.values.length !== c.categories.length ||
                s.values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
                errors.push('chart.series[].values 长度或数值非法');
                break;
              }
            }
          }
        } else {
          for (const s of c.series) {
            if (!isRecord(s) || !Array.isArray(s.values) || !s.values.length ||
              s.values.some((pt) => !Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number')) {
              errors.push('散点图 values 必须为 [x, y] 数值对');
              break;
            }
          }
        }
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk(nodes);
  const encoded = new TextEncoder().encode(JSON.stringify(ast));
  if (encoded.length > MAX_MESSAGE_BYTES) errors.push('ViewAST 消息超过 256KB');
  return errors.slice(0, 20);
}

export function parseSandboxMessage(
  raw: unknown,
  expected: { nonce: string; artifactId: string; revision: string; source: MessageEventSource | null; contentWindow: Window | null },
): { ok: true; message: SandboxMessage } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: '消息不是对象' };
  if (raw.type !== 'sandbox-result' && raw.type !== 'sandbox-failure') return { ok: false, reason: '消息类型不合法' };
  if (raw.protocol !== PROTOCOL_VERSION) return { ok: false, reason: '协议版本不匹配' };
  if (raw.nonce !== expected.nonce) return { ok: false, reason: 'nonce 不匹配' };
  if (raw.artifactId !== expected.artifactId) return { ok: false, reason: 'artifact 不匹配' };
  if (raw.revision !== expected.revision) return { ok: false, reason: 'revision 过期' };
  if (expected.source !== expected.contentWindow) return { ok: false, reason: '消息来源不是沙箱子窗口' };
  return { ok: true, message: raw as unknown as SandboxMessage };
}

export function isSandboxResult(message: SandboxMessage): message is SandboxResult {
  return message.type === 'sandbox-result';
}
