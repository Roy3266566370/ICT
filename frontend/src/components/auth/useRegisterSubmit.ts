/**
 * 注册提交状态机（契约 `C-REGISTER-UI@1`）。
 *
 * 「注册 → 自动登录」是一个两段式流程，这里把两段的状态收敛在一个 hook 里：
 *
 *  1. 本地校验失败 → `status='error'` + `fieldErrors`，**不**发请求；
 *  2. `POST /auth/register` 失败 → `status='error'`，文案按映射表；
 *  3. 注册成功、`POST /auth/login` 成功 → `status='success'` + `onRegistered(user)`；
 *  4. 注册成功、自动登录失败 → 仍然是 `status='success'`（账号已经创建成功），
 *     交给 `onAutoLoginFailed()` 去引导用户到登录页，**不得**显示为注册失败。
 *
 * 本 hook 不导航、不写全局账号状态：页面通过两个回调决定跳转与
 * `applyAuthenticated`。密码只存在于组件 state 与请求体中，不做任何持久化。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, errorMessage, isApiError } from '@/api/client';
import type { AuthUser } from '@/api/types';

import {
  buildRegisterPayload,
  validateRegisterValues,
  type RegisterFieldErrors,
  type RegisterFormValues,
} from './registerFields';

export type RegisterStatus = 'idle' | 'submitting' | 'error' | 'success';

/** 重复邮箱（409 `EMAIL_ALREADY_REGISTERED`）。 */
export const EMAIL_ALREADY_REGISTERED_MESSAGE = '该邮箱已注册，可直接登录';
/** 重复用户名（409 `USERNAME_ALREADY_REGISTERED`）。 */
export const USERNAME_ALREADY_REGISTERED_MESSAGE = '该用户名已被占用，请换一个';
/** 本地校验失败时的汇总提示（具体字段文案见 `fieldErrors`）。 */
export const LOCAL_VALIDATION_MESSAGE = '请检查填写的内容';
/** 422 字段校验的兜底文案（优先使用服务端 `message`）。 */
export const FIELD_HINT_MESSAGE = '请检查用户名、邮箱格式与密码长度（8–128 位）';
/** 请求频率限制（429 `RATE_LIMITED`）。 */
export const RATE_LIMITED_MESSAGE = '请求过于频繁，请稍后再试';
/**
 * 服务不可用 / 网络失败。
 *
 * 注：计划 §2.2 的错误文案表写作「账号服务暂时不可用，请稍后重试」，
 * 任务硬约束 5 与既有登录页（`useLoginSubmit`）都使用「无法连接服务，请稍后重试」；
 * 这里按硬约束与全局一致性取后者。
 */
export const SERVICE_UNAVAILABLE_MESSAGE = '无法连接服务，请稍后重试';
/** 其余未知错误的兜底文案。 */
export const FALLBACK_ERROR_MESSAGE = '注册失败，请稍后重试';

export interface UseRegisterSubmitOptions {
  /** 注册 + 自动登录都成功。 */
  onRegistered: (user: AuthUser) => void;
  /** 注册成功、自动登录失败。 */
  onAutoLoginFailed: () => void;
}

export interface RegisterSubmitController {
  status: RegisterStatus;
  message: string | null;
  fieldErrors: RegisterFieldErrors;
  submit: (values: RegisterFormValues) => Promise<void>;
  reset: () => void;
}

/** 服务端文案为空时用本地兜底，避免界面出现空白错误提示。 */
function preferServerMessage(serverMessage: string, fallback: string): string {
  const trimmed = serverMessage.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * 把 `api/client.ts` 抛出的错误映射为可读中文（契约错误文案表）。
 *
 * 文案中不含任何凭据、请求头或堆栈；`requestId` 也不展示（§2.3.8）。
 */
function mapRegisterError(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'EMAIL_ALREADY_REGISTERED':
        return EMAIL_ALREADY_REGISTERED_MESSAGE;
      case 'USERNAME_ALREADY_REGISTERED':
        return USERNAME_ALREADY_REGISTERED_MESSAGE;
      case 'MISSING_FIELD':
        return preferServerMessage(error.message, FIELD_HINT_MESSAGE);
      case 'RATE_LIMITED':
        // 验证码尝试次数超限时服务端会给出更具体的文案，优先展示
        return preferServerMessage(error.message, RATE_LIMITED_MESSAGE);
      case 'MODEL_UNAVAILABLE':
        return SERVICE_UNAVAILABLE_MESSAGE;
      default:
        // 422 的其它细分错误码同样按字段提示处理（服务端文案优先）
        if (error.status === 422) {
          return preferServerMessage(error.message, FIELD_HINT_MESSAGE);
        }
        break;
    }
  }
  // 网络层直接失败（如代理不可达）会抛原生 TypeError，按服务不可用展示
  if (error instanceof TypeError) return SERVICE_UNAVAILABLE_MESSAGE;

  return FALLBACK_ERROR_MESSAGE;
}

export function useRegisterSubmit(options: UseRegisterSubmitOptions): RegisterSubmitController {
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});

  /** 提交中守卫：用 ref 而不是 state，避免「点击过快」时读到同一批旧 state。 */
  const inFlightRef = useRef(false);
  /** 回调存 ref：页面每次渲染传新对象也不会让 `submit` 的身份变化。 */
  const onRegisteredRef = useRef(options.onRegistered);
  const onAutoLoginFailedRef = useRef(options.onAutoLoginFailed);

  useEffect(() => {
    onRegisteredRef.current = options.onRegistered;
  }, [options.onRegistered]);

  useEffect(() => {
    onAutoLoginFailedRef.current = options.onAutoLoginFailed;
  }, [options.onAutoLoginFailed]);

  const reset = useCallback((): void => {
    // 只清提示与字段错误；不解除 in-flight 守卫，避免 reset 期间被重复提交
    setStatus('idle');
    setMessage(null);
    setFieldErrors({});
  }, []);

  const submit = useCallback(async (values: RegisterFormValues): Promise<void> => {
    if (inFlightRef.current) return;

    // 1) 本地校验：有错直接返回，绝不发请求（R3-AC2）
    const errors = validateRegisterValues(values);
    if (Object.keys(errors).length > 0) {
      setStatus('error');
      setMessage(LOCAL_VALIDATION_MESSAGE);
      setFieldErrors(errors);
      return;
    }

    inFlightRef.current = true;
    setStatus('submitting');
    setMessage(null);
    setFieldErrors({});

    // 2) 注册（匿名端点，失败保留用户已输入的全部内容）
    try {
      await api.registerAccount(buildRegisterPayload(values));
    } catch (error) {
      inFlightRef.current = false;
      setStatus('error');
      setMessage(mapRegisterError(error));
      return;
    }

    // 3) 自动登录：失败不影响「注册已成功」这一事实
    let user: AuthUser | null = null;
    try {
      const result = await api.loginAccount({
        identifier: values.username.trim(),
        password: values.password,
      });
      user = result.user;
    } catch (error) {
      // 只记录可读文案（不含密码/CSRF），不改变下面的成功语义
      console.warn('[注册] 账号已创建，但自动登录失败：', errorMessage(error));
    }

    inFlightRef.current = false;
    setStatus('success');
    setMessage(null);

    if (user !== null) {
      // 导航抛错不应被当成「注册失败」展示；只记录避免未处理的 Promise 拒绝
      try {
        onRegisteredRef.current(user);
      } catch (error) {
        console.error('[注册] 注册成功后的跳转失败', error);
      }
      return;
    }

    try {
      onAutoLoginFailedRef.current();
    } catch (error) {
      console.error('[注册] 自动登录失败后的跳转失败', error);
    }
  }, []);

  return { status, message, fieldErrors, submit, reset };
}

export default useRegisterSubmit;