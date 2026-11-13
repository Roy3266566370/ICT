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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasDoc, CanvasNode, CanvasTool, InkStroke, NodeType, PortValue, Wire } from './types.ts';
import { nextId, clamp } from './math.ts';
import { NODE_DEFS, nodePorts } from './nodes.tsx';
import { makeCtx, evalOutput, inputValues } from './engine.ts';
import { PHYS_TYPES, physCycle, type PhysNodeType } from './physics.ts';
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
}

interface Pt { x: number; y: number }

const INNER_W = 2400;
const INNER_H = 1400;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;

const pinKey = (nodeId: string, portId: string): string => `pin|${nodeId}|${portId}`;
const poutKey = (nodeId: string, portId: string): string => `pout|${nodeId}|${portId}`;

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

export function CanvasBoard({ doc, setDoc, tool, inkColor, onAddNode }: BoardProps): JSX.Element {
  const innerRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const portRefs = useRef(new Map<string, HTMLElement>());
  const live = useRef(new Map<string, PortValue>());
  const spaceHeld = useRef(false);
  const zoomRef = useRef(doc.zoom);
  zoomRef.current = doc.zoom;

  const [paths, setPaths] = useState<Record<string, string>>({});
  const [tempWire, setTempWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [selSet, setSelSet] = useState<ReadonlySet<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const zoom = doc.zoom;

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
      if (e.key === 'Escape') setSelSet(new Set());
      if (selSet.size === 0) return;
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
  }, [selSet, setDoc]);

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
  const patchNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, [setDoc]);

  const updateParams = useCallback((id: string, patch: Record<string, number>) => {
    setDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, ...patch } } : n)),
    }));
    setPulses((p) => {
      const next = { ...p };
      for (const w of doc.wires) if (w.from === id) next[w.id] = (next[w.id] ?? 0) + 1;
      return next;
    });
  }, [doc.wires, setDoc]);

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
    setDoc((d) => ({
      ...d,
      wires: [
        ...d.wires.filter((w) => !(w.to === toId && (w.toPort ?? 'in') === toPort)),
        { id: nextId('wire'), from: fromId, fromPort, to: toId, toPort },
      ],
    }));
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
  }, [connect, ctx, portCenter, toInner]);

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
    if (tool === 'erase') {
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
    const pen = tool === 'pen' || e.pointerType === 'pen';
    if (!pen) {
      // 选择工具在空白处按下 → 框选（marquee）；点在节点上交给节点的 click 选中
      if (tool === 'select' && !(e.target as HTMLElement).closest('[data-node],[data-port]')) {
        e.preventDefault();
        const start = toInner(e.clientX, e.clientY);
        let moved = false;
        const mv = (ev: PointerEvent): void => {
          moved = true;
          const p = toInner(ev.clientX, ev.clientY);
          setMarquee({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
        };
        const up = (): void => {
          document.removeEventListener('pointermove', mv);
          document.removeEventListener('pointerup', up);
          setMarquee((m) => {
            if (!m || !moved) {
              setSelSet(new Set());
              return null;
            }
            const x0 = Math.min(m.x1, m.x2), x1 = Math.max(m.x1, m.x2);
            const y0 = Math.min(m.y1, m.y2), y1 = Math.max(m.y1, m.y2);
            const hit = new Set<string>();
            innerRef.current?.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
              const id = el.dataset.node ?? '';
              const nx = parseFloat(el.style.left), ny = parseFloat(el.style.top);
              const nw = el.offsetWidth, nh = el.offsetHeight;
              if (nx < x1 && nx + nw > x0 && ny < y1 && ny + nh > y0) hit.add(id);
            });
            setSelSet(hit);
            return null;
          });
        };
        document.addEventListener('pointermove', mv);
        document.addEventListener('pointerup', up);
      }
      return;
    }
    if ((e.target as HTMLElement).closest('[data-port]')) return; // 端口优先连线
    startStroke(e);
  }, [eraseAt, startPan, startStroke, tool]);

  const onInnerDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node],[data-port]')) return;
    const p = toInner(e.clientX, e.clientY);
    onAddNode?.('textNote', p.x, p.y);
  }, [onAddNode, toInner]);

  /* ---------- 渲染 ---------- */
  return (
    <div className={styles.viewport} ref={vpRef}>
      <div
        ref={innerRef}
        className={`${styles.inner} ${tool !== 'select' ? styles.inkmode : ''}`}
        style={{ width: INNER_W, height: INNER_H, transform: `scale(${zoom})` }}
        onPointerDown={onInnerPointerDown}
        onDoubleClick={onInnerDoubleClick}
      >
        {/* 连线层 */}
        <svg className={styles.wires} width={INNER_W} height={INNER_H} aria-hidden="true">
          {doc.wires.map((w: Wire) => {
            const d = paths[w.id];
            if (!d) return null;
            return (
              <g key={w.id}>
                <path className={styles.wire} d={d} />
                <path
                  className={styles.wireHit}
                  d={d}
                  onClick={() => removeWire(w.id)}
                >
                  <title>点击删除连线</title>
                </path>
                <circle r={4} fill="#FF7A59">
                  <animateMotion key={`${w.id}:${pulses[w.id] ?? 0}`} dur="0.55s" begin="0s" path={d} fill="freeze" />
                </circle>
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
          const def = NODE_DEFS[n.type];
          if (!def) return null;
          const Body = def.Body;
          const inPorts = nodePorts(n, 'in');
          const outPorts = nodePorts(n, 'out');
          const nIn = inPorts.length;
          const nOut = outPorts.length;
          return (
            <div
              key={n.id}
              className={styles.node}
              style={{ left: n.x, top: n.y, width: def.width }}
              data-node={n.id}
              data-sel={selSet.has(n.id) || undefined}
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
                onPointerDown={(e) => startNodeDrag(e, n)}
                role="button"
                aria-label={`拖动 ${def.title}`}
                tabIndex={0}
              >
                <span className={`${styles.ndot} ${def.badge === '源' ? styles.ndotSrc : ''}`} aria-hidden="true" />
                {n.type === 'composite' ? (n.text || def.title) : def.title}
                <span className={`${styles.nbadge} ${def.badge === '源' ? '' : styles.nbadgeSink}`}>{def.badge}</span>
                <button
                  type="button"
                  className={styles.nx}
                  data-node-x
                  aria-label={`移除 ${def.title}`}
                  onClick={() => removeNode(n.id)}
                >
                  ×
                </button>
              </div>
              <div className={styles.nbody}>
                <Body
                  node={n}
                  values={inputValues(ctx, n)}
                  self={evalOutput(ctx, n.id)}
                  onParams={(patch) => updateParams(n.id, patch)}
                  onText={(text) => patchNode(n.id, { text })}
                  onExplode={n.type === 'composite' ? () => explode(n.id) : undefined}
                />
              </div>
              {inPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(pinKey(n.id, p.id), el); else portRefs.current.delete(pinKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portIn}`}
                  style={{ top: `${((i + 1) / (nIn + 1)) * 100}%` }}
                  data-port
                  title={`输入 ${p.label}`}
                >
                  {(nIn > 1 || n.type === 'composite') ? <span className={styles.portLabel}>{p.label}</span> : null}
                </div>
              ))}
              {outPorts.map((p, i) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) portRefs.current.set(poutKey(n.id, p.id), el); else portRefs.current.delete(poutKey(n.id, p.id)); }}
                  className={`${styles.port} ${styles.portOut}`}
                  style={{ top: `${((i + 1) / (nOut + 1)) * 100}%` }}
                  data-port
                  title={`输出 ${p.label}：拖到兼容的蓝圈`}
                  onPointerDown={(e) => startWireDrag(e, n, p.id)}
                >
                  {(nOut > 1 || n.type === 'composite') ? <span className={`${styles.portLabel} ${styles.portLabelR}`}>{p.label}</span> : null}
                </div>
              ))}
            </div>
          );
        })}

        {/* 墨迹层（最上层显示，不抢事件） */}
        <svg className={styles.ink} width={INNER_W} height={INNER_H} aria-hidden="true">
          {doc.strokes.map((s) => (
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

      {/* 多选操作条：封装成自制积木 */}
      {selSet.size >= 2 ? (
        <div className={styles.selBar} role="toolbar" aria-label="多选操作">
          已选 {selSet.size} 个对象
          <button type="button" className={styles.selBarBtn} onClick={encapsulate}>
            📦 封装成积木
          </button>
          <button type="button" className={styles.selBarBtn} onClick={() => setSelSet(new Set())}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
