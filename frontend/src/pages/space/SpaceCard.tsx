import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SUBJECT_LABELS } from '@/labs/types';
import { customBlockBadge } from '@/canvas/customBlocks';
import { pageUrl } from '@/components/presentation/pageUrls';
import type { WorkSummary } from '@/api/works';
import { materialCoverUrl, relativeAssetTime, SPACE_KIND_LABEL, spaceItemHref, type SpaceItem } from './spaceItems.ts';
import styles from '../SpacePage.module.css';

type WorkCover = WorkSummary & { subject?: string; preview_url?: string };

export function SpaceCover({ item, eager = false }: { item: SpaceItem; eager?: boolean }): JSX.Element {
  const work = item.kind === 'work' ? item.record as WorkCover : undefined;
  const image = item.kind === 'material' ? pageUrl(materialCoverUrl(item.id)) : work?.preview_url;
  const imageKey = `${image ?? ''}:${item.kind === 'material' ? item.record.status : ''}`;
  const [failedImage, setFailedImage] = useState<string>();
  const hasImage = Boolean(image && imageKey !== failedImage);
  const status = item.kind === 'material' && (item.record.status === 'processing' ? '转换中'
    : item.record.status === 'failed' ? '转换失败' : null);
  return <div className={styles.cardCover} data-kind={item.kind} data-subject={work?.subject}>
    {hasImage && <img key={imageKey} src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedImage(imageKey)}/>}
    {!hasImage && item.kind !== 'block' && <span className={styles.coverInitial} aria-hidden="true">{Array.from(item.title)[0]}</span>}
    {item.kind === 'block' && <div className={styles.blockCoverDetail}>
      <span className={styles.blockGlyph} aria-hidden="true"><i/><i/><i/></span>
      <strong>{item.record.kind === 'aiRule' ? 'AI 规则积木' : `${item.record.sub.nodes.filter((n) => n.type !== 'portIn' && n.type !== 'portOut').length} 个对象`}</strong>
      <span>{customBlockBadge(item.record)}</span>
    </div>}
    <span className={styles.coverKind}>{SPACE_KIND_LABEL[item.kind]}</span>
    {status && <span className={styles.coverStatus} data-failed={item.kind === 'material' && item.record.status === 'failed'}>{status}</span>}
  </div>;
}

function itemMetadata(item: SpaceItem, now: number): string {
  const time = relativeAssetTime(item.time, now);
  if (item.kind === 'material') return [`${item.record.page_count} 页`, time].filter(Boolean).join(' · ');
  if (item.kind === 'block') return time ? `创建于 ${time}` : '';
  const work = item.record as WorkCover;
  const subject = work.subject && (SUBJECT_LABELS[work.subject as keyof typeof SUBJECT_LABELS] ?? work.subject);
  return [subject || `${work.node_count} 个积木`, time].filter(Boolean).join(' · ');
}

export function SpaceCard({ item, now, onDelete }: {
  item: SpaceItem; now: number; onDelete: (item: SpaceItem) => void;
}): JSX.Element {
  const more = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (more.current && !more.current.contains(event.target as Node)) more.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !more.current?.open) return;
      more.current.open = false;
      more.current.querySelector('summary')?.focus();
      event.preventDefault();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const label = SPACE_KIND_LABEL[item.kind];
  const action = item.kind === 'material' ? '打开活页' : item.kind === 'work' ? '在画布中打开' : '在画布中使用';
  return <article className={styles.card} data-menu-open={open || undefined}>
    <Link className={styles.cardLink} to={spaceItemHref(item)} aria-label={`${action}：${item.title}`}>
      <SpaceCover item={item}/>
      <div className={styles.cardBody}>
        <h3>{item.title}</h3>
        <p>{itemMetadata(item, now)}</p>
      </div>
    </Link>
    <details ref={more} className={styles.cardMenu} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary aria-label={`${item.title}的更多操作`}>⋯</summary>
      <div className={styles.menuActions}>
        <Link to={spaceItemHref(item)} onClick={() => { if (more.current) more.current.open = false; }}>{action}</Link>
        <button type="button" className={styles.removeItem} onClick={() => {
          if (more.current) {
            more.current.open = false;
            more.current.querySelector('summary')?.focus();
          }
          onDelete(item);
        }}>删除{label}</button>
      </div>
    </details>
  </article>;
}
