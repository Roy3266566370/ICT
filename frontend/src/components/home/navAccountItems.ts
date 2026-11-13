/**
 * navAccountItems.ts —— 导航账号入口的纯函数条目表（契约 `C-NAV-ACCOUNT@1`）。
 *
 * 设计约束：
 *  - **零 import**：保证可被 `node --test` 直接加载，也让桌面区与移动端菜单消费
 *    完全相同的条目结果，不出现两份不一致逻辑。
 *  - **纯函数**：同一 `(status, user)` 输入必定得到内容相同的条目，便于单测与推理。
 *  - **四态语义**（R2-AC1..R2-AC4）：
 *      restoring    → 不渲染任何账号入口（避免「登录/免费注册」闪回误导）；
 *      guest        → 「登录」+「免费注册」；
 *      unavailable  → 只有可重试的「登录」（带可读提示），不渲染「免费注册」；
 *      authenticated → 账号菜单（昵称空时回退邮箱）。
 *
 * 返回的数组与对象均为冻结值，调用方不得就地修改。
 */

/** 账号四态（与 `state/accountSession.ts` 的 `AccountStatus` 同构）。 */
export type NavAccountStatus = 'restoring' | 'authenticated' | 'guest' | 'unavailable';

/** 导航只需要账号对象的最小字段集；`AuthUser` 可直接作为入参（结构兼容）。 */
export interface NavAccountUser {
  readonly user_id: string;
  readonly display_name: string;
  readonly email: string;
  /** 用户名（老账号可能没有）；用于账号菜单副标题 */
  readonly username?: string;
  /** 头像 URL（后端相对路径）；缺少或为空时回退昵称首字 */
  readonly avatar_url?: string | null;
}

/** 导航区的一条账号入口。`loading` 供 UI 预留占位，当前四个状态不会产出它。 */
export type NavAccountEntry =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'login';
      readonly label: '登录';
      readonly to: '/login';
      /** `unavailable` 时的可读提示；正常访客态为 null。 */
      readonly hint: string | null;
    }
  | { readonly kind: 'register'; readonly label: '免费注册'; readonly to: '/register' }
  | {
      readonly kind: 'account';
      readonly label: string;
      readonly to: '/space';
      readonly email: string;
      /** 有用户名时显示 `@username`，否则回退邮箱 */
      readonly username: string | null;
      /** 有头像时显示圆形图片，否则回退昵称首字 */
      readonly avatarUrl: string | null;
    };

/** 首页 hero 区的次级账号入口。 */
export type HeroAccountLink =
  | { readonly kind: 'register'; readonly to: '/register'; readonly label: '免费注册' }
  | { readonly kind: 'space'; readonly to: '/space'; readonly label: '个人主页' };

/** `unavailable` 态下「登录」入口的可读提示（R2-AC4）。 */
export const UNAVAILABLE_NAV_HINT: '账号服务暂时不可用，可稍后重试' =
  '账号服务暂时不可用，可稍后重试';

const LOGIN_ENTRY: NavAccountEntry = Object.freeze({
  kind: 'login',
  label: '登录',
  to: '/login',
  hint: null,
});

const UNAVAILABLE_LOGIN_ENTRY: NavAccountEntry = Object.freeze({
  kind: 'login',
  label: '登录',
  to: '/login',
  hint: UNAVAILABLE_NAV_HINT,
});

const REGISTER_ENTRY: NavAccountEntry = Object.freeze({
  kind: 'register',
  label: '免费注册',
  to: '/register',
});

/** 访客态条目：桌面区与移动端菜单共用同一份冻结结果。 */
const GUEST_ENTRIES: readonly NavAccountEntry[] = Object.freeze([
  LOGIN_ENTRY,
  REGISTER_ENTRY,
]);

const UNAVAILABLE_ENTRIES: readonly NavAccountEntry[] = Object.freeze([
  UNAVAILABLE_LOGIN_ENTRY,
]);

const NO_ENTRIES: readonly NavAccountEntry[] = Object.freeze([]);

const HERO_REGISTER: HeroAccountLink = Object.freeze({
  kind: 'register',
  to: '/register',
  label: '免费注册',
});

const HERO_SPACE: HeroAccountLink = Object.freeze({
  kind: 'space',
  to: '/space',
  label: '个人主页',
});

/**
 * 账号展示名：`display_name` 去空白后非空则用登录值，否则回退 `email`（R2-AC2）。
 *
 * 邮箱本身就是登录标识，回退时不再 trim，保持与客户端一致的原始大小写。
 */
export function accountDisplayName(user: NavAccountUser): string {
  const displayName = user.display_name.trim();
  return displayName === '' ? user.email : displayName;
}

/**
 * 计算导航区应显示的账号入口（返回值表见契约 `C-NAV-ACCOUNT@1`）。
 *
 * @param status 账号四态
 * @param user `authenticated` 时的账号对象；其它状态应为 null
 */
export function navAccountEntries(
  status: NavAccountStatus,
  user: NavAccountUser | null,
): readonly NavAccountEntry[] {
  switch (status) {
    case 'restoring':
      return NO_ENTRIES;
    case 'unavailable':
      return UNAVAILABLE_ENTRIES;
    case 'guest':
      return GUEST_ENTRIES;
    case 'authenticated': {
      // 防御分支：状态与用户对象短暂不一致时按访客渲染，绝不渲染空昵称账号。
      if (user === null) return GUEST_ENTRIES;
      const username = (user.username ?? '').trim();
      const rawAvatar = typeof user.avatar_url === 'string' ? user.avatar_url.trim() : '';
      const entry: NavAccountEntry = Object.freeze({
        kind: 'account',
        label: accountDisplayName(user),
        to: '/space',
        email: user.email,
        username: username === '' ? null : username,
        avatarUrl: rawAvatar === '' ? null : rawAvatar,
      });
      return Object.freeze([entry]);
    }
    default:
      return NO_ENTRIES;
  }
}

/**
 * 首页 hero 区的次级账号入口（R2-AC5）。
 *
 * `restoring` 与 `unavailable` 返回 null：前者状态未定，后者账号服务不可用，
 * 都不应引导用户去注册或进入空间。
 */
export function heroAccountLink(
  status: NavAccountStatus,
  user: NavAccountUser | null,
): HeroAccountLink | null {
  switch (status) {
    case 'guest':
      return HERO_REGISTER;
    case 'authenticated':
      return user === null ? HERO_REGISTER : HERO_SPACE;
    case 'restoring':
    case 'unavailable':
      return null;
    default:
      return null;
  }
}

export default navAccountEntries;