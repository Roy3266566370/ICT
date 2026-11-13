import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useLocation } from 'react-router-dom';

export interface UploadDialogController {
  open: boolean;
  openUpload: () => void;
  closeUpload: () => void;
  closeRef: RefObject<HTMLButtonElement>;
  dialogRef: RefObject<HTMLDivElement>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/** 首页上传弹窗：`#upload` 打开、Esc 关闭、焦点陷阱、关闭后恢复焦点、锁定背景滚动。 */
export function useUploadDialog(): UploadDialogController {
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openUpload = useCallback((): void => setOpen(true), []);
  const closeUpload = useCallback((): void => setOpen(false), []);

  useEffect(() => {
    if (location.hash === '#upload') setOpen(true);
  }, [location.hash]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((element) => element.tabIndex >= 0
        && element.getAttribute('aria-hidden') !== 'true'
        && getComputedStyle(element).visibility !== 'hidden'
        && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  return { open, openUpload, closeUpload, closeRef, dialogRef };
}
