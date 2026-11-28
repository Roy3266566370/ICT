/** 跨画布的个人自制积木库：localStorage 持久化，支持 composite 子图与单块 aiRuleBlock 自建积木。 */

import { nextId } from './math.ts';
import { defaultAiRuleParams, parseAiRulePayload, serializeAiRulePayload, type AiRuleBlockPayload } from './aiRuleBlock.ts';
import type { CanvasNode, CompositePort, CompositeSub, Wire } from './types.ts';

export const CUSTOM_BLOCKS_KEY = 'xiangsheng.customBlocks.v1';
export const BLUEPRINT_PACKAGE_VERSION = 1;
export const MAX_CUSTOM_BLOCKS = 24;
const MAX_CUSTOM_BLOCK_BYTES = 512_000;

export interface CustomCompositeBlockRecord {
  id: string;
  kind?: 'composite';
  title: string;
  summary?: string;
  createdAt: number;
  sub: CompositeSub;
  /** 标记是否已同步至云端蓝图库 */
  source?: 'local' | 'cloud';
}

export interface CustomAiRuleBlockRecord {
  id: string;
  kind: 'aiRule';
  title: string;
  summary?: string;
  createdAt: number;
  payload: string;
  params: Record<string, number>;
  text?: string;
  source?: 'local' | 'cloud';
}

export type CustomBlockRecord = CustomCompositeBlockRecord | CustomAiRuleBlockRecord;

export interface BlueprintPackage {
  format: 'wanxiang-blueprints';
  version: 1;
  exportedAt: string;
  items: CustomBlockRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPort(value: unknown): value is CompositePort {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.dir === 'in' || value.dir === 'out')
    && typeof value.label === 'string';
}

function isWire(value: unknown): value is Wire {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.from === 'string'
    && typeof value.to === 'string';
}

function isSub(value: unknown): value is CompositeSub {
  return isRecord(value)
    && Array.isArray(value.nodes)
    && Array.isArray(value.wires)
    && Array.isArray(value.ports)
    && value.nodes.every((node) => isRecord(node)
      && typeof node.id === 'string'
      && typeof node.type === 'string'
      && Number.isFinite(node.x)
      && Number.isFinite(node.y)
      && isRecord(node.params))
    && value.wires.every(isWire)
    && value.ports.every(isPort);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v));
}

function isRecordItem(value: unknown): value is CustomBlockRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || !Number.isFinite(value.createdAt)) {
    return false;
  }
  if (value.kind === 'aiRule') {
    return typeof value.payload === 'string'
      && parseAiRulePayload(value.payload) !== null
      && isNumberRecord(value.params)
      && (value.text === undefined || typeof value.text === 'string');
  }
  return isSub(value.sub);
}

export function listCustomBlocks(): CustomBlockRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CUSTOM_BLOCKS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecordItem).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persistRecord(record: CustomBlockRecord): CustomBlockRecord {
  if (JSON.stringify(record).length > MAX_CUSTOM_BLOCK_BYTES) {
    throw new Error('积木过大，请减少内部对象后再保存');
  }
  const next = [record, ...listCustomBlocks().filter((item) => item.id !== record.id)]
    .slice(0, MAX_CUSTOM_BLOCKS);
  localStorage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify(next));
  return record;
}

export function saveCustomBlock(title: string, sub: CompositeSub): CustomCompositeBlockRecord {
  const cleanTitle = title.trim().slice(0, 60) || '我的自制积木';
  const record: CustomCompositeBlockRecord = {
    id: nextId('cb'),
    kind: 'composite',
    title: cleanTitle,
    createdAt: Date.now(),
    sub: JSON.parse(JSON.stringify(sub)) as CompositeSub,
  };
  if (!isSub(record.sub)) throw new Error('积木结构无效，无法保存');
  persistRecord(record);
  return record;
}

export function saveCustomAiRuleBlock(
  title: string,
  payload: AiRuleBlockPayload,
  params?: Record<string, number>,
  text?: string,
): CustomAiRuleBlockRecord {
  const cleanTitle = title.trim().slice(0, 60) || payload.title || '自建智能积木';
  const serialized = serializeAiRulePayload({ ...payload, title: cleanTitle });
  const mergedParams = { ...defaultAiRuleParams(payload), ...(params ?? {}) };
  const record: CustomAiRuleBlockRecord = {
    id: nextId('cb'),
    kind: 'aiRule',
    title: cleanTitle,
    createdAt: Date.now(),
    payload: serialized,
    params: mergedParams,
    ...(text !== undefined ? { text } : payload.defaultText !== undefined ? { text: payload.defaultText } : {}),
  };
  persistRecord(record);
  return record;
}

export function removeCustomBlock(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const next = listCustomBlocks().filter((item) => item.id !== id);
    localStorage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下静默失败，不阻断画布编辑 */
  }
}

function cloneSub(sub: CompositeSub, map: Map<string, string>): CompositeSub {
  const nodes = sub.nodes.map((node) => cloneNode(node, map));
  const exposedParams = sub.exposedParams
    ?.map((ep) => ({
      ...ep,
      nodeId: map.get(ep.nodeId) ?? ep.nodeId,
    }))
    .filter((ep) => nodes.some((n) => n.id === ep.nodeId));
  const previewNodeId = sub.previewNodeId ? (map.get(sub.previewNodeId) ?? sub.previewNodeId) : undefined;
  return {
    nodes,
    wires: sub.wires.map((wire) => ({
      ...wire,
      id: nextId('w'),
      from: map.get(wire.from) ?? wire.from,
      to: map.get(wire.to) ?? wire.to,
    })),
    ports: sub.ports.map((port) => ({ ...port, id: map.get(port.id) ?? port.id })),
    ...(exposedParams?.length ? { exposedParams } : {}),
    ...(previewNodeId && nodes.some((n) => n.id === previewNodeId) ? { previewNodeId } : {}),
    ...(sub.summary ? { summary: sub.summary } : {}),
  };
}

function cloneNode(node: CanvasNode, map: Map<string, string>): CanvasNode {
  const prefix = node.type === 'portIn' ? 'pi' : node.type === 'portOut' ? 'po' : 'n';
  const id = nextId(prefix);
  map.set(node.id, id);
  const copy: CanvasNode = {
    ...node,
    id,
    params: { ...node.params },
    ...(node.sub ? { sub: cloneSub(node.sub, map) } : {}),
  };
  return copy;
}

function shiftSub(sub: CompositeSub, dx: number, dy: number): void {
  for (const node of sub.nodes) {
    node.x = Math.max(0, node.x + dx);
    node.y = Math.max(0, node.y + dy);
    if (node.sub) shiftSub(node.sub, dx, dy);
  }
}

export function instantiateCustomBlock(block: CustomBlockRecord, x: number, y: number): CanvasNode {
  if (block.kind === 'aiRule') {
    return {
      id: nextId('n'),
      type: 'aiRuleBlock',
      x: Math.max(0, x),
      y: Math.max(0, y),
      params: { ...block.params },
      payload: block.payload,
      ...(block.text !== undefined ? { text: block.text } : {}),
    };
  }
  const sub = cloneSub(block.sub, new Map());
  const minX = Math.min(...sub.nodes.map((node) => node.x));
  const minY = Math.min(...sub.nodes.map((node) => node.y));
  shiftSub(sub, (Number.isFinite(minX) ? x - minX : 0) + 24, (Number.isFinite(minY) ? y - minY : 0) + 24);
  return {
    id: nextId('n'),
    type: 'composite',
    x: Math.max(0, x),
    y: Math.max(0, y),
    params: {},
    text: block.title,
    sub,
  };
}

export function customBlockBadge(block: CustomBlockRecord): string {
  const base = block.kind === 'aiRule' ? '自建积木' : `${block.sub.ports.length} 端口`;
  return block.source === 'cloud' ? `${base} · 云端` : base;
}

/** 导出蓝图包 JSON（支持单个或多个蓝图分享） */
export function exportBlueprintPackage(blocks: readonly CustomBlockRecord[]): BlueprintPackage {
  return {
    format: 'wanxiang-blueprints',
    version: BLUEPRINT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    items: blocks.map((block) => {
      const copy = JSON.parse(JSON.stringify(block)) as CustomBlockRecord;
      delete copy.source;
      return copy;
    }),
  };
}

/** 解析并校验导入的 `.json` 蓝图包（支持蓝图包或单条蓝图记录） */
export function parseBlueprintPackage(rawText: string): CustomBlockRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('蓝图文件不是有效的 JSON 格式');
  }
  if (!isRecord(parsed)) {
    throw new Error('蓝图文件顶层必须是 JSON 对象');
  }
  let rawItems: unknown[];
  if (parsed.format === 'wanxiang-blueprints') {
    if (parsed.version !== BLUEPRINT_PACKAGE_VERSION) {
      throw new Error(`不支持的蓝图包版本：v${String(parsed.version)}（当前支持 v${BLUEPRINT_PACKAGE_VERSION}）`);
    }
    if (!Array.isArray(parsed.items)) {
      throw new Error('蓝图包缺少 items 列表');
    }
    rawItems = parsed.items;
  } else if (isRecordItem(parsed)) {
    rawItems = [parsed];
  } else {
    throw new Error('无法识别的蓝图文件结构，请确认是万象工坊导出的蓝图 JSON');
  }

  const valid: CustomBlockRecord[] = [];
  for (const item of rawItems) {
    if (!isRecordItem(item)) continue;
    const clean = JSON.parse(JSON.stringify(item)) as CustomBlockRecord;
    clean.id = nextId('cb');
    clean.createdAt = Date.now();
    delete clean.source;
    valid.push(clean);
  }
  if (!valid.length) {
    throw new Error('蓝图包中没有通过结构校验的有效积木');
  }
  return valid;
}

/** 将导入的蓝图批量保存到 localStorage 并返回合并后的列表 */
export function importCustomBlocksLocal(blocks: readonly CustomBlockRecord[]): CustomBlockRecord[] {
  const existing = listCustomBlocks();
  const merged = [...blocks, ...existing].slice(0, MAX_CUSTOM_BLOCKS);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify(merged));
  }
  return merged;
}

/** 将后端云端蓝图 DTO 转换为前端统一 CustomBlockRecord */
export function cloudBlueprintToRecord(dto: {
  id: string;
  kind: 'composite' | 'aiRule';
  title: string;
  summary?: string;
  blueprint: Record<string, unknown>;
  updated_at?: string;
  created_at?: string;
}): CustomBlockRecord | null {
  const ts = Date.parse(dto.updated_at || dto.created_at || '') || Date.now();
  if (dto.kind === 'aiRule') {
    const candidate: unknown = {
      id: dto.id,
      kind: 'aiRule',
      title: dto.title,
      summary: dto.summary || undefined,
      createdAt: ts,
      payload: dto.blueprint.payload,
      params: dto.blueprint.params ?? {},
      ...(typeof dto.blueprint.text === 'string' ? { text: dto.blueprint.text } : {}),
    };
    if (!isRecordItem(candidate)) return null;
    return { ...candidate, source: 'cloud' };
  }
  const candidate: unknown = {
    id: dto.id,
    kind: 'composite',
    title: dto.title,
    summary: dto.summary || undefined,
    createdAt: ts,
    sub: dto.blueprint.sub,
  };
  if (!isRecordItem(candidate)) return null;
  return { ...candidate, source: 'cloud' };
}

/** 将本地 CustomBlockRecord 转为后端保存入参 */
export function recordToCloudBlueprintInput(record: CustomBlockRecord): {
  kind: 'composite' | 'aiRule';
  title: string;
  summary: string;
  blueprint: Record<string, unknown>;
} {
  if (record.kind === 'aiRule') {
    const parsed = parseAiRulePayload(record.payload);
    return {
      kind: 'aiRule',
      title: record.title,
      summary: record.summary || parsed?.summary || '',
      blueprint: {
        payload: record.payload,
        params: record.params,
        ...(record.text !== undefined ? { text: record.text } : {}),
      },
    };
  }
  return {
    kind: 'composite',
    title: record.title,
    summary: record.summary || record.sub.summary || '',
    blueprint: { sub: record.sub },
  };
}

function blueprintSignature(item: CustomBlockRecord): string {
  if (item.kind === 'aiRule') {
    const parsed = parseAiRulePayload(item.payload);
    return `aiRule|${item.title.trim()}|${parsed?.code.trim() ?? item.payload.trim()}`;
  }
  const nodeSig = item.sub.nodes
    .map((n) => `${n.id}:${n.type}`)
    .sort()
    .join(',');
  const portSig = item.sub.ports
    .map((p) => `${p.id}:${p.dir}`)
    .sort()
    .join(',');
  return `composite|${item.title.trim()}|${nodeSig}|w${item.sub.wires.length}|${portSig}`;
}

/** 合并云端蓝图与本地蓝图（云端优先，按 ID 与内容签名去重，解除 24 个上限） */
export function mergeBlueprintLibraries(
  cloud: readonly CustomBlockRecord[],
  local: readonly CustomBlockRecord[],
): CustomBlockRecord[] {
  const byId = new Map<string, CustomBlockRecord>();
  const cloudSigs = new Set<string>();
  for (const item of cloud) {
    byId.set(item.id, item);
    cloudSigs.add(blueprintSignature(item));
  }
  for (const item of local) {
    if (!byId.has(item.id) && !cloudSigs.has(blueprintSignature(item))) {
      byId.set(item.id, { ...item, source: item.source ?? 'local' });
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}
