import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { PlazaCards } from '@/components/plaza/PlazaCards';
import styles from '@/components/plaza/Plaza.module.css';
import { MoreButton, usePlazaPages } from '@/components/plaza/plazaQueries';

export function SpacePublicWorks({ userId }: { userId: string }) {
  const [tab, setTab] = useState<'published' | 'bookmarks'>('published');
  const [notice, setNotice] = useState('');
  const query = usePlazaPages(['space', userId, tab], offset => tab === 'bookmarks'
    ? plazaApi.bookmarks(offset, 'workshop')
    : plazaApi.list(new URLSearchParams({ author_id: userId, kind: 'workshop', offset: String(offset) })));
  const url = '/u/' + encodeURIComponent(userId);
  return <section className={styles.spaceCard} aria-label="我的广场">
    <h2>我的广场</h2>
    <div className={styles.filters}>
      <button type="button" aria-pressed={tab === 'published'} onClick={() => setTab('published')}>我的公开作品</button>
      <button type="button" aria-pressed={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>我的收藏</button>
      <Link to={url}>打开公开主页</Link>
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
          setNotice('已复制公开主页链接');
        } catch { setNotice('复制失败，可打开公开主页后复制地址。'); }
      }}>复制公开主页链接</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {query.isPending && <p role="status">加载中…</p>}
    {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
    {query.data && <PlazaCards items={query.data.pages.flatMap(page => page.items)} manage={tab === 'published'} />}
    <MoreButton more={query.hasNextPage} busy={query.isFetchingNextPage} load={() => void query.fetchNextPage()} />
  </section>;
}
