/**
 * WorkSharePage.tsx —— 定象坊发布作品播放器（/work-shares/:shareId）
 *
 * 单行 56px 工作室顶栏 + 全视口画布：
 *  - 左侧：返回链接 / 标题 / 学科胶囊 / 作者名片 / 复刻来源；
 *  - 右侧：♥ 点赞 · ★ 收藏 · ⚡ 复刻到定象坊（PlazaCompactActions）；
 *  - 引导提示收敛为画布左下角可关闭的悬浮胶囊，不再占整行灰条。
 *
 * 发布快照的结构只读，互动参数仅保存在当前页面。
 * 「复刻到定象坊」= fork：快照 → 我自己的新作品，进编辑器继续玩。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { NODE_DEFS } from '@/canvas/nodes.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { ForkButton, PlazaCompactActions, usePlazaListing } from '@/components/plaza/SharePlazaBar';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { previewPath, SUBJECTS, SUBJECT_COLORS } from '@/api/plazaTypes';
import { worksApi } from '@/api/works';
import workshopStyles from './WorkshopPage.module.css';
import styles from '@/components/plaza/Plaza.module.css';

export function WorkSharePage(): JSX.Element {
  const { shareId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const embed = searchParams.get('embed') === '1';
  const listing = usePlazaListing(embed ? '' : shareId);
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [allowFork, setAllowFork] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(false);
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
        setAllowFork(res.allow_fork !== false);
        setTitle(res.title || d.title || '未命名作品');
      })
      .catch(() => setErr('这个作品链接不存在或已被撤销。'));
  }, [shareId]);

  if (err) {
    return (
      <div className={styles.playerShell}>
        <div className={styles.playerError}>
          <h2>作品打不开</h2>
          <p>{err}</p>
          <Link to="/plaza">回定象坊广场 →</Link>
        </div>
      </div>
    );
  }
  if (!doc) return <div className={styles.playerShell}><p className={styles.spotLoading}>载入中…</p></div>;
  if (embed && doc.panel) {
    return <div className={workshopStyles.embeddedPlayer} aria-label={title}>
      <CanvasBoard doc={doc} mode="instrument" tool="select" inkColor="#2F3A49" readOnly interactivePanel
        setDoc={updatePreview} />
    </div>;
  }
  // 带策展面板（视图钉选 / 参数暴露）的作品进入仪器演奏模式，与嵌入播放器口径一致；
  // 无策展信息的自由画布作品保持原样平铺。
  const curated = Boolean(doc.panel && (doc.panel.view_node_ids.length > 0 || doc.panel.exposed_params.length > 0));
  const item = listing.data;
  const subjectColor = item ? SUBJECT_COLORS[item.subject] ?? SUBJECT_COLORS.general : SUBJECT_COLORS.general;

  return (
    <div className={styles.playerShell}>
      <header className={styles.playerTopbar}>
        {item
          ? <Link to="/plaza" className={styles.topbarBack}>← 广场</Link>
          : <Link to="/workshop" className={styles.topbarBack}>← 定象坊</Link>}
        <h1 className={styles.topbarTitle}>{title}</h1>
        {item && <span className={styles.topbarChip} style={{ '--subject-color': subjectColor } as React.CSSProperties}>
          {SUBJECTS[item.subject]}
        </span>}
        {item && (item.author.id
          ? <Link className={styles.topbarAuthor} to={'/u/' + encodeURIComponent(item.author.id)}>
            <AccountAvatar label={item.author.display_name} avatarUrl={item.author.avatar_url} size="sm" />
            <span>{item.author.display_name}</span>
          </Link>
          : <span className={styles.topbarAuthor}>
            <AccountAvatar label={item.author.display_name} avatarUrl={item.author.avatar_url} size="sm" />
            <span>{item.author.display_name}</span>
          </span>)}
        {item?.origin && <Link className={styles.topbarOrigin} to={previewPath(item.origin)}>
          改自 @{item.origin.author.display_name}
        </Link>}
        <div className={styles.topbarSpacer} />
        <div className={styles.topbarActions}>
          {item
            ? <PlazaCompactActions item={item} />
            : <ForkButton item={{ kind: 'workshop', share_id: shareId, allow_fork: allowFork }}
              label="⚡ 复刻到定象坊" className={styles.forkCta} />}
        </div>
      </header>
      <div className={styles.playerStage} data-pipeline={curated || undefined} aria-label="只读交互画布">
        <CanvasBoard doc={doc} setDoc={updatePreview} tool="select" inkColor="#2F3A49"
          mode={curated ? 'instrument' : undefined} readOnly interactivePanel={curated} interactiveSliders={!curated}
          focusContent={!curated}
          renderTools={curated ? undefined : ({ tidyLayout, fitAll }) => (
            <div className={workshopStyles.previewTools} role="toolbar" aria-label="画布工具坞">
              <button type="button" onClick={tidyLayout} disabled={!doc.nodes.length}>自动整理排版</button>
              <button type="button" onClick={fitAll} disabled={!doc.nodes.length && !doc.strokes.length}>适应全图</button>
            </div>
          )} />
        {!hintDismissed && <div className={styles.hintCapsule} role="note">
          拖动控件参数，实时观察画布联动变化
          <button type="button" aria-label="收起提示" onClick={() => setHintDismissed(true)}>×</button>
        </div>}
      </div>
    </div>
  );
}

export default WorkSharePage;
