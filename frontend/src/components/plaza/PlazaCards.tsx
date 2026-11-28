import { useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { plazaApi } from '@/api/plaza';
import { previewPath, SUBJECTS, SUBJECT_COLORS, type PlazaItem } from '@/api/plazaTypes';
import { ForkButton, PlazaAuthor } from './SharePlazaBar';
import { PlazaCoverArt } from './PlazaCoverArt';
import styles from './Plaza.module.css';

function ManageListing({ item }: {item: PlazaItem}) {
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function updateListing(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
      setEdit(false);
      void cache.invalidateQueries({ queryKey: ['plaza'] });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.manageBar}>
      <button type="button" disabled={busy} aria-pressed={item.pinned}
        onClick={() => void updateListing(() => plazaApi.edit(item.id, { pinned: !item.pinned }))}>
        {item.pinned ? '取消置顶' : '置顶为代表作'}
      </button>
      <button type="button" disabled={busy} aria-expanded={edit} onClick={() => setEdit(!edit)}>编辑上架信息</button>
      <button type="button" disabled={busy} onClick={() => {
        if (window.confirm('从广场下架这件作品？原分享链接仍可访问。')) void updateListing(() => plazaApi.unlist(item.id));
      }}>下架</button>
    </div>
    {edit && <form className={styles.edit} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void updateListing(() => plazaApi.edit(item.id, {
        title: String(data.get('title')), summary: String(data.get('summary')),
        subject: data.get('subject') as PlazaItem['subject'], allow_fork: data.has('allow_fork'),
      }));
    }}>
      <label>广场标题 <input name="title" defaultValue={item.title} required maxLength={120} /></label>
      <label>简介 <input name="summary" defaultValue={item.summary} maxLength={120} /></label>
      <label>学科 <select name="subject" defaultValue={item.subject}>
        {Object.entries(SUBJECTS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
      </select></label>
      <label><input name="allow_fork" type="checkbox" defaultChecked={item.allow_fork} /> 允许复刻</label>
      <button type="submit" disabled={busy}>保存</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </>;
}

/** 封面右上角精简半透明胶囊：交互画布节点/连线数，或互动文稿页数。 */
function countLabel(item: PlazaItem): string | null {
  if (item.kind === 'deck') return item.cover.page_count ? `${item.cover.page_count} 页` : null;
  const nodes = item.cover.node_count ?? item.cover.topology?.nodes.length;
  if (!nodes) return null;
  const wires = item.cover.wire_count ?? item.cover.topology?.wires.length ?? 0;
  return `${nodes} 节点 · ${wires} 连线`;
}

export function PlazaCards({ items, offerFork = false, manage = false }: {
  items: PlazaItem[]; offerFork?: boolean; manage?: boolean;
}) {
  if (!items.length) return <div className={styles.emptyState}>
    <strong>这里还没有作品</strong>
    等一件合适的教具出现，或者把你的画布发布到广场。
  </div>;
  return <div className={styles.grid}>{items.map(item => {
    const url = previewPath(item);
    const count = countLabel(item);
    const subjectColor = SUBJECT_COLORS[item.subject] ?? SUBJECT_COLORS.general;
    return <article className={styles.card} key={item.id}>
      <Link className={styles.coverLink} to={url} aria-label={'试玩 ' + item.title}>
        <PlazaCoverArt item={item} />
        {count && <span className={styles.countChip}>{count}</span>}
        <span className={styles.subjectChip} style={{ '--subject-color': subjectColor } as CSSProperties}>
          {SUBJECTS[item.subject]}
        </span>
        <span className={styles.playOverlay} aria-hidden="true">
          <span className={styles.playCapsule}>▶ 试玩交互</span>
        </span>
      </Link>
      <div className={styles.body}>
        <h3><Link to={url}>{item.title}</Link></h3>
        <p className={styles.summary}>{item.summary || '打开画布，拖动参数，观察实时联动变化。'}</p>
        <div className={styles.cardFoot}>
          <PlazaAuthor author={item.author} />
          <span className={styles.reactions} aria-label={item.forks + ' 次复刻，' + item.likes + ' 个赞'}>
            {item.is_featured && <span className={styles.officialMark}>官方精选 · </span>}↻ {item.forks} · ♥ {item.likes}
          </span>
        </div>
        {offerFork && item.allow_fork && <div className={styles.actions}><ForkButton item={item} label="⚡ 复刻到定象坊" /></div>}
        {manage && item.can_manage && <ManageListing item={item} />}
      </div>
    </article>;
  })}</div>;
}
