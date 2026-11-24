/** 跨画布的个人自制积木库：localStorage 持久化，复用 composite 子图。 */

import { nextId } from './math.ts';
import type { CanvasNode, CompositePort, CompositeSub, Wire } from './types.ts';

export const CUSTOM_BLOCKS_KEY = 'xiangsheng.customBlocks.v1';
export const MAX_CUSTOM_BLOCKS = 24;
const MAX_CUSTOM_BLOCK_BYTES = 400_000;

export interface CustomBlockRecord {
  id: string;
  title: string;
  createdAt: number;
  sub: CompositeSub;
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

function isRecordItem(value: unknown): value is CustomBlockRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && Number.isFinite(value.createdAt)
    && isSub(value.sub);
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

export function saveCustomBlock(title: string, sub: CompositeSub): CustomBlockRecord {
  const cleanTitle = title.trim().slice(0, 60) || '我的自制积木';
  const record: CustomBlockRecord = {
    id: nextId('cb'),
    title: cleanTitle,
    createdAt: Date.now(),
    sub: JSON.parse(JSON.stringify(sub)) as CompositeSub,
  };
  if (!isSub(record.sub)) throw new Error('积木结构无效，无法保存');
  if (JSON.stringify(record).length > MAX_CUSTOM_BLOCK_BYTES) {
    throw new Error('积木过大，请减少内部对象后再保存');
  }
  const next = [record, ...listCustomBlocks().filter((item) => item.id !== record.id)]
    .slice(0, MAX_CUSTOM_BLOCKS);
  localStorage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify(next));
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
  return {
    nodes,
    wires: sub.wires.map((wire) => ({
      ...wire,
      id: nextId('w'),
      from: map.get(wire.from) ?? wire.from,
      to: map.get(wire.to) ?? wire.to,
    })),
    ports: sub.ports.map((port) => ({ ...port, id: map.get(port.id) ?? port.id })),
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
