/**
 * accountScope.ts —— 账号范围（scope）与私有查询键判定的纯函数（契约 `C-SCOPE@1`）
 *
 * 为什么**零 import**：
 *  1. 本文件必须能被 `node --test` 直接加载（Node 的类型剥离不解析 `@/` 别名，
 *     也不做无扩展名导入的路径解析），因此不能依赖任何其它模块；
 *  2. 避免 `api/queryKeys.ts` → `state/accountSession.ts` → `api/` 的反向依赖成环。
 *
 * 规则（§2.2 C-SCOPE@1）：
 *  - `accountScopeOf(null)` 或空 `user_id` → `'guest'`；否则 `` `user:${user_id}` ``；
 *  - 私有查询键的第一段固定为 `PRIVATE_KEY_TAG`，账号切换时据此精准清理缓存；
 *  - 同一账号在任意组件中算出的 scope 必须完全相同（纯函数、无隐式状态）。
 */

/** 账号范围：访客或某个具体账号。`user` 段里的冒号在字符串键中安全。 */
export type AccountScope = 'guest' | `user:${string}`;

export const GUEST_SCOPE: AccountScope = 'guest';

/** 私有查询键的第一段标记；`queryKey[0] === PRIVATE_KEY_TAG` 即视为私有键。 */
export const PRIVATE_KEY_TAG = '@private';

/** `user:<user_id>` 中 user_id 的合法形状：1–64 位字母 / 数字 / 下划线 / 连字符。 */
const SCOPE_ID_PATTERN = /^user:[A-Za-z0-9_-]{1,64}$/;

/**
 * 由账号对象计算 scope；`null`、缺失 `user_id`、空白 `user_id` 一律回落访客。
 *
 * 对 `user_id` 做 `typeof` 收窄是刻意的防御：本函数接收的实参虽然来自已通过
 * `isAuthUser` 守卫的对象，但它同时被 T6 的草稿层复用，不能假设上游一定守卫过。
 */
export function accountScopeOf(user: { readonly user_id: string } | null): AccountScope {
  if (user === null) return GUEST_SCOPE;
  const rawUserId: unknown = user.user_id;
  if (typeof rawUserId !== 'string') return GUEST_SCOPE;
  const userId = rawUserId.trim();
  if (userId === '') return GUEST_SCOPE;
  return `user:${userId}`;
}

export function isAccountScope(value: unknown): value is AccountScope {
  if (value === GUEST_SCOPE) return true;
  return typeof value === 'string' && SCOPE_ID_PATTERN.test(value);
}

export function parseAccountScope(value: unknown): AccountScope | null {
  return isAccountScope(value) ? value : null;
}

/**
 * 是否为私有查询键。
 *
 * 只认第一段标记，不看后续结构：这样 `removeQueries({ predicate })` 能覆盖
 * 所有私有资源（materials / objects / runs / checks / jobs），而公开键
 * （`templates`、`p/*`、`lab-shares/*`）天然不被命中（R5-AC2）。
 */
export function isPrivateQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey.length > 0 && queryKey[0] === PRIVATE_KEY_TAG;
}

/** 账号切换时用于日志/提示的可读标签；**不含邮箱**，避免把凭据写进日志或界面。 */
export function formatScopeLabel(scope: AccountScope): string {
  if (scope === GUEST_SCOPE) return '访客';
  return `账号 ${scope.slice('user:'.length)}`;
}