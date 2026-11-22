/**
 * CanvasPage.tsx —— 万象工坊·画布（/canvas）
 *
 * 万象的主功能形态：一张自由画布，活对象可摆可连线，空白处可手写。
 * 持久化双轨：localStorage 兜底（离线不丢）+ 工坊后端（?work=wk_id 已存作品）。
 * 撤销/重做按编辑突发合并（400ms 内连续改动算一步）；发布后走 work-shares 快照。
 * 对象端口协议、多级求值（engine）、命名端口连线、动画源见 `canvas/` 目录。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';

import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { PALETTE_GROUPS, NODE_DEFS, defaultParams } from '@/canvas/nodes.tsx';
import { buildTemplateDoc } from '@/canvas/templateCatalog.ts';
import { nextId, clamp } from '@/canvas/math.ts';
import type { CanvasDoc, CanvasTool, InkStroke, NodeType } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import { extractInkFormula, type InkNodeType } from '@/api/labs';
import { errorMessage } from '@/api/client';
import { simParamMeta } from '@/living/sim';
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
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
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
  const paletteRef = useRef<HTMLDetailsElement>(null);
  const paletteSearch = useRef<HTMLInputElement>(null);
  const paletteCategories = ['常用', '深度学习', '高数', '408', '基础积木', '力学', '文字'];
  const commonTypes: readonly NodeType[] = ['slider', 'matrixSource', 'functionSource', 'textNote',
    'dataset2dSource', 'linearOp', 'activationOp', 'matrixHeatmapView'];
  const query = paletteQuery.trim().toLowerCase();
  const visiblePaletteGroups = !query && paletteCategory === '常用' ? [{ label: '常用积木', types: commonTypes }]
    : PALETTE_GROUPS.filter(({ label }) => query || (paletteCategory === '深度学习'
      ? label === `深度学习 · ${deepPaletteGroup}` : paletteCategory === '基础积木'
        ? ['源', '变换', '视图', '学习'].includes(label) : paletteCategory === '高数'
          ? label.startsWith('高数') : label === paletteCategory))
      .map((group) => ({ ...group, types: group.types.filter((type) =>
        `${group.label} ${NODE_DEFS[type].title} ${type}`.toLowerCase().includes(query)) }))
      .filter(({ types }) => types.length);

  /* 工作台判定只看面板本身：任何学科只要预置了有效 panel（视图或外露参数），
     打开即进入左右停靠的仪器工作台；取消勾选「设为仪器面板」立即回到自由画布。 */
  const useWorkbench = !!doc.panel && (doc.panel.view_node_ids.length > 0 || doc.panel.exposed_params.length > 0);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [inkColor, setInkColor] = useState('#2F3A49');
  const [savedFlash, setSavedFlash] = useState(false);
  const [workId, setWorkId] = useState<string | null>(null);
  const [cloudState, setCloudState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [inkReview, setInkReview] = useState<InkReviewState | null>(null);
  const [inkExpression, setInkExpression] = useState('');
  const [inkError, setInkError] = useState<string | null>(null);
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

  /* 带撤销历史的 setDoc：把"改动前"的快照压栈，400ms 内的连续改动合并为一步 */
  const setDoc = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setDocRaw((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (next === prev) return prev;
      const now = performance.now();
      if (now - hist.current.lastPush > HISTORY_COALESCE_MS) {
        hist.current.past.push(prev);
        if (hist.current.past.length > HISTORY_MAX) hist.current.past.shift();
        hist.current.future = [];
        hist.current.lastPush = now;
        setHistInfo({ undo: hist.current.past.length, redo: 0 });
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    setDocRaw((prev) => {
      const p = h.past.pop();
      if (!p) return prev;
      h.future.push(prev);
      h.lastPush = performance.now();
      setHistInfo({ undo: h.past.length, redo: h.future.length });
      return p;
    });
  }, []);

  const redo = useCallback(() => {
    const h = hist.current;
    setDocRaw((prev) => {
      const f = h.future.pop();
      if (!f) return prev;
      h.past.push(prev);
      h.lastPush = performance.now();
      setHistInfo({ undo: h.past.length, redo: h.future.length });
      return f;
    });
  }, []);

  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y */
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,[contenteditable]')) return;
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
      setDocRaw(next);
    } catch {
      /* 忽略未知模板名 */
    }
  }, [templateParam, workIdParam]);

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
      setDocRaw(d);
    }).catch(() => {
      if (!dead) window.alert('工坊作品加载失败（可能已删除或不属于你），已保留本地画布。');
    });
    return () => { dead = true; };
  }, [workIdParam]);

  /* 防抖持久化：localStorage 永远兜底 */
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 900);
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
          ...(type === 'latexNote' ? { text: 'e^{i\\pi}+1=0' } : {}),
          ...(type === 'functionSource' ? { text: 'a*x^2+b*x+c' } : {}),
          ...(type === 'lab408Workbench' ? { text: defaultManual408Text() } : {}),
        },
      ],
    }));
  }, [setDoc]);

  const setZoom = useCallback((z: number) => {
    setDoc((d) => ({ ...d, zoom: clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX) }));
  }, [setDoc]);

  const clearInk = useCallback(() => {
    setDoc((d) => ({ ...d, strokes: [] }));
  }, [setDoc]);

  const newCanvas = useCallback(() => {
    if (!window.confirm('新建演示画布？当前画布已保存在浏览器本地，会被覆盖。')) return;
    spawn.current = 0;
    setWorkId(null);
    setShareUrl(null);
    hist.current = { past: [], future: [], lastPush: 0 };
    setDoc(seedDoc());
  }, [setDoc]);

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
      setShareUrl(url);
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
      <SiteNav current="canvas" appearance="studio" />

      <div className={styles.toolbar}>
        <input
          className={styles.title}
          value={doc.title}
          spellCheck={false}
          aria-label="画布标题"
          onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
        />
        <span className={`${styles.savepill} ${savedFlash ? styles.savepillOn : ''}`}>
          {workId
            ? cloudState === 'saving' ? '云端同步中…'
              : cloudState === 'error' ? '云端同步失败（本地仍在）'
              : savedFlash ? '✓ 已保存' : '工坊+本地自动保存'
            : savedFlash ? '✓ 已保存' : '本地自动保存'}
        </span>
        <button
          type="button" className={styles.tbtn} disabled={histInfo.undo === 0}
          aria-label="撤销" title="撤销 (Ctrl+Z)" onClick={undo}
        >↩ 撤销</button>
        <button
          type="button" className={styles.tbtn} disabled={histInfo.redo === 0}
          aria-label="重做" title="重做 (Ctrl+Shift+Z)" onClick={redo}
        >↪ 重做</button>
        <div className={styles.spacer} />

        <details className={styles.palette} ref={paletteRef}
          onToggle={() => { if (paletteRef.current?.open) paletteSearch.current?.focus(); }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !paletteRef.current?.open) return;
            event.preventDefault();
            paletteRef.current.open = false;
            paletteRef.current.querySelector('summary')?.focus();
          }}>
          <summary className={styles.tbtn}>＋ 添加对象</summary>
          <section className={styles.objectPicker} aria-label="积木库">
            <header className={styles.objectPickerHeader}>
              <strong>积木库</strong>
              <input ref={paletteSearch} type="search" aria-label="搜索积木" placeholder="搜索名称或关键词"
                value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} />
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
                {visiblePaletteGroups.length === 0 && <p role="status">没有匹配的积木。</p>}
                {visiblePaletteGroups.map(({ label, types }) => <section key={label}>
                  <h3>{!query && paletteCategory === '深度学习' ? label.split(' · ')[1] : label}</h3>
                  <div className={styles.objectGrid}>
                    {types.map((type) => <button key={type} type="button" className={styles.objectItem}
                      aria-label={NODE_DEFS[type].title}
                      onClick={() => { addNode(type); setLastPaletteItem(NODE_DEFS[type].title); }}>
                      <span>{NODE_DEFS[type].title}</span>
                      <small>{NODE_DEFS[type].badge}</small>
                    </button>)}
                  </div>
                </section>)}
              </div>
            </div>
            <footer className={styles.objectPickerFoot} aria-live="polite">
              {lastPaletteItem ? `已添加：${lastPaletteItem}` : '点击积木，将它添加到画布'}
            </footer>
          </section>
        </details>

        <details className={styles.palette}>
          <summary className={styles.tbtn} title="设为仪器面板：嵌入活页时只显示选中视图与外露参数">
            🎛 仪器面板{doc.panel ? ` · ${doc.panel.view_node_ids.length || '全图'}` : ''}
          </summary>
          <div className={styles.paletteMenu}>
            <label className={styles.paletteItem} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={!!doc.panel} onChange={(e) =>
                setDoc((d) => ({ ...d, panel: e.target.checked ? { view_node_ids: [], exposed_params: [] } : undefined }))} />
              设为仪器面板
            </label>
            {doc.panel ? <>
              <div className={styles.paletteLabel}>可见节点（全不选 = 显示全部）</div>
              {doc.nodes.map((n) => (
                <label key={n.id} className={styles.paletteItem} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={doc.panel!.view_node_ids.includes(n.id)} onChange={(e) =>
                    setDoc((d) => ({ ...d, panel: { ...d.panel!, view_node_ids: e.target.checked
                      ? [...d.panel!.view_node_ids, n.id]
                      : d.panel!.view_node_ids.filter((id) => id !== n.id) } }))} />
                  {n.text || NODE_DEFS[n.type]?.title || n.type}
                </label>
              ))}
              <div className={styles.paletteLabel}>外露参数</div>
              {doc.nodes.flatMap((n) => Object.keys(n.params ?? {}).map((key) => ({ n, key }))).map(({ n, key }) => {
                const ref = `${n.id}.${key}`;
                const entry = doc.panel!.exposed_params.find((p) => p.node_id === n.id && p.param_key === key);
                const exposed = !!entry;
                const updateBound = (patch: Partial<{ min: number; max: number; step: number }>) => {
                  setDoc((d) => ({
                    ...d,
                    panel: d.panel ? {
                      ...d.panel,
                      exposed_params: d.panel.exposed_params.map((p) =>
                        p.node_id === n.id && p.param_key === key ? { ...p, ...patch } : p),
                    } : undefined,
                  }));
                };
                return (
                  <div key={ref}>
                    <label className={styles.paletteItem} style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                      <input type="checkbox" checked={exposed} onChange={(e) => {
                        const meta = simParamMeta(n, key);
                        setDoc((d) => ({ ...d, panel: { ...d.panel!, exposed_params: e.target.checked
                          ? [...d.panel!.exposed_params, {
                              node_id: n.id, param_key: key,
                              label: meta.label || `${n.text || NODE_DEFS[n.type]?.title || n.type}·${key}`,
                              min: meta.min, max: meta.max, step: meta.step,
                            }]
                          : d.panel!.exposed_params.filter((p) => !(p.node_id === n.id && p.param_key === key)) } }));
                      }} />
                      {(n.text || NODE_DEFS[n.type]?.title || n.type)}·{key}
                    </label>
                    {entry ? (
                      <div style={{ display: 'flex', gap: '.3rem', paddingLeft: '1.4rem', marginBottom: '.25rem', fontSize: '.75rem' }}>
                        <label>min <input type="number" step="any" style={{ width: '3.6rem' }} value={entry.min ?? ''}
                          onChange={(e) => updateBound({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        <label>max <input type="number" step="any" style={{ width: '3.6rem' }} value={entry.max ?? ''}
                          onChange={(e) => updateBound({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                        <label>step <input type="number" step="any" style={{ width: '3.2rem' }} value={entry.step ?? ''}
                          onChange={(e) => updateBound({ step: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <div className={styles.paletteLabel}>嵌入活页后学生只能调外露参数，原作不受污染</div>
            </> : null}
          </div>
        </details>

        <span className={styles.groupLabel}>笔</span>
        <button
          type="button"
          className={`${styles.tbtn} ${tool === 'pen' ? styles.tbtnOn : ''}`}
          aria-pressed={tool === 'pen'}
          onClick={() => setTool((t) => (t === 'pen' ? 'select' : 'pen'))}
        >
          ✒️ 手写
        </button>
        <span className={styles.swatches}>
          {(['#2F3A49', '#B8431F'] as const).map((c) => (
            <i
              key={c}
              className={`${styles.swatch} ${inkColor === c ? styles.swatchOn : ''}`}
              style={{ background: c }}
              role="button"
              tabIndex={0}
              aria-label={`墨迹颜色 ${c}`}
              onClick={() => { setInkColor(c); if (tool !== 'pen') setTool('pen'); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setInkColor(c); setTool('pen'); } }}
            />
          ))}
        </span>
        <button
          type="button"
          className={`${styles.tbtn} ${tool === 'erase' ? styles.tbtnOn : ''}`}
          aria-pressed={tool === 'erase'}
          onClick={() => setTool((t) => (t === 'erase' ? 'select' : 'erase'))}
        >
          橡皮
        </button>
        <button type="button" className={styles.tbtn} onClick={clearInk}>清屏</button>

        <span className={styles.czoom}>
          <button type="button" aria-label="缩小" onClick={() => setZoom(doc.zoom - 0.15)}>−</button>
          <b aria-live="polite">{Math.round(doc.zoom * 100)}%</b>
          <button type="button" aria-label="放大" onClick={() => setZoom(doc.zoom + 0.15)}>＋</button>
        </span>

        <button type="button" className={styles.tbtn} onClick={exportJson}>导出</button>
        <button type="button" className={styles.tbtn} onClick={newCanvas}>新建</button>
        {!workId ? (
          <button type="button" className={styles.tbtn} onClick={() => void saveToWorkshop()}>
            存到工坊
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.tbtn} ${styles.primary}`}
          onClick={() => void publish()}
        >
          发布画布
        </button>
      </div>

      {shareUrl ? (
        <div className={styles.sharebar} role="status">
          已发布到工坊画廊：<a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          <span className={styles.dim}>（链接已复制，任何人打开即玩，可 fork 改造）</span>
          <button type="button" className={styles.tbtn} onClick={() => setShareUrl(null)}>知道了</button>
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

      <CanvasBoard workbench={useWorkbench} workId={workId} doc={doc} setDoc={setDoc} tool={tool} inkColor={inkColor} onAddNode={addNode} onInkExtract={recognizeInk} onInkFit={recognizeCurves} />
    </div>
  );
}

export default CanvasPage;
