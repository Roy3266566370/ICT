/**
 * 注册表单的本地校验与请求体组装（契约 `C-REGISTER-UI@1`）。
 *
 * 本文件**零 import**：规则与后端 `backend/app/accounts/identities.py` 逐条一致，
 * 可被 `node --test` 直接加载（见 `registerFields.test.ts`）。
 *
 * 设计要点：
 *  - 不修改入参（`RegisterFormValues` 全字段 `readonly`），返回全新的错误对象；
 *  - 每个字段独立校验、一次性返回全部字段错误，便于同时高亮多个输入框；
 *  - 长度按 Unicode 码点计数（`Array.from(text).length`），与后端 `len(str)` 对齐，
 *    避免 emoji / 全角字符在两端得出不同的长度；
 *  - 身份标签（`identityTag`）只做展示，不参与校验，也**不进入请求体**（决策 D-01）。
 */

/** 「称呼/身份」的可选标签；本轮不落库（D-01）。 */
export type IdentityTag = 'student' | 'teacher' | 'researcher' | 'enterprise' | 'other';

export interface RegisterFormValues {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly displayName: string;
  /** 仅展示，不提交（D-01） */
  readonly identityTag: IdentityTag | '';
}

export interface RegisterFieldErrors {
  readonly username?: string;
  readonly email?: string;
  readonly password?: string;
  readonly confirmPassword?: string;
  readonly displayName?: string;
}

/* -------------------------------------------------------------------------- */
/* 阈值常量（与后端 identities.py / passwords.py 逐值一致）                    */
/* -------------------------------------------------------------------------- */

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;
export const MIN_EMAIL_LENGTH = 3;
export const MAX_EMAIL_LENGTH = 320;
/** 邮箱 `@` 前本地部分的最大长度。 */
export const EMAIL_LOCAL_MAX_LENGTH = 64;
/** 域名末段（TLD）最小长度。 */
export const MIN_TLD_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_DISPLAY_NAME_LENGTH = 64;

/* -------------------------------------------------------------------------- */
/* 错误文案（契约 §2.2 校验表逐字一致；界面直接展示，禁止回显输入值）           */
/* -------------------------------------------------------------------------- */

export const USERNAME_LENGTH_ERROR = '用户名长度需为 3–20 个字符';
export const USERNAME_START_ERROR = '用户名需以字母开头';
export const USERNAME_CHARSET_ERROR = '用户名只能包含字母、数字、下划线或短横线';
export const EMAIL_LENGTH_ERROR = '邮箱长度需为 3–320 个字符';
export const EMAIL_AT_ERROR = '邮箱必须且只能包含一个 @';
export const EMAIL_LOCAL_ERROR = '邮箱 @ 前的部分需为 1–64 个字符且不含空格';
export const EMAIL_DOMAIN_ERROR = '邮箱域名格式不合法';
export const EMAIL_TLD_ERROR = '邮箱域名末段至少需要 2 个字符';
export const PASSWORD_LENGTH_ERROR = `密码长度需为 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 个字符`;
export const PASSWORD_CONFIRM_ERROR = '两次输入的密码不一致';
export const DISPLAY_NAME_LENGTH_ERROR = '称呼最多 64 个字符';

/** 身份标签下拉项；页面渲染用，`value` 不进入请求体。 */
export const IDENTITY_TAGS: readonly { readonly value: IdentityTag; readonly label: string }[] = [
  { value: 'student', label: '学生' },
  { value: 'teacher', label: '教师' },
  { value: 'researcher', label: '研究者' },
  { value: 'enterprise', label: '企业员工' },
  { value: 'other', label: '其他' },
];

/** Unicode 空白（含全角空格、不换行空格），与后端 `str.isspace()` 对齐。 */
const WHITESPACE_PATTERN = /\s/u;

/** 按 Unicode 码点计数（`'😀'.length === 2`，但这里应计为 1）。 */
function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** 用户名允许的字母/数字判断：与后端 `str.isalpha()` / `str.isdecimal()` 对齐。 */
const LETTER_PATTERN = /^\p{L}$/u;
const DECIMAL_PATTERN = /^\p{Nd}$/u;

/** 校验用户名；合法返回 `null`，非法返回可直接展示的中文文案。 */
function validateUsername(rawUsername: string): string | null {
  const username = rawUsername.trim();
  const length = countCharacters(username);
  if (length < MIN_USERNAME_LENGTH || length > MAX_USERNAME_LENGTH) {
    return USERNAME_LENGTH_ERROR;
  }

  const characters = Array.from(username);
  const first = characters[0] ?? '';
  if (!LETTER_PATTERN.test(first)) {
    return USERNAME_START_ERROR;
  }

  for (const character of characters.slice(1)) {
    if (LETTER_PATTERN.test(character) || DECIMAL_PATTERN.test(character)) continue;
    if (character === '_' || character === '-') continue;
    return USERNAME_CHARSET_ERROR;
  }

  return null;
}

/** 校验邮箱；合法返回 `null`，非法返回可直接展示的中文文案。 */
function validateEmail(rawEmail: string): string | null {
  const email = rawEmail.trim();

  const length = countCharacters(email);
  if (length < MIN_EMAIL_LENGTH || length > MAX_EMAIL_LENGTH) {
    return EMAIL_LENGTH_ERROR;
  }

  // 逐字符计数，避免 `split('@')` 在 `noUncheckedIndexedAccess` 下的空值推断
  let atCount = 0;
  for (const character of email) {
    if (character === '@') atCount += 1;
  }
  if (atCount !== 1) {
    return EMAIL_AT_ERROR;
  }

  const atIndex = email.indexOf('@');
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  const localLength = countCharacters(local);
  if (localLength < 1 || localLength > EMAIL_LOCAL_MAX_LENGTH || WHITESPACE_PATTERN.test(local)) {
    return EMAIL_LOCAL_ERROR;
  }

  if (
    WHITESPACE_PATTERN.test(domain) ||
    domain.includes('@') ||
    !domain.includes('.') ||
    domain.startsWith('.') ||
    domain.endsWith('.') ||
    domain.includes('..')
  ) {
    return EMAIL_DOMAIN_ERROR;
  }

  // 走到这里说明 domain 至少含一个 '.'，lastIndexOf 必然 ≥ 0
  const lastDotIndex = domain.lastIndexOf('.');
  const tld = domain.slice(lastDotIndex + 1);
  if (countCharacters(tld) < MIN_TLD_LENGTH) {
    return EMAIL_TLD_ERROR;
  }

  return null;
}

/**
 * 校验注册表单；返回空对象 `{}` 表示通过。
 *
 * 不修改入参，也不依赖任何外部状态（纯函数）。
 */
export function validateRegisterValues(values: RegisterFormValues): RegisterFieldErrors {
  const errors: {
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    displayName?: string;
  } = {};

  const usernameError = validateUsername(values.username);
  if (usernameError !== null) {
    errors.username = usernameError;
  }

  const emailError = validateEmail(values.email);
  if (emailError !== null) {
    errors.email = emailError;
  }

  // 密码不 trim：首尾空格也是用户输入的一部分，长度按原值计算
  const passwordLength = countCharacters(values.password);
  if (passwordLength < MIN_PASSWORD_LENGTH || passwordLength > MAX_PASSWORD_LENGTH) {
    errors.password = PASSWORD_LENGTH_ERROR;
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = PASSWORD_CONFIRM_ERROR;
  }

  // 称呼可留空；只有去掉首尾空白后仍超长才报错
  if (countCharacters(values.displayName.trim()) > MAX_DISPLAY_NAME_LENGTH) {
    errors.displayName = DISPLAY_NAME_LENGTH_ERROR;
  }

  return errors;
}

/**
 * 组装 `POST /api/v1/auth/register` 的请求体。
 *
 * 用户名与邮箱都去掉首尾空白但保留大小写；省略 `display_name` 的条件与
 * `api/client.ts#registerAccount` 保持一致：`trim()` 后为空即视为「未填写」，
 * 请求体中**不出现**该键（R3-AC6）。
 *
 * `identity_tag` 永远不出现：身份标签本轮只做展示（D-01）。
 */
export function buildRegisterPayload(
  values: RegisterFormValues,
): { username: string; email: string; password: string; display_name?: string } {
  const payload: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
  } = {
    username: values.username.trim(),
    email: values.email.trim(),
    password: values.password,
  };

  const displayName = values.displayName.trim();
  if (displayName !== '') {
    payload.display_name = displayName;
  }

  return payload;
}

export default validateRegisterValues;