import { useEffect, useState } from 'react';
import { basisComposition } from '@/document/basisComposition';
import type { BasisOverlayEvaluation } from '@/document/relations';
import type { BasisOverlay, SceneNode } from '@/document/types';
import { vectorEndpoints } from '@/document/vectorGeometry';

export function BasisRelationOverlay({ overlay, progress }: {
  overlay: BasisOverlayEvaluation;
  progress: number;
}) {
  if (overlay.hasBoundLabel && overlay.hasBoundGuides) return null;
  const title = overlay.title ?? [Math.max(24, overlay.origin[0] - 40), Math.max(24, overlay.origin[1] - 64)];
  const fontSize = overlay.fontSize ?? 22;
  const segment = (a: [number, number], b: [number, number], fraction: number, key: string) =>
    fraction > 0 && <line data-basis-segment={key} x1={a[0]} y1={a[1]}
      x2={fraction >= 1 ? b[0] : a[0] + (b[0] - a[0]) * fraction}
      y2={fraction >= 1 ? b[1] : a[1] + (b[1] - a[1]) * fraction}
      stroke="#916428" strokeWidth={2.2} strokeDasharray="6 4" strokeLinecap="round"/>;
  return <svg aria-label="换基联动" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 22000 }}>
    {!overlay.hasBoundLabel && (
      <text data-basis-coordinates x={title[0]} y={title[1] + fontSize * .79}
        fontSize={fontSize * .78} fontFamily="system-ui, sans-serif" fill="#182033">{overlay.label}</text>
    )}
    {!overlay.hasBoundGuides && overlay.corner && <>
      {segment(overlay.origin, overlay.corner, Math.min(progress, 1), '1')}
      {segment(overlay.corner, overlay.target, Math.max(0, progress - 1), '2')}
    </>}
  </svg>;
}

export function BasisComposition({ basis, first, second, result, progress }: {
  basis: BasisOverlay; first: SceneNode; second: SceneNode; result: SceneNode; progress: number;
}) {
  const [origin, firstTip] = vectorEndpoints(first);
  const [secondStart, secondTip] = vectorEndpoints(second);
  const [, target] = vectorEndpoints(result);
  const composition = basisComposition(origin, [firstTip[0]-origin[0], firstTip[1]-origin[1]],
    [secondTip[0]-secondStart[0], secondTip[1]-secondStart[1]], target);
  const label = composition ? '斜基：坐标 (' + composition.coefficients.map(v => Number(v.toFixed(2))).join(', ') + ')' : '斜基退化：坐标不唯一';
  const segment = (a: [number, number], b: [number, number], fraction: number, key: string) =>
    fraction > 0 && <line data-basis-segment={key} x1={a[0]} y1={a[1]}
      x2={fraction === 1 ? b[0] : a[0]+(b[0]-a[0])*fraction}
      y2={fraction === 1 ? b[1] : a[1]+(b[1]-a[1])*fraction}
      stroke="#916428" strokeWidth={2.2} strokeDasharray="6 4" strokeLinecap="round"/>;
  return <svg aria-label="换基联动" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 22000 }}>
    <text data-basis-coordinates x={basis.title[0]} y={basis.title[1]+basis.fontSize*.79}
      fontSize={basis.fontSize*.78} fontFamily="system-ui, sans-serif" fill="#182033">{label}</text>
    {composition && <>
      {segment(origin, composition.corner, Math.min(progress, 1), '1')}
      {segment(composition.corner, composition.target, Math.max(0, progress-1), '2')}
    </>}
  </svg>;
}

export function useBasisPlayback(key: string | undefined) {
  const [value, setValue] = useState(2);
  const [animation, setAnimation] = useState<1 | 2 | null>(null);
  const [completed, setCompleted] = useState(0);
  useEffect(() => { setValue(2); setAnimation(null); setCompleted(0); }, [key]);
  useEffect(() => {
    if (!animation) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(animation);
      setCompleted(animation);
      setAnimation(null);
      return;
    }
    let frame = 0;
    let start: number | undefined;
    const tick = (time: number) => {
      start ??= time;
      const elapsed = Math.min(1, (time-start)/650);
      setValue(animation-1+elapsed);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
      else { setCompleted(animation); setAnimation(null); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation]);
  return { value, animation, completed, play: (step: 1 | 2) => {
    if (step === 1) setCompleted(0);
    setValue(step-1);
    setAnimation(step);
  }};
}
