import { memo } from 'react';

/** Decorative surface study, drawn locally rather than presented as analysis data. */
function project(x: number, y: number): [number, number] {
  const z = 0.7 * Math.sin(x * 0.8) * Math.cos(y * 0.6);
  return [210 + (x - y) * 33, 140 + (x + y) * 13 - z * 48];
}

const GRID_LINES = Array.from({ length: 19 }, (_, index) => {
  const fixed = -3 + index / 3;
  const trace = (swap: boolean): string => Array.from({ length: 49 }, (_unused, point) => {
    const varying = -3 + point / 8;
    return project(swap ? varying : fixed, swap ? fixed : varying).join(',');
  }).join(' ');
  return { x: trace(false), y: trace(true) };
});

export const KnowledgeSketch = memo(function KnowledgeSketch(): JSX.Element {
  return <svg viewBox="0 0 440 290" fill="none" aria-hidden="true" focusable="false">
    <path d="M24 219h390M210 20v246" stroke="#dcd9f2" strokeDasharray="3 6" />
    <path d="m47 178 163 66 163-66M210 244v-45" stroke="#b7b3e3" />
    <path d="m47 178 163-66 163 66" stroke="#cfd1f3" strokeDasharray="3 5" />
    {GRID_LINES.map((line, index) => <g key={index}>
      <polyline points={line.x} stroke={index === 9 ? '#ff7a59' : '#8f93d8'} strokeWidth={index === 9 ? 1.5 : 0.65} opacity={index === 9 ? 1 : 0.8} />
      <polyline points={line.y} stroke="#8f93d8" strokeWidth="0.65" opacity="0.8" />
    </g>)}
    <circle cx="210" cy="140" r="5" fill="#ff7a59" stroke="#fffdf9" strokeWidth="2" />
    <path d="M210 140h91l20-23M94 70h44l19 21" stroke="#ff7a59" strokeWidth="0.8" />
    <text x="325" y="113" fill="#b8431f" fontSize="12" fontFamily="Georgia, serif" fontStyle="italic">f(x, y)</text>
    <text x="67" y="66" fill="#566074" fontSize="10" fontFamily="monospace">EXPLORE</text>
    <text x="382" y="181" fill="#6b7385" fontSize="11" fontFamily="Georgia, serif" fontStyle="italic">x</text>
    <text x="28" y="181" fill="#6b7385" fontSize="11" fontFamily="Georgia, serif" fontStyle="italic">y</text>
    <text x="217" y="25" fill="#6b7385" fontSize="11" fontFamily="Georgia, serif" fontStyle="italic">z</text>
    <path d="M14 18v14m-7-7h14M414 252v14m-7-7h14" stroke="#b7b3e3" />
  </svg>;
});
