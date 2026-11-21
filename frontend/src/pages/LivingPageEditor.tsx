/** 活页编辑器：块序列 + 激活建议 + 插入菜单 + 发布。 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  acceptSuggestion,
  createLabBlock,
  deleteLivingPage,
  dismissSuggestion,
  getLivingInsights,
  getLivingPage,
  downloadLivingPage,
  livingAssetUrl,
  patchLivingPage,
  publishLivingPage,
  generateLivingModel,
  recommendLivingModels,
  recognizeRegionFormula,
  recognizeRegionDiagram,
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
  PageRegion,
  PageVariable,
  PageVariables,
} from '@/living/types';
import { blockDraft, blockRegistry, parseBlockDraft } from '@/living/blockRegistry';
import { aiAnchorOf, aiInstructionOf } from '@/living/sim';
import { planRegionInsert } from '@/living/regions';
import { LiveVarsProvider, useLiveVars } from '@/living/liveVars';
import { VariablesBar } from '@/components/living/VariablesBar';
import styles from './LivingPage.module.css';

function newId(): string {
  return `blk_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

type InsertKind = 'text' | 'formula' | 'section' | 'callout' | 'quiz' | 'checkpoint' | 'embed' | 'lab' | 'canvas_work';

const INSERT_ITEMS: { kind: InsertKind; label: string; hint: string }[] = [
  { kind: 'text', label: '文字', hint: '一段说明文字' },
  { kind: 'formula', label: '公式', hint: 'LaTeX 公式' },
  { kind: 'callout', label: '知识卡片', hint: '定理/证明/例题/易错' },
  { kind: 'section', label: '小节', hint: '标题与层级' },
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
    case 'section':
      return { id, type: 'section', data: { heading: '新小节', level: 1 } };
    case 'quiz':
      return {
        id, type: 'quiz',
        data: { question: '先猜：结果是多少？', answer: '', explain: '', min: 0, max: 10, value: 1 },
      };
    case 'callout':
      return { id, type: 'callout', data: { kind: 'theorem', title: '', md: '在这里写卡片内容…', collapsible: false } };
    case 'checkpoint':
      return { id, type: 'checkpoint', data: { prompt: '写下你的答案', expected: '', placeholder: '', grading: 'exact' } };
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
  const [editing, setEditing] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const editingBlock = blocks.find((block) => block.id === editing?.id);
  const editResult = editing && editingBlock ? parseBlockDraft(editingBlock, editing.values) : null;
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [labText, setLabText] = useState('');
  const [canvasPicks, setCanvasPicks] = useState<WorkSummary[] | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [insights, setInsights] = useState<LivingInsights | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const uploadState = useLocation().state as { diagramError?: string } | null;
  const [error, setError] = useState<string | null>(uploadState?.diagramError ?? null);
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

  /** 页面块 id 集：门控目标悬挂检测（BlockView.peerIds）。 */
  const peerIds = useMemo(() => new Set(blocks.map((block) => block.id)), [blocks]);

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
    if (blocks[index]?.id === editing?.id) setEditing(null);
    mutate(blocks.filter((_, i) => i !== index));
  };

  const commitEdit = (): void => {
    if (!editing || !editResult?.block) return;
    const updated = editResult.block;
    const next = blocks.map((b) => b.id === editing.id ? updated : b);
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
    if (blockRegistry[block.type]) setEditing({ id: block.id, values: blockDraft(block) });
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

  const handleOfflineDownload = async (): Promise<void> => {
    if (!doc || busy !== null) return;
    setBusy('offline');
    setError(null);
    try {
      if (dirty) {
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        if (!await save(blocks, doc.revision)) return;
      }
      const url = URL.createObjectURL(await downloadLivingPage(doc.page_id));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'living-page.html';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      setError(errorMessage(error));
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
        progress(result.cached
          ? `第 ${index + 1}/${ids.length} 个内容已有相同设计（复用缓存）`
          : `已生成 ${index + 1}/${ids.length} 个交互建议——在正文下方点「激活」落成可编辑积木`);
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

  /** 页内区域 → 正文块：插入 formula/canvas/figure，回写 block_id/
   *  canvas_block_id；已有公式锚块时插在其后且只补画布，不重复 formula。 */
  const insertRegion = async (pageBlock: PageBlock, region: PageRegion): Promise<void> => {
    if (!doc || busy !== null) return;
    const pageIndex = blocks.findIndex((b) => b.id === pageBlock.id);
    if (pageIndex < 0) return;
    const plan = planRegionInsert(region, new Set(Object.keys(doc.variables ?? {})), newId);
    if (!plan) return;
    const anchorIndex = region.block_id
      ? blocks.findIndex((b) => b.id === region.block_id)
      : -1;
    const insertIndex = (anchorIndex >= 0 ? anchorIndex : pageIndex) + 1;
    setBusy('region');
    setError(null);
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      const source = { ...(pageBlock.source ?? {}), region: region.id };
      const inserted = plan.blocks.map((b) => ({ ...b, source }));
      const focusId = plan.canvasAnchorId ?? plan.blockAnchorId;
      const next = blocks.map((b) => {
        if (b.id !== pageBlock.id || b.type !== 'page') return b;
        const regions = (b.data.regions ?? []).map((r) =>
          r.id === region.id
            ? {
                ...r,
                ...(plan.blockAnchorId ? { block_id: plan.blockAnchorId } : {}),
                ...(plan.canvasAnchorId ? { canvas_block_id: plan.canvasAnchorId } : {}),
              }
            : r);
        return { ...b, data: { ...b.data, regions } };
      });
      next.splice(insertIndex, 0, ...inserted);
      const updated = await patchLivingPage({
        pageId: doc.page_id,
        expectedRevision: doc.revision,
        blocks: next,
        variables: { ...(doc.variables ?? {}), ...plan.variables },
      });
      setDoc(updated);
      setBlocks(updated.blocks);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      if (focusId) {
        window.setTimeout(() => {
          document.getElementById(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
    } catch (e) {
      setError(isApiError(e, 'VERSION_CONFLICT') ? '文档已被别处修改，请刷新' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** 公式区域 → 本地公式 OCR：有未保存改动先落盘，再按需识别并缓存回文档。 */
  const recognizeFormula = async (pageBlock: PageBlock, region: PageRegion): Promise<void> => {
    if (!doc || busy !== null) return;
    setBusy('region');
    setError(null);
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      let current = doc;
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) return;
        current = saved;
      }
      const updated = await recognizeRegionFormula({
        pageId: current.page_id, regionId: region.id, expectedRevision: current.revision,
      });
      setDoc(updated);
      setBlocks(updated.blocks);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(isApiError(e, 'VERSION_CONFLICT') ? '文档已被别处修改，请刷新' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** 图示区域 → 视觉流程图转译：先落盘未保存改动，再按需识别并缓存回文档。 */
  const recognizeDiagram = async (pageBlock: PageBlock, region: PageRegion): Promise<void> => {
    if (!doc || busy !== null) return;
    setBusy('region');
    setError(null);
    try {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      let current = doc;
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) return;
        current = saved;
      }
      const updated = await recognizeRegionDiagram({
        pageId: current.page_id, regionId: region.id, expectedRevision: current.revision,
      });
      setDoc(updated);
      setBlocks(updated.blocks);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      const revision = isApiError(e) ? e.details?.revision : undefined;
      if (typeof revision === 'number') {
        setDoc((current) => current && current.revision < revision ? { ...current, revision } : current);
      }
      setError(isApiError(e, 'VERSION_CONFLICT') ? '文档已被别处修改，请刷新' : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** 批量转译：用户确认后逐张调用，进度可见、可取消、单张失败保留原图继续。 */
  const [diagramQueue, setDiagramQueue] = useState<{ done: number; total: number } | null>(null);
  const diagramCancel = useRef(false);
  const pendingDiagramRegions = (): { pageBlock: PageBlock; region: PageRegion }[] => {
    const out: { pageBlock: PageBlock; region: PageRegion }[] = [];
    for (const block of blocks) {
      if (block.type !== 'page') continue;
      for (const region of block.data.regions ?? []) {
        if ((region.kind === 'diagram' || region.kind === 'figure') && !region.diagram) {
          out.push({ pageBlock: block, region });
        }
      }
    }
    return out;
  };
  const recognizeDiagramsBatch = async (): Promise<void> => {
    if (!doc || busy !== null) return;
    const queue = pendingDiagramRegions();
    if (!queue.length || !window.confirm(`将 ${queue.length} 张图示发送给视觉模型转译？`)) return;
    setBusy('diagram-batch');
    diagramCancel.current = false;
    setDiagramQueue({ done: 0, total: queue.length });
    setError(null);
    try {
      let current = doc;
      if (dirty) {
        const saved = await save(blocks, doc.revision);
        if (!saved) return;
        current = saved;
      }
      for (const { region } of queue) {
        if (diagramCancel.current) break;
        try {
          current = await recognizeRegionDiagram({
            pageId: current.page_id, regionId: region.id, expectedRevision: current.revision,
          });
          setDoc(current);
          setBlocks(current.blocks);
        } catch (e) {
          setError(errorMessage(e));
          const revision = isApiError(e) ? e.details?.revision : undefined;
          if (typeof revision === 'number') {
            current = { ...current, revision };
            setDoc(current);
          }
          if (isApiError(e, 'VERSION_CONFLICT')) break;
        }
        setDiagramQueue((q) => (q ? { ...q, done: q.done + 1 } : q));
      }
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setDiagramQueue(null);
      setBusy(null);
    }
  };

  /** diagram 块拖拽/改字 → 本地 mutate（防抖 PATCH）。 */
  const mutateBlock = (blockId: string, data: PageBlock['data']): void => {
    mutate(blocks.map((b) => (b.id === blockId ? ({ ...b, data } as PageBlock) : b)));
  };

  const openAI = (blockId: string): void => {
    setAiPanel({ blockId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** 页面变量定义是文档结构的一部分，改定义走 PATCH；运行时值只是预览态。 */
  const saveVariables = async (next: PageVariables): Promise<void> => {
    if (!doc) return;
    try {
      const updated = await patchLivingPage({ pageId: doc.page_id, expectedRevision: doc.revision, variables: next });
      setDoc(updated);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(isApiError(e, 'VERSION_CONFLICT') ? '文档已被别处修改，请刷新' : errorMessage(e));
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
          <button type="button" className={styles.ghostBtn} aria-expanded={showVars} onClick={() => setShowVars((v) => !v)}>
            变量{Object.keys(doc.variables ?? {}).length ? `（${Object.keys(doc.variables ?? {}).length}）` : ''}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => void loadInsights()}>
            学情
          </button>
          {(() => {
            const pending = pendingDiagramRegions().length;
            if (!pending && !diagramQueue) return null;
            return diagramQueue ? (
              <span className={styles.ghostBtn} role="status">
                转译 {diagramQueue.done}/{diagramQueue.total}
                <button type="button" onClick={() => { diagramCancel.current = true; }}>取消</button>
              </span>
            ) : (
              <button type="button" className={styles.ghostBtn}
                      disabled={busy !== null}
                      onClick={() => void recognizeDiagramsBatch()}>
                识别流程图（{pending}）
              </button>
            );
          })()}
          <button type="button" className={styles.ghostBtn} disabled={aiBusy} onClick={() => void handleDelete()}>
            删除
          </button>
          <button type="button" className={styles.ghostBtn} disabled={busy !== null}
                  onClick={() => void handleOfflineDownload()}>下载离线活页</button>
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

      {showVars ? (
        <VarsPanel
          key={doc.revision}
          vars={doc.variables ?? {}}
          onSave={saveVariables}
          onClose={() => setShowVars(false)}
        />
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
                    {stat.diagram_step_max ? ` · 流程演示到 ${stat.diagram_step_max} 步 · ${stat.diagram_completed} 人走完全程` : ''}
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
        <LiveVarsProvider variables={doc.variables}>
        <VariablesBar hint="页面变量 · 拖动可联动插值与绑定块（预览态，不改文档默认值）" />
        <PageOutline blocks={blocks} />
        <fieldset disabled={aiBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <InsertRow index={0} open={insertAt === 0} onOpen={() => setInsertAt(0)} />
        {blocks.map((block, index) => (
          <div key={block.id} id={block.id} style={{ scrollMarginTop: '5rem' }}>
            <div className={styles.blockWrap}>
              <BlockView
                block={block}
                assetUrl={(key) => livingAssetUrl(doc.page_id, key)}
                peerIds={peerIds}
                onInsertRegion={(pageBlock, region) => void insertRegion(pageBlock, region)}
                onRecognizeFormula={(pageBlock, region) => recognizeFormula(pageBlock, region)}
                onRecognizeDiagram={(pageBlock, region) => recognizeDiagram(pageBlock, region)}
                onMutateBlock={mutateBlock}
                onAI={openAI}
                controls={
                  <div className={styles.blockControls} data-editor-controls>
                    {block.type === 'text' && block.data.md.trim().length >= 8 ? <button type="button" onClick={() => {
                      setAiPanel({ blockId: block.id }); window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>AI 交互</button> : null}
                    {block.type === 'formula' && block.data.latex.trim().length >= 4 ? <button type="button" onClick={() => {
                      setAiPanel({ blockId: block.id }); window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>AI 交互</button> : null}
                    {block.type === 'canvas' && aiAnchorOf(block) ? <button type="button" onClick={() => {
                      setAiPanel({ blockId: aiAnchorOf(block)! }); window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>重新设计</button> : null}
                    {blockRegistry[block.type] ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: block.id, values: blockDraft(block) })
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
                <form className={styles.editBox} aria-label={`编辑${blockRegistry[block.type]?.label ?? '块'}`} noValidate onSubmit={(event) => { event.preventDefault(); commitEdit(); }}>
                  {blockRegistry[block.type]?.fields.map((field, fieldIndex) => {
                    const id = `edit-${block.id}-${field.key}`;
                    const fieldError = editResult?.errors[field.key];
                    const props = {
                      id,
                      value: editing.values[field.key] ?? '',
                      autoFocus: fieldIndex === 0,
                      'aria-invalid': !!fieldError,
                      'aria-describedby': fieldError ? `${id}-error` : undefined,
                      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                        setEditing({ ...editing, values: { ...editing.values, [field.key]: event.target.value } }),
                    };
                    return (
                      <div className={styles.editField} key={field.key}>
                        <label htmlFor={id}>{field.label}</label>
                        {field.kind === 'textarea' ? (
                          <textarea {...props} rows={4} />
                        ) : field.kind === 'select' ? (
                          <select {...props}>{field.options?.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}</select>
                        ) : field.kind === 'checkbox' ? (
                          <input
                            id={id}
                            type="checkbox"
                            checked={editing.values[field.key] === 'true'}
                            autoFocus={fieldIndex === 0}
                            onChange={(event) =>
                              setEditing({ ...editing, values: { ...editing.values, [field.key]: event.target.checked ? 'true' : 'false' } })
                            }
                          />
                        ) : field.kind === 'bindings' ? (
                          <BindingsEditor
                            id={id}
                            value={editing.values[field.key] ?? '{}'}
                            hint={field.hint}
                            onChange={(json) =>
                              setEditing({ ...editing, values: { ...editing.values, [field.key]: json } })
                            }
                          />
                        ) : field.kind === 'gate' ? (
                          <GateEditor
                            id={id}
                            value={editing.values[field.key] ?? ''}
                            peers={blocks.filter((b) => (b.type === 'quiz' || b.type === 'checkpoint') && b.id !== block.id)}
                            hint={field.hint}
                            onChange={(json) =>
                              setEditing({ ...editing, values: { ...editing.values, [field.key]: json } })
                            }
                          />
                        ) : (
                          <input {...props} type={field.kind} step={field.kind === 'number' ? 'any' : undefined} />
                        )}
                        {fieldError ? <p id={`${id}-error`} className={styles.fieldError} role="alert">{fieldError}</p> : null}
                      </div>
                    );
                  })}
                  <div className={styles.editActions}>
                    <button type="submit" className={styles.primaryBtn} disabled={!editResult?.block}>完成</button>
                    <button type="button" className={styles.ghostBtn} onClick={() => setEditing(null)}>取消</button>
                  </div>
                </form>
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
        </LiveVarsProvider>
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
    case 'callout': return `知识卡片 · ${String(data.title ?? data.kind ?? '')}`;
    default: return block.type;
  }
}

/** 页面变量管理面板：编辑 definitions（持久化进文档），与运行时预览值分离。 */
function VarsPanel(props: {
  vars: PageVariables;
  onSave: (next: PageVariables) => Promise<void>;
  onClose: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<PageVariables>(() => JSON.parse(JSON.stringify(props.vars)) as PageVariables);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'number' | 'select'>('number');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = Object.keys(draft);

  const patchVar = (name: string, patch: Partial<PageVariable>): void => {
    const spec = draft[name];
    if (!spec) return;
    setDraft({ ...draft, [name]: { ...spec, ...patch } as PageVariable });
  };

  const addVar = (): void => {
    const name = newName.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      setError('变量名须以字母开头，仅含字母/数字/下划线。');
      return;
    }
    if (draft[name]) {
      setError('同名变量已存在。');
      return;
    }
    const spec: PageVariable = newType === 'select'
      ? { label: name, type: 'select', value: '选项1', options: ['选项1', '选项2'] }
      : { label: name, type: 'number', value: 0, min: 0, max: 1, step: 0.01 };
    setDraft({ ...draft, [name]: spec });
    setNewName('');
    setError(null);
  };

  const submit = async (): Promise<void> => {
    for (const [name, spec] of Object.entries(draft)) {
      if (spec.type === 'number') {
        if (!Number.isFinite(spec.value)) {
          setError(`变量 ${name} 的默认值必须是有限数值。`);
          return;
        }
        if (spec.min !== undefined && spec.max !== undefined && !(spec.min < spec.max)) {
          setError(`变量 ${name} 必须满足 min < max。`);
          return;
        }
        if (spec.step !== undefined && !(spec.step > 0)) {
          setError(`变量 ${name} 的步长 step 必须大于 0。`);
          return;
        }
        if ((spec.min !== undefined && spec.value < spec.min) || (spec.max !== undefined && spec.value > spec.max)) {
          setError(`变量 ${name} 的默认值超出 min/max 范围。`);
          return;
        }
      } else if (!spec.options.length) {
        setError(`选择型变量 ${name} 至少需要填写一个选项（用逗号分隔）。`);
        return;
      }
    }
    setError(null);
    setBusy(true);
    await props.onSave(draft);
    setBusy(false);
  };

  return (
    <aside className={styles.varsPanel} aria-label="页面变量管理">
      <header className={styles.varsPanelHead}>
        <strong>页面变量</strong>
        <span className={styles.varsPanelHint}>变量在正文中用 ${'{名字}'} 插值、用 [v:名字] 插入滑杆，并可绑定到实验/画布参数</span>
        <button type="button" onClick={props.onClose}>×</button>
      </header>
      {names.length ? names.map((name) => {
        const spec = draft[name]!;
        return (
          <div className={styles.varsRow} key={name}>
            <code className={styles.varsName}>{name}</code>
            <input className={styles.varsLabel} value={spec.label} placeholder="显示名" title="显示名"
              onChange={(e) => patchVar(name, { label: e.target.value })} />
            {spec.type === 'number' ? (
              <>
                <input className={styles.varsNum} type="number" step="any" value={spec.value} title="默认值"
                  onChange={(e) => patchVar(name, { value: Number(e.target.value) })} />
                <input className={styles.varsNum} type="number" step="any" value={spec.min ?? ''} placeholder="min" title="最小值"
                  onChange={(e) => patchVar(name, { min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <input className={styles.varsNum} type="number" step="any" value={spec.max ?? ''} placeholder="max" title="最大值"
                  onChange={(e) => patchVar(name, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <input className={styles.varsNum} type="number" step="any" value={spec.step ?? ''} placeholder="step" title="步长"
                  onChange={(e) => patchVar(name, { step: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </>
            ) : (
              <>
                <input className={styles.varsLabel} value={spec.value} placeholder="默认值" title="默认值"
                  onChange={(e) => patchVar(name, { value: e.target.value })} />
                <input className={styles.varsOptions} value={spec.options.join(',')} placeholder="选项（逗号分隔）" title="选项（逗号分隔）"
                  onChange={(e) => patchVar(name, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </>
            )}
            <input className={styles.varsUnit} value={spec.unit ?? ''} placeholder="单位" title="单位"
              onChange={(e) => patchVar(name, { unit: e.target.value || undefined })} />
            <button type="button" title="删除变量" onClick={() => {
              const next = { ...draft };
              delete next[name];
              setDraft(next);
            }}>×</button>
          </div>
        );
      }) : <p className={styles.varsEmpty}>还没有变量。先添加一个，再在正文或绑定里引用它。</p>}
      <div className={styles.varsAdd}>
        <input value={newName} placeholder="新变量名（如 eta）" onChange={(e) => setNewName(e.target.value)} />
        <select value={newType} onChange={(e) => setNewType(e.target.value as 'number' | 'select')}>
          <option value="number">数值滑杆</option>
          <option value="select">选择项</option>
        </select>
        <button type="button" onClick={addVar}>添加</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => void submit()}>
          {busy ? '保存中…' : '保存变量'}
        </button>
      </div>
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
    </aside>
  );
}

/** 绑定行编辑器：每行 ``块内参数键 ← 页面变量名``，canvas 键为 ``node_id.param_key``。 */
function BindingsEditor(props: { id: string; value: string; hint?: string; onChange: (json: string) => void }): ReactNode {
  const { defs } = useLiveVars();
  let rows: [string, string][] = [];
  try {
    const parsed = JSON.parse(props.value || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rows = Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
      );
    }
  } catch { /* 草稿非法 JSON 时退回空行，保存校验会给出提示 */ }
  const emit = (next: [string, string][]): void => props.onChange(JSON.stringify(Object.fromEntries(next)));
  const names = Object.keys(defs);
  return (
    <div className={styles.bindingsEditor} id={props.id}>
      {rows.map(([param, varName], index) => (
        <div className={styles.bindRow} key={index}>
          <input value={param} placeholder="块内参数键" aria-label="块内参数键"
            onChange={(e) => { const next = [...rows]; next[index] = [e.target.value, varName]; emit(next); }} />
          <span aria-hidden>←</span>
          <input value={varName} placeholder="变量名" list={`${props.id}-vars`} aria-label="页面变量名"
            onChange={(e) => { const next = [...rows]; next[index] = [param, e.target.value]; emit(next); }} />
          <button type="button" title="删除绑定" onClick={() => emit(rows.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <datalist id={`${props.id}-vars`}>{names.map((name) => <option key={name} value={name} />)}</datalist>
      <button type="button" className={styles.ghostBtn} onClick={() => emit([...rows, ['', '']])}>＋ 添加绑定</button>
      {props.hint ? <p className={styles.bindHint}>{props.hint}</p> : null}
      {!names.length ? <p className={styles.bindHint}>还没有页面变量——先在工具栏「变量」里创建。</p> : null}
    </div>
  );
}

/** 门控配置：下拉挑一个 quiz/checkpoint 块 + 解锁规则；序列化为 JSON 存回草稿。 */
function GateEditor(props: { id: string; value: string; peers: PageBlock[]; hint?: string; onChange: (json: string) => void }): ReactNode {
  let gate: { block_id?: string; rule?: string } = {};
  try {
    const parsed = JSON.parse(props.value || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) gate = parsed as { block_id?: string; rule?: string };
  } catch { /* 非法草稿按无门控处理，保存校验给提示 */ }
  const emit = (next: { block_id?: string; rule?: string }): void => {
    props.onChange(next.block_id ? JSON.stringify({ block_id: next.block_id, rule: next.rule === 'correct' ? 'correct' : 'submitted' }) : '');
  };
  return (
    <div className={styles.bindingsEditor} id={props.id}>
      <div className={styles.bindRow}>
        <select
          value={gate.block_id && props.peers.some((b) => b.id === gate.block_id) ? gate.block_id : ''}
          aria-label="门控目标块"
          onChange={(e) => emit({ block_id: e.target.value || undefined, rule: gate.rule })}
        >
          <option value="">不门控（始终可见）</option>
          {props.peers.map((b) => <option key={b.id} value={b.id}>{blockLabel(b)}</option>)}
        </select>
        <span aria-hidden>→</span>
        <select
          value={gate.rule === 'correct' ? 'correct' : 'submitted'}
          disabled={!gate.block_id}
          aria-label="解锁规则"
          onChange={(e) => emit({ block_id: gate.block_id, rule: e.target.value })}
        >
          <option value="submitted">作答后解锁</option>
          <option value="correct">答对后解锁</option>
        </select>
      </div>
      {props.hint ? <p className={styles.bindHint}>{props.hint}</p> : null}
      {!props.peers.length ? <p className={styles.bindHint}>还没有可用的先猜再看/判分点块——先插入一个再来设置门控。</p> : null}
    </div>
  );
}
