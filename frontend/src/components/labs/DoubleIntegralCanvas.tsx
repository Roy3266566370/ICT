import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DoubleIntegralPiece, DoubleIntegralResult, LabModel } from '@/labs/types';
import { compileExpression, formatNumber } from '@/labs/expr';
import { analyzeBoundary, buildBoundarySource, type BoundaryCurve } from '@/labs/boundaryHandles';
import { evaluateSandboxRegion } from '@/labs/doubleIntegral';
import { previewLabSwap, type SwapPreviewResult } from '@/api/labs';
import { clampBox, invertLinearScale, linearScale, niceTicks, snapToStep } from './charts';
import { LabFormula as Formula } from './ProblemText';
import styles from './DoubleIntegralCanvas.module.css';

type Point = { x: number; y: number };

function Frame({ points, children }: { points: Point[]; children: (sx: (v: number) => number, sy: (v: number) => number, xMin: number, xMax: number, yMin: number, yMax: number) => ReactNode }) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const dx = xMax - xMin || 1, dy = yMax - yMin || 1;
  const xLo = xMin - dx * 0.1, xHi = xMax + dx * 0.15;
  const yLo = yMin - dy * 0.12, yHi = yMax + dy * 0.15;
  const sx = linearScale([xLo, xHi], [56, 720]);
  const sy = linearScale([yLo, yHi], [350, 28]);
  return (
    <svg viewBox="0 0 760 410" role="img" className={styles.graph}>
      {niceTicks(xMin, xMax, 6).map(x => <g key={`x${x}`}><line x1={sx(x)} x2={sx(x)} y1="28" y2="350" className={styles.grid}/><text x={sx(x)} y="373" textAnchor="middle">{formatNumber(x,3)}</text></g>)}
      {niceTicks(yMin, yMax, 6).map(y => <g key={`y${y}`}><line x1="56" x2="720" y1={sy(y)} y2={sy(y)} className={styles.grid}/><text x="45" y={sy(y)+4} textAnchor="end">{formatNumber(y,3)}</text></g>)}
      <line x1="56" x2="720" y1="350" y2="350" className={styles.axis}/><line x1="56" x2="56" y1="28" y2="350" className={styles.axis}/>
      <text x="724" y="374">x</text><text x="40" y="22">y</text>
      {children(sx, sy, xLo, xHi, yLo, yHi)}
    </svg>
  );
}

function piecePolygon(piece: DoubleIntegralPiece, sx: (v: number) => number, sy: (v: number) => number, outer: 'x' | 'y') {
  const region = piece.region ?? [];
  const vertical = outer === 'x';
  if (!region.length) return '';
  const lower = region.map(p => vertical ? `${sx(p.outer)},${sy(p.lower)}` : `${sx(p.lower)},${sy(p.outer)}`);
  const upper = region.map(p => vertical ? `${sx(p.outer)},${sy(p.upper)}` : `${sx(p.upper)},${sy(p.outer)}`);
  return `M${lower.join(' L')} L${[...upper].reverse().join(' L')} Z`;
}

type BoundaryKey = 'lo' | 'hi';
type Samples = [number, number, number];
interface SandboxValues { lo: Samples; hi: Samples }

function stripPolygon(region: { outer: number; lower: number; upper: number }[], sx: (v: number) => number, sy: (v: number) => number, vertical: boolean): string {
  if (!region.length) return '';
  const lower = region.map(p => vertical ? `${sx(p.outer)},${sy(p.lower)}` : `${sx(p.lower)},${sy(p.outer)}`);
  const upper = region.map(p => vertical ? `${sx(p.outer)},${sy(p.upper)}` : `${sx(p.upper)},${sy(p.outer)}`);
  return `M${lower.join(' L')} L${[...upper].reverse().join(' L')} Z`;
}

export function DoubleIntegralCanvas({model,result,labId,problemId}:{model:LabModel;result:DoubleIntegralResult;labId?:string;problemId?:string}) {
  if (result.region_kind === 'polar' && result.polar) return <PolarDoubleIntegralCanvas model={model} result={result} />;
  if (result.region_kind === 'pieces' && result.pieces?.length) return <PiecesDoubleIntegralCanvas model={model} result={result} />;
  return <StripDoubleIntegralCanvas model={model} result={result} labId={labId} problemId={problemId} />;
}

function StripDoubleIntegralCanvas({model,result,labId,problemId}:{model:LabModel;result:DoubleIntegralResult;labId?:string;problemId?:string}) {
  const gradient = useId().replace(/:/g,'');
  const vertical = result.outer_variable === 'x';
  const outer = result.outer_variable as 'x' | 'y';
  const {region,slice} = result;

  const analysis = useMemo(() => {
    if (model.region_kind && model.region_kind !== 'strip') return null;
    const first = region[0], last = region[region.length - 1];
    if (!first || !last || !(first.outer < last.outer) || !model.inner_bounds) return null;
    const lo = analyzeBoundary(model.inner_bounds[0], outer, first.outer, last.outer);
    const hi = analyzeBoundary(model.inner_bounds[1], outer, first.outer, last.outer);
    if (!lo || !hi) return null;
    return { a: first.outer, b: last.outer, lo, hi };
  }, [model.inner_bounds, model.region_kind, outer, region]);

  const [sandbox, setSandbox] = useState<SandboxValues | null>(null);
  const sandboxRef = useRef<SandboxValues | null>(null);
  const [preview, setPreview] = useState<SwapPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewTimer = useRef<number | null>(null);
  const previewSeq = useRef(0);

  const boundsKey = `${(model.outer_bounds ?? []).join('|')}|${(model.inner_bounds ?? []).join('|')}|${model.integrand ?? ''}`;
  useEffect(() => {
    sandboxRef.current = null;
    setSandbox(null);
    setPreview(null);
    setPreviewError(null);
  }, [boundsKey]);

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewSeq.current += 1;
  }, []);

  const sandboxBounds = useMemo<[string, string] | null>(() => {
    if (!analysis) return null;
    const values = sandbox ?? { lo: analysis.lo.samples, hi: analysis.hi.samples };
    return [
      buildBoundarySource(analysis.lo.kind, outer, analysis.a, analysis.b, values.lo, analysis.lo.base),
      buildBoundarySource(analysis.hi.kind, outer, analysis.a, analysis.b, values.hi, analysis.hi.base),
    ];
  }, [analysis, outer, sandbox]);

  const sandboxEval = useMemo(() => {
    if (!sandboxBounds || !sandbox) return null;
    try {
      return { value: evaluateSandboxRegion(model, sandboxBounds, { slice: result.slice.position, n: 30 }) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '拖拽区域无法计算' };
    }
  }, [model, result.slice.position, sandbox, sandboxBounds]);

  const resetSandbox = (): void => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewSeq.current += 1;
    sandboxRef.current = null;
    setSandbox(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewBusy(false);
  };

  const requestPreview = (values: SandboxValues): void => {
    if (!labId || !analysis || !model.integrand || !model.outer_bounds) return;
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const innerBounds: [string, string] = [
        buildBoundarySource(analysis.lo.kind, outer, analysis.a, analysis.b, values.lo, analysis.lo.base),
        buildBoundarySource(analysis.hi.kind, outer, analysis.a, analysis.b, values.hi, analysis.hi.base),
      ];
      const seq = previewSeq.current + 1;
      previewSeq.current = seq;
      setPreviewBusy(true);
      setPreviewError(null);
      previewLabSwap({
        labId,
        ...(problemId ? { problemId } : {}),
        outerVariable: outer,
        outerBounds: model.outer_bounds as [string, string],
        innerBounds,
        integrand: model.integrand!,
      })
        .then((data) => { if (previewSeq.current === seq) setPreview(data); })
        .catch((cause) => {
          if (previewSeq.current !== seq) return;
          setPreview(null);
          setPreviewError(cause instanceof Error ? cause.message : '换序预览失败');
        })
        .finally(() => { if (previewSeq.current === seq) setPreviewBusy(false); });
    }, 250);
  };

  const startHandleDrag = (
    event: React.PointerEvent<SVGCircleElement>,
    key: BoundaryKey,
    index: 0 | 1 | 2,
    scales: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): void => {
    if (!analysis) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const inverse = vertical
      ? invertLinearScale([scales.yMin, scales.yMax], [350, 28])
      : invertLinearScale([scales.xMin, scales.xMax], [56, 720]);
    const move = (moveEvent: PointerEvent): void => {
      // PointerEvent 使用 CSS 像素；Frame 的 scale 使用 760×410 viewBox 坐标。
      const rect = svg.getBoundingClientRect();
      const viewX = ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * 760;
      const viewY = ((moveEvent.clientY - rect.top) / Math.max(1, rect.height)) * 410;
      const raw = inverse(vertical ? viewY : viewX);
      const snapped = snapToStep(raw, moveEvent.shiftKey ? 0.01 : 0.25);
      // 不夹在显示边界的 0.15 留白上：否则会得到 1.15 这类小数，
      // 符号内核做分段换序时容易误判。允许拖出视口两倍跨度，下一次渲染会自动扩展坐标。
      const span = vertical ? scales.yMax - scales.yMin : scales.xMax - scales.xMin;
      const low = (vertical ? scales.yMin : scales.xMin) - span * 2;
      const high = (vertical ? scales.yMax : scales.xMax) + span * 2;
      const bounded = clampBox(snapped, low, high);
      if (!Number.isFinite(bounded)) return;
      const base = sandboxRef.current ?? {
        lo: [...analysis.lo.samples] as Samples,
        hi: [...analysis.hi.samples] as Samples,
      };
      const nextSamples = [...base[key]] as Samples;
      nextSamples[index] = bounded;
      const next: SandboxValues = { ...base, [key]: nextSamples };
      sandboxRef.current = next;
      setSandbox(next);
      setPreview(null);
      setPreviewError(null);
    };
    const cancel = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
    const up = (): void => {
      cancel();
      if (sandboxRef.current) requestPreview(sandboxRef.current);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  };

  const currentValues: SandboxValues = sandbox ?? (analysis
    ? { lo: analysis.lo.samples, hi: analysis.hi.samples }
    : { lo: [0, 0, 0], hi: [0, 0, 0] });
  const sandboxRegion = sandboxEval?.value?.region ?? [];
  const sandboxPoints = sandboxRegion.flatMap(p => vertical
    ? [{ x: p.outer, y: p.lower }, { x: p.outer, y: p.upper }]
    : [{ x: p.lower, y: p.outer }, { x: p.upper, y: p.outer }]);
  const all = region.flatMap(p => vertical ? [{ x: p.outer, y: p.lower }, { x: p.outer, y: p.upper }]
    : [{ x: p.lower, y: p.outer }, { x: p.upper, y: p.outer }]);
  const framePoints = [...all, ...sandboxPoints];
  const xs = framePoints.map(p => p.x), ys = framePoints.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const dx = xMax - xMin || 1, dy = yMax - yMin || 1;
  const sx = linearScale([xMin - dx * 0.1, xMax + dx * 0.15], [56, 720]);
  const sy = linearScale([yMin - dy * 0.12, yMax + dy * 0.15], [350, 28]);
  const point = (outerValue: number, innerValue: number) => vertical ? `${sx(outerValue)},${sy(innerValue)}` : `${sx(innerValue)},${sy(outerValue)}`;
  const lower = region.map(p => point(p.outer, p.lower));
  const upper = region.map(p => point(p.outer, p.upper));
  const polygon = `M${lower.join(' L')} L${[...upper].reverse().join(' L')} Z`;
  const activeSlice = sandboxEval?.value?.slice ?? slice;
  const lo = vertical ? { x: activeSlice.position, y: activeSlice.lower } : { x: activeSlice.lower, y: activeSlice.position };
  const hi = vertical ? { x: activeSlice.position, y: activeSlice.upper } : { x: activeSlice.upper, y: activeSlice.position };
  const maximum = Math.max(...result.sliceValues.map(p => Math.abs(p.value)), 1e-12);
  const a = model.outer_bounds![0], b = model.outer_bounds![1];
  const swapped = model.swapped ? (Array.isArray(model.swapped) ? model.swapped : [model.swapped]).filter(item => item.region_verified) : [];
  const handleFor = (key: BoundaryKey): BoundaryCurve | null => (analysis ? analysis[key] : null);
  return <div className={styles.root} data-testid="double-integral-model">
    <div className={styles.explanation}>
      <span className={styles.tag}>积分区域 D</span>
      <h3>先看区域，再看一条切片如何累加</h3>
      <p>{a} ≤ {result.outer_variable} ≤ {b}。固定 {result.outer_variable}，沿 {result.inner_variable} 从下边界积分到上边界，再扫过整个区域。{sandbox ? '当前显示拖拽沙盒；原题区域以虚线冻结在底层。' : ''}</p>
    </div>
    <div className={styles.legend}>
      <span><i className={styles.lowerDot} />下边界 {result.inner_variable} = <Formula tex={model.inner_bounds_tex?.[0] ?? model.inner_bounds![0]} /></span>
      <span><i className={styles.upperDot} />上边界 {result.inner_variable} = <Formula tex={model.inner_bounds_tex?.[1] ?? model.inner_bounds![1]} /></span>
      <span><i className={styles.sliceDot} />当前积分切片</span>
      {sandbox ? <span><i className={styles.baselineDot} />原题边界（冻结）</span> : null}
    </div>
    <Frame points={framePoints}>
      {(sxFrame, syFrame, frameXMin, frameXMax, frameYMin, frameYMax) => <>
        <defs>
          <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4f46e5" stopOpacity="0.2"/><stop offset="1" stopColor="#14b8a6" stopOpacity="0.12"/></linearGradient>
        </defs>
        <path d={polygon} fill={sandbox ? 'none' : `url(#${gradient})`} className={sandbox ? styles.baselineGhost : undefined} data-testid="integral-region"/>
        {sandbox ? <path d={stripPolygon(sandboxRegion, sxFrame, syFrame, vertical)} className={styles.sandboxRegion} data-testid="sandbox-region"/> : null}
        <path d={`M${lower.join(' L')}`} className={sandbox ? `${styles.lower} ${styles.baselineLine}` : styles.lower}/>
        <path d={`M${upper.join(' L')}`} className={sandbox ? `${styles.upper} ${styles.baselineLine}` : styles.upper}/>
        <line x1={sxFrame(lo.x)} x2={sxFrame(hi.x)} y1={syFrame(lo.y)} y2={syFrame(hi.y)} className={styles.slice}/>
        {[lo, hi].map((p, i) => <circle key={i} cx={sxFrame(p.x)} cy={syFrame(p.y)} r="5" className={styles.endpoint}/>)}
        <text x={sxFrame(lo.x) + 12} y={syFrame(lo.y) + 18} className={styles.sliceLabel}>{result.outer_variable} = {formatNumber(activeSlice.position, 3)}</text>
        {analysis ? (['lo', 'hi'] as const).flatMap(key => {
          const curve = handleFor(key);
          if (!curve) return [];
          return curve.handles.map(index => {
            const outerValue = [analysis.a, (analysis.a + analysis.b) / 2, analysis.b][index]!;
            const innerValue = currentValues[key][index]!;
            const handlePoint = vertical ? { x: outerValue, y: innerValue } : { x: innerValue, y: outerValue };
            return <circle
              key={`${key}-${index}`}
              cx={sxFrame(handlePoint.x)}
              cy={syFrame(handlePoint.y)}
              r="6.5"
              className={styles.boundaryHandle}
              data-handle={`${key}-${index}`}
              onPointerDown={(event) => startHandleDrag(event, key, index, { xMin: frameXMin, xMax: frameXMax, yMin: frameYMin, yMax: frameYMax })}
            />;
          });
        }) : null}
        <text x="388" y="400" textAnchor="middle">{analysis ? '拖动空心控制点反推边界；按住 Shift 连续微调' : '阴影为积分区域；移动切片位置或播放时间轴，观察积分限的变化'}</text>
      </>}
    </Frame>
    <div className={styles.sliceReadout} aria-live="polite">
      <strong>当前切片</strong><span>{result.outer_variable} = {formatNumber(activeSlice.position,4)}</span>
      <span>{formatNumber(activeSlice.lower,4)} ≤ {result.inner_variable} ≤ {formatNumber(activeSlice.upper,4)}</span>
      <span>长度 {formatNumber(activeSlice.upper-activeSlice.lower,4)}</span>
      {sandbox && sandboxEval?.value ? <span>沙盒中点和 ≈ {formatNumber(sandboxEval.value.approx, 6)}（非原题真值）</span> : null}
    </div>
    {analysis ? (
      <div className={styles.sandboxPanel} data-testid="double-integral-sandbox">
        <div className={styles.sandboxHead}><strong>拖拽边界 · 沙盒反推</strong><span>原题条件冻结</span></div>
        <p className={styles.sandboxHint}>拖动边界上的空心控制点改变区域；松手后由后端符号内核检查分段换序与面积守恒。沙盒数值只用于观察，不覆盖原题答案。</p>
        <div className={styles.sandboxActions}>
          <button type="button" onClick={resetSandbox} disabled={!sandbox}>还原原题区域</button>
          {!labId ? <span>共享视图仅本地预览，不调用后端换序。</span> : previewBusy ? <span>正在符号换序…</span> : null}
        </div>
        {sandbox ? <div className={styles.sandboxReadout}>
          <span>反推下界：{sandboxBounds?.[0]}</span>
          <span>反推上界：{sandboxBounds?.[1]}</span>
          {sandboxEval && 'error' in sandboxEval ? <b role="alert">{sandboxEval.error}</b> : null}
        </div> : null}
        {previewError ? <p className={styles.sandboxError} role="alert">{previewError}</p> : null}
        {preview && !preview.supported ? <p className={styles.sandboxError}>{preview.reason ?? '当前区域无法符号换序。'}</p> : null}
        {preview?.supported && preview.swaps?.length ? <div className={styles.sandboxSwaps}>
          {preview.swaps.map((item, index) => <span key={index}>第 {index + 1} 段：<Formula tex={item.formula_tex} /> = {item.exact}</span>)}
        </div> : null}
      </div>
    ) : <p className={styles.sandboxHint}>当前边界不是线性/二次曲线，暂不提供拖拽反推；原题区域仍按内核结果展示。</p>}
    <div className={styles.values}>
      <span>沿切片的被积函数值</span>
      <div className={styles.colorStrip}>{result.sliceValues.map((p,i)=><i key={i} title={`${result.inner_variable}=${formatNumber(p.position,3)}，f=${formatNumber(p.value,4)}`}
        style={{background:`hsl(${p.value < 0 ? 15 : 245} 70% ${92-50*Math.abs(p.value)/maximum}%)`}} />)}</div>
      <small>颜色深浅表示 |f| 的相对大小；积分累加的是函数值 × 面积</small>
    </div>
    <div className={styles.formula}><Formula tex={model.formula_tex ?? ''} block /></div>
    {swapped.length ? <div className={styles.legend}>{swapped.map((item,index)=><span key={index}>换序：<Formula tex={item.formula_tex}/></span>)}</div> : null}
  </div>;
}

function PiecesDoubleIntegralCanvas({model,result}:{model:LabModel;result:DoubleIntegralResult}) {
  const gradient = useId().replace(/:/g,'');
  const outer = (result.outer_variable === 'theta' ? 'x' : result.outer_variable) as 'x' | 'y';
  const pieces = result.pieces ?? [];
  const scalar = (source: string) => compileExpression(source, []).evalOrNull({}) ?? 0;
  const points = pieces.flatMap(piece => (piece.region ?? []).flatMap(p => outer === 'x'
    ? [{x:p.outer,y:p.lower},{x:p.outer,y:p.upper}]
    : [{x:p.lower,y:p.outer},{x:p.upper,y:p.outer}]));
  const swapped = model.swapped ? (Array.isArray(model.swapped) ? model.swapped : [model.swapped]).filter(item=>item.region_verified) : [];
  return <div className={styles.root} data-testid="double-integral-model">
    <div className={styles.explanation}>
      <span className={styles.tag}>分片区域 D</span>
      <h3>各片外层区间互不重叠，逐片积分后求和</h3>
      <p>共 {pieces.length} 片；当前切片位于第 {(pieces.find(piece => {
        const a = scalar(piece.outer_bounds[0]), b = scalar(piece.outer_bounds[1]);
        return result.slice.position >= a && result.slice.position <= b;
      }) ?? pieces[0])?.index ?? 1} 片。区域与数值近似逐片对应。</p>
    </div>
    <div className={styles.legend}>
      <span><i className={styles.sliceDot} />分片边界</span>
      <span><i className={styles.lowerDot} />各片下边界</span>
      <span><i className={styles.upperDot} />各片上边界</span>
    </div>
    <Frame points={points}>
      {(sx, sy) => <>
        <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4f46e5" stopOpacity="0.2"/><stop offset="1" stopColor="#14b8a6" stopOpacity="0.12"/></linearGradient></defs>
        {pieces.map((piece, index) => <g key={index}>
          <path d={piecePolygon(piece, sx, sy, outer)} fill={`url(#${gradient})`} stroke="#6366f1" strokeWidth="1.2" data-testid={`integral-region-${index}`}/>
          {piece.region?.length ? <text x={sx(piece.region[0]!.outer)} y={sy(piece.region[0]!.upper)} className={styles.sliceLabel}>第 {piece.index} 片 · {piece.exact}</text> : null}
        </g>)}
        {pieces.length ? <line x1={sx(result.slice.position)} x2={sx(result.slice.position)} y1={sy(result.slice.lower)} y2={sy(result.slice.upper)} className={styles.slice}/> : null}
        <text x="388" y="400" textAnchor="middle">分片区域逐片积分后求和；移动切片查看当前分片</text>
      </>}
    </Frame>
    <div className={styles.sliceReadout} aria-live="polite">
      <strong>当前切片</strong><span>{outer} = {formatNumber(result.slice.position,4)}</span>
      <span>{formatNumber(result.slice.lower,4)} ≤ {result.inner_variable} ≤ {formatNumber(result.slice.upper,4)}</span>
    </div>
    <div className={styles.legend}>{pieces.map(piece => <span key={piece.index}>第 {piece.index} 片 = {piece.exact}</span>)}</div>
    <div className={styles.formula}><Formula tex={model.formula_tex ?? ''} block /></div>
    {swapped.length ? <div className={styles.legend}>{swapped.map((item,index)=><span key={index}>换序：<Formula tex={item.formula_tex}/></span>)}</div> : null}
  </div>;
}

function PolarDoubleIntegralCanvas({model,result}:{model:LabModel;result:DoubleIntegralResult}) {
  const gradient = useId().replace(/:/g,'');
  const polar = result.polar!;
  const outerPoints = polar.outer_points ?? [];
  const innerPoints = polar.inner_points ?? [];
  const points = [...outerPoints, ...innerPoints];
  return <div className={styles.root} data-testid="double-integral-model">
    <div className={styles.explanation}>
      <span className={styles.tag}>极坐标区域 D</span>
      <h3>先固定 θ，再沿 r 从内边界扫到外边界</h3>
      <p>θ ∈ [{polar.theta_bounds[0]}, {polar.theta_bounds[1]}]；r ∈ [{polar.r_bounds[0]}, {polar.r_bounds[1]}]。面积元为 r dr dθ。</p>
    </div>
    <div className={styles.legend}>
      <span><i className={styles.lowerDot} />内边界 r = <Formula tex={polar.r_bounds_tex?.[0] ?? polar.r_bounds[0]} /></span>
      <span><i className={styles.upperDot} />外边界 r = <Formula tex={polar.r_bounds_tex?.[1] ?? polar.r_bounds[1]} /></span>
      <span><i className={styles.sliceDot} />当前 θ 切片</span>
    </div>
    <Frame points={points.length ? points : [{x:-1,y:-1},{x:1,y:1}]}>
      {(sx, sy) => {
        const outer = outerPoints.map(p => `${sx(p.x)},${sy(p.y)}`);
        const inner = innerPoints.map(p => `${sx(p.x)},${sy(p.y)}`);
        const path = outer.length ? `M${outer.join(' L')} Z ${inner.length ? `M${inner.join(' L')} Z` : ''}` : '';
        const theta = polar.slice?.theta ?? result.slice.position;
        const rLower = polar.slice?.r_lower ?? result.slice.lower;
        const rUpper = polar.slice?.r_upper ?? result.slice.upper;
        return <>
          <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4f46e5" stopOpacity="0.2"/><stop offset="1" stopColor="#14b8a6" stopOpacity="0.12"/></linearGradient></defs>
          <path d={path} fill={`url(#${gradient})`} fillRule="evenodd" data-testid="integral-region"/>
          <line x1={sx(rLower*Math.cos(theta))} x2={sx(rUpper*Math.cos(theta))} y1={sy(rLower*Math.sin(theta))} y2={sy(rUpper*Math.sin(theta))} className={styles.slice}/>
          <text x={sx(rUpper*Math.cos(theta))+12} y={sy(rUpper*Math.sin(theta))+18} className={styles.sliceLabel}>θ = {formatNumber(theta,3)}</text>
          <text x="388" y="400" textAnchor="middle">扇形/圆环区域由 θ、r 边界决定；阴影为当前极坐标区域</text>
        </>;
      }}
    </Frame>
    <div className={styles.sliceReadout} aria-live="polite">
      <strong>当前切片</strong><span>θ = {formatNumber(result.slice.position,4)}</span>
      <span>{formatNumber(result.slice.lower,4)} ≤ r ≤ {formatNumber(result.slice.upper,4)}</span>
      <span>Jacobian = r</span>
    </div>
    <div className={styles.formula}><Formula tex={model.formula_tex ?? ''} block /></div>
  </div>;
}
