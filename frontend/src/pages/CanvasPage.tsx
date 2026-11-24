/**
 * CanvasPage.tsx —— 万象工坊·画布（/canvas）
 *
 * 万象的主功能形态：一张自由画布，活对象可摆可连线，空白处可手写。
 * 持久化双轨：localStorage 兜底（离线不丢）+ 工坊后端（?work=wk_id 已存作品）。
 * 撤销/重做按编辑突发合并（400ms 内连续改动算一步）；发布后走 work-shares 快照。
 * 对象端口协议、多级求值（engine）、命名端口连线、动画源见 `canvas/` 目录。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { PALETTE_GROUPS, NODE_DEFS, defaultParams } from '@/canvas/nodes.tsx';
import { buildTemplateDoc } from '@/canvas/templateCatalog.ts';
import { defaultAiRuleParams, defaultAiRulePayload, serializeAiRulePayload } from '@/canvas/aiRuleBlock.ts';
import { instantiateCustomBlock, listCustomBlocks, removeCustomBlock, type CustomBlockRecord } from '@/canvas/customBlocks.ts';
import { applyAutoLayout } from '@/canvas/layout.ts';
import { nextId, clamp } from '@/canvas/math.ts';
import type { CanvasDoc, CanvasTool, InkStroke, NodeType } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import { extractInkFormula, type InkNodeType } from '@/api/labs';
import { generateAiRuleBlock } from '@/api/workshopAi';
import { errorMessage } from '@/api/client';
import { defaultManual408Text } from '@/labs/manual408';
import { compileExpression } from '@/labs/expr';
import { fitFreehandCurve, curveFamilyLabel, type CurveFitResult } from '@/labs/curveFit';
import styles from './CanvasPage.module.css';

interface InkReviewState {
  strokes: InkStroke[];
  latex: string;
  nodeType: InkNodeType;
  expression: string;
  matrix?: { a: number; b: number; c: number; d: number };
  note?: string;
}

interface FitReviewEntry {
  stroke: InkStroke;
  fit?: CurveFitResult;
  reason?: string;
}

interface FitReviewState {
  entries: FitReviewEntry[];
}

function InkThumbnail({ strokes }: { strokes: InkStroke[] }): JSX.Element | null {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const pad = Math.max(10, Math.max(maxX - minX, maxY - minY) * 0.08);
  return <svg
    className={styles.inkThumb}
    viewBox={`${minX - pad} ${minY - pad} ${Math.max(1, maxX - minX + pad * 2)} ${Math.max(1, maxY - minY + pad * 2)}`}
    role="img"
    aria-label="手写笔迹缩略图"
  >
    {strokes.map((stroke) => <path
      key={stroke.id}
      d={stroke.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]},${point[1]}`).join(' ')}
      fill="none"
      stroke="#2F3A49"
      strokeWidth={Math.max(1.4, stroke.width)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />)}
  </svg>;
}

/** 拟合对照：在归一化拟合空间叠画笔迹重采样（灰）与拟合曲线（蓝）。 */
function FitOverlay({ fit }: { fit: CurveFitResult }): JSX.Element {
  const ys = fit.samples.flatMap((sample) => [sample.drawn, sample.fitted]);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const sx = (x: number) => 10 + ((x - fit.domain[0]) / Math.max(1e-6, fit.domain[1] - fit.domain[0])) * 200;
  const sy = (v: number) => 110 - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * 100;
  const pathFor = (key: 'drawn' | 'fitted') => fit.samples.map((sample, index) => `${index === 0 ? 'M' : 'L'}${sx(sample.x).toFixed(1)},${sy(sample[key]).toFixed(1)}`).join(' ');
  return <svg className={styles.fitOverlay} viewBox="0 0 220 120" role="img" aria-label="手绘曲线与拟合曲线对照">
    <line x1="10" x2="210" y1={sy(0)} y2={sy(0)} stroke="#e2e8f0" strokeWidth="0.8" />
    <path d={pathFor('drawn')} fill="none" stroke="#94a3b8" strokeWidth="1.4" />
    <path d={pathFor('fitted')} fill="none" stroke="#4f46e5" strokeWidth="1.8" />
  </svg>;
}

const STORAGE_KEY = 'wanxiang.canvas.v1';
const DOCK_KEY = 'wanxiang.canvas.dockHidden.v1';
const HISTORY_MAX = 60;
const HISTORY_COALESCE_MS = 400;

/** 种子画布：上行 = 手动链（矩阵源→四视图+预测闸门+记录仪），中行 = 自动链（时间源→旋转器→向量场），下行 = 力学实验台。 */
function seedDoc(): CanvasDoc {
  const A = nextId('n');
  const T = nextId('n');
  const R = nextId('n');
  const P = nextId('n');
  return {
    version: 1,
    title: '我的工坊画布',
    zoom: 1,
    nodes: [
      { id: nextId('n'), type: 'textNote', x: 70, y: 40, params: {}, text: '上面是数学链：改矩阵源，六个连着的对象同变。\n中间是自动链：时间源推着旋转器跑。\n下面是力学实验台：抛体自己跑，轨迹仪和能量表跟着动。' },
      { id: A, type: 'matrixSource', x: 70, y: 240, params: { a: 1.6, b: 0.4, c: 0.2, d: 1.2 } },
      { id: 'view_transform', type: 'transformView', x: 400, y: 100, params: {} },
      { id: 'view_det', type: 'detGauge', x: 910, y: 100, params: {} },
      { id: 'view_eig', type: 'eigRead', x: 910, y: 340, params: {} },
      { id: 'view_sq', type: 'squareView', x: 1150, y: 110, params: {} },
      { id: 'view_quiz', type: 'quiz', x: 1150, y: 350, params: {} },
      { id: 'view_spark', type: 'spark', x: 1150, y: 600, params: {} },
      { id: T, type: 'ticker', x: 90, y: 640, params: { period: 6, running: 1 } },
      { id: R, type: 'rotor', x: 340, y: 640, params: { theta: 0 } },
      { id: 'view_field', type: 'fieldView', x: 590, y: 600, params: {} },
      { id: nextId('n'), type: 'textNote', x: 70, y: 920, params: {}, text: '力学实验台：抛体源闭式解驱动，轨迹仪记下运动，能量表看着动能⇌势能守恒。' },
      { id: P, type: 'projectile', x: 70, y: 1060, params: { v0: 8, angle: 55, g: 9.8, m: 1, running: 1 } },
      { id: 'phys_trail', type: 'trailView', x: 400, y: 1060, params: {} },
      { id: 'phys_energy', type: 'energyMeter', x: 660, y: 1060, params: {} },
    ],
    wires: [
      { id: nextId('w'), from: A, to: 'view_transform' },
      { id: nextId('w'), from: A, to: 'view_det' },
      { id: nextId('w'), from: A, to: 'view_eig' },
      { id: nextId('w'), from: A, to: 'view_sq' },
      { id: nextId('w'), from: A, to: 'view_quiz' },
      { id: nextId('w'), from: A, to: 'view_spark' },
      { id: nextId('w'), from: T, to: R },
      { id: nextId('w'), from: R, to: 'view_field' },
      { id: nextId('w'), from: P, to: 'phys_trail' },
      { id: nextId('w'), from: P, to: 'phys_energy' },
    ],
    strokes: [],
  };
}

/** 递归过滤未知节点类型 + 悬空线（含 composite 子图内部） */
function sanitizeNodes(nodes: CanvasDoc['nodes'], wires: CanvasDoc['wires']): CanvasDoc['nodes'] {
  return nodes.filter((n) => NODE_DEFS[n.type] !== undefined).map((n) => {
    if (!n.sub) return n;
    const inner = sanitizeNodes(n.sub.nodes, n.sub.wires);
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
}

function loadDoc(): CanvasDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as CanvasDoc;
    if (doc.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.wires)) return null;
    // 未知类型/端口结构的防御性过滤
    doc.nodes = sanitizeNodes(doc.nodes, doc.wires);
    const ids = new Set(doc.nodes.map((n) => n.id));
    doc.wires = doc.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
    return doc;
  } catch {
    return null;
  }
}

export function CanvasPage(): JSX.Element {
  const [params] = useSearchParams();
  const { state: navigationState } = useLocation();
  const navigate = useNavigate();
  const workIdParam = params.get('work');
  const templateParam = params.get('template');
  const [doc, setDocRaw] = useState<CanvasDoc>(() => {
    if (navigationState?.blank === true) {
      return { version: 1, title: '空白画布', zoom: 1, nodes: [], wires: [], strokes: [] };
    }
    if (templateParam) {
      try { return buildTemplateDoc(templateParam); } catch { /* fallback below */ }
    }
    return loadDoc() ?? seedDoc();
  });
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteCategory, setPaletteCategory] = useState('常用');
  const [deepPaletteGroup, setDeepPaletteGroup] = useState('输入');
  const deepPaletteGroups = ['输入', '算子', '训练与更新', '观察'];
  const [lastPaletteItem, setLastPaletteItem] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [customBlocks, setCustomBlocks] = useState<CustomBlockRecord[]>([]);
  useEffect(() => { if (paletteOpen) setCustomBlocks(listCustomBlocks()); }, [paletteOpen]);
  const [dockHidden, setDockHidden] = useState(() => {
    try { return localStorage.getItem(DOCK_KEY) === '1'; } catch { return false; }
  });
  const toggleDock = (hidden: boolean) => {
    setDockHidden(hidden);
    if (hidden) setPaletteOpen(false);
    try { localStorage.setItem(DOCK_KEY, hidden ? '1' : '0'); } catch { /* 隐私模式静默失败 */ }
  };
  const paletteButton = useRef<HTMLButtonElement>(null);
  const [activeMode, setMode] = useState<'instrument' | 'compose'>(() => doc.panel ? 'instrument' : 'compose');
  useEffect(() => { if (paletteOpen) paletteSearch.current?.focus(); }, [paletteOpen]);
  const closePalette = () => {
    setPaletteOpen(false);
    paletteButton.current?.focus();
  };
  const paletteSearch = useRef<HTMLInputElement>(null);
  const paletteCategories = ['常用', 'AI', '我的积木', '深度学习', '高数', '408', '办公', '基础积木', '物理', '文字'];
  const commonTypes: readonly NodeType[] = ['slider', 'matrixSource', 'functionSource', 'textNote',
    'dataset2dSource', 'linearOp', 'activationOp', 'matrixHeatmapView'];
  const query = paletteQuery.trim().toLowerCase();
  const visiblePaletteGroups = !query && paletteCategory === '常用' ? [{ label: '常用积木', types: commonTypes }]
    : PALETTE_GROUPS.filter(({ label }) => query || (paletteCategory === '深度学习'
      ? label === `深度学习 · ${deepPaletteGroup}` : paletteCategory === '基础积木'
        ? ['源', '变换', '视图', '学习'].includes(label) : paletteCategory === '高数'
          ? label.startsWith('高数') : paletteCategory === '物理'
            ? label.startsWith('大学物理') : paletteCategory === '办公'
              ? label.startsWith('办公') : paletteCategory === 'AI'
                ? label.startsWith('AI') : label === paletteCategory))
      .map((group) => ({ ...group, types: group.types.filter((type) =>
        `${group.label} ${NODE_DEFS[type].title} ${type}`.toLowerCase().includes(query)) }))
      .filter(({ types }) => types.length);
  const matchingCustomBlocks = query
    ? customBlocks.filter((block) => block.title.toLowerCase().includes(query))
    : paletteCategory === '我的积木' ? customBlocks : [];

  /* 工作台判定只看面板本身：任何学科只要预置了有效 panel（视图或外露参数），
     打开即进入左右停靠的仪器工作台；取消勾选「设为仪器面板」立即回到自由画布。 */
  const [tool, setTool] = useState<CanvasTool>('select');
  const [inkColor, setInkColor] = useState('#2F3A49');
  const [savedFlash, setSavedFlash] = useState(false);
  const [workId, setWorkId] = useState<string | null>(null);
  const [cloudState, setCloudState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [share, setShare] = useState<{ url: string; embedUrl?: string } | null>(null);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [inkReview, setInkReview] = useState<InkReviewState | null>(null);
  const [inkExpression, setInkExpression] = useState('');
  const [inkError, setInkError] = useState<string | null>(null);
  const [aiSketchOpen, setAiSketchOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const inkResolve = useRef<((ok: boolean) => void) | null>(null);
  const [fitReview, setFitReview] = useState<FitReviewState | null>(null);
  const [fitExpressions, setFitExpressions] = useState<string[]>([]);
  const [fitError, setFitError] = useState<string | null>(null);
  const fitResolve = useRef<((ok: boolean) => void) | null>(null);
  const [histInfo, setHistInfo] = useState({ undo: 0, redo: 0 });
  const spawn = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const cloudTimer = useRef<number | null>(null);
  const remote = useRef<{ id: string; revision: number; doc: CanvasDoc; pending: Promise<void> }>();
  const hist = useRef<{ past: CanvasDoc[]; future: CanvasDoc[]; lastPush: number }>({ past: [], future: [], lastPush: 0 });

  const docRef = useRef(doc);
  const writeDoc = useCallback((next: CanvasDoc) => {
    docRef.current = next;
    setDocRaw(next);
  }, []);

  /* 连续拖动合并到同一条历史记录，文档更新函数保持纯净。 */
  const setDoc = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    const previous = docRef.current;
    const next = typeof update === 'function' ? update(previous) : update;
    if (next === previous) return;
    const h = hist.current;
    const now = performance.now();
    if (!h.past.length || h.future.length || now - h.lastPush > HISTORY_COALESCE_MS) {
      h.past.push(previous);
      if (h.past.length > HISTORY_MAX) h.past.shift();
      h.future = [];
      setHistInfo({ undo: h.past.length, redo: 0 });
    }
    h.lastPush = now;
    writeDoc(next);
  }, [writeDoc]);

  const undo = useCallback(() => {
    const h = hist.current;
    const previous = h.past.pop();
    if (!previous) return;
    h.future.push(docRef.current);
    h.lastPush = -Infinity;
    setHistInfo({ undo: h.past.length, redo: h.future.length });
    writeDoc(previous);
  }, [writeDoc]);

  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.lastPush = -Infinity;
    setHistInfo({ undo: h.past.length, redo: h.future.length });
    writeDoc(next);
  }, [writeDoc]);

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,math-field,[contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo]);

  useEffect(() => () => {
    inkResolve.current?.(false);
    inkResolve.current = null;
  }, []);

  useEffect(() => {
    if (navigationState?.blank === true) navigate('/canvas', { replace: true, state: null });
  }, [navigationState, navigate]);

  /* 指定模板（?template=<kind>）：客户端直接构造，不向「我的作品」自动建档 */
  useEffect(() => {
    if (!templateParam || workIdParam) return;
    try {
      const next = buildTemplateDoc(templateParam);
      setWorkId(null);
      remote.current = undefined;
      hist.current = { past: [], future: [], lastPush: 0 };
      setHistInfo({ undo: 0, redo: 0 });
      setMode(next.panel ? 'instrument' : 'compose');
      writeDoc(next);
    } catch {
      /* 忽略未知模板名 */
    }
  }, [templateParam, workIdParam, writeDoc]);

  /* 指定作品（?work=wk_id / fork 后跳转）：从后端装载 */
  useEffect(() => {
    if (!workIdParam) return;
    let dead = false;
    worksApi.get(workIdParam).then((res) => {
      if (dead) return;
      const d = res.document;
      d.nodes = sanitizeNodes(d.nodes, d.wires);
      setWorkId(res.work_id);
      remote.current = { id: res.work_id, revision: res.revision, doc: d, pending: Promise.resolve() };
      hist.current = { past: [], future: [], lastPush: 0 };
      setMode(d.panel ? 'instrument' : 'compose');
      setHistInfo({ undo: 0, redo: 0 });
      setCloudState('saved');
      writeDoc(d);
    }).catch(() => {
      if (!dead) window.alert('工坊作品加载失败（可能已删除或不属于你），已保留本地画布。');
    });
    return () => { dead = true; };
  }, [workIdParam, writeDoc]);

  /* 防抖持久化：localStorage 永远兜底 */
  useEffect(() => {
    setSavedFlash(false);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        setSavedFlash(true);
      } catch {
        /* 存储满/隐私模式下静默失败 */
      }
    }, 450);
    return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); };
  }, [doc]);

  const saveExisting = useCallback((id: string, snapshot: CanvasDoc): Promise<void> => {
    const record = remote.current;
    if (!record || record.id !== id) return Promise.reject(new Error('作品尚未载入'));
    const save = record.pending.catch(() => {}).then(async () => {
      if (record.doc === snapshot) return;
      const saved = await worksApi.save(id, record.revision, snapshot, snapshot.title);
      record.revision = saved.revision;
      record.doc = snapshot;
    });
    record.pending = save;
    return save;
  }, []);

  /* 云端同步：作品已建档后，改动静默回写（乐观锁；冲突只提示不覆盖） */
  useEffect(() => {
    if (!workId || remote.current?.doc === doc) return;
    if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current);
    cloudTimer.current = window.setTimeout(() => {
      setCloudState('saving');
      saveExisting(workId, doc)
        .then(() => setCloudState('saved'))
        .catch(() => setCloudState('error'));
    }, 800);
    return () => { if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current); };
  }, [doc, saveExisting, workId]);

  const addNode = useCallback((type: NodeType, x?: number, y?: number) => {
    spawn.current += 1;
    const offset = spawn.current * 34;
    setDoc((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id: nextId('n'), type,
          x: x ?? 110 + offset, y: y ?? 120 + offset,
          params: defaultParams(type),
          ...(type === 'textNote' ? { text: '' } : {}),
          ...(type === 'functionSource' ? { text: 'a*x^2+b*x+c' } : {}),
          ...(type === 'lab408Workbench' ? { text: defaultManual408Text() } : {}),
          ...(type === 'aiRuleBlock' ? { payload: serializeAiRulePayload(defaultAiRulePayload()) } : {}),
        },
      ],
    }));
  }, [setDoc]);

  const clearInk = useCallback(() => {
    setDoc((d) => ({ ...d, strokes: [] }));
  }, [setDoc]);

  const buildAiSketch = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiError('请先描述要搭建的实验。');
      return;
    }
    if (doc.nodes.length > 0 && !window.confirm('AI 搭积木会替换当前画布内容（可用撤销恢复），继续吗？')) return;
    setAiBusy(true);
    setAiError('');
    try {
      const payload = await generateAiRuleBlock({ prompt });
      const noteId = nextId('n');
      const blockId = nextId('n');
      const viewId = nextId('n');
      const nodes = [
        { id: noteId, type: 'textNote' as const, x: 60, y: 40, params: {}, text: `AI 搭积木草图\n${payload.title}\n${payload.summary}` },
        { id: blockId, type: 'aiRuleBlock' as const, x: 60, y: 220, params: defaultAiRuleParams(payload), payload: serializeAiRulePayload(payload) },
        { id: viewId, type: 'universalStageView' as const, x: 520, y: 220, params: {} },
      ];
      const wires = [{ id: nextId('w'), from: blockId, fromPort: 'out', to: viewId, toPort: 'in' }];
      const next: CanvasDoc = {
        version: 1,
        title: payload.title,
        zoom: 0.9,
        nodes: applyAutoLayout(nodes, wires),
        wires,
        strokes: [],
        panel: {
          title: payload.title,
          view_node_ids: [viewId],
          exposed_params: payload.controls.filter((control) => !control.options).flatMap((control) => [
            { node_id: blockId, param_key: control.key, label: control.label,
              ...(control.min === undefined ? {} : { min: control.min }),
              ...(control.max === undefined ? {} : { max: control.max }),
              ...(control.step === undefined ? {} : { step: control.step }) },
          ]),
        },
      };
      setWorkId(null);
      remote.current = undefined;
      setShare(null);
      setCloudState('idle');
      setMode('instrument');
      setDoc(next);
      setAiSketchOpen(false);
      setAiPrompt('');
      setAiError('');
      navigate('/canvas', { replace: true });
    } catch (cause) {
      setAiError(errorMessage(cause));
    } finally {
      setAiBusy(false);
    }
  }, [aiPrompt, doc.nodes.length, navigate, setDoc]);

  const newCanvas = useCallback(() => {
    if (!window.confirm('新建空白画布？这会替换当前本地草稿。')) return;
    spawn.current = 0;
    setWorkId(null);
    setShare(null);
    hist.current = { past: [], future: [], lastPush: 0 };
    remote.current = undefined;
    setHistInfo({ undo: 0, redo: 0 });
    setMode('compose');
    setCloudState('idle');
    setPaletteOpen(false);
    writeDoc({ version: 1, title: '空白画布', nodes: [], wires: [], strokes: [], zoom: 1 });
    navigate('/canvas', { replace: true });
  }, [navigate, writeDoc]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title || 'wanxiang-canvas'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  /* 保存到工坊：未建档 → create；已建档 → 立即 PATCH 一次 */
  const saveToWorkshop = useCallback(async () => {
    try {
      setCloudState('saving');
      if (!workId) {
        const res = await worksApi.create(doc);
        remote.current = { id: res.work_id, revision: res.revision, doc, pending: Promise.resolve() };
        setWorkId(res.work_id);
      } else {
        if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current);
        await saveExisting(workId, doc);
      }
      setCloudState('saved');
    } catch {
      setCloudState('error');
      window.alert('保存到工坊失败：请确认后端已启动（画布仍保存在本地）。');
    }
  }, [doc, saveExisting, workId]);

  /* 发布：先确保已建档，再生成快照分享链接 */
  const publish = useCallback(async () => {
    try {
      let wid = workId;
      if (!wid) {
        const res = await worksApi.create(doc);
        wid = res.work_id;
        remote.current = { id: wid, revision: res.revision, doc, pending: Promise.resolve() };
        setWorkId(wid);
      } else {
        if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current);
        await saveExisting(wid, doc);
        setCloudState('saved');
      }
      const pub = await worksApi.publish(wid);
      const url = `${window.location.origin}${pub.share_url}`;
      const embedUrl = doc.panel ? new URL(url) : undefined;
      embedUrl?.searchParams.set('embed', '1');
      setShare({ url, embedUrl: embedUrl?.href });
      setEmbedCopied(false);
      try { await navigator.clipboard.writeText(url); } catch { /* 剪贴板不可用时展示链接即可 */ }
    } catch {
      window.alert('发布失败：请确认后端已启动。');
    }
  }, [doc, saveExisting, workId]);

  const recognizeInk = useCallback(async (strokes: InkStroke[]): Promise<boolean> => {
    try {
      const result = await extractInkFormula({
        strokes: strokes.map((stroke) => ({ points: stroke.points, width: stroke.width })),
      });
      if (!result.supported || !result.latex) {
        window.alert(result.reason || '没有从选中的笔迹中识别出公式。');
        return false;
      }
      inkResolve.current?.(false);
      const nodeType: InkNodeType = result.node_type ?? (result.expression ? 'functionSource' : 'latexNote');
      setInkReview({
        strokes,
        latex: result.latex,
        nodeType,
        expression: result.expression ?? '',
        matrix: result.matrix ?? undefined,
        note: result.note,
      });
      setInkExpression(result.expression ?? '');
      setInkError(null);
      return await new Promise<boolean>((resolve) => { inkResolve.current = resolve; });
    } catch (cause) {
      window.alert(`识别失败：${errorMessage(cause)}`);
      return false;
    }
  }, []);

  const cancelInkReview = useCallback(() => {
    setInkReview(null);
    setInkError(null);
    inkResolve.current?.(false);
    inkResolve.current = null;
  }, []);

  const materializeInk = useCallback(() => {
    if (!inkReview) return;
    const expression = inkExpression.trim();
    if (inkReview.nodeType === 'functionSource') {
      if (!expression) {
        setInkError('函数表达式不能为空。');
        return;
      }
      try {
        compileExpression(expression, ['x', 'a', 'b', 'c']);
      } catch (cause) {
        setInkError(`表达式无法解析：${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
    }
    const points = inkReview.strokes.flatMap((stroke) => stroke.points);
    const x = clamp(Math.min(...points.map((point) => point[0])), 20, 1300);
    const y = clamp(Math.max(...points.map((point) => point[1])) + 30, 20, 960);
    const ids = new Set(inkReview.strokes.map((stroke) => stroke.id));
    const matrix = inkReview.matrix;
    const nodeType = inkReview.nodeType === 'matrixSource' && !matrix ? 'latexNote' : inkReview.nodeType;
    setDoc((previous) => {
      const nodes = [...previous.nodes];
      const wires = [...previous.wires];
      nodes.push({ id: nextId('n'), type: 'latexNote', x, y, params: {}, text: inkReview.latex });
      if (nodeType === 'functionSource') {
        const sourceId = nextId('n');
        nodes.push({ id: sourceId, type: 'functionSource', x, y: y + 170, params: { a: 1, b: 0, c: 0 }, text: expression });
        const plotId = nextId('n');
        nodes.push({ id: plotId, type: 'functionPlot', x: x + 320, y: y + 170, params: { min: -5, max: 5, x: 0 } });
        wires.push({ id: nextId('w'), from: sourceId, to: plotId });
      } else if (nodeType === 'matrixSource' && matrix) {
        const sourceId = nextId('n');
        nodes.push({ id: sourceId, type: 'matrixSource', x, y: y + 170, params: { ...matrix } });
        const views: { type: NodeType; x: number; y: number }[] = [
          { type: 'transformView', x: x + 280, y: y + 170 },
          { type: 'detGauge', x: x + 720, y: y + 170 },
          { type: 'eigRead', x: x + 720, y: y + 420 },
          { type: 'squareView', x: x + 280, y: y + 420 },
        ];
        for (const view of views) {
          const id = nextId('n');
          nodes.push({ id, type: view.type, x: view.x, y: view.y, params: {} });
          wires.push({ id: nextId('w'), from: sourceId, to: id });
        }
      }
      return { ...previous, nodes, wires, strokes: previous.strokes.filter((stroke) => !ids.has(stroke.id)) };
    });
    setInkReview(null);
    setInkError(null);
    inkResolve.current?.(true);
    inkResolve.current = null;
  }, [inkExpression, inkReview, setDoc]);

  /** 手绘曲线 → 表达式：纯前端最小二乘拟合，不发请求、不调模型；失败的笔迹保留并说明原因。 */
  const recognizeCurves = useCallback(async (strokes: InkStroke[]): Promise<boolean> => {
    const entries = strokes.map((stroke) => {
      const outcome = fitFreehandCurve({ points: stroke.points });
      return outcome.fit ? { stroke, fit: outcome.fit } : { stroke, reason: outcome.reason ?? '无法拟合为表达式。' };
    });
    if (!entries.some((entry) => entry.fit)) {
      window.alert(entries.map((entry) => entry.reason).filter(Boolean).join('\n') || '没有可拟合的曲线。');
      return false;
    }
    fitResolve.current?.(false);
    setFitReview({ entries });
    setFitExpressions(entries.map((entry) => entry.fit?.source ?? ''));
    setFitError(null);
    return await new Promise<boolean>((resolve) => { fitResolve.current = resolve; });
  }, []);

  const cancelFitReview = useCallback(() => {
    setFitReview(null);
    setFitError(null);
    fitResolve.current?.(false);
    fitResolve.current = null;
  }, []);

  const materializeFit = useCallback(() => {
    if (!fitReview) return;
    const accepted = fitReview.entries.map((entry, index) => ({
      entry,
      expression: (fitExpressions[index] ?? '').trim(),
    })).filter((item) => item.entry.fit && item.expression);
    if (!accepted.length) {
      setFitError('没有可采纳的拟合结果。');
      return;
    }
    for (const { expression } of accepted) {
      try {
        compileExpression(expression, ['x']);
      } catch (cause) {
        setFitError(`表达式「${expression}」无法解析：${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
    }
    const consumed = new Set(accepted.map((item) => item.entry.stroke.id));
    setDoc((previous) => {
      const nodes = [...previous.nodes];
      const wires = [...previous.wires];
      let row = 0;
      for (const { entry, expression } of accepted) {
        const pts = entry.stroke.points;
        const x = clamp(Math.min(...pts.map((p) => p[0])), 20, 2000);
        const y = clamp(Math.max(...pts.map((p) => p[1])) + 40 + row * 230, 20, 1200);
        row += 1;
        const sourceId = nextId('n');
        nodes.push({ id: sourceId, type: 'functionSource', x, y, params: { a: 1, b: 0, c: 0 }, text: expression });
        const plotId = nextId('n');
        const [d0, d1] = entry.fit!.domain;
        nodes.push({ id: plotId, type: 'functionPlot', x: x + 320, y, params: { min: d0, max: d1, x: 0 } });
        wires.push({ id: nextId('w'), from: sourceId, to: plotId });
      }
      return { ...previous, nodes, wires, strokes: previous.strokes.filter((stroke) => !consumed.has(stroke.id)) };
    });
    setFitReview(null);
    setFitError(null);
    fitResolve.current?.(true);
    fitResolve.current = null;
  }, [fitExpressions, fitReview, setDoc]);

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <Link className={styles.backLink} to="/workshop">← 工坊目录</Link>
          <input className={styles.title} value={doc.title} spellCheck={false} aria-label="画布标题"
            onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))} />
          <span role="status" className={styles.savepill} data-state={cloudState === 'error' ? 'error' : savedFlash && cloudState !== 'saving' ? 'saved' : 'busy'}>
            {cloudState === 'error' ? '同步失败' : !savedFlash || cloudState === 'saving' ? '同步中' : '已保存'}
          </span>
        </div>
        <div className={styles.modes} role="group" aria-label="画布模式">
          <button type="button" aria-pressed={activeMode === 'instrument'} onClick={() => { setMode('instrument'); setPaletteOpen(false); }}><span aria-hidden="true">◉ </span>交互仪器态</button>
          <button type="button" aria-pressed={activeMode === 'compose'} onClick={() => setMode('compose')}><span aria-hidden="true">▦ </span>积木编排态</button>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.tbtn} disabled={!histInfo.undo} aria-label="撤销" title="撤销 (Ctrl+Z)" onClick={undo}>↶</button>
          <button type="button" className={styles.tbtn} disabled={!histInfo.redo} aria-label="重做" title="重做 (Ctrl+Shift+Z)" onClick={redo}>↷</button>
          <button type="button" className={styles.tbtn} onClick={() => { setAiError(''); setAiSketchOpen(true); }}>AI 搭积木草图</button>
          <button type="button" className={styles.tbtn} disabled={cloudState === 'saving'} onClick={() => void saveToWorkshop()}>保存到工坊</button>
          <button type="button" className={styles.tbtn + ' ' + styles.primary} onClick={() => void publish()}>发布 / 嵌入活页</button>
          <details className={styles.menu}>
            <summary className={styles.tbtn} aria-label="更多操作">···</summary>
            <div className={styles.menuItems} onClick={(e) => { if ((e.target as HTMLElement).closest('button')) e.currentTarget.closest('details')?.removeAttribute('open'); }}>
              <button type="button" onClick={exportJson}>导出 JSON</button>
              <button type="button" onClick={newCanvas}>新建空白画布</button>
              <button type="button" onClick={() => {
                if (!window.confirm('恢复默认内容？可用撤销恢复当前编辑。')) return;
                setDoc(templateParam ? buildTemplateDoc(templateParam) : remote.current?.doc ?? seedDoc());
              }}>恢复默认</button>
            </div>
          </details>
        </div>
      </header>

      {share && (
        <div className={styles.sharebar} role="status">
          画布已发布
          <a href={share.url} target="_blank" rel="noreferrer">打开分享</a>
          {share.embedUrl && <>
            <a href={share.embedUrl} target="_blank" rel="noreferrer">预览嵌入</a>
            <button type="button" className={styles.tbtn} onClick={async () => {
              const markup = '<iframe title="万象工坊交互仪器" src="' + share.embedUrl + '" width="100%" height="720" loading="lazy"></iframe>';
              try { await navigator.clipboard.writeText(markup); setEmbedCopied(true); }
              catch { window.prompt('复制嵌入代码', markup); }
            }}>{embedCopied ? '嵌入代码已复制' : '复制嵌入代码'}</button>
          </>}
          <button type="button" className={styles.tbtn} onClick={() => setShare(null)}>关闭</button>
        </div>
      )}

      {aiSketchOpen ? (
        <div className={styles.inkReview} role="dialog" aria-modal="true" aria-label="AI 搭积木草图">
          <div className={styles.inkReviewCard}>
            <h3>AI 搭积木草图</h3>
            <p className={styles.fitHint}>用一句话描述课堂要展示的实验。AI 会生成一个智能计算方块和通用舞台，并自动摆放、连线；生成后仍可自由修改。</p>
            <textarea className={styles.aiPrompt} rows={4} value={aiPrompt} spellCheck={false}
              aria-label="AI 搭积木主题" placeholder="例如：演示电梯磁盘调度 SCAN 的磁头轨迹，并对比 FCFS"
              onChange={(event) => { setAiPrompt(event.currentTarget.value); setAiError(''); }} />
            {aiError ? <p className={styles.inkReviewError} role="alert">{aiError}</p> : null}
            <div className={styles.inkReviewActions}>
              <button type="button" className={styles.tbtn} disabled={aiBusy} onClick={() => setAiSketchOpen(false)}>取消</button>
              <button type="button" className={`${styles.tbtn} ${styles.primary}`} disabled={aiBusy || !aiPrompt.trim()}
                onClick={() => void buildAiSketch()}>{aiBusy ? 'AI 正在搭积木…' : '生成草图'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {inkReview ? (
        <div className={styles.inkReview} role="dialog" aria-modal="true" aria-label="核对手写识别结果">
          <div className={styles.inkReviewCard}>
            <h3>核对手写识别结果</h3>
            <div className={styles.inkReviewBody}>
              <InkThumbnail strokes={inkReview.strokes} />
              <div className={styles.inkReviewMeta}>
                <span>识别 LaTeX</span>
                <code>{inkReview.latex}</code>
                {inkReview.nodeType === 'functionSource' ? (
                  <label>函数表达式 f(x)
                    <input
                      value={inkExpression}
                      spellCheck={false}
                      onChange={(event) => { setInkExpression(event.target.value); setInkError(null); }}
                      aria-label="识别出的函数表达式"
                    />
                  </label>
                ) : inkReview.nodeType === 'matrixSource' && inkReview.matrix ? (
                  <span>矩阵源：[[{inkReview.matrix.a}, {inkReview.matrix.b}], [{inkReview.matrix.c}, {inkReview.matrix.d}]]</span>
                ) : (
                  <span>复杂公式将创建为公式卡（latexNote），不会自动转成函数源。</span>
                )}
                {inkReview.note ? <small>{inkReview.note}</small> : null}
                {inkError ? <p className={styles.inkReviewError} role="alert">{inkError}</p> : null}
              </div>
            </div>
            <div className={styles.inkReviewActions}>
              <button type="button" className={styles.tbtn} onClick={cancelInkReview}>取消（保留笔迹）</button>
              <button type="button" className={`${styles.tbtn} ${styles.primary}`} onClick={materializeInk}>生成积木</button>
            </div>
          </div>
        </div>
      ) : null}

      {fitReview ? (
        <div className={styles.inkReview} role="dialog" aria-modal="true" aria-label="核对曲线拟合结果">
          <div className={styles.inkReviewCard}>
            <h3>核对曲线拟合结果</h3>
            <p className={styles.fitHint}>纯本地最小二乘拟合，不识别笔迹内容；笔迹纵向中心对齐 y=0，拟合域归一到 [-4,4]。</p>
            {fitReview.entries.map((entry, index) => (
              <div key={entry.stroke.id} className={styles.inkReviewBody}>
                <InkThumbnail strokes={[entry.stroke]} />
                <div className={styles.inkReviewMeta}>
                  {entry.fit ? (
                    <>
                      <span>{curveFamilyLabel(entry.fit.family)} · RMSE {(entry.fit.rmse * 100).toFixed(1)}% · 峰值误差 {(entry.fit.maxError * 100).toFixed(1)}%</span>
                      <FitOverlay fit={entry.fit} />
                      <label>函数表达式 f(x)
                        <input
                          value={fitExpressions[index] ?? ''}
                          spellCheck={false}
                          onChange={(event) => {
                            setFitExpressions((previous) => previous.map((value, i) => (i === index ? event.target.value : value)));
                            setFitError(null);
                          }}
                          aria-label={`第 ${index + 1} 条曲线的拟合表达式`}
                        />
                      </label>
                    </>
                  ) : (
                    <span className={styles.inkReviewError}>{entry.reason}</span>
                  )}
                </div>
              </div>
            ))}
            {fitError ? <p className={styles.inkReviewError} role="alert">{fitError}</p> : null}
            <div className={styles.inkReviewActions}>
              <button type="button" className={styles.tbtn} onClick={cancelFitReview}>取消（保留笔迹）</button>
              <button type="button" className={`${styles.tbtn} ${styles.primary}`} onClick={materializeFit}>生成函数积木</button>
            </div>
          </div>
        </div>
      ) : null}

      <CanvasBoard workId={workId} doc={doc} setDoc={setDoc} tool={tool} inkColor={inkColor}
        onAddNode={addNode} onInkExtract={recognizeInk} onInkFit={recognizeCurves}
        onAddCustomBlock={(blockId, x, y) => {
          const block = customBlocks.find((item) => item.id === blockId);
          if (!block) return;
          setDoc((current) => ({ ...current, nodes: [...current.nodes, instantiateCustomBlock(block, x, y)] }));
          setLastPaletteItem(block.title);
        }}
        templateKind={templateParam ?? undefined} mode={activeMode} onCompose={() => setMode('compose')}
        renderTools={({ fitAll, tidyLayout, zoomBy, spawnPoint }) => <>
          {dockHidden ? (
            <button type="button" className={`${styles.dock} ${styles.dockToggle}`} onClick={() => toggleDock(false)}
              title="展开画布工具坞" aria-label="展开画布工具坞" aria-expanded="false">▴ 工具坞</button>
          ) : (
          <div className={styles.dock} role="toolbar" aria-label="画布工具坞">
            <button ref={paletteButton} type="button" aria-expanded={paletteOpen} onClick={() => setPaletteOpen((open) => !open)}>＋ 积木库</button>
            <button type="button" aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="拖空白平移，Shift 拖动框选">平移 / 选择</button>
            <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool(tool === 'pen' ? 'select' : 'pen')} title="手写后按 Shift 框选，可识别公式或拟合曲线">手写</button>
            {tool === 'pen' && ['#2F3A49', '#B8431F'].map((color) => <button key={color} type="button" className={styles.inkColor} style={{ background: color }} aria-label={'墨迹颜色 ' + color} aria-pressed={inkColor === color} onClick={() => setInkColor(color)} />)}
            <button type="button" aria-pressed={tool === 'erase'} onClick={() => setTool(tool === 'erase' ? 'select' : 'erase')}>橡皮</button>
            <button type="button" disabled={!doc.strokes.length} onClick={clearInk}>清屏</button>
            <div className={styles.zoom}>
              <button type="button" aria-label="缩小" onClick={() => zoomBy(-0.15)}>−</button>
              <output>{Math.round(doc.zoom * 100)}%</output>
              <button type="button" aria-label="放大" onClick={() => zoomBy(0.15)}>＋</button>
            </div>
            <button type="button" onClick={fitAll}>适应全图</button>
            <button type="button" onClick={tidyLayout}>自动整理排版</button>
            <button type="button" onClick={() => toggleDock(true)} title="收起工具坞" aria-label="收起工具坞" aria-expanded="true">▾</button>
          </div>
          )}
          {paletteOpen && (
            <section className={styles.objectPicker} aria-label="积木库" onKeyDown={(e) => { if (e.key === 'Escape') closePalette(); }}>
            <header className={styles.objectPickerHeader}>
              <strong>积木库</strong>
              <input ref={paletteSearch} type="search" aria-label="搜索积木" placeholder="搜索名称或关键词"
                value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} />
              <button type="button" className={styles.tbtn} aria-label="关闭积木库" onClick={closePalette}>×</button>
            </header>
            <div className={styles.objectPickerBody}>
              <nav aria-label="积木分类" className={styles.objectCategories}>
                {paletteCategories.map((category) => <button key={category} type="button"
                  aria-pressed={!query && paletteCategory === category}
                  onClick={() => { setPaletteCategory(category); setPaletteQuery(''); }}>{category}</button>)}
              </nav>
              <div className={styles.objectResults} key={query ? 'search' : paletteCategory}>
                {!query && paletteCategory === '深度学习' && (
                  <nav className={styles.objectSubcategories} aria-label="深度学习积木用途">
                    {deepPaletteGroups.map((group) => <button key={group} type="button"
                      aria-pressed={deepPaletteGroup === group} onClick={() => setDeepPaletteGroup(group)}>{group}</button>)}
                  </nav>
                )}
                {query && <h3>搜索结果</h3>}
                {visiblePaletteGroups.length === 0 && matchingCustomBlocks.length === 0
                  && !(!query && paletteCategory === '我的积木') && <p role="status">没有匹配的积木。</p>}
                {visiblePaletteGroups.map(({ label, types }) => <section key={label}>
                  <h3>{!query && paletteCategory === '深度学习' ? label.split(' · ')[1] : label}</h3>
                  <div className={styles.objectGrid}>
                    {types.map((type) => <button key={type} type="button" className={styles.objectItem}
                      aria-label={NODE_DEFS[type].title} draggable
                      onDragStart={(e) => { e.dataTransfer.setData('application/x-wanxiang-node', type); e.dataTransfer.effectAllowed = 'copy'; }}
                      onClick={() => { const point = spawnPoint(); const offset = (spawn.current % 5) * 18; addNode(type, point.x + offset, point.y + offset); setLastPaletteItem(NODE_DEFS[type].title); }}>
                      <span>{NODE_DEFS[type].title}</span>
                      <small>{NODE_DEFS[type].badge}</small>
                    </button>)}
                  </div>
                </section>)}
                {(!query && paletteCategory === '我的积木') || matchingCustomBlocks.length > 0 ? (
                  <section>
                    <h3>{query ? '我的积木' : '我的积木库'}</h3>
                    {matchingCustomBlocks.length === 0 ? (
                      <p role="status" className={styles.paletteEmpty}>
                        还没有保存过积木。在画布中选中至少 2 个对象，点击「封装成积木」，再点「存入我的积木库」。
                      </p>
                    ) : (
                      <div className={styles.objectGrid}>
                        {matchingCustomBlocks.map((block) => (
                          <div key={block.id} className={styles.customBlockRow}>
                            <button type="button" className={styles.objectItem}
                              aria-label={`添加 ${block.title}`} draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('application/x-wanxiang-custom-block', block.id);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onClick={() => {
                                const point = spawnPoint();
                                const offset = (spawn.current % 5) * 18;
                                setDoc((current) => ({
                                  ...current,
                                  nodes: [...current.nodes, instantiateCustomBlock(block, point.x + offset, point.y + offset)],
                                }));
                                setLastPaletteItem(block.title);
                              }}>
                              <span>{block.title}</span>
                              <small>{block.sub.ports.length} 端口</small>
                            </button>
                            <button type="button" className={styles.customBlockRemove}
                              aria-label={`删除 ${block.title}`}
                              onClick={() => { removeCustomBlock(block.id); setCustomBlocks(listCustomBlocks()); }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}
              </div>
            </div>
            <footer className={styles.objectPickerFoot} aria-live="polite">
              {lastPaletteItem ? `已添加：${lastPaletteItem}` : '点击积木，将它添加到画布'}
            </footer>
            </section>
          )}
        </>}
      />
    </div>
  );
}

export default CanvasPage;
