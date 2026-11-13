/**
 * 登录提交状态机（契约 `C-LOGINPAGE@1` §2）。
 *
 * 状态分层：表单输入 `values` 与焦点态由页面维护，本 hook 只负责
 * `status`/`message` 与「提交中不产生第二个请求」。
 *
 * 失败副作用：本 hook 不改动页面里的 `values` / `formFocused`，
 * 也不触碰 `LoginSurface` 的场景状态（R11-1…R11-5）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, errorMessage, isApiError } from '@/api/client';
import type { LoginResult } from '@/api/types';

import type { LoginFormStatus, LoginFormValues } from './LoginForm';

/** 前置校验失败（本地拦截，不发请求）。 */
export const EMPTY_CREDENTIALS_MESSAGE = '请输入用户名（或邮箱）和密码';
/** 凭据错误。 */
export const INVALID_CREDENTIALS_MESSAGE = '用户名或密码不正确';
/** 会话过期（登录端点理论上不返回，按契约保留映射）。 */
export const SESSION_EXPIRED_MESSAGE = '登录已过期，请重新登录';
/** 账号被禁用时的兜底文案（优先使用服务端 `message`）。 */
export const FORBIDDEN_FALLBACK_MESSAGE = '账号不可用，请联系管理员';
/** 422 字段校验的兜底文案（优先使用服务端 `message`）。 */
export const FIELD_HINT_MESSAGE = '请检查用户名（或邮箱）格式与密码长度（8–128 位）';
/** 后端不可达 / `MODEL_UNAVAILABLE`。 */
export const NETWORK_ERROR_MESSAGE = '无法连接服务，请稍后重试';
/** 其余未知错误的兜底文案。 */
export const FALLBACK_ERROR_MESSAGE = '登录失败，请稍后重试';

export interface UseLoginSubmitOptions {
  /** 登录成功回调；由页面负责导航（本 hook 不做路由跳转）。 */
  onSuccess: (result: LoginResult) => void;
}

export interface LoginSubmitController {
  status: LoginFormStatus;
  message: string | null;
  submit: (values: LoginFormValues) => Promise<void>;
  reset: () => void;
}

/** 服务端文案为空时用本地兜底，避免界面出现空白错误提示。 */
function preferServerMessage(serverMessage: string, fallback: string): string {
  const trimmed = serverMessage.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * 把 `client.ts` 抛出的错误映射为可读中文。
 *
 * 映射表见 `C-LOGINPAGE@1` §2；未知错误保留 `errorMessage()` 的文案，
 * 仅在文案为空时退到「登录失败，请稍后重试」。
 */
function mapLoginError(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
        return INVALID_CREDENTIALS_MESSAGE;
      case 'AUTH_REQUIRED':
        return SESSION_EXPIRED_MESSAGE;
      case 'FORBIDDEN':
        return preferServerMessage(error.message, FORBIDDEN_FALLBACK_MESSAGE);
      case 'MISSING_FIELD':
        return preferServerMessage(error.message, FIELD_HINT_MESSAGE);
      case 'MODEL_UNAVAILABLE':
        return NETWORK_ERROR_MESSAGE;
      default:
        // 422 的其它细分错误码同样按字段提示处理（服务端文案优先）
        if (error.status === 422) {
          return preferServerMessage(error.message, FIELD_HINT_MESSAGE);
        }
        break;
    }
  }
  // 极少数情况下（如代理层直接失败）会抛原生 TypeError，按网络错误展示
  if (error instanceof TypeError) return NETWORK_ERROR_MESSAGE;

  const text = errorMessage(error).trim();
  return text === '' ? FALLBACK_ERROR_MESSAGE : text;
}

export function useLoginSubmit(options: UseLoginSubmitOptions): LoginSubmitController {
  const [status, setStatus] = useState<LoginFormStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  /** 提交中守卫：用 ref 而不是 state，避免「点击过快」时读到同一批旧 state。 */
  const inFlightRef = useRef(false);
  /** 回调存 ref：页面每次渲染传新对象也不会让 `submit` 的身份变化。 */
  const onSuccessRef = useRef(options.onSuccess);

  useEffect(() => {
    onSuccessRef.current = options.onSuccess;
  }, [options.onSuccess]);

  const reset = useCallback((): void => {
    // 只重置提示与状态；不解除 in-flight 守卫，避免 reset 期间被重复提交
    setStatus('idle');
    setMessage(null);
  }, []);

  const submit = useCallback(async (values: LoginFormValues): Promise<void> => {
    if (inFlightRef.current) return;

    const identifier = values.identifier.trim();
    const password = values.password;
    if (identifier === '' || password === '') {
      setStatus('error');
      setMessage(EMPTY_CREDENTIALS_MESSAGE);
      return;
    }

    inFlightRef.current = true;
    setStatus('submitting');
    setMessage(null);

    let result: LoginResult;
    try {
      result = await api.loginAccount({ identifier, password, remember: values.remember });
    } catch (error) {
      inFlightRef.current = false;
      setStatus('error');
      setMessage(mapLoginError(error));
      return;
    }

    inFlightRef.current = false;
    setStatus('idle');
    setMessage(null);
    // 导航抛错不应被当成「登录失败」展示；这里只记录，避免未处理的 Promise 拒绝
    try {
      onSuccessRef.current(result);
    } catch (error) {
      console.error('[登录] 登录成功后的跳转失败', error);
    }
  }, []);

  return { status, message, submit, reset };
}

export default useLoginSubmit;