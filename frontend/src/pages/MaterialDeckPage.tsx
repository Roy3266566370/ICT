import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { fetchSession } from '@/api/hooks';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { readEmbeddedSpecs } from '@/components/reader/specData';
import { DeckPlayer, DeckModeSwitch, type DeckMode } from '@/components/presentation/DeckPlayer';
import { getPptAiActive } from '@/api/pptAI';
import { fromActive } from '@/ppt-ai/runtime/snapshot';
import { getDocument, patchDocument } from '@/api/documents';
import type { MaterialDetail } from '@/api/types';
import { DocumentController } from '@/document/controller';
import { createDraftSession } from '@/document/drafts';
import { useAccountScope } from '@/state/accountSession';
import type { PptAiRuntimeSnapshot } from '@/ppt-ai/runtime/snapshot';
import type { SceneDocument } from '@/document/types';
import styles from './MaterialDeckPage.module.css';

const FreeDeckEditor = lazy(() => import('@/components/editor/FreeDeckEditor').then(module => ({default: module.FreeDeckEditor})));
const subscribeEmpty = () => () => {};
const emptySnapshot = () => null;

const STAGE_TEXT: Record<string, string> = {
  queued: '正在排队准备转换…',
  parsing: '正在解析课件页面与版式结构…',
  rendering: '正在高清渲染幻灯片底图…',
  extracting: '底图已就绪，正在收尾进入工作台…',
};

export default function MaterialDeckPage() {
  const {materialId = ''} = useParams();
  const scope = useAccountScope();
  const [previewEarly, setPreviewEarly] = useState(false);
  // 与 useMaterial / FreeDeckEditor 共用同一个带 scope 的键，避免命中旧账号缓存
  const keys = useScopedQueryKeys();
  const query = useQuery({queryKey: keys.material(materialId), queryFn: async () => {
    await fetchSession();
    return api.getMaterial(materialId);
  }, enabled: !!materialId, refetchOnMount: 'always', refetchInterval: state => {
    const detail = state.state.data;
    return detail && (detail.material.status === 'processing' ||
      (detail.job && !['awaiting_confirmation', 'ready', 'failed'].includes(detail.job.stage))) ? 2000 : false;
  }});
  const aiQuery = useQuery({
    queryKey: ['ppt-ai-active', materialId],
    queryFn: () => getPptAiActive(materialId),
    enabled: !!materialId && api.mode === 'http' && query.isSuccess,
    retry: false,
    staleTime: 15000,
  });
  const aiSnapshot = useMemo(() => aiQuery.data ? fromActive(aiQuery.data) : null, [aiQuery.data]);
  if (query.isPending) return <div className="page-container" role="status">正在打开演示文稿…</div>;
  if (query.isError) return <div className="page-container" role="alert"><h1>演示文稿暂时无法打开</h1>
    <p>{errorMessage(query.error)}</p><button onClick={() => void query.refetch()}>重新载入</button> <Link to="/">返回首页</Link></div>;
  const detail = query.data;
  const hasRenderedSlides = detail.slides.length > 0 && detail.slides.some(s => Boolean(s.image_url));
  const isInDeckEdit = (detail.edit_revision ?? 0) > 0 && hasRenderedSlides;
  if (detail.material.status === 'processing' && !isInDeckEdit && !(previewEarly && hasRenderedSlides)) {
    const stage = detail.job?.stage ?? 'queued';
    const stageLabel = STAGE_TEXT[stage] ?? '正在转换演示文稿…';
    const pct = detail.job?.progress_pct ?? (stage === 'extracting' ? 65 : stage === 'rendering' ? 35 : 15);
    const renderedCount = detail.slides.filter(s => s.image_url).length;
    const totalCount = detail.material.page_count || detail.slides.length;
    return <div className="page-container" role="status">
      <h1>正在转换 PPTX</h1>
      <p>{stageLabel}</p>
      <div style={{maxWidth: 420, margin: '12px 0'}}>
        <div style={{height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden'}}>
          <div style={{width: `${Math.min(100, Math.max(8, pct))}%`, height: '100%', background: '#c4622d', transition: 'width .35s ease'}} />
        </div>
        <p style={{fontSize: 13, color: '#64748b', marginTop: 6}}>
          当前阶段：{stage}（约 {pct}%）{totalCount > 0 ? ` · 已准备 ${renderedCount} / ${totalCount} 页` : ''}
        </p>
      </div>
      <p>原页和对象准备就绪后会自动打开演示文稿。</p>
      {hasRenderedSlides && <p style={{marginTop: 12}}>
        <button type="button" onClick={() => setPreviewEarly(true)}>
          底图已就绪，先进入阅读（后台继续识别交互）
        </button>
      </p>}
    </div>;
  }
  if (detail.material.status === 'failed') return <div className="page-container" role="alert">
    <h1>演示文稿转换失败</h1>
    <Link to="/living">返回上传</Link>
  </div>;
  return <MaterialWorkbench key={`${scope}:${materialId}`} materialId={materialId} detail={detail}
    refresh={query.refetch} aiSnapshot={aiSnapshot}/>;
}

function MaterialWorkbench({materialId, detail, refresh, aiSnapshot}: {
  materialId: string;
  detail: MaterialDetail;
  refresh: () => Promise<unknown>;
  aiSnapshot: PptAiRuntimeSnapshot | null;
}) {
  const scope = useAccountScope();
  const [search, setSearch] = useSearchParams();
  const requestedMode = search.get('mode');
  const presenter = search.get('presenter');
  const [projecting, setProjecting] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const mode: DeckMode = requestedMode === 'edit' && !presenter ? 'edit' : projecting ? 'present' : 'preview';
  const [loadEditor, setLoadEditor] = useState(mode === 'edit');
  const [controller, setController] = useState<DocumentController>();
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [presenterDocument, setPresenterDocument] = useState<SceneDocument>();
  const wrapper = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? subscribeEmpty, controller?.getSnapshot ?? emptySnapshot);
  const sceneDocument = snapshot?.document ?? presenterDocument ?? detail.scene_document;
  const specs = useMemo(() => readEmbeddedSpecs(detail), [detail]);
  useEffect(() => {
    if (!presenter) return;
    let alive = true;
    void getDocument(materialId).then(document => { if (alive) setPresenterDocument(document); }).catch(() => {});
    return () => { alive = false; };
  }, [materialId, presenter]);
  useEffect(() => {
    if (mode === 'edit') setLoadEditor(true);
  }, [mode]);
  useEffect(() => {
    if (!loadEditor) return;
    let alive = true;
    let active: DocumentController | undefined;
    setLoadError('');
    const drafts = createDraftSession(materialId, scope);
    void getDocument(materialId).then(async document => {
      const draft = await drafts.read({sourceKey: document.source_key ?? '', revision: document.revision});
      if (!alive) return;
      active = new DocumentController(document, {
        save: (revision, operation, changes) => patchDocument(materialId, revision, operation, changes),
        persist: (base, current) => drafts.write(base, current),
      });
      if (draft) active.recoverDraft(draft.base, draft.document);
      setController(active);
    }).catch(error => { if (alive) setLoadError(errorMessage(error)); });
    return () => { alive = false; active?.dispose(); };
  }, [loadEditor, loadAttempt, materialId, scope]);
  useEffect(() => {
    const changed = () => { if (document.fullscreenElement !== wrapper.current) setProjecting(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    const remote = detail.scene_document;
    const current = controller?.getSnapshot();
    if (!remote || !current || !controller) return;
    if (!current.dirty && !current.saving && remote.revision > current.document.revision) controller.loadServer(remote);
  }, [controller, detail.scene_document]);

  const pages = useMemo(() => sceneDocument?.pages.map(page => {
    const detached = page.source_page_no === null;
    const source = detached ? undefined : detail.slides.find(slide => slide.page_no === (page.source_page_no ?? page.page_no));
    return {...source, page_no: page.page_no, image_url: source?.image_url ?? null, title: source?.title};
  }) ?? Array.from({length: detail.material.page_count}, (_, index) => detail.slides.find(slide => slide.page_no === index + 1) ??
    {page_no: index + 1, title: `第 ${index + 1} 页`, image_url: null}), [sceneDocument, detail.slides, detail.material.page_count]);
  const requestedPage = Number(search.get('page'));
  const pageNo = pages.find(page => page.page_no === requestedPage)?.page_no ?? pages[0]?.page_no ?? 1;
  const selectPage = useCallback((next: number) => {
    setSearch(previous => {
      const params = new URLSearchParams(previous);
      params.set('page', String(next));
      return params;
    }, {replace: true});
  }, [setSearch]);
  const switchMode = (next: DeckMode) => {
    if (next === mode) return;
    if (mode === 'edit') controller?.setComposing(false);
    setSearch(previous => {
      const params = new URLSearchParams(previous);
      if (next === 'edit') params.set('mode', 'edit');
      else params.delete('mode');
      params.set('page', String(pageNo));
      return params;
    }, {replace: true});
    setProjecting(next === 'present');
    if (next === 'present') void wrapper.current?.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement === wrapper.current) void document.exitFullscreen().catch(() => {});
  };
  const modes = {mode, onChange: switchMode};
  return <div ref={wrapper} className={styles.workbench}>
    {!presenter && mode !== 'present' && <header className={styles.header}>
      <div className={styles.heading}><Link to="/" aria-label="返回首页">万象</Link><h1>{detail.material.title}</h1></div>
      <DeckModeSwitch {...modes}/>
    </header>}
    <div className={styles.surface}>
      {mode === 'edit' && <Suspense fallback={<div className="page-container" role="status">正在打开编辑器…</div>}>
        {controller ? <FreeDeckEditor materialId={materialId} material={detail} controller={controller}
          activePageNo={pageNo} onSelectPage={selectPage} zoom={zoom} onZoom={setZoom}/> :
          <div className="page-container">
            {loadError ? <div role="alert"><h2>编辑器暂时无法打开</h2><p>{loadError}</p>
              <button onClick={() => setLoadAttempt(value => value + 1)}>重新载入</button></div> :
              <p role="status">正在载入可编辑文档…</p>}
          </div>}
      </Suspense>}
      <div className={styles.preview} hidden={mode === 'edit'}>
        <DeckPlayer title={detail.material.title} pages={pages} specs={specs}
          identity={`${materialId}.r${detail.edit_revision ?? 0}${presenter ? '.presenter.' + presenter : ''}`}
          materialId={materialId} fidelity={detail.render?.fidelity} onRefresh={refresh} sceneDocument={sceneDocument}
          formulaReviews={detail.formula_reviews} aiSnapshot={aiSnapshot} workbench={modes}
          workbenchZoom={{value: zoom, set: setZoom}} inactive={mode === 'edit'} presenter={presenter}
          saveDocument={controller?.save} readDocumentRevision={controller ? () => controller.getSnapshot().document.revision : undefined}
          documentPending={snapshot?.dirty || snapshot?.saving}/>
      </div>
    </div>
  </div>;
}
