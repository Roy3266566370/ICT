import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { previewPath, SUBJECTS, type PlazaItem } from '@/api/plazaTypes';
import { worksApi } from '@/api/works';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { useAccountUser } from '@/state/accountSession';
import styles from './Plaza.module.css';

export function PlazaAuthor({ author }: { author: PlazaItem['author'] }) {
  const content = <><AccountAvatar label={author.display_name} avatarUrl={author.avatar_url} size="sm" /><span>{author.display_name}</span></>;
  return author.id ? <Link className={styles.author} to={'/u/' + encodeURIComponent(author.id)}>{content}</Link>
    : <span className={styles.author}>{content}</span>;
}

export function usePlazaListing(shareId: string) {
  const user = useAccountUser();
  return useQuery({
    queryKey: ['plaza', 'share', shareId, user?.user_id],
    queryFn: () => plazaApi.listing(shareId),
    enabled: Boolean(shareId), retry: false,
  });
}

export function ForkButton({ item, label = '复刻到我的空间', className }: {
  item: Pick<PlazaItem, 'kind' | 'share_id' | 'allow_fork'>;
  label?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAccountUser();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function fork() {
    setError('');
    if (!user) {
      navigate('/login?returnTo=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    setBusy(true);
    try {
      const target = item.kind === 'deck'
        ? '/materials/' + encodeURIComponent((await plazaApi.forkDeck(item.share_id)).material_id) + '/work?mode=edit'
        : '/canvas?work=' + encodeURIComponent((await worksApi.fork(item.share_id)).work_id);
      void cache.invalidateQueries({ queryKey: ['plaza'] });
      navigate(target);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {item.allow_fork ? <button type="button" className={className ?? styles.primary} disabled={busy}
      onClick={() => void fork()}>{busy ? '复刻中…' : label}</button> : <span>作者关闭了复刻</span>}
    {error && <span role="alert">{error}</span>}
  </>;
}

/** 点赞/收藏的状态写操作：压缩进 56px 顶栏与卡片底栏共用。 */
export function usePlazaReaction(item: PlazaItem) {
  const user = useAccountUser();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function react(kind: 'like' | 'bookmark') {
    setBusy(true);
    setError('');
    try {
      const updated = await plazaApi.react(item.id, kind);
      cache.setQueryData(['plaza', 'share', item.share_id, user?.user_id], { ...item, ...updated });
      void cache.invalidateQueries({ queryKey: ['plaza'], predicate: query => query.queryKey[1] !== 'share' });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return { react, busy, error, signedIn: Boolean(user) };
}

/**
 * 可嵌入单行顶栏的紧凑操作组：`♥ 点赞 (N)` `★ 收藏` `⚡ 复刻到定象坊`。
 * 未登录时点赞/收藏点击跳转登录；复刻按钮始终可用。
 */
export function PlazaCompactActions({ item }: { item: PlazaItem }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { react, busy, error, signedIn } = usePlazaReaction(item);
  function guard(kind: 'like' | 'bookmark') {
    if (!signedIn) {
      navigate('/login?returnTo=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    void react(kind);
  }
  return <>
    <button type="button" className={styles.reactButton} disabled={busy} aria-pressed={item.liked_by_me}
      title={signedIn ? undefined : '登录后点赞'} onClick={() => guard('like')}>
      ♥ {item.likes > 0 ? item.likes : '点赞'}
    </button>
    <button type="button" className={styles.reactButton} disabled={busy} aria-pressed={item.bookmarked_by_me}
      title={signedIn ? undefined : '登录后收藏'} onClick={() => guard('bookmark')}>
      ★ {item.bookmarked_by_me ? '已收藏' : '收藏'}
    </button>
    {item.allow_fork
      ? <ForkButton key={item.share_id} item={item} label="⚡ 复刻到定象坊" className={styles.forkCta} />
      : null}
    {error && <span role="alert">{error}</span>}
  </>;
}

export function SharePlazaBar({ item }: { item: PlazaItem }) {
  const user = useAccountUser();
  const location = useLocation();
  const { react, busy, error } = usePlazaReaction(item);

  return <aside className={styles.shareBar} aria-label="广场互动">
    <div className={styles.actions}>
      <Link to="/plaza">← 返回广场</Link>
      <PlazaAuthor author={item.author} />
      <span>{SUBJECTS[item.subject]}</span>
      {item.origin && <Link to={previewPath(item.origin)}>改自 @{item.origin.author.display_name}</Link>}
    </div>
    <div className={styles.actions}>
      {user ? <>
        <button type="button" disabled={busy} aria-pressed={item.liked_by_me} onClick={() => void react('like')}>♥ 点赞 {item.likes}</button>
        <button type="button" disabled={busy} aria-pressed={item.bookmarked_by_me} onClick={() => void react('bookmark')}>
          ★ {item.bookmarked_by_me ? '已收藏' : '收藏'}
        </button>
      </> : <Link to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)}>登录后点赞或收藏</Link>}
      <ForkButton key={item.share_id} item={item} />
      {error && <span role="alert">{error}</span>}
    </div>
  </aside>;
}
