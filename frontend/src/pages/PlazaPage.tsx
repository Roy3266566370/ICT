/**
 * PlazaPage.tsx —— 定象坊广场(/plaza):统一的发现与复用中心
 *
 * 3 态视图(同步 ?tab=):
 *  - all(默认):创作者公开教具精选区(若有)+ 完整官方标本柜;
 *  - specimens:纯官方标本柜(6 大领域 + 专题筛选 + 自定义专题名);
 *  - community:纯社区作品(学科胶囊 + 排序 + 分页)。
 * 默认视图下 Spotlight 活展台仅用 source=official 旗舰快照驱动,
 * 社区区块只拉 source=community,两者与标本柜互不重复。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { WORKSHOP_SUBJECTS, SUBJECT_COLORS, type ListingOptions, type PlazaItem } from '@/api/plazaTypes';
import { worksApi } from '@/api/works';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { PlazaCards } from '@/components/plaza/PlazaCards';
import { PlazaSpotlight } from '@/components/plaza/PlazaSpotlight';
import { PlazaSpecimenSection } from '@/components/plaza/PlazaSpecimenSection';
import { MoreButton, usePlazaPages } from '@/components/plaza/plazaQueries';
import { PublishDialog } from '@/components/plaza/PublishDialog';
import { useAccountUser } from '@/state/accountSession';
import { ALL_ITEMS, isValidTemplateCategory, type TemplateCategory } from '@/pages/workshop/specimenCatalog';
import styles from '@/components/plaza/Plaza.module.css';

type PlazaTab = 'all' | 'specimens' | 'community';

const COMMUNITY_SORTS = { featured: '推荐精选', forks: '最多复刻', latest: '最新发布' } as const;

/** 「发布我的教具」选器:只拉取并展示定象坊作品,不再混入通文册课件。 */
function PublishPicker({ close }: { close: () => void }) {
  const user = useAccountUser();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const works = useQuery({ queryKey: ['plaza-picker', 'works', user?.user_id], queryFn: worksApi.list, enabled: Boolean(user) });
  const [selection, setSelection] = useState('');
  async function publish(options?: ListingOptions) {
    if (!options || !selection) return;
    const result = await worksApi.publish(selection, options);
    void cache.invalidateQueries({ queryKey: ['plaza'] });
    navigate(result.share_url);
  }
  return <PublishDialog onClose={close} onPublish={publish} listingOnly>
    {user && <>
      <label>选择教具
        <select value={selection} onChange={event => setSelection(event.target.value)} required>
          <option value="">从我的定象坊作品中选择</option>
          {works.data?.works.map(item =>
            <option value={item.work_id} key={item.work_id}>{item.title}</option>)}
        </select>
      </label>
      {works.data && !works.data.works.length && <p>还没有定象坊作品,先去画布搭一件吧。</p>}
      {works.isError && <p role="alert">作品加载失败。也可在定象坊编辑器中直接发布。</p>}
      <div className={styles.actions}><Link to="/workshop">打开定象坊</Link></div>
    </>}
  </PublishDialog>;
}

/* ---------- 返回快照:记住筛选与滚动位置,从画布返回时恢复 ---------- */

const PLAZA_RETURN_KEY = 'xiangsheng.plaza.returnState';

interface PlazaReturnState {
  tab: PlazaTab;
  subject: TemplateCategory;
  topic: string;
  csubject: string;
  sort: string;
  q: string;
  page: number;
  scrollY: number;
}

function readPlazaReturnState(): PlazaReturnState | null {
  try {
    const raw = window.sessionStorage.getItem(PLAZA_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlazaReturnState>;
    return {
      tab: parsed.tab === 'specimens' || parsed.tab === 'community' ? parsed.tab : 'all',
      subject: isValidTemplateCategory(parsed.subject ?? null) ? parsed.subject as TemplateCategory : 'all',
      topic: typeof parsed.topic === 'string' ? parsed.topic : '',
      csubject: typeof parsed.csubject === 'string' ? parsed.csubject : '',
      sort: typeof parsed.sort === 'string' ? parsed.sort : 'featured',
      q: typeof parsed.q === 'string' ? parsed.q : '',
      page: typeof parsed.page === 'number' && Number.isFinite(parsed.page) ? Math.max(1, Math.floor(parsed.page)) : 1,
      scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? Math.max(0, parsed.scrollY) : 0,
    };
  } catch {
    return null;
  }
}

function writePlazaReturnState(state: PlazaReturnState): void {
  try {
    window.sessionStorage.setItem(PLAZA_RETURN_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage failures */
  }
}

export default function PlazaPage() {
  const user = useAccountUser();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedReturn = useRef<PlazaReturnState | null>(readPlazaReturnState());
  const hasExplicitParams = searchParams.has('tab') || searchParams.has('subject')
    || searchParams.has('topic') || searchParams.has('q') || searchParams.has('page');

  /* ---------- URL 同步的视图状态 ---------- */
  const tabParam = searchParams.get('tab');
  const tab: PlazaTab = tabParam === 'specimens' || tabParam === 'community' ? tabParam : 'all';
  const subjectParam = searchParams.get('subject');
  const specimenCategory: TemplateCategory = isValidTemplateCategory(subjectParam)
    ? subjectParam
    : (!hasExplicitParams && savedReturn.current ? savedReturn.current.subject : 'all');
  const topicFilter = searchParams.get('topic')
    ?? (!hasExplicitParams && savedReturn.current ? savedReturn.current.topic : '');
  const csubject = searchParams.get('csubject')
    ?? (!hasExplicitParams && savedReturn.current ? savedReturn.current.csubject : '');
  const sortParam = searchParams.get('sort');
  const sort: keyof typeof COMMUNITY_SORTS = sortParam === 'forks' || sortParam === 'latest' ? sortParam
    : (!hasExplicitParams && savedReturn.current && (savedReturn.current.sort === 'forks' || savedReturn.current.sort === 'latest')
      ? savedReturn.current.sort : 'featured');
  const urlQuery = searchParams.get('q');
  const pageParam = Number.parseInt(searchParams.get('page') ?? '', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam
    : (!hasExplicitParams && savedReturn.current ? savedReturn.current.page : 1);

  const [search, setSearch] = useState(() =>
    urlQuery ?? (!hasExplicitParams && savedReturn.current ? savedReturn.current.q : ''));
  const [q, setQuery] = useState(() =>
    urlQuery ?? (!hasExplicitParams && savedReturn.current ? savedReturn.current.q : ''));
  const [publishing, setPublishing] = useState(false);

  // 地址栏 q 变化(如返回恢复)时同步进输入框
  useEffect(() => {
    if (urlQuery !== null && urlQuery !== q) {
      setSearch(urlQuery);
      setQuery(urlQuery);
    }
  }, [urlQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchParams = useCallback((patch: (next: URLSearchParams) => void) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      patch(next);
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams]);

  const selectTab = useCallback((next: PlazaTab) => {
    patchParams((params) => {
      if (next === 'all') params.delete('tab'); else params.set('tab', next);
    });
  }, [patchParams]);

  const selectCategory = useCallback((key: TemplateCategory) => {
    patchParams((params) => {
      params.set('subject', key);
      params.delete('topic');
      params.delete('page');
    });
  }, [patchParams]);

  const selectTopic = useCallback((id: string) => {
    patchParams((params) => {
      if (id === 'all') params.delete('topic'); else params.set('topic', id);
      params.delete('page');
    });
  }, [patchParams]);

  const submitSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    setQuery(trimmed);
    patchParams((params) => {
      if (trimmed) params.set('q', trimmed); else params.delete('q');
      params.delete('page');
    });
  }, [patchParams]);

  const selectPage = useCallback((next: number) => {
    patchParams((params) => {
      if (next <= 1) params.delete('page'); else params.set('page', String(next));
    });
  }, [patchParams]);

  /* ---------- 数据请求拆分 ---------- */
  // Spotlight:仅官方旗舰快照(可内嵌试玩的 8 件),与标本柜/社区均不重复
  const spotlightQuery = useQuery({
    queryKey: ['plaza', 'spotlight', user?.user_id],
    queryFn: () => plazaApi.list(new URLSearchParams({ kind: 'workshop', source: 'official', sort: 'featured', limit: '8' })),
  });
  // 社区作品:tab=all 时只取前 6 件精选;tab=community 时全量分页
  const inCommunityTab = tab === 'community';
  const communityQuery = usePlazaPages(['gallery', user?.user_id, tab, csubject, sort, q], offset => {
    const params = new URLSearchParams({ kind: 'workshop', source: 'community', offset: String(offset) });
    if (inCommunityTab) {
      params.set('sort', sort);
      if (csubject) params.set('subject', csubject);
    } else {
      params.set('sort', 'forks');
      params.set('limit', '6');
    }
    if (q) params.set('q', q);
    return plazaApi.list(params);
  });

  const communityItems = communityQuery.data?.pages.flatMap(page => page.items) ?? [];
  const spotlightItems = spotlightQuery.data?.items ?? [];
  // 智能折叠:搜索、进入单一子视图或选中具体标本学科/专题时收起 Spotlight
  const showSpotlight = tab === 'all' && !q && specimenCategory === 'all' && !topicFilter;

  /* ---------- 返回快照:进入画布前保存,返回时恢复 ---------- */
  const stateRef = useRef({ tab, specimenCategory, topicFilter, csubject, sort, q, page });
  stateRef.current = { tab, specimenCategory, topicFilter, csubject, sort, q, page };
  const saveReturnSnapshot = useCallback((): string => {
    const cur = stateRef.current;
    writePlazaReturnState({
      tab: cur.tab, subject: cur.specimenCategory, topic: cur.topicFilter,
      csubject: cur.csubject, sort: cur.sort, q: cur.q, page: cur.page, scrollY: window.scrollY,
    });
    return location.pathname + location.search;
  }, [location.pathname, location.search]);

  useLayoutEffect(() => () => {
    const cur = stateRef.current;
    writePlazaReturnState({
      tab: cur.tab, subject: cur.specimenCategory, topic: cur.topicFilter,
      csubject: cur.csubject, sort: cur.sort, q: cur.q, page: cur.page, scrollY: window.scrollY,
    });
  }, []);

  const restoreScroll = useRef(navigationType === 'POP' || (location.state as { restoreScroll?: boolean } | null)?.restoreScroll === true);
  useEffect(() => {
    const saved = savedReturn.current;
    if (!restoreScroll.current || !saved || saved.scrollY <= 0) return;
    // 内容分批渲染时会逐步撑高页面,单次 scrollTo 会被钳制;
    // 在最多 2.5s 内反复尝试,直到达到目标位置。
    let cancelled = false;
    const startedAt = performance.now();
    const attempt = () => {
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, left: 0, behavior: 'auto' });
      if (Math.abs(window.scrollY - saved.scrollY) > 4 && performance.now() - startedAt < 2500) {
        window.setTimeout(attempt, 120);
      }
    };
    const raf = window.requestAnimationFrame(attempt);
    return () => { cancelled = true; window.cancelAnimationFrame(raf); };
  }, []);

  const openTemplate = useCallback((key: string) => {
    const from = saveReturnSnapshot();
    navigate(`/canvas?template=${encodeURIComponent(key)}`, {
      state: { from, fromLabel: '← 定象坊广场', restoreScroll: true },
    });
  }, [navigate, saveReturnSnapshot]);

  const communityEmpty = communityQuery.data && !communityItems.length;

  return <>
    <MainSiteNav current="plaza" />
    <div className={`${styles.plazaScope} studio-scope atelier-paper`}>
      <main className={styles.page}>
        <header className={styles.curatorHead}>
          <div>
            <span className={styles.eyebrow}><i aria-hidden="true" />DINGXIANG GALLERY · 交互教具策展</span>
            <h1 className={styles.curatorTitle}>定象坊广场</h1>
            <p className={styles.curatorLead}>每一件教具都能现场试玩:拖动参数、观察联动,顺手复刻到自己的画布继续改造。</p>
          </div>
          <div className={styles.headActions}>
            <form className={styles.capsuleSearch} onSubmit={event => { event.preventDefault(); submitSearch(search); }}>
              <input type="search" aria-label="搜索作品" placeholder="搜索标本、教具标题或简介"
                maxLength={120} value={search}
                onChange={event => { setSearch(event.target.value); if (!event.target.value) submitSearch(''); }} />
              <button type="submit">搜索</button>
            </form>
            <button type="button" className={styles.publishButton} onClick={() => setPublishing(true)}>＋ 发布我的教具</button>
          </div>
        </header>

        {showSpotlight && spotlightItems.length > 0 && <PlazaSpotlight items={spotlightItems} />}

        {/* 顶层 3 态视图切换 */}
        <div className={styles.tabBar} role="group" aria-label="广场视图切换">
          <button type="button" aria-pressed={tab === 'all'} onClick={() => selectTab('all')}>
            全部<small>社区 + 标本柜</small>
          </button>
          <button type="button" aria-pressed={tab === 'specimens'} onClick={() => selectTab('specimens')}>
            官方标本柜<small>{ALL_ITEMS.length} 件标本</small>
          </button>
          <button type="button" aria-pressed={tab === 'community'} onClick={() => selectTab('community')}>
            创作者作品<small>社区公开教具</small>
          </button>
        </div>

        {tab !== 'specimens' && <>
          {/* 创作者公开教具区块:all 态为精选 preview,community 态为全量 */}
          {inCommunityTab && <div className={styles.pillbar}>
            <div className={styles.pillTabs} role="group" aria-label="学科筛选">
              <button type="button" className={styles.pill} aria-pressed={csubject === ''}
                onClick={() => patchParams((params) => params.delete('csubject'))}>全部</button>
              {Object.entries(WORKSHOP_SUBJECTS).map(([id, label]) =>
                <button type="button" key={id} className={styles.pill} data-subject aria-pressed={csubject === id}
                  style={{ '--subject-color': SUBJECT_COLORS[id as keyof typeof SUBJECT_COLORS] } as CSSProperties}
                  onClick={() => patchParams((params) => params.set('csubject', id))}>{label}</button>)}
            </div>
            <div className={styles.barControls}>
              <select className={styles.sortSelect} aria-label="排序" value={sort}
                onChange={event => patchParams((params) => params.set('sort', event.target.value))}>
                {Object.entries(COMMUNITY_SORTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
          </div>}

          {communityQuery.isPending && <p role="status">正在加载作品…</p>}
          {communityQuery.isError && <p role="alert">{errorMessage(communityQuery.error)}</p>}

          {communityItems.length > 0 && <section className={styles.communitySection} aria-label="创作者公开教具">
            {tab === 'all' && <div className={styles.sectionHeadRow}>
              <h2>创作者公开教具</h2>
              <button type="button" className={styles.linkButton} onClick={() => selectTab('community')}>查看全部社区作品 →</button>
            </div>}
            <PlazaCards items={inCommunityTab ? communityItems : communityItems.slice(0, 6)} />
            {inCommunityTab && <MoreButton more={communityQuery.hasNextPage} busy={communityQuery.isFetchingNextPage}
              load={() => void communityQuery.fetchNextPage()} />}
          </section>}

          {communityEmpty && (inCommunityTab ? <div className={styles.emptyPanel}>
            <p className={styles.emptyPanelTitle}>{q ? `没有匹配“${q}”的社区作品` : '社区还没有公开教具'}</p>
            <p className={styles.emptyPanelLead}>第一件公开的教具,可以是从你的画布诞生的那一件。</p>
            <button type="button" className={styles.publishButton} onClick={() => setPublishing(true)}>＋ 发布我的第一件教具</button>
          </div> : null)}
        </>}

        {tab !== 'community' && <section className={styles.specimenWrap} aria-label="官方标本柜">
          {tab === 'all' && <div className={styles.sectionHeadRow}>
            <h2>官方标本柜</h2>
            <span className={styles.countNote}>{ALL_ITEMS.length} 件学科真内核标本</span>
          </div>}
          <PlazaSpecimenSection
            query={q}
            category={specimenCategory}
            topicFilter={topicFilter}
            page={page}
            onSelectCategory={selectCategory}
            onSelectTopic={selectTopic}
            onSelectPage={selectPage}
            onOpenTemplate={openTemplate}
          />
        </section>}

        {tab === 'all' && q && communityEmpty && <div className={styles.emptyPanel}>
          <p className={styles.emptyPanelTitle}>广场上没有匹配“{q}”的内容</p>
          <p className={styles.emptyPanelLead}>试试更换关键词,或清空搜索回到完整策展。</p>
          <button type="button" className={styles.linkButton} onClick={() => { setSearch(''); submitSearch(''); }}>清空搜索</button>
        </div>}

        {publishing && <PublishPicker close={() => setPublishing(false)} />}
      </main>
    </div>
  </>;
}
