import { useMemo } from 'react';
import { validateViewAst } from '@/ppt-ai/sandbox/protocol';
import { ChartNodeView } from './ChartNodeView';
import { MermaidNodeView } from './MermaidNodeView';
import { Scene3dNodeView } from './Scene3dNodeView';

interface Props { ast: Record<string, unknown>; className?: string; bindings?: string[] }

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
  if (type === 'axes' || type === 'mermaid' || type === 'chart' || type === 'scene3d') {
    return null;
  }
  return null;
}

export function ViewAstRenderer({ ast, className, bindings = [] }: Props) {
  const errors = useMemo(() => validateViewAst(ast, bindings), [ast, bindings]);
  if (errors.length) {
    return <p className="ppt-ai-view-error" role="alert">视图未通过白名单校验：{errors[0]}</p>;
  }
  const width = num(ast.width, 720);
  const height = num(ast.height, 420);
  const nodes = Array.isArray(ast.nodes) ? ast.nodes.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
  const overlayNodes = nodes.filter((node) => {
    const t = str(node.type);
    return t === 'mermaid' || t === 'scene3d';
  });
  const svgEl = (
    <svg className={overlayNodes.length ? undefined : className} style={overlayNodes.length ? { width: '100%', height: 'auto', display: 'block' } : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="专用视图">
      <rect x="0" y="0" width={width} height={height} fill="#f8fafc" rx="12" />
      {nodes.map((node, index) => {
        const nodeType = str(node.type);
        if (nodeType === 'axes') return <Axes key={`axes-${index}`} node={node} width={width} height={height} />;
        if (nodeType === 'chart') return <ChartNodeView key={`chart-${index}`} node={node} canvasWidth={width} canvasHeight={height} />;
        if (nodeType === 'mermaid' || nodeType === 'scene3d') return null;
        return <RenderNode key={`node-${index}`} node={node} keyPrefix="" />;
      })}
    </svg>
  );
  if (!overlayNodes.length) {
    return svgEl;
  }
  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      {svgEl}
      {overlayNodes.map((node, index) =>
        str(node.type) === 'scene3d' ? (
          <Scene3dNodeView key={`scene3d-${index}`} node={node} canvasWidth={width} canvasHeight={height} />
        ) : (
          <MermaidNodeView key={`mermaid-${index}`} node={node} canvasWidth={width} canvasHeight={height} />
        ),
      )}
    </div>
  );
}

export default ViewAstRenderer;
