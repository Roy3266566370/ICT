/**
 * accountScope.test.ts —— `C-SCOPE@1` 的纯函数单测。
 *
 * 运行：`cd frontend && node --test "src/state/accountScope.test.ts"`
 *
 * 本文件只 import `./accountScope.ts`（该模块零依赖），因此可以直接被 Node 的
 * 类型剥离加载，不需要 Vite 的 `@/` 别名解析。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUEST_SCOPE,
  PRIVATE_KEY_TAG,
  accountScopeOf,
  formatScopeLabel,
  isAccountScope,
  isPrivateQueryKey,
  parseAccountScope,
} from './accountScope.ts';

test('常量与契约一致：访客 scope 为 guest，私有键标记为 @private', () => {
  assert.equal(GUEST_SCOPE, 'guest');
  assert.equal(PRIVATE_KEY_TAG, '@private');
});

test('accountScopeOf(null) 返回访客 scope', () => {
  assert.equal(accountScopeOf(null), 'guest');
});

test('accountScopeOf 对空 user_id（空串 / 纯空白）回落访客', () => {
  assert.equal(accountScopeOf({ user_id: '' }), 'guest');
  assert.equal(accountScopeOf({ user_id: '   ' }), 'guest');
  assert.equal(accountScopeOf({ user_id: '\t\n' }), 'guest');
});

test('accountScopeOf 对正常 user_id 返回 user:<id>，并去除首尾空白', () => {
  assert.equal(
    accountScopeOf({ user_id: 'usr_0123456789abcdef0123456789abcdef' }),
    'user:usr_0123456789abcdef0123456789abcdef',
  );
  assert.equal(accountScopeOf({ user_id: '  usr_abc  ' }), 'user:usr_abc');
});

test('同一 user_id 在不同调用中算出完全相同的 scope（纯函数）', () => {
  const user = { user_id: 'usr_same' };
  assert.equal(accountScopeOf(user), accountScopeOf({ user_id: 'usr_same' }));
  assert.equal(accountScopeOf(user), accountScopeOf(user));
});

test('isAccountScope 接受 guest 与合法 user: 形状', () => {
  assert.equal(isAccountScope('guest'), true);
  assert.equal(isAccountScope('user:usr_abc-123_X'), true);
  assert.equal(isAccountScope(`user:${'a'.repeat(64)}`), true);
});

test('isAccountScope 拒绝非法输入', () => {
  assert.equal(isAccountScope('user:'), false);
  assert.equal(isAccountScope(`user:${'a'.repeat(65)}`), false);
  assert.equal(isAccountScope('user:a@b'), false);
  assert.equal(isAccountScope('user:a.b'), false);
  assert.equal(isAccountScope('admin'), false);
  assert.equal(isAccountScope(''), false);
  assert.equal(isAccountScope(null), false);
  assert.equal(isAccountScope(undefined), false);
  assert.equal(isAccountScope(42), false);
  assert.equal(isAccountScope({ scope: 'guest' }), false);
});

test('parseAccountScope 返回收窄后的 scope 或 null', () => {
  assert.equal(parseAccountScope('guest'), 'guest');
  assert.equal(parseAccountScope('user:usr_1'), 'user:usr_1');
  assert.equal(parseAccountScope('user:'), null);
  assert.equal(parseAccountScope(0), null);
});

test('isPrivateQueryKey 只认第一段 @private', () => {
  assert.equal(isPrivateQueryKey([PRIVATE_KEY_TAG, 'guest', 'materials']), true);
  assert.equal(isPrivateQueryKey([PRIVATE_KEY_TAG]), true);
  assert.equal(isPrivateQueryKey([PRIVATE_KEY_TAG, 'user:usr_1', 'runs', 'obj_1']), true);
});

test('isPrivateQueryKey 对公开键与畸形键返回 false', () => {
  assert.equal(isPrivateQueryKey([]), false);
  assert.equal(isPrivateQueryKey(['templates']), false);
  assert.equal(isPrivateQueryKey(['session']), false);
  assert.equal(isPrivateQueryKey(['p', 'share_1']), false);
  assert.equal(isPrivateQueryKey(['lab-shares', 'lab_1']), false);
  assert.equal(isPrivateQueryKey(['materials', 'detail', 'mat_1']), false);
  assert.equal(isPrivateQueryKey(['@privatex', 'guest', 'materials']), false);
  assert.equal(isPrivateQueryKey([undefined, 'guest', 'materials']), false);
});

test('formatScopeLabel 给出可读标签，且只由 scope 派生（不读取邮箱等外部字段）', () => {
  assert.equal(formatScopeLabel('guest'), '访客');
  assert.equal(formatScopeLabel('user:usr_1'), '账号 usr_1');
  assert.equal(formatScopeLabel('user:usr_1'), formatScopeLabel('user:'.concat('usr_1')));
});