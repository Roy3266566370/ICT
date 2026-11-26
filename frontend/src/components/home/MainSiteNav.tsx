import type { ReactNode } from 'react';
import { LivingUploadPanel } from '@/components/upload/LivingUploadPanel';
import { SiteNav, type NavSection } from './SiteNav';
import { useUploadDialog } from './deck/useUploadDialog';
import styles from './MainSiteNav.module.css';

export function MainSiteNav({ current, children }: {
  current: NavSection;
  children?: (openUpload: () => void) => ReactNode;
}): JSX.Element {
  const { open, openUpload, closeUpload, closeRef, dialogRef } = useUploadDialog();

  return <>
    <SiteNav current={current} onUpload={openUpload} />
    {children?.(openUpload)}
    {open ? (
      <div
        className={styles.backdrop}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeUpload();
        }}
      >
        <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="上传教学材料">
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={closeUpload}
            aria-label="关闭上传窗口"
          >
            ×
          </button>
          <div className={styles.body}>
            <LivingUploadPanel />
          </div>
        </div>
      </div>
    ) : null}
  </>;
}
