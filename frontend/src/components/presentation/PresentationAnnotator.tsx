import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import { PresentationSyncContext, type InkFrame, type InkStroke } from './usePresentationSync';

export type AnnotateTool = 'off' | 'pen' | 'highlighter' | 'laser' | 'eraser';

interface Props {
  pageNo: number;
  tool: AnnotateTool;
  color: string;
  clearNonce: number;
  autoPen?: boolean;
}

const VIEW_W = 1920;
const VIEW_H = 1080;
const EMPTY_FRAME: InkFrame = {strokes: [], active: null, laser: null};

function svgPathFromStroke(points: number[][]): string {
  if (!points.length) return '';
  const d: Array<string | number> = [];
  const [first] = points;
  if (!first) return '';
  d.push('M', first[0]!.toFixed(1), first[1]!.toFixed(1), 'Q');
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[i]!;
    const p1 = points[(i + 1) % points.length]!;
    d.push(
      p0[0]!.toFixed(1),
      p0[1]!.toFixed(1),
      ((p0[0]! + p1[0]!) / 2).toFixed(1),
      ((p0[1]! + p1[1]!) / 2).toFixed(1),
    );
  }
  d.push('Z');
  return d.join(' ');
}

function strokeD(stroke: InkStroke): string {
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: stroke.tool === 'highlighter' ? 0.05 : 0.45,
    smoothing: 0.55,
    streamline: 0.55,
    simulatePressure: false,
  });
  return svgPathFromStroke(outline);
}

/** 课堂演示透明 SVG 板书批注层（基于 perfect-freehand），按页隔离笔迹，支持钢笔/荧光笔/激光笔/橡皮擦。 */
export const PresentationAnnotator = memo(function PresentationAnnotator({
  pageNo,
  tool,
  color,
  clearNonce,
  autoPen,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const sync = useContext(PresentationSyncContext);
  const frames = useRef<Record<number, InkFrame>>({});
  const [byPage, setByPage] = useState(frames.current);
  const drawing = useRef<{id: number; tool: Exclude<AnnotateTool, 'off'>} | null>(null);
  const clearSeen = useRef(clearNonce);
  const queued = useRef(0);
  const update = useCallback((target: number, frame: InkFrame, broadcast = false) => {
    frames.current = {...frames.current, [target]: frame};
    setByPage(frames.current);
    if (broadcast && sync) {
      cancelAnimationFrame(queued.current);
      queued.current = requestAnimationFrame(() => sync.send({kind: 'ink', pageNo: target, frame}));
    }
  }, [sync]);
  useEffect(() => sync?.subscribe(message => {
    if (message.kind === 'ink') update(message.pageNo, message.frame);
    if (message.kind === 'hello') {
      const current = frames.current[pageNo];
      if (current) sync.send({kind: 'ink', pageNo, frame: current});
    }
  }), [pageNo, sync, update]);
  useEffect(() => () => cancelAnimationFrame(queued.current), []);
  useEffect(() => {
    if (clearNonce === clearSeen.current) return;
    clearSeen.current = clearNonce;
    update(pageNo, EMPTY_FRAME, true);
  }, [clearNonce, pageNo, update]);
  useEffect(() => {
    drawing.current = null;
    const frame = frames.current[pageNo];
    if (frame?.active || frame?.laser) update(pageNo, {...frame, active: null, laser: null});
  }, [pageNo, tool, update]);

  const toCanvas = useCallback((event: PointerEvent): [number, number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((event.clientY - rect.top) / rect.height) * VIEW_H;
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    return [x, y, pressure];
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const slide = svg?.parentElement;
    if (!svg || !slide) return;
    const erase = (frame: InkFrame, [x, y]: [number, number, number]) => {
      const strokes = frame.strokes.filter(stroke =>
        stroke.points.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > 34 ** 2));
      if (strokes.length !== frame.strokes.length) update(pageNo, {...frame, strokes}, true);
    };
    const down = (event: PointerEvent) => {
      const automatic = tool === 'off' && autoPen && event.pointerType === 'pen';
      if (event.button !== 0 || drawing.current || (!automatic && (tool === 'off' || event.target !== svg))) return;
      const selected = automatic ? 'pen' : tool;
      const point = toCanvas(event);
      if (!point || selected === 'off') return;
      event.preventDefault();
      event.stopPropagation();
      svg.setPointerCapture(event.pointerId);
      drawing.current = {id: event.pointerId, tool: selected};
      const frame = frames.current[pageNo] ?? EMPTY_FRAME;
      if (selected === 'eraser') erase(frame, point);
      else if (selected === 'laser') update(pageNo, {...frame, laser: [point[0], point[1]]}, true);
      else {
        const highlighter = selected === 'highlighter';
        update(pageNo, {...frame, active: {
          id: crypto.randomUUID(), tool: selected, color: highlighter ? '#facc15' : color,
          size: highlighter ? 28 : 8, points: [point],
        }}, true);
      }
    };
    const move = (event: PointerEvent) => {
      const active = drawing.current?.id === event.pointerId ? drawing.current : null;
      const selected = active?.tool ?? (event.target === svg ? tool : 'off');
      if (!active && selected !== 'laser') return;
      const point = toCanvas(event);
      if (!point) return;
      const frame = frames.current[pageNo] ?? EMPTY_FRAME;
      if (selected === 'laser') update(pageNo, {...frame, laser: [point[0], point[1]]}, true);
      else if (selected === 'eraser') erase(frame, point);
      else if (frame.active) update(pageNo, {...frame, active: {...frame.active, points: [...frame.active.points, point]}}, true);
    };
    const up = (event: PointerEvent) => {
      if (drawing.current?.id !== event.pointerId) return;
      event.stopPropagation();
      drawing.current = null;
      const frame = frames.current[pageNo];
      if (!frame?.active) return;
      const strokes = event.type === 'pointercancel' ? frame.strokes : [...frame.strokes, frame.active];
      update(pageNo, {...frame, strokes, active: null}, true);
    };
    const leave = () => {
      const frame = frames.current[pageNo];
      if (frame?.laser) update(pageNo, {...frame, laser: null}, true);
    };
    const suppressClick = (event: MouseEvent) => {
      if ((tool !== 'off' && event.target === svg) || (autoPen && (event as PointerEvent).pointerType === 'pen')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    slide.addEventListener('pointerdown', down, true);
    slide.addEventListener('pointermove', move, true);
    slide.addEventListener('pointerup', up, true);
    slide.addEventListener('pointercancel', up, true);
    slide.addEventListener('click', suppressClick, true);
    svg.addEventListener('pointerleave', leave);
    return () => {
      slide.removeEventListener('pointerdown', down, true);
      slide.removeEventListener('pointermove', move, true);
      slide.removeEventListener('pointerup', up, true);
      slide.removeEventListener('pointercancel', up, true);
      slide.removeEventListener('click', suppressClick, true);
      svg.removeEventListener('pointerleave', leave);
    };
  }, [autoPen, color, pageNo, tool, toCanvas, update]);

  const {strokes, active: activeStroke, laser} = byPage[pageNo] ?? EMPTY_FRAME;
  const interactive = tool !== 'off';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      data-no-pan
      aria-label="课堂板书批注层"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: interactive ? 18 : 6,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor:
          tool === 'laser'
            ? 'none'
            : tool === 'eraser'
              ? 'cell'
              : interactive
                ? 'crosshair'
                : 'default',
        touchAction: interactive ? 'none' : 'auto',
      }}
    >
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={strokeD(stroke)}
          fill={stroke.color}
          pointerEvents="none"
          opacity={stroke.tool === 'highlighter' ? 0.38 : 0.92}
        />
      ))}
      {activeStroke ? (
        <path
          d={strokeD(activeStroke)}
          fill={activeStroke.color}
          pointerEvents="none"
          opacity={activeStroke.tool === 'highlighter' ? 0.38 : 0.92}
        />
      ) : null}
      {laser ? (
        <g pointerEvents="none">
          <circle cx={laser[0]} cy={laser[1]} r={24} fill="#ef4444" opacity={0.22} />
          <circle cx={laser[0]} cy={laser[1]} r={9} fill="#ef4444" opacity={0.95} />
          <circle cx={laser[0]} cy={laser[1]} r={3.5} fill="#ffffff" />
        </g>
      ) : null}
    </svg>
  );
});
