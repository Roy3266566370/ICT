/**
 * `/login` 登录页（契约 `C-LOGIN-UI@1`）。
 *
 * 组装说明：
 *  - 页面骨架交给 `AuthShell`（准入登记台 + 右侧实时通行证）；
 *  - 左列是受控 `LoginForm`，通行证上的登记名跟随输入实时更新；
 *  - 表单输入 `values` 留在页面，提交 `status`/`message` 收敛在 `useLoginSubmit`；
 *  - 页面按账号四态渲染（`state/accountSession.ts` 是唯一状态源）：
 *      `restoring`      → 只渲染占位，不渲染表单、不跳转（R4-AC9）；
 *      `authenticated`  → 渲染「正在进入你的空间…」占位，并跳转一次（R4-AC6）；
 *      `unavailable`    → 表单照常可用，并在表单内提示服务不可用（R4-AC3）；
 *      `guest`          → 正常渲染表单；
 *  - 登录成功**先** `applyLogin(result)` 写入全局账号态（触发 scope 切换后的
 *    缓存/草稿清理），**再** `navigate`；不得在此再调 `/me`；
 *  - 来自注册页的 `location.state.notice`（见 `C-REGISTER-UI@1`）用
 *    `Record<string, unknown>` + `typeof` 收窄读取，展示一次后清除 history.state，
 *    刷新不重复出现。
 *
 * 隐私：通行证只接收登记名文本，不接收密码；不写 Cookie/localStorage/sessionStorage，
 * 登录态完全由 `api/client` 与服务端 `xs_auth` Cookie 负责（mock 模式为内存态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isMockMode } from '@/api/client';
import type { LoginResult } from '@/api/types';
import AuthShell from '@/components/auth/AuthShell';
import LoginForm, { type LoginFormValues } from '@/components/auth/LoginForm';
import { DEFAULT_RETURN_TO, safeReturnTo } from '@/components/auth/returnTo';
import { useLoginSubmit } from '@/components/auth/useLoginSubmit';
import { useAccountSessionActions } from '@/hooks/useAccountBootstrap';
import { useAccountStatus } from '@/state/accountSession';

/** 表单初值：只在挂载时作为 `useState` 初始值使用（之后一律由 `onChange` 替换）。 */
const INITIAL_VALUES: LoginFormValues = { identifier: '', password: '', remember: false };

/** `restoring` 占位文案（R4-AC9）。 */
const RESTORING_TEXT = '正在恢复账号状态…';
/** `authenticated` 占位文案：跳转通常瞬间完成，只作过渡反馈。 */
const ENTERING_TEXT = '正在进入你的空间…';
/** `unavailable` 时传给表单的提示（R4-AC3）：表单仍可用，由用户决定是否重试。 */
const UNAVAILABLE_FORM_HINT = '账号服务暂时不可用，登录可能失败，可稍后重试';

/** 外部输入收窄：只有普通对象才可能携带 `notice`。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 读取 `location.state.notice`（`C-REGISTER-UI@1` 约定的字符串）。
 *
 * `location.state` 的类型是 `unknown`，这里不做任何 `any` 断言：
 * 先收窄成 `Record<string, unknown>`，再要求 `notice` 是**非空字符串**。
 */
function readNotice(state: unknown): string | null {
  if (!isRecord(state)) return null;
  const notice = state['notice'];
  if (typeof notice !== 'string') return null;
  const trimmed = notice.trim();
  return trimmed === '' ? null : trimmed;
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const mockMode = isMockMode();
  const accountStatus = useAccountStatus();
  const { applyLogin, refreshAccount } = useAccountSessionActions();

  const [values, setValues] = useState<LoginFormValues>(INITIAL_VALUES);

  /**
   * 一次性提示：初值取自 `location.state`，随后冻结在本地 state 中。
   * 若直接派生自 `location.state`，清除 history.state 时提示会一并消失。
   */
  const incomingNotice = readNotice(location.state);
  const [notice, setNotice] = useState<string | null>(incomingNotice);

  /** 已登录跳转守卫：StrictMode 双执行副作用时也只跳一次。 */
  const hasRedirectedRef = useRef(false);

  /**
   * 登录后的落地：先补一次 `/me` 拿到资料，再按「默认进入」偏好选择
   * 个人主页或题目实验室；显式 `returnTo` 与 mock 模式不受偏好影响。
   */
  const enterAccount = useCallback(
    (base: string): void => {
      void (async (): Promise<void> => {
        let target = base;
        if (!mockMode) {
          const me = await refreshAccount();
          if (me !== null && base === DEFAULT_RETURN_TO) {
            target = me.profile.default_entry === 'labs' ? '/labs' : DEFAULT_RETURN_TO;
          }
        }
        navigate(target, { replace: true });
      })();
    },
    [mockMode, navigate, refreshAccount],
  );

  // 消费注册页带来的提示，并立刻清空 history.state，避免刷新后重复显示。
  useEffect(() => {
    if (incomingNotice === null) return;
    setNotice(incomingNotice);
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [incomingNotice, location.pathname, location.search, location.hash, navigate]);

  /**
   * 已登录（R4-AC6）：跳转到 `safeReturnTo(location.search)`（默认 `/space`），
   * 不渲染登录表单。依赖数组含 `status`，配合 ref 守卫确保只跳转一次。
   */
  useEffect(() => {
    if (accountStatus !== 'authenticated') {
      // 离开已登录态（如退出）后允许再次判定，避免守卫长期锁死
      hasRedirectedRef.current = false;
      return;
    }
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    enterAccount(safeReturnTo(location.search));
  }, [accountStatus, location.search, enterAccount]);

  /**
   * 成功处理（C-LOGIN-UI@1）：必须**先**写入全局账号态，**再**导航。
   *
   * `applyLogin` 会切换 scope，由 `AccountSessionBootstrap` 的监听统一清理旧账号的
   * 私有缓存与本地草稿；顺序颠倒会让新页面先命中旧账号缓存。
   */
  const handleSuccess = useCallback(
    (result: LoginResult): void => {
      applyLogin(result);
      // 由本回调独占本次跳转，避免「已登录」副作用再跳一次
      hasRedirectedRef.current = true;
      const base = mockMode ? DEFAULT_RETURN_TO : safeReturnTo(location.search);
      enterAccount(base);
    },
    [applyLogin, enterAccount, location.search, mockMode],
  );

  const { status, message, submit } = useLoginSubmit({ onSuccess: handleSuccess });

  const handleSubmit = useCallback(
    (next: LoginFormValues): void => {
      void submit(next);
    },
    [submit],
  );

  // 只有 guest / unavailable 才渲染表单；restoring / authenticated 渲染占位
  const showForm = accountStatus === 'guest' || accountStatus === 'unavailable';
  const serviceHint = accountStatus === 'unavailable' ? UNAVAILABLE_FORM_HINT : null;
  const statusText = showForm
    ? null
    : accountStatus === 'restoring'
      ? RESTORING_TEXT
      : ENTERING_TEXT;

  return (
    <AuthShell
      variant="login"
      eyebrow="ACCESS DESK / 准入登记"
      headline={['欢迎回来，', '实验还开着。']}
      lead="验证身份，回到个人空间或题目实验室。账号现在保存显示名与默认入口；材料与实验仍按当前浏览器会话保留。"
      passName={values.identifier.trim().split('@')[0] ?? ''}
      notice={showForm ? notice : null}
      statusText={statusText}
    >
      {showForm ? (
        <LoginForm
          values={values}
          status={status}
          errorMessage={message}
          onChange={setValues}
          onSubmit={handleSubmit}
          mockMode={mockMode}
          serviceHint={serviceHint}
        />
      ) : null}
    </AuthShell>
  );
}
