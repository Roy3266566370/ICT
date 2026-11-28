import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { PlazaCards } from '@/components/plaza/PlazaCards';
import { MoreButton, usePlazaPages } from '@/components/plaza/plazaQueries';
import styles from '../SpacePage.module.css';

export function SpacePublicWorks({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'published' | 'bookmarks'>('published');
  const [notice, setNotice] = useState('');
  const query = usePlazaPages(['space', userId, tab], offset => tab === 'bookmarks'
    ? plazaApi.bookmarks(offset, 'workshop')
    : plazaApi.list(new URLSearchParams({ author_id: userId, kind: 'workshop', offset: String(offset) })));
  const url = '/u/' + encodeURIComponent(userId);
  const items = query.data?.pages.flatMap(page => page.items) ?? [];

  return (
    <section className={`${styles.card} ${styles.bentoPublicWorks}`} aria-label="我的广场">
      <div className={styles.cardPad}>
        <div className={styles.publicWorksHead}>
          <div>
            <p className={`${styles.kicker} ${styles.kickerMuted}`}>MY PLAZA · 公开与收藏</p>
            <h3 className={styles.cardTitle}>我的广场</h3>
          </div>
          <div className={styles.publicWorksControls}>
            <div className={styles.schemeTabs} role="tablist" aria-label="我的广场视图切换">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'published'}
                className={tab === 'published' ? styles.tabActive : undefined}
                onClick={() => setTab('published')}
              >
                我的公开作品
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'bookmarks'}
                className={tab === 'bookmarks' ? styles.tabActive : undefined}
                onClick={() => setTab('bookmarks')}
              >
                我的收藏
              </button>
            </div>
            <div className={styles.inlineRow}>
              <Link className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`} to={url}>
                打开公开主页 ↗
              </Link>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
                    setNotice('已复制公开主页链接');
                  } catch {
                    setNotice('复制失败，可打开公开主页后复制地址。');
                  }
                }}
              >
                复制主页链接
              </button>
            </div>
          </div>
        </div>
        {notice && <p className={styles.fieldSuccess} role="status" style={{ marginBottom: 10 }}>{notice}</p>}
        {query.isPending && <p className={styles.emptySmall} role="status">正在加载广场作品…</p>}
        {query.isError && <p className={styles.fieldError} role="alert">{errorMessage(query.error)}</p>}
        {query.data && (
          items.length > 0 ? (
            <PlazaCards items={items} manage={tab === 'published'} />
          ) : (
            <div className={styles.publicWorksEmpty}>
              <span>{tab === 'published' ? '还没有公开发布到广场的定象坊作品。' : '还没有收藏广场作品。'}</span>
              <Link className={styles.textLink} to="/plaza">去广场逛逛 →</Link>
            </div>
          )
        )}
        <MoreButton more={query.hasNextPage} busy={query.isFetchingNextPage} load={() => void query.fetchNextPage()} />
      </div>
    </section>
  );
}
