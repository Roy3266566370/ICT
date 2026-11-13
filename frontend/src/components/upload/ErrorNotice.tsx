import type { ErrorCode } from '@/api/types';
import { ERROR_COPY } from './errorCopy';
import styles from './ErrorNotice.module.css';

export interface ErrorNoticeProps {
  /** 后端 `error.code`；本地预检失败时同样复用同一套码表。 */
  code: ErrorCode | null;
  /** 后端原话；与码表标题并存，便于支持定位，但不作为唯一说明。 */
  message?: string | null;
  retryable?: boolean;
  onRetry?: (() => void) | null;
  onDismiss?: (() => void) | null;
  /** `info` 用于说明性文字（如保留期），`error` 用于真实失败。 */
  tone?: 'error' | 'info';
  /** 覆盖标题，默认取码表标题 */
  title?: string;
}

/**
 * 错误提示：按 §2.2.8 的码表映射成中文标题 + 可执行建议。
 * 图标 + 文字双编码（R14-AC5），并用 `role="alert"` 让读屏立即播报。
 */
export function ErrorNotice({
  code,
  message = null,
  retryable,
  onRetry = null,
  onDismiss = null,
  tone = 'error',
  title,
}: ErrorNoticeProps): JSX.Element {
  const copy = code ? ERROR_COPY[code] : null;
  const resolvedTitle = title ?? copy?.title ?? '操作没有完成';
  const guidance = copy?.guidance ?? '请稍后再试；如果反复出现，请换一份文件。';
  const canRetry = onRetry !== null && (retryable ?? copy?.retryable ?? false);

  return (
    <div
      className={styles.notice}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.icon} aria-hidden="true">
        {tone === 'error' ? '✕' : 'i'}
      </span>

      <div className={styles.body}>
        <p className={styles.title}>
          {resolvedTitle}
          {code ? <code className={styles.code}>{code}</code> : null}
        </p>
        {message !== null && message.trim().length > 0 && message !== resolvedTitle ? (
          <p className={styles.message}>{message}</p>
        ) : null}
        <p className={styles.guidance}>{guidance}</p>
      </div>

      <div className={styles.actions}>
        {canRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            重试
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="关闭提示"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default ErrorNotice;