import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPIC_ALIAS_KEY, readTopicAliases, topicDisplayName, writeTopicAlias,
} from './workshopTopics.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

function withStorage(run: (storage: MemoryStorage) => void): void {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    run(storage);
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true });
  }
}

test('专题自定义名可持久化、清洗空白并在清空后恢复原名', () => {
  withStorage((storage) => {
    const first = writeTopicAlias('c01', '  我的  极限专题  ', {});
    assert.deepEqual(first, { c01: '我的 极限专题' });
    assert.match(storage.getItem(TOPIC_ALIAS_KEY) ?? '', /我的 极限专题/);
    assert.equal(topicDisplayName({ id: 'c01', name: '专题 01 · 极限' }, first), '我的 极限专题');

    const restored = readTopicAliases();
    assert.deepEqual(restored, first);

    const cleared = writeTopicAlias('c01', '   ', restored);
    assert.deepEqual(cleared, {});
    assert.equal(topicDisplayName({ id: 'c01', name: '专题 01 · 极限' }, cleared), '专题 01 · 极限');
    assert.equal(storage.getItem(TOPIC_ALIAS_KEY), '{}');
  });
});

test('损坏或非对象形式的专题名存储被忽略', () => {
  withStorage((storage) => {
    storage.setItem(TOPIC_ALIAS_KEY, '{broken');
    assert.deepEqual(readTopicAliases(), {});
    storage.setItem(TOPIC_ALIAS_KEY, JSON.stringify(['c01', '坏数据']));
    assert.deepEqual(readTopicAliases(), {});
    storage.setItem(TOPIC_ALIAS_KEY, JSON.stringify({ c01: '   ', c02: 3, c03: '可用' }));
    assert.deepEqual(readTopicAliases(), { c03: '可用' });
  });
});
