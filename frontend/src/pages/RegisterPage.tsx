/**
 * `/register` 注册页（契约 `C-REGISTER-UI@1`）。
 *
 * 组装说明：
 *  - 页面骨架交给 `AuthShell`，注册页只额外提供权益清单；
 *  - 左列是受控 `RegisterForm`，右列是主题文案 + 权益说明（不含 3D 场景）；
 *  - 表单输入 `values` 留在页面，`status`/`message`/`fieldErrors` 收敛在
 *    `useRegisterSubmit`；
 *  - 注册 + 自动登录成功后写入唯一账号状态源（`C-SESSION@1` 的 store），
 *    再 `navigate('/space', { replace: true })`；
 *  - 注册成功但自动登录失败时**不是**注册失败：跳转 `/login` 并通过
 *    `location.state.notice` 传递一次性中文提示（登录页负责读取并展示）；
 *  - 已登录访问本页立即跳转 `safeReturnTo(location.search)`，不渲染表单。
 *
 * 隐私：密码只存在于组件 state 与请求体；本页不写 Cookie/localStorage/sessionStorage。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isMockMode } from '@/api/client';
import type { AuthUser } from '@/api/types';
import AuthShell from '@/components/auth/AuthShell';
import RegisterForm from '@/components/auth/RegisterForm';
import { DEFAULT_RETURN_TO, safeReturnTo } from '@/components/auth/returnTo';
import type { RegisterFormValues } from '@/components/auth/registerFields';
import {
  EMAIL_ALREADY_REGISTERED_MESSAGE,
  USERNAME_ALREADY_REGISTERED_MESSAGE,
  useRegisterSubmit,
} from '@/components/auth/useRegisterSubmit';
import { useAccountSessionStore, useAccountStatus } from '@/state/accountSession';

/** 表单初值：只在挂载时作为 `useState` 初始值使用（之后一律由 `onChange` 替换）。 */
const INITIAL_REGISTER_VALUES: RegisterFormValues = {
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  displayName: '',
  identityTag: '',
};

/** 注册成功但自动登录失败时的引导文案（登录页从 `location.state.notice` 读取）。 */
const AUTO_LOGIN_FAILED_NOTICE = '注册成功，请登录';

/** 账号状态恢复中 / 已登录时的占位文案。 */
const RESTORING_NOTICE = '正在恢复账号状态…';
const REDIRECTING_NOTICE = '正在进入你的空间…';
const UNAVAILABLE_HINT = '账号服务暂时不可用，注册可能失败；可稍后重试';

const HIGHLIGHTS: readonly string[] = [
  '把上传的课件转成可调参数的交互对象',
  '保存参数修改与运行快照，随时回到同一版本',
  '按账号隔离本地草稿与查询缓存',
];

export default function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const mockMode = isMockMode();
  const accountStatus = useAccountStatus();

  const [values, setValues] = useState<RegisterFormValues>(INITIAL_REGISTER_VALUES);

  /**
   * 本页已自行跳转（注册成功或自动登录失败）后置为 true。
   *
   * 注册成功会同步把账号状态改成 `authenticated`，若不拦住，下面的
   * 「已登录自动跳转」effect 会把目标改写成 `safeReturnTo(location.search)`，
   * 与契约要求的 `/space` 冲突。
   */
  const selfRedirectRef = useRef(false);

  const handleRegistered = useCallback(
    (user: AuthUser): void => {
      selfRedirectRef.current = true;
      // 契约 §2.2：不可伪造 LoginResult（csr_token/expires_at 形状不完整），
      // 因此直接写入 store 的 `applyAuthenticated`。
      useAccountSessionStore.getState().applyAuthenticated(user);
      navigate(DEFAULT_RETURN_TO, { replace: true });
    },
    [navigate],
  );

  const handleAutoLoginFailed = useCallback((): void => {
    selfRedirectRef.current = true;
    navigate('/login', { replace: true, state: { notice: AUTO_LOGIN_FAILED_NOTICE } });
  }, [navigate]);

  const { status, message, fieldErrors, submit, reset } = useRegisterSubmit({
    onRegistered: handleRegistered,
    onAutoLoginFailed: handleAutoLoginFailed,
  });

  /* 已登录（含注册成功后的状态切换）→ 跳转回跳目标，且不渲染表单（R3-AC10） */
  useEffect(() => {
    if (accountStatus !== 'authenticated') return;
    if (selfRedirectRef.current) return;
    const target = mockMode ? DEFAULT_RETURN_TO : safeReturnTo(location.search);
    navigate(target, { replace: true });
  }, [accountStatus, location.search, mockMode, navigate]);

  const handleSubmit = useCallback(
    (next: RegisterFormValues): void => {
      void submit(next);
    },
    [submit],
  );

  /** 用户重新编辑后清除上一次的错误提示（提交中不允许编辑，避免状态被打断）。 */
  const handleChange = useCallback(
    (next: RegisterFormValues): void => {
      setValues(next);
      if (status === 'error') reset();
    },
    [reset, status],
  );

  const duplicateEmail = status === 'error' && message === EMAIL_ALREADY_REGISTERED_MESSAGE;
  const duplicateUsername =
    status === 'error' && message === USERNAME_ALREADY_REGISTERED_MESSAGE;
  const showForm = accountStatus !== 'restoring' && accountStatus !== 'authenticated';
  const statusText =
    accountStatus === 'restoring'
      ? RESTORING_NOTICE
      : accountStatus === 'authenticated'
        ? REDIRECTING_NOTICE
        : null;

  return (
    <AuthShell
      variant="register"
      eyebrow="创建万象账号"
      headline={['把每一次探索，', '留在自己的空间里。']}
      lead="注册后即可保存材料、参数与运行记录。一个账号，贯穿材料、实验与分享。"
      highlightsTitle="注册后可以做什么"
      highlights={HIGHLIGHTS}
      statusText={showForm ? null : statusText}
    >
      {showForm ? (
        <RegisterForm
          values={values}
          status={status}
          errorMessage={message}
          fieldErrors={fieldErrors}
          onChange={handleChange}
          onSubmit={handleSubmit}
          mockMode={mockMode}
          duplicateEmail={duplicateEmail}
          duplicateUsername={duplicateUsername}
          serviceHint={accountStatus === 'unavailable' ? UNAVAILABLE_HINT : null}
        />
      ) : null}
    </AuthShell>
  );
}
