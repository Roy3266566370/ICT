import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import katex from 'katex';
import { validateViewAst } from '@/ppt-ai/sandbox/protocol';
import { extractDragHandles, mapDragPointToParams, type DragHandleSpec } from './viewAstDrag';
import { ChartNodeView } from './ChartNodeView';
import { MermaidNodeView } from './MermaidNodeView';
import { Scene3dNodeView } from './Scene3dNodeView';

interface Props {
  ast: Record<string, unknown>;
  className?: string;
  bindings?: string[];
  interactive?: boolean;
  onParamChange?: (patch: Record<string, number>) => void;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function styleOf(node: Record<string, unknown>, defaults: Record<string, string | number | boolean> = {}) {
  const raw = node.style;
  const style: Record<string, string | number | boolean> = { ...defaults };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const source = raw as Record<string, unknown>;
    for (const key of ['fill', 'stroke', 'strokeWidth', 'opacity', 'fontSize', 'fontWeight', 'textAnchor', 'align']) {
      const value = source[key];
      if (typeof value === 'string' || typeof value === 'number') style[key] = value;
    }
    for (const key of ['arrowStart', 'arrowEnd']) {
      if (typeof source[key] === 'boolean') style[key] = source[key];
    }
    if (Array.isArray(source.dash)) style.dashArray = source.dash.filter((item) => typeof item === 'number').join(' ');
  }
  return style;
}

function pointsText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter((point): point is number[] => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number')
    .map((point) => `${point[0]},${point[1]}`)
    .join(' ');
}

function Axes({ node, width, height }: { node: Record<string, unknown>; width: number; height: number }) {
  const pad = 40;
  const style = styleOf(node, { stroke: '#94a3b8', strokeWidth: 1 });
  const xMin = num(node.x_min, 0);
  const xMax = num(node.x_max, 1);
  const yMin = num(node.y_min, 0);
  const yMax = num(node.y_max, 1);
  const zeroY = yMin <= 0 && yMax >= 0 ? height - pad - (0 - yMin) / Math.max(1e-9, yMax - yMin) * (height - pad * 2) : height - pad;
  const zeroX = xMin <= 0 && xMax >= 0 ? pad + (0 - xMin) / Math.max(1e-9, xMax - xMin) * (width - pad * 2) : pad;
  return (
    <g>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={String(style.stroke)} strokeWidth={num(style.strokeWidth, 1)} />
      <line x1={zeroX} y1={pad} x2={zeroX} y2={height - pad} stroke={String(style.stroke)} strokeWidth={num(style.strokeWidth, 1)} />
      <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#e2e8f0" strokeDasharray="4 4" />
      <text x={width - pad} y={height - pad + 16} textAnchor="end" fontSize="10" fill="#94a3b8">x</text>
      <text x={zeroX + 6} y={pad + 10} fontSize="10" fill="#94a3b8">y</text>
    </g>
  );
}

function RenderNode({ node, keyPrefix }: { node: Record<string, unknown>; keyPrefix: string }) {
  const type = str(node.type);
  const id = str(node.id);
  const key = `${keyPrefix}${id}`;
  if (type === 'group') {
    const children = Array.isArray(node.children) ? node.children.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
    return <g key={key} transform={`translate(${num(node.x)},${num(node.y)})`}>
      {children.map((child, index) => <RenderNode key={`${key}-${index}`} node={child} keyPrefix={`${key}-`} />)}
    </g>;
  }
  const style = styleOf(node);
  const fill = str(style.fill, 'none');
  const stroke = str(style.stroke, 'none');
  const strokeWidth = num(style.strokeWidth, 1);
  if (type === 'text') {
    return <text key={key} x={num(node.x)} y={num(node.y)} fill={str(style.fill, '#0f172a')}
      fontSize={num(style.fontSize, 13)} fontWeight={num(style.fontWeight, 400) as number}
      textAnchor={str(style.textAnchor, 'start') as 'start' | 'middle' | 'end'} opacity={num(style.opacity, 1)}>{str(node.text)}</text>;
  }
  if (type === 'point') {
    return <circle key={key} cx={num(node.x)} cy={num(node.y)} r={num(node.r, 3.2)} fill={str(style.fill, '#1d4ed8')} opacity={num(style.opacity, 1)} />;
  }
  if (type === 'line') {
    const lineStroke = str(style.stroke, '#334155');
    const hasArrow = style.arrowStart === true || style.arrowEnd === true;
    const markerId = `ast-arrow-${key}`;
    return <g key={key}>
      {hasArrow && <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10Z" fill={lineStroke} />
      </marker></defs>}
      <line x1={num(node.x1)} y1={num(node.y1)} x2={num(node.x2)} y2={num(node.y2)}
        stroke={lineStroke} strokeWidth={strokeWidth} opacity={num(style.opacity, 1)}
        strokeDasharray={typeof style.dashArray === 'string' ? style.dashArray : undefined}
        markerStart={style.arrowStart === true ? `url(#${markerId})` : undefined}
        markerEnd={style.arrowEnd === true ? `url(#${markerId})` : undefined} />
    </g>;
  }
  if (type === 'polyline') {
    return <polyline key={key} points={pointsText(node.points)} fill={fill} stroke={str(style.stroke, '#334155')}
      strokeWidth={strokeWidth} opacity={num(style.opacity, 1)} />;
  }
  if (type === 'polygon') {
    return <polygon key={key} points={pointsText(node.points)} fill={fill} stroke={str(style.stroke, '#1d4ed8')}
      strokeWidth={strokeWidth} opacity={num(style.opacity, 1)} />;
  }
  if (type === 'arrow') {
    const arrowStroke = str(style.stroke, '#c4622d');
    const x1 = num(node.x1);
    const y1 = num(node.y1);
    const x2 = num(node.x2);
    const y2 = num(node.y2);
    const markerId = `ast-arrow-node-${key}`;
    const label = str(node.label);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 10;
    return <g key={key}>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" fill={arrowStroke} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={arrowStroke} strokeWidth={num(style.strokeWidth, 2.5)} opacity={num(style.opacity, 1)}
        strokeDasharray={typeof style.dashArray === 'string' ? style.dashArray : undefined}
        markerStart={style.arrowStart === true ? `url(#${markerId})` : undefined}
        markerEnd={`url(#${markerId})`} />
      {label && <text x={mx} y={my} fill={arrowStroke} fontSize={num(style.fontSize, 13)} fontWeight={600} textAnchor="middle">{label}</text>}
    </g>;
  }
  if (type === 'rect') {
    return <rect key={key} x={num(node.x)} y={num(node.y)} width={Math.max(0, num(node.w))} height={Math.max(0, num(node.h))}
      fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={num(style.opacity, 1)} rx={num(node.rx, 2)} />;
  }
  if (type === 'circle') {
    return <circle key={key} cx={num(node.cx)} cy={num(node.cy)} r={Math.max(0, num(node.r))}
      fill={fill} stroke={stroke} strokeWidth={strokeWidth} opacity={num(style.opacity, 1)} />;
  }
  if (type === 'curve') {
    const points = Array.isArray(node.series) ? node.series : [];
    const path = points
      .filter((point): point is number[] => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number')
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]},${point[1]}`)
      .join(' ');
    return <path key={key} d={path} fill="none" stroke={str(style.stroke, '#1d4ed8')}
      strokeWidth={num(style.strokeWidth, 2.2)} opacity={num(style.opacity, 1)} strokeLinejoin="round" />;
  }
  if (type === 'heatmap') {
    const cells = Array.isArray(node.cells) ? node.cells : [];
    const xMin = num(node.x_min, 0);
    const xMax = num(node.x_max, 1);
    const yMin = num(node.y_min, 0);
    const yMax = num(node.y_max, 1);
    const width = 720;
    const height = 420;
    return <g key={key}>
      {cells.slice(0, 2000).map((cell, index) => {
        if (!Array.isArray(cell) || cell.length < 3) return null;
        const x = num(cell[0]);
        const y = num(cell[1]);
        const value = num(cell[2]);
        const opacity = Math.max(0.08, Math.min(1, value));
        return <rect key={index} x={40 + x * (width - 80)} y={height - 40 - (y + 1) * (height - 80) / Math.max(1, yMax - yMin)}
          width={(width - 80) / Math.max(1, xMax - xMin)} height={(height - 80) / Math.max(1, yMax - yMin)}
          fill="#2563eb" opacity={opacity} />;
      })}
    </g>;
  }
  if (type === 'axes' || type === 'mermaid' || type === 'chart' || type === 'scene3d' || type === 'formula') {
    return null;
  }
  return null;
}

function FormulaOverlay({ node, canvasWidth, canvasHeight }: { node: Record<string, unknown>; canvasWidth: number; canvasHeight: number }) {
  const tex = str(node.tex);
  const style = styleOf(node);
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, trust: false, strict: false });
    } catch {
      return '';
    }
  }, [tex]);
  const left = `${(num(node.x) / Math.max(1, canvasWidth)) * 100}%`;
  const top = `${(num(node.y) / Math.max(1, canvasHeight)) * 100}%`;
  const align = str(style.align, 'left');
  const transform = align === 'center' ? 'translate(-50%, -50%)' : align === 'right' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  return (
    <div
      data-ast-formula={str(node.id)}
      style={{
        position: 'absolute',
        left,
        top,
        transform,
        pointerEvents: 'none',
        color: str(style.fill, '#0f172a'),
        fontSize: `${num(style.fontSize, 15)}px`,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    >
      {!html ? tex : null}
    </div>
  );
}

export function ViewAstRenderer({ ast, className, bindings = [], interactive = true, onParamChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ pointerId: number; handle: DragHandleSpec } | null>(null);
  const errors = useMemo(() => validateViewAst(ast, bindings), [ast, bindings]);
  const dragHandles = useMemo(() => extractDragHandles(ast), [ast]);
  if (errors.length) {
    return <p className="ppt-ai-view-error" role="alert">视图未通过白名单校验：{errors[0]}</p>;
  }
  const width = num(ast.width, 720);
  const height = num(ast.height, 420);
  const nodes = Array.isArray(ast.nodes) ? ast.nodes.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
  const overlayNodes = nodes.filter((node) => {
    const t = str(node.type);
    return t === 'mermaid' || t === 'scene3d' || t === 'formula';
  });

  const emitDrag = (handle: DragHandleSpec, clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || !onParamChange) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vx = ((clientX - rect.left) / rect.width) * width;
    const vy = ((clientY - rect.top) / rect.height) * height;
    const patch = mapDragPointToParams(handle, vx, vy);
    if (Object.keys(patch).length > 0) onParamChange(patch);
  };

  const onHandlePointerDown = (handle: DragHandleSpec, event: ReactPointerEvent<SVGGElement>) => {
    if (!interactive || !onParamChange || event.button !== 0) return;
    event.stopPropagation();
    draggingRef.current = { pointerId: event.pointerId, handle };
    event.currentTarget.setPointerCapture(event.pointerId);
    emitDrag(handle, event.clientX, event.clientY);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const active = draggingRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    emitDrag(active.handle, event.clientX, event.clientY);
  };

  const onHandlePointerUp = (event: ReactPointerEvent<SVGGElement>) => {
    const active = draggingRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const svgEl = (
    <svg ref={svgRef} className={overlayNodes.length ? undefined : className} style={overlayNodes.length ? { width: '100%', height: 'auto', display: 'block' } : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="专用视图">
      <rect x="0" y="0" width={width} height={height} fill="#f8fafc" rx="12" />
      {nodes.map((node, index) => {
        const nodeType = str(node.type);
        if (nodeType === 'axes') return <Axes key={`axes-${index}`} node={node} width={width} height={height} />;
        if (nodeType === 'chart') return <ChartNodeView key={`chart-${index}`} node={node} canvasWidth={width} canvasHeight={height} />;
        if (nodeType === 'mermaid' || nodeType === 'scene3d' || nodeType === 'formula') return null;
        return <RenderNode key={`node-${index}`} node={node} keyPrefix="" />;
      })}
      {interactive && onParamChange && dragHandles.map((handle) => (
        <g key={`drag-${handle.id}`}>
          <g
            data-ast-drag-handle={handle.id}
            role="slider"
            tabIndex={0}
            aria-label={handle.label || `拖动手柄 ${handle.id}`}
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => onHandlePointerDown(handle, event)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 16 : 6;
              const delta =
                event.key === 'ArrowLeft' ? [-step, 0] :
                event.key === 'ArrowRight' ? [step, 0] :
                event.key === 'ArrowUp' ? [0, -step] :
                event.key === 'ArrowDown' ? [0, step] : null;
              if (!delta) return;
              event.preventDefault();
              event.stopPropagation();
              const patch = mapDragPointToParams(handle, handle.x + delta[0]!, handle.y + delta[1]!);
              if (Object.keys(patch).length > 0) onParamChange(patch);
            }}
          >
            <circle cx={handle.x} cy={handle.y} r={16} fill="rgba(196, 98, 45, 0.16)" />
            <circle cx={handle.x} cy={handle.y} r={7} fill="#c4622d" stroke="#ffffff" strokeWidth={2} />
          </g>
          {handle.label && (
            <text x={handle.x + 14} y={handle.y - 10} fontSize={11} fontWeight={600} fill="#9a3412" style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {handle.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
  if (!overlayNodes.length) {
    return svgEl;
  }
  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      {svgEl}
      {overlayNodes.map((node, index) => {
        const nodeType = str(node.type);
        if (nodeType === 'scene3d') {
          return <Scene3dNodeView key={`scene3d-${index}`} node={node} canvasWidth={width} canvasHeight={height} />;
        }
        if (nodeType === 'formula') {
          return <FormulaOverlay key={`formula-${index}`} node={node} canvasWidth={width} canvasHeight={height} />;
        }
        return <MermaidNodeView key={`mermaid-${index}`} node={node} canvasWidth={width} canvasHeight={height} />;
      })}
    </div>
  );
}

export default ViewAstRenderer;
