/**
 * `registerFields` 的纯函数单测（契约 `C-REGISTER-UI@1` 的校验表）。
 *
 * 运行：`cd frontend && node --test "src/components/auth/registerFields.test.ts"`
 *
 * 覆盖计划 §3.1 T4 acceptance 第 1 条列举的全部边界：
 * 合法值、缺 `@`、两个 `@`、本地部分 65 字符、域名无 `.`、TLD 1 字符、
 * 邮箱 321 字符、密码 7/129 字符、确认密码不一致、`displayName` 65 字符，
 * 以及 `buildRegisterPayload` 的键存在性与大小写保留。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMAIL_AT_ERROR,
  EMAIL_DOMAIN_ERROR,
  EMAIL_LENGTH_ERROR,
  EMAIL_LOCAL_ERROR,
  EMAIL_TLD_ERROR,
  PASSWORD_CONFIRM_ERROR,
  PASSWORD_LENGTH_ERROR,
  DISPLAY_NAME_LENGTH_ERROR,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_CHARSET_ERROR,
  USERNAME_LENGTH_ERROR,
  USERNAME_START_ERROR,
  buildRegisterPayload,
  validateRegisterValues,
} from './registerFields.ts';
import type { RegisterFormValues } from './registerFields.ts';

/** 一个校验可通过的基准值；用例只覆盖需要变化的字段。 */
function makeValues(overrides: Partial<RegisterFormValues> = {}): RegisterFormValues {
  const password = 'x'.repeat(MIN_PASSWORD_LENGTH);
  return {
    username: 'lin_teacher',
    email: 'user@example.com',
    password,
    confirmPassword: password,
    displayName: '',
    identityTag: '',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* 通过路径                                                                    */
/* -------------------------------------------------------------------------- */

test('合法值返回空对象', () => {
  assert.deepEqual(validateRegisterValues(makeValues()), {});
});

test('密码首尾空格计入长度且不 trim', () => {
  const password = `  ${'x'.repeat(MIN_PASSWORD_LENGTH)}  `;
  const errors = validateRegisterValues(makeValues({ password, confirmPassword: password }));
  assert.deepEqual(errors, {});
});

test('密码 8 与 128 字符均为合法边界', () => {
  const short = 'x'.repeat(MIN_PASSWORD_LENGTH);
  const long = 'x'.repeat(MAX_PASSWORD_LENGTH);
  assert.deepEqual(validateRegisterValues(makeValues({ password: short, confirmPassword: short })), {});
  assert.deepEqual(validateRegisterValues(makeValues({ password: long, confirmPassword: long })), {});
});

test('称呼 64 字符与仅空白均合法', () => {
  const atLimit = makeValues({ displayName: '名'.repeat(MAX_DISPLAY_NAME_LENGTH) });
  assert.deepEqual(validateRegisterValues(atLimit), {});
  assert.deepEqual(validateRegisterValues(makeValues({ displayName: '   ' })), {});
});

/* -------------------------------------------------------------------------- */
/* 用户名边界                                                                  */
/* -------------------------------------------------------------------------- */

test('用户名 3 与 20 字符均为合法边界', () => {
  assert.deepEqual(validateRegisterValues(makeValues({ username: 'a'.repeat(MIN_USERNAME_LENGTH) })), {});
  assert.deepEqual(validateRegisterValues(makeValues({ username: 'a'.repeat(MAX_USERNAME_LENGTH) })), {});
});

test('用户名支持中文、下划线与短横线', () => {
  assert.deepEqual(validateRegisterValues(makeValues({ username: '林老师' })), {});
  assert.deepEqual(validateRegisterValues(makeValues({ username: 'student-a_01' })), {});
});

test('用户名过短或过长时给出长度错误', () => {
  assert.equal(
    validateRegisterValues(makeValues({ username: 'a'.repeat(MIN_USERNAME_LENGTH - 1) })).username,
    USERNAME_LENGTH_ERROR,
  );
  assert.equal(
    validateRegisterValues(makeValues({ username: 'a'.repeat(MAX_USERNAME_LENGTH + 1) })).username,
    USERNAME_LENGTH_ERROR,
  );
});

test('用户名首字符非字母时给出首字符错误', () => {
  assert.equal(validateRegisterValues(makeValues({ username: '1alice' })).username, USERNAME_START_ERROR);
  assert.equal(validateRegisterValues(makeValues({ username: '_alice' })).username, USERNAME_START_ERROR);
});

test('用户名含空白或特殊符号时给出字符集错误', () => {
  assert.equal(validateRegisterValues(makeValues({ username: 'ali ce' })).username, USERNAME_CHARSET_ERROR);
  assert.equal(validateRegisterValues(makeValues({ username: 'alice.bob' })).username, USERNAME_CHARSET_ERROR);
  assert.equal(validateRegisterValues(makeValues({ username: 'alice@x' })).username, USERNAME_CHARSET_ERROR);
});

/* -------------------------------------------------------------------------- */
/* 邮箱边界                                                                    */
/* -------------------------------------------------------------------------- */

test('缺少 @ 时给出 @ 数量错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'userexample.com' }));
  assert.equal(errors.email, EMAIL_AT_ERROR);
});

test('包含两个 @ 时给出 @ 数量错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user@example@com' }));
  assert.equal(errors.email, EMAIL_AT_ERROR);
});

test('本地部分 65 字符时给出本地部分错误', () => {
  const errors = validateRegisterValues(makeValues({ email: `${'a'.repeat(65)}@example.com` }));
  assert.equal(errors.email, EMAIL_LOCAL_ERROR);
});

test('本地部分含空格时给出本地部分错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user name@example.com' }));
  assert.equal(errors.email, EMAIL_LOCAL_ERROR);
});

test('域名不含 . 时给出域名错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user@example' }));
  assert.equal(errors.email, EMAIL_DOMAIN_ERROR);
});

test('域名以 . 结尾时给出域名错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user@example.' }));
  assert.equal(errors.email, EMAIL_DOMAIN_ERROR);
});

test('域名包含连续 .. 时给出域名错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user@example..com' }));
  assert.equal(errors.email, EMAIL_DOMAIN_ERROR);
});

test('TLD 只有 1 字符时给出末段错误', () => {
  const errors = validateRegisterValues(makeValues({ email: 'user@example.c' }));
  assert.equal(errors.email, EMAIL_TLD_ERROR);
});

test('邮箱 321 字符时给出长度错误', () => {
  const email = `${'a'.repeat(309)}@example.com`; // 309 + 12 = 321
  assert.equal(email.length, 321);
  const errors = validateRegisterValues(makeValues({ email }));
  assert.equal(errors.email, EMAIL_LENGTH_ERROR);
});

test('邮箱 320 字符时为合法边界（无格式错误）', () => {
  // 本地部分 64 + '@' + 域名 255 = 320，各段都在契约上限内
  const email = `${'a'.repeat(64)}@${'b'.repeat(251)}.com`;
  assert.equal(email.length, 320);
  const errors = validateRegisterValues(makeValues({ email }));
  assert.equal(errors.email, undefined);
});

test('邮箱前后空白被忽略（trim 后校验）', () => {
  assert.deepEqual(validateRegisterValues(makeValues({ email: '  user@example.com  ' })), {});
});

/* -------------------------------------------------------------------------- */
/* 密码与确认密码                                                              */
/* -------------------------------------------------------------------------- */

test('密码 7 字符时给出长度错误', () => {
  const password = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
  const errors = validateRegisterValues(makeValues({ password, confirmPassword: password }));
  assert.equal(errors.password, PASSWORD_LENGTH_ERROR);
});

test('密码 129 字符时给出长度错误', () => {
  const password = 'x'.repeat(MAX_PASSWORD_LENGTH + 1);
  const errors = validateRegisterValues(makeValues({ password, confirmPassword: password }));
  assert.equal(errors.password, PASSWORD_LENGTH_ERROR);
});

test('两次密码不一致时给出确认密码错误', () => {
  const errors = validateRegisterValues(
    makeValues({ password: 'x'.repeat(MIN_PASSWORD_LENGTH), confirmPassword: 'y'.repeat(MIN_PASSWORD_LENGTH) }),
  );
  assert.equal(errors.confirmPassword, PASSWORD_CONFIRM_ERROR);
});

/* -------------------------------------------------------------------------- */
/* 称呼与多字段错误                                                            */
/* -------------------------------------------------------------------------- */

test('称呼 65 字符时给出长度错误', () => {
  const errors = validateRegisterValues(makeValues({ displayName: '名'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }));
  assert.equal(errors.displayName, DISPLAY_NAME_LENGTH_ERROR);
});

test('多个字段同时非法时一次返回全部错误', () => {
  const errors = validateRegisterValues({
    username: '1alice',
    email: 'userexample.com',
    password: 'short',
    confirmPassword: 'short',
    displayName: '名'.repeat(MAX_DISPLAY_NAME_LENGTH + 1),
    identityTag: '',
  });
  assert.equal(errors.username, USERNAME_START_ERROR);
  assert.equal(errors.email, EMAIL_AT_ERROR);
  assert.equal(errors.password, PASSWORD_LENGTH_ERROR);
  assert.equal(errors.confirmPassword, undefined); // 两个密码一致 → 不报
  assert.equal(errors.displayName, DISPLAY_NAME_LENGTH_ERROR);
});

test('校验不修改入参', () => {
  const values = makeValues({ email: 'userexample.com' });
  const snapshot = { ...values };
  validateRegisterValues(values);
  assert.deepEqual(values, snapshot);
});

/* -------------------------------------------------------------------------- */
/* buildRegisterPayload                                                        */
/* -------------------------------------------------------------------------- */

test('称呼为空白时 payload 不含 display_name 键', () => {
  const payload = buildRegisterPayload(makeValues({ displayName: '   ' }));
  assert.equal('display_name' in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), ['email', 'password', 'username']);
});

test('称呼非空时 payload 含 display_name 且保留原大小写', () => {
  const payload = buildRegisterPayload(makeValues({ displayName: '  Zhang San  ' }));
  assert.equal(payload.display_name, 'Zhang San');
});

test('payload 不含 identity_tag 键（身份标签不提交，D-01）', () => {
  const payload = buildRegisterPayload(makeValues({ identityTag: 'teacher' }));
  assert.equal('identity_tag' in payload, false);
  assert.equal('identityTag' in payload, false);
});

test('payload 的 username/email 去掉首尾空白但保留大小写，密码原样提交', () => {
  const password = `  ${'x'.repeat(MIN_PASSWORD_LENGTH)}  `;
  const payload = buildRegisterPayload(
    makeValues({
      username: '  Lin_Teacher  ',
      email: '  User@Example.COM  ',
      password,
      confirmPassword: password,
    }),
  );
  assert.equal(payload.username, 'Lin_Teacher');
  assert.equal(payload.email, 'User@Example.COM');
  assert.equal(payload.password, password);
});