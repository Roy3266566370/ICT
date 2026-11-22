import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {FormulaReviewDialog} from './FormulaReviewDialog';
import { Link,useSearchParams } from 'react-router-dom';
import { api, apiBase, errorMessage, requestDownload } from '@/api/client';
import { downloadProjectPackage } from '@/api/projectPackage';
import type { SlideElement } from '@/api/types';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import { ISpecView, validateParameterInput } from '@/components/ispec/ISpecView';
import { evaluateSpec } from '@/ispec/evaluate';
import { initialValues, type ISpec } from '@/ispec/types';
import { useDeckValues } from './useDeckValues';
import styles from './DeckPlayer.module.css';
import { getMaterialEditor, saveMaterialEdits, type EditorModel, type ElementEdit } from '@/api/editor';
import { ElementEditor } from './ElementEditor';
import { ScenarioCompare } from './ScenarioCompare';
import {ScenePageView} from '@/components/editor/ScenePageView';
import type {SceneDocument,ScenePage} from '@/document/types';
import {getDocument,patchDocument,prepareDocumentPage,reinteractDocumentPage} from '@/api/documents';
import { ExperimentStage } from '@/components/experiments/ExperimentStage';
import { TrustBadge } from '@/components/trust/TrustBadge';
import {ZoomControl} from '@/components/ui/ZoomControl';
import {fitZoom,wheelZoom} from '@/components/ui/zoom';
import {PptAiInteraction} from '@/components/ppt-ai/PptAiInteraction';
import {GeneratedViewFrame} from '@/components/ppt-ai/GeneratedViewFrame';
import {LearningPanel} from '@/components/ppt-ai/learning/LearningPanel';
import {PageLabPanel} from '@/components/ppt-ai/PageLabPanel';
import {evaluateBundle,evaluateBundleIncremental,evaluateNode,nodeInputValues} from '@/ppt-ai/runtime/evaluate';
import type {BundleEvaluation,CanonicalValue,CanonicalValues,OverrideValues} from '@/ppt-ai/runtime/evaluate';
import {conclusionChanges,effectiveConceptValue,pagesForNodes,type ConclusionChange} from '@/ppt-ai/runtime/linking';
import {nodesForPage} from '@/ppt-ai/runtime/snapshot';
import type {PptAiRuntimeSnapshot} from '@/ppt-ai/runtime/snapshot';
import type {InteractionBundle} from '@/ppt-ai/types';
import type {LearningPage,LearningSourceRef} from '@/ppt-ai/learning/types';
import {learningPageFromFrozen} from '@/ppt-ai/learning/fromSnapshot';
import {getLearningPage,getPptAiBranch,getPptAiBundle,patchPptAiBranch} from '@/api/pptAI';
import {LinkagePanel} from '@/components/ppt-ai/LinkagePanel';
import { pageDisplayUrl } from './pageUrls';
import { newPrefetchUrls, planPrefetch, prefetchAllowed } from './prefetch';
import { ThumbnailRail, type ThumbnailRailBadge, type ThumbnailRailItem } from './ThumbnailRail';
import { LiveLayer } from './live/LiveLayer';
import { planLive } from './live/liveRegions';
import { PresentationAnnotator, type AnnotateTool } from './PresentationAnnotator';

/** 悬停「自由编辑」时先把当前页对象准备好，点进去就不用再等十秒。 */
function warmEditPage(materialId:string|undefined,pageNo:number){
  if(!materialId)return;
  void prepareDocumentPage(materialId,pageNo).catch(()=>{});
}

function sceneTitle(page:ScenePage):string|undefined{
  return [...page.nodes].filter(node=>node.type==='text'&&!node.deleted&&!node.hidden&&node.text.trim()&&
    !(node.interaction?.kind==='formula')&&!/^[A-Za-z]\s*=/.test(node.text.trim()))
    .sort((a,b)=>(b.style.font_size??0)-(a.style.font_size??0)||b.text.length-a.text.length)[0]?.text.trim().slice(0,80);
}

const EMPTY_VALUES: Record<string, number | boolean | string> = {};

export interface DeckPage {
  page_no: number;
  title?: string;
  image_url: string | null;
  render_bytes?: number | null;
  width?: number;
  height?: number;
  elements?: SlideElement[];
}

interface Props {
  title: string;
  pages: DeckPage[];
  specs: ISpec[];
  identity: string;
  materialId?: string;
  fidelity?: string;
  extraActions?: ReactNode;
  onRefresh?: () => Promise<unknown>;
  sceneDocument?:SceneDocument|null;
  aiSnapshot?:PptAiRuntimeSnapshot|null;
  formulaReviews?: Record<string, {page_no: number; math_text: string; reason: string}>;
}

function boxStyle(bbox: {x: number; y: number; w: number; h: number}, page: DeckPage): CSSProperties {
  const width = page.width ?? 12192000;
  const height = page.height ?? 6858000;
  return { left: `${100*bbox.x/width}%`, top: `${100*bbox.y/height}%`,
    width: `${100*bbox.w/width}%`, height: `${100*bbox.h/height}%` };
}

export function DeckPlayer({title, pages, specs, identity, materialId, fidelity, extraActions, onRefresh,sceneDocument,aiSnapshot,formulaReviews}: Props) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [search, setSearch] = useSearchParams();
  const requested = Number(search.get('page') ?? 1);
  const index = Math.max(0, Math.min(pages.length - 1, pages.findIndex(p => p.page_no === requested)));
  const page = pages[index];
  const scenePage=sceneDocument?.pages.find(p=>p.page_no===page?.page_no&&p.modified&&p.preparation?.status==='ready');
  /** 编辑过的页面按场景节点定位；未编辑页面继续用原 bbox（EMU）。 */
  const sceneNodeStyle = useCallback((elementId?: string | null): CSSProperties | null => {
    if(!scenePage || !elementId) return null;
    const node=scenePage.nodes.find(item=>item.source_element_id===elementId&&!item.deleted&&!item.hidden);
    if(!node) return null;
    const moved=[['x','base_x'],['y','base_y'],['width','base_width'],['height','base_height']].some(
      ([key,baseKey])=>{
        const base=node[baseKey as 'base_x'|'base_y'|'base_width'|'base_height'];
        return typeof base==='number'&&Math.abs(node[key as 'x'|'y'|'width'|'height']-base)>0.01;
      });
    if(!moved) return null;
    return {left:`${100*node.x/scenePage.width}%`,top:`${100*node.y/scenePage.height}%`,
      width:`${100*node.width/scenePage.width}%`,height:`${100*node.height/scenePage.height}%`};
  }, [scenePage]);
  const sourceStyle = useCallback((bbox: {x:number;y:number;w:number;h:number} | null | undefined, elementId?: string | null): CSSProperties => {
    const moved=sceneNodeStyle(elementId);
    if(moved) return moved;
    return bbox && page ? boxStyle(bbox,page) : {};
  }, [sceneNodeStyle, page]);
  const livePageSize = useMemo(
    () => ({ width: page?.width ?? 12192000, height: page?.height ?? 6858000 }),
    [page?.width, page?.height],
  );
  const [presenting, setPresenting] = useState(false);
  const [annotateTool, setAnnotateTool] = useState<AnnotateTool>('off');
  const [annotateColor, setAnnotateColor] = useState('#c4622d');
  const [annotateClearNonce, setAnnotateClearNonce] = useState(0);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [aiActiveId, setAiActiveId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{x:number;y:number;left:number;top:number;moved:boolean} | null>(null);
  const suppressPageClick = useRef(false);
  const lastWheelAt = useRef(0);
  const [editor, setEditor] = useState<EditorModel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [reinteracting, setReinteracting] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const pendingActivation = useRef<string | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [area, setArea] = useState({width: 900, height: 600});
  const reducedMotion = useReducedMotion();
  const state = useDeckValues(specs, identity, materialId);
  const aiBundle = aiSnapshot?.bundle ?? null;
  const [liveValues, setLiveValues] = useState<CanonicalValues>({});
  const [aiOverrides, setAiOverrides] = useState<OverrideValues>({});
  const [linkEvaluation, setLinkEvaluation] = useState<BundleEvaluation | null>(null);
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkImpact, setLinkImpact] = useState<{nonce: number; affectedPages: number[]; changes: ConclusionChange[]}>({
    nonce: 0, affectedPages: [], changes: [],
  });
  const branchRevision = useRef(1);
  const linkSaveTimer = useRef<number | null>(null);
  const impactTimer = useRef<number | null>(null);
  const meaningfulSpecs = useMemo(() => specs.filter(spec => {
    if (spec.scene?.scene_type === 'relation_types') return false;
    const hasVisual = spec.views.some(v => v.type === 'figure' || v.type === 'vega' || v.type === 'table');
    const hasExpr = (spec.expressions?.length ?? 0) > 0;
    const notes = spec.notes ?? '';
    if (!hasVisual && !hasExpr && (notes.includes('omml_formula') || notes.includes('不执行公式求值'))) return false;
    return true;
  }), [specs]);
  const pageSpecs = useMemo(() => meaningfulSpecs.filter(spec => spec.anchor?.page===page?.page_no || spec.parameters.some(p => p.source.page === page?.page_no) ||
    spec.checks?.some(check => check.page === page?.page_no)), [meaningfulSpecs, page?.page_no]);
  const aiNodes = useMemo(() => nodesForPage(aiBundle, page?.page_no ?? 1), [aiBundle, page?.page_no]);
  const aiActiveNode = useMemo(() => aiNodes.find(node => node.node_id === aiActiveId) ?? null, [aiNodes, aiActiveId]);
  const prefetchedImages = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    const urls = pages.map(item => pageDisplayUrl(item.image_url, item.render_bytes));
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    const plan = planPrefetch(urls, index, prefetchAllowed(connection));
    const warm = (list: string[], priority: 'high' | 'low') => {
      for (const url of newPrefetchUrls(list, new Set(prefetchedImages.current.keys()))) {
        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = priority;
        image.src = url;
        prefetchedImages.current.set(url, image);
      }
    };
    let idleHandle: number | null = null;
    let idleTimer: number | null = null;
    // 先让当前页主图拿一小段带宽，再预取相邻页；延迟同时保证 networkidle 能等到预取完成。
    const start = window.setTimeout(() => {
      warm(plan.immediate, 'high');
      if (!plan.idle.length) return;
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(() => warm(plan.idle, 'low'), { timeout: 2000 });
      } else {
        idleTimer = window.setTimeout(() => warm(plan.idle, 'low'), 500);
      }
    }, 200);
    return () => {
      window.clearTimeout(start);
      if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, [index, pages]);
  const interactivePages = useMemo(
    () => new Set(specs.flatMap(spec => spec.parameters.map(parameter => parameter.source.page))),
    [specs],
  );
  const affectedPages = useMemo(() => new Set(linkImpact.affectedPages), [linkImpact.affectedPages]);
  const railBadges = useMemo(() => {
    const badges = new Map<number, ThumbnailRailBadge>();
    for (const change of linkImpact.changes) {
      if (!badges.has(change.page)) {
        badges.set(change.page, {
          label: `${change.label} ${change.before} → ${change.after}`,
          title: `${change.title}：${change.label} ${change.before} → ${change.after}`,
        });
      }
    }
    return badges;
  }, [linkImpact.changes]);
  const railPages = useMemo<ThumbnailRailItem[]>(() => pages.map(item => {
    const edited = sceneDocument?.pages.find(p => p.page_no === item.page_no && p.modified && p.preparation?.status === 'ready');
    const label = (edited && sceneTitle(edited)) || item.title || '';
    return {
      pageNo: item.page_no,
      label,
      imageUrl: item.image_url,
      bytes: typeof item.render_bytes === 'number' ? item.render_bytes : null,
      aspectRatio: `${item.width ?? 16}/${item.height ?? 9}`,
      scene: edited ?? null,
    };
  }), [pages, sceneDocument]);
  useEffect(() => {
    if (!aiBundle) {
      setLiveValues({});
      setAiOverrides({});
      setLinkEvaluation(null);
      return;
    }
    const seed = aiSnapshot?.branch?.canonical_values ?? {};
    const nextValues = { ...aiBundle.seed_values, ...seed };
    const nextOverrides = aiSnapshot?.branch?.overrides ?? {};
    setLiveValues(nextValues);
    setAiOverrides(nextOverrides);
    setLinkEvaluation(evaluateBundle(aiBundle, nextValues, nextOverrides));
    branchRevision.current = aiSnapshot?.branch?.revision ?? 1;
    setLinkImpact(current => ({ ...current, affectedPages: [], changes: [] }));
    // 只在 bundle/分支身份变化时重置；本地连续调参不被刷新覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiBundle?.bundle_id, aiSnapshot?.branch?.branch_id]);
  const aiNodeOverrides = useMemo(
    () => (aiActiveNode ? (aiOverrides[aiActiveNode.node_id] ?? {}) : {}),
    [aiActiveNode?.node_id, aiOverrides],
  );
  const aiValues = useMemo(
    () => aiActiveNode ? nodeInputValues(aiActiveNode, liveValues, linkEvaluation, aiNodeOverrides) : {},
    [aiActiveNode, liveValues, linkEvaluation, aiNodeOverrides],
  );
  const aiArtifact = useMemo(() => {
    if (!aiActiveNode) return null;
    return (aiSnapshot?.artifacts ?? []).find(artifact => artifact.acceptance_status === 'accepted' && artifact.isolation?.node_id === aiActiveNode.node_id) ?? null;
  }, [aiActiveNode, aiSnapshot]);
  const aiGeneratedInput = useMemo(() => {
    if (!aiActiveNode) return {};
    const evaluation = evaluateNode(aiActiveNode, aiValues, linkEvaluation?.derivedValues ?? {}, aiNodeOverrides);
    return {
      series: evaluation.projection?.series ?? [],
      rects: evaluation.projection?.rects ?? [],
      domain: evaluation.projection?.domain ?? { x_min: -1, x_max: 1 },
      metrics: evaluation.metrics.map(metric => ({ label: metric.label, value: metric.value })),
    };
  }, [aiActiveNode, aiValues, linkEvaluation, aiNodeOverrides]);
  const [learningOpen,setLearningOpen]=useState(false);
  const learningEntryRef=useRef<HTMLButtonElement>(null);
  const closeLearning=useCallback(()=>{
    setLearningOpen(false);
    window.setTimeout(()=>learningEntryRef.current?.focus({preventScroll:true}),0);
  },[]);
  const [learningPage,setLearningPage]=useState<LearningPage|null>(null);
  const [learningBundle,setLearningBundle]=useState<InteractionBundle|null>(null);
  const [learningLoading,setLearningLoading]=useState(false);
  const [learningError,setLearningError]=useState('');
  const [learningHighlight,setLearningHighlight]=useState<LearningSourceRef|null>(null);
  const frozenLearningPage=useMemo(()=>learningPageFromFrozen(aiSnapshot,page?.page_no??1),[aiSnapshot,page?.page_no]);
  const activeLearningPage=learningPage??frozenLearningPage;
  const activeSpecs = useMemo(() => pageSpecs.filter(spec => spec.availability !== 'needs_review'), [pageSpecs]);
  const pausedSpecs = useMemo(() => pageSpecs.filter(spec => spec.availability === 'needs_review'), [pageSpecs]);
  const selectedSpec = pageSpecs.find(spec => spec.object_id === activeId) ?? null;
  const active = selectedSpec && selectedSpec.availability !== 'needs_review' ? selectedSpec : null;
  const values = active ? (state.values[active.object_id] ?? initialValues(active)) : EMPTY_VALUES;
  // 控件读即时值；图形与结论读延后值，拖动时输入不被重型渲染阻塞。
  const deferredValues = useDeferredValue(values);
  const valuesStale = values !== deferredValues;
  const [liveMode, setLiveMode] = useState(true);
  const deferredDeckValues = useDeferredValue(state.values);
  const livePlans = useMemo(() => activeSpecs.map(spec => planLive(spec, page?.page_no ?? 0)), [activeSpecs, page?.page_no]);
  const liveSpecs = useMemo(() => liveMode && !scenePage?.auto_vectors ? activeSpecs.filter((_, i) => !livePlans[i]!.fallback) : [], [liveMode, activeSpecs, livePlans, scenePage?.auto_vectors]);
  const liveSpecIds = useMemo(() => new Set(liveSpecs.map(spec => spec.object_id)), [liveSpecs]);
  const evaluation = useMemo(() => active ? evaluateSpec(active, deferredValues) : null, [active, deferredValues]);
  const visual = active?.views.find(view => view.type === 'figure' || view.type === 'vega');
  // PPT 页宽是点值（约 12192000），展示缩放以场景页的像素宽为 100% 基准。
  const pageWidth = scenePage?.width ?? 960;
  const pageHeight = scenePage?.height ?? pageWidth * ((page?.height ?? 540) / (page?.width ?? 960));
  const fitScale = fitZoom(area, {width: pageWidth, height: pageHeight}, 40, .25, 4);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const slideWidth = pageWidth * scale;
  const slideHeight = pageHeight * scale;
  const canPan = slideWidth + 40 > area.width || slideHeight + 40 > area.height;

  useLayoutEffect(() => {
    const node = viewportNode;
    if (!node) return;
    const measure = () => setArea({width: node.clientWidth, height: node.clientHeight});
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewportNode]);
  useEffect(() => {
    const node = viewportNode;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setZoom(current => wheelZoom(current === 'fit' ? fitScale : current, event.deltaY));
    };
    node.addEventListener('wheel', onWheel, {passive: false});
    return () => node.removeEventListener('wheel', onWheel);
  }, [fitScale, viewportNode]);
  useEffect(() => { setReviewId(null); setActiveId(null); setAiActiveId(null); setSelected(null); setAdvancedOpen(false); setImageFailed(false);
    setLearningOpen(false);setLearningPage(null);setLearningBundle(null);setLearningHighlight(null);setLearningError('');setLabOpen(false); }, [page?.page_no]);
  useEffect(() => { setAdvancedOpen(false); }, [activeId]);
  useEffect(() => {
    const id=pendingActivation.current;
    if (!id) return;
    const generated=specs.find(spec=>spec.anchor?.element_id===id);
    if (generated) {setActiveId(generated.object_id); pendingActivation.current=null;}
  },[specs]);
  useEffect(() => {
    if (!editJob || !materialId) return;
    let alive=true;
    const check=async()=>{
      try {
        const job=await api.getJob(editJob);
        if (!alive) return;
        if (['awaiting_confirmation','ready','failed'].includes(job.stage)) {
          const model=await getMaterialEditor(materialId);
          if (!alive) return;
          setEditor(model); setEditJob(null); setEditorBusy(false);
          if (job.stage==='failed') {setMessage(job.error?.message ?? '更新失败，可重新识别'); return;}
          setEditing(false); setSelected(null); setReviewId(null); setMessage('内容已保存，页面和交互已更新');
          await onRefresh?.();
        }
      } catch(error) {if(alive) setMessage(`正在等待生成结果：${errorMessage(error)}`);}
    };
    void check(); const timer=window.setInterval(()=>void check(),1500);
    return()=>{alive=false;window.clearInterval(timer);};
  },[editJob,materialId,onRefresh]);

  const loadLearningBundle=async(pageData:LearningPage)=>{
    if(!materialId||!pageData.bundle_id)return aiSnapshot?.bundle??null;
    if(aiSnapshot?.bundle?.bundle_id===pageData.bundle_id)return aiSnapshot.bundle;
    try{return await getPptAiBundle(materialId,pageData.bundle_id);}catch{return aiSnapshot?.bundle??null;}
  };
  const openLearning=async()=>{
    if(!page)return;
    setLearningOpen(true);setLabOpen(false);setLearningError('');setLearningHighlight(null);
    setActiveId(null);setAiActiveId(null);setAdvancedOpen(false);setEditing(false);
    if(!materialId){setLearningPage(null);setLearningBundle(aiSnapshot?.bundle??null);return;}
    setLearningLoading(true);
    try{
      const next=await getLearningPage(materialId,page.page_no);
      setLearningPage(next);
      setLearningBundle(await loadLearningBundle(next));
    }catch(error){setLearningError(errorMessage(error));}
    finally{setLearningLoading(false);}
  };
  const refreshLearning=async()=>{
    if(!materialId||!page)return;
    try{
      const next=await getLearningPage(materialId,page.page_no);
      setLearningPage(next);
      setLearningBundle(await loadLearningBundle(next));
      setLearningError('');
    }catch(error){setLearningError(errorMessage(error));}
    await onRefresh?.();
  };
  const openEditor=async()=>{
    if (!materialId || busy || state.saving) return;
    setEditing(true);setActiveId(null);setEditorBusy(true);setMessage('');
    try {setEditor(await getMaterialEditor(materialId));}
    catch(error){setMessage(errorMessage(error));}
    finally{setEditorBusy(false);}
  };
  const reinteractPage=async()=>{
    if(!materialId||state.saving||busy||editorBusy||reinteracting)return;
    setReinteracting(true);setMessage('正在按当前编辑内容提取本页交互…');
    try{
      if(!await state.save()){setMessage('参数尚未保存，请先处理保存提示');return;}
      const revision=sceneDocument?.revision??0;
      const result=await reinteractDocumentPage(materialId,page!.page_no,revision);
      await onRefresh?.();
      setActiveId(null);
      setMessage(`第 ${page!.page_no} 页已按当前内容重新提取${result.refreshed_user_interactions?`，恢复 ${result.refreshed_user_interactions} 个公式`:''}`);
    }catch(error){setMessage(errorMessage(error));}
    finally{setReinteracting(false);}
  };
  const restoreSpecContent=async(spec:ISpec)=>{
    if(!materialId||!sceneDocument||state.saving)return;
    const node=sceneDocument.pages.find(item=>item.page_no===page?.page_no)?.nodes.find(item=>
      item.id===spec.node_id||item.source_element_id===spec.anchor?.element_id);
    if(!node){setMessage('没有找到对应的编辑对象，请打开自由编辑处理');return;}
    const patch:Record<string,unknown>={};
    if(node.base_text!==null&&node.base_text!==undefined&&node.text!==node.base_text)patch.text=node.base_text;
    if(JSON.stringify(node.table)!==JSON.stringify(node.base_table))patch.table=node.base_table;
    if(JSON.stringify(node.chart)!==JSON.stringify(node.base_chart))patch.chart=node.base_chart;
    if(!Object.keys(patch).length){
      setMessage(node.source_element_id?'当前内容与原稿一致':'这是新建对象，没有可撤销的原稿；请在自由编辑中修改公式或重新提取');
      return;
    }
    setMessage('正在恢复原稿内容…');
    try{
      await patchDocument(materialId,sceneDocument.revision,`restore_${Date.now()}`, [{page_no:page!.page_no,id:node.id,patch}]);
      await onRefresh?.();
      setActiveId(null);
      setMessage('已恢复原稿内容，依赖它的交互重新启用');
    }catch(error){setMessage(errorMessage(error));}
  };
  const saveEdit=async(change?:ElementEdit)=>{
    if(!materialId || editorBusy || busy || state.saving) return;
    setEditorBusy(true);setMessage('正在保存并重新生成页面…');
    try {
      if(!await state.save()) {setMessage('当前参数尚未保存，请先处理保存提示');setEditorBusy(false);return;}
      const model=editor ?? await getMaterialEditor(materialId);
      const result=await saveMaterialEdits(materialId,model.revision,change?[change]:[]);
      if(change?.kind==='interaction' || change?.kind==='recognition') pendingActivation.current=change.element_id;
      setEditJob(result.job_id);
    }catch(error){setMessage(errorMessage(error));setEditorBusy(false);}
  };
  useEffect(() => {
    if (!materialId || editorBusy || busy || state.saving) return;
    if (!/未保存|仍有新修改/.test(state.status)) return;
    const timer = window.setTimeout(() => { void state.save(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [materialId, editorBusy, busy, state.saving, state.status, state.save, state.values]);
  const go = useCallback((next: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, next))];
    if (!target) return;
    const query = new URLSearchParams(search);
    query.set('page', String(target.page_no));
    setSearch(query, {replace: true});
  }, [pages, search, setSearch]);
  const panDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPan || event.button !== 0) return;
    if ((event.target as Element).closest('button,a,input,select,textarea,[contenteditable="true"],[data-no-pan],[data-live-region]')) return;
    const node = event.currentTarget;
    if (node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight) return;
    panRef.current = {x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop, moved: false};
    setPanning(true);
    node.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const panMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (Math.hypot(dx, dy) > 3) pan.moved = true;
    event.currentTarget.scrollLeft = pan.left - dx;
    event.currentTarget.scrollTop = pan.top - dy;
  };
  const panEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    if (panRef.current.moved) {
      suppressPageClick.current = true;
      window.setTimeout(() => { suppressPageClick.current = false; }, 120);
    }
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    const node = viewportNode;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!presenting || active || event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) < 8) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelAt.current < 420) return;
      lastWheelAt.current = now;
      go(index + (event.deltaY > 0 ? 1 : -1));
    };
    node.addEventListener('wheel', onWheel, {passive: false});
    return () => node.removeEventListener('wheel', onWheel);
  }, [active, go, index, presenting, viewportNode]);
  useEffect(() => {
    viewportNode?.scrollTo({left: 0, top: 0});
  }, [page?.page_no, viewportNode]);
  const exitPresentation = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);
  const startPresentation = useCallback(() => {
    setPresenting(true);
    void shell.current?.requestFullscreen?.().catch(() => setMessage('已进入演示模式，可用浏览器全屏继续展示'));
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (learningOpen) closeLearning();
        else if (activeId) setActiveId(null);
        else exitPresentation();
        return;
      }
      if (event.defaultPrevented || (event.target as Element)?.closest('input, textarea, select, math-field, [contenteditable="true"]')) return;
      if((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if(busy || editorBusy || state.saving) return;
        if(event.key.toLowerCase()==='y' || event.shiftKey) state.redo();else state.undo();
        return;
      }
      if((event.target as Element)?.closest('[data-no-pan]')) return;
      if (event.key === ' ' && (event.target as Element)?.closest('button, a')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault(); go(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault(); go(index - 1);
      } else if (event.key === 'Home') { event.preventDefault(); go(0); }
      else if (event.key === 'End') { event.preventDefault(); go(pages.length - 1); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [go, index, pages.length, activeId, exitPresentation, state.undo, state.redo,busy,editorBusy,state.saving,learningOpen,closeLearning]);
  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const ensureEditedPagesReady = async (): Promise<void> => {
    if (!materialId || !sceneDocument?.pages.some(page => page.modified)) return;
    let document = await getDocument(materialId);
    const pending = document.pages.filter(page => page.modified && page.preparation?.status !== 'ready');
    if (!pending.length) return;
    setMessage(`正在准备 ${pending.length} 个改动页的对象，完成后会自动继续…`);
    await Promise.all(pending.map(page => prepareDocumentPage(materialId, page.page_no)));
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      document = await getDocument(materialId);
      const modified = document.pages.filter(page => page.modified);
      const failed = modified.find(page => {
        const status = page.preparation?.status;
        return status === 'failed' || (status === 'unprepared' && (page.preparation?.errors?.length ?? 0) > 0);
      });
      if (failed) throw new Error(`第 ${failed.page_no} 页对象准备失败，请进入自由编辑重试`);
      if (modified.every(page => page.preparation?.status === 'ready')) return;
    }
    throw new Error('页面对象准备耗时较长，请稍后重试');
  };
  const publish = async () => {
    if (!materialId) return;
    setBusy(true); setMessage('');
    try {
      if (!await state.save()) return;
      await ensureEditedPagesReady();
      const result = await api.publishMaterial(materialId);
      setShareUrl(new URL(result.share_url, window.location.origin).href);
      setMessage('');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const exportProject=async()=>{
    if(!materialId||busy)return;
    setBusy(true);setMessage('正在打包可再次编辑的工程文件…');
    try{
      const file=await downloadProjectPackage(materialId);
      const url=URL.createObjectURL(file);const link=document.createElement('a');
      link.href=url;link.download=`${title.replace(/[\/:*?"<>|]/g,'_')}-工程包.xsproj`;
      document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage('工程包已下载，可在另一台电脑导入后继续编辑');
    }catch(error){setMessage(errorMessage(error));}
    finally{setBusy(false);}
  };
  const exportPptx=async()=>{
    if(!materialId||busy)return;
    setBusy(true);setMessage('正在生成标准 PPTX 课件…');
    try{
      const file=await requestDownload(`/api/v1/materials/${encodeURIComponent(materialId)}/export-pptx`);
      const url=URL.createObjectURL(file);const link=document.createElement('a');
      link.href=url;link.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}.pptx`;
      document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage('标准 PPTX 课件已导出，可直接用 PowerPoint / WPS 打开');
    }catch(error){setMessage(errorMessage(error));}
    finally{setBusy(false);}
  };
  const download=async()=>{
    if(!materialId || busy) return;
    setBusy(true);setMessage('正在打包整份交互网页…');
    try {
      if(!await state.save()) {setMessage('参数尚未保存，请先处理保存提示再导出');return;}
      await ensureEditedPagesReady();
      setMessage('正在打包整份交互网页…');
      const file=await requestDownload(`/api/v1/materials/${encodeURIComponent(materialId)}/export-html`);
      const url=URL.createObjectURL(file);const link=document.createElement('a');
      link.href=url;link.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}-交互网页.html`;
      document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage('交互网页已下载，可直接用浏览器打开，断网也能翻页和调参');
    }catch(error){setMessage(errorMessage(error));}
    finally{setBusy(false);}
  };
  const change = useCallback((id: string, value: number | boolean | string) => {
    if (!active || busy || state.saving || editorBusy) return;
    setMessage('');
    const parameter = active.parameters.find(p => p.id === id);
    if (parameter && validateParameterInput(parameter, value).ok) state.change(active, id, value);
  }, [active, busy, editorBusy, state.change, state.saving]);
  const closeExperiment = useCallback(() => setActiveId(null), []);
  const resetExperiment = useCallback(() => { if (active) state.reset(active); }, [active, state.reset]);
  const toggleAdvanced = useCallback(() => setAdvancedOpen(value => !value), []);
  const refreshTrust = useCallback(() => { void onRefresh?.(); }, [onRefresh]);

  const changeLive = useCallback((spec: ISpec, id: string, value: number) => {
    if (busy || state.saving || editorBusy) return false;
    const parameter = spec.parameters.find(p => p.id === id);
    if (!parameter || !validateParameterInput(parameter, value).ok) return false;
    setMessage('');
    state.change(spec, id, value);
    return true;
  }, [busy, editorBusy, state.change, state.saving]);
  const expandSpec = useCallback((specId: string) => setActiveId(specId), []);

  const applyLinkChange = useCallback((
    nextValues: CanonicalValues,
    nextOverrides: OverrideValues,
    changedConcepts: string[],
    changedOverrideNodes: string[],
  ) => {
    if (!aiBundle || !linkEvaluation) return;
    const result = evaluateBundleIncremental(
      aiBundle, nextValues, linkEvaluation, changedConcepts, nextOverrides, changedOverrideNodes,
    );
    setLiveValues(nextValues);
    setAiOverrides(nextOverrides);
    setLinkEvaluation(result.evaluation);
    const changes = conclusionChanges(aiBundle, linkEvaluation, result.evaluation, result.changed);
    // 高亮口径 = 「结论变化」的页（changed 按节点哈希对比），
    // 不是「被重算」的页：affected 里可能有数值完全没变的页。
    const pages = pagesForNodes(aiBundle, result.changed);
    if (impactTimer.current) window.clearTimeout(impactTimer.current);
    setLinkImpact(current => ({ nonce: current.nonce + 1, affectedPages: pages, changes }));
    impactTimer.current = window.setTimeout(() => {
      setLinkImpact(current => ({ ...current, affectedPages: [], changes: [] }));
      impactTimer.current = null;
    }, 3600);
  }, [aiBundle, linkEvaluation]);

  const persistLinkState = useCallback((nextValues: CanonicalValues, nextOverrides: OverrideValues) => {
    if (!materialId || !aiSnapshot?.branch || aiSnapshot.frozen) return;
    const branchId = aiSnapshot.branch.branch_id;
    if (linkSaveTimer.current) window.clearTimeout(linkSaveTimer.current);
    const save = async (): Promise<void> => {
      const updated = await patchPptAiBranch(materialId, branchId, {
        expected_revision: branchRevision.current,
        operation_id: `link_${Date.now()}`,
        values: nextValues,
        overrides: nextOverrides,
      });
      branchRevision.current = updated.revision;
      setMessage(`全表联动已保存（revision ${updated.revision}）`);
    };
    linkSaveTimer.current = window.setTimeout(() => {
      linkSaveTimer.current = null;
      void save().catch(async error => {
        // 409 后必须刷新本地 revision，否则之后每次保存都会继续 409。
        try {
          const fresh = await getPptAiBranch(materialId, branchId);
          branchRevision.current = fresh.revision;
          await save();
        } catch (retryError) {
          setMessage(`全表联动保存失败：${errorMessage(retryError ?? error)}`);
        }
      });
    }, 650);
  }, [materialId, aiSnapshot?.branch?.branch_id]);

  const changeConcept = useCallback((conceptId: string, value: CanonicalValue) => {
    if (!aiBundle || !linkEvaluation) return;
    const nextValues = { ...liveValues, [conceptId]: value };
    applyLinkChange(nextValues, aiOverrides, [conceptId], []);
    if (!aiSnapshot?.branch || aiSnapshot.frozen) setMessage('冻结/离线快照：联动结果只保留在当前页面，不写入服务器');
    persistLinkState(nextValues, aiOverrides);
  }, [aiBundle, linkEvaluation, liveValues, aiOverrides, applyLinkChange, aiSnapshot?.branch, persistLinkState]);

  const changeActiveNodeValue = useCallback((conceptId: string, value: CanonicalValue) => {
    if (!aiActiveNode || !aiBundle || !linkEvaluation) return;
    if (aiOverrides[aiActiveNode.node_id] && conceptId in aiOverrides[aiActiveNode.node_id]!) {
      const nextOverrides: OverrideValues = {
        ...aiOverrides,
        [aiActiveNode.node_id]: { ...aiOverrides[aiActiveNode.node_id]!, [conceptId]: value },
      };
      applyLinkChange(liveValues, nextOverrides, [], [aiActiveNode.node_id]);
      persistLinkState(liveValues, nextOverrides);
      return;
    }
    changeConcept(conceptId, value);
  }, [aiActiveNode, aiBundle, linkEvaluation, aiOverrides, liveValues, applyLinkChange, persistLinkState, changeConcept]);

  const toggleNodeOverride = useCallback((nodeId: string, conceptId: string, enabled: boolean) => {
    if (!aiBundle) return;
    const nextOverrides: OverrideValues = { ...aiOverrides };
    const current = { ...(nextOverrides[nodeId] ?? {}) };
    if (enabled) {
      // 基准值取该节点当前读到的生效值：linked 参数要用派生值，
      // 取 liveValues 会让数值在开启独立的瞬间跳回被忽略的本地旧值。
      const base = effectiveConceptValue(aiBundle, linkEvaluation, liveValues, nodeId, conceptId);
      current[conceptId] = base ?? 0;
      nextOverrides[nodeId] = current;
    } else {
      delete current[conceptId];
      if (Object.keys(current).length) nextOverrides[nodeId] = current;
      else delete nextOverrides[nodeId];
    }
    applyLinkChange(liveValues, nextOverrides, [], [nodeId]);
    persistLinkState(liveValues, nextOverrides);
    setMessage(enabled ? '本页已保持独立；共享变量变化不再影响该节点' : '本页已恢复联动');
  }, [aiBundle, aiOverrides, liveValues, linkEvaluation, applyLinkChange, persistLinkState]);

  useEffect(() => () => {
    if (linkSaveTimer.current) window.clearTimeout(linkSaveTimer.current);
    if (impactTimer.current) window.clearTimeout(impactTimer.current);
  }, []);

  const jumpToPage = useCallback((pageNo: number) => {
    const target = pages.findIndex(item => item.page_no === pageNo);
    if (target >= 0) go(target);
  }, [pages, go]);

  if (!page) return <div className={styles.empty}>页面正在生成，请稍后重新载入。</div>;
  const reviewElements = (page.elements ?? []).filter(element => formulaReviews?.[element.element_id]?.page_no === page.page_no);
  const reviewElement = reviewElements.find(element => element.element_id === reviewId);
  const review = reviewId ? formulaReviews?.[reviewId] : undefined;

  const editablePage=editor?.pages.find(item=>item.page_no===page.page_no);
  const selectedElement=editablePage?.elements.find(element=>element.element_id===selected);

  return <div ref={shell} className={styles.shell} data-presenting={presenting} data-experiment={!!active} data-panel={!!active}>
    <header className={styles.topbar}>
      <div className={styles.brand}>{materialId ? <a href="/" aria-label="返回首页">万象<span> / 演示文稿</span></a> : <span>万象<span> / 交互演示</span></span>}</div>
      <div className={styles.title}><h1>{title}</h1><span>{pages.length} 页 · {meaningfulSpecs.length} 个交互对象</span></div>
      <button className={styles.railToggle} onClick={() => setRailCollapsed(value => !value)} aria-pressed={railCollapsed}
        aria-label={railCollapsed ? '展开页导航' : '收起页导航'}>{railCollapsed ? '▸ 页导航' : '◂ 页导航'}</button>
      <div className={styles.actions}>
        <div className={`${styles.actionGroup} ${styles.authorOnly}`}>
          {materialId&&<Link className={styles.editLink} to={`/materials/${materialId}/edit?page=${page?.page_no??1}`}
            onMouseEnter={()=>warmEditPage(materialId,page?.page_no??1)} onFocus={()=>warmEditPage(materialId,page?.page_no??1)}>编辑内容 / 交互</Link>}
          {materialId && api.mode === 'http' && <Link className={styles.editLink} to={`/materials/${materialId}/ai`}>AI 交互 ↗</Link>}
          {aiBundle && <button onClick={() => setLinkPanelOpen(value => !value)} aria-pressed={linkPanelOpen}
            title="查看所有输入概念、派生输出与出现位置">全表变量</button>}
          <button onClick={() => setLiveMode(value => !value)} aria-pressed={liveMode}
            title={liveMode ? '当前：直接在原页上操作；点击切换为点击热区进入实验页' : '当前：点击热区进入实验页；点击切换为原页直接操作'}>
            {liveMode ? '原位交互' : '经典实验页'}</button>
          <button onClick={state.undo} disabled={!state.canUndo || editorBusy || busy || state.saving} aria-label="撤销参数修改" title="Ctrl+Z">↶ 撤销</button>
          <button onClick={state.redo} disabled={!state.canRedo || editorBusy || busy || state.saving} aria-label="重做参数修改" title="Ctrl+Shift+Z">↷ 重做</button>
        </div>
        {materialId && <div className={`${styles.actionGroup} ${styles.authorOnly}`}><button onClick={() => void state.save()} disabled={state.saving || editorBusy || busy}>{state.saving ? '保存中…' : '立即保存'}</button>
          <details className={styles.moreMenu}><summary role="button" aria-haspopup="menu">更多 ▾</summary>
            <div role="menu">
              <button role="menuitem" onClick={() => void reinteractPage()} disabled={editorBusy || busy || state.saving || reinteracting}>{reinteracting?'提取中…':'重新提取本页交互'}</button>
              <button role="menuitem" onClick={() => void saveEdit()} disabled={editorBusy || busy || state.saving}>按原稿整份重转（较慢）</button>
              <button role="menuitem" onClick={() => editing ? setEditing(false) : void openEditor()} disabled={editorBusy || busy || state.saving} aria-pressed={editing}>
                {editing?'退出图片交互配置':'图片交互配置（旧版）'}</button>
              <Link role="menuitem" to={`/materials/${materialId}/prepare`}>转换详情</Link>
              <button role="menuitem" onClick={() => void exportProject()} disabled={editorBusy || busy || state.saving || editing}>导出工程包（.xsproj）</button>
              <button role="menuitem" onClick={() => void exportPptx()} disabled={editorBusy || busy || state.saving || editing}>导出 PPTX 课件（.pptx）</button>
            </div>
          </details>
        </div>}
        <div className={`${styles.actionGroup} ${styles.authorOnly}`}>
          {materialId && <><button onClick={()=>void download()} disabled={busy || state.saving || editorBusy || editing}>下载交互网页</button>
          <button onClick={() => void publish()} disabled={busy || editorBusy || editing || state.saving}>{busy ? '生成中…' : '生成分享网页'}</button></>}
          {extraActions}
        </div>
        {presenting && !active && <div className={styles.presentZoom}>
          <ZoomControl value={zoom} fitValue={fitScale} min={.25} max={4} step={.1} tone="dark" onChange={setZoom}/>
        </div>}
        {!active && !editing && <button type="button" aria-pressed={annotateTool !== 'off'}
          onClick={() => setAnnotateTool(t => t === 'off' ? 'pen' : 'off')} title="开启/关闭课堂板书批注">
          {annotateTool === 'off' ? '✏ 板书' : '✏ 板书中'}
        </button>}
        {scenePage && page?.image_url && <button type="button"
          onClick={()=>setOriginalPage(originalPage===page.page_no ? null : page.page_no)}>
          {originalPage===page.page_no ? '显示可操作图形' : '查看原图'}
        </button>}
        <button className={styles.primary} onClick={presenting ? exitPresentation : startPresentation}>
          {presenting ? '退出演示' : '▶ 开始演示'}</button>
      </div>
    </header>
    {(message || state.status) && <div className={styles.notice} role="status">{[message,state.status].filter(Boolean).join(' · ')}
      {state.loadFailed && <button className={styles.resolveConflict} disabled={state.saving}
        onClick={() => void state.reloadBaseline()}>重新载入基线并保存草稿</button>}
      {(state.conflict || state.loadFailed) && <button className={styles.resolveConflict} disabled={state.saving}
        onClick={() => void state.loadSaved()}>放弃本地修改并载入已保存参数</button>}</div>}
    {shareUrl && <div className={styles.shareNotice} role="status"><span>分享网页已生成</span>
      <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
      <button onClick={() => void navigator.clipboard?.writeText(shareUrl).then(() => setMessage('分享链接已复制')).catch(() => setMessage('可选中链接手动复制'))}>复制链接</button>
      <button onClick={() => setShareUrl('')} aria-label="关闭分享提示">×</button></div>}
    <div className={styles.workspace}>
      <ThumbnailRail pages={railPages} currentPageNo={page.page_no} affectedPages={affectedPages}
        badges={railBadges} interactivePages={interactivePages} collapsed={railCollapsed} onSelect={jumpToPage}/>
      <main className={styles.main}>
        {!active && <div className={styles.pageHeading}><span>第 {page.page_no} 页</span><h2>{(scenePage&&sceneTitle(scenePage))??page.title??title}</h2>
          {((materialId&&aiSnapshot?.learningEnabled!==false)||frozenLearningPage)&&<button type="button" className={styles.learningEntry} ref={learningEntryRef} onClick={()=>void openLearning()}
            aria-expanded={learningOpen} disabled={learningLoading}>
            {learningLoading?'正在准备…':'本页学习'} <span aria-hidden="true">↗</span>
          </button>}
          {materialId&&api.mode==='http'&&<button type="button" className={styles.learningEntry} onClick={()=>{setLabOpen(value=>!value);setLearningOpen(false);setActiveId(null);setAiActiveId(null);}}
            aria-expanded={labOpen}>AI 交互 <span aria-hidden="true">✦</span></button>}
          <span className={styles.pageTag}>{activeSpecs.length ? `${activeSpecs.length} 个可交互对象` : pausedSpecs.length ? `${pausedSpecs.length} 个交互待核对` : '原页阅读'}</span>
          {linkImpact.changes.filter(change => change.page === page.page_no).slice(0, 2).map((change, changeIndex) =>
            <span key={changeIndex} className={styles.impactBadge} title={`${change.title}：${change.label}`}>
              {change.label} {change.before} → {change.after}
            </span>)}
          <ZoomControl className={styles.headingZoom} value={zoom} fitValue={fitScale} min={.25} max={4} step={.1} onChange={setZoom}/></div>}
        {active && evaluation && !editing ? <ExperimentStage spec={active} evaluation={evaluation} values={values} renderValues={deferredValues} stale={valuesStale} visual={visual}
          pageNo={page.page_no} pageTitle={(scenePage&&sceneTitle(scenePage))??page.title} originalImageUrl={page.image_url?pageDisplayUrl(page.image_url,page.render_bytes):undefined}
          pageWidth={page.width} pageHeight={page.height} materialId={materialId}
          onTrustUpdated={refreshTrust}
          reducedMotion={reducedMotion} presenting={presenting} advancedOpen={advancedOpen}
          canUndo={state.canUndo} canRedo={state.canRedo} onUndo={state.undo} onRedo={state.redo}
          onChange={change} onClose={closeExperiment} onReset={resetExperiment} onAdvanced={toggleAdvanced}/> : <>
        <div className={styles.viewport} ref={setViewportNode} data-can-pan={canPan} data-panning={panning}
          onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}
          onClick={(event) => {
            if (!presenting || active) return;
            if (suppressPageClick.current) { suppressPageClick.current = false; return; }
            if ((event.target as Element).closest('button,a,input,select,textarea,[contenteditable="true"],[data-no-pan],[data-live-region]')) return;
            go(index + 1);
          }}>
          <div className={styles.canvasArea} style={{minWidth: slideWidth + 40, minHeight: slideHeight + 40}}>
          <div className={styles.slide} style={{width: slideWidth, height: slideHeight}} aria-label={`幻灯片第 ${page.page_no} 页`}>
            {scenePage && <div hidden={originalPage===page.page_no}>
              <ScenePageView key={scenePage.page_no+":"+presenting} page={scenePage} scale={scale} presentVectors/>
            </div>}
            {(!scenePage || originalPage===page.page_no) && (page.image_url && !imageFailed ? <img className={styles.pageImage} src={pageDisplayUrl(page.image_url,page.render_bytes)}
              alt={`第 ${page.page_no} 页原始 PPT`} onError={() => setImageFailed(true)} draggable={false}
              decoding="async" fetchPriority="high"/> :
              <div className={styles.fallback}>{page.elements?.map(element => element.text ?
                <span key={element.element_id} style={boxStyle(element.bbox, page)}>{element.text}</span> : null)}
                <p>本页为结构还原，可能与原版式有差异{imageFailed ? '（整页图加载失败）' : ''}</p></div>)}
            {learningHighlight && learningHighlight.page_no === page.page_no ? <span className={styles.learningHighlight}
              style={{left:`${learningHighlight.bbox.x*100}%`,top:`${learningHighlight.bbox.y*100}%`,
                width:`${learningHighlight.bbox.w*100}%`,height:`${learningHighlight.bbox.h*100}%`}}
              aria-hidden="true"/> : null}
            {!active && !editing && liveSpecs.length>0 && <LiveLayer specs={liveSpecs} plans={livePlans} values={state.values}
              deferred={deferredDeckValues} pageSize={livePageSize}
              pageImageUrl={!scenePage&&page.image_url?pageDisplayUrl(page.image_url,page.render_bytes):undefined}
              place={sourceStyle} disabled={busy||state.saving||editorBusy} reducedMotion={reducedMotion}
              flashKey={null} onChange={changeLive} onExpand={expandSpec}/>}
            {materialId && !active && !editing && !presenting && reviewElements.map(element =>
              <button key={element.element_id} type="button" className={styles.formulaReviewHotspot}
                style={sourceStyle(element.bbox, element.element_id)}
                onClick={() => setReviewId(element.element_id)}>公式待核对</button>)}
            {!active && !editing && <PresentationAnnotator pageNo={page.page_no} tool={annotateTool} color={annotateColor} clearNonce={annotateClearNonce}/>}
            {!active && !scenePage?.auto_vectors && activeSpecs.filter(spec=>!liveSpecIds.has(spec.object_id)).map(spec => {
              if(editing) return null;
              const sources = spec.anchor ? [{...spec.anchor,status:'original' as const,excerpt:spec.title??''}] : [...new Map(spec.parameters.filter(p => p.source.page === page.page_no && p.source.bbox)
                .map(p => [p.source.element_id, p.source])).values()];
              if (spec.views.some(v => v.type === 'text' && v.title === '原始公式')) {
                const formula = page.elements?.find(element => element.text?.split('\n').some(line => line.trim() === spec.title));
                if (formula && !sources.some(source => source.element_id === formula.element_id)) sources.push({
                  page: page.page_no, element_id: formula.element_id, bbox: formula.bbox,
                  status: 'original', excerpt: formula.text ?? ''});
              }
              return sources.map((source, i) => <button key={`${spec.object_id}-${i}`} className={styles.hotspot}
                data-live-region={`${spec.object_id}:hot${i}`} data-live-kind="hotspot" data-live-title={spec.title ?? '交互'}
                style={sourceStyle(source.bbox, source.element_id)} onClick={() => setActiveId(spec.object_id)}
                aria-label={`交互：${spec.title ?? '公式或图表'}`}><span>点击交互 ↗</span></button>);
            })}
            {!active && !editing && !scenePage?.auto_vectors && aiNodes.map(node => {
              const box=node.source.bbox;
              return <button key={node.node_id} className={styles.aiHotspot}
                style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.w*100}%`,height:`${box.h*100}%`}}
                onClick={()=>{setAiActiveId(node.node_id);setActiveId(null);}}
                aria-label={`AI 交互：${node.title}`}><span>AI · {node.title}</span></button>;
            })}
            {editing && (editablePage?.elements ?? page.elements ?? []).filter(element=>
              element.kind==='picture' &&
              !(element.kind==='picture' && element.bbox.w*element.bbox.h > (page.width??12192000)*(page.height??6858000)*.9))
              .sort((a,b)=>b.bbox.w*b.bbox.h-a.bbox.w*a.bbox.h).map(element=><button type="button" key={element.element_id}
                className={styles.editHotspot} data-selected={selected===element.element_id}
                style={sourceStyle(element.bbox,element.element_id)} aria-label={`编辑：${element.text?.slice(0,32) || element.name || element.kind}`}
                onClick={()=>setSelected(element.element_id)}><span>{element.kind==='picture'?'配置图示 / 公式':'编辑内容'}</span></button>)}
          </div>
          </div>
        </div>
        <div className={styles.objectStrip}>
          {editing?<span>点击公式或图示图片配置交互。文字、图片位置和排版可通过“自由编辑”即时调整。</span>:pageSpecs.length ? <><span>{liveMode&&liveSpecs.length?'本页交互 · 已原位，点击可展开实验页':'本页交互'}</span>
            {activeSpecs.map(spec => <button key={spec.object_id} aria-pressed={activeId === spec.object_id}
              onClick={() => setActiveId(activeId === spec.object_id ? null : spec.object_id)}>
              {spec.views.some(v => v.type === 'figure') ? '◇ ' : spec.kind === 'filter' ? '▥ ' : 'ƒ '}{spec.title ?? '打开交互'}
              {spec.trust ? <span className={styles.objectTrust}><TrustBadge trust={spec.trust} compact/></span> : null}</button>)}
            {pausedSpecs.map(spec => <button key={spec.object_id} className={styles.reviewChip} aria-pressed={activeId === spec.object_id}
              onClick={() => setActiveId(activeId === spec.object_id ? null : spec.object_id)}>⚠ 待核对 · {spec.title ?? '交互'}</button>)}</> :
            <span>本页保留原稿，可使用方向键或底部按钮翻页。</span>}
          {fidelity === 'low' && <span>结构还原 · 版式可能有差异</span>}
        </div>
        </>}
        {!active && !editing && annotateTool !== 'off' && <div className={styles.annotateDock} role="toolbar" aria-label="课堂板书工具条" data-no-pan>
          <button type="button" aria-pressed={annotateTool === 'pen'} onClick={() => setAnnotateTool('pen')} title="钢笔圈画">✏ 钢笔</button>
          <button type="button" aria-pressed={annotateTool === 'highlighter'} onClick={() => setAnnotateTool('highlighter')} title="荧光笔高亮">🖍 荧光笔</button>
          <button type="button" aria-pressed={annotateTool === 'laser'} onClick={() => setAnnotateTool('laser')} title="激光笔指示">🔴 激光</button>
          {annotateTool === 'pen' && <>
            <span className={styles.annotateDivider} aria-hidden="true" />
            {['#c4622d', '#2563eb', '#16233a'].map(c => (
              <button key={c} type="button" className={styles.colorDot} aria-label={`笔色 ${c}`}
                aria-pressed={annotateColor === c} onClick={() => setAnnotateColor(c)}
                style={{ background: c }} />
            ))}
          </>}
          <span className={styles.annotateDivider} aria-hidden="true" />
          <button type="button" aria-pressed={annotateTool === 'eraser'} onClick={() => setAnnotateTool(t => t === 'eraser' ? 'pen' : 'eraser')} title="橡皮擦">擦除</button>
          <button type="button" onClick={() => setAnnotateClearNonce(n => n + 1)} title="清空本页板书">清屏</button>
          <button type="button" onClick={() => setAnnotateTool('off')} title="退出板书">完成</button>
        </div>}
      </main>
      {!editing && linkPanelOpen && aiBundle && linkEvaluation && (
        <div className={styles.linkAside}>
          <LinkagePanel bundle={aiBundle} evaluation={linkEvaluation} values={liveValues} overrides={aiOverrides}
            onJump={jumpToPage} onValueChange={changeConcept} onOverride={toggleNodeOverride}
            onClose={() => setLinkPanelOpen(false)} />
        </div>
      )}
      {!editing && labOpen && materialId && <aside className={styles.learningAside} aria-label="本页 AI 交互面板">
        <PageLabPanel materialId={materialId} pageNo={page.page_no} onClose={()=>setLabOpen(false)}/>
      </aside>}
      {!editing && learningOpen && activeLearningPage && <aside className={styles.learningAside} aria-label="本页学习面板">
        <LearningPanel materialId={materialId??null} page={activeLearningPage}
          bundle={learningBundle??aiSnapshot?.bundle??null}
          pageImageUrl={page.image_url?pageDisplayUrl(page.image_url,page.render_bytes):undefined}
          readOnly={!materialId}
          onClose={closeLearning}
          onLocate={(source)=>setLearningHighlight(source)}
          onRefresh={materialId?refreshLearning:undefined}/>
      </aside>}
      {!editing && learningOpen && !activeLearningPage && <aside className={styles.learningAside} aria-label="本页学习面板">
        <div className={styles.learningPlaceholder} role="status">
          <b>本页学习</b>
          {learningError ? <p>{learningError}</p> : <p>{learningLoading?'正在加载本页学习内容…':'本页暂无学习内容；原稿继续可读。'}</p>}
          <button type="button" onClick={closeLearning}>关闭</button>
        </div>
      </aside>}
      {materialId && reviewElement && review && <FormulaReviewDialog key={reviewElement.element_id}
        imageUrl={apiBase() + '/api/v1/materials/' + encodeURIComponent(materialId) + '/editor/formulas/' + encodeURIComponent(reviewElement.element_id) + '/image'}
        draft={review.math_text} reason={review.reason} busy={editorBusy} message={message} onClose={() => setReviewId(null)}
        onConfirm={latex => void saveEdit({page: page.page_no, element_id: reviewElement.element_id, kind: 'recognition', text: latex})}/>}
      {editing && selectedElement && materialId && <ElementEditor key={selectedElement.element_id} element={selectedElement}
        materialId={materialId} page={page.page_no} specs={specs} busy={editorBusy} onSave={change=>void saveEdit(change)}
        onClose={()=>setSelected(null)}/>}
      {!editing && aiActiveNode && aiSnapshot?.bundle && <aside className={styles.inspector} aria-label="PPT AI 交互">
        <div className={styles.inspectorHead}><span>AI 交互 · {aiActiveNode.title}</span><button onClick={() => setAiActiveId(null)} aria-label="关闭 AI 交互">×</button></div>
        <div className={styles.inspectorBody}>
          {aiArtifact ? (
            <GeneratedViewFrame artifact={aiArtifact} input={aiGeneratedInput}
              bindings={aiActiveNode.parameters.map(parameter => parameter.concept_id)}
              fallback={<PptAiInteraction node={aiActiveNode} values={aiValues}
                derivedValues={linkEvaluation?.derivedValues} overrides={aiNodeOverrides}
                onChange={changeActiveNodeValue} compact />} />
          ) : (
            <PptAiInteraction node={aiActiveNode} values={aiValues}
              derivedValues={linkEvaluation?.derivedValues} overrides={aiNodeOverrides}
              onChange={changeActiveNodeValue} compact />
          )}
          {materialId ? <p style={{marginTop:10,fontSize:11}}><Link to={`/materials/${materialId}/ai`}>在 AI 工作台调参、实验与验收 ↗</Link></p> : null}
        </div>
      </aside>}
      {!editing && selectedSpec?.availability==='needs_review' && <aside className={styles.inspector} aria-label="交互待核对">
        <div className={styles.inspectorHead}><span>交互待核对</span><button onClick={() => setActiveId(null)} aria-label="关闭核对面板">×</button></div>
        <div className={styles.inspectorBody}><div className={styles.reviewBox}>
          <b>{selectedSpec.title ?? '当前交互'}</b>
          <p>{selectedSpec.availability_reason ?? '来源内容已修改，旧计算结果已停止显示。'}</p>
          <p>请选择处理方式；在核对之前不会继续显示按旧内容算出的结果。</p>
          <div className={styles.reviewActions}>
            {materialId&&<button onClick={() => void reinteractPage()} disabled={reinteracting||state.saving}>{reinteracting?'提取中…':'按当前内容重新提取'}</button>}
            {materialId&&<button onClick={() => void restoreSpecContent(selectedSpec)} disabled={state.saving}>撤销内容修改</button>}
            {materialId&&<Link to={`/materials/${materialId}/edit?page=${page?.page_no??1}`}>在自由编辑中处理</Link>}
          </div>
        </div></div>
      </aside>}
      {!editing && active && advancedOpen && !presenting && <aside className={styles.inspector} aria-label="完整参数与来源">
        <div className={styles.inspectorHead}><span>完整参数与来源</span><button onClick={() => setAdvancedOpen(false)} aria-label="关闭完整参数">×</button></div>
        <div className={styles.inspectorBody}><fieldset className={styles.inspectorFields} disabled={busy || state.saving || editorBusy}>
          {active.parameters.some(p => p.source.status === 'inferred') && <p className={styles.inferred}>
            {active.notes?.includes('占位') ? '含待确认的参数；原文未给出的数值以 0 占位，请先核对。' :
              '部分参数根据原文中的关系推导，请核对识别依据。'}</p>}
          <ISpecView spec={{...active, views: active.views.filter(v => v !== visual)}} values={values} onChange={change}
            figureRef={visual?.type === 'figure' ? visual.spec_ref : undefined}
            stage={2} reducedMotion={reducedMotion} presentation/>
          <button className={styles.reset} onClick={() => state.reset(active)}>恢复本实验基准</button>
          <ScenarioCompare identity={identity} spec={active} values={values} onRestore={snapshot=>state.restore(active,snapshot)}/>
          <details className={styles.evidence}><summary>查看原文依据与识别说明</summary>
            {[...new Map(active.parameters.map(p => [p.source.excerpt, p.source])).values()].map((source, i) =>
              <blockquote key={i}>第 {source.page} 页 · {source.status === 'inferred' ? '系统推断，请核对' : source.status==='confirmed'?'用户确认':source.status==='manual_demo'?'手工示例':'原文提取'}<p>{source.excerpt}</p></blockquote>)}
            <p>{active.notes}</p></details>
        </fieldset></div>
      </aside>}
    </div>
    <footer className={styles.footer}><span className={styles.keyboard}>{active ? '← → 单步 · 空格播放 · PageUp/PageDown 翻页 · Esc 返回原页' : presenting ? '单击 / 滚轮翻页 · 放大后拖动平移 · Ctrl+滚轮缩放 · Esc 退出演示' : '← → 翻页 · Home / End 首尾页 · 放大后拖动平移 · Esc 返回'}</span>
      <div className={styles.pager}><button onClick={() => go(0)} disabled={!index} aria-label="第一页">|‹</button>
        <button onClick={() => go(index-1)} disabled={!index}>上一页</button>
        <label><span className={styles.srOnly}>跳转到页码</span><select value={index} onChange={e => go(Number(e.target.value))}>
          {pages.map((p, i) => <option key={p.page_no} value={i}>{p.page_no}</option>)}</select><span> / {pages.length}</span></label>
        <button onClick={() => go(index+1)} disabled={index >= pages.length-1}>下一页</button>
        <button onClick={() => go(pages.length-1)} disabled={index >= pages.length-1} aria-label="最后一页">›|</button></div>
      <span className={styles.footerStatus}>{active ? '实验状态' : '阅读状态'}</span></footer>
  </div>;
}
