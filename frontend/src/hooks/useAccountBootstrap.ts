/**
 * useAccountBootstrap.ts —— 账号恢复入口与唯一清理点（契约 `C-SESSION@1`）
 *
 * 两份职责，刻意放在同一个文件里：
 *  1. `AccountSessionBootstrap`：挂载即触发**一次** `GET /api/v1/me`，把结果落到
 *     `state/accountSession.ts` 这唯一的状态源（R4-AC1..AC3）；
 *  2. `useAccountSessionActions`：把登录 / 退出 / 重试 / 401 收口成页面可直接调用的
 *     动作，页面因此不需要触碰 HTTP 细节，也不用重复判断登录态。
 *
 * 同一组件还承担 scope 变化的**唯一**清理点（R5-AC2 / R5-AC5）：
 * scope 真正变化时移除全部私有查询缓存，并按旧 scope 清理本地草稿；
 * 公开键（`templates` / `p/*` / `lab-shares/*`）与其它账号的草稿一律保留。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, isApiError } from '@/api/client';
import type { LoginResult, MeResponse } from '@/api/types';
import { isPrivateQueryKey } from '@/state/accountScope';
import { UNAVAILABLE_MESSAGE, useAccountSessionStore } from '@/state/accountSession';
import { clearDraftsForScope } from '@/state/draftScope';

/** 退出结果：成功登出 / 保留登录态 / 服务不可用（同样保留登录态，文案不同）。 */
export type SignOutOutcome = 'signed-out' | 'kept-session' | 'unavailable';

export interface AccountSessionActions {
  applyLogin(result: LoginResult): void;
  signOut(): Promise<SignOutOutcome>;
  retryRestore(): void;
  notifyAuthRequired(): void;
  /** 重新读取 `/me` 并把账号与资料写回唯一状态源；失败时保持现状并返回 null。 */
  refreshAccount(): Promise<MeResponse | null>;
}

/**
 * 模块级去重：`StrictMode` 会双执行挂载副作用，这里保证并发期间只发一次 `/me`。
 * 恢复完成后置空，`retryRestore()` 由此可以真正重发一次。
 */
let inFlight: Promise<void> | null = null;

/** 单次恢复：beginRestore → `/me` → 三种结果之一，全部落到唯一状态源。 */
async function restoreOnce(): Promise<void> {
  useAccountSessionStore.getState().beginRestore();
  try {
    const me = await api.getMe();
    useAccountSessionStore.getState().applyMe(me);
  } catch (error) {
    const store = useAccountSessionStore.getState();
    // 401 AUTH_REQUIRED 表示"未登录"，不是服务故障（R4-AC2）
    if (isApiError(error, 'AUTH_REQUIRED')) {
      store.markGuest();
      return;
    }
    // 网络失败 / 非 JSON / 5xx：账号区降级，公开页面照常可浏览（R4-AC3）
    store.markUnavailable(UNAVAILABLE_MESSAGE, isApiError(error) ? error.code : null);
  }
}

/** 发起恢复；非强制时复用在途请求（去重）。 */
function requestRestore(force: boolean): Promise<void> {
  if (!force && inFlight !== null) return inFlight;
  const task = restoreOnce().finally(() => {
    if (inFlight === task) inFlight = null;
  });
  inFlight = task;
  return task;
}

function isAlreadySignedOut(error: unknown): boolean {
  return isApiError(error, 'AUTH_REQUIRED') || isApiError(error, 'SESSION_EXPIRED');
}

/** 失败归类：5xx / 依赖不可用视为"服务不可用"，其余保留登录态（R4-AC5）。 */
function failureOutcome(error: unknown): SignOutOutcome {
  return isApiError(error, 'MODEL_UNAVAILABLE') ? 'unavailable' : 'kept-session';
}

/**
 * 退出序列（§2.2 C-SESSION@1 `signOut()` 语义）：
 *  1. `logoutAccount()` 成功 / 401 → 已登出（幂等）；
 *  2. `MISSING_FIELD`（CSRF 缺失或失效）→ 用 `/me` 刷新账号 CSRF → 重试一次；
 *  3. 仍失败或依赖不可用 → 保留登录态。
 */
async function attemptLogout(): Promise<SignOutOutcome> {
  try {
    await api.logoutAccount();
    return 'signed-out';
  } catch (error) {
    if (isAlreadySignedOut(error)) return 'signed-out';
    if (!isApiError(error, 'MISSING_FIELD')) return failureOutcome(error);

    // CSRF 刷新失败说明连会话都读不到：保留登录态，交给页面提示重试
    try {
      await api.getMe();
    } catch (refreshError) {
      return failureOutcome(refreshError);
    }
    try {
      await api.logoutAccount();
      return 'signed-out';
    } catch (retryError) {
      if (isAlreadySignedOut(retryError)) return 'signed-out';
      return failureOutcome(retryError);
    }
  }
}

/**
 * 账号恢复挂载点。组件本身不渲染任何 DOM（返回 null），只负责副作用：
 *  - 首次挂载触发一次恢复（R4-AC1，StrictMode 去重）；
 *  - 订阅 scope 变化，做缓存 + 草稿的单点清理（R5-AC2 / R5-AC5）。
 */
export function AccountSessionBootstrap(): JSX.Element | null {
  const queryClient = useQueryClient();

  useEffect(() => {
    // 本次页面生命周期内已恢复过就不再打扰服务端（`retryRestore()` 可强制重来）
    if (useAccountSessionStore.getState().restoredOnce) return;
    void requestRestore(false);
  }, []);

  useEffect(() => {
    const unsubscribe = useAccountSessionStore.subscribe((state, previous) => {
      // 只有 scope 真正变化才清理；`restoring → guest` 两侧都是 guest，不产生清理
      if (previous.scope === state.scope) return;
      // 私有键全部移除：新 scope 的页面会按新键重新请求（不得用 invalidate 代替）
      queryClient.removeQueries({ predicate: (query) => isPrivateQueryKey(query.queryKey) });
      // 只删旧 scope 的草稿键：其它账号与访客的草稿保留（D-03 / R5-AC5）
      clearDraftsForScope(previous.scope);
    });
    return unsubscribe;
  }, [queryClient]);

  return null;
}

/**
 * 页面可调用的账号动作。
 *
 * 所有方法读写同一个 store；缓存/草稿清理由 `AccountSessionBootstrap` 的 scope
 * 监听统一完成，因此这里**不**接触 QueryClient，也不会另建 QueryClient 实例。
 * 返回值引用保持稳定，便于调用方放进 `useCallback` 依赖数组。
 */
export function useAccountSessionActions(): AccountSessionActions {
  const applyLogin = useCallback((result: LoginResult): void => {
    // 禁止在这里再调 `/me`：CSRF 已由 client.ts#loginAccount 写入账号缓存。
    useAccountSessionStore.getState().applyAuthenticated(result.user);
  }, []);

  const signOut = useCallback(async (): Promise<SignOutOutcome> => {
    const outcome = await attemptLogout();
    // 只有确实登出才清账号态；失败分支保留登录态与页面上的未提交内容
    if (outcome === 'signed-out') useAccountSessionStore.getState().clearAccount();
    return outcome;
  }, []);

  const retryRestore = useCallback((): void => {
    // 强制重来：跳过 `restoredOnce` 与在途去重，重新发起一次 `/me`
    void requestRestore(true);
  }, []);

  const notifyAuthRequired = useCallback((): void => {
    // 只用于私有请求的 AUTH_REQUIRED；访客 SESSION_EXPIRED 不得调用（R4-AC8）
    useAccountSessionStore.getState().markGuest();
  }, []);

  const refreshAccount = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const me = await api.getMe();
      useAccountSessionStore.getState().applyMe(me);
      return me;
    } catch {
      // 恢复失败不改变现有账号态：页面继续使用登录时拿到的账号信息。
      return null;
    }
  }, []);

  return useMemo(
    () => ({ applyLogin, signOut, retryRestore, notifyAuthRequired, refreshAccount }),
    [applyLogin, signOut, retryRestore, notifyAuthRequired, refreshAccount],
  );
}

/**
 * 已登录但尚未拿到资料（刚登录、状态来自 LoginResult）时补一次 `/me`。
 * 个人主页与设置页共用，避免各自重复请求。
 */
export function useEnsureAccountProfile(): void {
  const status = useAccountSessionStore((state) => state.status);
  const profile = useAccountSessionStore((state) => state.profile);
  const { refreshAccount } = useAccountSessionActions();
  const requestedRef = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || profile !== null) {
      requestedRef.current = false;
      return;
    }
    if (requestedRef.current) return;
    requestedRef.current = true;
    void refreshAccount();
  }, [status, profile, refreshAccount]);
}