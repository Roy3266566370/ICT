/**
 * CanvasBoard.tsx —— 万象画布核心组件
 *
 * 三层结构（同一坐标系，全部随 zoom 缩放）：
 *  - #wires  连线层（命名端口间的数据流，贝塞尔曲线 + 数据脉冲）
 *  - nodes   节点层（可拖动/可选中的对象卡片）
 *  - #ink    墨迹层（自由手写，最上层显示，不抢事件）
 *
 * 数据流：engine.ts 沿连线向源求值（支持多级链）；ticker 等动画源经 live Map
 * 广播，不落 doc。端口声明 kind 约束，不兼容的口拖线时不会亮起。
 *
 * 桌面交互：Ctrl/⌘+滚轮缩放（锚定光标）、空格/中键拖平移、点击选中 + Del 删除、
 * 双击空白快速加便签；Pointer Events 同套代码吃鼠标/触屏/手写笔。
 */
import { find408Stage, pipelinePorts } from './lab408Pipeline.ts';
import { findPhysicsStage } from './physicsPipeline.ts';
import { findCalculusStage } from './calculusPipeline.ts';
import { findBusinessStage } from './businessPipeline.ts';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasDoc, CanvasNode, CanvasTool, InkStroke, NodeType, PortValue, Wire } from './types.ts';
import { nextId, clamp } from './math.ts';
import { isStudyStage } from './studyStages';
import { NODE_DEFS, nodePorts, type NodeBodyProps } from './nodes.tsx';
import { AiRuleLive } from './AiRuleBlockNode.tsx';
import { makeCtx, evalOutput, inputValues } from './engine.ts';
import { PHYS_TYPES, physCycle, type PhysNodeType } from './physics.ts';
import { COMPACT_CARD_WIDTH, applyAutoLayout } from './layout.ts';
import { simParamMeta } from '@/living/sim';
import { InstrumentStage } from './InstrumentStage.tsx';
import { applyPresetToDoc, workshopParamRefs, type WorkshopEmbedOptions } from './pluginPresets.ts';
import type { WorkshopPluginPreset } from '../document/types.ts';
import { PresentationSyncContext } from '@/components/presentation/usePresentationSync';
import { SchematicGraphic, nodeSchematicMeta } from './NodeSchematic.tsx';
import { NodeInspector } from './NodeInspector.tsx';
import { parseRealImagePayload } from './imageInput.ts';
import styles from './canvas.module.css';

/** 递归遍历节点树（含 composite.sub 内部节点） */
function walkNodes(nodes: CanvasNode[], fn: (n: CanvasNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.sub) walkNodes(n.sub.nodes, fn);
  }
}

interface BoardProps {
  doc: CanvasDoc;
  setDoc: React.Dispatch<React.SetStateAction<CanvasDoc>>;
  tool: CanvasTool;
  inkColor: string;
  /** 双击空白时请求加节点（由页面决定默认参数） */
  onAddNode?: (type: NodeType, x: number, y: number) => void;
  /** 嵌入活页等固定高度容器时，视口撑满父级而不是占满整屏。 */
  embedded?: boolean;
  mode?: 'instrument' | 'compose';
  onCompose?: () => void;
  templateKind?: string;
  renderTools?: (actions: {
    fitAll: () => void; tidyLayout: () => void; zoomBy: (delta: number) => void; spawnPoint: () => Pt;
  }) => React.ReactNode;
  workId?: string | null;
  /** 首次渲染时自动缩放到节点包围盒，避免嵌入视口停在空白区域。 */
  focusContent?: boolean;
  /** 公开分享等只读场景：保留参数交互，但隐藏删除/结构编辑入口。 */
  readOnly?: boolean;
  interactivePanel?: boolean;
  slideInstrument?: boolean;
  workshopEmbed?: WorkshopEmbedOptions;
  onPreviewPreset?: (preset: WorkshopPluginPreset) => void;
  presentationKey?: string;
  /** 仪器面板模式：仅渲染列出的节点；连线/墨迹/端口隐藏，
   *  但被隐藏节点仍参与求值与动画（内部接线照常工作）。 */
  visibleNodeIds?: ReadonlySet<string>;
  /** 把手写圈选交给页面做本地 OCR；返回 true 表示已消费，可清除选择。 */
  onInkExtract?: (strokes: InkStroke[]) => Promise<boolean>;
  /** 把手写圈选曲线交给页面做表达式拟合；返回 true 表示已消费，可清除选择。 */
  onInkFit?: (strokes: InkStroke[]) => Promise<boolean>;
}

interface Pt { x: number; y: number }

function WirePulse({ path, delay, active }: { path: string; delay: number; active: boolean }): JSX.Element {
  const motion = useRef<SVGAnimateMotionElement>(null);
  const opacity = useRef<SVGAnimateElement>(null);
  useEffect(() => {
    motion.current?.beginElementAt(delay);
    opacity.current?.beginElementAt(delay);
  }, [delay]);
  return (
    <circle className={styles.flowPulse} r={active ? 4 : 3.2} fill={active ? '#4f46e5' : '#FF7A59'} opacity={0}>
      <animateMotion ref={motion} dur="0.55s" begin="indefinite" path={path} fill="freeze" />
      <animate ref={opacity} attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.82;1" dur="0.55s" begin="indefinite" fill="freeze" />
    </circle>
  );
}

const INNER_W = 2400;
const INNER_H = 1400;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;

const pinKey = (nodeId: string, portId: string): string => `pin|${nodeId}|${portId}`;
const poutKey = (nodeId: string, portId: string): string => `pout|${nodeId}|${portId}`;
/** 卡片整面拖拽时，落在这些交互元素上的按下不触发拖动（交给控件自身）。 */
const NODE_DRAG_IGNORE = 'button,input,select,textarea,summary,a[href],label,math-field,[data-port],[data-node-x],[data-node-resize],[data-node-drag-ignore],[contenteditable="true"]';
const PIPELINE_STAGE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['lab408Stage', 'physicsStage', 'calculusStage', 'businessStage']);
const isPipelineStage = (type: NodeType): boolean => PIPELINE_STAGE_TYPES.has(type);

function strokePath(pts: [number, number][]): string {
  if (pts.length < 3) return 'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L');
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
    const my = (pts[i]![1] + pts[i + 1]![1]) / 2;
    d += ` Q${pts[i]![0]},${pts[i]![1]} ${mx},${my}`;
  }
  return d;
}

/** 端口类型兼容：双方都未声明 kind 或 kind 相同即可连（composite 端口动态取自 sub.ports） */
function portKindOf(ctx: ReturnType<typeof makeCtx>, nodeId: string, isOut: boolean, portId: string): PortValue['kind'] | undefined {
  const node = ctx.doc.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  const spec = nodePorts(node, isOut ? 'out' : 'in').find((p) => p.id === portId);
  return spec?.kind;
}

export function CanvasBoard({ doc, setDoc, tool, inkColor, onAddNode, embedded, mode: requestedMode, onCompose, templateKind, renderTools, workId, focusContent, readOnly, interactivePanel, slideInstrument, workshopEmbed, onPreviewPreset, presentationKey, visibleNodeIds, onInkExtract, onInkFit }: BoardProps): JSX.Element {
  const mode = embedded || visibleNodeIds ? undefined : requestedMode;
  const innerRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const portRefs = useRef(new Map<string, HTMLElement>());
  const live = useRef(new Map<string, PortValue>());
  const spaceHeld = useRef(false);
  const nodeDragging = useRef(false);
  const focusedOnce = useRef(false);
  const composedOnce = useRef(false);
  const restoredViewport = useRef(false);
  const zoomRef = useRef(doc.zoom);
  zoomRef.current = doc.zoom;

  const [paths, setPaths] = useState<Record<string, string>>({});
  const [tempWire, setTempWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [pulses, setPulses] = useState<Record<string, { count: number; delay: number }>>({});
  const [selSet, setSelSet] = useState<ReadonlySet<string>>(new Set());
  const [selStrokes, setSelStrokes] = useState<ReadonlySet<string>>(new Set());
  const [inkBusy, setInkBusy] = useState(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [inspectNodeId, setInspectNodeId] = useState<string | null>(null);
  const [paramNodeId, setParamNodeId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [pipelineCursors, setPipelineCursors] = useState<Record<string, number>>({});
  const presentation = useContext(PresentationSyncContext);
  const lastCursorSend = useRef<Record<string, {time: number; timer?: number}>>({});
  const cursorValues = useRef(pipelineCursors);
  cursorValues.current = pipelineCursors;
  useEffect(() => {
    if (!presentation || !presentationKey) return;
    setPipelineCursors(previous => ({...previous, ...presentation.timeline(presentationKey)}));
    const unsubscribe = presentation.subscribe(message => {
      if (message.kind === 'timeline' && message.node === presentationKey) {
        setPipelineCursors(previous => ({...previous, [message.key]: message.position}));
      }
      if (message.kind === 'workshop-request' && message.node === presentationKey) {
        for (const [key, position] of Object.entries(cursorValues.current)) {
          presentation.send({kind: 'timeline', node: presentationKey, key, position});
        }
      }
    });
    return () => {
      unsubscribe();
      for (const {timer} of Object.values(lastCursorSend.current)) window.clearTimeout(timer);
      lastCursorSend.current = {};
    };
  }, [presentation, presentationKey]);
  const zoom = doc.zoom;
  const composing = mode === 'compose';
  const schematic = composing && doc.nodes.some((node) => isPipelineStage(node.type) || isStudyStage(node.type));
  const nodeWidth = (node: CanvasNode) => schematic && node.type !== 'textNote' && node.type !== 'latexNote' && node.type !== 'functionSource'
    ? COMPACT_CARD_WIDTH : node.w ?? NODE_DEFS[node.type]?.width ?? 240;
  const nodeRole = (node: CanvasNode | undefined): string => {
    if (!node) return 'operator';
    const definition = find408Stage(node) ?? findCalculusStage(node) ?? findPhysicsStage(node) ?? findBusinessStage(node);
    if (definition) {
      if (!definition.stage.inputs?.length) return 'source';
      if (doc.panel?.view_node_ids.includes(node.id)) return 'view';
      return node.type === 'lab408Stage' ? 'pipeline' : 'operator';
    }
    const badge = NODE_DEFS[node.type].badge;
    return badge === '源' ? 'source' : badge === '视图' || doc.panel?.view_node_ids.includes(node.id) ? 'view'
      : node.type.startsWith('lab408') ? 'pipeline' : 'operator';
  };
  const worldWidth = doc.nodes.reduce((size, node) => Math.max(size, node.x + nodeWidth(node) + 160), INNER_W);
  const worldHeight = doc.nodes.reduce((size, node) => Math.max(size, node.y + (node.h ?? 700)), INNER_H);

  const ctx = useMemo(() => makeCtx(doc, live.current), [doc, frame]);

  const toInner = useCallback((clientX: number, clientY: number): Pt => {
    const ir = innerRef.current?.getBoundingClientRect();
    if (!ir) return { x: 0, y: 0 };
    return { x: (clientX - ir.left) / zoomRef.current, y: (clientY - ir.top) / zoomRef.current };
  }, []);

  const portCenter = useCallback((key: string): Pt | null => {
    const el = portRefs.current.get(key);
    const ir = innerRef.current?.getBoundingClientRect();
    if (!el || !ir) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - ir.left) / zoom, y: (r.top + r.height / 2 - ir.top) / zoom };
  }, [zoom]);

  const wirePath = useCallback((p1: Pt, p2: Pt): string => {
    const dx = Math.max(50, Math.abs(p2.x - p1.x) / 2);
    return `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`;
  }, []);

  /* ---------- 动画源：rAF 驱动 ticker / 物理自闭钟，经 live Map 广播（含积木内部） ---------- */
  useEffect(() => {
    const tickers: CanvasNode[] = [];
    const clocks: CanvasNode[] = [];
    walkNodes(doc.nodes, (n) => {
      if ((n.params.running ?? 1) === 0) return;
      if (n.type === 'ticker') tickers.push(n);
      else if (PHYS_TYPES.has(n.type)) clocks.push(n);
    });
    if (tickers.length === 0 && clocks.length === 0) {
      setFrame((f) => f + 1); // 停掉时刷一次，让视图回到 t=0
      return undefined;
    }
    let raf = 0;
    let last = 0;
    const loop = (now: number): void => {
      for (const t of tickers) {
        const period = Math.max(0.5, t.params.period ?? 6) * 1000;
        live.current.set(t.id, { kind: 'scalar', v: (now % period) / period });
      }
      for (const c of clocks) {
        // 物理源自走钟：周期内秒数（ticker 停表时也能自演）
        const cyc = physCycle(c.type as PhysNodeType, c.params);
        live.current.set(c.id, { kind: 'scalar', v: (now / 1000) % cyc });
      }
      if (now - last > 40) {
        last = now;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [doc.nodes]);

  const zoomTo = useCallback((requested: number, x: number, y: number) => {
    const previous = zoomRef.current;
    const next = Math.round(clamp(requested, composing ? 0.05 : ZOOM_MIN, ZOOM_MAX) * 100) / 100;
    if (previous === next) return;
    const ratio = next / previous;
    if (composing) {
      setPan((p) => ({ x: x + (p.x - x) * ratio, y: y + (p.y - y) * ratio }));
    } else {
      const vp = vpRef.current;
      if (vp) {
        const left = (vp.scrollLeft + x) * ratio - x;
        const top = (vp.scrollTop + y) * ratio - y;
        requestAnimationFrame(() => vp.scrollTo(left, top));
      }
    }
    zoomRef.current = next;
    setDoc((d) => ({ ...d, zoom: next }));
  }, [composing, setDoc]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [mode, zoomTo]);

  /* ---------- 嵌入视口首次聚焦到节点包围盒 ---------- */
  useLayoutEffect(() => {
    if (!focusContent || focusedOnce.current) return;
    const vp = vpRef.current;
    if (!vp || vp.clientWidth === 0 || doc.nodes.length === 0) return;
    const measured = new Map<string, { width: number; height: number }>();
    vp.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
      const id = el.dataset.node;
      if (id && el.offsetWidth > 0 && el.offsetHeight > 0) measured.set(id, { width: el.offsetWidth, height: el.offsetHeight });
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    walkNodes(doc.nodes, (node) => {
      if (visibleNodeIds && !visibleNodeIds.has(node.id)) return;
      const size = measured.get(node.id);
      const width = size?.width ?? NODE_DEFS[node.type]?.width ?? 240;
      const height = size?.height ?? 190;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + width);
      maxY = Math.max(maxY, node.y + height);
    });
    if (!Number.isFinite(minX)) return;
    const fit = Math.min(1, (vp.clientWidth - 56) / Math.max(1, maxX - minX), (vp.clientHeight - 56) / Math.max(1, maxY - minY));
    const zoom = clamp(Math.round(fit * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(zoom - doc.zoom) > 0.01) setDoc((current) => ({ ...current, zoom }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      vp.scrollLeft = Math.max(0, minX * zoom - 24);
      vp.scrollTop = Math.max(0, minY * zoom - 24);
    }));
    focusedOnce.current = true;
  }, [doc.nodes, doc.zoom, focusContent, visibleNodeIds, setDoc]);

  /* ---------- 空格键状态（+拖拽平移） ---------- */
  useEffect(() => {
    if (mode === 'instrument') return;
    const dn = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,math-field,select,button,summary,a,[contenteditable]')) return;
      spaceHeld.current = true;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
      spaceHeld.current = false;
    };
  }, [mode]);

  const deleteNodes = useCallback((ids: ReadonlySet<string>) => {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      wires: current.wires.filter((wire) => !ids.has(wire.from) && !ids.has(wire.to)),
      ...(current.panel ? { panel: {
        ...current.panel,
        view_node_ids: current.panel.view_node_ids.filter((id) => !ids.has(id)),
        exposed_params: current.panel.exposed_params.filter((param) => !ids.has(param.node_id)),
      } } : {}),
    }));
  }, [setDoc]);

  /* ---------- 选中 + Del 删除（多选） ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelSet(new Set());
        setSelStrokes(new Set());
      }
      if (mode === 'instrument' || readOnly || selSet.size === 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,math-field,[contenteditable]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNodes(selSet);
        setSelSet(new Set());
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [deleteNodes, mode, readOnly, selSet]);

  /* ---------- 布局后重算连线几何；内容相同则跳过重渲，防 layout-effect 循环 ---------- */
  useLayoutEffect(() => {
    if (mode === 'instrument') return;
    const next: Record<string, string> = {};
    for (const w of doc.wires) {
      const a = portCenter(poutKey(w.from, w.fromPort ?? 'out'));
      const b = portCenter(pinKey(w.to, w.toPort ?? 'in'));
      if (a && b) next[w.id] = wirePath(a, b);
    }
    setPaths((prev) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])) return prev;
      return next;
    });
  });

  /* ---------- 文档变更 ---------- */
  const pulseFrom = useCallback((id: string) => {
    const isPipeline = doc.nodes.some((node) => node.id === id && isPipelineStage(node.type));
    const visited = new Set<string>();
    const pending = [{ node: id, depth: 0 }];
    const edges: { id: string; depth: number }[] = [];
    for (let index = 0; index < pending.length; index += 1) {
      const { node: current, depth } = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const wire of doc.wires) {
        if (wire.from !== current) continue;
        edges.push({ id: wire.id, depth });
        if (isPipeline) pending.push({ node: wire.to, depth: depth + 1 });
      }
    }
    if (edges.length) setPulses((previous) => {
      const next = { ...previous };
      for (const edge of edges) next[edge.id] = { count: (next[edge.id]?.count ?? 0) + 1, delay: edge.depth * 0.13 };
      return next;
    });
  }, [doc.nodes, doc.wires]);

  const patchNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, [setDoc]);

  const updateParams = useCallback((id: string, patch: Record<string, number>) => {
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, ...patch } } : n)),
    }));
    pulseFrom(id);
  }, [pulseFrom, setDoc]);

  const removeNode = useCallback((id: string) => {
    deleteNodes(new Set([id]));
    setSelSet((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, [deleteNodes]);

  const connect = useCallback((fromId: string, fromPort: string, toId: string, toPort: string) => {
    setDoc((d) => {
      const pending = [toId];
      const visited = new Set<string>();
      while (pending.length) {
        const id = pending.pop()!;
        if (id === fromId) return d;
        if (visited.has(id)) continue;
        visited.add(id);
        pending.push(...d.wires.filter((edge) => edge.from === id).map((edge) => edge.to));
      }
      return { ...d, wires: [
        ...d.wires.filter((w) => !(w.to === toId && (w.toPort ?? 'in') === toPort)),
        { id: nextId('wire'), from: fromId, fromPort, to: toId, toPort },
      ] };
    });
  }, [setDoc]);

  const removeWire = useCallback((id: string) => {
    setDoc((d) => ({ ...d, wires: d.wires.filter((w) => w.id !== id) }));
  }, [setDoc]);

  /* ---------- 自制积木：框选封装 / 展开还原 ---------- */

  /** 把选中节点封装成一个 composite：跨界线折成 portIn/portOut 端口节点 */
  const encapsulate = useCallback(() => {
    if (selSet.size < 2) return;
    setDoc((d) => {
      const sel = new Set(selSet);
      const inner = d.nodes.filter((n) => sel.has(n.id));
      if (inner.length < 2) return d;

      // 边界：外向线 → portOut（内连 w.from → po.in；外连 composite[poId] → w.to）
      const portNodes: CanvasNode[] = [];
      const innerWires: Wire[] = d.wires.filter((w) => sel.has(w.from) && sel.has(w.to));
      const outerWires: Wire[] = d.wires.filter((w) => !sel.has(w.from) && !sel.has(w.to));
      const bridgeWires: Wire[] = []; // composite 对外的新线
      const ports: NonNullable<CanvasNode['sub']>['ports'] = [];

      const kindOfPort = (nodeId: string, isOut: boolean, portId?: string): PortValue['kind'] | undefined => {
        const n = d.nodes.find((x) => x.id === nodeId);
        if (!n) return undefined;
        const spec = nodePorts(n, isOut ? 'out' : 'in').find((p) => p.id === (portId ?? (isOut ? 'out' : 'in')));
        return spec?.kind;
      };

      for (const w of d.wires) {
        const fromIn = sel.has(w.from);
        const toIn = sel.has(w.to);
        if (fromIn === toIn) continue;
        if (fromIn) {
          // 内 → 外：内源接 portOut，外目标改接 composite 的该端口
          const poId = nextId('po');
          const src = inner.find((n) => n.id === w.from);
          const label = src ? `${NODE_DEFS[src.type]?.title ?? src.type}` : 'out';
          portNodes.push({ id: poId, type: 'portOut', x: (src?.x ?? 0) + 40, y: (src?.y ?? 0) + 40, params: {} });
          innerWires.push({ id: nextId('w'), from: w.from, fromPort: w.fromPort, to: poId, toPort: 'in' });
          bridgeWires.push({ id: w.id, from: 'COMPOSITE', fromPort: poId, to: w.to, toPort: w.toPort });
          ports.push({ id: poId, dir: 'out', label, kind: kindOfPort(w.from, true, w.fromPort) });
        } else {
          // 外 → 内：外源改接 composite 的 pi 端口，portIn 接内目标
          const piId = nextId('pi');
          const dst = inner.find((n) => n.id === w.to);
          const inSpec = dst ? nodePorts(dst, 'in').find((p) => p.id === (w.toPort ?? 'in')) : undefined;
          const label = dst ? `${NODE_DEFS[dst.type]?.title ?? dst.type}·${inSpec?.label ?? 'in'}` : 'in';
          portNodes.push({ id: piId, type: 'portIn', x: (dst?.x ?? 0) - 140, y: (dst?.y ?? 0) + 30, params: {} });
          innerWires.push({ id: nextId('w'), from: piId, fromPort: 'out', to: w.to, toPort: w.toPort });
          bridgeWires.push({ id: w.id, from: w.from, fromPort: w.fromPort, to: 'COMPOSITE', toPort: piId });
          ports.push({ id: piId, dir: 'in', label, kind: kindOfPort(w.to, false, w.toPort) });
        }
      }

      const cx = inner.reduce((s, n) => s + n.x, 0) / inner.length;
      const cy = inner.reduce((s, n) => s + n.y, 0) / inner.length;
      const compId = nextId('n');
      const comp: CanvasNode = {
        id: compId, type: 'composite', x: Math.max(0, cx - 60), y: Math.max(0, cy - 30),
        params: {}, text: '自制积木',
        sub: { nodes: [...inner, ...portNodes], wires: innerWires, ports },
      };
      const fixedBridge = bridgeWires.map((w) => ({
        ...w,
        from: w.from === 'COMPOSITE' ? compId : w.from,
        to: w.to === 'COMPOSITE' ? compId : w.to,
      }));
      return {
        ...d,
        nodes: [...d.nodes.filter((n) => !sel.has(n.id)), comp],
        wires: [...outerWires, ...fixedBridge],
      };
    });
    setSelSet(new Set());
  }, [selSet, setDoc]);

  /** 展开 composite：内部节点回到本层，边界线按 port 节点接线还原 */
  const explode = useCallback((compId: string) => {
    setDoc((d) => {
      const comp = d.nodes.find((n) => n.id === compId && n.type === 'composite');
      const sub = comp?.sub;
      if (!comp || !sub) return d;
      const portIds = new Set(sub.ports.map((p) => p.id));
      const restoreWires: Wire[] = [];

      // 外层接到 pi 端口 → 还原成外层源直连接 pi.out 指向的内目标
      for (const w of d.wires) {
        if (w.to === compId) {
          const inner = sub.wires.find((x) => x.from === w.toPort);
          if (inner) restoreWires.push({ id: w.id, from: w.from, fromPort: w.fromPort, to: inner.to, toPort: inner.toPort });
        } else if (w.from === compId) {
          const inner = sub.wires.find((x) => x.to === w.fromPort);
          if (inner) restoreWires.push({ id: w.id, from: inner.from, fromPort: inner.fromPort, to: w.to, toPort: w.toPort });
        } else {
          restoreWires.push(w);
        }
      }
      const restored = sub.nodes.filter((n) => !portIds.has(n.id));
      const innerWires = sub.wires.filter((x) => !portIds.has(x.from) && !portIds.has(x.to));
      return {
        ...d,
        nodes: [...d.nodes.filter((n) => n.id !== compId), ...restored],
        wires: [...restoreWires, ...innerWires],
      };
    });
  }, [setDoc]);

  /* ---------- 节点拖动（整卡可拖；编排态画布可平移，不钳制到左上角） ---------- */
  const startNodeDrag = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    if (nodeDragging.current) return;
    if ((e.target as HTMLElement).closest('button,summary,[data-node-x]')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    nodeDragging.current = true;
    const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const floor = composing ? Number.NEGATIVE_INFINITY : 0;
    // 有效缩放 = 卡片实测渲染宽 / 布局宽，自动涵盖 doc.zoom 与外层 transform（如幻灯片缩放）
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-node]');
    const measured = cardEl && cardEl.offsetWidth > 0 ? cardEl.getBoundingClientRect().width / cardEl.offsetWidth : 0;
    const scale = measured > 0 ? measured : zoom;
    let moved = false;
    const mv = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && dx * dx + dy * dy < 16) return;
      moved = true;
      patchNode(node.id, {
        x: Math.max(floor, ox + dx / scale),
        y: Math.max(floor, oy + dy / scale),
      });
    };
    const up = (): void => {
      nodeDragging.current = false;
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (moved) {
        // 拖拽结束的合成 click 吞掉，避免触发卡片内部点击行为（如打开检查器/编辑公式）
        const swallow = (ev: MouseEvent): void => ev.stopPropagation();
        document.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }, [patchNode, zoom, composing]);

  /* ---------- 节点尺寸调整（右下角手柄，写入 w/h；缺省恢复类型宽+自适应高） ---------- */
  const startNodeResize = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node]');
    const rect = card?.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    // offsetWidth/Height 是不受 transform 影响的布局尺寸，直接就是世界坐标值
    const ow = card ? card.offsetWidth : node.w ?? NODE_DEFS[node.type]?.width ?? 240;
    const oh = card ? card.offsetHeight : node.h ?? 200;
    const scaleX = card && rect && card.offsetWidth > 0 ? rect.width / card.offsetWidth : 0;
    const scaleY = card && rect && card.offsetHeight > 0 ? rect.height / card.offsetHeight : 0;
    const safeX = scaleX > 0 ? scaleX : zoom;
    const safeY = scaleY > 0 ? scaleY : zoom;
    let moved = false;
    const mv = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && dx * dx + dy * dy < 9) return;
      moved = true;
      patchNode(node.id, {
        w: Math.round(Math.max(160, ow + dx / safeX)),
        h: Math.round(Math.max(80, oh + dy / safeY)),
      });
    };
    const up = (): void => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }, [patchNode, zoom]);

  /* ---------- 连线拖拽（带端口 kind 兼容检查） ---------- */
  const startWireDrag = useCallback((e: React.PointerEvent, node: CanvasNode, portId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const start = portCenter(poutKey(node.id, portId));
    if (!start) return;
    const outKind = portKindOf(ctx, node.id, true, portId);
    const compatible = (key: string): boolean => {
      const parts = key.split('|');
      if (parts[0] !== 'pin') return false;
      const inKind = portKindOf(ctx, parts[1] ?? '', false, parts[2] ?? '');
      const source = find408Stage(node);
      const target = doc.nodes.find(({ id }) => id === parts[1]);
      const receiver = target && find408Stage(target);
      if (source && receiver && target) {
        const index = pipelinePorts(target, 'in').findIndex((port) => port.id === parts[2]);
        return source.pipeline === receiver.pipeline && source.stage.id === receiver.stage.inputs?.[index];
      }
      return !outKind || !inKind || outKind === inKind;
    };
    const arm = (on: boolean): void => {
      portRefs.current.forEach((el, key) => {
        if (compatible(key)) el.toggleAttribute('data-armed', on);
      });
    };
    arm(true);
    const mv = (ev: PointerEvent): void => {
      const p = toInner(ev.clientX, ev.clientY);
      setTempWire({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
    };
    const up = (ev: PointerEvent): void => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      setTempWire(null);
      arm(false);
      for (const [key, el] of portRefs.current) {
        if (!compatible(key)) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientX > r.left - 10 && ev.clientX < r.right + 10 && ev.clientY > r.top - 10 && ev.clientY < r.bottom + 10) {
          const parts = key.split('|');
          const toId = parts[1] ?? '';
          const toPort = parts[2] ?? 'in';
          if (toId !== node.id) connect(node.id, portId, toId, toPort);
          return;
        }
      }
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  }, [connect, ctx, doc.nodes, portCenter, toInner]);

  /* ---------- 视口平移（中键 / 空格+拖拽） ---------- */
  const startPan = useCallback((e: React.PointerEvent) => {
    const vp = vpRef.current;
    if (!vp) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const origin = composing ? panRef.current : { x: -vp.scrollLeft, y: -vp.scrollTop };
    const pointer = e.pointerId;
    vp.setPointerCapture(pointer);
    vp.dataset.panning = 'true';
    const mv = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointer) return;
      const next = { x: origin.x + ev.clientX - sx, y: origin.y + ev.clientY - sy };
      if (composing) setPan(next);
      else vp.scrollTo(-next.x, -next.y);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointer) return;
      delete vp.dataset.panning;
      vp.removeEventListener('pointermove', mv);
      vp.removeEventListener('lostpointercapture', up);
    };
    vp.addEventListener('pointermove', mv);
    vp.addEventListener('lostpointercapture', up);
  }, [composing]);

  /* ---------- 手写墨迹 ---------- */
  const startStroke = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const p = toInner(e.clientX, e.clientY);
    const stroke: InkStroke = { id: nextId('ink'), color: inkColor, width: 2.4, points: [[p.x, p.y]] };
    setDoc((d) => ({ ...d, strokes: [...d.strokes, stroke] }));
    const mv = (ev: PointerEvent): void => {
      const q = toInner(ev.clientX, ev.clientY);
      setDoc((d) => ({
        ...d,
        strokes: d.strokes.map((s) => (s.id === stroke.id ? { ...s, points: [...s.points, [q.x, q.y]] } : s)),
      }));
    };
    const up = (): void => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  }, [inkColor, setDoc, toInner]);

  const eraseAt = useCallback((e: { clientX: number; clientY: number }) => {
    const p = toInner(e.clientX, e.clientY);
    const R = 16;
    setDoc((d) => ({
      ...d,
      strokes: d.strokes.filter((s) => !s.points.some((pt) => Math.hypot(pt[0] - p.x, pt[1] - p.y) < R)),
    }));
  }, [setDoc, toInner]);

  const onInnerPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as Element).closest('[data-board-tools], [data-wire-hit]')) return;
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (!readOnly && tool === 'erase') {
      e.preventDefault();
      eraseAt(e);
      const mv = (ev: PointerEvent): void => eraseAt(ev);
      const up = (): void => {
        document.removeEventListener('pointermove', mv);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
      return;
    }
    const pen = !readOnly && (tool === 'pen' || e.pointerType === 'pen');
    if (!pen) {
      // 选择工具在空白处按下 → 框选（marquee）；点在节点上交给节点的 click 选中
      if (tool === 'select' && !(e.target as HTMLElement).closest('[data-node],[data-port]')) {
        if (composing && !e.shiftKey) {
          setSelSet(new Set());
          setSelStrokes(new Set());
          startPan(e);
          return;
        }
        e.preventDefault();
        const start = toInner(e.clientX, e.clientY);
        let moved = false;
        let last: { x1: number; y1: number; x2: number; y2: number } | null = null;
        const mv = (ev: PointerEvent): void => {
          moved = true;
          const p = toInner(ev.clientX, ev.clientY);
          last = { x1: start.x, y1: start.y, x2: p.x, y2: p.y };
          setMarquee(last);
        };
        const up = (): void => {
          document.removeEventListener('pointermove', mv);
          document.removeEventListener('pointerup', up);
          setMarquee(null);
          if (!last || !moved) {
            setSelSet(new Set());
            setSelStrokes(new Set());
            return;
          }
          const x0 = Math.min(last.x1, last.x2), x1 = Math.max(last.x1, last.x2);
          const y0 = Math.min(last.y1, last.y2), y1 = Math.max(last.y1, last.y2);
          const hit = new Set<string>();
          innerRef.current?.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
            const id = el.dataset.node ?? '';
            const nx = parseFloat(el.style.left), ny = parseFloat(el.style.top);
            const nw = el.offsetWidth, nh = el.offsetHeight;
            if (nx < x1 && nx + nw > x0 && ny < y1 && ny + nh > y0) hit.add(id);
          });
          setSelSet(hit);
          const strokeHit = new Set<string>();
          for (const stroke of doc.strokes) {
            if (stroke.points.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) strokeHit.add(stroke.id);
          }
          setSelStrokes(strokeHit);
        };
        document.addEventListener('pointermove', mv);
        document.addEventListener('pointerup', up);
      }
      return;
    }
    if ((e.target as HTMLElement).closest('[data-port]')) return; // 端口优先连线
    startStroke(e);
  }, [composing, doc.strokes, eraseAt, readOnly, startPan, startStroke, toInner, tool]);

  const onInnerDoubleClick = useCallback((e: React.MouseEvent) => {
    if (readOnly || (e.target as HTMLElement).closest('[data-node],[data-port],[data-board-tools]')) return;
    const p = toInner(e.clientX, e.clientY);
    onAddNode?.('textNote', Math.max(0, p.x), Math.max(0, p.y));
  }, [onAddNode, readOnly, toInner]);

  const recognizeInk = useCallback(async (): Promise<void> => {
    if (!onInkExtract || inkBusy) return;
    const strokes = doc.strokes.filter((stroke) => selStrokes.has(stroke.id));
    if (!strokes.length) return;
    setInkBusy(true);
    try {
      const consumed = await onInkExtract(strokes);
      if (consumed) setSelStrokes(new Set());
    } finally {
      setInkBusy(false);
    }
  }, [doc.strokes, inkBusy, onInkExtract, selStrokes]);

  const fitInk = useCallback(async (): Promise<void> => {
    if (!onInkFit || inkBusy) return;
    const strokes = doc.strokes.filter((stroke) => selStrokes.has(stroke.id));
    if (!strokes.length) return;
    setInkBusy(true);
    try {
      const consumed = await onInkFit(strokes);
      if (consumed) setSelStrokes(new Set());
    } finally {
      setInkBusy(false);
    }
  }, [doc.strokes, inkBusy, onInkFit, selStrokes]);

  const clearSelection = (): void => {
    setSelSet(new Set());
    setSelStrokes(new Set());
  };

  useLayoutEffect(() => {
    if (!workId) return;
    try {
      const saved = JSON.parse(localStorage.getItem('xiangsheng.canvas.viewport.' + workId) ?? 'null');
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
        restoredViewport.current = true;
        setPan({ x: -saved.x, y: -saved.y });
      }
    } catch { /* The viewport can open without storage. */ }
  }, [workId]);

  useEffect(() => {
    if (!workId || !composing) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem('xiangsheng.canvas.viewport.' + workId, JSON.stringify({ x: -pan.x, y: -pan.y }));
      } catch { /* The viewport can work without storage. */ }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [workId, composing, pan]);

  const tidyLayout = () => {
    const boxes = [...(vpRef.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])];
    const cardWidth = Math.max(176, ...boxes.map((el) => el.offsetWidth));
    const cardHeight = Math.max(116, ...boxes.map((el) => el.offsetHeight));
    setDoc((prev) => ({ ...prev, nodes: applyAutoLayout(prev.nodes, prev.wires, { cardWidth, cardHeight, excludeNotes: false }) }));
    requestAnimationFrame(() => fitAll());
  };
  const nodeTitle = (node: CanvasNode) => find408Stage(node)?.stage.title ?? findPhysicsStage(node)?.stage.title
    ?? findCalculusStage(node)?.stage.title ?? findBusinessStage(node)?.stage.title
    ?? (node.text && node.type !== 'textNote' && node.type !== 'latexNote' && node.type !== 'functionSource'
      && !node.text.includes('\n') ? node.text : NODE_DEFS[node.type].title);
  const inspected = doc.nodes.find((node) => node.id === inspectNodeId);
  const activeSelId = selSet.size === 1 ? [...selSet][0]! : null;
  const toggleView = (id: string) => setDoc((current) => {
    const panel = current.panel ?? { view_node_ids: [], exposed_params: [] };
    const ids = panel.view_node_ids;
    return { ...current, panel: { ...panel, view_node_ids: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id] } };
  });
  const toggleParam = (node: CanvasNode, key: string) => setDoc((current) => {
    const panel = current.panel ?? { view_node_ids: [], exposed_params: [] };
    const matches = (param: (typeof panel.exposed_params)[number]) => param.node_id === node.id && param.param_key === key;
    return { ...current, panel: { ...panel, exposed_params: panel.exposed_params.some(matches)
      ? panel.exposed_params.filter((param) => !matches(param))
      : [...panel.exposed_params, { node_id: node.id, param_key: key, ...simParamMeta(node, key) }] } };
  });

  const pipelineWork = presentationKey ?? workId ?? doc.nodes.find((node) => isPipelineStage(node.type))?.id ?? '';
  const audienceKeys = !workshopEmbed?.authoring && workshopEmbed?.visible_params;
  const audienceParams = useMemo(() => audienceKeys ? workshopParamRefs(doc).filter(({ key }) => audienceKeys.includes(key)) : undefined,
    [audienceKeys, doc]);
  const pipelineEnds = useMemo(() => {
    const ends = new Map<string, number>();
    for (const node of doc.nodes) {
      if (!isPipelineStage(node.type)) continue;
      const value = evalOutput(ctx, node.id);
      if (value?.kind !== 'lab408Data' && value?.kind !== 'physicsData' && value?.kind !== 'calculusData' && value?.kind !== 'businessData') continue;
      if (value.error || value.result.frames.length === 0) continue;
      ends.set(value.pipeline, Math.max(ends.get(value.pipeline) ?? 0, value.result.frames.length - 1));
    }
    return ends;
  }, [ctx, doc.nodes]);
  const setCursor = (key: string, position: number) => {
    setPipelineCursors(previous => previous[key] === position ? previous : {...previous, [key]: position});
    if (!presentation || !presentationKey) return;
    const slot = lastCursorSend.current[key] ??= {time: 0};
    window.clearTimeout(slot.timer);
    const send = () => {
      slot.time = Date.now();
      presentation.send({kind: 'timeline', node: presentationKey, key, position});
    };
    const delay = 40 - (Date.now() - slot.time);
    if (delay <= 0) send();
    else slot.timer = window.setTimeout(send, delay);
  };
  const makeBodyProps = (n: CanvasNode): NodeBodyProps => {
    const self = evalOutput(ctx, n.id);
    const pipeline = self
      && (self.kind === 'lab408Data' || self.kind === 'physicsData' || self.kind === 'calculusData' || self.kind === 'businessData')
      && !self.error && self.result.frames.length > 0 ? self.pipeline : null;
    const cursorKey = pipelineWork + ':' + pipeline;
    const exposed = (audienceParams ?? (interactivePanel && readOnly ? doc.panel?.exposed_params : undefined))
      ?.filter((param) => param.node_id === n.id);
    return {
      node: n,
      values: inputValues(ctx, n),
      self,
      onParams: !readOnly && !audienceParams ? (patch) => updateParams(n.id, patch) : exposed?.length && (!readOnly || interactivePanel) ? (patch) => {
        const allowed = Object.fromEntries(exposed.filter((param) => Object.hasOwn(patch, param.param_key))
          .map((param) => [param.param_key, patch[param.param_key]!]));
        if (Object.keys(allowed).length) updateParams(n.id, allowed);
      } : undefined,
      onLive: (outputs) => {
        const keys = Object.keys(outputs);
        if (!keys.length) return;
        for (const [port, value] of Object.entries(outputs)) {
          live.current.set(`${n.id}|${port}`, value);
        }
        setFrame((f) => f + 1);
      },
      onText: readOnly || audienceParams ? undefined : (text) => {
        patchNode(n.id, { text });
        if (isPipelineStage(n.type)) pulseFrom(n.id);
      },
      onPayload: readOnly || audienceParams ? undefined : (payload) => patchNode(n.id, { payload }),
      onExplode: !readOnly && !audienceParams && n.type === 'composite' ? () => explode(n.id) : undefined,
      ...(pipeline ? { timeline: {
        step: Math.floor(pipelineCursors[cursorKey] ?? 0),
        last: pipelineEnds.get(pipeline) ?? 0,
        onStep: (step: number) => setCursor(cursorKey, step),
      } } : {}),
    };
  };

  const fitAll = useCallback(() => {
    const viewport = vpRef.current;
    if (!viewport) return;
    const boxes = [...viewport.querySelectorAll<HTMLElement>('[data-node]')];
    if (!boxes.length) return;
    const left = Math.min(...boxes.map((box) => box.offsetLeft));
    const top = Math.min(...boxes.map((box) => box.offsetTop));
    const right = Math.max(...boxes.map((box) => box.offsetLeft + box.offsetWidth));
    const bottom = Math.max(...boxes.map((box) => box.offsetTop + box.offsetHeight));
    const dockHeight = viewport.querySelector<HTMLElement>('[aria-label="画布工具坞"]')?.offsetHeight ?? 0;
    const margin = Math.max(24, dockHeight + 24);
    const fitted = Math.floor(clamp(Math.min((viewport.clientWidth - 48) / Math.max(1, right - left),
      (viewport.clientHeight - 2 * margin) / Math.max(1, bottom - top)), 0.05, 1.05) * 100) / 100;
    setDoc((prev) => prev.zoom === fitted ? prev : { ...prev, zoom: fitted });
    setPan({ x: (viewport.clientWidth - (left + right) * fitted) / 2,
      y: (viewport.clientHeight - (top + bottom) * fitted) / 2 });
  }, [setDoc]);

  useLayoutEffect(() => {
    if (!composing || composedOnce.current || !doc.nodes.length) return;
    composedOnce.current = true;
    if (!restoredViewport.current) fitAll();
  }, [composing, doc.nodes.length, fitAll]);

  const viewportPoint = () => ({ x: (vpRef.current?.clientWidth ?? 0) / 2, y: (vpRef.current?.clientHeight ?? 0) / 2 });
  if (mode === 'instrument') return <InstrumentStage
    key={templateKind ?? workId}
    doc={doc} templateKind={templateKind} readOnly={readOnly} interactivePanel={interactivePanel} slideInstrument={slideInstrument} onCompose={onCompose}
    getBodyProps={makeBodyProps} nodeTitle={nodeTitle}
    cursors={pipelineCursors} setCursor={setCursor} pipelineScope={pipelineWork} presentationKey={presentationKey}
    workshopEmbed={workshopEmbed} audienceParams={audienceParams}
    onPreset={readOnly ? undefined : onPreviewPreset ?? (preset => setDoc(current => applyPresetToDoc(current, preset, audienceKeys || undefined)))}
  />;

  const canvas = (
    <div className={styles.viewport + (embedded ? ' ' + styles.viewportEmbedded : '') + (composing ? ' ' + styles.composeViewport : '')}
      ref={vpRef} data-canvas-viewport
      onPointerDown={composing ? onInnerPointerDown : undefined}
      onDoubleClick={composing ? onInnerDoubleClick : undefined}
      onDragOver={composing ? (e) => { if (e.dataTransfer.types.includes('application/x-wanxiang-node')) e.preventDefault(); } : undefined}
      onDrop={composing ? (e) => {
        const type = e.dataTransfer.getData('application/x-wanxiang-node') as NodeType;
        if (!Object.hasOwn(NODE_DEFS, type)) return;
        e.preventDefault();
        const point = toInner(e.clientX, e.clientY);
        onAddNode?.(type, Math.max(0, point.x), Math.max(0, point.y));
      } : undefined}>
      {composing && <div className={styles.canvasSurface} aria-hidden="true" />}
      {composing && schematic ? doc.nodes.filter((node) => node.type === 'aiRuleBlock').map((node) =>
        <AiRuleLive key={node.id} node={node} onLive={makeBodyProps(node).onLive} />) : null}
      <div
        ref={innerRef}
        data-canvas-world
        className={styles.inner + (tool !== 'select' ? ' ' + styles.inkmode : '')}
        style={{ width: worldWidth, height: worldHeight, transform: composing
          ? 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')' : 'scale(' + zoom + ')' }}
        onPointerDown={composing ? undefined : onInnerPointerDown}
        onDoubleClick={composing ? undefined : onInnerDoubleClick}
      >
        {/* 连线层（仪器面板模式下隐藏内部接线，引擎照常求值） */}
        <svg className={styles.wires} data-408-flow={pipelineEnds.size > 0 || undefined} width={worldWidth} height={worldHeight} aria-hidden="true">
          {visibleNodeIds ? null : doc.wires.map((w: Wire) => {
            const d = paths[w.id];
            if (!d) return null;
            const isRelated = activeSelId ? (w.from === activeSelId || w.to === activeSelId) : false;
            const pulse = pulses[w.id];
            const wireClass = activeSelId
              ? (isRelated ? `${styles.wire} ${styles.wireActive}` : `${styles.wire} ${styles.wireDim}`)
              : styles.wire;
            return (
              <g key={w.id} data-node-role={composing ? nodeRole(doc.nodes.find((node) => node.id === w.from)) : undefined}>
                <path
                  className={wireClass}
                  data-wire={w.id}
                  d={d}
                />
                {composing && <path className={styles.wireFlow} d={d} />}
                <path
                  className={styles.wireHit} data-wire-hit
                  d={d}
                  onClick={readOnly ? undefined : () => removeWire(w.id)}
                >
                  <title>{readOnly ? '只读画布' : '点击删除连线'}</title>
                </path>
                {pulse ? (
                  <WirePulse key={`p:${w.id}:${pulse.count}:${d}`} path={d} delay={pulse.delay} active={isRelated} />
                ) : null}
              </g>
            );
          })}
          {tempWire ? (
            <path
              className={styles.tempWire}
              d={wirePath({ x: tempWire.x1, y: tempWire.y1 }, { x: tempWire.x2, y: tempWire.y2 })}
            />
          ) : null}
        </svg>

        {/* 节点层 */}
        {doc.nodes.map((n) => {
          if (visibleNodeIds && !visibleNodeIds.has(n.id)) return null;
          const def = NODE_DEFS[n.type];
          if (!def) return null;
          const Body = def.Body;
          const inPorts = nodePorts(n, 'in');
          const outPorts = nodePorts(n, 'out');
          const nIn = inPorts.length;
          const nOut = outPorts.length;
          const labStage = find408Stage(n)?.stage;
          const physicsStage = findPhysicsStage(n)?.stage;
          const calculusStage = findCalculusStage(n)?.stage;
          const businessStage = findBusinessStage(n)?.stage;
          const title = labStage?.title ?? physicsStage?.title ?? calculusStage?.title ?? businessStage?.title ?? def.title;
          const isPinned = doc.panel?.view_node_ids.includes(n.id) ?? false;
          const exposed = doc.panel?.exposed_params.filter((param) => param.node_id === n.id) ?? [];
          const bodyProps = makeBodyProps(n);
          const compact = schematic && n.type !== 'textNote' && n.type !== 'latexNote' && n.type !== 'functionSource';
          const preview = compact && n.type !== 'slider' ? nodeSchematicMeta(n, def, bodyProps.self) : null;
          return (
            <div
              key={n.id}
              className={styles.node}
              style={{ left: n.x, top: n.y, width: nodeWidth(n), height: n.h }}
              data-node={n.id}
              data-custom-h={n.h !== undefined || undefined}
              data-node-role={composing ? nodeRole(n) : undefined}
              data-schematic={schematic && n.type !== 'latexNote' && n.type !== 'functionSource' || undefined}
              data-408-module={labStage?.id}
              data-physics-module={physicsStage?.id}
              data-calculus-module={calculusStage?.id}
              data-business-module={businessStage?.id}
              data-sel={selSet.has(n.id) || undefined}
              onPointerDownCapture={readOnly ? undefined : (e) => {
                if (tool !== 'select' || e.button !== 0) return;
                if ((e.target as HTMLElement).closest(NODE_DRAG_IGNORE)) return;
                startNodeDrag(e, n);
              }}
              onPointerDown={(e) => {
                if (tool !== 'select' || (e.target as HTMLElement).closest('[data-port]')) return;
                setSelSet((s) => {
                  if (e.shiftKey) {
                    const next = new Set(s);
                    if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                    return next;
                  }
                  return s.has(n.id) ? s : new Set([n.id]);
                });
              }}
            >
              <div
                className={styles.nhead}
                onPointerDown={readOnly ? undefined : (e) => startNodeDrag(e, n)}
                role={readOnly ? undefined : 'button'}
                aria-label={readOnly ? undefined : `拖动 ${title}`}
                tabIndex={readOnly ? undefined : 0}
              >
                <span className={`${styles.ndot} ${def.badge === '源' ? styles.ndotSrc : ''}`} aria-hidden="true" />
                <span className={styles.nodeTitle} title={nodeTitle(n)}>{nodeTitle(n)}</span>
                <span className={`${styles.nbadge} ${def.badge === '源' ? '' : styles.nbadgeSink}`}>{def.badge}</span>
                {composing && !readOnly && <div className={styles.pins}>
                  <button type="button" aria-pressed={isPinned} aria-label="主舞台视图" title="主舞台视图" onClick={() => toggleView(n.id)}>📌</button>
                  {Object.keys(n.params).length > 0 && <button type="button" aria-expanded={paramNodeId === n.id}
                    aria-label="外露参数" title="外露参数" data-pinned={exposed.length > 0 || undefined}
                    onClick={() => setParamNodeId(paramNodeId === n.id ? null : n.id)}>◉</button>}
                  <button type="button" aria-label="检查模块" title="检查模块" onClick={() => setInspectNodeId(n.id)}>⌕</button>
                </div>}
                {readOnly ? null : (
                  <button
                    type="button"
                    className={styles.nx}
                    data-node-x
                    aria-label={`移除 ${title}`}
                    onClick={() => removeNode(n.id)}
                  >
                    ×
                  </button>
                )}
              </div>
              {composing && paramNodeId === n.id && <section className={styles.paramPicker} aria-label="外露参数" data-node-drag-ignore="true">
                {Object.keys(n.params).map((key) => {
                  const entry = exposed.find((param) => param.param_key === key);
                  return <div key={key}>
                    <button type="button" aria-pressed={!!entry} onClick={() => toggleParam(n, key)}>{simParamMeta(n, key).label || key}</button>
                    {entry && <div className={styles.paramBounds}>
                      {([['min', '最小'], ['max', '最大'], ['step', '步长']] as const).map(([field, label]) => <label key={field}>{label}
                        <input type="number" step="any" value={entry[field] ?? ''} onChange={(e) => {
                          const value = e.target.value === '' ? undefined : e.target.valueAsNumber;
                          setDoc((current) => current.panel ? { ...current, panel: { ...current.panel, exposed_params: current.panel.exposed_params.map((param) =>
                            param.node_id === n.id && param.param_key === key ? { ...param, [field]: value } : param) } } : current);
                        }} />
                      </label>)}
                    </div>}
                  </div>;
                })}
              </section>}
              <div className={styles.nbody} onClick={composing && n.type === 'functionSource'
                ? () => setInspectNodeId(n.id) : undefined}>
                {preview ? <>
                  <div className={styles.schematic}><SchematicGraphic node={n} /></div>
                  {preview.foot && <small className={styles.schematicRead}>{preview.foot}</small>}
                </> : <Body {...bodyProps} inCard />}
              </div>
              {readOnly || compact || visibleNodeIds ? null : (
                <span
                  className={styles.resize}
                  data-node-resize
                  role="separator"
                  aria-label={`调整 ${title} 大小`}
                  title="拖拽调整大小 · 双击复原"
                  onPointerDown={(e) => startNodeResize(e, n)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (n.w !== undefined || n.h !== undefined) patchNode(n.id, { w: undefined, h: undefined });
                  }}
                />
              )}
              {visibleNodeIds ? null : inPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(pinKey(n.id, p.id), el); else portRefs.current.delete(pinKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portIn}`}
                  style={{ top: `${((i + 1) / (nIn + 1)) * 100}%` }}
                  data-port
                  title={'输入 ' + p.label + ' · ' + (p.kind ?? 'any')}
                >
                  <span className={styles.portLabel}>{p.label} · {p.kind ?? 'any'}</span>
                </div>
              ))}
              {visibleNodeIds ? null : outPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(poutKey(n.id, p.id), el); else portRefs.current.delete(poutKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portOut}`}
                  style={{ top: `${((i + 1) / (nOut + 1)) * 100}%` }}
                  data-port
                  title={'输出 ' + p.label + ' · ' + (p.kind ?? 'any')}
                  onPointerDown={readOnly ? undefined : (e) => startWireDrag(e, n, p.id)}
                >
                  <span className={styles.portLabel + ' ' + styles.portLabelR}>{p.label} · {p.kind ?? 'any'}</span>
                </div>
              ))}
            </div>
          );
        })}

        {/* 墨迹层（最上层显示，不抢事件；仪器面板模式隐藏） */}
        <svg className={styles.ink} width={worldWidth} height={worldHeight} aria-hidden="true">
          {visibleNodeIds ? null : doc.strokes.map((s) => (
            <path key={s.id} d={strokePath(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>

        {/* 框选矩形 */}
        {marquee ? (
          <div
            className={styles.marquee}
            style={{
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
            }}
          />
        ) : null}
      </div>

      {/* 多选操作条：封装积木 / 手写圈选识别 */}
      {!readOnly && (selSet.size >= 2 || selStrokes.size > 0) ? (
        <div className={styles.selBar} data-board-tools role="toolbar" aria-label="多选操作">
          {selSet.size >= 2 ? <>已选 {selSet.size} 个对象</> : null}
          {selSet.size >= 2 ? (
            <button type="button" className={styles.selBarBtn} onClick={encapsulate}>
              📦 封装成积木
            </button>
          ) : null}
          {selStrokes.size > 0 ? <>已选 {selStrokes.size} 段笔迹</> : null}
          {selStrokes.size > 0 ? (
            <button type="button" className={styles.selBarBtn} disabled={!onInkExtract || inkBusy} onClick={() => void recognizeInk()}>
              {inkBusy ? '识别中…' : '✒️ 识别为公式积木'}
            </button>
          ) : null}
          {selStrokes.size > 0 ? (
            <button type="button" className={styles.selBarBtn} disabled={!onInkFit || inkBusy} onClick={() => void fitInk()}>
              {inkBusy ? '拟合中…' : '📈 拟合为函数'}
            </button>
          ) : null}
          <button type="button" className={styles.selBarBtn} onClick={clearSelection}>
            取消
          </button>
        </div>
      ) : null}
      {composing && inspected && <div className={styles.inspectDrawer} data-board-tools>
        <NodeInspector doc={doc} selectedNode={inspected} selectedDef={NODE_DEFS[inspected.type]}
          selectedBodyProps={{ ...makeBodyProps(inspected), onLive: undefined }}
          upstreamRealImage={(() => {
            const pending = [inspected.id];
            const visited = new Set<string>();
            while (pending.length) {
              const id = pending.pop()!;
              if (visited.has(id)) continue;
              visited.add(id);
              const node = doc.nodes.find((item) => item.id === id);
              const image = node?.type === 'pixelGridSource' ? parseRealImagePayload(node.payload) : null;
              if (image) return image;
              for (const wire of doc.wires) if (wire.to === id) pending.push(wire.from);
            }
            return null;
          })()}
          overviewNodes={[]} onSelectNode={setInspectNodeId} onUpdateParam={updateParams}
          nodeTitle={nodeTitle} closeLabel="关闭检查器" />
      </div>}
      {composing && renderTools && <div data-board-tools>{renderTools({
        fitAll, tidyLayout,
        zoomBy: (delta) => { const { x, y } = viewportPoint(); zoomTo(zoom + delta, x, y); },
        spawnPoint: () => {
          const r = vpRef.current?.getBoundingClientRect();
          const point = r ? toInner(r.left + r.width * 0.48, r.top + r.height * 0.28) : { x: 110, y: 120 };
          return { x: Math.max(0, point.x), y: Math.max(0, point.y) };
        },
      })}</div>}
    </div>
  );

  return canvas;
}
