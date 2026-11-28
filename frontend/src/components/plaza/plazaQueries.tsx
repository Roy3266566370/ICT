import { useInfiniteQuery } from '@tanstack/react-query';
import type { PlazaPageData } from '@/api/plazaTypes';
import styles from './Plaza.module.css';

export function usePlazaPages(key: unknown[], load: (offset: number) => Promise<PlazaPageData>, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['plaza', ...key], queryFn: ({ pageParam }) => load(pageParam),
    initialPageParam: 0, enabled,
    getNextPageParam: (page, all) => page.has_more ? all.reduce((sum, value) => sum + value.items.length, 0) : undefined,
  });
}

export function MoreButton({ more, busy, load }: { more: boolean; busy: boolean; load: () => void }) {
  return more && <button type="button" className={styles.load} disabled={busy} onClick={load}>{busy ? '加载中…' : '加载更多'}</button>;
}

