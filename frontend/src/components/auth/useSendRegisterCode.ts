/**
 * 「发送邮箱验证码」状态机（注册页专用）。
 *
 * 设计要点：
 *  - 发送前先用 `validateEmailValue` 做本地格式校验，避免明显非法的请求；
 *  - 成功后按服务端返回的 `resend_after_seconds` 进入冷却，倒计时只对
 *    同一个邮箱生效（换邮箱可以立即重新发送，后端也按邮箱节流）；
 *  - 429 时优先采用服务端 `details.retry_after_seconds`，把剩余等待时间
 *    直接反映到按钮上；
 *  - 文案不含邮箱之外的用户输入，也不触碰密码等凭据。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, isApiError } from '@/api/client';
import type { ApiRequestError } from '@/api/client';

import { validateEmailValue } from './registerFields';

export type SendCodeStatus = 'idle' | 'sending' | 'sent' | 'error';

export const CODE_SENT_FALLBACK_MESSAGE = '验证码已发送，请查收邮箱';
export const CODE_EMAIL_INVALID_MESSAGE = '请先填写正确的邮箱地址';
export const CODE_RATE_LIMITED_MESSAGE = '发送过于频繁，请稍后再试';
export const CODE_EMAIL_REGISTERED_MESSAGE = '该邮箱已注册，可直接登录';
export const CODE_SERVICE_UNAVAILABLE_MESSAGE = '无法连接服务，请稍后重试';
export const CODE_SEND_FAILED_MESSAGE = '验证码发送失败，请稍后重试';

export interface SendCodeController {
  status: SendCodeStatus;
  message: string | null;
  /** 冷却剩余秒数；仅对 `sentEmail` 生效 */
  cooldown: number;
  /** 最近一次发送（或收到节流响应）的邮箱比较键（trim + lowercase） */
  sentEmail: string | null;
  send: (email: string) => Promise<void>;
  /** 清空提示；冷却与发送记录保留，避免绕过节流 */
  reset: () => void;
}

/** 与后端 `identifier = display.casefold()` 对齐的比较键。 */
export function emailComparisonKey(email: string): string {
  return email.trim().toLowerCase();
}

function preferServerMessage(serverMessage: string, fallback: string): string {
  const trimmed = serverMessage.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** 读取 429 响应里的 `retry_after_seconds`；缺失或非法返回 null。 */
function readRetryAfterSeconds(details: ApiRequestError['details']): number | null {
  if (details === undefined) return null;
  const raw = details['retry_after_seconds'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.max(1, Math.ceil(raw));
}

function mapSendCodeError(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'EMAIL_ALREADY_REGISTERED':
        return CODE_EMAIL_REGISTERED_MESSAGE;
      case 'RATE_LIMITED':
        return preferServerMessage(error.message, CODE_RATE_LIMITED_MESSAGE);
      case 'MISSING_FIELD':
        return preferServerMessage(error.message, CODE_EMAIL_INVALID_MESSAGE);
      case 'MODEL_UNAVAILABLE':
        // 服务端可能是「邮件发送失败」而非网络故障，优先展示它的文案
        return preferServerMessage(error.message, CODE_SERVICE_UNAVAILABLE_MESSAGE);
      default:
        if (error.status === 422) {
          return preferServerMessage(error.message, CODE_EMAIL_INVALID_MESSAGE);
        }
        break;
    }
  }
  if (error instanceof TypeError) return CODE_SERVICE_UNAVAILABLE_MESSAGE;
  return CODE_SEND_FAILED_MESSAGE;
}

export function useSendRegisterCode(): SendCodeController {
  const [status, setStatus] = useState<SendCodeStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldownState] = useState(0);
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  /** 发送中守卫：ref 避免快速连点在同一个渲染帧里穿透。 */
  const inFlightRef = useRef(false);
  /** 与 state 同步的冷却/邮箱快照，供 `send` 在不重建身份的前提下读取。 */
  const cooldownRef = useRef(0);
  const sentEmailRef = useRef<string | null>(null);

  const updateCooldown = useCallback((seconds: number): void => {
    const next = Math.max(0, Math.ceil(seconds));
    cooldownRef.current = next;
    setCooldownState(next);
  }, []);

  // 每秒递减；卸载或重发时清理旧计时器
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => updateCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown, updateCooldown]);

  const reset = useCallback((): void => {
    setStatus('idle');
    setMessage(null);
  }, []);

  const send = useCallback(
    async (rawEmail: string): Promise<void> => {
      if (inFlightRef.current) return;

      const email = rawEmail.trim();
      if (validateEmailValue(email) !== null) {
        setStatus('error');
        setMessage(CODE_EMAIL_INVALID_MESSAGE);
        return;
      }

      const key = emailComparisonKey(email);
      if (sentEmailRef.current === key && cooldownRef.current > 0) return;

      inFlightRef.current = true;
      setStatus('sending');
      setMessage(null);
      try {
        const result = await api.sendRegisterCode({ email });
        const resultKey = emailComparisonKey(result.email);
        sentEmailRef.current = resultKey;
        setSentEmail(resultKey);
        updateCooldown(result.resend_after_seconds);
        setStatus('sent');
        const minutes = Math.max(1, Math.round(result.expires_in_seconds / 60));
        setMessage(
          `验证码已发送至 ${result.email}，${minutes} 分钟内有效`,
        );
      } catch (error) {
        if (isApiError(error, 'RATE_LIMITED')) {
          const retryAfter = readRetryAfterSeconds(error.details);
          if (retryAfter !== null) {
            sentEmailRef.current = key;
            setSentEmail(key);
            updateCooldown(retryAfter);
          }
        }
        setStatus('error');
        setMessage(mapSendCodeError(error));
      } finally {
        inFlightRef.current = false;
      }
    },
    [updateCooldown],
  );

  return { status, message, cooldown, sentEmail, send, reset };
}

export default useSendRegisterCode;
