/**
 * draftScope.test.ts —— `C-DRAFT-SCOPE@1` 的纯函数单测。
 *
 * 运行：`cd frontend && node --test "src/state/draftScope.test.ts"`
 *
 * 覆盖 acceptance 要求的六类断言：键形状、旧格式解析为 null、scope 比对、
 * 指纹版本不等、按 scope 清理只删目标键、存储异常不阻断。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { StorageLike } from './draftScope.ts';
import {
  DRAFT_STORAGE_PREFIX,
  clearDraftsForScope,
  draftScopeOfKey,
  draftStorageKey,
  isDraftKey,
  isDraftKeyForScope,
  matchesFingerprint,
} from './draftScope.ts';

/** 只实现清理所需的三个成员；键名集合可通过 `keys` 观察。 */
interface StubStorage extends StorageLike {
  readonly keys: ReadonlySet<string>;
}

function stubStorage(initialKeys: readonly string[]): StubStorage {
  const items = new Map<string, string>();
  for (const key of initialKeys) items.set(key, '{"stub":true}');
  return {
    get length(): number {
      return items.size;
    },
    key(index: number): string | null {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      items.delete(key);
    },
    get keys(): ReadonlySet<string> {
      return new Set(items.keys());
    },
  };
}

test('DRAFT_STORAGE_PREFIX 为契约常量 xiangsheng', () => {
  assert.equal(DRAFT_STORAGE_PREFIX, 'xiangsheng');
});

test('draftStorageKey 形状为 xiangsheng.<kind>.v1.<scope>.<parts...>', () => {
  assert.equal(
    draftStorageKey('free-document', 'user:usr_1', ['mat_1']),
    'xiangsheng.free-document.v1.user:usr_1.mat_1',
  );
  assert.equal(
    draftStorageKey('lab', 'guest', ['lab_1', 'prob_1']),
    'xiangsheng.lab.v1.guest.lab_1.prob_1',
  );
  assert.equal(
    draftStorageKey('ispec', 'user:usr_1', ['mat_1', 'obj_1']),
    'xiangsheng.ispec.v1.user:usr_1.mat_1.obj_1',
  );
  assert.equal(draftStorageKey('deck', 'guest', []), 'xiangsheng.deck.v1.guest');
});

test('draftStorageKey 的产物都能被 isDraftKey 识别', () => {
  const kinds = ['free-document', 'lab', 'deck', 'region', 'ispec'] as const;
  for (const kind of kinds) {
    assert.equal(isDraftKey(draftStorageKey(kind, 'user:usr_1', ['a'])), true);
  }
});

test('isDraftKey 拒绝旧格式与非本命名空间的键', () => {
  // 旧格式：无 scope 段（第四段是作品 id 或 writer 标记）
  assert.equal(isDraftKey('xiangsheng.free-document.v1.mat_1'), false);
  assert.equal(isDraftKey('xiangsheng.free-document.v1.mat_1.writer'), false);
  assert.equal(isDraftKey('xiangsheng.free-document.v1.writer.1710000_ab'), false);
  // 版本段不对
  assert.equal(isDraftKey('xiangsheng.region.v2.guest.a'), false);
  // 种类不在白名单
  assert.equal(isDraftKey('xiangsheng.unknown.v1.guest.a'), false);
  // 命名空间不对
  assert.equal(isDraftKey('xs.region.v1.guest.a'), false);
  assert.equal(isDraftKey(''), false);
});

test('draftScopeOfKey 对新格式返回 scope', () => {
  assert.equal(draftScopeOfKey('xiangsheng.lab.v1.guest.lab_1.prob_1'), 'guest');
  assert.equal(draftScopeOfKey('xiangsheng.ispec.v1.user:usr_1.mat_1.obj_1'), 'user:usr_1');
});

test('draftScopeOfKey 对旧格式一律返回 null（不会被误删/误恢复）', () => {
  const legacyKeys = [
    'xiangsheng.free-document.v1.mat_1',
    'xiangsheng.free-document.v1.mat_1.writer',
    'xiangsheng.free-document.v1.writer.mat_1',
    'xiangsheng.free-document.v1.',
    'xiangsheng',
    '',
    'unrelated.key',
    'xiangsheng.region.v1.mat_1.region_1',
  ];
  for (const key of legacyKeys) {
    assert.equal(draftScopeOfKey(key), null, `旧格式应返回 null：${key}`);
  }
});

test('isDraftKeyForScope 只认同一个 scope', () => {
  const key = 'xiangsheng.deck.v1.user:usr_a.mat_1';
  assert.equal(isDraftKeyForScope(key, 'user:usr_a'), true);
  assert.equal(isDraftKeyForScope(key, 'user:usr_b'), false);
  assert.equal(isDraftKeyForScope(key, 'guest'), false);
  assert.equal(isDraftKeyForScope('xiangsheng.deck.v1.mat_1', 'guest'), false);
});

test('matchesFingerprint：sourceKey 与 revision 都相等才为 true', () => {
  const expected = { sourceKey: 'scene_abc', revision: 7 };
  assert.equal(matchesFingerprint({ sourceKey: 'scene_abc', revision: 7 }, expected), true);
});

test('matchesFingerprint：revision 不等返回 false', () => {
  const expected = { sourceKey: 'scene_abc', revision: 7 };
  assert.equal(matchesFingerprint({ sourceKey: 'scene_abc', revision: 6 }, expected), false);
  assert.equal(matchesFingerprint({ sourceKey: 'scene_abc', revision: 8 }, expected), false);
});

test('matchesFingerprint：sourceKey 不等、空值、字符串版本号都返回 false', () => {
  const expected = { sourceKey: 'scene_abc', revision: 7 };
  assert.equal(matchesFingerprint({ sourceKey: 'scene_other', revision: 7 }, expected), false);
  assert.equal(matchesFingerprint(null, expected), false);
  assert.equal(matchesFingerprint(undefined, expected), false);
  // 严格相等：JSON 里被存成字符串的版本号视为不匹配
  const asString: unknown = { sourceKey: 'scene_abc', revision: '7' };
  assert.equal(matchesFingerprint(asString, expected), false);
});

test('matchesFingerprint：非自由编辑场景用空 sourceKey 也能匹配', () => {
  const expected = { sourceKey: '', revision: 3 };
  assert.equal(matchesFingerprint({ sourceKey: '', revision: 3 }, expected), true);
});

test('clearDraftsForScope 只删除目标 scope 的键', () => {
  const storage = stubStorage([
    'xiangsheng.lab.v1.user:usr_a.lab_1.prob_1',
    'xiangsheng.deck.v1.user:usr_a.mat_1',
    'xiangsheng.lab.v1.user:usr_b.lab_1.prob_1',
    'xiangsheng.deck.v1.guest.mat_1',
    'xiangsheng.free-document.v1.mat_1',
    'xiangsheng.free-document.v1.mat_1.writer',
    'templates',
  ]);

  const removed = clearDraftsForScope('user:usr_a', [storage]);

  assert.equal(removed, 2);
  assert.equal(storage.keys.has('xiangsheng.lab.v1.user:usr_a.lab_1.prob_1'), false);
  assert.equal(storage.keys.has('xiangsheng.deck.v1.user:usr_a.mat_1'), false);
  // 其它账号、访客、旧格式与公开键全部保留
  assert.equal(storage.keys.has('xiangsheng.lab.v1.user:usr_b.lab_1.prob_1'), true);
  assert.equal(storage.keys.has('xiangsheng.deck.v1.guest.mat_1'), true);
  assert.equal(storage.keys.has('xiangsheng.free-document.v1.mat_1'), true);
  assert.equal(storage.keys.has('xiangsheng.free-document.v1.mat_1.writer'), true);
  assert.equal(storage.keys.has('templates'), true);
});

test('clearDraftsForScope 遍历多个存储并累加删除条数', () => {
  const local = stubStorage(['xiangsheng.lab.v1.guest.lab_1', 'xiangsheng.ispec.v1.guest.mat_1.obj_1']);
  const session = stubStorage([
    'xiangsheng.region.v1.guest.mat_1.region_1.writer',
    'xiangsheng.region.v1.user:usr_a.mat_1.region_1.writer',
  ]);

  const removed = clearDraftsForScope('guest', [local, session]);

  assert.equal(removed, 3);
  assert.equal(local.keys.size, 0);
  assert.equal(session.keys.size, 1);
  assert.equal(session.keys.has('xiangsheng.region.v1.user:usr_a.mat_1.region_1.writer'), true);
});

test('clearDraftsForScope 在存储不可用时返回 0 且不抛错', () => {
  const broken: StorageLike = {
    get length(): number {
      throw new Error('storage disabled');
    },
    key(): string | null {
      throw new Error('storage disabled');
    },
    removeItem(): void {
      throw new Error('storage disabled');
    },
  };

  assert.doesNotThrow(() => clearDraftsForScope('guest', [broken]));
  assert.equal(clearDraftsForScope('guest', [broken]), 0);
});

test('clearDraftsForScope 单条删除失败不影响其余键与返回值', () => {
  let removedCalls = 0;
  const partiallyBroken: StorageLike = {
    get length(): number {
      return 2;
    },
    key(index: number): string | null {
      return index === 0 ? 'xiangsheng.deck.v1.guest.alpha' : 'xiangsheng.deck.v1.guest.beta';
    },
    removeItem(key: string): void {
      if (key.endsWith('alpha')) throw new Error('quota exceeded');
      removedCalls += 1;
    },
  };

  assert.equal(clearDraftsForScope('guest', [partiallyBroken]), 1);
  assert.equal(removedCalls, 1);
});

test('clearDraftsForScope 目标 scope 无键时返回 0', () => {
  const storage = stubStorage(['xiangsheng.deck.v1.user:usr_b.mat_1']);
  assert.equal(clearDraftsForScope('user:usr_a', [storage]), 0);
  assert.equal(storage.keys.size, 1);
});