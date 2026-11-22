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
import { createPortal } from 'react-dom';
import { find408Stage, pipelinePorts } from './lab408Pipeline.ts';
import { findPhysicsStage } from './physicsPipeline.ts';
import { findCalculusStage } from './calculusPipeline.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasDoc, CanvasNode, CanvasTool, InkStroke, NodeType, PortValue, Wire } from './types.ts';
import { nextId, clamp } from './math.ts';
import { isStudyStage } from './studyStages';
import { NODE_DEFS, nodePorts, type NodeBodyProps } from './nodes.tsx';
import { makeCtx, evalOutput, inputValues } from './engine.ts';
import { PHYS_TYPES, physCycle, type PhysNodeType } from './physics.ts';
import { COMPACT_CARD_WIDTH, applyAutoLayout } from './layout.ts';
import { NodeSchematic, nodeSchematicMeta } from './NodeSchematic.tsx';
import { NodeInspector } from './NodeInspector.tsx';
import { parseRealImagePayload, type RealImagePayload } from './imageInput.ts';
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
  workbench?: boolean;
  workId?: string | null;
  /** 首次渲染时自动缩放到节点包围盒，避免嵌入视口停在空白区域。 */
  focusContent?: boolean;
  /** 公开分享等只读场景：保留参数交互，但隐藏删除/结构编辑入口。 */
  readOnly?: boolean;
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
const PIPELINE_STAGE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['lab408Stage', 'physicsStage', 'calculusStage']);
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

export function CanvasBoard({ doc, setDoc, tool, inkColor, onAddNode, embedded, workbench, workId, focusContent, readOnly, visibleNodeIds, onInkExtract, onInkFit }: BoardProps): JSX.Element {
  const innerRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const portRefs = useRef(new Map<string, HTMLElement>());
  const live = useRef(new Map<string, PortValue>());
  const spaceHeld = useRef(false);
  const focusedOnce = useRef(false);
  const zoomRef = useRef(doc.zoom);
  zoomRef.current = doc.zoom;

  const [paths, setPaths] = useState<Record<string, string>>({});
  const [tempWire, setTempWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [pulses, setPulses] = useState<Record<string, { count: number; delay: number }>>({});
  const [selSet, setSelSet] = useState<ReadonlySet<string>>(new Set());
  const [selStrokes, setSelStrokes] = useState<ReadonlySet<string>>(new Set());
  const [inkBusy, setInkBusy] = useState(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [plotsOpen, setPlotsOpen] = useState(true);
  const [mobileResults, setMobileResults] = useState(false);
  const [resultHost, setResultHost] = useState<HTMLDivElement | null>(null);
  const [compactPref, setCompactPref] = useState(true);
  const [frame, setFrame] = useState(0);
  const [pipelineCursors, setPipelineCursors] = useState<Record<string, number>>({});
  const autoLaidOutRef = useRef<string | null>(null);
  const zoom = doc.zoom;
  const compactMode = Boolean(workbench && doc.panel && !embedded && !visibleNodeIds && compactPref);
  const worldWidth = doc.nodes.reduce((size, node) => Math.max(size, node.x + (compactMode ? COMPACT_CARD_WIDTH : (NODE_DEFS[node.type]?.width ?? 0)) + 160), INNER_W);
  const worldHeight = doc.nodes.reduce((size, node) => Math.max(size, node.y + 700), INNER_H);

  const ctx = useMemo(() => makeCtx(doc, live.current), [doc, frame]);

  const toInner = useCallback((clientX: number, clientY: number): Pt => {
    const ir = innerRef.current?.getBoundingClientRect();
    if (!ir) return { x: 0, y: 0 };
    return { x: (clientX - ir.left) / zoom, y: (clientY - ir.top) / zoom };
  }, [zoom]);

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

  /* ---------- Ctrl/⌘ + 滚轮缩放（锚定光标） ---------- */
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const z0 = zoomRef.current;
      const z2 = clamp(z0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12), ZOOM_MIN, ZOOM_MAX);
      const pX = (vp.scrollLeft + mx) / z0;
      const pY = (vp.scrollTop + my) / z0;
      setDoc((d) => ({ ...d, zoom: Math.round(z2 * 100) / 100 }));
      requestAnimationFrame(() => {
        vp.scrollLeft = pX * z2 - mx;
        vp.scrollTop = pY * z2 - my;
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [setDoc]);

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
    const dn = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,[contenteditable]')) return;
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
    };
  }, []);

  /* ---------- 选中 + Del 删除（多选） ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelSet(new Set());
        setSelStrokes(new Set());
      }
      if (readOnly || selSet.size === 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,[contenteditable]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setDoc((d) => ({
          ...d,
          nodes: d.nodes.filter((n) => !selSet.has(n.id)),
          wires: d.wires.filter((w) => !selSet.has(w.from) && !selSet.has(w.to)),
        }));
        setSelSet(new Set());
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [readOnly, selSet, setDoc]);

  /* ---------- 布局后重算连线几何；内容相同则跳过重渲，防 layout-effect 循环 ---------- */
  useLayoutEffect(() => {
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
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id),
      wires: d.wires.filter((w) => w.from !== id && w.to !== id),
    }));
    setSelSet((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, [setDoc]);

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

  /* ---------- 节点拖动 ---------- */
  const startNodeDrag = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    if ((e.target as HTMLElement).closest('[data-node-x]')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = node.x, oy = node.y;
    const mv = (ev: PointerEvent): void => {
      patchNode(node.id, {
        x: Math.max(0, ox + (ev.clientX - sx) / zoom),
        y: Math.max(0, oy + (ev.clientY - sy) / zoom),
      });
    };
    const up = (): void => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
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
    const sx = e.clientX, sy = e.clientY, sl = vp.scrollLeft, st = vp.scrollTop;
    const mv = (ev: PointerEvent): void => {
      vp.scrollLeft = sl - (ev.clientX - sx);
      vp.scrollTop = st - (ev.clientY - sy);
    };
    const up = (): void => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  }, []);

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
  }, [doc.strokes, eraseAt, readOnly, startPan, startStroke, toInner, tool]);

  const onInnerDoubleClick = useCallback((e: React.MouseEvent) => {
    if (readOnly || (e.target as HTMLElement).closest('[data-node],[data-port]')) return;
    const p = toInner(e.clientX, e.clientY);
    onAddNode?.('textNote', p.x, p.y);
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

  /* ---------- 渲染 ---------- */
  useLayoutEffect(() => {
    const viewport = vpRef.current;
    if (!workbench || !workId || !viewport) return;
    const key = `xiangsheng.canvas.viewport.${workId}`;
    try {
      const position = JSON.parse(localStorage.getItem(key) ?? 'null') as { x?: number; y?: number } | null;
      viewport.scrollTo(position?.x ?? 0, position?.y ?? 0);
    } catch {
      viewport.scrollTo(0, 0);
    }
    let timer: number | undefined;
    const save = () => {
      try {
        localStorage.setItem(key, JSON.stringify({ x: viewport.scrollLeft, y: viewport.scrollTop }));
      } catch { /* Storage is optional for the viewport. */ }
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 180);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      save();
    };
  }, [workbench, workId]);

  const studyPanel = workbench ? doc.panel : undefined;
  const tidyLayout = useCallback(() => {
    setDoc((prev) => ({
      ...prev,
      nodes: applyAutoLayout(prev.nodes, prev.wires, { excludeNotes: compactMode }),
    }));
  }, [compactMode, setDoc]);

  /* 首次进入紧凑架构模式时自动整理一次坐标，保证打开即横平竖直、无重叠 */
  useEffect(() => {
    if (!compactMode || doc.nodes.some((node) => isPipelineStage(node.type))) return;
    const sig = `${workId ?? 'local'}:${doc.title}:${doc.nodes.length}`;
    if (autoLaidOutRef.current === sig) return;
    autoLaidOutRef.current = sig;
    setDoc((prev) => ({
      ...prev,
      nodes: applyAutoLayout(prev.nodes, prev.wires, { excludeNotes: true }),
    }));
  }, [compactMode, workId, doc.title, doc.nodes, setDoc]);

  const convOrdinals = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 1;
    for (const n of doc.nodes) {
      if (n.type === 'conv2dOp') map.set(n.id, idx++);
    }
    return map;
  }, [doc.nodes]);

  const activeSelId = selSet.size === 1 ? [...selSet][0]! : null;
  const selectedNode = activeSelId ? doc.nodes.find((n) => n.id === activeSelId && n.type !== 'textNote') ?? null : null;

  const findUpstreamRealImage = useCallback((nodeId: string): RealImagePayload | null => {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const found = doc.nodes.find((n) => n.id === cur);
      if (found?.type === 'pixelGridSource') {
        const parsed = parseRealImagePayload(found.payload);
        if (parsed) return parsed;
      }
      for (const w of doc.wires) {
        if (w.to === cur) queue.push(w.from);
      }
    }
    return null;
  }, [doc.nodes, doc.wires]);

  const pipelineWork = workId ?? doc.nodes.find((node) => isPipelineStage(node.type))?.id ?? '';
  const pipelineEnds = useMemo(() => {
    const ends = new Map<string, number>();
    for (const node of doc.nodes) {
      if (!isPipelineStage(node.type)) continue;
      const value = evalOutput(ctx, node.id);
      if (value?.kind !== 'lab408Data' && value?.kind !== 'physicsData' && value?.kind !== 'calculusData') continue;
      if (value.error || value.result.frames.length === 0) continue;
      ends.set(value.pipeline, Math.max(ends.get(value.pipeline) ?? 0, value.result.frames.length - 1));
    }
    return ends;
  }, [ctx, doc.nodes]);
  const makeBodyProps = (n: CanvasNode): NodeBodyProps => {
    const self = evalOutput(ctx, n.id);
    const pipeline = self
      && (self.kind === 'lab408Data' || self.kind === 'physicsData' || self.kind === 'calculusData')
      && !self.error && self.result.frames.length > 0 ? self.pipeline : null;
    const cursorKey = `${pipelineWork}:${pipeline}`;
    return {
      node: n,
      values: inputValues(ctx, n),
      self,
      onParams: readOnly ? undefined : (patch) => updateParams(n.id, patch),
      onLive: (outputs) => {
        const keys = Object.keys(outputs);
        if (!keys.length) return;
        for (const [port, value] of Object.entries(outputs)) {
          live.current.set(`${n.id}|${port}`, value);
        }
        setFrame((f) => f + 1);
      },
      onText: readOnly ? undefined : (text) => {
        patchNode(n.id, { text });
        if (isPipelineStage(n.type)) pulseFrom(n.id);
      },
      onPayload: readOnly ? undefined : (payload) => patchNode(n.id, { payload }),
      onExplode: !readOnly && n.type === 'composite' ? () => explode(n.id) : undefined,
      ...(pipeline ? { timeline: {
        step: pipelineCursors[cursorKey] ?? 0,
        last: pipelineEnds.get(pipeline) ?? 0,
        onStep: (step: number) => setPipelineCursors((prev) => ({ ...prev, [cursorKey]: step })),
      } } : {}),
    };
  };

  const fitAll = () => {
    const viewport = vpRef.current;
    if (!viewport || !doc.nodes.length) return;
    const boxes = [...viewport.querySelectorAll<HTMLElement>('[data-node]')];
    if (!boxes.length) return;
    const left = Math.min(...boxes.map((box) => box.offsetLeft));
    const top = Math.min(...boxes.map((box) => box.offsetTop));
    const right = Math.max(...boxes.map((box) => box.offsetLeft + box.offsetWidth));
    const bottom = Math.max(...boxes.map((box) => box.offsetTop + box.offsetHeight));
    const fitted = clamp(Math.min((viewport.clientWidth - 48) / Math.max(1, right - left),
      (viewport.clientHeight - 48) / Math.max(1, bottom - top)), 0.35, 1.05);
    setDoc((prev) => ({ ...prev, zoom: Math.round(fitted * 100) / 100 }));
    requestAnimationFrame(() => viewport.scrollTo(Math.max(0, left * fitted - 24), Math.max(0, top * fitted - 24)));
  };
  const showModuleInspector = () => {
    setResultsOpen(true);
    if (window.matchMedia('(max-width: 820px)').matches) setMobileResults(true);
  };
  const canvas = (
    <div className={`${styles.viewport} ${embedded ? styles.viewportEmbedded : ''}`} ref={vpRef}>
      <div
        ref={innerRef}
        className={`${styles.inner} ${tool !== 'select' ? styles.inkmode : ''}`}
        style={{ width: worldWidth, height: worldHeight, transform: `scale(${zoom})` }}
        onPointerDown={onInnerPointerDown}
        onDoubleClick={onInnerDoubleClick}
      >
        {/* 连线层（仪器面板模式下隐藏内部接线，引擎照常求值） */}
        <svg className={styles.wires} data-408-flow={pipelineEnds.size > 0 || undefined} width={worldWidth} height={worldHeight} aria-hidden="true">
          <defs>
            <marker id="wx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 1L7 4L0 7Z" fill="#94a3b8" />
            </marker>
            <marker id="wx-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto">
              <path d="M0 1L7 4L0 7Z" fill="#4f46e5" />
            </marker>
          </defs>
          {visibleNodeIds ? null : doc.wires.map((w: Wire) => {
            const d = paths[w.id];
            if (!d) return null;
            const isRelated = activeSelId ? (w.from === activeSelId || w.to === activeSelId) : false;
            const pulse = pulses[w.id];
            const wireClass = activeSelId
              ? (isRelated ? `${styles.wire} ${styles.wireActive}` : `${styles.wire} ${styles.wireDim}`)
              : styles.wire;
            return (
              <g key={w.id}>
                <path
                  className={wireClass}
                  data-wire={w.id}
                  d={d}
                  markerEnd={compactMode ? (isRelated ? 'url(#wx-arrow-active)' : 'url(#wx-arrow)') : undefined}
                />
                <path
                  className={styles.wireHit}
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
          if (compactMode && n.type === 'textNote') return null;
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
          const title = labStage?.title ?? physicsStage?.title ?? calculusStage?.title ?? def.title;
          const docked = !compactMode && !!resultHost && !!studyPanel?.view_node_ids.includes(n.id);
          const bodyProps = makeBodyProps(n);
          const body = (
            <div className={styles.nbody}>
              {docked && <h3>{isPipelineStage(n.type) ? title : n.text || title}</h3>}
              <Body {...bodyProps} />
            </div>
          );
          return (
            <div
              key={n.id}
              className={`${styles.node} ${compactMode ? styles.nodeCompact : ''}`}
              style={{ left: n.x, top: n.y, width: compactMode ? COMPACT_CARD_WIDTH : def.width }}
              data-node={n.id}
              data-408-module={labStage?.id}
              data-physics-module={physicsStage?.id}
              data-calculus-module={calculusStage?.id}
              data-sel={selSet.has(n.id) || undefined}
              onKeyDown={(e) => {
                if (!compactMode || !(e.target as HTMLElement).matches('[role="button"]') || !['Enter', ' '].includes(e.key)) return;
                e.preventDefault();
                setSelSet(new Set([n.id]));
                showModuleInspector();
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
                if (compactMode && !e.shiftKey && !(e.target as HTMLElement).closest('[data-node-x]')) showModuleInspector();
              }}
            >
              {compactMode ? (
                <NodeSchematic
                  node={n}
                  def={def}
                  self={bodyProps.self}
                  selected={selSet.has(n.id)}
                  readOnly={readOnly}
                  convOrdinal={convOrdinals.get(n.id)}
                  onDragStart={readOnly ? undefined : (e) => startNodeDrag(e, n)}
                  onRemove={() => removeNode(n.id)}
                />
              ) : (
                <>
                  <div
                    className={styles.nhead}
                    onPointerDown={readOnly ? undefined : (e) => startNodeDrag(e, n)}
                    role={readOnly ? undefined : 'button'}
                    aria-label={readOnly ? undefined : `拖动 ${title}`}
                    tabIndex={readOnly ? undefined : 0}
                  >
                    <span className={`${styles.ndot} ${def.badge === '源' ? styles.ndotSrc : ''}`} aria-hidden="true" />
                    {(n.type === 'composite' || n.type === 'slider' || n.type === 'matrixHeatmapView' || isStudyStage(n.type)) ? (n.text || title) : title}
                    <span className={`${styles.nbadge} ${def.badge === '源' ? '' : styles.nbadgeSink}`}>{def.badge}</span>
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
                  {docked
                    ? <><p className={styles.dockedLabel}>结果与参数栏</p>{createPortal(body, resultHost!)}</>
                    : body}
                </>
              )}
              {visibleNodeIds ? null : inPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(pinKey(n.id, p.id), el); else portRefs.current.delete(pinKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portIn}`}
                  style={{ top: `${((i + 1) / (nIn + 1)) * 100}%` }}
                  data-port
                  title={`输入 ${p.label}`}
                >
                  {(n.type !== 'lab408Stage' && (nIn > 1 || n.type === 'composite')) ? <span className={styles.portLabel}>{p.label}</span> : null}
                </div>
              ))}
              {visibleNodeIds ? null : outPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(poutKey(n.id, p.id), el); else portRefs.current.delete(poutKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portOut}`}
                  style={{ top: `${((i + 1) / (nOut + 1)) * 100}%` }}
                  data-port
                  title={readOnly ? `输出 ${p.label}` : `输出 ${p.label}：拖到兼容的蓝圈`}
                  onPointerDown={readOnly ? undefined : (e) => startWireDrag(e, n, p.id)}
                >
                  {(nOut > 1 || n.type === 'composite') ? <span className={`${styles.portLabel} ${styles.portLabelR}`}>{p.label}</span> : null}
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
        <div className={styles.selBar} role="toolbar" aria-label="多选操作">
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
    </div>
  );
  if (!studyPanel) return canvas;

  const overviewNodes = compactMode
    ? studyPanel.view_node_ids
        .map((id) => doc.nodes.find((n) => n.id === id))
        .filter((n): n is CanvasNode => !!n && !!NODE_DEFS[n.type])
        .map((n) => {
          const def = NODE_DEFS[n.type]!;
          const Body = def.Body;
          const bp = makeBodyProps(n);
          const meta = nodeSchematicMeta(n, def, bp.self, convOrdinals.get(n.id));
          return { node: n, title: meta.title, content: <Body {...bp} /> };
        })
    : [];

  const selectedDef = selectedNode ? NODE_DEFS[selectedNode.type] ?? null : null;
  const selectedBodyProps = selectedNode ? makeBodyProps(selectedNode) : null;
  const nodeTitle = (n: CanvasNode): string => {
    const def = NODE_DEFS[n.type];
    if (!def) return n.type;
    return nodeSchematicMeta(n, def, evalOutput(ctx, n.id), convOrdinals.get(n.id)).title;
  };

  return (
    <div className={styles.studyWorkspace} data-results={resultsOpen} data-mobile-results={mobileResults}>
      <div className={styles.studyCanvas}>
        {canvas}
        <div className={styles.floatingBar} role="toolbar" aria-label="画布排版控制">
          <button type="button" onClick={fitAll}>适应全图</button>
          {!readOnly && <button type="button" onClick={tidyLayout}>整理排版</button>}
          <button
            type="button"
            aria-pressed={compactPref}
            onClick={() => setCompactPref((v) => !v)}
          >
            {compactPref ? '展开卡片' : '架构视图'}
          </button>
          <button type="button" className={styles.studyDesktopToggle} aria-expanded={resultsOpen}
            onClick={() => setResultsOpen(!resultsOpen)}>{resultsOpen ? '收起详情栏' : '展开详情栏'}</button>
        </div>
      </div>

      {compactMode ? (
        <div className={styles.studyInspectorHost}>
          <NodeInspector
            doc={doc}
            panel={studyPanel}
            selectedNode={selectedNode}
            selectedDef={selectedDef}
            selectedBodyProps={selectedBodyProps}
            convOrdinal={selectedNode ? convOrdinals.get(selectedNode.id) : undefined}
            upstreamRealImage={selectedNode ? findUpstreamRealImage(selectedNode.id) : null}
            overviewNodes={overviewNodes}
            onSelectNode={(id) => setSelSet(id ? new Set([id]) : new Set())}
            onUpdateParam={(nodeId, patch) => updateParams(nodeId, patch)}
            nodeTitle={nodeTitle}
          />
        </div>
      ) : (
        <aside className={styles.studyResults} aria-label="结果与参数" data-plots-open={plotsOpen}>
          <header className={styles.studyResultHeading}>
            <h2>实验结果</h2>
            <button type="button" aria-expanded={plotsOpen} onClick={() => setPlotsOpen((open) => !open)}>
              {plotsOpen ? '隐藏结果' : '显示结果'}
            </button>
          </header>
          <div ref={setResultHost} className={styles.studyPlots} hidden={!plotsOpen} />
          <h2>常用参数</h2>
          <div className={styles.studyParams}>{studyPanel.exposed_params.map((param) => {
            const node = doc.nodes.find((item) => item.id === param.node_id);
            if (!node) return null;
            const value = node.params[param.param_key] ?? param.min ?? 0;
            return <label key={`${param.node_id}:${param.param_key}`}>
              <span>{param.label}</span><output>{value}</output>
              <input type="range" aria-label={param.label || param.param_key} min={param.min} max={param.max} step={param.step} value={value}
                onChange={(event) => updateParams(node.id, { [param.param_key]: Number(event.target.value) })} />
            </label>;
          })}</div>
        </aside>
      )}
      <button type="button" className={styles.studyMobileToggle} aria-pressed={mobileResults}
        onClick={() => setMobileResults(!mobileResults)}>{mobileResults ? '查看画布' : '结果与参数'}</button>
    </div>
  );

}
