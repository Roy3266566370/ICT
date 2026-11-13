/**
 * `navAccountItems` 的纯函数单测（契约 `C-NAV-ACCOUNT@1` 返回值表逐行覆盖）。
 *
 * 运行：`cd frontend && node --test "src/components/home/navAccountItems.test.ts"`
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UNAVAILABLE_NAV_HINT,
  accountDisplayName,
  heroAccountLink,
  navAccountEntries,
} from './navAccountItems.ts';
import type { NavAccountUser } from './navAccountItems.ts';

const USER: NavAccountUser = {
  user_id: 'user_01',
  display_name: '林老师',
  email: 'lin@xiangsheng.local',
  username: 'lin',
};

const AVATAR_USER: NavAccountUser = {
  ...USER,
  avatar_url: '/api/v1/me/avatar?v=abc123',
};

const NO_NAME_USER: NavAccountUser = {
  user_id: 'user_02',
  display_name: '',
  email: 'noname@xiangsheng.local',
};

const BLANK_NAME_USER: NavAccountUser = {
  user_id: 'user_03',
  display_name: '   ',
  email: 'blank@xiangsheng.local',
};

test('restoring：不渲染登录 / 免费注册 / 账号，hero 也不引导', () => {
  assert.deepEqual(navAccountEntries('restoring', null), []);
  assert.deepEqual(navAccountEntries('restoring', USER), []);
  assert.equal(heroAccountLink('restoring', null), null);
  assert.equal(heroAccountLink('restoring', USER), null);
});

test('guest：同时提供「登录」（无提示）与「免费注册」，hero 引导注册', () => {
  const entries = navAccountEntries('guest', null);
  assert.deepEqual(entries, [
    { kind: 'login', label: '登录', to: '/login', hint: null },
    { kind: 'register', label: '免费注册', to: '/register' },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(heroAccountLink('guest', null), {
    kind: 'register',
    to: '/register',
    label: '免费注册',
  });
});

test('unavailable：只保留可重试的「登录」并带可读提示，绝不渲染「免费注册」', () => {
  const entries = navAccountEntries('unavailable', null);
  assert.deepEqual(entries, [
    { kind: 'login', label: '登录', to: '/login', hint: UNAVAILABLE_NAV_HINT },
  ]);
  assert.equal(UNAVAILABLE_NAV_HINT, '账号服务暂时不可用，可稍后重试');
  assert.equal(
    entries.some((entry) => entry.kind === 'register'),
    false,
  );
  assert.equal(heroAccountLink('unavailable', null), null);
});

test('authenticated + user：账号条目（昵称 + /space + 用户名/邮箱），hero 引导主页', () => {
  const entries = navAccountEntries('authenticated', USER);
  assert.deepEqual(entries, [
    {
      kind: 'account',
      label: '林老师',
      to: '/space',
      email: 'lin@xiangsheng.local',
      username: 'lin',
      avatarUrl: null,
    },
  ]);
  assert.deepEqual(heroAccountLink('authenticated', USER), {
    kind: 'space',
    to: '/space',
    label: '个人主页',
  });
});

test('authenticated + 头像：条目携带头像 URL；空白头像回落 null', () => {
  const withAvatar = navAccountEntries('authenticated', AVATAR_USER);
  assert.deepEqual(withAvatar, [
    {
      kind: 'account',
      label: '林老师',
      to: '/space',
      email: 'lin@xiangsheng.local',
      username: 'lin',
      avatarUrl: '/api/v1/me/avatar?v=abc123',
    },
  ]);

  const blankAvatar = navAccountEntries('authenticated', { ...USER, avatar_url: '   ' });
  assert.equal(blankAvatar[0]?.kind, 'account');
  if (blankAvatar[0]?.kind === 'account') {
    assert.equal(blankAvatar[0].avatarUrl, null);
  }
});

test('authenticated + user=null：防御分支按访客渲染，hero 引导注册', () => {
  const entries = navAccountEntries('authenticated', null);
  assert.deepEqual(entries, [
    { kind: 'login', label: '登录', to: '/login', hint: null },
    { kind: 'register', label: '免费注册', to: '/register' },
  ]);
  assert.deepEqual(heroAccountLink('authenticated', null), {
    kind: 'register',
    to: '/register',
    label: '免费注册',
  });
});

test('accountDisplayName：空昵称与纯空白昵称回退邮箱，正常昵称去空白', () => {
  assert.equal(accountDisplayName(NO_NAME_USER), 'noname@xiangsheng.local');
  assert.equal(accountDisplayName(BLANK_NAME_USER), 'blank@xiangsheng.local');
  assert.equal(accountDisplayName({ ...USER, display_name: '  林老师  ' }), '林老师');
  assert.equal(accountDisplayName(USER), '林老师');
});

test('空昵称用户在 authenticated 态的账号条目同样回退邮箱', () => {
  const entries = navAccountEntries('authenticated', NO_NAME_USER);
  assert.deepEqual(entries, [
    {
      kind: 'account',
      label: 'noname@xiangsheng.local',
      to: '/space',
      email: 'noname@xiangsheng.local',
      username: null,
      avatarUrl: null,
    },
  ]);
});

test('纯函数：相同入参得到内容相同的条目，且返回值为冻结数组', () => {
  const first = navAccountEntries('guest', null);
  const second = navAccountEntries('guest', null);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(navAccountEntries('authenticated', USER)), true);
});

test('guest 条目中不包含账号菜单，restoring 不产生 loading 占位', () => {
  assert.equal(
    navAccountEntries('guest', null).some((entry) => entry.kind === 'account'),
    false,
  );
  assert.equal(
    navAccountEntries('restoring', USER).some((entry) => entry.kind === 'account'),
    false,
  );
});