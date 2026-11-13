import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SiteNav } from '@/components/home/SiteNav';
import { heroAccountLink } from '@/components/home/navAccountItems';
import { DeckStage } from '@/components/home/deck/DeckStage';
import type { DeckHandle } from '@/components/home/deck/DeckStage';
import { useDeckLayout } from '@/components/home/deck/useDeckLayout';
import { useUploadDialog } from '@/components/home/deck/useUploadDialog';
import { buildHomeSlides } from '@/components/home/slides/HomeSlides';
import { prefetchCommonRoutes } from '@/components/navigation/routePrefetch';
import { LivingUploadPanel } from '@/components/upload/LivingUploadPanel';
import { useAccountStatus, useAccountUser } from '@/state/accountSession';
import styles from './HomePage.module.css';

export function HomePage(): JSX.Element {
  const deckRef = useRef<DeckHandle>(null);
  const demoFocusTimer = useRef<number | null>(null);
  const layout = useDeckLayout();
  const [present, setPresent] = useState(false);
  const { open: uploadOpen, openUpload, closeUpload, closeRef, dialogRef } = useUploadDialog();
  const accountStatus = useAccountStatus();
  const accountUser = useAccountUser();
  const accountLink = heroAccountLink(accountStatus, accountUser);

  useEffect(() => () => {
    if (demoFocusTimer.current !== null) window.clearTimeout(demoFocusTimer.current);
  }, []);

  // 首屏稳定后空闲预取最常用的两个入口（省流量/2G 时跳过）。
  useEffect(() => { prefetchCommonRoutes(); }, []);

  const goTo = useCallback((slideId: string): void => deckRef.current?.goTo(slideId), []);

  const tryDemo = useCallback((): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    goTo('demo');
    if (demoFocusTimer.current !== null) window.clearTimeout(demoFocusTimer.current);
    demoFocusTimer.current = window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('#slide-demo input[type="range"]')?.focus({ preventScroll: true });
    }, reduced ? 0 : 650);
  }, [goTo]);

  const slides = useMemo(
    () => buildHomeSlides({ onUpload: openUpload, onTry: tryDemo, goTo, accountLink }),
    [openUpload, tryDemo, goTo, accountLink],
  );

  return <div className={styles.page} data-layout={layout} data-present={present ? 'true' : 'false'}>
    <SiteNav current={null} onUpload={openUpload} appearance="default" />
    <main id="main" className={styles.main}>
      <DeckStage ref={deckRef} slides={slides} paused={uploadOpen} onPresentChange={setPresent} />
    </main>
    {uploadOpen && <div className={styles.uploadBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeUpload(); }}>
      <div ref={dialogRef} className={styles.uploadDialog} role="dialog" aria-modal="true" aria-label="上传材料生成活页">
        <button ref={closeRef} type="button" className={styles.uploadClose} onClick={closeUpload} aria-label="关闭上传窗口">×</button>
        <div className={styles.uploadBody}><LivingUploadPanel /></div>
      </div>
    </div>}
  </div>;
}

export default HomePage;
