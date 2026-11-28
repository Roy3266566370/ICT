/**
 * PlazaSpotlight.tsx —— 广场首屏「精选活展台」
 *
 * 左栏：嵌入式只读交互画布（复用 CanvasBoard 自由画布模式），
 *   打开广场即可直接拖动 exposed 参数滑块，实时观察节点联动；
 * 右栏：学科徽章 / 标题 / 教学简介 / 节点连线数 / 作者名片，
 *   「进入全屏试玩」「⚡ 复刻到定象坊」双按钮 + 3 项精选切换。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { NODE_DEFS } from '@/canvas/nodes.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import { previewPath, SUBJECTS, SUBJECT_COLORS, type PlazaItem } from '@/api/plazaTypes';
import { ForkButton, PlazaAuthor } from './SharePlazaBar';
import styles from './Plaza.module.css';

/** 三件最具交互视觉冲击力的官方代表作（按 preview_template 匹配）。 */
const SPOTLIGHT_TEMPLATES = ['projectile-drag', 'fourier-gibbs', 'dlOptimizer'];

/** 与试玩页一致的快照净化：过滤未知节点类型与悬空连线。 */
function sanitizeDoc(source: CanvasDoc): CanvasDoc {
  const doc: CanvasDoc = { ...source, nodes: [...source.nodes], wires: [...source.wires] };
  doc.nodes = doc.nodes.filter((n) => NODE_DEFS[n.type] !== undefined).map((n) => {
    if (!n.sub) return n;
    const inner = n.sub.nodes.filter((x) => NODE_DEFS[x.type] !== undefined);
    const innerIds = new Set(inner.map((x) => x.id));
    return {
      ...n,
      sub: {
        nodes: inner,
        wires: n.sub.wires.filter((w) => innerIds.has(w.from) && innerIds.has(w.to)),
        ports: n.sub.ports.filter((p) => innerIds.has(p.id)),
      },
    };
  });
  const ids = new Set(doc.nodes.map((n) => n.id));
  doc.wires = doc.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
  return doc;
}

export function PlazaSpotlight({ items }: { items: PlazaItem[] }) {
  const featured = useMemo(() => SPOTLIGHT_TEMPLATES
    .map((template) => items.find((item) => item.cover.preview_template === template))
    .filter((item): item is PlazaItem => Boolean(item)), [items]);
  const [selectedId, setSelectedId] = useState<string>('');
  const active = featured.find((item) => item.share_id === selectedId) ?? featured[0];
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const updatePreview = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setDoc((current) => current && (typeof update === 'function' ? update(current) : update));
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setDoc(null);
    worksApi.getShare(active.share_id)
      .then((res) => { if (!cancelled) setDoc(sanitizeDoc(res.document)); })
      .catch(() => { if (!cancelled) setDoc(null); });
    return () => { cancelled = true; };
  }, [active?.share_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  const url = previewPath(active);
  const subjectColor = SUBJECT_COLORS[active.subject] ?? SUBJECT_COLORS.general;
  const wires = active.cover.wire_count ?? active.cover.topology?.wires.length ?? 0;

  return <section className={styles.spotlight} aria-label="精选活展台">
    <div className={styles.spotStage}>
      {doc ? <CanvasBoard key={active.share_id} doc={doc} setDoc={updatePreview} tool="select" inkColor="#2F3A49"
        mode={doc.panel && !doc.nodes.some((node) => node.type === 'deepStage') ? 'instrument' : undefined} readOnly interactivePanel
        interactiveSliders={!doc.panel || doc.nodes.some((node) => node.type === 'deepStage')}
        slideInstrument embedded={!doc.panel} focusContent />
        : <div className={styles.spotLoading}>正在装配精选画布…</div>}
      <Link className={styles.fullscreenBadge} to={url}>全屏试玩 ↗</Link>
    </div>
    <div className={styles.spotInfo}>
      <div className={styles.spotKicker}>
        <span className={styles.subjectChip} style={{ '--subject-color': subjectColor, position: 'static' } as CSSProperties}>
          {SUBJECTS[active.subject]}
        </span>
        <span className={styles.officialMark}>✦ 官方精选</span>
      </div>
      <h2 className={styles.spotTitle}>{active.title}</h2>
      <p className={styles.spotSummary}>{active.summary}</p>
      <div className={styles.spotStats}>
        <span><strong>{active.cover.node_count ?? active.cover.topology?.nodes.length ?? 0}</strong>节点</span>
        <span><strong>{wires}</strong>连线</span>
        <span><strong>{active.forks}</strong>复刻</span>
        <span><strong>{active.likes}</strong>点赞</span>
      </div>
      <PlazaAuthor author={active.author} />
      <div className={styles.spotActions}>
        <Link to={url} className={styles.primary}>进入全屏试玩</Link>
        {active.allow_fork && <ForkButton key={active.share_id} item={active} label="⚡ 复刻到定象坊" />}
      </div>
      {featured.length > 1 && <div className={styles.spotSwitch} role="group" aria-label="切换精选作品">
        <span className={styles.spotSwitchLabel}>SPOTLIGHT · 精选 {featured.length} 件</span>
        {featured.map((item, index) => <button type="button" key={item.share_id} className={styles.spotOption}
          aria-pressed={item.share_id === active.share_id} onClick={() => setSelectedId(item.share_id)}>
          <span className={styles.spotOptionIndex}>{String(index + 1).padStart(2, '0')}</span>
          <span>
            <strong>{item.title}</strong>
            <small>{SUBJECTS[item.subject]} · 拖动参数即时联动</small>
          </span>
        </button>)}
      </div>}
    </div>
  </section>;
}
