import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SpaceCover } from './SpaceCard';
import { relativeAssetTime, SPACE_KIND_LABEL, spaceItemHref, type SpaceFilter, type SpaceItem } from './spaceItems.ts';
import styles from '../SpacePage.module.css';

const ACTIVITY_WEEKS = 26;
const DAY = 86_400_000;
const mapFilters = ['all', 'work', 'material', 'block'] as const;

function localDay(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;
}

export function SpaceActivity({ items, now }: { items: readonly SpaceItem[]; now: number }): JSX.Element {
  const today = localDay(now);
  const last = today + 7 - ((new Date(now).getDay() || 7));
  const first = last - ACTIVITY_WEEKS * 7 + 1;
  const counts = useMemo(() => {
    const byDay = new Map<number, number>();
    for (const item of items) {
      const day = localDay(item.time);
      if (day >= first && day <= today) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return byDay;
  }, [items, first, today]);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return <div className={styles.activity}>
    <p>创作印痕 · 近 26 周 <strong>{total}</strong> 项内容</p>
    <div className={styles.activityGrid} role="img" aria-label={`近 26 周内创建或更新的内容共 ${total} 项`}>
      {Array.from({length: ACTIVITY_WEEKS * 7}, (_, index) => {
        const day = first + index;
        const count = counts.get(day) ?? 0;
        return <span key={day} data-level={Math.min(count, 4)}
          data-future={day > today || undefined}
          title={day <= today ? `${new Date(day * DAY).toISOString().slice(0, 10)} · ${count} 项` : undefined}/>;
      })}
    </div>
  </div>;
}

export function SpaceConstellation({ items, now }: { items: readonly SpaceItem[]; now: number }): JSX.Element {
  const [filter, setFilter] = useState<SpaceFilter>('all');
  const [selectedKey, setSelectedKey] = useState('');
  const nodes = (filter === 'all' ? items : items.filter(item => item.kind === filter)).slice(0, 8);
  const keyOf = (item: SpaceItem) => `${item.kind}:${item.id}`;
  const selected = nodes.find(item => keyOf(item) === selectedKey) ?? nodes[0];

  return <section className={styles.constellation} aria-labelledby="space-map-title">
    <div className={styles.mapHead}>
      <div><p className={styles.kicker}>CONSTELLATION / 作品星图</p>
        <h2 id="space-map-title">把散落的作品，连成一张图</h2></div>
      <div className={styles.filters} role="group" aria-label="筛选星图">
        {mapFilters.map(kind => <button key={kind} type="button" aria-pressed={kind === filter}
          onClick={() => setFilter(kind)}>{kind === 'all' ? '全部' : SPACE_KIND_LABEL[kind]}</button>)}
      </div>
    </div>
    <div className={styles.mapLayout}>
      <div className={styles.mapPanel}>
        {nodes.length ? <>
          <svg className={styles.mapThreads} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {nodes.map((item, index) => {
              const angle = index / nodes.length * Math.PI * 2 - Math.PI / 2;
              return <line key={keyOf(item)} x1="50" y1="50"
                x2={50 + 34 * Math.cos(angle)} y2={50 + 35 * Math.sin(angle)} />;
            })}
          </svg>
          <span className={styles.mapCenter}>我的内容</span>
          {nodes.map((item, index) => {
            const angle = index / nodes.length * Math.PI * 2 - Math.PI / 2;
            return <button key={keyOf(item)} type="button" className={styles.mapNode}
              data-kind={item.kind} aria-pressed={item === selected} aria-label={item.title}
              style={{left: `${50 + 34 * Math.cos(angle)}%`, top: `${50 + 35 * Math.sin(angle)}%`}}
              onClick={() => setSelectedKey(keyOf(item))}>
              <i aria-hidden="true"/><span>{item.title}</span>
            </button>;
          })}
        </> : <p>还没有{filter === 'all' ? '内容' : SPACE_KIND_LABEL[filter]}可展示。</p>}
      </div>
      <aside className={styles.mapDetail} aria-live="polite">
        {selected ? <>
          <SpaceCover key={keyOf(selected)} item={selected}/>
          <p className={styles.kicker}>{SPACE_KIND_LABEL[selected.kind]}</p>
          <h3>{selected.title}</h3>
          <p>{relativeAssetTime(selected.time, now)}</p>
          <Link className={styles.primary} to={spaceItemHref(selected)}>打开 ↗</Link>
        </> : <p>在星图中选择一项内容，即可在这里查看。</p>}
      </aside>
    </div>
    {items.length > 8 && <p className={styles.mapNote}>每类最多展示最新 8 项，完整列表见「我的内容」。</p>}
  </section>;
}

export function SpaceYearMarks({ items }: { items: readonly SpaceItem[] }): JSX.Element | null {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (!Number.isFinite(item.time)) continue;
    const year = new Date(item.time).getFullYear();
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return <section className={styles.constellation} aria-labelledby="space-years-title">
    <div className={styles.mapHead}>
      <div><p className={styles.kicker}>YEAR MARKS / 年轮</p>
        <h2 id="space-years-title">一些被留下的刻度</h2></div>
    </div>
    <ol className={styles.yearMarks}>
      {[...counts.entries()].sort(([a], [b]) => b - a).map(([year, count]) =>
        <li key={year}><time dateTime={String(year)}>{year}</time><span>{count} 项内容</span></li>)}
    </ol>
  </section>;
}
