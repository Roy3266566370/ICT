/** 活页分享播放器：学生端只读 + 进度回流（访问/竞猜/判分）。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedLivingPage, livingShareAssetUrl, reportLivingProgress } from '@/api/living';
import { errorMessage } from '@/api/client';
import { BlockView, type ProgressPatch } from '@/components/living/PageBlocks';
import { PageOutline } from '@/components/living/PageOutline';
import { VariablesBar } from '@/components/living/VariablesBar';
import { LiveVarsProvider } from '@/living/liveVars';
import type { LivingPageDoc } from '@/living/types';
import styles from './LivingPage.module.css';

export default function LivingPageShare(): ReactNode {
  const { shareId = '' } = useParams();
  const [doc, setDoc] = useState<LivingPageDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingProgress = useRef(Promise.resolve());
  const visited = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    getSharedLivingPage(shareId)
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const report = useCallback(
    (blockId: string, patch: ProgressPatch = {}): void => {
      if (!doc?.settings.collect_progress) return;
      pendingProgress.current = pendingProgress.current
        .then(() => reportLivingProgress({ shareId, blockId, patch }))
        .then(() => undefined, () => undefined);
    },
    [doc, shareId],
  );

  /** 块滚进视口才记一次"看过"（IntersectionObserver）。 */
  const observe = useCallback(
    (node: HTMLElement | null, blockId: string): void => {
      if (!node || visited.current.has(blockId)) return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting) && !visited.current.has(blockId)) {
            visited.current.add(blockId);
            report(blockId);
            io.disconnect();
          }
        },
        { threshold: 0.4 },
      );
      io.observe(node);
    },
    [report],
  );

  if (error) {
    return (
      <div className={styles.center} role="alert">
        <h1>链接失效</h1>
        <p>{error}</p>
      </div>
    );
  }
  if (!doc) return <div className={styles.center}>载入活页…</div>;

  const peerIds = new Set(doc.blocks.map((block) => block.id));

  return (
    <div className={styles.sharePage}>
      <header className={styles.shareHead}>
        <h1>{doc.title}</h1>
        <p className={styles.shareMeta}>万象活页 · {doc.blocks.length} 块</p>
      </header>
      <main className={styles.shareBlocks}>
        <LiveVarsProvider variables={doc.variables}>
          <VariablesBar />
          <PageOutline blocks={doc.blocks} />
          {doc.blocks.map((block) => (
            <div key={block.id} id={block.id} style={{ scrollMarginTop: '5rem' }} ref={(node) => observe(node, block.id)}>
              <BlockView
                block={block}
                assetUrl={(key) => livingShareAssetUrl(shareId, key)}
                readOnly
                peerIds={peerIds}
                onProgress={(patch) => report(block.id, patch)}
              />
            </div>
          ))}
        </LiveVarsProvider>
      </main>
      <footer className={styles.shareFoot}>由 万象 活页引擎生成 · 确定性计算</footer>
    </div>
  );
}
