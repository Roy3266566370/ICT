import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { SiteNav } from '@/components/home/SiteNav';
import { PlazaCards } from '@/components/plaza/PlazaCards';
import styles from '@/components/plaza/Plaza.module.css';
import { useAccountUser } from '@/state/accountSession';
import { MoreButton } from '@/components/plaza/plazaQueries';
import { SpaceCreatorCard } from './space/SpaceCreatorCard';

export default function CreatorPage() {
  const { userId = '' } = useParams();
  const user = useAccountUser();
  const query = useInfiniteQuery({
    queryKey: ['plaza', 'creator', userId, user?.user_id],
    queryFn: ({ pageParam }) => plazaApi.creator(userId, pageParam, 'workshop'),
    initialPageParam: 0,
    getNextPageParam: (page, all) => page.has_more ? all.reduce((sum, value) => sum + value.items.length, 0) : undefined,
    retry: false,
  });
  const creator = query.data?.pages[0];
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  const pinned = items.find(item => item.pinned);
  return <>
    <SiteNav current={null} appearance="studio" />
    <div className={`${styles.plazaScope} studio-scope atelier-paper`}>
      <main className={styles.page}>
        <p className={styles.backRow}><Link to="/plaza">← 返回广场</Link></p>
        {query.isPending && <p role="status">正在打开创作者展厅…</p>}
        {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
        {creator && <div className={styles.creator}>
          <SpaceCreatorCard readOnly creator={creator} />
          <div>
            <h1>创作者展厅</h1>
            {pinned && <><h2>置顶代表作</h2><PlazaCards offerFork items={[pinned]} /></>}
            <h2>公开教具</h2>
            <PlazaCards offerFork items={items.filter(item => item.id !== pinned?.id)} />
            <MoreButton more={query.hasNextPage} busy={query.isFetchingNextPage} load={() => void query.fetchNextPage()} />
          </div>
        </div>}
      </main>
    </div>
  </>;
}
