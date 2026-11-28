import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { fetchSession } from '@/api/hooks';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { readEmbeddedSpecs } from '@/components/reader/specData';
import { DeckPlayer, DeckModeSwitch, type DeckMode } from '@/components/presentation/DeckPlayer';
import { DeckTopBar } from '@/components/presentation/DeckTopBar';
import { fromFrozen } from '@/ppt-ai/runtime/snapshot';
import { getLearningHealth } from '@/api/pptAI';
import { getDocument, patchDocument, renameMaterial } from '@/api/documents';
import type { MaterialDetail } from '@/api/types';
import { DocumentController } from '@/document/controller';
import { createDraftSession } from '@/document/drafts';
import { useAccountScope } from '@/state/accountSession';
import type { SceneDocument } from '@/document/types';
import styles from './MaterialDeckPage.module.css';

const FreeDeckEditor = lazy(() => import('@/components/editor/FreeDeckEditor').then(module => ({default: module.FreeDeckEditor})));
const subscribeEmpty = () => () => {};
const emptySnapshot = () => null;

const STAGE_TEXT: Record<string, string> = {
  queued: '正在排队准备转换…',
  parsing: '正在解析课件页面与版式结构…',
  rendering: '正在高清渲染幻灯片底图…',
  extracting: '底图已就绪，正在识别图表公式并收尾…',
};

const CONVERT_STEPS = [
  { key: 'parsing', label: '解析结构' },
  { key: 'rendering', label: '高清渲染' },
  { key: 'extracting', label: '识别图表公式' },
  { key: 'assembling', label: '组装活页' },
] as const;

const CONVERT_TIPS = [
  '原页与可交互对象准备就绪后会自动打开演示文稿。',
  '小贴士：转换完成后，点击页面中的公式或图表即可直接调参演练。',
  '小贴士：可在任意一页插入定象坊全景沙盘，现场联动推演。',
] as const;

function resolveStepIndex(stage: string, pct: number): number {
  if (stage === 'ready' || stage === 'awaiting_confirmation' || pct >= 92) return 3;
  if (stage === 'extracting') return 2;
  if (stage === 'rendering') return 1;
  return 0;
}

function PptxConvertLoader({
  stage,
  stageLabel,
  pct,
  renderedCount,
  totalCount,
  hasRenderedSlides,
  onPreviewEarly,
}: {
  stage: string;
  stageLabel: string;
  pct: number;
  renderedCount: number;
  totalCount: number;
  hasRenderedSlides: boolean;
  onPreviewEarly: () => void;
}) {
  const gradId = useId();
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTipIndex((i) => (i + 1) % CONVERT_TIPS.length), 4500);
    return () => window.clearInterval(timer);
  }, []);
  const clampedPct = Math.min(100, Math.max(8, Math.round(pct)));
  const activeStep = resolveStepIndex(stage, clampedPct);
  const cellCount = totalCount > 0 ? Math.min(totalCount, 48) : 0;
  const filledCells = cellCount > 0 ? Math.min(cellCount, Math.round((renderedCount / totalCount) * cellCount)) : 0;

  return (
    <div className={styles.loaderPage} role="status">
      <section className={styles.loaderCard}>
        <svg className={styles.awakeSvg} viewBox="0 0 240 150" fill="none" aria-hidden="true">
          <rect x="44" y="18" width="152" height="104" rx="12" fill="#f0ece3" stroke="#e2dcd0" />
          <rect x="36" y="25" width="152" height="104" rx="12" fill="#f7f4ed" stroke="#e5dfd3" />
          <g className={styles.cardFloat}>
            <rect x="28" y="32" width="152" height="104" rx="12" fill="#ffffff" stroke="#dcd6c8" strokeWidth="1.4" />
            <rect x="42" y="46" width="54" height="6" rx="3" fill="#d9d4c7" />
            <rect x="42" y="57" width="34" height="4" rx="2" fill="#e9e5dc" />
            <path d="M44 106 H164 M44 72 V106" stroke="#e4e0d6" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M48 100 Q76 74 104 90 T160 76" stroke="#e5e1d8" strokeWidth="2" fill="none" />
            <path className={styles.waveAlive} d="M48 100 Q76 74 104 90 T160 76" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <circle className={styles.dotPulse} cx="104" cy="90" r="4" fill="#c25928" />
            <circle className={styles.dotPulse} cx="160" cy="76" r="3.5" fill="#0d9488" />
            <rect x="44" y="118" width="78" height="4" rx="2" fill="#eceae4" />
            <rect x="44" y="118" width="40" height="4" rx="2" fill="#c25928" opacity="0.7" />
            <circle className={styles.knobSlide} cx="62" cy="120" r="5" fill="#ffffff" stroke="#c25928" strokeWidth="2" />
            <g className={styles.scanBeam}>
              <rect x="26" y="34" width="22" height="100" fill={`url(#${gradId})`} />
              <line x1="48" y1="34" x2="48" y2="134" stroke="#4f46e5" strokeWidth="1.5" opacity="0.7" />
            </g>
          </g>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.18" />
            </linearGradient>
          </defs>
        </svg>

        <h1 className={styles.loaderTitle}>正在将课件转为通文册</h1>
        <p className={styles.loaderSubtitle}>{stageLabel}</p>

        <div className={styles.stepsRail} aria-label="转换阶段">
          {CONVERT_STEPS.map((step, index) => {
            const state = index < activeStep ? 'done' : index === activeStep ? 'active' : 'pending';
            return (
              <div key={step.key} className={styles.stepItem} data-state={state}>
                <div className={styles.stepDot}>{state === 'done' ? '✓' : index + 1}</div>
                <span className={styles.stepLabel}>{step.label}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.progressBox}>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${clampedPct}%` }} />
          </div>
          <div className={styles.progressMeta}>
            <span>当前阶段：<strong>{CONVERT_STEPS[activeStep]?.label ?? stage}</strong></span>
            <span>约 {clampedPct}%{totalCount > 0 ? ` · 已准备 ${renderedCount} / ${totalCount} 页` : ''}</span>
          </div>
        </div>

        {cellCount > 0 && (
          <div className={styles.matrixWrap}>
            <div className={styles.matrixHead}>
              <span>逐页渲染进度</span>
              <span>{renderedCount} / {totalCount} 页</span>
            </div>
            <div className={styles.matrixGrid} aria-hidden="true">
              {Array.from({ length: cellCount }, (_, i) => {
                const cellState = i < filledCells ? 'done' : i === filledCells && filledCells < cellCount ? 'current' : 'pending';
                return <div key={i} className={styles.pageCell} data-cell={cellState} />;
              })}
            </div>
          </div>
        )}

        <p className={styles.loaderTip}>{CONVERT_TIPS[tipIndex]}</p>

        {hasRenderedSlides && (
          <button type="button" className={styles.earlyBtn} onClick={onPreviewEarly}>
            {totalCount > 0 && renderedCount < totalCount
              ? `首批底图已就绪（${renderedCount}/${totalCount}），先进入阅读`
              : '底图已就绪，先进入阅读（后台收尾中）'}
          </button>
        )}
      </section>
    </div>
  );
}

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
      (detail.job && !['awaiting_confirmation', 'ready', 'failed'].includes(detail.job.stage))) ? 1000 : false;
  }});
  const learningQuery = useQuery({
    queryKey: ['ppt-ai-learning-health', scope, materialId],
    queryFn: () => getLearningHealth(materialId),
    enabled: !!materialId && api.mode === 'http' && query.isSuccess,
    retry: false,
    staleTime: 15000,
  });
  if (query.isPending) return <div className="page-container" role="status">正在打开演示文稿…</div>;
  if (query.isError) return <div className="page-container" role="alert"><h1>演示文稿暂时无法打开</h1>
    <p>{errorMessage(query.error)}</p><button onClick={() => void query.refetch()}>重新载入</button> <Link to="/">返回首页</Link></div>;
  const detail = query.data;
  const hasRenderedSlides = detail.slides.length > 0 && detail.slides.some(s => Boolean(s.image_url));
  const isInDeckEdit = (detail.edit_revision ?? 0) > 0 && hasRenderedSlides;
  if (detail.material.status === 'processing' && !isInDeckEdit && !(previewEarly && hasRenderedSlides)) {
    const stage = detail.job?.stage ?? 'queued';
    const stageLabel = STAGE_TEXT[stage] ?? '正在转换演示文稿…';
    const renderedCount = detail.slides.filter(s => s.image_url).length;
    const totalCount = detail.material.page_count || detail.slides.length;
    const renderPct = totalCount > 0 && renderedCount > 0
      ? Math.min(88, Math.round(20 + (renderedCount / totalCount) * 68))
      : null;
    const pct = stage === 'rendering'
      ? (renderPct ?? 25)
      : stage === 'extracting'
        ? Math.max(detail.job?.progress_pct ?? 65, renderedCount > 0 && renderedCount >= totalCount ? 92 : 75)
        : (detail.job?.progress_pct ?? 15);
    return (
      <PptxConvertLoader
        stage={stage}
        stageLabel={stageLabel}
        pct={pct}
        renderedCount={renderedCount}
        totalCount={totalCount}
        hasRenderedSlides={hasRenderedSlides}
        onPreviewEarly={() => setPreviewEarly(true)}
      />
    );
  }
  if (detail.material.status === 'failed') return <div className="page-container" role="alert">
    <h1>演示文稿转换失败</h1>
    <Link to="/living">返回上传</Link>
  </div>;
  return <MaterialWorkbench key={`${scope}:${materialId}`} materialId={materialId} detail={detail}
    learningEnabled={learningQuery.data?.learning_enabled}/>;
}

function MaterialWorkbench({materialId, detail, learningEnabled}: {
  materialId: string;
  detail: MaterialDetail;
  learningEnabled?: boolean;
}) {
  const scope = useAccountScope();
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  const [search, setSearch] = useSearchParams();
  const requestedMode = search.get('mode');
  const presenter = search.get('presenter');
  const [projecting, setProjecting] = useState(false);
  const [headerActionsHost, setHeaderActionsHost] = useState<HTMLDivElement | null>(null);
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
  const frozenAi = detail.forked_ppt_ai && sceneDocument?.revision === 0 ? fromFrozen(detail.forked_ppt_ai) : null;
  return <div ref={wrapper} className={styles.workbench}>
    {!presenter && mode !== 'present' && <DeckTopBar title={detail.material.title}
      onRename={api.mode==='http'?async title=>{
        const saved=await renameMaterial(materialId,title);
        queryClient.setQueryData<MaterialDetail>(keys.material(materialId),current=>current?{
          ...current,material:{...current.material,title:saved.title},
        }:current);
      }:undefined}
      home={<Link to="/living" aria-label="返回通文册">← 通文册</Link>}
      status={snapshot?.error ? { text: '保存失败', tone: 'error' }
        : snapshot?.saving ? { text: '保存中…', tone: 'pending' }
        : snapshot?.dirty ? { text: '有待同步的修改', tone: 'pending' }
        : { text: '已保存', tone: 'saved' }}
      modes={<DeckModeSwitch {...modes}/>}>
      <div className={styles.headerActions} ref={setHeaderActionsHost}/>
    </DeckTopBar>}
    <div className={styles.surface}>
      {mode === 'edit' && <Suspense fallback={<div className="page-container" role="status">正在打开编辑器…</div>}>
        {controller ? <FreeDeckEditor materialId={materialId} material={detail} controller={controller}
          activePageNo={pageNo} onSelectPage={selectPage} zoom={zoom} onZoom={setZoom} headerActionsHost={headerActionsHost}/> :
          <div className="page-container">
            {loadError ? <div role="alert"><h2>编辑器暂时无法打开</h2><p>{loadError}</p>
              <button onClick={() => setLoadAttempt(value => value + 1)}>重新载入</button></div> :
              <p role="status">正在载入可编辑文档…</p>}
          </div>}
      </Suspense>}
      <div className={styles.preview} hidden={mode === 'edit'}>
        <DeckPlayer title={detail.material.title} pages={pages} specs={specs}
          identity={`${materialId}.r${detail.edit_revision ?? 0}${presenter ? '.presenter.' + presenter : ''}`}
          materialId={materialId} headerActionsHost={presenter ? undefined : headerActionsHost} sceneDocument={sceneDocument}
          formulaReviews={detail.formula_reviews} aiSnapshot={frozenAi} learningEnabled={frozenAi ? false : learningEnabled} workbench={modes}
          workbenchZoom={{value: zoom, set: setZoom}} inactive={mode === 'edit'} presenter={presenter}
          saveDocument={controller?.save} readDocumentRevision={controller ? () => controller.getSnapshot().document.revision : undefined}
          documentPending={snapshot?.dirty || snapshot?.saving}
          onPlazaPublish={() => void queryClient.invalidateQueries({ queryKey: ['plaza'] })}/>
      </div>
    </div>
  </div>;
}
