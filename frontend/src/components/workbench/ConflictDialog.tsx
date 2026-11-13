import { useEffect, useRef } from 'react';
import styles from './ConflictDialog.module.css';

export interface ConflictDetail {
  /** 面向用户的原因文案（来自 ApiRequestError.message 或本地组装）。 */
  message: string;
  /** 本次提交所依据的本地版本。 */
  localModelVersion: number;
  localRevision: number;
  /** 服务端当前版本（若错误体未携带则为 null）。 */
  serverModelVersion: number | null;
  serverRevision: number | null;
  /** 触发冲突的动作：保存模型 / 保存运行 / 重新校验。 */
  operation: string;
}

export interface ConflictDialogProps {
  open: boolean;
  conflict: ConflictDetail | null;
  busy: boolean;
  /** 保留本地修改并关闭对话框（不清空本地参数）。 */
  onKeepLocal: () => void;
  /** 重新拉取服务端对象后再提交一次。 */
  onReloadAndConfirm: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * VERSION_CONFLICT 处理（R10-AC6）：
 * 保留本地修改，提供"重新载入后确认"，绝不静默覆盖任一侧。
 */
export function ConflictDialog({ open, conflict, busy, onKeepLocal, onReloadAndConfirm }: ConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();
    return () => {
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onKeepLocal();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onKeepLocal]);

  if (!open || !conflict) return null;

  return (
    <div className={styles.overlay} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-desc"
        tabIndex={-1}
      >
        <h2 className={styles.title} id="conflict-title">
          版本冲突（VERSION_CONFLICT）
        </h2>
        <p className={styles.desc} id="conflict-desc">
          服务端对象已被更新，本次「{conflict.operation}」未生效。<strong>你的本地修改已完整保留</strong>，没有被覆盖。
        </p>

        <dl className={styles.versions}>
          <div>
            <dt>本次提交依据</dt>
            <dd>
              model_version {conflict.localModelVersion} · revision {conflict.localRevision}
            </dd>
          </div>
          <div>
            <dt>服务端当前</dt>
            <dd>
              {conflict.serverModelVersion === null && conflict.serverRevision === null
                ? '未知（错误体未携带版本号）'
                : `model_version ${conflict.serverModelVersion ?? '未知'} · revision ${
                    conflict.serverRevision ?? '未知'
                  }`}
            </dd>
          </div>
        </dl>

        <p className={styles.reason}>{conflict.message}</p>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={busy} onClick={onKeepLocal}>
            保留本地修改，稍后再试
          </button>
          <button type="button" className={styles.primary} disabled={busy} onClick={onReloadAndConfirm}>
            {busy ? '重新载入中…' : '重新载入后确认'}
          </button>
        </div>
        <p className={styles.footnote}>
          「重新载入后确认」会先拉取服务端最新版本，再以你保留的参数值重新提交；参数与勾选状态不会因重新载入丢失。
        </p>
      </div>
    </div>
  );
}

export default ConflictDialog;