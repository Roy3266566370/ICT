/**
 * accountSession.ts —— 账号会话的**唯一**状态源（契约 `C-SESSION@1`）
 *
 * 单写者约束（plan §1.2 第 7 条 / §2.3 R4-AC7）：账号四态（`restoring` /
 * `authenticated` / `guest` / `unavailable`）与 `AccountScope` 只在此处产生。
 * 页面与组件一律通过本文件的 selector 读取，**不得**各自调用 `/me` 判定登录态，
 * 也不得用邮箱等字段自行拼 scope。
 *
 * 状态转移表见 §2.2 C-SESSION@1（唯一权威）：
 *
 * | 事件                 | 后置                                                        |
 * |----------------------|-------------------------------------------------------------|
 * | `beginRestore()`     | restoring / user=null / scope=guest / message=null            |
 * | `applyMe(me)`        | 等同 `applyAuthenticated(me.user)`                          |
 * | `applyAuthenticated()` | authenticated / scope=user:<id> / restoredOnce=true        |
 * | `markGuest()`        | guest / user=null / scope=guest / restoredOnce=true          |
 * | `markUnavailable()`  | unavailable / user=null / scope=guest / message+errorCode    |
 * | `clearAccount()`     | guest / user=null / scope=guest / errorCode=null             |
 *
 * 所有写入都是不可变补丁（Zustand `set(partial)`），禁止就地修改 state 对象；
 * selector 只订阅自己需要的最小切片，避免无关字段变化引发全树重渲染。
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AuthUser, ErrorCode, MeResponse, UserProfile } from '@/api/types';
import { accountScopeOf, GUEST_SCOPE, type AccountScope } from './accountScope';

export type AccountStatus = 'restoring' | 'authenticated' | 'guest' | 'unavailable';

export interface AccountSessionSnapshot {
  readonly status: AccountStatus;
  readonly user: AuthUser | null;
  /** 资料与偏好：由 `/me` 恢复或资料接口回写；刚登录尚未拉取时为 null。 */
  readonly profile: UserProfile | null;
  readonly scope: AccountScope;
  /** status==='unavailable' 时的中文原因；其它状态为 null */
  readonly message: string | null;
  /** 最近一次失败的错误码；仅用于排查，不直接展示 */
  readonly errorCode: ErrorCode | null;
  /** 本次页面生命周期内是否已完成过一次恢复 */
  readonly restoredOnce: boolean;
}

export interface AccountSessionStore extends AccountSessionSnapshot {
  beginRestore(): void;
  applyMe(me: MeResponse): void;
  applyAuthenticated(user: AuthUser): void;
  /** 资料接口（PATCH /me、头像上传/删除）成功后同步账号与资料。 */
  applyAccountUpdate(user: AuthUser, profile: UserProfile): void;
  markGuest(): void;
  markUnavailable(message: string, errorCode: ErrorCode | null): void;
  clearAccount(): void;
}

/** `unavailable` 的统一文案（R4-AC3）：公开内容仍可浏览，只在账号区提示。 */
export const UNAVAILABLE_MESSAGE: '账号服务暂时不可用，公开内容仍可浏览' =
  '账号服务暂时不可用，公开内容仍可浏览';

/** 初始状态：未完成首次恢复前一律 `restoring`，scope 暂按访客（R2-AC3/R4-AC1）。 */
const INITIAL_SNAPSHOT: AccountSessionSnapshot = {
  status: 'restoring',
  user: null,
  profile: null,
  scope: GUEST_SCOPE,
  message: null,
  errorCode: null,
  restoredOnce: false,
};

function authenticatedSnapshot(
  user: AuthUser,
  profile: UserProfile | null = null,
): AccountSessionSnapshot {
  return {
    status: 'authenticated',
    user,
    profile,
    // scope 的唯一来源：由 user.user_id 计算，任何组件都不得自行拼接（R5-AC6）
    scope: accountScopeOf(user),
    message: null,
    errorCode: null,
    restoredOnce: true,
  };
}

/**
 * 访客快照。
 *
 * `markGuest()` 与 `clearAccount()` 的终态相同（401 与主动退出都落在这里），保留
 * 两个方法是为了让调用点表达意图；两者都清空 `errorCode`，避免上一次服务故障的
 * 错误码残留在"已知未登录"状态里误导排查。
 */
function guestSnapshot(): AccountSessionSnapshot {
  return {
    status: 'guest',
    user: null,
    profile: null,
    scope: GUEST_SCOPE,
    message: null,
    errorCode: null,
    restoredOnce: true,
  };
}

export const useAccountSessionStore: UseBoundStore<StoreApi<AccountSessionStore>> =
  create<AccountSessionStore>()((set) => ({
    ...INITIAL_SNAPSHOT,

    /**
     * 进入恢复流程。`restoredOnce` 复位为 false：恢复尚未完成，中途重挂载时
     * `AccountSessionBootstrap` 仍应继续（或重新发起）这一次恢复。
     */
    beginRestore: () =>
      set({
        status: 'restoring',
        user: null,
        profile: null,
        scope: GUEST_SCOPE,
        message: null,
        errorCode: null,
        restoredOnce: false,
      }),

    applyMe: (me) => set(authenticatedSnapshot(me.user, me.profile)),

    applyAuthenticated: (user) => set(authenticatedSnapshot(user)),

    applyAccountUpdate: (user, profile) => set(authenticatedSnapshot(user, profile)),

    markGuest: () => set(guestSnapshot()),

    markUnavailable: (message: string, errorCode: ErrorCode | null) =>
      set({
        status: 'unavailable',
        user: null,
        profile: null,
        scope: GUEST_SCOPE,
        message,
        errorCode,
        restoredOnce: true,
      }),

    clearAccount: () => set(guestSnapshot()),
  }));

/** 完整快照（含方法之外的只读字段）。只有确实需要多字段联动的组件才用它。 */
export function useAccountSession(): AccountSessionSnapshot {
  return useAccountSessionStore((state): AccountSessionSnapshot => state);
}

export function useAccountStatus(): AccountStatus {
  return useAccountSessionStore((state) => state.status);
}

export function useAccountUser(): AuthUser | null {
  return useAccountSessionStore((state) => state.user);
}

export function useAccountProfile(): UserProfile | null {
  return useAccountSessionStore((state) => state.profile);
}

export function useAccountScope(): AccountScope {
  return useAccountSessionStore((state) => state.scope);
}