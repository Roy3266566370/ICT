/** 活页编辑器：块序列 + 激活建议 + 插入菜单 + 发布。 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  acceptSuggestion,
  createLabBlock,
  deleteLivingPage,
  dismissSuggestion,
  getLivingInsights,
  getLivingPage,
  livingAssetUrl,
  patchLivingPage,
  publishLivingPage,
  generateLivingModel,
  recommendLivingModels,
} from '@/api/living';
import { errorMessage, isApiError } from '@/api/client';
import { worksApi, type WorkSummary } from '@/api/works';
import { SiteNav } from '@/components/home/SiteNav';
import { BlockView, SuggestionCard } from '@/components/living/PageBlocks';
import { PageOutline } from '@/components/living/PageOutline';
import { LivingAIPanel } from '@/components/living/LivingAIPanel';
import type {
  ActivationSuggestion,
  LivingInsights,
  LivingPageDoc,
  PageBlock,
} from '@/living/types';
import styles from './LivingPage.module.css';

function newId(): string {
  return `blk_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

type InsertKind = 'text' | 'formula' | 'quiz' | 'checkpoint' | 'embed' | 'lab' | 'canvas_work';

const INSERT_ITEMS: { kind: InsertKind; label: string; hint: string }[] = [
  { kind: 'text', label: '文字', hint: '一段说明文字' },
  { kind: 'formula', label: '公式', hint: 'LaTeX 公式' },
  { kind: 'lab', label: '实验块', hint: '粘贴一道题，自动求解' },
  { kind: 'canvas_work', label: '工坊积木', hint: '嵌入连线实验台' },
  { kind: 'quiz', label: '先猜再看', hint: '预测闸门' },
  { kind: 'checkpoint', label: '判分点', hint: '作答并比对参考答案' },
  { kind: 'embed', label: '嵌入', hint: '外部网页/GeoGebra' },
];

function makeBlock(kind: InsertKind): PageBlock | null {
  const id = newId();
  switch (kind) {
    case 'text':
      return { id, type: 'text', data: { md: '在这里写说明…' } };
    case 'formula':
      return { id, type: 'formula', data: { latex: 'E = mc^2' } };
    case 'quiz':
      return {
        id, type: 'quiz',
        data: { question: '先猜：结果是多少？', answer: '', explain: '', min: 0, max: 10, value: 1 },
      };
    case 'checkpoint':
      return { id, type: 'checkpoint', data: { prompt: '写下你的答案', expected: '', placeholder: '' } };
    case 'embed':
      return { id, type: 'embed', data: { url: '', height: 360 } };
    default:
      return null; // lab 走服务端接口
  }
}

export default function LivingPageEditor(): ReactNode {
  const { pageId = '' } = useParams();
  const [doc, setDoc] = useState<LivingPageDoc | null>(null);
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<{ id: string; field: string; value: string } | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [labText, setLabText] = useState('');
  const [canvasPicks, setCanvasPicks] = useState<WorkSummary[] | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [insights, setInsights] = useState<LivingInsights | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [aiPanel, setAiPanel] = useState<{ blockId?: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRunning = useRef(false);

  useEffect(() => {
    if (insertAt === null) setCanvasPicks(null);
  }, [insertAt]);

  useEffect(() => {
    let cancelled = false;
    getLivingPage(pageId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setBlocks(d.blocks);
        setTitle(d.title);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const pendingByBlock = useMemo(() => {
    const map = new Map<string, ActivationSuggestion[]>();
    for (const s of doc?.suggestions ?? []) {
      if (s.status !== 'pending') continue;
      const list = map.get(s.block_id) ?? [];
      list.push(s);
      map.set(s.block_id, list);
    }
    return map;
  }, [doc]);

  const save = useCallback(
    async (next: PageBlock[], revision: number): Promise<LivingPageDoc | null> => {
      if (!doc) return null;
      try {
        const updated = await patchLivingPage({
          pageId: doc.page_id,
          expectedRevision: revision,
          blocks: next,
        });
        setDoc(updated);
        setDirty(false);
        setSavedAt(new Date().toLocaleTimeString());
        return updated;
      } catch (e) {
        setError(isApiError(e, 'VERSION_CONFLICT') ? '文档已被别处修改，请刷新' : errorMessage(e));
        return null;
      }
    },
    [doc],
  );

  /** 本地改块 → 防抖 PATCH。 */
  const mutate = useCallback(
    (next: PageBlock[]) => {
      setBlocks(next);
      setDirty(true);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (doc) void save(next, doc.revision);
      }, 600);
    },
    [doc, save],
  );

  const move = (index: number, delta: number): void => {
    const next = [...blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const moved = next[index];
    const other = next[target];
    if (!moved || !other) return;
    next[index] = other;
    next[target] = moved;
    mutate(next);
  };

  const remove = (index: number): void => {
    mutate(blocks.filter((_, i) => i !== index));
  };

  const commitEdit = (): void => {
    if (!editing) return;
    const next = blocks.map((b) => {
      if (b.id !== editing.id) return b;
      const data = { ...b.data } as Record<string, unknown>;
      data[editing.field] = editing.value;
      return { ...b, data } as PageBlock;
    });
    setEditing(null);
    mutate(next);
  };

  const insert = async (kind: InsertKind): Promise<void> => {
    if (aiRunning.current) return;
    if (insertAt === null) return;
    if (kind === 'canvas_work') {
      setBusy('canvas-list');
      setCanvasPicks(null);
      try {
        setCanvasPicks((await worksApi.list()).works);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    const at = insertAt;
    setInsertAt(null);
    if (kind === 'lab') {
      const text = labText.trim();
      setLabText('');
      if (!text || !doc) return;
      setBusy('insert');
      try {
        const block = await createLabBlock({ pageId: doc.page_id, text });
        const next = [...blocks];
        next.splice(at, 0, block);
        // 实验块已由服务端生成，直接并入保存
        const updated = await save(next, doc.revision);
        if (!updated) setBlocks(next);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    const block = makeBlock(kind);
    if (!block) return;
    const next = [...blocks];
    next.splice(at, 0, block);
    mutate(next);
    if (kind === 'text' || kind === 'formula') {
      setEditing({ id: block.id, field: kind === 'text' ? 'md' : 'latex', value: '' });
    }
  };

  const insertCanvasWork = async (workId: string): Promise<void> => {
    if (insertAt === null || !doc) return;
    const at = insertAt;
    setBusy('canvas-insert');
    try {
      const work = await worksApi.get(workId);
      const block: PageBlock = {
        id: newId(),
        type: 'canvas',
        data: { doc: work.document as unknown as Record<string, unknown> },
      };
      const next = [...blocks];
      next.splice(at, 0, block);
      setInsertAt(null);
      setCanvasPicks(null);
      mutate(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAccept = async (suggestion: ActivationSuggestion): Promise<void> => {
    if (!doc) return;
    setBusy(suggestion.id);
    setError(null);
    try {
      const { document } = await acceptSuggestion({ pageId: doc.page_id, suggestionId: suggestion.id });
      setDoc(document);
      setBlocks(document.blocks);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async (suggestion: ActivationSuggestion): Promise<void> => {
    if (!doc) return;
    setBusy(suggestion.id);
    try {
      const updated = await dismissSuggestion({ pageId: doc.page_id, suggestionId: suggestion.id });
      setDoc(updated);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!doc) return;
    setBusy('publish');
    try {
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) return;
      }
      const result = await publishLivingPage(doc.page_id);
      setShareUrl(`${window.location.origin}${result.share_url}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const generateModels = async (ids: string[], instruction: string, force: boolean, progress: (message: string) => void,
    designGoals?: Record<string, string>) => {
    if (!doc) return;
    if (aiRunning.current || busy !== null) throw new Error('请等待当前操作完成后再生成交互');
    if (editing || editingTitle) throw new Error('请先完成或取消内容编辑，再生成交互');
    aiRunning.current = true;
    setInsertAt(null);
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      let current = doc;
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) throw new Error('请先保存当前修改，再生成交互');
        current = saved;
      }
      for (let index = 0; index < ids.length; index++) {
        progress(`正在设计第 ${index + 1}/${ids.length} 个模型，AI 会生成并验证参数与图形，请稍候…`);
        const result = await generateLivingModel({ pageId: current.page_id, blockId: ids[index]!,
          expectedRevision: current.revision, instruction: instruction.trim() || designGoals?.[ids[index]!] || '', force });
        current = result.document;
        setDoc(current); setBlocks(current.blocks); setDirty(false);
        setSavedAt(new Date().toLocaleTimeString());
        progress(`已保存 ${index + 1}/${ids.length} 个模型${result.cached ? '（复用已有结果）' : ''}`);
      }
    } finally {
      aiRunning.current = false;
    }
  };

  const recommendModels = async (force: boolean) => {
    if (!doc) throw new Error('活页尚未加载');
    if (aiRunning.current || busy !== null) throw new Error('请等待当前操作完成后再分析');
    if (editing || editingTitle) throw new Error('请先完成或取消内容编辑，再分析');
    aiRunning.current = true;
    setInsertAt(null);
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      let current = doc;
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) throw new Error('请先保存当前修改，再分析');
        current = saved;
      }
      return await recommendLivingModels({ pageId: current.page_id, expectedRevision: current.revision, force });
    } finally {
      aiRunning.current = false;
    }
  };

  const loadInsights = async (): Promise<void> => {
    if (!doc) return;
    try {
      setInsights(await getLivingInsights(doc.page_id));
      setShowInsights(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!doc || !window.confirm('删除这份活页？相关分享链接也会失效。')) return;
    await deleteLivingPage(doc.page_id).catch(() => undefined);
    window.location.href = '/living';
  };

  if (error && !doc) {
    return (
      <div className={styles.center} role="alert">
        <h1>活页打不开</h1>
        <p>{error}</p>
        <Link to="/living">返回活页列表</Link>
      </div>
    );
  }
  if (!doc) return <div className={styles.center}>载入活页…</div>;

  const conversion = doc.provenance.conversion;

  return (
    <div className="studio-scope">
      <SiteNav current="living" appearance="studio" />
      <div className={styles.editorPage}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Link to="/living" className={styles.backLink}>← 活页</Link>
          {editingTitle ? (
            <input
              className={styles.titleInput}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (title.trim() && title !== doc.title) {
                  void patchLivingPage({ pageId: doc.page_id, expectedRevision: doc.revision, title: title.trim() })
                    .then(setDoc)
                    .catch((e) => setError(errorMessage(e)));
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h1 className={styles.title} onDoubleClick={() => !aiBusy && setEditingTitle(true)} title="双击改名">
              {doc.title}
            </h1>
          )}
        </div>
        <div className={styles.toolbarRight}>
          <button type="button" className={styles.primaryBtn} disabled={aiBusy || busy !== null} onClick={() => setAiPanel({})}>AI 设计交互</button>
          {dirty ? <span className={styles.dirty}>未保存…</span> : savedAt ? <span className={styles.saved}>已保存 {savedAt}</span> : null}
          <button type="button" className={styles.ghostBtn} onClick={() => void loadInsights()}>
            学情
          </button>
          <button type="button" className={styles.ghostBtn} disabled={aiBusy} onClick={() => void handleDelete()}>
            删除
          </button>
          <button type="button" className={styles.primaryBtn} disabled={aiBusy || busy === 'publish'} onClick={() => void handlePublish()}>
            {shareUrl ? '重新发布' : '发布'}
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.errorBar} role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>×</button>
        </p>
      ) : null}
      {shareUrl ? (
        <p className={styles.shareBar}>
          学生链接：<a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
        </p>
      ) : null}
      {conversion.notes.length > 0 ? (
        <p className={styles.noteBar}>转换提示：{conversion.notes.join('；')}</p>
      ) : null}

      {showInsights && insights ? (
        <aside className={styles.insightsPanel}>
          <header>
            <strong>学情概览</strong>
            <button type="button" onClick={() => setShowInsights(false)}>×</button>
          </header>
          <p>
            {insights.shares} 条分享 · {insights.viewers} 名学生看过
          </p>
          <ul>
            {Object.entries(insights.blocks).map(([id, stat]) => {
              const block = blocks.find((b) => b.id === id);
              return (
                <li key={id}>
                  <span>{block ? blockLabel(block) : id}</span>
                  <span>
                    访问 {stat.visits}
                    {stat.quiz_guesses.length ? ` · 竞猜 ${stat.quiz_guesses.length} 次` : ''}
                    {stat.checkpoint_attempts ? ` · 作答 ${stat.checkpoint_correct}/${stat.checkpoint_attempts}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      <main className={styles.blockList}>
        {aiPanel ? <LivingAIPanel key={aiPanel.blockId ?? 'all'} document={{ ...doc, blocks }} initialBlockId={aiPanel.blockId}
          onGenerate={generateModels} onRecommend={recommendModels} onClose={() => setAiPanel(null)} onBusy={setAiBusy} /> : null}
        <PageOutline blocks={blocks} />
        <fieldset disabled={aiBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <InsertRow index={0} open={insertAt === 0} onOpen={() => setInsertAt(0)} />
        {blocks.map((block, index) => (
          <div key={block.id} id={block.id} style={{ scrollMarginTop: '5rem' }}>
            <div className={styles.blockWrap}>
              <BlockView
                block={block}
                assetUrl={(key) => livingAssetUrl(doc.page_id, key)}
                controls={
                  <div className={styles.blockControls}>
                    {block.type === 'text' && block.data.md.trim().length >= 8 ? <button type="button" onClick={() => {
                      setAiPanel({ blockId: block.id }); window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>AI 交互</button> : null}
                    {block.type === 'canvas' && block.data.doc.template === 'ai_model' ? <button type="button" onClick={() => {
                      setAiPanel({ blockId: String(block.data.doc.anchor_id) }); window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>重新设计</button> : null}
                    {canEdit(block) ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: block.id, field: editField(block), value: editValue(block) })
                        }
                      >
                        编辑
                      </button>
                    ) : null}
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === blocks.length - 1}>↓</button>
                    <button type="button" onClick={() => remove(index)}>删</button>
                  </div>
                }
              />
              {editing?.id === block.id ? (
                <div className={styles.editBox}>
                  {editing.field === 'md' ? (
                    <textarea
                      value={editing.value}
                      rows={4}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    />
                  ) : (
                    <input
                      value={editing.value}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                    />
                  )}
                  <div className={styles.editActions}>
                    <button type="button" className={styles.primaryBtn} onClick={commitEdit}>完成</button>
                    <button type="button" className={styles.ghostBtn} onClick={() => setEditing(null)}>取消</button>
                  </div>
                </div>
              ) : null}
            </div>
            {(pendingByBlock.get(block.id) ?? []).map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                busy={busy === s.id}
                onAccept={() => void handleAccept(s)}
                onDismiss={() => void handleDismiss(s)}
              />
            ))}
            <InsertRow index={index + 1} open={insertAt === index + 1} onOpen={() => setInsertAt(index + 1)} />
          </div>
        ))}
        </fieldset>
      </main>

      {insertAt !== null && !aiBusy ? (
        <div className={styles.insertMenu} role="dialog" aria-label="插入块">
          <div className={styles.insertGrid}>
            {INSERT_ITEMS.map((item) => (
              <button key={item.kind} type="button" onClick={() => void insert(item.kind)}>
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>
          <textarea
            className={styles.labTextInput}
            placeholder="选「实验块」前，把题目文字粘贴到这里"
            value={labText}
            onChange={(e) => setLabText(e.target.value)}
            rows={2}
          />
          {busy === 'canvas-list' ? <p className={styles.canvasPicksLoading}>正在读取工坊作品…</p> : null}
          {canvasPicks ? (
            <div className={styles.canvasPicks} role="group" aria-label="选择工坊作品">
              <strong>插入工坊作品（当前画布快照会冻结进讲义）</strong>
              {canvasPicks.length ? canvasPicks.map((work) => (
                <button key={work.work_id} type="button" disabled={busy !== null} onClick={() => void insertCanvasWork(work.work_id)}>
                  <strong>{work.title || '未命名画布'}</strong>
                  <span>{work.node_count} 个积木 · 更新于 {work.updated_at.slice(0, 10)}</span>
                </button>
              )) : <p>还没有工坊作品；先到 /canvas 搭建一个再回来。</p>}
            </div>
          ) : null}
          <button type="button" className={styles.ghostBtn} onClick={() => { setInsertAt(null); setCanvasPicks(null); }}>关闭</button>
        </div>
      ) : null}
      </div>
    </div>
  );
}

function InsertRow(props: { index: number; open: boolean; onOpen: () => void }): ReactNode {
  return (
    <div className={styles.insertRow}>
      <button type="button" aria-label="在此插入块" aria-expanded={props.open} onClick={props.onOpen}>
        ＋
      </button>
    </div>
  );
}

function canEdit(block: PageBlock): boolean {
  return block.type === 'text' || block.type === 'formula' || block.type === 'section' || block.type === 'quiz' || block.type === 'checkpoint';
}

function editField(block: PageBlock): string {
  const fields: Partial<Record<PageBlock['type'], string>> = {
    text: 'md', formula: 'latex', section: 'heading', quiz: 'question', checkpoint: 'prompt',
  };
  return fields[block.type] ?? 'md';
}

function editValue(block: PageBlock): string {
  const data = block.data as Record<string, unknown>;
  return String(data[editField(block)] ?? '');
}

function blockLabel(block: PageBlock): string {
  const data = block.data as Record<string, unknown>;
  switch (block.type) {
    case 'section': return `小节 · ${String(data.heading ?? '')}`;
    case 'text': return `文字 · ${String(data.md ?? '').slice(0, 24)}`;
    case 'formula': return `公式 · ${String(data.latex ?? '').slice(0, 24)}`;
    case 'page': return `原页 · ${String(data.alt ?? '')}`;
    case 'lab': return '实验';
    case 'quiz': return `先猜再看 · ${String(data.question ?? '').slice(0, 24)}`;
    case 'checkpoint': return `判分点 · ${String(data.prompt ?? '').slice(0, 24)}`;
    default: return block.type;
  }
}
