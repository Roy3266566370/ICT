/**
 * WorkshopPluginPicker.tsx —— 定象坊交互插件选择器弹窗
 *
 * 供通文册编辑器（FreeDeckEditor）选择策展的 50+ 个定象坊交互插件，
 * 一键插入到当前 PPT 幻灯片中。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { worksApi, type ShareSummary, type WorkSummary } from '@/api/works';
import type { CanvasDoc } from '@/canvas/types';
import { WORKSHOP_PLUGIN_CATALOG, type WorkshopPluginEntry } from '@/canvas/templateCatalog';
import styles from './WorkshopPluginPicker.module.css';

const CATEGORIES = ['全部', '高等数学', '线性代数', '大学物理', '408 专题', '深度学习', '办公决策', '我的作品', '公开画廊'] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

export type WorkshopPluginSelection = WorkshopPluginEntry | {
  kind: 'custom-work';
  name: string;
  category: '我的作品' | '公开画廊';
  work_id: string;
  doc: CanvasDoc;
};

interface Props {
  onSelect: (entry: WorkshopPluginSelection) => void;
  onClose: () => void;
}

export function WorkshopPluginPicker({ onSelect, onClose }: Props): JSX.Element {
  const [category, setCategory] = useState<CategoryFilter>('全部');
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [gallery, setGallery] = useState<ShareSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [openingWork, setOpeningWork] = useState<string>();
  const [detailFailed, setDetailFailed] = useState(false);
  const detailRequest = useRef(0);
  const select = useRef(onSelect);
  select.current = onSelect;
  const showWorks = category === '我的作品';
  const showGallery = category === '公开画廊';

  useEffect(() => {
    if (!showWorks) return;
    let current = true;
    void worksApi.list().then(({ works }) => {
      if (current) setWorks(works);
    }).catch(() => {
      if (current) setListFailed(true);
    });
    return () => {
      current = false;
      detailRequest.current++;
    };
  }, [showWorks, listAttempt]);

  useEffect(() => {
    if (!showGallery) return;
    let current = true;
    void worksApi.gallery().then(({ items }) => {
      if (current) setGallery(items);
    }).catch(() => {
      if (current) setListFailed(true);
    });
    return () => {
      current = false;
      detailRequest.current++;
    };
  }, [showGallery, listAttempt]);

  const changeCategory = (next: CategoryFilter) => {
    if (next === category) return;
    detailRequest.current++;
    setCategory(next);
    setWorks(null);
    setGallery(null);
    setListFailed(false);
    setDetailFailed(false);
    setOpeningWork(undefined);
  };
  const close = () => {
    detailRequest.current++;
    onClose();
  };
  const openWork = async (work: WorkSummary) => {
    const request = ++detailRequest.current;
    setOpeningWork(work.work_id);
    setDetailFailed(false);
    try {
      const { document } = await worksApi.get(work.work_id);
      if (request !== detailRequest.current) return;
      select.current({
        kind: 'custom-work', name: work.title || document.title || '未命名作品', category: '我的作品',
        work_id: work.work_id, doc: document,
      });
    } catch {
      if (request === detailRequest.current) setDetailFailed(true);
    } finally {
      if (request === detailRequest.current) setOpeningWork(undefined);
    }
  };

  const openShare = async (share: ShareSummary) => {
    const request = ++detailRequest.current;
    setOpeningWork(share.share_id);
    setDetailFailed(false);
    try {
      const data = await worksApi.getShare(share.share_id);
      if (request !== detailRequest.current) return;
      select.current({
        kind: 'custom-work', name: data.title || share.title || '公开作品', category: '公开画廊',
        work_id: data.work_id, doc: data.document,
      });
    } catch {
      if (request === detailRequest.current) setDetailFailed(true);
    } finally {
      if (request === detailRequest.current) setOpeningWork(undefined);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleWorks = works?.filter(work => work.title.toLowerCase().includes(normalizedQuery));
  const visibleGallery = gallery?.filter(share => share.title.toLowerCase().includes(normalizedQuery));
  const filtered = useMemo(() => {
    return WORKSHOP_PLUGIN_CATALOG.filter((item) => {
      if (category !== '全部' && item.category !== category) return false;
      if (!normalizedQuery) return true;
      return [item.name, item.desc, item.category, item.formula, item.kind, ...(item.keywords ?? [])]
        .join(' ').toLowerCase().includes(normalizedQuery);
    });
  }, [category, normalizedQuery]);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="插入定象坊交互插件" onClick={close}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <h2>插入定象坊交互插件</h2>
            <p>所有插件均为纯前端确定性交互仪器，插入 PPT 后可原位调参、播放时间轴，且离线导出 100% 保留交互。</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={close} aria-label="关闭插件库">×</button>
        </header>

        <div className={styles.controls}>
          <div className={styles.tabs} role="tablist" aria-label="按学科筛选插件">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                className={category === cat ? styles.tabActive : styles.tab}
                onClick={() => changeCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <input
            type="search"
            className={styles.search}
            aria-label={showWorks ? '搜索我的作品' : showGallery ? '搜索公开画廊' : '搜索定象坊插件'}
            placeholder={showWorks ? '按作品名称搜索' : showGallery ? '按公开作品名称搜索' : '搜索插件（如 Taylor、Cache、盈亏、漏斗、甘特图、AB实验）'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.grid}>
          {showGallery ? <>
            {listFailed ? <div className={styles.empty} role="status">暂时无法读取公开画廊。 <button type="button" onClick={() => {
              setListFailed(false);
              setListAttempt(attempt => attempt + 1);
            }}>重试</button></div> : gallery === null ? <p className={styles.empty} role="status">正在读取公开画廊…</p>
              : !gallery.length ? <p className={styles.empty}>画廊还空着，等第一个公开作品。</p>
              : !visibleGallery?.length ? <p className={styles.empty}>没有匹配的公开作品，换个关键词试试。</p>
              : visibleGallery.map(share => <button key={share.share_id} type="button" className={styles.card}
                disabled={openingWork !== undefined} aria-busy={openingWork === share.share_id}
                onClick={() => void openShare(share)}>
                <span className={styles.badge}>公开画廊</span>
                <strong>{share.title || '未命名作品'}</strong>
                <p>{openingWork === share.share_id ? '正在载入快照…' : `${share.node_count} 个积木 · 发布快照${share.forks ? ` · 已被改造 ${share.forks} 次` : ''}`}</p>
              </button>)}
            {detailFailed && <p className={styles.empty} role="alert">暂时无法打开这件公开作品，请重试。</p>}
          </> : showWorks ? <>
            {listFailed ? <div className={styles.empty} role="status">暂时无法读取作品。 <button type="button" onClick={() => {
              setListFailed(false);
              setListAttempt(attempt => attempt + 1);
            }}>重试</button></div> : works === null ? <p className={styles.empty} role="status">正在读取定象坊作品…</p>
              : !works.length ? <p className={styles.empty}>还没有已保存的作品。在定象坊保存画布后，即可插入课件。</p>
              : !visibleWorks?.length ? <p className={styles.empty}>没有匹配的作品，换个关键词试试。</p>
              : visibleWorks.map(work => <button key={work.work_id} type="button" className={styles.card}
                disabled={openingWork !== undefined} aria-busy={openingWork === work.work_id}
                onClick={() => void openWork(work)}>
                <span className={styles.badge}>我的作品</span>
                <strong>{work.title || '未命名作品'}</strong>
                <p>{openingWork === work.work_id ? '正在载入画布…' : `${work.node_count} 个积木 · 插入时复制当前版本`}</p>
              </button>)}
            {detailFailed && <p className={styles.empty} role="alert">暂时无法打开这件作品，请重试。</p>}
          </> : filtered.length === 0 ? (
            <p className={styles.empty}>没有匹配的定象坊插件，换个关键词试试。</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.kind}
                type="button"
                className={styles.card}
                onClick={() => onSelect(item)}
              >
                <div className={styles.cardHead}>
                  <span className={styles.badge}>{item.category}</span>
                  <span className={styles.offlineTag}>原生离线</span>
                </div>
                <strong>{item.name}</strong>
                <p>{item.desc}</p>
                {item.formula && <code className={styles.formula}>{item.formula}</code>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
