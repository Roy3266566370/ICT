import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getStroke } from 'perfect-freehand';

export type AnnotateTool = 'off' | 'pen' | 'highlighter' | 'laser' | 'eraser';

interface InkStroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  points: Array<[number, number, number]>;
}

interface Props {
  pageNo: number;
  tool: AnnotateTool;
  color: string;
  clearNonce: number;
}

const VIEW_W = 1920;
const VIEW_H = 1080;

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
    simulatePressure: true,
  });
  return svgPathFromStroke(outline);
}

/** 课堂演示透明 SVG 板书批注层（基于 perfect-freehand），按页隔离笔迹，支持钢笔/荧光笔/激光笔/橡皮擦。 */
export const PresentationAnnotator = memo(function PresentationAnnotator({
  pageNo,
  tool,
  color,
  clearNonce,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [byPage, setByPage] = useState<Record<number, InkStroke[]>>({});
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const [laser, setLaser] = useState<[number, number] | null>(null);
  const drawing = useRef(false);
  const clearSeen = useRef(clearNonce);

  useEffect(() => {
    if (clearNonce === clearSeen.current) return;
    clearSeen.current = clearNonce;
    setByPage((prev) => ({ ...prev, [pageNo]: [] }));
    setActiveStroke(null);
  }, [clearNonce, pageNo]);

  useEffect(() => {
    if (tool !== 'laser') setLaser(null);
  }, [tool]);

  const toCanvas = useCallback((event: ReactPointerEvent<SVGSVGElement>): [number, number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((event.clientY - rect.top) / rect.height) * VIEW_H;
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    return [x, y, pressure];
  }, []);

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const thresholdSq = 34 * 34;
      setByPage((prev) => {
        const list = prev[pageNo];
        if (!list?.length) return prev;
        const filtered = list.filter((s) =>
          s.points.every(([px, py]) => (px - x) * (px - x) + (py - y) * (py - y) > thresholdSq),
        );
        return filtered.length === list.length ? prev : { ...prev, [pageNo]: filtered };
      });
    },
    [pageNo],
  );

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'off') return;
    event.preventDefault();
    event.stopPropagation();
    const pt = toCanvas(event);
    if (!pt) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    if (tool === 'laser') {
      setLaser([pt[0], pt[1]]);
      return;
    }
    if (tool === 'eraser') {
      eraseAt(pt[0], pt[1]);
      return;
    }
    setActiveStroke({
      id: `ink_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tool,
      color: tool === 'highlighter' ? '#facc15' : color,
      size: tool === 'highlighter' ? 28 : 8,
      points: [pt],
    });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'off') return;
    const pt = toCanvas(event);
    if (!pt) return;
    if (tool === 'laser') {
      setLaser([pt[0], pt[1]]);
      return;
    }
    if (!drawing.current) return;
    if (tool === 'eraser') {
      eraseAt(pt[0], pt[1]);
      return;
    }
    setActiveStroke((curr) => (curr ? { ...curr, points: [...curr.points, pt] } : null));
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setActiveStroke((curr) => {
      if (curr && curr.points.length > 0) {
        setByPage((prev) => ({ ...prev, [pageNo]: [...(prev[pageNo] ?? []), curr] }));
      }
      return null;
    });
  };

  const strokes = byPage[pageNo] ?? [];
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (tool === 'laser') setLaser(null);
      }}
    >
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={strokeD(stroke)}
          fill={stroke.color}
          opacity={stroke.tool === 'highlighter' ? 0.38 : 0.92}
        />
      ))}
      {activeStroke ? (
        <path
          d={strokeD(activeStroke)}
          fill={activeStroke.color}
          opacity={activeStroke.tool === 'highlighter' ? 0.38 : 0.92}
        />
      ) : null}
      {laser ? (
        <g>
          <circle cx={laser[0]} cy={laser[1]} r={24} fill="#ef4444" opacity={0.22} />
          <circle cx={laser[0]} cy={laser[1]} r={9} fill="#ef4444" opacity={0.95} />
          <circle cx={laser[0]} cy={laser[1]} r={3.5} fill="#ffffff" />
        </g>
      ) : null}
    </svg>
  );
});
