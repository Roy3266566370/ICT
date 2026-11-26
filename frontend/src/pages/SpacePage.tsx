import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser, MaterialsListResponse, UserProfile } from '@/api/types';
import { errorMessage } from '@/api/client';
import { useDeleteMaterial, useMaterials } from '@/api/hooks';
import { importProjectPackage } from '@/api/projectPackage';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { worksApi, type WorkSummary } from '@/api/works';
import { CUSTOM_BLOCKS_KEY, listCustomBlocks, removeCustomBlock, type CustomBlockRecord } from '@/canvas/customBlocks';
import { SUBJECT_LABELS } from '@/labs/types';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { DeleteContentDialog } from '@/components/ui/DeleteContentDialog';
import { useEnsureAccountProfile } from '@/hooks/useAccountBootstrap';
import { useAccountProfile, useAccountScope, useAccountStatus, useAccountUser, type AccountStatus } from '@/state/accountSession';
import { SpaceCard, SpaceCover } from './space/SpaceCard';
import { SpaceActivity, SpaceConstellation, SpaceYearMarks } from './space/SpaceOverview';
import {
  buildSpaceItems, filterSpaceItems, findEarliestExpiry, pickContinueItem, relativeAssetTime,
  spaceItemHref, SPACE_KIND_LABEL, type SpaceFilter, type SpaceItem,
} from './space/spaceItems.ts';
import styles from './SpacePage.module.css';

const EMPTY_MATERIALS: MaterialsListResponse['items'] = [];
const EMPTY_WORKS: WorkSummary[] = [];
const FILTERS = ['all', 'material', 'work', 'block'] as const;
const LOGIN_PATH = '/login?returnTo=%2Fspace';

function useTime(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function useLocalBlocks(): [CustomBlockRecord[], () => void] {
  const [blocks, setBlocks] = useState(() => listCustomBlocks());
  const refresh = () => setBlocks(listCustomBlocks());
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === CUSTOM_BLOCKS_KEY || event.key === null) refresh();
    };
    window.addEventListener('storage', sync);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return [blocks, refresh];
}

function remainingTime(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${rest} 分钟`;
  return `${minutes} 分钟`;
}

function GuestBanner({ status, expiry, now }: { status: AccountStatus; expiry: string | null; now: number }): JSX.Element {
  const remaining = expiry ? Date.parse(expiry) - now : 0;
  return <section className={styles.topBanner} aria-label="访客状态">
    <div className={styles.bannerText}>
      <strong>访客模式</strong>
      <p>{status === 'unavailable' ? '账号服务暂时不可用。此浏览器中的积木和本地画布仍可使用。'
        : expiry ? <>
          {remaining > 0 ? <>最早一份访客活页将在 <b>{remainingTime(remaining)}</b> 后自动清理</> : '有访客活页已到期，将自动清理'}
          <span className={styles.expiryDate}>（<time dateTime={expiry}>{new Date(expiry).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
          })}</time>）</span>
        </> : '访客内容与当前浏览器会话关联。登录后可管理个人资料。'}</p>
    </div>
    {status !== 'unavailable' && <div className={styles.bannerActions}>
      <Link className={styles.primary} to={LOGIN_PATH}>登录</Link>
      <Link className={styles.secondary} to="/register">注册</Link>
    </div>}
  </section>;
}

function ProfileStrip({ user, profile, counts, items, now, onFilter }: {
  user: AuthUser; profile: UserProfile | null; counts: Record<SpaceFilter, number>;
  items: readonly SpaceItem[]; now: number; onFilter: (filter: SpaceFilter) => void;
}): JSX.Element {
  const name = user.display_name.trim() || user.email;
  const subject = profile?.preferred_subject;
  const subjectLabel = subject && (SUBJECT_LABELS[subject as keyof typeof SUBJECT_LABELS] ?? subject);
  return <section className={styles.profile} aria-label="个人资料">
    <div className={styles.profileTop}>
      <AccountAvatar className={styles.profileAvatar} size="xl" label={name} avatarUrl={user.avatar_url ?? null}/>
      <div className={styles.profileIdentity}>
        <span className={styles.kicker}>CREATOR FILE / 创作者档案</span>
        <h2>{name}</h2>
        {subjectLabel && <p>{subjectLabel}</p>}
      </div>
      <span aria-hidden="true" className={styles.profileSeal}>象</span>
    </div>
    {profile?.bio.trim() && <p className={styles.profileBio}>{profile.bio.trim()}</p>}
    <div className={styles.profileActions}>
      <div className={styles.profileCounts} aria-label="内容数量">
        {(['material', 'work', 'block'] as const).map(kind =>
          <button key={kind} type="button" onClick={() => onFilter(kind)}><strong>{counts[kind]}</strong>{SPACE_KIND_LABEL[kind]}</button>)}
      </div>
      <SpaceActivity items={items} now={now}/>
      <Link className={styles.primary} to="/settings/profile">编辑资料 ↗</Link>
    </div>
  </section>;
}

function SpaceWorkspace({ status, user, profile }: { status: AccountStatus; user: AuthUser | null; profile: UserProfile | null }) {
  const navigate = useNavigate();
  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();
  const now = useTime();
  const materialsQuery = useMaterials(50);
  const deleteMaterial = useDeleteMaterial();
  const worksQuery = useQuery({ queryKey: keys.works(), queryFn: worksApi.list, refetchOnMount: 'always' });
  const [blocks, refreshBlocks] = useLocalBlocks();
  const materials = materialsQuery.data?.items ?? EMPTY_MATERIALS;
  const works = worksQuery.data?.works ?? EMPTY_WORKS;
  const items = useMemo(() => buildSpaceItems(materials, works, blocks), [materials, works, blocks]);
  const latest = useMemo(() => pickContinueItem(materials, works), [materials, works]);
  const [filter, setFilter] = useState<SpaceFilter>('all');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterSpaceItems(items, filter, query), [items, filter, query]);
  const [pendingDelete, setPendingDelete] = useState<SpaceItem | null>(null);
  const contentTitle = useRef<HTMLHeadingElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const counts = { all: items.length, material: materials.length, work: works.length, block: blocks.length };
  const showMaterials = filter === 'all' || filter === 'material';
  const showWorks = filter === 'all' || filter === 'work';
  const loading = (showMaterials && materialsQuery.isLoading) || (showWorks && worksQuery.isLoading);
  const failed = (showMaterials && materialsQuery.isError) || (showWorks && worksQuery.isError);

  const createBlankCanvas = () => navigate('/canvas', { state: { blank: true } });
  const pickFilter = (value: SpaceFilter) => {
    setQuery('');
    setFilter(value);
    contentTitle.current?.focus({ preventScroll: true });
    contentTitle.current?.scrollIntoView({ block: 'start' });
  };

  const importProject = async (input: File): Promise<void> => {
    setImporting(true);
    setImportError('');
    try {
      const result = await importProjectPackage(input);
      void queryClient.invalidateQueries({ queryKey: keys.materialsRoot() });
      navigate(`/materials/${encodeURIComponent(result.material_id)}/work?page=1`);
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const removeItem = async (item: SpaceItem): Promise<void> => {
    if (item.kind === 'material') {
      await deleteMaterial.mutateAsync(item.id);
    } else if (item.kind === 'work') {
      await worksApi.remove(item.id);
      await queryClient.cancelQueries({ queryKey: keys.works() });
      queryClient.setQueryData<{ works: WorkSummary[] }>(keys.works(), old =>
        old && { works: old.works.filter(row => row.work_id !== item.id) });
    } else {
      removeCustomBlock(item.id);
      if (listCustomBlocks().some(block => block.id === item.id)) throw new Error('浏览器未能删除这块积木，请重试。');
      refreshBlocks();
    }
  };

  return <>
    <div className={styles.heroGrid}>
      {status === 'authenticated' && user
        ? <ProfileStrip user={user} profile={profile} counts={counts} items={items} now={now} onFilter={pickFilter}/>
        : <div className={styles.profile}>
            <span className={styles.kicker}>CREATOR FILE / 创作者档案</span>
            <h2 className={styles.guestTitle}>个人主页</h2>
            <GuestBanner status={status} expiry={findEarliestExpiry(materials)} now={now}/>
            <SpaceActivity items={items} now={now}/>
          </div>}
      <section className={styles.heroPanel} aria-labelledby="space-continue-title">
        <h2 id="space-continue-title">继续上次</h2>
        {latest ? <div className={styles.continueItem}>
          <SpaceCover key={`${latest.kind}:${latest.id}`} item={latest} eager/>
          <div className={styles.continueBody}>
            <h3>{latest.title}</h3>
            {relativeAssetTime(latest.time, now) && <p>{relativeAssetTime(latest.time, now)}</p>}
            <Link className={styles.primary} to={spaceItemHref(latest)}>继续打开 <span aria-hidden="true">↗</span></Link>
          </div>
        </div> : materialsQuery.isLoading || worksQuery.isLoading ? <p className={styles.heroEmpty} role="status">正在查找最近的内容…</p>
          : materialsQuery.isError || worksQuery.isError ? <p className={styles.heroEmpty}>暂时无法读取最近的内容。</p>
          : <div className={styles.heroEmpty}>
            <h3>开始创作</h3>
            <p>上传现有 PPT 或 PDF 制作活页，或在画布拼装自己的交互作品。</p>
            <div className={styles.bannerActions}>
              <Link className={styles.primary} to="/living">上传课件</Link>
              <button className={styles.secondary} type="button" onClick={createBlankCanvas}>新建画布</button>
            </div>
          </div>}
      </section>
    </div>

    <SpaceConstellation items={items} now={now}/>

    <section className={styles.quickPanel} aria-labelledby="space-quick-title">
        <h2 id="space-quick-title">快速开始</h2>
        <div className={styles.quickActions}>
          <Link to="/living"><span aria-hidden="true">↑</span><div><strong>上传课件</strong><small>上传 PPTX 或 PDF 转活页</small></div></Link>
          <button type="button" onClick={createBlankCanvas}><span aria-hidden="true">＋</span><div><strong>新建画布</strong><small>从零搭积木，做交互作品</small></div></button>
          <button type="button" disabled={importing} onClick={() => file.current?.click()}><span aria-hidden="true">↓</span><div>
            <strong>{importing ? '正在导入…' : '导入工程 / HTML'}</strong><small>恢复 .xsproj 或离线 .html</small>
          </div></button>
        </div>
        <input ref={file} type="file" accept=".xsproj,.html,.htm,application/zip,text/html" hidden onChange={event => {
          const input = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (input) void importProject(input);
        }}/>
        {importError && <p className={styles.error} role="alert">{importError}</p>}
    </section>

    <section className={styles.content} aria-labelledby="space-content-title">
      <p className={styles.kicker}>DESK / 创作书桌</p>
      <h2 id="space-content-title" ref={contentTitle} tabIndex={-1}>我的内容</h2>
      <div className={styles.filterBar}>
        <div className={styles.filters} role="group" aria-label="按内容类型筛选">
          {FILTERS.map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'all' ? '全部' : SPACE_KIND_LABEL[value]} <span>{counts[value]}</span>
          </button>)}
        </div>
        <input type="search" aria-label="搜索标题" placeholder="搜索标题" value={query} onChange={event => setQuery(event.currentTarget.value)}/>
      </div>
      {showMaterials && materialsQuery.isError && <p className={styles.error} role="alert">暂时无法读取活页。
        <button type="button" onClick={() => void materialsQuery.refetch()}>重试</button>
      </p>}
      {showWorks && worksQuery.isError && <p className={styles.error} role="alert">暂时无法读取作品。
        <button type="button" onClick={() => void worksQuery.refetch()}>重试</button>
      </p>}
      {visible.length > 0 && <div className={filter === 'all' ? styles.desk : undefined}>
        {(filter === 'all' ? (['work', 'material', 'block'] as const) : [filter]).map(kind => {
          const cards = visible.filter(item => item.kind === kind);
          if (!cards.length) return null;
          return <div key={kind} className={styles.deskColumn}>
            {filter === 'all' && <h3>{SPACE_KIND_LABEL[kind]} <span>{cards.length}</span></h3>}
            <div className={styles.cardGrid}>
              {cards.map(item => <SpaceCard key={item.id} item={item} now={now} onDelete={setPendingDelete}/>)}
            </div>
          </div>;
        })}
      </div>}
      {loading && <p className={styles.listState} role="status">正在读取内容…</p>}
      {!loading && !failed && visible.length === 0 && <p className={styles.listState}>
        {query.trim() ? '没有匹配的标题。' : filter === 'all' ? '这里还没有内容。'
          : filter === 'block' ? '还没有积木。可在画布中封装并保存到积木库。' : `还没有${SPACE_KIND_LABEL[filter]}。`}
      </p>}
    </section>

    <SpaceYearMarks items={items}/>
    <details className={styles.storageAccordion}>
      <summary>了解数据存储与隐私说明</summary>
      <ul>
        <li>活页按到期时间自动清理。可在通文册工作台导出课件留存。</li>
        <li>积木保存在当前浏览器，换设备或清除浏览器数据后无法读取。</li>
        <li>登录后可管理显示名、默认入口与个人资料。</li>
      </ul>
    </details>
    {pendingDelete && <DeleteContentDialog label={SPACE_KIND_LABEL[pendingDelete.kind]} title={pendingDelete.title} onDismiss={deleted => {
      setPendingDelete(null);
      if (deleted) contentTitle.current?.focus({ preventScroll: true });
    }} onDelete={() => removeItem(pendingDelete)}/>}
  </>;
}

export function SpacePage(): JSX.Element {
  const scope = useAccountScope();
  const status = useAccountStatus();
  const user = useAccountUser();
  const profile = useAccountProfile();
  useEnsureAccountProfile();

  return <>
    <MainSiteNav current="workspace" />
    <div className={`${styles.page} studio-scope atelier-paper`}>
      <main id="main" className={styles.main}>
        <h1 className={styles.srOnly}>个人主页</h1>
        {status === 'restoring' ? <p className={styles.listState} role="status">正在恢复账号状态…</p>
          : <SpaceWorkspace key={scope} status={status} user={user} profile={profile}/>}
      </main>
    </div>
  </>;
}

export default SpacePage;
