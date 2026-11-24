import { memo, useMemo, useRef, useState, useCallback, useLayoutEffect, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { FigureScene, ISpec } from '@/ispec/types';
import { isOffBaseline, type RecognizedRegion } from './liveRegions';
import { useRingBackground } from './bgSample';
import styles from './Live.module.css';

type Cells = Record<string, number | boolean | string>;
type Vec = [number, number];

const EPS = 1e-6;
const UNIT_SQUARE: Vec[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

interface Shared {
  pageSize: { width: number; height: number };
  pageImageUrl?: string;
  place: (bbox: { x: number; y: number; w: number; h: number }, elementId: string) => CSSProperties;
  disabled: boolean;
  flashKey: string | null;
  onChange: (spec: ISpec, id: string, value: number) => void;
  onExpand?: (specId: string) => void;
}

interface Props {
  region: RecognizedRegion;
  spec: ISpec;
  cells: Cells;
  shared: Shared;
  reducedMotion: boolean;
}

function num(v: number | boolean | string | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function rgba(rgb: [number, number, number] | undefined, alpha = 1): string {
  const [r, g, b] = rgb ?? [121, 138, 163];
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/** 基线矩阵可逆时，把形状顶点换算回"源形状"（单位坐标系）；奇异时用单位正方形。 */
function sourceVertices(scene: FigureScene): Vec[] {
  if (!scene.shape || scene.shape.vertices.length < 2) return UNIT_SQUARE;
  const [a, b, c, d] = scene.baseline;
  const det = a * d - b * c;
  const [ox, oy] = scene.origin;
  const u = scene.unit_px || 1;
  const toMath = (p: [number, number]): Vec => [(p[0] - ox) / u, -(p[1] - oy) / u];
  if (Math.abs(det) < EPS) return UNIT_SQUARE;
  return scene.shape.vertices.map(p => {
    const [mx, my] = toMath(p);
    return [(d * mx - b * my) / det, (-c * mx + a * my) / det];
  });
}

/** 按当前矩阵把源形状顶点投回原图像素坐标。 */
function project(scene: FigureScene, v: Vec): Vec {
  const [ox, oy] = scene.origin;
  const u = scene.unit_px || 1;
  return [ox + v[0] * u, oy - v[1] * u];
}

interface CaptionText { parts: Array<{ text: string; accent?: boolean }> }

/** 按原图注句式重写当前取值；句式不适配时退回坐标写法。 */
function captionText(scene: FigureScene, m: [number, number, number, number]): CaptionText | null {
  const caption = scene.caption;
  if (!caption) return null;
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.015;
  const T = caption.template;
  const area = fmt(det);
  const flipped = det < -EPS ? '（定向翻转）' : '';
  if (T === 'scale' && near(b, 0) && near(c, 0) && a > 0 && d > 0) {
    return { parts: [{ text: `横向 ${fmt(a)} 倍、纵向 ${fmt(d)} 倍　面积 ` }, { text: area + flipped, accent: true }] };
  }
  if (T === 'shear' && det > -EPS) {
    return { parts: [{ text: '剪切　面积' }, { text: near(det, 1) ? '仍是 1' : ` ${area}`, accent: true }] };
  }
  if (T === 'collapse' && near(d, 0) && near(b, 0)) {
    return { parts: [{ text: '压到横轴　面积 ' }, { text: '0', accent: true }] };
  }
  if (T === 'unit' && near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1)) {
    return { parts: [{ text: '单位方格　面积 ' }, { text: '1', accent: true }] };
  }
  return { parts: [
    { text: `e₁→(${fmt(a)}, ${fmt(c)}) e₂→(${fmt(b)}, ${fmt(d)})　面积 ` },
    { text: area + flipped, accent: true },
  ] };
}

/** 图内 OCR 标签：binding=height_d 的标签跟随纵向分量改文案，其余保持原文。 */
function labelText(scene: FigureScene, label: NonNullable<FigureScene['labels']>[number], d: number): string {
  if (label.binding !== 'height_d') return label.text;
  const baseD = scene.baseline[3];
  if (Math.abs(d - baseD) < 0.015) return label.text;
  if (Math.abs(d) < 0.015) return '高度归零';
  return `高度 ×${fmt(d)}`;
}

function Caption({ scene, text, shared, cover }: {
  scene: FigureScene; text: CaptionText; shared: Shared; cover: string;
}) {
  const caption = scene.caption!;
  const ref = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(0);
  const run = caption.runs?.[0];
  const ratio = (run?.size_pt ?? 11.25) * 12700 / Math.max(1, caption.bbox_emu.h);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setFontPx(node.clientHeight * ratio * 0.92);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ratio]);
  return <div ref={ref} className={styles.liveCaption} data-no-pan
    style={{ ...shared.place(caption.bbox_emu, caption.element_id), background: cover }}>
    <span style={{
      fontSize: fontPx || undefined,
      fontFamily: run?.font ? `'${run.font}', '微软雅黑', 'Microsoft YaHei', sans-serif` : undefined,
      color: run?.color ? `#${run.color}` : (caption.accent ? `#${caption.accent}` : '#7a8aa3'),
      textAlign: (caption.align as 'left' | 'center' | 'right') ?? undefined,
    }}>
      {text.parts.map((part, i) => part.accent
        ? <b key={i} style={{ color: '#c4622d' }}>{part.text}</b>
        : <span key={i}>{part.text}</span>)}
    </span>
  </div>;
}

/**
 * 读图重建的原位图形：闲置时原图原样透出；悬停或参数偏离原稿后，
 * 在图片原位按识别出的坐标轴/线型/配色重画矢量图，拖动向量端点改矩阵。
 */
function RecognizedFigureInner({ region, spec, cells, shared, reducedMotion }: Props) {
  const scene = region.scene;
  const bind = scene.bind!;
  const [dragging, setDragging] = useState<0 | 1 | 2>(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const m: [number, number, number, number] = [
    num(cells[bind.a], scene.baseline[0]), num(cells[bind.b], scene.baseline[1]),
    num(cells[bind.c], scene.baseline[2]), num(cells[bind.d], scene.baseline[3]),
  ];
  const dirty = spec.parameters.some(p => (p.id === bind.a || p.id === bind.b || p.id === bind.c || p.id === bind.d)
    && isOffBaseline(p, cells[p.id]));
  const active = true;
  const det = m[0] * m[3] - m[1] * m[2];

  const fraction = useMemo(() => ({
    x: region.bbox.x / shared.pageSize.width, y: region.bbox.y / shared.pageSize.height,
    w: region.bbox.w / shared.pageSize.width, h: region.bbox.h / shared.pageSize.height,
  }), [region.bbox, shared.pageSize.width, shared.pageSize.height]);
  const cover = useRingBackground(shared.pageImageUrl, fraction, true) ?? '#ffffff';

  const [iw, ih] = scene.image_px;
  const source = useMemo(() => sourceVertices(scene), [scene]);
  const verts = source.map(v => project(scene, [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]]));
  const points = verts.map(v => v.join(',')).join(' ');
  const basePoints = useMemo(() => scene.shape?.vertices.map(v => v.join(',')).join(' ') ?? '', [scene.shape]);

  const u = scene.unit_px || 1;
  const [ox, oy] = scene.origin;
  const tip1: Vec = [ox + m[0] * u, oy - m[2] * u];
  const tip2: Vec = [ox + m[1] * u, oy - m[3] * u];
  /** 端点被压到原点附近时，把拖柄沿对应轴向挪出来一点，否则抓不到。 */
  const handleAt = (tip: Vec, dir: Vec): Vec => {
    const dx = tip[0] - ox, dy = tip[1] - oy;
    if (Math.hypot(dx, dy) > u * 0.12) return tip;
    return [ox + dir[0] * u * 0.12, oy - dir[1] * u * 0.12];
  };
  const h1 = handleAt(tip1, [1, 0]);
  const h2 = handleAt(tip2, [0, 1]);

  const toImage = useCallback((event: { clientX: number; clientY: number }): Vec | null => {
    const node = svgRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return [(event.clientX - rect.left) * iw / rect.width, (event.clientY - rect.top) * ih / rect.height];
  }, [iw, ih]);

  const commit = useCallback((which: 1 | 2, point: Vec) => {
    const mx = Math.round(((point[0] - ox) / u) * 50) / 50;
    const my = Math.round(-((point[1] - oy) / u) * 50) / 50;
    if (which === 1) { shared.onChange(spec, bind.a, mx); shared.onChange(spec, bind.c, my); }
    else { shared.onChange(spec, bind.b, mx); shared.onChange(spec, bind.d, my); }
  }, [bind, ox, oy, u, shared, spec]);

  const down = (which: 1 | 2) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (shared.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(which);
  };
  const move = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragging) return;
    const point = toImage(event);
    if (point) commit(dragging, point);
  };
  const up = () => setDragging(0);

  const keyNudge = (which: 1 | 2, dx: number, dy: number) => {
    const [x, y] = which === 1 ? [m[0], m[2]] : [m[1], m[3]];
    const nx = Math.round((x + dx) * 50) / 50, ny = Math.round((y + dy) * 50) / 50;
    if (which === 1) { shared.onChange(spec, bind.a, nx); shared.onChange(spec, bind.c, ny); }
    else { shared.onChange(spec, bind.b, nx); shared.onChange(spec, bind.d, ny); }
  };

  const stroke = scene.shape?.stroke_color;
  const strokeW = scene.shape?.stroke_width ?? 6;
  const fill = scene.shape?.fill;
  const axesColor = scene.axes?.color;
  const axesAlpha = (scene.axes?.alpha ?? 160) / 255;
  const caption = captionText(scene, m);
  const captionChanged = caption !== null && caption.parts.map(p => p.text).join('') !== (scene.caption?.text ?? '');

  const resetPanel = () => {
    shared.onChange(spec, bind.a, scene.baseline[0]);
    shared.onChange(spec, bind.b, scene.baseline[1]);
    shared.onChange(spec, bind.c, scene.baseline[2]);
    shared.onChange(spec, bind.d, scene.baseline[3]);
  };

  return <>
    <div className={styles.figureHost} data-active={active} data-reduced={reducedMotion}
      data-live-region={region.key} data-live-kind="figure" data-live-title={spec.title ?? '图形'}
      data-live-params={[bind.a, bind.b, bind.c, bind.d].join('、')} data-flash={shared.flashKey === region.key}
      data-recognized="true" data-no-pan
      style={shared.place(region.bbox, region.elementId)}>
      <div className={styles.figureCornerActions}>
        {dirty && <button type="button" onClick={resetPanel} title="恢复本图原稿">重置</button>}
        {shared.onExpand && <button type="button" onClick={() => shared.onExpand?.(spec.object_id)}
          aria-label={`展开实验页：${spec.title ?? '交互'}`} title="展开为完整实验页">↗</button>}
      </div>
      {active && <svg ref={svgRef} className={styles.recognizedSvg} viewBox={`0 0 ${iw} ${ih}`}
        preserveAspectRatio="none" role="img" aria-label={`${spec.title ?? '图形'}：拖动端点调整矩阵`}>
        <rect x={0} y={0} width={iw} height={ih} fill={cover}/>
        {scene.axes?.h && <line x1={scene.axes.h.x0} y1={scene.axes.h.y} x2={scene.axes.h.x1} y2={scene.axes.h.y}
          stroke={rgba(axesColor, axesAlpha)} strokeWidth={scene.axes.h.width ?? 4}/>}
        {scene.axes?.v && <line x1={scene.axes.v.x} y1={scene.axes.v.y0} x2={scene.axes.v.x} y2={scene.axes.v.y1}
          stroke={rgba(axesColor, axesAlpha)} strokeWidth={scene.axes.v.width ?? 4}/>}
        {scene.dashed && <line
          x1={scene.dashed.orientation === 'v' ? scene.dashed.x! : scene.dashed.x0!}
          y1={scene.dashed.orientation === 'v' ? scene.dashed.y0! : scene.dashed.y!}
          x2={scene.dashed.orientation === 'v' ? scene.dashed.x! : scene.dashed.x1!}
          y2={scene.dashed.orientation === 'v' ? scene.dashed.y1! : scene.dashed.y!}
          stroke={rgba(scene.dashed.color, (scene.dashed.alpha ?? 200) / 255)}
          strokeWidth={scene.dashed.width ?? 4}
          strokeDasharray={`${scene.dashed.dash ?? 12} ${scene.dashed.gap ?? 12}`}/>}
        {dirty && basePoints && <polygon points={basePoints} fill="none"
          stroke={rgba(stroke, 0.45)} strokeWidth={Math.max(2, strokeW * 0.55)}
          strokeDasharray="10 8"/>}
        {verts.length >= 3 && Math.abs(det) > EPS
          ? <polygon points={points} fill={rgba(fill ? [fill[0], fill[1], fill[2]] : stroke, fill?.[3] ?? 0.12)}
              stroke={rgba(stroke)} strokeWidth={strokeW} strokeLinejoin="round"/>
          : verts.length >= 2 && <polyline points={verts.map(v => v.join(',')).join(' ')} fill="none"
              stroke={rgba(stroke)} strokeWidth={strokeW} strokeLinejoin="round"/>}
        {(scene.labels ?? []).map((label, i) => {
          const [x0, y0, x1, y1] = label.box;
          return <text key={i} x={(x0 + x1) / 2} y={(y0 + y1) / 2 + (label.height ?? (y1 - y0)) * 0.35}
            textAnchor="middle" fontSize={(label.height ?? (y1 - y0)) * 0.9}
            fill={rgba(label.color)} style={{ userSelect: 'none' }}>{labelText(scene, label, m[3])}</text>;
        })}
        {!shared.disabled && <>
          <line x1={ox} y1={oy} x2={h1[0]} y2={h1[1]} stroke={rgba(stroke, 0.5)} strokeWidth={3}/>
          <line x1={ox} y1={oy} x2={h2[0]} y2={h2[1]} stroke={rgba(stroke, 0.5)} strokeWidth={3}/>
          <circle cx={h1[0]} cy={h1[1]} r={14} className={styles.handle}
            fill="#fff" stroke={rgba(stroke)} strokeWidth={5}
            role="slider" aria-label="拖动第 1 列向量端点" aria-valuetext={`(${fmt(m[0])}, ${fmt(m[2])})`}
            tabIndex={0} onPointerDown={down(1)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onKeyDown={e => {
              const s = e.shiftKey ? 0.5 : 0.1;
              if (e.key === 'ArrowLeft') { keyNudge(1, -s, 0); e.preventDefault(); }
              if (e.key === 'ArrowRight') { keyNudge(1, s, 0); e.preventDefault(); }
              if (e.key === 'ArrowUp') { keyNudge(1, 0, s); e.preventDefault(); }
              if (e.key === 'ArrowDown') { keyNudge(1, 0, -s); e.preventDefault(); }
            }}/>
          <circle cx={h2[0]} cy={h2[1]} r={14} className={styles.handle}
            fill="#fff" stroke={rgba(stroke)} strokeWidth={5}
            role="slider" aria-label="拖动第 2 列向量端点" aria-valuetext={`(${fmt(m[1])}, ${fmt(m[3])})`}
            tabIndex={0} onPointerDown={down(2)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onKeyDown={e => {
              const s = e.shiftKey ? 0.5 : 0.1;
              if (e.key === 'ArrowLeft') { keyNudge(2, -s, 0); e.preventDefault(); }
              if (e.key === 'ArrowRight') { keyNudge(2, s, 0); e.preventDefault(); }
              if (e.key === 'ArrowUp') { keyNudge(2, 0, s); e.preventDefault(); }
              if (e.key === 'ArrowDown') { keyNudge(2, 0, -s); e.preventDefault(); }
            }}/>
        </>}
      </svg>}
    </div>
    {captionChanged && caption && <Caption scene={scene} text={caption} shared={shared} cover={cover}/>}
  </>;
}

/** 仅当自身绑定的 4 个矩阵参数或布局/配置变化时重绘，避免拖动一张图时连带重绘同页其他图。 */
export const RecognizedFigure = memo(RecognizedFigureInner, (prev, next) => {
  if (
    prev.region !== next.region ||
    prev.spec !== next.spec ||
    prev.shared !== next.shared ||
    prev.reducedMotion !== next.reducedMotion
  ) {
    return false;
  }
  const bind = next.region.scene.bind;
  if (!bind) return prev.cells === next.cells;
  return (
    Object.is(prev.cells[bind.a], next.cells[bind.a]) &&
    Object.is(prev.cells[bind.b], next.cells[bind.b]) &&
    Object.is(prev.cells[bind.c], next.cells[bind.c]) &&
    Object.is(prev.cells[bind.d], next.cells[bind.d])
  );
});
