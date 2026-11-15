/**
 * authContract.test.ts —— C-WEBAPI@1 / C-ERR@2 的纯 Node 单测。
 *
 * 约束（C-WEBAPI@1 第 4 条）：
 *  - 只允许 import `./types.ts` 与 `node:assert/strict`、`node:test`；
 *  - **禁止** import `./client.ts` / `./mockClient.ts`：它们读取 `import.meta.env`，
 *    在 `node --test` 下不可用。本文件只测类型守卫与错误码元数据。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ERROR_CODES, ERROR_CODE_META, isAuthUser, isMeResponse, isSendRegisterCodeResult } from './types.ts';

/** C-ERR@1 既有 8 码：顺序与取值在本计划中冻结，只允许在末尾追加。 */
const LEGACY_CODES: readonly string[] = [
  'INVALID_FILE',
  'LIMIT_EXCEEDED',
  'PARSE_FAILED',
  'MODEL_UNAVAILABLE',
  'UNSUPPORTED_TEMPLATE',
  'MISSING_FIELD',
  'VERSION_CONFLICT',
  'SESSION_EXPIRED',
];

/** C-ERR@2 追加 6 码（顺序与 §2.2 C-ERR@2 表一致）。 */
const AUTH_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'EMAIL_ALREADY_REGISTERED',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'RATE_LIMITED',
];

/** C-ERR@3 追加 1 码。 */
const USERNAME_CODES: readonly string[] = ['USERNAME_ALREADY_REGISTERED'];

/** 构造一份合法的 `AuthUser` JSON 形状（未收窄前的 unknown 输入）。 */
function authUserRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: 'usr_0123456789abcdef0123456789abcdef',
    username: 'lin_teacher',
    email: 'a@example.com',
    display_name: 'a',
    status: 'active',
    created_at: '2026-11-07T05:00:00Z',
    email_verification: 'disabled_development',
    ...overrides,
  };
}

/** 构造一份合法的账号资料 JSON 形状（`/me` 的 `profile`）。 */
function profileRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bio: '',
    occupation: '',
    school: '',
    phone: '',
    interests: [],
    preferred_subject: '',
    default_entry: 'space',
    updated_at: '2026-11-07T05:01:00Z',
    ...overrides,
  };
}

/** 构造一份合法的 `MeResponse` JSON 形状。 */
function meResponseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user: authUserRecord(),
    session: {
      session_id: 'aut_0123456789abcdef0123456789abcdef',
      expires_at: '2026-11-07T17:00:00Z',
      idle_expires_at: '2026-11-07T17:00:00Z',
    },
    csrf_token: 'csrf-token-43-chars',
    profile: profileRecord(),
    ...overrides,
  };
}

test('错误码白名单：既有 8 码在前、新增码在后，共 15 个且无重复', () => {
  assert.equal(ERROR_CODES.length, 15);
  assert.deepEqual(ERROR_CODES.slice(0, 8), LEGACY_CODES);
  assert.deepEqual(ERROR_CODES.slice(8, 14), AUTH_CODES);
  assert.deepEqual(ERROR_CODES.slice(14), USERNAME_CODES);
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length, '白名单不得有重复项');
  for (const code of LEGACY_CODES) assert.ok((ERROR_CODES as readonly string[]).includes(code), code);
  for (const code of AUTH_CODES) assert.ok((ERROR_CODES as readonly string[]).includes(code), code);
  for (const code of USERNAME_CODES) assert.ok((ERROR_CODES as readonly string[]).includes(code), code);
});

test('既有 8 码的 http / retryable 语义未被改动', () => {
  assert.equal(ERROR_CODE_META.INVALID_FILE.http, 400);
  assert.equal(ERROR_CODE_META.INVALID_FILE.retryable, false);
  assert.equal(ERROR_CODE_META.LIMIT_EXCEEDED.http, 413);
  assert.equal(ERROR_CODE_META.LIMIT_EXCEEDED.retryable, false);
  assert.equal(ERROR_CODE_META.PARSE_FAILED.http, 422);
  assert.equal(ERROR_CODE_META.PARSE_FAILED.retryable, true);
  assert.equal(ERROR_CODE_META.MODEL_UNAVAILABLE.http, 503);
  assert.equal(ERROR_CODE_META.MODEL_UNAVAILABLE.retryable, true);
  assert.equal(ERROR_CODE_META.UNSUPPORTED_TEMPLATE.http, 422);
  assert.equal(ERROR_CODE_META.UNSUPPORTED_TEMPLATE.retryable, false);
  assert.equal(ERROR_CODE_META.MISSING_FIELD.http, 422);
  assert.equal(ERROR_CODE_META.MISSING_FIELD.retryable, false);
  assert.equal(ERROR_CODE_META.VERSION_CONFLICT.http, 409);
  assert.equal(ERROR_CODE_META.VERSION_CONFLICT.retryable, false);
  assert.equal(ERROR_CODE_META.SESSION_EXPIRED.http, 401);
  assert.equal(ERROR_CODE_META.SESSION_EXPIRED.retryable, false);
});

test('新增 6 码的 http / retryable / message 与 C-ERR@2 表逐项一致', () => {
  assert.deepEqual(ERROR_CODE_META.AUTH_REQUIRED, {
    http: 401,
    retryable: false,
    message: '请先登录',
  });
  assert.deepEqual(ERROR_CODE_META.INVALID_CREDENTIALS, {
    http: 401,
    retryable: false,
    message: '用户名或密码不正确',
  });
  assert.deepEqual(ERROR_CODE_META.EMAIL_ALREADY_REGISTERED, {
    http: 409,
    retryable: false,
    message: '该邮箱已注册，可直接登录',
  });
  assert.deepEqual(ERROR_CODE_META.FORBIDDEN, {
    http: 403,
    retryable: false,
    message: '账号不可用，请联系管理员',
  });
  assert.deepEqual(ERROR_CODE_META.EMAIL_NOT_VERIFIED, {
    http: 403,
    retryable: false,
    message: '请先完成邮箱验证',
  });
  assert.deepEqual(ERROR_CODE_META.RATE_LIMITED, {
    http: 429,
    retryable: false,
    message: '请求过于频繁，请稍后再试',
  });
});

test('ERROR_CODE_META 对全部 15 个码都有完整条目', () => {
  for (const code of ERROR_CODES) {
    const meta = ERROR_CODE_META[code];
    assert.equal(typeof meta.http, 'number', code + ' 缺少 http');
    assert.equal(typeof meta.retryable, 'boolean', code + ' 缺少 retryable');
    assert.equal(typeof meta.message, 'string', code + ' 缺少 message');
    assert.ok(meta.message.length > 0, code + ' 的 message 不得为空');
  }
});

test('isAuthUser：合法对象返回 true 并收窄字段', () => {
  const value: unknown = authUserRecord();
  assert.equal(isAuthUser(value), true);
  if (isAuthUser(value)) {
    assert.equal(value.user_id, 'usr_0123456789abcdef0123456789abcdef');
    assert.equal(value.username, 'lin_teacher');
    assert.equal(value.email, 'a@example.com');
    assert.equal(value.status, 'active');
    assert.equal(value.email_verification, 'disabled_development');
    assert.equal(value.created_at, '2026-11-07T05:00:00Z');
  }
});

test('isAuthUser：缺字段 / 错状态 / 未知验证标记 / 非对象一律返回 false', () => {
  assert.equal(isAuthUser(authUserRecord({ user_id: undefined })), false);
  assert.equal(isAuthUser(authUserRecord({ username: undefined })), false);
  assert.equal(isAuthUser(authUserRecord({ username: '' })), false);
  assert.equal(isAuthUser(authUserRecord({ email: undefined })), false);
  assert.equal(isAuthUser(authUserRecord({ display_name: undefined })), false);
  assert.equal(isAuthUser(authUserRecord({ created_at: undefined })), false);
  assert.equal(isAuthUser(authUserRecord({ email: '' })), false, '空字符串不视为有效值');
  assert.equal(isAuthUser(authUserRecord({ status: 'suspended' })), false);
  assert.equal(isAuthUser(authUserRecord({ status: 'deleted' })), false);
  assert.equal(isAuthUser(authUserRecord({ email_verification: 'enabled' })), false);
  assert.equal(isAuthUser(authUserRecord({ email_verification: null })), false);
  assert.equal(isAuthUser(authUserRecord({ user_id: 42 })), false);
});

test('isAuthUser：邮箱验证标记 verified 合法（注册验证码通过）', () => {
  const value: unknown = authUserRecord({ email_verification: 'verified' });
  assert.equal(isAuthUser(value), true);
  if (isAuthUser(value)) {
    assert.equal(value.email_verification, 'verified');
  }
});

test('isAuthUser：null / 数组 / 原始值都不抛异常且返回 false', () => {
  assert.equal(isAuthUser(null), false);
  assert.equal(isAuthUser(undefined), false);
  assert.equal(isAuthUser([]), false);
  assert.equal(isAuthUser([authUserRecord()]), false);
  assert.equal(isAuthUser('a@example.com'), false);
  assert.equal(isAuthUser(0), false);
  assert.equal(isAuthUser({}), false);
});

test('isMeResponse：合法对象返回 true', () => {
  const value: unknown = meResponseRecord();
  assert.equal(isMeResponse(value), true);
  if (isMeResponse(value)) {
    assert.equal(value.user.email, 'a@example.com');
    assert.equal(value.session.session_id, 'aut_0123456789abcdef0123456789abcdef');
    assert.equal(value.session.idle_expires_at, value.session.expires_at);
    assert.equal(value.csrf_token, 'csrf-token-43-chars');
    assert.equal(value.profile.default_entry, 'space');
    assert.deepEqual(value.profile.interests, []);
  }
});

test('isAuthUser：avatar_url 缺省 / null / 字符串都合法，其它类型拒绝', () => {
  assert.equal(isAuthUser(authUserRecord()), true);
  assert.equal(isAuthUser(authUserRecord({ avatar_url: null })), true);
  assert.equal(isAuthUser(authUserRecord({ avatar_url: '/api/v1/me/avatar?v=abc' })), true);
  assert.equal(isAuthUser(authUserRecord({ avatar_url: 42 })), false);
});

test('isMeResponse：profile 缺失 / 偏好枚举非法一律返回 false', () => {
  const withoutProfile: Record<string, unknown> = { ...meResponseRecord() };
  delete withoutProfile['profile'];
  assert.equal(isMeResponse(withoutProfile), false, '缺 profile');
  assert.equal(isMeResponse(meResponseRecord({ profile: null })), false);
  assert.equal(
    isMeResponse(meResponseRecord({ profile: profileRecord({ default_entry: 'home' }) })),
    false,
    'default_entry 只允许 space / labs',
  );
  assert.equal(
    isMeResponse(meResponseRecord({ profile: profileRecord({ interests: [1] }) })),
    false,
    'interests 必须是字符串数组',
  );
  assert.equal(
    isMeResponse(meResponseRecord({ profile: profileRecord({ phone: undefined }) })),
    false,
    'phone 必须存在（后端始终返回字符串，空串表示未填写）',
  );
});

test('isMeResponse：session 缺键 / csrf 非法 / user 非法一律返回 false', () => {
  const withoutSession: Record<string, unknown> = { ...meResponseRecord() };
  delete withoutSession['session'];
  assert.equal(isMeResponse(withoutSession), false);
  assert.equal(isMeResponse(meResponseRecord({ session: null })), false);
  assert.equal(isMeResponse(meResponseRecord({ session: 'session' })), false);
  assert.equal(
    isMeResponse(meResponseRecord({ session: { session_id: 'aut_1', expires_at: 'x' } })),
    false,
    '缺 idle_expires_at',
  );
  assert.equal(
    isMeResponse(
      meResponseRecord({
        session: { expires_at: 'x', idle_expires_at: 'x' },
      }),
    ),
    false,
    '缺 session_id',
  );
  assert.equal(
    isMeResponse(meResponseRecord({ session: { session_id: 'aut_1', idle_expires_at: 'x' } })),
    false,
    '缺 expires_at',
  );
  assert.equal(isMeResponse(meResponseRecord({ csrf_token: '' })), false);
  assert.equal(isMeResponse(meResponseRecord({ csrf_token: null })), false);
  assert.equal(isMeResponse(meResponseRecord({ user: authUserRecord({ status: 'suspended' }) })), false);
  assert.equal(isMeResponse(meResponseRecord({ user: null })), false);
});

test('isMeResponse：null / 数组 / 原始值都不抛异常且返回 false', () => {
  assert.equal(isMeResponse(null), false);
  assert.equal(isMeResponse(undefined), false);
  assert.equal(isMeResponse([]), false);
  assert.equal(isMeResponse({}), false);
  assert.equal(isMeResponse('me'), false);
  assert.equal(isMeResponse(1), false);
});

test('isSendRegisterCodeResult：合法形状收窄，缺字段 / 错类型一律拒绝', () => {
  const value: unknown = {
    email: 'a@example.com',
    expires_in_seconds: 300,
    resend_after_seconds: 60,
  };
  assert.equal(isSendRegisterCodeResult(value), true);
  if (isSendRegisterCodeResult(value)) {
    assert.equal(value.expires_in_seconds, 300);
    assert.equal(value.resend_after_seconds, 60);
  }

  assert.equal(isSendRegisterCodeResult({ ...value, email: '' }), false);
  assert.equal(isSendRegisterCodeResult({ ...value, expires_in_seconds: '300' }), false);
  assert.equal(isSendRegisterCodeResult({ email: 'a@example.com' }), false);
  assert.equal(isSendRegisterCodeResult(null), false);
  assert.equal(isSendRegisterCodeResult([]), false);
  assert.equal(isSendRegisterCodeResult('ok'), false);
});