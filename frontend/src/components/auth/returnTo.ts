/**
 * 登录成功后的回跳目标解析（契约 `C-LOGINPAGE@1` §1）。
 *
 * 只接受「站内相对路径」，避免 `/login` 成为开放重定向的入口：
 *  - 必须以单个 `/` 开头（拒绝 `https://…`、`javascript:…`）；
 *  - 不得以 `//` 开头（协议相对 URL 会跳到外站）；
 *  - 不得指向登录页自身（拒绝 `/login`、`/login?x=1`、`/login/…` 等回跳循环）；
 *  - 不得包含 `\` 或控制字符（浏览器会把 `\` 归一成 `/`，`/\evil.com` 等价于 `//evil.com`）；
 *  - 非法百分号编码一律按 fallback 处理，**不抛异常**。
 *
 * 任何一条不满足都返回 fallback（默认 `/space`）。返回原值时不改写大小写与查询串。
 */

/** 回跳默认目标：个人空间。 */
export const DEFAULT_RETURN_TO = '/space';

/** C0 控制字符与 DEL：地址栏可能据此截断或改写 URL。 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

/** 登录页自身的路径段（大小写不敏感，避免 `/Login` 之类的近似路径造成循环）。 */
const LOGIN_PATH = '/login';

/**
 * 从查询串里取出指定键的**原始**（未解码）值。
 *
 * 这里刻意不复用 `URLSearchParams`：它对非法百分号编码会静默替换成 `U+FFFD`，
 * 导致「坏编码」被当成合法路径；手工拆 `&`/`=` 后才能交给 `decodeURIComponent`
 * 做严格校验并在非法时回退。
 */
function readRawParam(source: string, key: string): string | null {
  for (const segment of source.split('&')) {
    const separatorIndex = segment.indexOf('=');
    const rawKey = separatorIndex === -1 ? segment : segment.slice(0, separatorIndex);
    if (rawKey !== key) continue;
    return separatorIndex === -1 ? '' : segment.slice(separatorIndex + 1);
  }
  return null;
}

/** 严格解码：`%`、`%ZZ`、残缺 UTF-8 等都会抛 `URIError`，此时返回 `null`。 */
function decodeStrict(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** 是否为登录页自身（`/login`、`/login?...`、`/login#...`、`/login/...`）。 */
function isLoginPath(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower === LOGIN_PATH ||
    lower.startsWith(`${LOGIN_PATH}?`) ||
    lower.startsWith(`${LOGIN_PATH}#`) ||
    lower.startsWith(`${LOGIN_PATH}/`)
  );
}

/**
 * 解析 `location.search` 中的 `returnTo` 参数并做安全校验。
 *
 * @param search 形如 `?returnTo=%2Fspace` 的查询串（也接受不带 `?` 的形式）。
 * @param fallback 校验不通过时的回退路径，默认 {@link DEFAULT_RETURN_TO}。
 */
export function safeReturnTo(search: string, fallback: string = DEFAULT_RETURN_TO): string {
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  if (normalized === '') return fallback;

  const raw = readRawParam(normalized, 'returnTo');
  if (raw === null || raw === '') return fallback;

  const value = decodeStrict(raw);
  if (value === null || value === '') return fallback;

  // 1) 站内相对路径：必须单个 '/' 开头（同时排除 //host 与外站绝对地址）
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  // 2) 不回跳登录页自身（含带查询串/哈希/子路径的变体）
  if (isLoginPath(value)) return fallback;

  // 3) 反斜杠与控制字符（`\` 会被浏览器归一为 `/`，可绕开上面的 // 检查）
  if (value.includes('\\')) return fallback;
  if (CONTROL_CHARACTER_PATTERN.test(value)) return fallback;

  return value;
}

export default safeReturnTo;