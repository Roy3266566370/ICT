import { useId, type ReactNode } from 'react';
import type { DoubleIntegralPiece, DoubleIntegralResult, LabModel } from '@/labs/types';
import { compileExpression, formatNumber } from '@/labs/expr';
import { linearScale, niceTicks } from './charts';
import { Formula } from '@/components/showcase/Formula';
import styles from './DoubleIntegralCanvas.module.css';

type Point = { x: number; y: number };

function Frame({ points, children }: { points: Point[]; children: (sx: (v: number) => number, sy: (v: number) => number, xMin: number, xMax: number, yMin: number, yMax: number) => ReactNode }) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const dx = xMax - xMin || 1, dy = yMax - yMin || 1;
  const sx = linearScale([xMin - dx * 0.1, xMax + dx * 0.15], [56, 720]);
  const sy = linearScale([yMin - dy * 0.12, yMax + dy * 0.15], [350, 28]);
  return (
    <svg viewBox="0 0 760 410" role="img" className={styles.graph}>
      {niceTicks(xMin, xMax, 6).map(x => <g key={`x${x}`}><line x1={sx(x)} x2={sx(x)} y1="28" y2="350" className={styles.grid}/><text x={sx(x)} y="373" textAnchor="middle">{formatNumber(x,3)}</text></g>)}
      {niceTicks(yMin, yMax, 6).map(y => <g key={`y${y}`}><line x1="56" x2="720" y1={sy(y)} y2={sy(y)} className={styles.grid}/><text x="45" y={sy(y)+4} textAnchor="end">{formatNumber(y,3)}</text></g>)}
      <line x1="56" x2="720" y1="350" y2="350" className={styles.axis}/><line x1="56" x2="56" y1="28" y2="350" className={styles.axis}/>
      <text x="724" y="374">x</text><text x="40" y="22">y</text>
      {children(sx, sy, xMin, xMax, yMin, yMax)}
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

export function DoubleIntegralCanvas({model,result}:{model:LabModel;result:DoubleIntegralResult}) {
  const gradient = useId().replace(/:/g,'');
  if (result.region_kind === 'polar' && result.polar) return <PolarDoubleIntegralCanvas model={model} result={result} />;
  if (result.region_kind === 'pieces' && result.pieces?.length) return <PiecesDoubleIntegralCanvas model={model} result={result} />;
  const vertical = result.outer_variable === 'x';
  const {region,slice} = result;
  const all = region.flatMap(p=>vertical ? [{x:p.outer,y:p.lower},{x:p.outer,y:p.upper}]
    : [{x:p.lower,y:p.outer},{x:p.upper,y:p.outer}]);
  const xs = all.map(p=>p.x), ys = all.map(p=>p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const dx = xMax-xMin || 1, dy = yMax-yMin || 1;
  const sx = linearScale([xMin-dx*0.1,xMax+dx*0.15],[56,720]);
  const sy = linearScale([yMin-dy*0.12,yMax+dy*0.15],[350,28]);
  const point = (outer:number,inner:number) => vertical ? `${sx(outer)},${sy(inner)}` : `${sx(inner)},${sy(outer)}`;
  const lower = region.map(p=>point(p.outer,p.lower));
  const upper = region.map(p=>point(p.outer,p.upper));
  const polygon = `M${lower.join(' L')} L${[...upper].reverse().join(' L')} Z`;
  const lo = vertical ? {x:slice.position,y:slice.lower} : {x:slice.lower,y:slice.position};
  const hi = vertical ? {x:slice.position,y:slice.upper} : {x:slice.upper,y:slice.position};
  const maximum = Math.max(...result.sliceValues.map(p=>Math.abs(p.value)),1e-12);
  const a = model.outer_bounds![0], b = model.outer_bounds![1];
  const swapped = model.swapped ? (Array.isArray(model.swapped) ? model.swapped : [model.swapped]).filter(item=>item.region_verified) : [];
  return <div className={styles.root} data-testid="double-integral-model">
    <div className={styles.explanation}>
      <span className={styles.tag}>积分区域 D</span>
      <h3>先看区域，再看一条切片如何累加</h3>
      <p>{a} ≤ {result.outer_variable} ≤ {b}。固定 {result.outer_variable}，沿 {result.inner_variable} 从下边界积分到上边界，再扫过整个区域。</p>
    </div>
    <div className={styles.legend}>
      <span><i className={styles.lowerDot} />下边界 {result.inner_variable} = <Formula tex={model.inner_bounds_tex?.[0] ?? model.inner_bounds![0]} /></span>
      <span><i className={styles.upperDot} />上边界 {result.inner_variable} = <Formula tex={model.inner_bounds_tex?.[1] ?? model.inner_bounds![1]} /></span>
      <span><i className={styles.sliceDot} />当前积分切片</span>
    </div>
    <Frame points={all}>
      {(sx, sy) => <>
        <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4f46e5" stopOpacity="0.2"/><stop offset="1" stopColor="#14b8a6" stopOpacity="0.12"/></linearGradient></defs>
        <path d={polygon} fill={`url(#${gradient})`} data-testid="integral-region"/>
        <path d={`M${lower.join(' L')}`} className={styles.lower}/><path d={`M${upper.join(' L')}`} className={styles.upper}/>
        <line x1={sx(lo.x)} x2={sx(hi.x)} y1={sy(lo.y)} y2={sy(hi.y)} className={styles.slice}/>
        {[lo,hi].map((p,i)=><circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="5" className={styles.endpoint}/>)}
        <text x={sx(lo.x)+12} y={sy(lo.y)+18} className={styles.sliceLabel}>{result.outer_variable} = {formatNumber(slice.position,3)}</text>
        <text x="388" y="400" textAnchor="middle">阴影为积分区域；移动切片位置或播放时间轴，观察积分限的变化</text>
      </>}
    </Frame>
    <div className={styles.sliceReadout} aria-live="polite">
      <strong>当前切片</strong><span>{result.outer_variable} = {formatNumber(slice.position,4)}</span>
      <span>{formatNumber(slice.lower,4)} ≤ {result.inner_variable} ≤ {formatNumber(slice.upper,4)}</span>
      <span>长度 {formatNumber(slice.upper-slice.lower,4)}</span>
    </div>
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
