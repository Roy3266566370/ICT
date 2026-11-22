/**
 * WorkSharePage.tsx —— 工坊发布作品播放器（/work-shares/:shareId）
 *
 * 只读：画布照常跑动画（live 通道不经过 doc），但禁用一切指针交互。
 * 「在工坊里改造」= fork：快照 → 我自己的新作品，进编辑器继续玩。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { NODE_DEFS } from '@/canvas/nodes.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import styles from './WorkshopPage.module.css';

export function WorkSharePage(): JSX.Element {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [forking, setForking] = useState(false);

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
          <Link to="/workshop">回工坊画廊 →</Link>
        </div>
      </div>
    );
  }
  if (!doc) return <div className={styles.page}><p className={styles.muted}>载入中…</p></div>;
  const isPipeline = !!doc.panel && doc.nodes.some((node) => node.type === 'lab408Stage');

  return (
    <div className={styles.page}>
      <div className={styles.playerBar}>
        <Link to="/workshop" className={styles.backLink}>← 工坊</Link>
        <h1 className={styles.playerTitle}>{title}</h1>
        <span className={styles.playerTag}>发布快照 · 打开即玩</span>
        <div className={styles.playerSpacer} />
        <button
          type="button"
          className={styles.forkBtn}
          disabled={forking}
          onClick={() => void fork()}
        >
          {forking ? '改造中…' : '在工坊里改造 →'}
        </button>
      </div>
      <div className={styles.playerHint}>
        这是别人发布的活画布——对象还在动，但不能改。点右上角「在工坊里改造」复制一份到你自己的画布。
      </div>
      <div className={styles.frozenBoard} data-pipeline={isPipeline || undefined} aria-label="只读画布">
        <CanvasBoard doc={doc} setDoc={(update) => {
          if (isPipeline) setDoc((current) => current && (typeof update === 'function' ? update(current) : update));
        }} tool="select" inkColor="#2F3A49"
          workbench={isPipeline} readOnly={isPipeline} />
      </div>
    </div>
  );
}

export default WorkSharePage;
