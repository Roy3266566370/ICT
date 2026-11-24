import { useEffect, useState } from 'react';
import type { ScenePage } from '@/document/types';
import type { DeckPage } from './DeckPlayer';
import { pageDisplayUrl } from './pageUrls';
import { SceneThumbnail } from './ThumbnailRail';
import styles from './DeckPlayer.module.css';

export function PresenterDock({notes, next, scene}: {notes?: string; next?: DeckPage; scene?: ScenePage}) {
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return <aside className={styles.presenterDock} aria-label="演讲者控台">
    <section>
      <h2>课堂计时</h2>
      <time>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>
      <button type="button" onClick={() => { const nextStart = Date.now(); setStarted(nextStart); setNow(nextStart); }}>重置计时</button>
    </section>
    <section>
      <h2>下一页</h2>
      {scene?.preparation?.status === 'ready' && (scene.modified || !next?.image_url)
        ? <div className={styles.presenterPreview} style={{aspectRatio: scene.width / scene.height}}><SceneThumbnail page={scene}/></div>
        : next?.image_url ? <img src={pageDisplayUrl(next.image_url, next.render_bytes)} alt={next.title ?? '下一页预览'}/>
        : <p>{next ? next.title ?? '下一页画面尚未就绪' : '已到最后一页'}</p>}
    </section>
    <section><h2>讲稿备注</h2><p className={styles.presenterNotes}>{notes?.trim() || '本页没有讲稿备注。'}</p></section>
  </aside>;
}
