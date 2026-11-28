/**
 * WorkshopPage.tsx —— 定象坊(/workshop):纯粹的个人创作工坊
 *
 * 标本柜与公开画廊已统一收编到 /plaza 广场;本页只保留:
 *  纸墨 Hero + 象砖字架(直达广场标本柜)+ § 01 我的作品 + § 02 精选快速起步(6 张)+ 象砖工造 3 步引导。
 * 旧链接 /workshop?subject=|topic=|q= 自动重定向到 /plaza?tab=specimens 对应筛选。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { prefetchRouteWhenIdle, routePrefetchHandlers } from '@/components/navigation/routePrefetch';
import { WorkshopIntroBanner } from '@/components/intros/WorkshopIntroBanner';
import { worksApi, type WorkSummary } from '@/api/works';
import {
  ALL_ITEMS, STARTER_SPECIMENS, CatalogCard, isValidTemplateCategory,
} from './workshop/specimenCatalog';
import specimenStyles from './workshop/SpecimenCatalog.module.css';
import styles from './WorkshopPage.module.css';

// 标本柜类型与组件的兼容再导出,防止外部引用断裂。
export { CatalogCard, TopicCatalog, type CatalogItem, type WorkshopTopic } from './workshop/specimenCatalog';
export { CALCULUS_TOPICS, LAB408_TOPICS } from './workshop/specimenCatalog';

function CanvasGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="3.2" y="4" width="17.6" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.2" cy="9.2" r="1.7" fill="currentColor" />
      <circle cx="16" cy="15" r="1.7" fill="currentColor" />
      <path d="M8.2 9.2 16 15M8.6 15h4.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 2.2" />
    </svg>
  );
}

function SkeletonRows(): JSX.Element {
  return (
    <div aria-hidden="true">
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 3 }, (_, i) => <span key={i} className={styles.skeletonRow} />)}
      </div>
      <span className="visually-hidden" role="status">载入中…</span>
    </div>
  );
}

export function WorkshopPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const loadWorks = useCallback((): void => {
    setLoadError('');
    worksApi.list().then((r) => setWorks(r.works)).catch(() => setLoadError('作品列表加载失败,请重试。'));
  }, []);
  useEffect(loadWorks, [loadWorks]);
  useEffect(() => prefetchRouteWhenIdle('canvas'), []);

  const openWork = useCallback((wid: string) => {
    navigate(`/canvas?work=${encodeURIComponent(wid)}`, { state: { from: '/workshop', fromLabel: '← 定象坊', restoreScroll: true } });
  }, [navigate]);

  const blank = useCallback(() => {
    navigate('/canvas', { state: { blank: true, from: '/workshop', fromLabel: '← 定象坊', restoreScroll: true } });
  }, [navigate]);

  const openTemplate = useCallback((key: string) => {
    navigate(`/canvas?template=${encodeURIComponent(key)}`, { state: { from: '/workshop', fromLabel: '← 定象坊', restoreScroll: true } });
  }, [navigate]);

  const remove = useCallback(async (wid: string) => {
    if (!window.confirm('删除这个作品?已发布的分享链接会一并失效。')) return;
    try {
      await worksApi.remove(wid);
      setWorks((w) => (w ?? []).filter((x) => x.work_id !== wid));
    } catch {
      window.alert('删除失败。');
    }
  }, []);

  /* ---------- 旧链接平滑重定向:标本柜相关参数统一迁往广场 ---------- */
  const legacySubject = searchParams.get('subject');
  const legacyTopic = searchParams.get('topic');
  const legacyQuery = searchParams.get('q');
  if (legacySubject !== null || legacyTopic !== null || legacyQuery !== null) {
    const next = new URLSearchParams({ tab: 'specimens' });
    if (isValidTemplateCategory(legacySubject)) next.set('subject', legacySubject);
    if (legacyTopic) next.set('topic', legacyTopic);
    if (legacyQuery) next.set('q', legacyQuery);
    return <Navigate to={`/plaza?${next}`} replace />;
  }

  return <>
    <MainSiteNav current="canvas" />
    <div className={`${styles.catalogPage} studio-scope atelier-paper`}>

      <main className={styles.main}>
        <header className={styles.pageHead}>
          <div className={styles.headCopy}>
            <div className={styles.headBadge}>
              <i aria-hidden="true" /> DINGXIANG ATELIER · 定象坊
            </div>
            <h1 className={styles.title}>
              搭一块砖,<br /><span className={styles.titleHighlight}>定一种象。</span>
            </h1>
            <p className={styles.lead}>
              公式、算法与物理场,都是可拆、可连、可运行的<strong>积木</strong>。排起来就是一件作品,也能嵌入通文册,让读者动手探索。
            </p>
            <div className={styles.headActions}>
              <button type="button" className={styles.blankButton} {...routePrefetchHandlers('/canvas')} onClick={blank}>＋ 新建空白画布</button>
              <Link to="/plaza?tab=specimens" className={styles.secondaryButton}>逛广场标本柜 →</Link>
            </div>
            <div className={styles.headMetrics}>
              <div className={styles.headMetric}>
                <strong>{ALL_ITEMS.length}</strong>
                <span>学科真内核模板</span>
              </div>
              <div className={styles.headMetric}>
                <strong>6 大领域</strong>
                <span>跨学科模板</span>
              </div>
              <div className={styles.headMetric}>
                <strong>{works === null ? '—' : works.length}</strong>
                <span>我的已存作品</span>
              </div>
              <div className={styles.headMetric}>
                <strong>0</strong>
                <span>额外插件安装</span>
              </div>
            </div>
          </div>

          <WorkshopIntroBanner />
        </header>

        <section className={styles.typeCase} aria-label="象砖字架">
          <div><span>TYPE CASE / 字架</span><h2>取一枚,排上去</h2></div>
          <div className={styles.typeCaseBricks}>
            {([
              ['calculus', 'ƒ', '函数砖', '高等数学'],
              ['mechanics', '→', '场砖', '大学物理'],
              ['lab408', '⌗', '算法砖', '408 专题'],
              ['deep', '∇', '学习砖', '深度学习'],
              ['business', '▥', '数据砖', '办公决策'],
            ] as const).map(([subject, glyph, label, detail]) => (
              <Link key={subject} to={`/plaza?tab=specimens&subject=${subject}`}>
                <span aria-hidden="true">{glyph}</span><div><strong>{label}</strong><small>{detail}</small></div>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="workshop-mine">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 01</span> MY WORKS / 个人沉淀</p>
              <h2 id="workshop-mine" className={styles.sectionTitle}>我的作品</h2>
            </div>
            <span className={styles.countPill}>{works === null ? '载入中' : `${works.length} 件`}</span>
          </div>
          {loadError ? <p className={styles.loadError} role="status">{loadError} <button type="button" onClick={loadWorks}>重试</button></p> : null}
          {works === null && !loadError ? <SkeletonRows /> : null}
          {works && works.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true"><CanvasGlyph /></span>
              <p className={styles.emptyTitle}>画布还空着</p>
              <p className={styles.emptyLead}>从一张空白画布开始,或去广场标本柜挑一件现成的仪器改造。</p>
              <div className={styles.emptyActions}>
                <button type="button" className={styles.blankButton} onClick={blank}>＋ 新建空白画布</button>
                <Link to="/plaza?tab=specimens" className={styles.secondaryButton}>去广场挑一件标本 →</Link>
              </div>
            </div>
          ) : null}
          {works && works.length > 0 ? (
            <ul className={styles.workList}>
              {works.map((w) => (
                <li key={w.work_id} className={styles.workCard}>
                  <button type="button" className={styles.workMain} onClick={() => openWork(w.work_id)}>
                    <span className={styles.workGlyph} aria-hidden="true"><CanvasGlyph /></span>
                    <span className={styles.workBody}>
                      <b>{w.title || '未命名作品'}</b>
                      <span className={styles.workMeta}>
                        {w.node_count} 个对象 · v{w.revision}
                        {w.forked_from_share ? ' · 改造自画廊' : ''}
                      </span>
                    </span>
                    <span className={styles.workArrow} aria-hidden="true">→</span>
                  </button>
                  <button
                    type="button"
                    className={styles.workDel}
                    aria-label={`删除 ${w.title || '未命名作品'}`}
                    onClick={() => void remove(w.work_id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="workshop-starters">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 02</span> STARTERS / 精选快速起步</p>
              <h2 id="workshop-starters" className={styles.sectionTitle}>从一件标本开始</h2>
            </div>
            <Link to="/plaza?tab=specimens" className={styles.starterMore}>浏览全部 {ALL_ITEMS.length} 个标本 →</Link>
          </div>
          <div className={specimenStyles.tplGrid} data-starter>
            {STARTER_SPECIMENS.map((item) => <CatalogCard key={item.key} item={item} disabled={false}
              creating={false} actionLabel="打开实验 →" onCreate={() => openTemplate(item.key)} />)}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="workshop-maker">
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionEyebrow}>象砖工造</p>
              <h2 id="workshop-maker" className={styles.sectionTitle}>从一块砖,到一件能跑的作品</h2></div>
          </div>
          <div className={styles.makerSteps}>
            <Link to="/plaza?tab=specimens"><span>01 · 选砖</span><h3>选择一个实验积木</h3><p>从广场标本柜打开一个可运行的实验。</p></Link>
            <button type="button" onClick={blank}><span>02 · 排字</span><h3>把数据口连起来</h3><p>在画布上接线,让参数流进下游积木。</p></button>
            <Link to="/living"><span>03 · 装订</span><h3>定象,然后装订成册</h3><p>把保存的仪器嵌进通文册任意一页。</p></Link>
          </div>
        </section>
      </main>
    </div>
  </>;
}

export default WorkshopPage;
