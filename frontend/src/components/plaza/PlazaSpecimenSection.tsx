/**
 * PlazaSpecimenSection.tsx —— 广场内的官方标本柜完整交互区块
 *
 *  6 大领域胶囊 + 二级专题筛选(可智能隐藏)+ 每页 9 张扁平分页 / 专题分组双模式渲染。
 * 分页页码由广场页面受控并同步 URL ?page=,本组件只负责纯粹的筛选渲染。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  TopicCatalog,
  getCatalogView,
  matchesQuery,
  CALCULUS_ITEMS,
  LINALG_ITEMS,
  PHYSICS_ITEMS,
  LAB408_ITEMS,
  DEEP_ITEMS,
  BUSINESS_ITEMS,
  ALL_ITEMS,
  CatalogCard,
  type TemplateCategory,
} from '@/pages/workshop/specimenCatalog';
import {
  readTopicAliases, topicDisplayName, writeTopicAlias, type TopicAliases,
} from '@/pages/workshopTopics';
import styles from '@/pages/workshop/SpecimenCatalog.module.css';
import { paginationRange } from './plazaPagination';

export const SPECIMEN_PAGE_SIZE = 9;

/** 跨学科冗余专题条在这些分类下隐藏:全部(扁平分页)、深度学习/线代(纯全景沙盘)。 */
const NO_TOPIC_CATEGORIES: ReadonlySet<TemplateCategory> = new Set(['all', 'deep', 'linalg']);

export interface PlazaSpecimenSectionProps {
  query: string;
  category: TemplateCategory;
  topicFilter: string;
  page: number;
  onSelectCategory: (key: TemplateCategory) => void;
  onSelectTopic: (id: string) => void;
  onSelectPage: (page: number) => void;
  onOpenTemplate: (key: string) => void;
}

const CATEGORY_PILLS: readonly (readonly [TemplateCategory, string])[] = [
  ['all', '全部标本'],
  ['calculus', '高等数学'],
  ['linalg', '线性代数'],
  ['mechanics', '大学物理'],
  ['lab408', '408 专题'],
  ['deep', '深度学习'],
  ['business', '办公决策'],
];

const CATEGORY_COUNTS: Record<TemplateCategory, number> = {
  all: ALL_ITEMS.length,
  calculus: CALCULUS_ITEMS.length,
  linalg: LINALG_ITEMS.length,
  mechanics: PHYSICS_ITEMS.length,
  lab408: LAB408_ITEMS.length,
  deep: DEEP_ITEMS.length,
  business: BUSINESS_ITEMS.length,
};

export function PlazaSpecimenSection({
  query,
  category,
  topicFilter,
  page,
  onSelectCategory,
  onSelectTopic,
  onSelectPage,
  onOpenTemplate,
}: PlazaSpecimenSectionProps): JSX.Element {
  const [topicAliases, setTopicAliases] = useState<TopicAliases>(() => readTopicAliases());
  const sectionRef = useRef<HTMLDivElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const view = getCatalogView(category);
  const knownTopicIds = new Set(view.topics.map((topic) => topic.id));
  const searchedItems = view.items.filter((item) => knownTopicIds.has(item.topic) && matchesQuery(item, normalizedQuery));
  const hideTopicRail = NO_TOPIC_CATEGORIES.has(category);
  const selectedTopicId = topicFilter && view.topics.some((topic) => topic.id === topicFilter) ? topicFilter : 'all';
  const activeTopicId = normalizedQuery || hideTopicRail ? 'all' : selectedTopicId;
  const shownItems = activeTopicId === 'all'
    ? searchedItems : searchedItems.filter((item) => item.topic === activeTopicId);
  const shownTopics = (activeTopicId === 'all'
    ? view.topics : view.topics.filter((topic) => topic.id === activeTopicId))
    .map((topic) => ({ ...topic, name: topicDisplayName(topic, topicAliases) }));
  const selectedTopic = selectedTopicId === 'all'
    ? null : view.topics.find((topic) => topic.id === selectedTopicId) ?? null;
  const topicMatches = (topicId: string): number =>
    view.items.filter((item) => item.topic === topicId && matchesQuery(item, normalizedQuery)).length;

  const renameTopic = useCallback(() => {
    if (!selectedTopic || normalizedQuery) return;
    const current = topicDisplayName(selectedTopic, topicAliases);
    const next = window.prompt('自定义专题名字(留空恢复原名)', current);
    if (next === null) return;
    setTopicAliases(writeTopicAlias(selectedTopic.id, next, topicAliases));
  }, [normalizedQuery, selectedTopic, topicAliases]);

  /* ---------- 扁平分页 vs 专题分组 ---------- */
  const paginated = category === 'all' || hideTopicRail || shownItems.length > SPECIMEN_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(shownItems.length / SPECIMEN_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => (paginated
    ? shownItems.slice((safePage - 1) * SPECIMEN_PAGE_SIZE, safePage * SPECIMEN_PAGE_SIZE)
    : shownItems), [paginated, shownItems, safePage]);

  const gotoPage = useCallback((next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === safePage) return;
    onSelectPage(clamped);
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [onSelectPage, safePage, totalPages]);

  const panoramaTitle = category === 'mechanics' ? '大学物理全景沙盘'
    : category === 'business' ? '办公决策全景沙盘'
    : category === 'deep' ? '深度学习全景沙盘'
    : category === 'linalg' ? '线性代数全景沙盘'
    : category === 'calculus' ? '高数全景沙盘' : '全景沙盘';

  const range = useMemo(() => paginationRange(safePage, totalPages), [safePage, totalPages]);

  return <div className={styles.specimenSection} ref={sectionRef}>
    <div className={styles.templateFilters} role="group" aria-label="标本筛选">
      <div className={styles.filterTop}>
        <div className={styles.filterPills} role="group" aria-label="学科分类">
          {CATEGORY_PILLS.map(([key, label]) => (
            <button type="button" key={key} aria-pressed={category === key} onClick={() => onSelectCategory(key)}>
              {label} · {CATEGORY_COUNTS[key]}
            </button>
          ))}
        </div>
      </div>
      {!hideTopicRail && <div className={styles.topicFilters}>
        <span className={styles.filterLabel}>专题</span>
        <div className={styles.topicPills} role="group" aria-label="专题筛选">
          <button type="button" aria-pressed={normalizedQuery ? true : selectedTopicId === 'all'}
            onClick={() => onSelectTopic('all')}>
            全部专题 <small>{searchedItems.length}</small>
          </button>
          {view.topics.map((topic) => (
            <button type="button" key={topic.id}
              aria-pressed={!normalizedQuery && selectedTopicId === topic.id}
              onClick={() => onSelectTopic(topic.id)}>
              {topicDisplayName(topic, topicAliases)} <small>{topicMatches(topic.id)}</small>
            </button>
          ))}
        </div>
        <button type="button" className={styles.topicRename}
          disabled={!selectedTopic || Boolean(normalizedQuery)}
          title={selectedTopic ? '给当前专题起一个本地显示名' : '请先选择一个具体专题'}
          onClick={renameTopic}>✎ 自定义专题名</button>
      </div>}
    </div>

    {paginated ? <>
      {(category === 'deep' || category === 'linalg') && <header className={styles.topicHead}>
        <h3>{panoramaTitle}</h3>
      </header>}
      <div className={styles.tplGrid}>
        {pageItems.map((item) => <CatalogCard key={item.key} item={item} disabled={false}
          creating={false} actionLabel="打开实验 →" onCreate={() => onOpenTemplate(item.key)} />)}
      </div>
      {totalPages > 1 && <nav className={styles.paginationBar} aria-label="标本分页">
        <button type="button" className={styles.pageNavBtn} disabled={safePage <= 1}
          onClick={() => gotoPage(safePage - 1)}>← 上一页</button>
        <div className={styles.pageNumbers} role="group" aria-label="页码">
          {range.map((p, i) => p === '…'
            ? <span key={`gap-${i}`} className={styles.pageGap}>…</span>
            : <button type="button" key={p} aria-pressed={p === safePage}
                aria-label={`第 ${p} 页`} onClick={() => gotoPage(p)}>{p}</button>)}
        </div>
        <button type="button" className={styles.pageNavBtn} disabled={safePage >= totalPages}
          onClick={() => gotoPage(safePage + 1)}>下一页 →</button>
        <span className={styles.pageStatus}>第 {safePage} / {totalPages} 页 · 共 {shownItems.length} 件标本</span>
      </nav>}
    </> : <TopicCatalog
      topics={shownTopics}
      items={shownItems}
      highlightPanoramas={activeTopicId === 'all' && category !== 'linalg' && category !== 'deep'}
      panoramaTitle={panoramaTitle}
      disabled={false}
      creatingKey={null}
      actionLabel="打开实验 →"
      onCreate={(item) => onOpenTemplate(item.key)}
    />}
    {!shownItems.length ? <p className={styles.emptyLead} role="status">
      {normalizedQuery ? `标本柜中没有匹配“${query.trim()}”的模板;试试清空搜索或切换专题。` : '这个专题暂时没有可打开的模板。'}
    </p> : null}
  </div>;
}
