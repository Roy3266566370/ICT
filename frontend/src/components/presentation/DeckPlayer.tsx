import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage, requestBinary, requestDownload } from '@/api/client';
import type { SlideElement } from '@/api/types';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import type { ISpec } from '@/ispec/types';
import { useDeckValues } from './useDeckValues';
import styles from './DeckPlayer.module.css';
import {ScenePageView} from '@/components/editor/ScenePageView';
import type {SceneDocument,ScenePage} from '@/document/types';
import {getDocument,prepareDocumentPage} from '@/api/documents';
import {fitZoom,stepZoom,wheelZoom} from '@/components/ui/zoom';
import {defaultPresetsForTemplate, WORKSHOP_PRESET_PREVIEW_EVENT} from '@/canvas/pluginPresets';
import { PublishDialog } from '@/components/plaza/PublishDialog';
import type { ListingOptions } from '@/api/plazaTypes';
import {DeckPopover, DeckTopBar} from './DeckTopBar';
import {isInteractiveSlide} from './deckPresentation.ts';
import {LearningPanel} from '@/components/ppt-ai/learning/LearningPanel';
import {PageQuestionPanel} from '@/components/ppt-ai/learning/PageQuestionPanel';
import type {PptAiRuntimeSnapshot} from '@/ppt-ai/runtime/snapshot';
import type {LearningSourceRef} from '@/ppt-ai/learning/types';
import {learningPageFromFrozen} from '@/ppt-ai/learning/fromSnapshot';
import { pageDisplayUrl } from './pageUrls';
import { newPrefetchUrls, planPrefetch, prefetchAllowed } from './prefetch';
import { ThumbnailRail, type ThumbnailRailItem } from './ThumbnailRail';
import { PresentationAnnotator, type AnnotateTool } from './PresentationAnnotator';
import { PresenterDock } from './PresenterDock';
import { PresentationMenu, type PresentationScreen } from './PresentationMenu';
import { PresentationSyncContext, usePresentationSync } from './usePresentationSync';

export type DeckMode = 'edit' | 'preview' | 'present';
interface WorkbenchModes {mode: DeckMode; onChange: (mode: DeckMode) => void}

export function DeckModeSwitch({mode, onChange}: WorkbenchModes) {
  return <div className={styles.modeSwitch} role="group" aria-label="课件工作台模式">
    <button type="button" aria-pressed={mode === 'edit'} onClick={() => onChange('edit')}>编辑课件</button>
    <button type="button" aria-pressed={mode === 'preview'} onClick={() => onChange('preview')}>互动预览</button>
  </div>;
}

function sceneTitle(page:ScenePage):string|undefined{
  return [...page.nodes].filter(node=>node.type==='text'&&!node.deleted&&!node.hidden&&node.text.trim()&&
    !(node.interaction?.kind==='formula')&&!/^[A-Za-z]\s*=/.test(node.text.trim()))
    .sort((a,b)=>(b.style.font_size??0)-(a.style.font_size??0)||b.text.length-a.text.length)[0]?.text.trim().slice(0,80);
}

export interface DeckPage {
  page_no: number;
  title?: string | null;
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
  headerActionsHost?: HTMLDivElement | null;
  downloadBackup?: () => void;
  sceneDocument?:SceneDocument|null;
  learningEnabled?:boolean;
  aiSnapshot?:PptAiRuntimeSnapshot|null;
  formulaReviews?: Record<string, {page_no: number; math_text: string; reason: string}>;
  workbench?: WorkbenchModes;
  workbenchZoom?: {value: number | 'fit'; set: Dispatch<SetStateAction<number | 'fit'>>};
  inactive?: boolean;
  saveDocument?: () => Promise<boolean>;
  readDocumentRevision?: () => number;
  documentPending?: boolean;
  presenter?: string | null;
  onPlazaPublish?: () => void;
}

function boxStyle(bbox: {x: number; y: number; w: number; h: number}, page: DeckPage): CSSProperties {
  const width = page.width ?? 12192000;
  const height = page.height ?? 6858000;
  return { left: `${100*bbox.x/width}%`, top: `${100*bbox.y/height}%`,
    width: `${100*bbox.w/width}%`, height: `${100*bbox.h/height}%` };
}

/** 过滤 Pix2Text 对几何示意图误识别出的非公式噪声（如方框 \fbox、箭头 \downarrow、孤立标点/符号）。 */
function isDiagramNoiseFormula(mathText: string): boolean {
  const s = (mathText || '').trim();
  if (!s) return true;
  if (/\\fbox\b|\\(?:down|up|left|right)arrow\b|\\overbrace\b|\\underbrace\b|\\imath\b|\\jmath\b/.test(s)) return true;
  const hasFormulaStructure = /=|\\frac\b|\\int\b|\\begin\{(?:b|p|B|small)?(?:matrix|array)\}/.test(s);
  if (!hasFormulaStructure) return true;
  return false;
}

export function DeckPlayer({title, pages, specs, identity, materialId, headerActionsHost, downloadBackup, sceneDocument,aiSnapshot,learningEnabled,
  workbench,workbenchZoom,inactive,saveDocument,readDocumentRevision,documentPending,presenter,onPlazaPublish}: Props) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [search, setSearch] = useSearchParams();
  const requested = Number(search.get('page'));
  const index = Math.max(0, Math.min(pages.length - 1, pages.findIndex(p => p.page_no === requested)));
  const page = pages[index];
  const documentPage=sceneDocument?.pages.find(p=>p.page_no===page?.page_no);
  const scenePage=documentPage?.preparation?.status==='ready' && (documentPage.modified || !page?.image_url
    || isInteractiveSlide(documentPage.nodes)) ? documentPage : undefined;
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
  const [standalonePresentation, setPresenting] = useState(false);
  const presenting = workbench ? workbench.mode === 'present' : standalonePresentation;
  const [buildCursors,setBuildCursors]=useState<Record<number,number>>({});
  const builds=useMemo(()=>[...new Set((scenePage?.nodes??[])
    .filter(node=>!node.hidden&&!node.deleted&&!scenePage?.preparation?.frozen_ids?.includes(node.id))
    .map(node=>node.style.anim_step??0).filter(step=>step>0))].sort((a,b)=>a-b),[scenePage]);
  const buildCount=page?buildCursors[page.page_no]??0:0;
  useEffect(()=>{if(!presenting)setBuildCursors({});},[presenting]);
  const [presenterSession, setPresenterSession] = useState<string | null>(null);
  const presenterWindow = useRef<Window | null>(null);
  const sync = usePresentationSync(presenter ?? presenterSession);
  const [annotateTool, setAnnotateTool] = useState<AnnotateTool>('off');
  const [annotateColor, setAnnotateColor] = useState('#c4622d');
  const [annotateClearNonce, setAnnotateClearNonce] = useState(0);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const viewingOriginal = !presenting && originalPage === page?.page_no && Boolean(scenePage && page?.image_url);
  const pagePresets = useMemo(() => (scenePage?.nodes ?? []).flatMap(node => {
    const plugin = node.workshop_plugin;
    if (node.type !== 'workshop_plugin' || !plugin || node.hidden || node.deleted || node.locked || node.viewer_editable === false) return [];
    const presets = plugin.presets ?? defaultPresetsForTemplate(plugin.template_kind);
    return presets.length ? [{ node, presets }] : [];
  }), [scenePage]);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [localZoom, setLocalZoom] = useState<number | 'fit'>('fit');
  const [presentationZoom, setPresentationZoom] = useState<number | null>(null);
  const [presentationMenu, setPresentationMenu] = useState<{x: number; y: number} | null>(null);
  const [presentationTool, setPresentationTool] = useState<AnnotateTool>('off');
  const [presentationScreen, setPresentationScreen] = useState<PresentationScreen>(null);
  const zoom = workbenchZoom?.value ?? localZoom;
  const setZoom = workbenchZoom?.set ?? setLocalZoom;
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{x:number;y:number;left:number;top:number;moved:boolean} | null>(null);
  const suppressPageClick = useRef(false);
  const lastWheelAt = useRef(0);
  const shell = useRef<HTMLDivElement>(null);
  const [resetHost, setResetHost] = useState<HTMLDivElement | null>(null);
  const [lineControlsHost, setLineControlsHost] = useState<HTMLDivElement | null>(null);
  const slideElement = useRef<HTMLDivElement>(null);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [area, setArea] = useState({width: 900, height: 600});
  const reducedMotion = useReducedMotion();
  const state = useDeckValues(specs, identity, presenter ? undefined : materialId);
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
  const interactivePages = useMemo(() => {
    const scenes = new Map(sceneDocument?.pages.map(item => [item.page_no, item]));
    return new Set(pages.filter(item => {
      const scene = scenes.get(item.page_no);
      return isInteractiveSlide(scene?.preparation?.status === 'ready' ? scene.nodes : undefined);
    }).map(item => item.page_no));
  }, [pages, sceneDocument]);
  const railPages = useMemo<ThumbnailRailItem[]>(() => pages.map((item, ordinal) => {
    const edited = sceneDocument?.pages.find(p => p.page_no === item.page_no && (p.modified || !item.image_url) && p.preparation?.status === 'ready');
    const label = (edited && sceneTitle(edited)) || item.title || '';
    return {
      pageNo: item.page_no,
      label,
      imageUrl: item.image_url,
      bytes: typeof item.render_bytes === 'number' ? item.render_bytes : null,
      aspectRatio: edited ? `${edited.width}/${edited.height}` : `${item.width ?? 16}/${item.height ?? 9}`,
      scene: edited ?? null,
      master: sceneDocument?.theme ? {theme: sceneDocument.theme, index: ordinal + 1, total: pages.length} : undefined,
    };
  }), [pages, sceneDocument]);
  const [learningOpen,setLearningOpen]=useState(false);
  const learningEntryRef=useRef<HTMLButtonElement>(null);
  const closeLearning=useCallback(()=>{
    setLearningOpen(false);
    window.setTimeout(()=>learningEntryRef.current?.focus({preventScroll:true}),0);
  },[]);
  const [learningHighlight,setLearningHighlight]=useState<LearningSourceRef|null>(null);
  const frozenLearningPage=useMemo(()=>learningPageFromFrozen(aiSnapshot,page?.page_no??1),[aiSnapshot,page?.page_no]);
  const onlineLearning=Boolean(materialId && api.mode==='http' && (learningEnabled ?? aiSnapshot?.learningEnabled)!==false);
  // PPT 页宽是点值（约 12192000），展示缩放以场景页的像素宽为 100% 基准。
  const pageWidth = documentPage?.width ?? 960;
  const pageHeight = documentPage?.height ?? pageWidth * ((page?.height ?? 540) / (page?.width ?? 960));
  const gutter = presenting ? 0 : viewingOriginal ? 52 : 28;
  const fitScale = fitZoom(area, {width: pageWidth * (viewingOriginal ? 2 : 1), height: pageHeight}, gutter, .1, 4);
  const presentationFit = Math.max(.001, Math.min(area.width / pageWidth, area.height / pageHeight));
  const scale = presenting ? presentationZoom ?? presentationFit : zoom === 'fit' ? fitScale : zoom;
  const slideWidth = pageWidth * scale;
  const slideHeight = pageHeight * scale;
  const displayWidth = slideWidth * (viewingOriginal ? 2 : 1) + gutter;
  const canPan = displayWidth > area.width + 1 || slideHeight + gutter > area.height + 1;

  useLayoutEffect(() => {
    const node = viewportNode;
    if (!node) return;
    const measure = () => {
      const width = Math.floor(node.offsetWidth);
      const height = Math.floor(node.offsetHeight);
      if (width > 0 && height > 0) setArea(prev => prev.width === width && prev.height === height ? prev : {width, height});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [viewportNode]);
  useEffect(() => {
    const node = viewportNode;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      if (presentationMenu || presentationScreen) return;
      if (presenting) setPresentationZoom(current => wheelZoom(current ?? presentationFit, event.deltaY));
      else setZoom(current => wheelZoom(current === 'fit' ? fitScale : current, event.deltaY));
    };
    node.addEventListener('wheel', onWheel, {passive: false});
    return () => node.removeEventListener('wheel', onWheel);
  }, [fitScale, presentationFit, presentationMenu, presentationScreen, presenting, setZoom, viewportNode]);
  useEffect(() => { setImageFailed(false); setOriginalPage(null);
    setLearningOpen(false);setLearningHighlight(null); }, [materialId,page?.page_no]);

  const openLearning=()=>{
    if(!page)return;
    setLearningOpen(true);setLearningHighlight(null);
  };
  const flushDocument = useCallback(async () => {
    if (saveDocument && !await saveDocument()) throw new Error('课件修改尚未同步，请在编辑课件中检查保存状态');
  }, [saveDocument]);
  useEffect(() => {
    if (!materialId || busy || state.saving) return;
    if (!/未保存|仍有新修改/.test(state.status)) return;
    const timer = window.setTimeout(() => { void state.save(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [materialId, busy, state.saving, state.status, state.save, state.values]);
  const go = useCallback((next: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, next))];
    if (!target) return;
    setSearch(previous => {
      const query = new URLSearchParams(previous);
      query.set('page', String(target.page_no));
      return query;
    }, {replace: true});
    sync?.send({kind: 'page', pageNo: target.page_no});
  }, [pages, setSearch, sync]);
  const advance=useCallback((direction:-1|1)=>{
    if(presenting&&page&&((direction===1&&buildCount<builds.length)||(direction===-1&&buildCount>0))){
      setBuildCursors(current=>({...current,[page.page_no]:Math.max(0,Math.min(builds.length,
        (current[page.page_no]??0)+direction))}));
    }else go(index+direction);
  },[presenting,page,buildCount,builds.length,go,index]);
  useEffect(() => sync?.subscribe(message => {
    if (message.kind === 'hello' && !presenter && page) sync.send({kind: 'page', pageNo: page.page_no});
    if (message.kind !== 'page' || !pages.some(item => item.page_no === message.pageNo)) return;
    setSearch(previous => {
      const query = new URLSearchParams(previous);
      query.set('page', String(message.pageNo));
      return query;
    }, {replace: true});
  }), [page, pages, presenter, setSearch, sync]);
  useEffect(() => { if (presenter) sync?.send({kind: 'hello'}); }, [presenter, sync]);
  useEffect(() => {
    if (!presenterSession) return;
    const timer = window.setInterval(() => {
      if (presenterWindow.current?.closed) {
        presenterWindow.current = null;
        setPresenterSession(null);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [presenterSession]);
  useEffect(() => () => presenterWindow.current?.close(), []);
  const openPresenter = () => {
    if (!page || documentPending) return;
    if (presenterWindow.current && !presenterWindow.current.closed) {
      presenterWindow.current.focus();
      return;
    }
    if (typeof BroadcastChannel === 'undefined') {
      setMessage('当前浏览器不支持双屏同步');
      return;
    }
    const session = crypto.randomUUID();
    const url = new URL(window.location.href);
    url.searchParams.set('presenter', session);
    url.searchParams.set('page', String(page.page_no));
    url.searchParams.delete('mode');
    const popup = window.open(url, 'wanxiang-presenter-' + session, 'popup,width=1100,height=740');
    if (!popup) { setMessage('请允许打开演讲者控台弹窗'); return; }
    presenterWindow.current = popup;
    setPresenterSession(session);
    setMessage('');
  };
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
      if (!presenting || presentationMenu || presentationScreen || event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaY) < 8) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelAt.current < 420) return;
      lastWheelAt.current = now;
      advance(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheel, {passive: false});
    return () => node.removeEventListener('wheel', onWheel);
  }, [advance, presentationMenu, presentationScreen, presenting, viewportNode]);
  useEffect(() => {
    viewportNode?.scrollTo({left: 0, top: 0});
  }, [page?.page_no, presenting, viewportNode]);
  useEffect(() => {
    if (presenting) return;
    setPresentationZoom(null);
    setPresentationMenu(null);
    setPresentationTool('off');
    setPresentationScreen(null);
  }, [presenting]);
  const exitPresentation = useCallback(() => {
    if (workbench) { workbench.onChange('preview'); return; }
    setPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [workbench]);
  const startPresentation = useCallback(() => {
    if (workbench) { workbench.onChange('present'); return; }
    setPresenting(true);
    void shell.current?.requestFullscreen?.().catch(() => setMessage('已进入演示模式，可用浏览器全屏继续展示'));
  }, [workbench]);
  useEffect(() => {
    if (workbench || !presenting) return;
    const changed = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [workbench, presenting]);
  useEffect(() => {
    if (!presenting || inactive) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[data-workshop-fullscreen][open]')) return;
      if (presentationMenu) setPresentationMenu(null);
      else if (presentationScreen) setPresentationScreen(null);
      else exitPresentation();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [presenting, inactive, presentationMenu, presentationScreen, exitPresentation]);
  useEffect(() => {
    if (inactive) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (presenting || event.defaultPrevented) return;
        if (learningOpen) closeLearning();
        else if (annotateTool !== 'off') setAnnotateTool('off');
        return;
      }
      if (event.defaultPrevented || (event.target as Element)?.closest('input, textarea, select, math-field, [contenteditable="true"]')) return;
      if (presenting) {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          setPresentationMenu({x: window.innerWidth / 2, y: window.innerHeight / 2});
          return;
        }
        if (presentationMenu) return;
        if (!event.ctrlKey && !event.metaKey && !event.altKey && ['b', 'w'].includes(event.key.toLowerCase())) {
          const color = event.key.toLowerCase() === 'b' ? 'black' : 'white';
          setPresentationScreen(current => current === color ? null : color);
          return;
        }
        if (presentationScreen) {
          if ([' ', 'Enter', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
            event.preventDefault();
            setPresentationScreen(null);
          }
          return;
        }
      }
      if (!presenting && materialId && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!busy && !state.saving) {
          void flushDocument().then(() => state.save()).catch(error => setMessage(errorMessage(error)));
        }
        return;
      }
      if((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if(busy || state.saving) return;
        if(event.key.toLowerCase()==='y' || event.shiftKey) state.redo();else state.undo();
        return;
      }
      if((event.target as Element)?.closest('[data-no-pan]')) return;
      if (event.key === ' ' && (event.target as Element)?.closest('button, a')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault(); advance(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault(); advance(-1);
      } else if (event.key === 'Home') { event.preventDefault(); go(0); }
      else if (event.key === 'End') { event.preventDefault(); go(pages.length - 1); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [go, advance, pages.length, state.undo, state.redo,state.save,busy,state.saving,materialId,flushDocument,learningOpen,closeLearning,annotateTool,inactive,presentationMenu,presentationScreen,presenting]);
  useEffect(() => {
    if (workbench) return;
    const changed = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [workbench]);

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
  const [publishOpen, setPublishOpen] = useState(false);
  const publish = async (options?: ListingOptions) => {
    if (!materialId) return;
    setBusy(true); setMessage('');
    try {
      await flushDocument();
      if (!await state.save()) throw new Error('参数尚未保存，请处理保存提示后重试');
      await ensureEditedPagesReady();
      const result = await api.publishMaterial(materialId, options ? { plaza: options } : undefined);
      if (options) onPlazaPublish?.();
      setShareUrl(new URL(result.share_url, window.location.origin).href);
      setMessage('');
    } finally { setBusy(false); }
  };
  const exportPptx=async()=>{
    if(!materialId||busy)return;
    setBusy(true);setMessage('正在生成标准 PPTX 课件…');
    try{
      await flushDocument();
      const path = `/api/v1/materials/${encodeURIComponent(materialId)}/export-pptx`;
      const revision = readDocumentRevision?.() ?? sceneDocument?.revision;
      const frames = page && sceneDocument ? await import('./capturePptxFrames')
        .then(module => module.capturePptxFrames(sceneDocument.pages, slideElement.current, page.page_no)).catch(() => []) : [];
      const file = frames.length && revision !== undefined
        ? await requestBinary(path, {method: 'POST', body: JSON.stringify({revision, snapshots: frames})})
        : await requestBinary(path);
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
      await flushDocument();
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

  const jumpToPage = useCallback((pageNo: number) => {
    const target = pages.findIndex(item => item.page_no === pageNo);
    if (target >= 0) go(target);
  }, [pages, go]);

  if (!page) return <div className={styles.empty}>页面正在生成，请稍后重新载入。</div>;

  const interactive = interactivePages.has(page.page_no);
  const hasOriginal = Boolean(scenePage && page.image_url);
  const toggleOriginal = () => setOriginalPage(viewingOriginal ? null : page.page_no);
  const canLearn = onlineLearning || Boolean(frozenLearningPage);
  const canPresentDual = Boolean(workbench && !presenter);
  const actionRow = <div className={styles.previewActions}>
    {!presenter && canLearn && <button ref={learningEntryRef} type="button" onClick={learningOpen ? closeLearning : openLearning}
      aria-expanded={learningOpen}>本页学习</button>}
    <button type="button" aria-pressed={annotateTool !== 'off'}
      onClick={() => setAnnotateTool(tool => tool === 'off' ? 'pen' : 'off')}>✏ 板书</button>
    {((!presenter && materialId) || (!materialId && hasOriginal) || downloadBackup) && <DeckPopover
      label={<><span className={styles.exportLabel}>导出与分享</span><span className={styles.compactExportLabel}>导出</span> ▾</>}
      ariaLabel="导出与分享">
      {!presenter && materialId && <>
        <button type="button" onClick={() => void download()} disabled={busy || state.saving}>下载离线交互课件（.html，可播可导回）</button>
        <button type="button" onClick={() => setPublishOpen(true)} disabled={busy || state.saving}>生成在线分享</button>
        <button type="button" onClick={() => void exportPptx()} disabled={busy || state.saving}>导出 PPTX</button>
      </>}
      {downloadBackup && <button type="button" onClick={downloadBackup}>导出工程备份</button>}
      {!materialId && hasOriginal && <button type="button" aria-pressed={viewingOriginal} onClick={toggleOriginal}>查看原图对照</button>}
    </DeckPopover>}
    {!presenter && <div className={styles.presentGroup}>
      <button type="button" onClick={startPresentation} aria-label="演示">▶ 演示</button>
      {canPresentDual && <DeckPopover label="▾" ariaLabel="演示选项">
        <button type="button" onClick={openPresenter} disabled={documentPending}
          title={documentPending ? '课件同步后可打开控台' : undefined}>演讲者双屏视图</button>
      </DeckPopover>}
    </div>}
  </div>;
  const currentZoom = zoom === 'fit' ? fitScale : zoom;
  const visibleZoom = presenting ? scale : currentZoom;
  const minimumZoom = presenting ? Math.min(.25, presentationFit / 2) : .25;
  const maximumZoom = presenting ? Math.max(4, presentationFit * 2) : 4;
  const changeZoom = (direction: -1 | 1) => {
    if (presenting) {
      setPresentationZoom(current => {
        const value = current ?? presentationFit;
        return stepZoom(value, direction * value * .1, minimumZoom, maximumZoom);
      });
    } else {
      setZoom(current => stepZoom(current === 'fit' ? fitScale : current, direction * .1));
    }
  };
  const zoomControls = <div className={styles.capsuleGroup} role="group" aria-label="画布缩放">
    <button type="button" disabled={visibleZoom <= minimumZoom} onClick={() => changeZoom(-1)} aria-label="缩小画布">−</button>
    {presenting && <input type="range" aria-label="演示缩放比例" aria-valuetext={`${Math.round(visibleZoom * 100)}%`}
      min={minimumZoom} max={maximumZoom} step="any" value={visibleZoom}
      onChange={event => setPresentationZoom(event.currentTarget.valueAsNumber)}/>}
    <output aria-live="polite">{Math.round(visibleZoom * 100)}%</output>
    <button type="button" disabled={visibleZoom >= maximumZoom} onClick={() => changeZoom(1)} aria-label="放大画布">+</button>
    <button type="button" aria-pressed={presenting ? presentationZoom === null : zoom === 'fit'}
      onClick={() => presenting ? setPresentationZoom(null) : setZoom('fit')}>适应</button>
  </div>;
  const statusNotice = state.conflict || state.loadFailed || /失败/.test(state.status) ? state.status : '';

  return <PresentationSyncContext.Provider value={sync}><div ref={shell} className={styles.shell}
    data-presenting={presenting} data-presenter={!!presenter}>
    {!inactive && !presenting && (headerActionsHost === undefined
      ? <DeckTopBar title={title} home={materialId ? <a href="/" aria-label="返回首页">← 万象</a> : undefined}>{actionRow}</DeckTopBar>
      : headerActionsHost && createPortal(actionRow, headerActionsHost))}
    {(message || statusNotice) && <div className={styles.notice} role="status">{[message,statusNotice].filter(Boolean).join(' · ')}
      {state.loadFailed && <button className={styles.resolveConflict} disabled={state.saving}
        onClick={() => void state.reloadBaseline()}>重新载入基线并保存草稿</button>}
      {(state.conflict || state.loadFailed) && <button className={styles.resolveConflict} disabled={state.saving}
        onClick={() => void state.loadSaved()}>放弃本地修改并载入已保存参数</button>}</div>}
    {publishOpen && <PublishDialog onClose={() => setPublishOpen(false)} onPublish={publish} />}
    {shareUrl && <div className={styles.shareNotice} role="status"><span>分享网页已生成</span>
      <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
      <button onClick={() => void navigator.clipboard?.writeText(shareUrl).then(() => setMessage('分享链接已复制')).catch(() => setMessage('可选中链接手动复制'))}>复制链接</button>
      <button onClick={() => setShareUrl('')} aria-label="关闭分享提示">×</button></div>}
    <div className={styles.workspace}>
      <ThumbnailRail pages={railPages} currentPageNo={page.page_no} interactivePages={interactivePages} collapsed={railCollapsed} onCollapse={() => setRailCollapsed(true)} onSelect={jumpToPage}/>
      <main className={styles.main}>
        {!presenting && railCollapsed && <button type="button" className={styles.railExpand}
          aria-label="展开页导航" onClick={() => setRailCollapsed(false)}>▸</button>}
        <div className={styles.viewport} ref={setViewportNode} data-can-pan={canPan} data-panning={panning}
          onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}
          onContextMenuCapture={event => {
            if (!presenting) return;
            event.preventDefault();
            event.stopPropagation();
            setPresentationMenu({x: event.clientX, y: event.clientY});
          }}
          onClick={(event) => {
            if (!presenting) return;
            if (suppressPageClick.current) { suppressPageClick.current = false; return; }
            if ((event.target as Element).closest('button,a,input,select,textarea,[contenteditable="true"],[data-no-pan],[data-live-region]')) return;
            advance(1);
          }}>
          <div className={styles.canvasArea} data-comparing={viewingOriginal} style={{minWidth: displayWidth, minHeight: slideHeight + gutter}}>
          {viewingOriginal&&<figure className={styles.comparisonFigure}>
            <figcaption>原稿</figcaption>
            <div className={styles.slide} style={{width:slideWidth,height:slideHeight}}>
              {page.image_url&&!imageFailed?<img className={styles.pageImage} src={pageDisplayUrl(page.image_url,page.render_bytes)}
                alt={`第 ${page.page_no} 页原始 PPT`} decoding="async" draggable={false} onError={()=>setImageFailed(true)}/>:
                <p className={styles.fallback} role="status">原稿图暂时无法加载。</p>}
            </div>
          </figure>}
          <div className={styles.comparisonFigure}>
          {viewingOriginal&&<div className={styles.comparisonLabel}>互动稿</div>}
          <div key={page.page_no} ref={slideElement} className={styles.slide}
            data-transition={presenting&&!reducedMotion?scenePage?.transition?.kind:undefined}
            style={{width:slideWidth,height:slideHeight,animationDuration:`${scenePage?.transition?.duration_ms??320}ms`}}
            aria-label={`幻灯片第 ${index + 1} 页`}
            onDoubleClick={(event) => {
              if (!workbench || presenting || presenter || annotateTool !== 'off') return;
              if ((event.target as Element).closest('button,a,input,select,textarea,[contenteditable="true"],[data-no-pan],[data-live-region]')) return;
              workbench.onChange('edit');
            }}>
            {scenePage && (
              <ScenePageView key={scenePage.page_no} page={scenePage} scale={scale} presentVectors
                master={sceneDocument?.theme?{theme:sceneDocument.theme,index:index+1,total:pages.length}:undefined}
                buildStep={presenting?(builds[buildCount-1]??0):undefined}
                resetHost={resetHost} lineControlsHost={scenePage.auto_vectors&&!presenting?lineControlsHost:undefined}/>
            )}
            {!scenePage && (page.image_url && !imageFailed ? <img className={styles.pageImage} src={pageDisplayUrl(page.image_url,page.render_bytes)}
              alt={`第 ${page.page_no} 页原始 PPT`} onError={() => setImageFailed(true)} draggable={false}
              decoding="async" {...({ fetchpriority: 'high' } as Record<string, string>)}/> :
              <div className={styles.fallback}>{page.elements?.map(element => element.text ?
                <span key={element.element_id} style={boxStyle(element.bbox, page)}>{element.text}</span> : null)}
                <p>本页为结构还原，可能与原版式有差异{imageFailed ? '（整页图加载失败）' : ''}</p></div>)}
            {!presenting && learningHighlight && learningHighlight.page_no === page.page_no ? <span className={styles.learningHighlight}
              style={{left:`${learningHighlight.bbox.x*100}%`,top:`${learningHighlight.bbox.y*100}%`,
                width:`${learningHighlight.bbox.w*100}%`,height:`${learningHighlight.bbox.h*100}%`}}
              aria-hidden="true"/> : null}
            <PresentationAnnotator pageNo={page.page_no} tool={presenting ? presentationTool : annotateTool} color={annotateColor}
              clearNonce={annotateClearNonce} autoPen={(presenting || !!presenter) && !inactive}/>
          </div>
          </div>
          </div>
          {presenting && presentationScreen && <div data-no-pan className={styles.presentationBlank}
            style={{background: presentationScreen}} role="presentation"
            onClick={event => { event.stopPropagation(); setPresentationScreen(null); }}/>}
          {presenting && presentationMenu && <PresentationMenu point={presentationMenu} pages={railPages} index={index}
            tool={presentationTool} color={annotateColor} zoomed={presentationZoom !== null} screen={presentationScreen}
            onClose={() => setPresentationMenu(null)} onGo={go}
            onZoom={() => setPresentationZoom(current => current === null ? presentationFit * 1.5 : null)}
            onTool={setPresentationTool} onColor={setAnnotateColor} onScreen={setPresentationScreen}
            onClear={() => setAnnotateClearNonce(value => value + 1)}
            onPresenter={workbench && !presenter && !documentPending ? openPresenter : undefined} onEnd={exitPresentation}/>}
        </div>
        {!presenting&&scenePage?.auto_vectors&&<div ref={setLineControlsHost} className={styles.lineControlsHost}/>}
        {!presenting && (interactive || (materialId && hasOriginal)) && <div className={styles.interactionBar} role="group" aria-label="本页交互状态条">
          {pagePresets.length > 0 && <DeckPopover label="情景预设 ▾" ariaLabel="情景预设" above>
            {pagePresets.map(({node, presets}) => <div className={styles.presetGroup} key={node.id}>
              {pagePresets.length > 1 && <span>{node.workshop_plugin?.title || node.name}</span>}
              {presets.map(preset => <button key={preset.id} type="button" onClick={() =>
                window.dispatchEvent(new CustomEvent(WORKSHOP_PRESET_PREVIEW_EVENT, { detail: { nodeId: node.id, preset } }))
              }>{preset.label}</button>)}
            </div>)}
          </DeckPopover>}
          <div ref={setResetHost} className={styles.resetHost}/>
          {hasOriginal && <button type="button" aria-pressed={viewingOriginal} onClick={toggleOriginal}>原图对照</button>}
        </div>}
        {presenting && !inactive && !presentationScreen && !presentationMenu &&
          <div className={`${styles.stageCapsule} ${styles.presentationZoom}`}>{zoomControls}</div>}
        {!presenting && <div className={styles.stageCapsule} role="group" aria-label="翻页与缩放">
          <div className={styles.capsuleGroup}>
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="上一页">‹</button>
            <DeckPopover label={`${index + 1} / ${pages.length}`} ariaLabel={`跳转页码，第 ${index + 1} 页，共 ${pages.length} 页`} above>
              <label className={styles.pageJump}>跳转到页码
                <select value={index} onChange={event => {
                  go(Number(event.currentTarget.value));
                  const menu = event.currentTarget.closest('details');
                  if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
                }}>
                  {railPages.map((item, ordinal) => <option key={item.pageNo} value={ordinal}>{ordinal + 1} · {item.label || '幻灯片'}</option>)}
                </select>
              </label>
            </DeckPopover>
            <button type="button" onClick={() => go(index + 1)} disabled={index === pages.length - 1} aria-label="下一页">›</button>
          </div>
          {zoomControls}
          <DeckPopover label="?" ariaLabel="键盘快捷键" above>
            <dl className={styles.shortcutHelp}>
              <dt>← / →、↑ / ↓、Page Up / Down</dt><dd>翻页</dd>
              <dt>空格</dt><dd>下一页</dd>
              <dt>Home / End</dt><dd>首尾页</dd>
              <dt>Ctrl / ⌘ + 滚轮</dt><dd>缩放</dd>
              <dt>Ctrl / ⌘ + Z、Shift + Z 或 Y</dt><dd>撤销或重做参数修改</dd>
              {materialId && <><dt>Ctrl / ⌘ + S</dt><dd>保存</dd></>}
              <dt>Esc</dt><dd>关闭浮层或退出演示</dd>
              <dt>B / W（演示中）</dt><dd>黑屏或白屏</dd>
              <dt>右键 / Shift + F10（演示中）</dt><dd>演示控制</dd>
            </dl>
          </DeckPopover>
        </div>}
        {annotateTool !== 'off' && <div className={styles.annotateDock} role="toolbar" aria-label="课堂板书工具条" data-no-pan>
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
      {presenter && <PresenterDock notes={documentPage?.notes} next={pages[index + 1]}
        preview={railPages[index + 1]}/>}
      {learningOpen && onlineLearning && materialId && <aside className={styles.learningAside} aria-label="本页学习面板">
        <PageQuestionPanel key={`${materialId}:${page.page_no}`} materialId={materialId} pageNo={page.page_no} onClose={closeLearning}/>
      </aside>}
      {learningOpen && !onlineLearning && frozenLearningPage && <aside className={styles.learningAside} aria-label="本页学习面板">
        <LearningPanel materialId={null} page={frozenLearningPage}
          bundle={aiSnapshot?.bundle??null}
          pageImageUrl={page.image_url?pageDisplayUrl(page.image_url,page.render_bytes):undefined}
          readOnly
          onClose={closeLearning}
          onLocate={(source)=>setLearningHighlight(source)}/>
      </aside>}
    </div>
  </div></PresentationSyncContext.Provider>;
}
