import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_BLOCKS_KEY, instantiateCustomBlock, listCustomBlocks, removeCustomBlock, saveCustomBlock,
} from './customBlocks.ts';
import type { CompositeSub } from './types.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const sub: CompositeSub = {
  nodes: [
    { id: 'pi_a', type: 'portIn', x: 10, y: 20, params: {} },
    { id: 'r_a', type: 'rotor', x: 80, y: 60, params: { theta: 0.25 } },
    { id: 'po_a', type: 'portOut', x: 160, y: 70, params: {} },
  ],
  wires: [
    { id: 'w_a', from: 'pi_a', to: 'r_a', toPort: 'in' },
    { id: 'w_b', from: 'r_a', to: 'po_a' },
  ],
  ports: [
    { id: 'pi_a', dir: 'in', label: '标量输入', kind: 'scalar' },
    { id: 'po_a', dir: 'out', label: '矩阵输出', kind: 'matrix2' },
  ],
};

test('我的积木库可跨画布保存、列出、实例化和删除', () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    const saved = saveCustomBlock('旋转 0.25 圈', sub);
    const listed = listCustomBlocks();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.title, '旋转 0.25 圈');
    assert.equal(saved.id, listed[0]!.id);
    assert.match(storage.getItem(CUSTOM_BLOCKS_KEY) ?? '', /旋转 0.25 圈/);

    const node = instantiateCustomBlock(listed[0]!, 300, 200);
    assert.equal(node.type, 'composite');
    assert.equal(node.text, '旋转 0.25 圈');
    assert.equal(node.x, 300);
    assert.equal(node.y, 200);
    const cloned = node.sub!;
    const inner = cloned.nodes.find((item) => item.type === 'rotor')!;
    assert.ok(inner.x >= 300 && inner.y >= 200);
    const outPort = cloned.ports.find((port) => port.dir === 'out')!;
    assert.ok(cloned.nodes.some((item) => item.id === outPort.id && item.type === 'portOut'));
    assert.ok(cloned.wires.every((wire) => cloned.nodes.some((item) => item.id === wire.from)));
    assert.ok(cloned.wires.every((wire) => cloned.nodes.some((item) => item.id === wire.to)));
    assert.notEqual(inner.id, 'r_a');

    removeCustomBlock(saved.id);
    assert.equal(listCustomBlocks().length, 0);
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true });
  }
});

test('我的积木库忽略损坏的本地数据', () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    storage.setItem(CUSTOM_BLOCKS_KEY, '{broken');
    assert.deepEqual(listCustomBlocks(), []);
    storage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify([{ id: 'x', title: '坏积木', createdAt: 1, sub: {} }]));
    assert.deepEqual(listCustomBlocks(), []);
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true });
  }
});
