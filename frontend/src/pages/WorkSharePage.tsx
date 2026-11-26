/**
 * WorkSharePage.tsx —— 定象坊发布作品播放器（/work-shares/:shareId）
 *
 * 发布快照的结构只读，互动参数仅保存在当前页面。
 * 「在定象坊改造」= fork：快照 → 我自己的新作品，进编辑器继续玩。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { NODE_DEFS } from '@/canvas/nodes.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import styles from './WorkshopPage.module.css';

export function WorkSharePage(): JSX.Element {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const updatePreview = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setDoc((current) => current && (typeof update === 'function' ? update(current) : update));
  }, []);

  useEffect(() => {
    if (!shareId) return;
    worksApi.getShare(shareId)
      .then((res) => {
        const d = res.document;
        d.nodes = d.nodes.filter((n) => NODE_DEFS[n.type] !== undefined).map((n) => {
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
        const ids = new Set(d.nodes.map((n) => n.id));
        d.wires = d.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
        setDoc(d);
        setTitle(res.title || d.title || '未命名作品');
      })
      .catch(() => setErr('这个作品链接不存在或已被撤销。'));
  }, [shareId]);

  const fork = useCallback(async () => {
    setForking(true);
    try {
      const res = await worksApi.fork(shareId);
      navigate(`/canvas?work=${encodeURIComponent(res.work_id)}`);
    } catch {
      window.alert('改造失败：请确认后端已启动。');
      setForking(false);
    }
  }, [navigate, shareId]);

  if (err) {
    return (
      <div className={styles.page}>
        <div className={styles.errCard}>
          <h2>作品打不开</h2>
          <p>{err}</p>
          <Link to="/workshop">回定象坊画廊 →</Link>
        </div>
      </div>
    );
  }
  if (!doc) return <div className={styles.page}><p className={styles.muted}>载入中…</p></div>;
  if (searchParams.get('embed') === '1' && doc.panel) {
    return <div className={styles.embeddedPlayer} aria-label={title}>
      <CanvasBoard doc={doc} mode="instrument" tool="select" inkColor="#2F3A49" readOnly interactivePanel
        setDoc={updatePreview} />
    </div>;
  }
  const isPipeline = !!doc.panel && doc.nodes.some((node) =>
    node.type === 'lab408Stage' || node.type === 'aiRuleBlock' || node.type === 'universalStageView');

  return (
    <div className={styles.page}>
      <div className={styles.playerBar}>
        <Link to="/workshop" className={styles.backLink}>← 定象坊</Link>
        <h1 className={styles.playerTitle}>{title}</h1>
        <span className={styles.playerTag}>发布快照 · 打开即玩</span>
        <div className={styles.playerSpacer} />
        <button
          type="button"
          className={styles.forkBtn}
          disabled={forking}
          onClick={() => void fork()}
        >
          {forking ? '改造中…' : '在定象坊改造 →'}
        </button>
      </div>
      <div className={styles.playerHint}>
        可以在当前页面体验互动。要编辑画布，请点右上角「在定象坊改造」，把发布快照复制到你的作品。
      </div>
      <div className={styles.frozenBoard} data-pipeline={isPipeline || undefined} aria-label="只读画布">
        <CanvasBoard doc={doc} setDoc={updatePreview} tool="select" inkColor="#2F3A49"
          mode={isPipeline ? 'instrument' : undefined} readOnly interactivePanel={isPipeline} interactiveSliders={!isPipeline} />
      </div>
    </div>
  );
}

export default WorkSharePage;
