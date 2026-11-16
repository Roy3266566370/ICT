import type { PhysicsResult } from '@/labs/types';
import { PHYSICS_MODE_LABELS } from '@/labs/physics';
import styles from './PhysicsCanvas.module.css';

type Scene = Record<string, any>;
type Sample = Record<string, number>;

interface Props {
  result: PhysicsResult;
  step: number;
}

const CORAL = '#B8431F';
const INDIGO = '#1C2ECB';
const INK = '#34372F';
const MUTED = '#7F8175';

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function samples(scene: Scene): Sample[] {
  return Array.isArray(scene.samples) ? scene.samples as Sample[] : [];
}

function currentSample(scene: Scene, step: number, traceLength: number): Sample {
  const list = samples(scene);
  if (!list.length) return {};
  if (scene.type === 'shm') return { t: n(scene.t), x: n(scene.x), v: n(scene.v), a: n(scene.a) };
  const total = Math.max(1, traceLength - 1);
  const progress = Math.max(0, Math.min(1, step / total));
  return list[Math.round(progress * (list.length - 1))] ?? list[list.length - 1] ?? {};
}

function Arrow({ x1, y1, x2, y2, color = CORAL, label, dash }: {
  x1: number; y1: number; x2: number; y2: number; color?: string; label?: string; dash?: boolean;
}): JSX.Element {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 7;
  const left = `${x2 - head * Math.cos(angle - 0.45)},${y2 - head * Math.sin(angle - 0.45)}`;
  const right = `${x2 - head * Math.cos(angle + 0.45)},${y2 - head * Math.sin(angle + 0.45)}`;
  return <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={dash ? '5 4' : undefined} />
    <path d={`M${x2},${y2}L${left}L${right}Z`} fill={color} />
    {label ? <text x={x2 + (x2 >= x1 ? 6 : -8)} y={y2 - 7} textAnchor={x2 >= x1 ? 'start' : 'end'} className={styles.accent}>{label}</text> : null}
  </g>;
}

function LineChart({ xs, ys, label, color = INDIGO, current }: {
  xs: number[]; ys: number[]; label: string; color?: string; current?: number;
}): JSX.Element {
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 0.001);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0.001);
  const px = (v: number): number => 30 + ((v - xMin) / (xMax - xMin || 1)) * 190;
  const py = (v: number): number => 150 - ((v - yMin) / (yMax - yMin || 1)) * 110;
  const points = xs.map((x, index) => `${px(x)},${py(ys[index] ?? 0)}`).join(' ');
  const marker = current === undefined ? null : { x: px(current), y: py(ys[Math.max(0, Math.min(ys.length - 1, Math.round(current)))] ?? 0) };
  const axisLabel = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    return Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 1e-2)
      ? value.toExponential(2) : value.toFixed(2);
  };
  return <g transform="translate(640 70)">
    <rect x="0" y="0" width="230" height="205" rx="9" className={styles.panel} />
    <text x="12" y="18" className={styles.muted}>{label}</text>
    <line x1="30" y1="150" x2="220" y2="150" className={styles.axis} />
    <line x1="30" y1="40" x2="30" y2="160" className={styles.axis} />
    <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    {marker ? <circle cx={marker.x} cy={marker.y} r="4" fill={CORAL} /> : null}
    <text x="30" y="178" className={styles.muted}>{axisLabel(n(xMin))}</text>
    <text x="212" y="178" textAnchor="end" className={styles.muted}>{axisLabel(n(xMax))}</text>
  </g>;
}

function Bars({ items, label }: { items: { label: string; value: number; color: string }[]; label: string }): JSX.Element {
  const max = Math.max(...items.map(item => Math.abs(item.value)), 1e-9);
  return <g transform="translate(650 70)">
    <rect x="0" y="0" width="230" height="205" rx="9" className={styles.panel} />
    <text x="12" y="18" className={styles.muted}>{label}</text>
    {items.map((item, index) => {
      const width = Math.max(1, (Math.abs(item.value) / max) * 130);
      const y = 44 + index * 36;
      return <g key={item.label}>
        <text x="14" y={y + 9} className={styles.inkText}>{item.label}</text>
        <rect x="84" y={y} width={width} height="14" rx="3" fill={item.color} opacity=".78" />
        <text x={88 + width} y={y + 11} className={styles.muted}>{item.value.toPrecision(4)}</text>
      </g>;
    })}
  </g>;
}

function LinearScene({ scene, current }: { scene: Scene; current: Sample }): JSX.Element {
  const x = n(current.x ?? scene.x);
  const v = n(current.v ?? scene.v);
  const a = n(scene.a);
  const start = Math.min(0, x);
  const end = Math.max(0, x, 1);
  const px = (value: number): number => 80 + ((value - start) / (end - start || 1)) * 470;
  return <g>
    <line x1="60" y1="300" x2="560" y2="300" className={styles.axis} />
    <line x1="80" y1="300" x2={px(x)} y2="300" className={styles.vectorAlt} strokeWidth={3} />
    <text x="60" y="324" className={styles.muted}>0</text>
    <text x={px(x)} y="330" textAnchor="middle" className={styles.accent}>x={x.toPrecision(4)} m</text>
    <circle cx={px(x)} cy="300" r="11" className={styles.object} />
    <Arrow x1={px(x) + 18} y1={272} x2={px(x) + 18 + Math.max(24, Math.min(90, Math.abs(v) * 7))} y2={272} label="v" color={CORAL} />
    <text x="80" y="270" className={styles.label}>加速度 a={a.toPrecision(4)} m/s²</text>
    <text x="80" y="52" className={styles.title}>匀变速直线运动</text>
  </g>;
}

function FallScene({ scene, current }: { scene: Scene; current: Sample }): JSX.Element {
  const h = n(scene.h);
  const y = n(current.y, h);
  const py = (value: number): number => 80 + ((h - value) / (h || 1)) * 240;
  return <g>
    <line x1="300" y1="50" x2="300" y2="340" className={styles.axis} strokeDasharray="4 5" />
    <line x1="80" y1="340" x2="560" y2="340" className={styles.axis} />
    <circle cx="300" cy={py(y)} r="12" className={styles.object} />
    <Arrow x1={330} y1={py(y) - 20} x2={330} y2={py(y) + 38} label="v" color={CORAL} />
    <text x="70" y={py(h)} className={styles.muted}>h={h} m</text>
    <text x="70" y="360" className={styles.muted}>地面</text>
    <text x="80" y="52" className={styles.title}>自由落体</text>
    <text x="390" y={py(y)} className={styles.label}>y={y.toPrecision(4)} m</text>
  </g>;
}

function ProjectileScene({ scene, current }: { scene: Scene; current: Sample }): JSX.Element {
  const maxX = Math.max(n(scene.range), 1);
  const maxY = Math.max(n(scene.maxHeight), 1);
  const list = samples(scene);
  const px = (value: number): number => 70 + (value / maxX) * 480;
  const py = (value: number): number => 330 - (value / maxY) * 260;
  const path = list.map(item => `${px(n(item.x))},${py(n(item.y))}`).join(' ');
  const x = n(current.x), y = n(current.y);
  const vx = n(current.vx, scene.vx), vy = n(current.vy);
  return <g>
    <line x1="45" y1="330" x2="580" y2="330" className={styles.axis} />
    <line x1="70" y1="330" x2="70" y2="45" className={styles.axis} />
    <polyline points={path} fill="none" stroke={INDIGO} strokeWidth="2" strokeDasharray="5 5" />
    <circle cx={px(x)} cy={py(y)} r="10" className={styles.object} />
    <Arrow x1={px(x)} y1={py(y)} x2={px(x) + vx * 5} y2={py(y) - vy * 5} label="v" color={CORAL} />
    <line x1={px(x)} y1="330" x2={px(x)} y2={py(y)} stroke={MUTED} strokeDasharray="3 4" />
    <text x="60" y="348" className={styles.muted}>射程 {n(scene.range).toPrecision(4)} m</text>
    <text x={px(maxX / 2)} y={py(maxY) - 12} textAnchor="middle" className={styles.muted}>最高 {n(scene.maxHeight).toPrecision(4)} m</text>
    <text x="80" y="52" className={styles.title}>{scene.type === 'projectile' ? (n(scene.angle) > 0 ? '斜抛运动' : '平抛运动') : '抛体运动'}</text>
  </g>;
}

function RelativeScene({ scene }: { scene: Scene }): JSX.Element {
  const vA = n(scene.vA), vB = n(scene.vB), rel = n(scene.rel);
  const len = (value: number): number => Math.max(18, Math.min(150, Math.abs(value) * 16));
  return <g>
    <text x="80" y="52" className={styles.title}>一维相对运动</text>
    <text x="90" y="130" className={styles.label}>甲</text>
    <Arrow x1={130} y1={125} x2={130 + (vA >= 0 ? len(vA) : -len(vA))} y2={125} label="vA" />
    <text x="90" y="205" className={styles.label}>乙</text>
    <Arrow x1={130} y1={200} x2={130 + (vB >= 0 ? len(vB) : -len(vB))} y2={200} label="vB" color={INDIGO} />
    <text x="90" y="275" className={styles.label}>相对</text>
    <Arrow x1={130} y1={270} x2={130 + (rel >= 0 ? len(rel) : -len(rel))} y2={270} label="vAB" color={INK} />
    <text x="80" y="330" className={styles.muted}>vAB = vA − vB = {rel.toPrecision(4)} m/s</text>
  </g>;
}

function InclineScene({ scene }: { scene: Scene }): JSX.Element {
  const angle = n(scene.angle) * Math.PI / 180;
  const m = n(scene.m);
  const baseX = 80, baseY = 330;
  const topX = baseX + 470 * Math.cos(angle);
  const topY = baseY - 470 * Math.sin(angle);
  const t = 0.56;
  const bx = baseX + (topX - baseX) * t;
  const by = baseY + (topY - baseY) * t;
  const size = 30 + Math.min(26, m * 4);
  const normal = n(scene.normal), friction = n(scene.friction), gravity = n(scene.gravityAlong);
  return <g>
    <path d={`M${baseX},${baseY} L${topX},${topY} L${topX},${baseY} Z`} className={styles.surface} />
    <text x={baseX + 20} y={baseY - 10} className={styles.muted}>θ={n(scene.angle)}°</text>
    <g transform={`translate(${bx} ${by}) rotate(${-n(scene.angle)})`}>
      <rect x={-size / 2} y={-size} width={size} height={size} rx="4" className={styles.object} />
    </g>
    <Arrow x1={bx} y1={by - size / 2} x2={bx} y2={by + 70} label="mg" color={INK} />
    <Arrow x1={bx} y1={by - size / 2} x2={bx - Math.sin(angle) * 58} y2={by - size / 2 - Math.cos(angle) * 58} label="N" color={INDIGO} />
    {n(scene.moving) ? <Arrow x1={bx} y1={by - size / 2} x2={bx - Math.cos(angle) * 54} y2={by - size / 2 + Math.sin(angle) * 54} label="f" color={CORAL} dash /> : null}
    <text x={70} y="52" className={styles.title}>斜面受力与摩擦</text>
    <text x={70} y="365" className={styles.muted}>N={normal.toPrecision(4)} N · f={friction.toPrecision(4)} N · 重力分量={gravity.toPrecision(4)} N</text>
  </g>;
}

function AtwoodScene({ scene }: { scene: Scene }): JSX.Element {
  const m1 = n(scene.m1), m2 = n(scene.m2), a = n(scene.a), T = n(scene.T);
  const leftY = 200 + Math.min(50, m1 * 8);
  const rightY = 200 + Math.min(50, m2 * 8);
  return <g>
    <circle cx="320" cy="120" r="28" fill="none" stroke={INK} strokeWidth="3" />
    <circle cx="320" cy="120" r="4" fill={INK} />
    <line x1="292" y1="120" x2="280" y2={leftY} stroke={INK} strokeWidth="2" />
    <line x1="348" y1="120" x2="360" y2={rightY} stroke={INK} strokeWidth="2" />
    <rect x={258} y={leftY} width="44" height={36 + Math.min(20, m1 * 3)} rx="4" className={styles.objectAlt} />
    <rect x={338} y={rightY} width="44" height={36 + Math.min(20, m2 * 3)} rx="4" className={styles.object} />
    <text x={280} y={leftY + 60} textAnchor="middle" className={styles.label}>m1={m1} kg</text>
    <text x={360} y={rightY + 60} textAnchor="middle" className={styles.label}>m2={m2} kg</text>
    <Arrow x1={398} y1={rightY - 12} x2={398} y2={rightY + 44} label="m2g" />
    <Arrow x1={240} y1={leftY + 50} x2={240} y2={leftY - 10} label="上升" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>连接体与定滑轮</text>
    <text x="70" y="350" className={styles.muted}>a={a.toPrecision(4)} m/s² · T={T.toPrecision(4)} N</text>
  </g>;
}

function CircularScene({ scene, step, traceLength }: { scene: Scene; step: number; traceLength: number }): JSX.Element {
  const r = 105;
  const progress = traceLength > 1 ? step / (traceLength - 1) : 0;
  const angle = -Math.PI / 2 + progress * Math.PI * 1.6;
  const cx = 310, cy = 215;
  const x = cx + Math.cos(angle) * r;
  const y = cy + Math.sin(angle) * r;
  const tx = -Math.sin(angle), ty = Math.cos(angle);
  return <g>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={INDIGO} strokeWidth="2" strokeDasharray="6 5" />
    <circle cx={cx} cy={cy} r="4" fill={INK} />
    <circle cx={x} cy={y} r="11" className={styles.object} />
    <Arrow x1={x} y1={y} x2={x + tx * 70} y2={y + ty * 70} label="v" />
    <Arrow x1={x} y1={y} x2={x - Math.cos(angle) * 54} y2={y - Math.sin(angle) * 54} label="F向" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>匀速圆周运动</text>
    <text x="70" y="355" className={styles.muted}>a={n(scene.a).toPrecision(4)} m/s² · F={n(scene.F).toPrecision(4)} N · T={n(scene.T).toPrecision(4)} s</text>
  </g>;
}

function SpringWorkScene({ scene }: { scene: Scene }): JSX.Element {
  const x = n(scene.x);
  const stretch = Math.max(24, Math.min(260, x * 520 + 24));
  const end = 170 + stretch;
  return <g>
    <line x1="80" y1="150" x2="80" y2="310" stroke={INK} strokeWidth="5" />
    <path d={`M80 230 ${Array.from({ length: 9 }, (_, i) => `${92 + i * (stretch / 9)} ${i % 2 ? 210 : 250}`).join(' L')}`} fill="none" stroke={INDIGO} strokeWidth="2" />
    <rect x={end} y="210" width="42" height="42" rx="4" className={styles.object} />
    <Arrow x1={end + 21} y1={265} x2={end + 21 + Math.sign(n(scene.F)) * 62} y2={265} label="F" />
    <text x="80" y="52" className={styles.title}>弹簧变力做功</text>
    <text x="250" y="310" className={styles.muted}>x={x.toPrecision(4)} m · W={n(scene.W).toPrecision(4)} J · Ep={n(scene.Ep).toPrecision(4)} J</text>
  </g>;
}

function WorkEnergyScene({ scene }: { scene: Scene }): JSX.Element {
  return <g>
    <line x1="80" y1="280" x2="570" y2="280" className={styles.axis} />
    <rect x="110" y="236" width="48" height="44" rx="4" className={styles.objectAlt} />
    <rect x="470" y="236" width="48" height="44" rx="4" className={styles.object} />
    <Arrow x1={200} y1={210} x2={310} y2={210} label="F" />
    <line x1="110" y1="300" x2="518" y2="300" stroke={MUTED} strokeDasharray="4 4" />
    <text x="110" y="318" className={styles.muted}>s=0</text>
    <text x="518" y="318" textAnchor="end" className={styles.muted}>s={n(scene.s)} m</text>
    <text x="80" y="52" className={styles.title}>动能定理</text>
    <text x="70" y="355" className={styles.muted}>W={n(scene.W).toPrecision(4)} J · v0={n(scene.v0).toPrecision(4)} m/s · v={n(scene.v).toPrecision(4)} m/s</text>
  </g>;
}

function EnergyScene({ scene }: { scene: Scene }): JSX.Element {
  const h = n(scene.h);
  return <g>
    <path d={`M110 ${300 - Math.min(220, h * 18)} Q260 240 490 300`} fill="none" stroke={INDIGO} strokeWidth="3" />
    <line x1="80" y1="300" x2="560" y2="300" className={styles.axis} />
    <circle cx="112" cy={300 - Math.min(220, h * 18)} r="12" className={styles.object} />
    <circle cx="488" cy="300" r="12" className={styles.objectAlt} />
    <line x1="112" y1={300 - Math.min(220, h * 18)} x2="112" y2="300" stroke={MUTED} strokeDasharray="4 4" />
    <text x="70" y={300 - Math.min(220, h * 18)} className={styles.muted}>h={h} m</text>
    <text x="80" y="52" className={styles.title}>机械能守恒</text>
    <text x="70" y="350" className={styles.muted}>Ep={n(scene.energy).toPrecision(4)} J → Ek，底端 v={n(scene.v).toPrecision(4)} m/s</text>
  </g>;
}

function ImpulseScene({ scene }: { scene: Scene }): JSX.Element {
  const v1 = n(scene.v1), v2 = n(scene.v2);
  return <g>
    <rect x="270" y="200" width="70" height="54" rx="5" className={styles.object} />
    <Arrow x1={270} y1={227} x2={270 + Math.sign(v1 || 1) * Math.min(120, 28 + Math.abs(v1) * 10)} y2={227} label="v1" />
    <Arrow x1={340} y1={227} x2={340 + Math.sign(v2 || 1) * Math.min(140, 28 + Math.abs(v2) * 10)} y2={227} label="v2" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>冲量与动量定理</text>
    <text x="70" y="330" className={styles.muted}>I={n(scene.impulse).toPrecision(4)} N·s · F平均={n(scene.average).toPrecision(4)} N</text>
  </g>;
}

function CollisionScene({ scene }: { scene: Scene }): JSX.Element {
  const beforeY = 170, afterY = 300;
  const m1 = n(scene.m1), m2 = n(scene.m2);
  const v1 = n(scene.v1), v2 = n(scene.v2);
  const inelastic = scene.mode === 'inelastic';
  const v1p = inelastic ? n(scene.vp) : n(scene.v1p);
  const v2p = n(scene.v2p);
  return <g>
    <rect x="220" y={beforeY - 24} width="54" height="48" rx="4" className={styles.object} />
    <rect x="360" y={beforeY - 24} width="54" height="48" rx="4" className={styles.objectAlt} />
    <Arrow x1={218} y1={beforeY} x2={218 + Math.sign(v1 || 1) * Math.min(100, 22 + Math.abs(v1) * 9)} y2={beforeY} label="v1" />
    <Arrow x1={416} y1={beforeY} x2={416 + Math.sign(v2 || 1) * Math.min(100, 22 + Math.abs(v2) * 9)} y2={beforeY} label="v2" color={INDIGO} />
    <text x="180" y={beforeY - 38} className={styles.muted}>碰前 · m1={m1} kg，m2={m2} kg</text>
    {inelastic ? <rect x="270" y={afterY - 24} width="108" height="48" rx="4" className={styles.object} /> : <>
      <rect x="220" y={afterY - 24} width="54" height="48" rx="4" className={styles.object} />
      <rect x="360" y={afterY - 24} width="54" height="48" rx="4" className={styles.objectAlt} />
    </>}
    <Arrow x1={270} y1={afterY} x2={270 + Math.sign(v1p || 1) * Math.min(180, 28 + Math.abs(v1p) * 9)} y2={afterY} label={inelastic ? 'v′' : 'v1′'} />
    {!inelastic ? <Arrow x1={416} y1={afterY} x2={416 + Math.sign(v2p || 1) * Math.min(120, 28 + Math.abs(v2p) * 9)} y2={afterY} label="v2′" color={INDIGO} /> : null}
    <text x="180" y={afterY - 38} className={styles.muted}>碰后 · {inelastic ? `共同速度 ${v1p.toPrecision(4)} m/s` : '速度分别变化'}</text>
    <text x="80" y="52" className={styles.title}>{inelastic ? '完全非弹性碰撞' : '一维弹性碰撞'}</text>
  </g>;
}

function OscillationScene({ scene, current }: { scene: Scene; current: Sample }): JSX.Element {
  const x = n(current.x);
  const amplitude = Math.max(n(scene.A), 1e-6);
  const offset = (x / amplitude) * 100;
  const bx = 300 + offset;
  return <g>
    <line x1="80" y1="150" x2="80" y2="320" stroke={INK} strokeWidth="5" />
    <line x1="300" y1="130" x2="300" y2="330" stroke={MUTED} strokeDasharray="4 4" />
    <path d={`M80 245 ${Array.from({ length: 9 }, (_, i) => `${96 + i * (200 / 9)} ${i % 2 ? 228 : 262}`).join(' L')}`} fill="none" stroke={INDIGO} strokeWidth="2" />
    <line x1="280" y1="245" x2={bx - 24} y2="245" stroke={INDIGO} strokeWidth="2" />
    <rect x={bx - 24} y="218" width="48" height="54" rx="5" className={styles.object} />
    <text x="290" y="350" textAnchor="middle" className={styles.muted}>平衡位置</text>
    <text x="80" y="52" className={styles.title}>弹簧振子</text>
    <text x="70" y="390" className={styles.muted}>x={x.toPrecision(4)} m · v={n(current.v).toPrecision(4)} m/s · T={n(scene.T).toPrecision(4)} s</text>
  </g>;
}

function PendulumScene({ scene, current }: { scene: Scene; current: Sample }): JSX.Element {
  const length = 185;
  const cx = 320, cy = 90;
  const theta = (n(current.theta) * Math.PI) / 180;
  const x = cx + Math.sin(theta) * length;
  const y = cy + Math.cos(theta) * length;
  return <g>
    <line x1="230" y1="80" x2="410" y2="80" stroke={INK} strokeWidth="4" />
    <circle cx={cx} cy={cy} r="6" fill={INK} />
    <line x1={cx} y1={cy} x2={x} y2={y} stroke={INK} strokeWidth="2" />
    <circle cx={x} cy={y} r="16" className={styles.object} />
    <path d={`M${cx + Math.sin(theta) * 80} ${cy + Math.cos(theta) * 80} A80 80 0 0 1 ${cx} ${cy + 80}`} fill="none" stroke={MUTED} strokeDasharray="4 4" />
    <text x="80" y="52" className={styles.title}>小角度单摆</text>
    <text x="70" y="340" className={styles.muted}>θ={n(current.theta).toPrecision(4)}° · vmax={n(scene.vmax).toPrecision(4)} m/s · T={n(scene.T).toPrecision(4)} s</text>
  </g>;
}

function ShmScene({ scene }: { scene: Scene }): JSX.Element {
  const cx = 240, cy = 220, r = 105;
  const phase = n(scene.phase);
  const x = cx + Math.cos(-phase) * r;
  const y = cy + Math.sin(-phase) * r;
  return <g>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={INDIGO} strokeWidth="2" strokeDasharray="6 5" />
    <line x1={cx} y1={cy} x2={x} y2={y} stroke={CORAL} strokeWidth="2" />
    <circle cx={x} cy={y} r="10" className={styles.object} />
    <line x1={cx} y1={cy} x2={cx + r} y2={cy} stroke={MUTED} strokeDasharray="4 4" />
    <line x1={cx} y1={cy} x2={cx} y2={cy - r} stroke={MUTED} strokeDasharray="4 4" />
    <text x="80" y="52" className={styles.title}>简谐运动的相位与能量</text>
    <text x="70" y="365" className={styles.muted}>x={n(scene.x).toPrecision(4)} m · v={n(scene.v).toPrecision(4)} m/s · a={n(scene.a).toPrecision(4)} m/s²</text>
  </g>;
}

function RotationScene({ scene, step, traceLength }: { scene: Scene; step: number; traceLength: number }): JSX.Element {
  const progress = traceLength > 1 ? step / (traceLength - 1) : 0;
  const angle = progress * Math.PI * 2;
  const cx = 300, cy = 205, radius = 100;
  return <g>
    <circle cx={cx} cy={cy} r={radius} fill="rgba(28,46,203,.05)" stroke={INDIGO} strokeWidth="2" />
    <circle cx={cx} cy={cy} r="5" fill={INK} />
    <line x1={cx} y1={cy} x2={cx + Math.cos(angle) * radius} y2={cy + Math.sin(angle) * radius} stroke={CORAL} strokeWidth="3" strokeLinecap="round" />
    <circle cx={cx + Math.cos(angle) * radius} cy={cy + Math.sin(angle) * radius} r="9" className={styles.object} />
    {Array.from({ length: 12 }, (_, index) => {
      const a = (index / 12) * Math.PI * 2;
      return <line key={index} x1={cx + Math.cos(a) * (radius - 8)} y1={cy + Math.sin(a) * (radius - 8)}
        x2={cx + Math.cos(a) * radius} y2={cy + Math.sin(a) * radius} stroke={MUTED} opacity=".45" />;
    })}
    <Arrow x1={cx + 112} y1={cy - 54} x2={cx + 78} y2={cy - 100} label="τ" />
    <text x="80" y="52" className={styles.title}>刚体定轴转动</text>
    <text x="70" y="365" className={styles.muted}>I={n(scene.I).toPrecision(4)} kg·m² · α={n(scene.alpha).toPrecision(4)} rad/s² · ω={n(scene.omega).toPrecision(4)} rad/s</text>
  </g>;
}

function RollingScene({ scene, step, traceLength }: { scene: Scene; step: number; traceLength: number }): JSX.Element {
  const angle = n(scene.angle) * Math.PI / 180;
  const baseX = 90, baseY = 330, topX = baseX + 440 * Math.cos(angle), topY = baseY - 440 * Math.sin(angle);
  const progress = traceLength > 1 ? step / (traceLength - 1) : 0;
  const bx = baseX + (topX - baseX) * progress;
  const by = baseY + (topY - baseY) * progress;
  return <g>
    <path d={`M${baseX},${baseY} L${topX},${topY} L${topX},${baseY} Z`} className={styles.surface} />
    <circle cx={bx} cy={by - 18} r="18" className={styles.object} />
    <line x1={bx - 12} y1={by - 30} x2={bx + 12} y2={by - 6} stroke="#FBF9F2" strokeWidth="2" />
    <line x1={bx - 12} y1={by - 6} x2={bx + 12} y2={by - 30} stroke="#FBF9F2" strokeWidth="2" />
    <Arrow x1={bx + 28} y1={by - 18} x2={bx + 70} y2={by - 18 - 20} label="v" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>纯滚动下滑</text>
    <text x="70" y="365" className={styles.muted}>a={n(scene.a).toPrecision(4)} m/s² · v={n(scene.v).toPrecision(4)} m/s · E平={n(scene.Kt).toPrecision(4)} J · E转={n(scene.Kr).toPrecision(4)} J</text>
  </g>;
}

function WaveScene({ scene }: { scene: Scene }): JSX.Element {
  const list = samples(scene);
  const maxX = Math.max(...list.map(item => n(item.x)), 1);
  const amplitude = Math.max(n(scene.A), 1e-9);
  const px = (value: number): number => 70 + (value / maxX) * 500;
  const py = (value: number): number => 210 - (value / amplitude) * 105;
  const path = list.map(item => `${px(n(item.x))},${py(n(item.y))}`).join(' ');
  return <g>
    <line x1="60" y1="210" x2="590" y2="210" className={styles.axis} />
    <line x1="70" y1="70" x2="70" y2="340" className={styles.axis} />
    <polyline points={path} fill="none" stroke={INDIGO} strokeWidth="2" />
    <line x1={px(n(scene.x1))} y1="90" x2={px(n(scene.x1))} y2="330" stroke={MUTED} strokeDasharray="4 4" />
    <line x1={px(n(scene.x2))} y1="90" x2={px(n(scene.x2))} y2="330" stroke={MUTED} strokeDasharray="4 4" />
    <text x={px(n(scene.x1))} y="82" textAnchor="middle" className={styles.muted}>x1</text>
    <text x={px(n(scene.x2))} y="82" textAnchor="middle" className={styles.muted}>x2</text>
    <Arrow x1={470} y1={70} x2={550} y2={70} label="传播" color={CORAL} />
    <text x="80" y="52" className={styles.title}>简谐行波</text>
    <text x="70" y="380" className={styles.muted}>v={n(scene.v).toPrecision(4)} m/s · T={n(scene.T).toPrecision(4)} s · Δφ={n(scene.phase).toPrecision(4)} rad</text>
  </g>;
}

function StandingScene({ scene }: { scene: Scene }): JSX.Element {
  const list = samples(scene);
  const length = Math.max(n(scene.L), 1e-9);
  const amplitude = Math.max(n(scene.A), 1e-9);
  const px = (value: number): number => 70 + (value / length) * 500;
  const py = (value: number): number => 210 - (value / amplitude) * 110;
  const path = list.map(item => `${px(n(item.x))},${py(n(item.y))}`).join(' ');
  return <g>
    <line x1="60" y1="210" x2="590" y2="210" className={styles.axis} />
    {(scene.nodes as number[]).map((value, index) => <line key={`n${index}`} x1={px(value)} y1="80" x2={px(value)} y2="340" stroke={CORAL} strokeDasharray="4 4" />)}
    {(scene.antinodes as number[]).map((value, index) => <circle key={`a${index}`} cx={px(value)} cy="210" r="4" fill={INDIGO} />)}
    <polyline points={path} fill="none" stroke={INDIGO} strokeWidth="2" />
    <text x="80" y="52" className={styles.title}>弦上驻波</text>
    <text x="70" y="375" className={styles.muted}>波节 { (scene.nodes as number[]).length } 个 · 波腹 { (scene.antinodes as number[]).length } 个 · 基频 {n(scene.f1).toPrecision(4)} Hz</text>
  </g>;
}

function ElectricScene({ scene }: { scene: Scene }): JSX.Element {
  const d = Math.max(n(scene.d), 1e-9);
  const x1 = 170, x2 = 470, xp = x1 + (n(scene.xP) / d) * (x2 - x1);
  return <g>
    <line x1="70" y1="245" x2="580" y2="245" className={styles.axis} />
    <circle cx={x1} cy="245" r="17" className={styles.object} />
    <text x={x1} y="250" textAnchor="middle" className={styles.inkText}>{n(scene.q1) >= 0 ? '+' : '−'}</text>
    <circle cx={x2} cy="245" r="17" className={styles.objectAlt} />
    <text x={x2} y="250" textAnchor="middle" className={styles.inkText}>{n(scene.q2) >= 0 ? '+' : '−'}</text>
    <line x1={xp} y1="150" x2={xp} y2="320" stroke={CORAL} strokeDasharray="4 4" />
    <text x={xp} y="138" textAnchor="middle" className={styles.accent}>P</text>
    <Arrow x1={xp} y1={180} x2={xp + Math.sign(n(scene.E) || 1) * 48} y2={180} label="E" />
    <text x="80" y="52" className={styles.title}>点电荷与 P 点</text>
    <text x="70" y="365" className={styles.muted}>F={n(scene.F).toPrecision(4)} N · E={n(scene.E).toPrecision(4)} N/C · V={n(scene.V).toPrecision(4)} V</text>
  </g>;
}

function GaussScene({ scene }: { scene: Scene }): JSX.Element {
  const radius = 105;
  const r = Math.max(n(scene.r), 0);
  const ratio = Math.min(1.8, r / Math.max(n(scene.R), 1e-9));
  const cx = 310, cy = 215;
  const x = cx + radius * Math.min(1, ratio);
  return <g>
    <circle cx={cx} cy={cy} r={radius} fill="rgba(28,46,203,.06)" stroke={INDIGO} strokeWidth="2" strokeDasharray={n(scene.shell) ? '7 5' : undefined} />
    <circle cx={cx} cy={cy} r="4" fill={INK} />
    <line x1={cx} y1={cy} x2={x} y2={cy} stroke={MUTED} strokeDasharray="4 4" />
    <circle cx={x} cy={cy} r="7" className={styles.object} />
    <Arrow x1={x} y1={cy - 16} x2={x + (n(scene.inside) ? 28 : 48)} y2={cy - 16} label="E" />
    <text x="80" y="52" className={styles.title}>{n(scene.shell) ? '均匀带电球壳' : '均匀带电球体'}</text>
    <text x="70" y="365" className={styles.muted}>R={n(scene.R).toPrecision(4)} m · r={n(scene.r).toPrecision(4)} m · E={n(scene.E).toPrecision(4)} N/C · V={n(scene.V).toPrecision(4)} V</text>
  </g>;
}

function CircuitScene({ scene }: { scene: Scene }): JSX.Element {
  if (scene.circuit === 'capacitor') {
    return <g>
      <path d="M110 190H230M310 190H430M490 190H550" stroke={INK} strokeWidth="2" fill="none" />
      <path d="M230 150V230M250 150V230" stroke={INDIGO} strokeWidth="3" />
      <path d="M310 150V230M330 150V230" stroke={INDIGO} strokeWidth="3" />
      <path d="M110 190V280H550V190" stroke={MUTED} strokeWidth="1.5" fill="none" strokeDasharray="5 4" />
      <text x="230" y="128" textAnchor="middle" className={styles.label}>{n(scene.series) ? 'C1' : 'C1'}</text>
      <text x="330" y="128" textAnchor="middle" className={styles.label}>C2</text>
      <text x="80" y="52" className={styles.title}>{n(scene.series) ? '电容器串联' : '电容器并联'}</text>
      <text x="70" y="355" className={styles.muted}>Ceq={n(scene.Ceq).toPrecision(4)} μF · Q={n(scene.Q).toPrecision(4)} μC · U={n(scene.U).toPrecision(4)} V</text>
    </g>;
  }
  if (scene.circuit === 'kirchhoff') {
    const I1 = n(scene.I1), I2 = n(scene.I2), I3 = n(scene.I3);
    return <g>
      <rect x="130" y="100" width="350" height="200" fill="none" stroke={MUTED} strokeWidth="1.5" />
      <line x1="305" y1="100" x2="305" y2="300" stroke={MUTED} strokeWidth="1.5" />
      <rect x="180" y="82" width="42" height="22" rx="3" fill={INDIGO} opacity=".25" />
      <rect x="360" y="82" width="42" height="22" rx="3" fill={CORAL} opacity=".25" />
      <rect x="285" y="186" width="40" height="24" rx="3" fill={MUTED} opacity=".25" />
      <Arrow x1={250} y1={160} x2={250 + Math.sign(I1 || 1) * 45} y2={160} label="I1" />
      <Arrow x1={360} y1={160} x2={360 + Math.sign(I2 || 1) * 45} y2={160} label="I2" color={INDIGO} />
      <Arrow x1={305} y1={235} x2={305 + Math.sign(I3 || 1) * 45} y2={235} label="I3" color={INK} />
      <text x="80" y="52" className={styles.title}>双回路电路</text>
      <text x="70" y="350" className={styles.muted}>I1={I1.toPrecision(4)} A · I2={I2.toPrecision(4)} A · I3={I3.toPrecision(4)} A</text>
    </g>;
  }
  return <g>
    <rect x="120" y="105" width="350" height="190" fill="none" stroke={MUTED} strokeWidth="1.5" />
    <rect x="160" y="88" width="42" height="22" rx="3" fill={CORAL} opacity=".3" />
    <rect x="280" y="200" width="50" height="24" rx="3" fill={INDIGO} opacity=".3" />
    <path d="M330 150V190M350 150V190" stroke={INDIGO} strokeWidth="3" />
    <text x="170" y="76" className={styles.label}>{n(scene.discharge) ? '放电' : '充电'} · τ={n(scene.tau).toPrecision(4)} s</text>
    <text x="80" y="52" className={styles.title}>RC 电路</text>
    <text x="70" y="350" className={styles.muted}>t={n(scene.t).toPrecision(4)} s · q={n(scene.q).toPrecision(4)} μC · i={n(scene.i).toPrecision(4)} A</text>
  </g>;
}

function MagneticScene({ scene, step, traceLength }: { scene: Scene; step: number; traceLength: number }): JSX.Element {
  const cx = 310, cy = 210, radius = 110;
  const progress = traceLength > 1 ? step / (traceLength - 1) : 0;
  const angle = -Math.PI / 2 + progress * Math.PI * 1.8;
  const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
  return <g>
    <circle cx={cx} cy={cy} r={radius} fill="none" stroke={INDIGO} strokeWidth="2" strokeDasharray="6 5" />
    {Array.from({ length: 20 }, (_, index) => <circle key={index} cx={70 + (index % 5) * 105} cy={70 + Math.floor(index / 5) * 85} r="2" fill={MUTED} opacity=".5" />)}
    <circle cx={x} cy={y} r="10" className={styles.object} />
    <Arrow x1={x} y1={y} x2={x - Math.sin(angle) * 55} y2={y + Math.cos(angle) * 55} label="v" color={CORAL} />
    <Arrow x1={x} y1={y} x2={x - Math.cos(angle) * 48} y2={y - Math.sin(angle) * 48} label="F" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>匀强磁场中的带电粒子</text>
    <text x="70" y="365" className={styles.muted}>r={n(scene.r).toPrecision(4)} m · T={n(scene.T).toPrecision(4)} s · F={n(scene.F).toPrecision(4)} N · {scene.direction}</text>
  </g>;
}

function AmpereScene({ scene }: { scene: Scene }): JSX.Element {
  const force = n(scene.F);
  return <g>
    <rect x="110" y="80" width="80" height="260" rx="8" fill="rgba(28,46,203,.12)" stroke={INDIGO} />
    <rect x="410" y="80" width="80" height="260" rx="8" fill="rgba(184,67,31,.1)" stroke={CORAL} />
    <text x="150" y="215" textAnchor="middle" className={styles.title}>N</text>
    <text x="450" y="215" textAnchor="middle" className={styles.title}>S</text>
    <line x1="190" y1="210" x2="410" y2="210" stroke={INK} strokeWidth="3" />
    <Arrow x1={280} y1={210} x2={330} y2={210} label="I" />
    <Arrow x1={300} y1={210} x2={300} y2={210 - Math.sign(force || 1) * 64} label="F" color={INDIGO} />
    <text x="80" y="52" className={styles.title}>直导线安培力</text>
    <text x="70" y="365" className={styles.muted}>B={n(scene.B).toPrecision(4)} T · I={n(scene.I).toPrecision(4)} A · L={n(scene.L).toPrecision(4)} m · F={force.toPrecision(4)} N</text>
  </g>;
}

function InductionScene({ scene }: { scene: Scene }): JSX.Element {
  if (scene.kind === 'rail') {
    return <g>
      <line x1="120" y1="160" x2="520" y2="160" stroke={INK} strokeWidth="3" />
      <line x1="120" y1="290" x2="520" y2="290" stroke={INK} strokeWidth="3" />
      <line x1="360" y1="160" x2="360" y2="290" stroke={CORAL} strokeWidth="6" />
      <Arrow x1={390} y1={225} x2={450} y2={225} label="v" />
      {Array.from({ length: 15 }, (_, index) => <circle key={index} cx={150 + (index % 5) * 80} cy={195 + Math.floor(index / 5) * 35} r="2" fill={MUTED} opacity=".55" />)}
      <text x="80" y="52" className={styles.title}>导体棒切割磁感线</text>
      <text x="70" y="350" className={styles.muted}>ε={n(scene.emf).toPrecision(4)} V · I={n(scene.I).toPrecision(4)} A · F={n(scene.F).toPrecision(4)} N · P={n(scene.P).toPrecision(4)} W</text>
    </g>;
  }
  return <g>
    <rect x="190" y="100" width="230" height="190" rx="8" fill="rgba(28,46,203,.04)" stroke={INDIGO} strokeWidth="2" />
    {Array.from({ length: 12 }, (_, index) => <circle key={index} cx={210 + (index % 4) * 60} cy={130 + Math.floor(index / 4) * 55} r="2.5" fill={INDIGO} opacity=".5" />)}
    <Arrow x1={430} y1={150} x2={510} y2={150} label={n(scene.increase) ? 'B↑' : 'B↓'} color={CORAL} />
    <text x="80" y="52" className={styles.title}>线圈中的感应电动势</text>
    <text x="70" y="350" className={styles.muted}>ε={n(scene.emf).toPrecision(4)} V · I={n(scene.I).toPrecision(4)} A · P={n(scene.P).toPrecision(4)} W</text>
  </g>;
}

function ThermoScene({ scene, step, traceLength }: { scene: Scene; step: number; traceLength: number }): JSX.Element {
  const path = Array.isArray(scene.path) ? scene.path as { V: number; P: number }[] : [];
  const maxV = Math.max(...path.map(item => item.V), 1e-9);
  const maxP = Math.max(...path.map(item => item.P), 1e-9);
  const px = (value: number): number => 90 + (value / maxV) * 450;
  const py = (value: number): number => 330 - (value / maxP) * 240;
  const points = path.map(item => `${px(item.V)},${py(item.P)}`).join(' ');
  const progress = traceLength > 1 ? step / (traceLength - 1) : 0;
  const current = path[Math.round(progress * (path.length - 1))];
  return <g>
    <line x1="70" y1="330" x2="570" y2="330" className={styles.axis} />
    <line x1="90" y1="70" x2="90" y2="340" className={styles.axis} />
    <text x="575" y="345" className={styles.muted}>V</text>
    <text x="70" y="66" className={styles.muted}>p</text>
    <polyline points={points} fill="none" stroke={INDIGO} strokeWidth="2.5" />
    {current ? <circle cx={px(current.V)} cy={py(current.P)} r="6" className={styles.object} /> : null}
    <text x="80" y="52" className={styles.title}>{scene.kind === 'carnot' ? '卡诺循环' : '理想气体过程'}</text>
    <text x="70" y="370" className={styles.muted}>{scene.kind === 'carnot' ? `η=${n(scene.eta * 100).toPrecision(4)}% · W=${n(scene.W).toPrecision(4)} J · Qc=${n(scene.Qc).toPrecision(4)} J` : `W=${n(scene.W).toPrecision(4)} J · ΔU=${n(scene.dU).toPrecision(4)} J · Q=${n(scene.Q).toPrecision(4)} J`}</text>
  </g>;
}

function DoubleSlitScene({ scene }: { scene: Scene }): JSX.Element {
  const spacing = Math.max(n(scene.spacing), 1e-12);
  const list = samples(scene);
  const maxI = Math.max(...list.map(item => n(item.I)), 1e-9);
  const screenX = 560;
  return <g>
    <line x1="80" y1="215" x2={screenX} y2="215" className={styles.axis} strokeDasharray="4 4" />
    <line x1="110" y1="90" x2="110" y2="170" stroke={INK} strokeWidth="7" />
    <line x1="110" y1="190" x2="110" y2="240" stroke={INK} strokeWidth="7" />
    <line x1="110" y1="260" x2="110" y2="340" stroke={INK} strokeWidth="7" />
    <line x1="110" y1="180" x2={screenX} y2="215" stroke={CORAL} strokeWidth="1.3" opacity=".6" />
    <line x1="110" y1="250" x2={screenX} y2="215" stroke={CORAL} strokeWidth="1.3" opacity=".6" />
    <line x1={screenX} y1="65" x2={screenX} y2="355" stroke={INK} strokeWidth="3" />
    {list.filter((_, index) => index % 2 === 0).map((item, index) => {
      const y = 210 - (n(item.y) / spacing) * 28;
      return <rect key={index} x={screenX - 12} y={y - 1.6} width="24" height="3.2" rx="1.5"
        fill={CORAL} opacity={0.12 + 0.88 * (n(item.I) / maxI)} />;
    })}
    <text x="86" y="180" className={styles.muted}>S1</text>
    <text x="86" y="246" className={styles.muted}>S2</text>
    <text x="250" y="130" className={styles.muted}>d={n(scene.d).toPrecision(3)} m</text>
    <text x="250" y="300" className={styles.muted}>D={n(scene.D).toPrecision(3)} m</text>
    <text x={screenX} y="372" textAnchor="middle" className={styles.muted}>屏 · Δy={n(scene.spacing).toPrecision(4)} m</text>
    <text x="80" y="52" className={styles.title}>杨氏双缝干涉</text>
  </g>;
}

function ThinFilmScene({ scene }: { scene: Scene }): JSX.Element {
  const nFilm = n(scene.n);
  return <g>
    <rect x="90" y="100" width="470" height="90" fill="rgba(142,202,230,.16)" />
    <rect x="90" y="190" width="470" height="58" fill="rgba(28,46,203,.14)" stroke={INDIGO} strokeWidth="1.5" />
    <rect x="90" y="248" width="470" height="74" fill="rgba(52,55,47,.10)" />
    <line x1="170" y1="62" x2="265" y2="190" stroke={CORAL} strokeWidth="2" />
    <Arrow x1={216} y1={122} x2={265} y2={190} label="入射" />
    <line x1="265" y1="190" x2="355" y2="62" stroke={INDIGO} strokeWidth="2" />
    <Arrow x1={312} y1={124} x2={355} y2={62} label="反射" color={INDIGO} />
    <line x1="265" y1="190" x2="335" y2="248" stroke={CORAL} strokeWidth="1.5" strokeDasharray="5 4" />
    <line x1="335" y1="248" x2="410" y2="190" stroke={CORAL} strokeWidth="1.5" />
    <line x1="410" y1="190" x2="480" y2="80" stroke={CORAL} strokeWidth="1.5" />
    <text x="110" y="128" className={styles.muted}>空气</text>
    <text x="110" y="224" className={styles.inkText}>薄膜 n={nFilm.toPrecision(3)}</text>
    <text x="110" y="290" className={styles.muted}>玻璃</text>
    <text x="400" y="226" className={styles.muted}>d={n(scene.d * 1e9).toPrecision(4)} nm</text>
    <text x="80" y="360" className={styles.muted}>Δ=2nd={n(scene.opd * 1e9).toPrecision(4)} nm · {scene.state}</text>
    <text x="80" y="52" className={styles.title}>薄膜干涉</text>
  </g>;
}

function SingleSlitScene({ scene }: { scene: Scene }): JSX.Element {
  const list = samples(scene);
  const width = Math.max(n(scene.width), 1e-12);
  const maxI = Math.max(...list.map(item => n(item.I)), 1e-9);
  const screenX = 560;
  return <g>
    <line x1="220" y1="80" x2="220" y2="185" stroke={INK} strokeWidth="6" />
    <line x1="220" y1="235" x2="220" y2="350" stroke={INK} strokeWidth="6" />
    {Array.from({ length: 7 }, (_, index) => <line key={index} x1="90" y1={120 + index * 28} x2="212" y2={120 + index * 28} stroke={MUTED} strokeWidth="1.2" />)}
    <Arrow x1={150} y1={120} x2={205} y2={120} label="平行光" color={MUTED} />
    {[-60, -30, 0, 30, 60].map((offset, index) => <line key={index} x1="222" y1="210" x2={screenX} y2={210 + offset * 1.8} stroke={CORAL} strokeWidth="1.1" opacity=".5" />)}
    <line x1={screenX} y1="65" x2={screenX} y2="355" stroke={INK} strokeWidth="3" />
    {list.filter((_, index) => index % 2 === 0).map((item, index) => {
      const y = 210 - (n(item.y) / (3 * width)) * 130;
      return <rect key={index} x={screenX - 11} y={y - 1.5} width="22" height="3" rx="1.4"
        fill={CORAL} opacity={0.1 + 0.9 * (n(item.I) / maxI)} />;
    })}
    <line x1={screenX + 18} y1={210 - 43} x2={screenX + 18} y2={210 + 43} stroke={INDIGO} strokeWidth="1.5" />
    <text x={screenX + 24} y="214" className={styles.muted}>中央</text>
    <text x="80" y="360" className={styles.muted}>a={n(scene.a).toPrecision(3)} m · Δy=2λL/a={n(scene.width).toPrecision(4)} m</text>
    <text x="80" y="52" className={styles.title}>单缝衍射</text>
  </g>;
}

function GratingScene({ scene }: { scene: Scene }): JSX.Element {
  const orders = Array.isArray(scene.orders) ? scene.orders as { m: number; theta: number }[] : [];
  const shown = orders.filter(item => Math.abs(item.theta) < 72 && Math.abs(item.m) <= 4);
  return <g>
    <line x1="220" y1="70" x2="220" y2="350" stroke={INK} strokeWidth="3" />
    {Array.from({ length: 17 }, (_, index) => <line key={index} x1="215" y1={80 + index * 16} x2="225" y2={80 + index * 16} stroke={INK} strokeWidth="1.4" />)}
    {[150, 190, 230, 270].map((y, index) => <line key={index} x1="90" y1={y} x2="212" y2={y} stroke={MUTED} strokeWidth="1.2" />)}
    <Arrow x1={140} y1={150} x2={208} y2={150} label="入射光" color={MUTED} />
    {shown.map((item, index) => {
      const rad = (item.theta * Math.PI) / 180;
      const x2 = 555;
      const y2 = 210 - Math.tan(rad) * 345;
      return <g key={index}>
        <line x1="228" y1="210" x2={x2} y2={Math.max(60, Math.min(360, y2))} stroke={item.m === 0 ? INDIGO : CORAL} strokeWidth={item.m === 0 ? 2.5 : 1.6} opacity=".8" />
        <text x={x2 - 18} y={Math.max(72, Math.min(350, y2))} className={styles.muted}>{item.m}</text>
      </g>;
    })}
    <text x="80" y="52" className={styles.title}>光栅衍射</text>
    <text x="80" y="372" className={styles.muted}>d={n(scene.d * 1e6).toPrecision(4)} μm · θ₁={n(scene.theta).toPrecision(4)}° · k_max={n(scene.maxOrder)}</text>
  </g>;
}

function PolarizationScene({ scene }: { scene: Scene }): JSX.Element {
  const theta = n(scene.theta);
  return <g>
    <line x1="80" y1="210" x2="540" y2="210" className={styles.axis} />
    <circle cx="92" cy="210" r="12" className={styles.object} />
    <rect x="235" y="130" width="12" height="160" fill="rgba(28,46,203,.18)" stroke={INDIGO} />
    <line x1="241" y1="140" x2="241" y2="280" stroke={INDIGO} strokeWidth="2" />
    <rect x="415" y="130" width="12" height="160" fill="rgba(184,67,31,.12)" stroke={CORAL} />
    <g transform={`rotate(${theta} 421 210)`}>
      <line x1="421" y1="140" x2="421" y2="280" stroke={CORAL} strokeWidth="2" />
    </g>
    <path d="M421 140 A74 74 0 0 1 490 192" fill="none" stroke={MUTED} strokeDasharray="4 4" />
    <text x="460" y="160" className={styles.muted}>θ={theta.toPrecision(3)}°</text>
    <Arrow x1={100} y1={180} x2={220} y2={180} label="自然光 I0" color={MUTED} />
    <Arrow x1={300} y1={180} x2={405} y2={180} label="I1" color={INDIGO} />
    <Arrow x1={460} y1={180} x2={525} y2={180} label="I2" color={CORAL} />
    <text x="80" y="52" className={styles.title}>偏振与马吕斯定律</text>
    <text x="80" y="360" className={styles.muted}>I1={n(scene.I1).toPrecision(4)} W/m² · I2={n(scene.I2).toPrecision(4)} W/m² · θ_B={n(scene.brewster).toPrecision(4)}°</text>
  </g>;
}

function RefractionScene({ scene }: { scene: Scene }): JSX.Element {
  const angle1 = (n(scene.angle1) * Math.PI) / 180;
  const angle2 = scene.angle2 === null || scene.angle2 === undefined ? null : (n(scene.angle2) * Math.PI) / 180;
  const originX = 320, originY = 220, length = 190;
  const incidentX = originX - Math.sin(angle1) * length;
  const incidentY = originY - Math.cos(angle1) * length;
  const reflectedX = originX + Math.sin(angle1) * length;
  const refractedX = angle2 === null ? null : originX + Math.sin(angle2) * length;
  const refractedY = angle2 === null ? null : originY + Math.cos(angle2) * length;
  return <g>
    <rect x="70" y="70" width="500" height="150" fill="rgba(142,202,230,.10)" />
    <rect x="70" y="220" width="500" height="150" fill="rgba(28,46,203,.08)" />
    <line x1="60" y1="220" x2="580" y2="220" stroke={INK} strokeWidth="2" />
    <line x1={originX} y1="70" x2={originX} y2="360" stroke={MUTED} strokeDasharray="5 5" />
    <line x1={incidentX} y1={incidentY} x2={originX} y2={originY} stroke={CORAL} strokeWidth="2" />
    <Arrow x1={incidentX + 30} y1={incidentY + 30} x2={originX} y2={originY} label="入射" />
    <line x1={originX} y1={originY} x2={reflectedX} y2={incidentY} stroke={INDIGO} strokeWidth="1.6" strokeDasharray="5 4" />
    {refractedX !== null && refractedY !== null ? <line x1={originX} y1={originY} x2={refractedX} y2={refractedY} stroke={INDIGO} strokeWidth="2" /> : null}
    <text x="90" y="100" className={styles.muted}>n1={n(scene.n1).toPrecision(3)}</text>
    <text x="90" y="330" className={styles.muted}>n2={n(scene.n2).toPrecision(3)}</text>
    <text x={originX + 12} y="206" className={styles.muted}>法线</text>
    <text x="80" y="52" className={styles.title}>折射与全反射</text>
    <text x="80" y="372" className={styles.muted}>{scene.tir ? `全反射 · 临界角 θc=${n(scene.critical).toPrecision(4)}°` : `θ1=${n(scene.angle1).toPrecision(4)}° · θ2=${n(scene.angle2).toPrecision(4)}° · θc=${n(scene.critical).toPrecision(4)}°`}</text>
  </g>;
}

function LensScene({ scene }: { scene: Scene }): JSX.Element {
  const focal = n(scene.f), distance = n(scene.u), image = n(scene.v);
  const scale = 230 / Math.max(Math.abs(distance), Math.abs(image), Math.abs(focal), 0.05);
  const lensX = 320, axisY = 220;
  const objectX = lensX - distance * scale;
  const imageX = lensX + image * scale;
  const objectHeight = 62;
  const imageHeight = Math.max(10, Math.min(130, objectHeight * Math.abs(n(scene.m))));
  const imageTipY = axisY + (n(scene.inverted) ? imageHeight : -imageHeight);
  return <g>
    <line x1="60" y1={axisY} x2="590" y2={axisY} className={styles.axis} />
    <ellipse cx={lensX} cy={axisY} rx="14" ry="108" fill="rgba(28,46,203,.10)" stroke={INDIGO} strokeWidth="2" />
    <circle cx={lensX - focal * scale} cy={axisY} r="4" fill={MUTED} />
    <circle cx={lensX + focal * scale} cy={axisY} r="4" fill={MUTED} />
    <text x={lensX - focal * scale - 6} y={axisY + 22} className={styles.muted}>F</text>
    <text x={lensX + focal * scale - 2} y={axisY + 22} className={styles.muted}>F′</text>
    <line x1={objectX} y1={axisY} x2={objectX} y2={axisY - objectHeight} stroke={CORAL} strokeWidth="3" />
    <path d={`M${objectX - 7} ${axisY - objectHeight + 12}L${objectX} ${axisY - objectHeight}L${objectX + 7} ${axisY - objectHeight + 12}`} fill="none" stroke={CORAL} strokeWidth="2" />
    <line x1={imageX} y1={axisY} x2={imageX} y2={imageTipY} stroke={INDIGO} strokeWidth="2.5" strokeDasharray={n(scene.real) ? undefined : '6 4'} />
    <path d={`M${imageX - 7} ${imageTipY + (n(scene.inverted) ? -12 : 12)}L${imageX} ${imageTipY}L${imageX + 7} ${imageTipY + (n(scene.inverted) ? -12 : 12)}`} fill="none" stroke={INDIGO} strokeWidth="2" />
    <line x1={objectX} y1={axisY - objectHeight} x2={lensX} y2={axisY} stroke={MUTED} strokeDasharray="4 4" />
    <line x1={lensX} y1={axisY} x2={imageX} y2={imageTipY} stroke={MUTED} strokeDasharray="4 4" />
    <text x="80" y="52" className={styles.title}>{n(scene.convex) ? '凸透镜成像' : '凹透镜成像'}</text>
    <text x="80" y="382" className={styles.muted}>u={distance.toPrecision(4)} m · v={image.toPrecision(4)} m · m={n(scene.m).toPrecision(4)} · {n(scene.inverted) ? '倒立' : '正立'}{n(scene.real) ? '实像' : '虚像'}</text>
  </g>;
}

function PhotoelectricScene({ scene }: { scene: Scene }): JSX.Element {
  const occurs = Boolean(scene.occurs);
  return <g>
    <rect x="430" y="120" width="18" height="190" rx="4" fill={occurs ? 'rgba(184,67,31,.18)' : 'rgba(127,129,117,.14)'} stroke={occurs ? CORAL : MUTED} />
    <path d="M120 185q18-22 36 0t36 0t36 0t36 0t36 0t36 0" fill="none" stroke={CORAL} strokeWidth="2" />
    <Arrow x1={300} y1={185} x2={420} y2={185} label="hν" color={CORAL} />
    {occurs ? <>
      <circle cx="470" cy="160" r="8" className={styles.object} />
      <Arrow x1={478} y1={154} x2={530} y2={108} label="e⁻" color={INDIGO} />
    </> : <text x="470" y="100" className={styles.muted}>未发生光电效应</text>}
    <text x="80" y="52" className={styles.title}>光电效应</text>
    <text x="80" y="360" className={styles.muted}>E={n(scene.E).toPrecision(4)} eV · W={n(scene.W).toPrecision(4)} eV · Ek={Math.max(n(scene.Ek), 0).toPrecision(4)} eV · Ua={n(scene.Ua).toPrecision(4)} V</text>
    <text x="80" y="382" className={styles.muted}>截止波长 λ0={n(scene.lam0 * 1e9).toPrecision(4)} nm</text>
  </g>;
}

function DeBroglieScene({ scene }: { scene: Scene }): JSX.Element {
  const cycles = 3;
  const points = Array.from({ length: 121 }, (_, index) => {
    const ratio = index / 120;
    const x = 220 + ratio * 320;
    const y = 210 - Math.sin(ratio * Math.PI * 2 * cycles) * 46;
    return `${x},${y}`;
  }).join(' ');
  return <g>
    <line x1="70" y1="210" x2="560" y2="210" className={styles.axis} strokeDasharray="4 4" />
    <polyline points={points} fill="none" stroke={INDIGO} strokeWidth="2" />
    <circle cx="150" cy="210" r="15" className={styles.object} />
    <Arrow x1={166} y1={180} x2={220} y2={180} label="v" />
    <line x1="220" y1="280" x2="380" y2="280" stroke={MUTED} strokeWidth="1.5" />
    <line x1="220" y1="274" x2="220" y2="286" stroke={MUTED} strokeWidth="1.5" />
    <line x1="380" y1="274" x2="380" y2="286" stroke={MUTED} strokeWidth="1.5" />
    <text x="300" y="300" textAnchor="middle" className={styles.muted}>λ={n(scene.lam).toExponential(3)} m</text>
    <text x="80" y="52" className={styles.title}>{n(scene.electron) ? '电子的德布罗意波' : '宏观物体的物质波'}</text>
    <text x="80" y="360" className={styles.muted}>p={n(scene.p).toExponential(3)} kg·m/s · v={n(scene.v).toExponential(3)} m/s · Ek={n(scene.Ek).toPrecision(4)} eV</text>
  </g>;
}

function EnergyLevelScene({ scene }: { scene: Scene }): JSX.Element {
  const levels = Array.isArray(scene.levels) ? scene.levels as { n: number; E: number }[] : [];
  const energies = levels.map(item => n(item.E));
  const top = Math.max(...energies, -1e-9);
  const bottom = Math.min(...energies, -1e-9);
  const span = Math.max(top - bottom, 1e-9);
  const yFor = (energy: number): number => 330 - ((energy - bottom) / span) * 250;
  const yHi = yFor(n(scene.levels?.find((item: { n: number }) => item.n === n(scene.n_hi))?.E ?? top));
  const yLo = yFor(n(scene.levels?.find((item: { n: number }) => item.n === n(scene.n_lo))?.E ?? bottom));
  const arrowX = 350;
  return <g>
    {levels.map((item, index) => {
      const y = yFor(n(item.E));
      return <g key={index}>
        <line x1="150" y1={y} x2="470" y2={y} stroke={MUTED} strokeWidth="2" />
        <text x="140" y={y + 4} textAnchor="end" className={styles.muted}>{n(scene.hydrogen) ? `n=${item.n}` : `E${item.n}`}</text>
        <text x="480" y={y + 4} className={styles.muted}>{n(item.E).toPrecision(4)} eV</text>
      </g>;
    })}
    <Arrow x1={arrowX} y1={yHi} x2={arrowX} y2={yLo} label="ΔE" />
    <line x1={arrowX + 30} y1={yHi} x2="500" y2={yHi} stroke={CORAL} strokeWidth="1.4" strokeDasharray="4 4" />
    <text x="80" y="52" className={styles.title}>能级跃迁</text>
    <text x="80" y="372" className={styles.muted}>ΔE={n(scene.deltaE).toPrecision(4)} eV · λ={n(scene.lam * 1e9).toPrecision(4)} nm{n(scene.group_n) >= 2 ? ` · 最多 ${n(scene.lines)} 种谱线` : ''}</text>
  </g>;
}

function DecayScene({ scene }: { scene: Scene }): JSX.Element {
  const list = samples(scene);
  const T = Math.max(n(scene.T), 1e-9);
  const maxT = Math.max(...list.map(item => n(item.t)), 1);
  const px = (value: number): number => 80 + (value / maxT) * 450;
  const py = (value: number): number => 330 - (value / Math.max(n(scene.N0), 1e-9)) * 230;
  const path = list.map(item => `${px(n(item.t))},${py(n(item.N))}`).join(' ');
  const currentY = py(n(scene.N));
  return <g>
    <line x1="70" y1="330" x2="560" y2="330" className={styles.axis} />
    <line x1="80" y1="80" x2="80" y2="340" className={styles.axis} />
    {[1, 2, 3].map(mark => mark * T <= maxT ? <g key={mark}>
      <line x1={px(mark * T)} y1="90" x2={px(mark * T)} y2="330" stroke={MUTED} strokeDasharray="4 4" />
      <text x={px(mark * T)} y="346" textAnchor="middle" className={styles.muted}>{mark}T</text>
    </g> : null)}
    <polyline points={path} fill="none" stroke={INDIGO} strokeWidth="2.5" />
    <circle cx={px(n(scene.t))} cy={currentY} r="6" className={styles.object} />
    <text x="80" y="52" className={styles.title}>放射性衰变曲线</text>
    <text x="80" y="376" className={styles.muted}>N={n(scene.N).toExponential(3)} · 剩余 {n(scene.fraction * 100).toPrecision(4)}% · A={n(scene.A).toExponential(3)} Bq</text>
  </g>;
}

function chartFor(scene: Scene, current: Sample): JSX.Element | null {
  const list = samples(scene);
  if (scene.type === 'linear' || scene.type === 'oscillation') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => scene.type === 'linear' ? n(item.v) : n(item.x))} label={scene.type === 'linear' ? 'v-t 图像' : 'x-t 图像'} />;
  }
  if (scene.type === 'fall' || scene.type === 'projectile') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => scene.type === 'fall' ? n(item.v) : Math.hypot(n(item.vx), n(item.vy)))} label="速率随时间变化" color={CORAL} />;
  }
  if (scene.type === 'pendulum') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => n(item.theta))} label="θ-t 图像" />;
  }
  if (scene.type === 'incline') {
    return <Bars label="受力大小 (N)" items={[{ label: 'N', value: n(scene.normal), color: INDIGO }, { label: 'f', value: n(scene.friction), color: CORAL }, { label: 'mg sinθ', value: n(scene.gravityAlong), color: MUTED }]} />;
  }
  if (scene.type === 'atwood') {
    return <Bars label="力 (N)" items={[{ label: 'T', value: n(scene.T), color: INDIGO }, { label: 'm2g', value: n(scene.m2) * n(scene.g), color: CORAL }]} />;
  }
  if (scene.type === 'spring_work') {
    const x = Math.max(n(scene.x), 1e-6);
    return <LineChart xs={[0, x / 2, x]} ys={[0, n(scene.F) / 2, n(scene.F)]} label="F-x 图像（面积=功）" color={INDIGO} current={2} />;
  }
  if (scene.type === 'work_energy' || scene.type === 'energy' || scene.type === 'impulse' || scene.type === 'collision') {
    const items = scene.type === 'collision'
      ? [{ label: '碰前 p', value: n(scene.p), color: INDIGO }, { label: '动能前', value: n(scene.K0), color: MUTED }, { label: '动能后', value: n(scene.K1), color: CORAL }]
      : scene.type === 'impulse'
        ? [{ label: 'I', value: n(scene.impulse), color: INDIGO }, { label: 'F平均', value: n(scene.average), color: CORAL }]
        : scene.type === 'energy'
          ? [{ label: 'Ep', value: n(scene.energy), color: INDIGO }, { label: 'Ek', value: n(scene.energy), color: CORAL }]
          : [{ label: '初动能', value: n(scene.K0), color: MUTED }, { label: '做功', value: n(scene.W), color: INDIGO }, { label: '末动能', value: n(scene.K1), color: CORAL }];
    return <Bars label="能量 / 动量核对" items={items} />;
  }
  if (scene.type === 'circular') {
    return <Bars label="向心量与周期" items={[{ label: 'a', value: n(scene.a), color: INDIGO }, { label: 'F', value: n(scene.F), color: CORAL }, { label: 'T', value: n(scene.T), color: MUTED }]} />;
  }
  if (scene.type === 'relative') {
    return <Bars label="速度 (m/s)" items={[{ label: 'vA', value: n(scene.vA), color: INDIGO }, { label: 'vB', value: n(scene.vB), color: MUTED }, { label: 'vAB', value: n(scene.rel), color: CORAL }]} />;
  }
  if (scene.type === 'shm') {
    const listShm = Array.from({ length: 33 }, (_, i) => {
      const t = (i / 32) * n(scene.T);
      return { t, x: n(scene.A) * Math.cos(n(scene.omega) * t + n(scene.phi) * Math.PI / 180) };
    });
    return <LineChart xs={listShm.map(item => item.t)} ys={listShm.map(item => item.x)} label="x-t 图像" current={Math.round((n(scene.t) / Math.max(n(scene.T), 1e-9)) * 32)} />;
  }
  if (scene.type === 'rotation') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => n(item.omega))} label="ω-t 图像" />;
  }
  if (scene.type === 'rolling') {
    return <Bars label="能量分配 (J)" items={[{ label: '平动', value: n(scene.Kt), color: INDIGO }, { label: '转动', value: n(scene.Kr), color: CORAL }]} />;
  }
  if (scene.type === 'circuit' && scene.circuit === 'rc') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => n(item.q))} label="q-t 图像" color={CORAL} />;
  }
  if (scene.type === 'electric') {
    return <Bars label="电场分量 (N/C)" items={[{ label: 'E1', value: n(scene.E1), color: INDIGO }, { label: 'E2', value: n(scene.E2), color: CORAL }, { label: 'E', value: n(scene.E), color: INK }]} />;
  }
  if (scene.type === 'double_slit' || scene.type === 'single_slit') {
    return <LineChart xs={list.map(item => n(item.y))} ys={list.map(item => n(item.I))} label="光强分布" color={CORAL} />;
  }
  if (scene.type === 'polarization') {
    const firstIntensity = n(scene.I1);
    const points = Array.from({ length: 91 }, (_, index) => ({ theta: index, I: firstIntensity * Math.cos(index * Math.PI / 180) ** 2 }));
    return <LineChart xs={points.map(item => item.theta)} ys={points.map(item => item.I)} label="I-θ 曲线" color={CORAL} current={Math.round(n(scene.theta))} />;
  }
  if (scene.type === 'photoelectric') {
    return <LineChart xs={list.map(item => n(item.f))} ys={list.map(item => n(item.Ek))} label="Ek-f 图像" color={CORAL} />;
  }
  if (scene.type === 'grating') {
    const orders = Array.isArray(scene.orders) ? scene.orders as { m: number; theta: number }[] : [];
    return <Bars label="主极大衍射角 (°)" items={orders.filter(item => item.m >= 0).slice(0, 5).map(item => ({ label: `k=${item.m}`, value: item.theta, color: item.m === 0 ? MUTED : INDIGO }))} />;
  }
  if (scene.type === 'refraction') {
    const items = [{ label: '入射', value: n(scene.angle1), color: INDIGO }];
    if (scene.angle2 !== null && scene.angle2 !== undefined) items.push({ label: '折射', value: n(scene.angle2), color: CORAL });
    if (scene.critical !== null && scene.critical !== undefined) items.push({ label: '临界', value: n(scene.critical), color: MUTED });
    return <Bars label="角度 (°)" items={items} />;
  }
  if (scene.type === 'lens') {
    return <Bars label="距离 (m)" items={[{ label: 'u', value: n(scene.u), color: INDIGO }, { label: '|v|', value: Math.abs(n(scene.v)), color: CORAL }, { label: '|f|', value: Math.abs(n(scene.f)), color: MUTED }]} />;
  }
  if (scene.type === 'decay') {
    return <LineChart xs={list.map(item => n(item.t))} ys={list.map(item => n(item.N))} label="N-t 衰变曲线" color={CORAL} />;
  }
  return null;
}

export function PhysicsCanvas({ result, step }: Props): JSX.Element {
  const scene = result.scene as Scene;
  const current = currentSample(scene, step, result.trace.length);
  const modeLabel = PHYSICS_MODE_LABELS[result.mode] ?? result.mode ?? '物理实验';
  const sceneBody = (() => {
    switch (scene.type) {
      case 'linear': return <LinearScene scene={scene} current={current} />;
      case 'fall': return <FallScene scene={scene} current={current} />;
      case 'projectile': return <ProjectileScene scene={scene} current={current} />;
      case 'relative': return <RelativeScene scene={scene} />;
      case 'incline': return <InclineScene scene={scene} />;
      case 'atwood': return <AtwoodScene scene={scene} />;
      case 'circular': return <CircularScene scene={scene} step={step} traceLength={result.trace.length} />;
      case 'spring_work': return <SpringWorkScene scene={scene} />;
      case 'work_energy': return <WorkEnergyScene scene={scene} />;
      case 'energy': return <EnergyScene scene={scene} />;
      case 'impulse': return <ImpulseScene scene={scene} />;
      case 'collision': return <CollisionScene scene={scene} />;
      case 'oscillation': return <OscillationScene scene={scene} current={current} />;
      case 'pendulum': return <PendulumScene scene={scene} current={current} />;
      case 'shm': return <ShmScene scene={scene} />;
      case 'rotation': return <RotationScene scene={scene} step={step} traceLength={result.trace.length} />;
      case 'rolling': return <RollingScene scene={scene} step={step} traceLength={result.trace.length} />;
      case 'wave': return <WaveScene scene={scene} />;
      case 'standing': return <StandingScene scene={scene} />;
      case 'electric': return <ElectricScene scene={scene} />;
      case 'gauss': return <GaussScene scene={scene} />;
      case 'circuit': return <CircuitScene scene={scene} />;
      case 'magnetic': return <MagneticScene scene={scene} step={step} traceLength={result.trace.length} />;
      case 'ampere': return <AmpereScene scene={scene} />;
      case 'induction': return <InductionScene scene={scene} />;
      case 'thermo': return <ThermoScene scene={scene} step={step} traceLength={result.trace.length} />;
      case 'double_slit': return <DoubleSlitScene scene={scene} />;
      case 'thin_film': return <ThinFilmScene scene={scene} />;
      case 'single_slit': return <SingleSlitScene scene={scene} />;
      case 'grating': return <GratingScene scene={scene} />;
      case 'polarization': return <PolarizationScene scene={scene} />;
      case 'refraction': return <RefractionScene scene={scene} />;
      case 'lens': return <LensScene scene={scene} />;
      case 'photoelectric': return <PhotoelectricScene scene={scene} />;
      case 'de_broglie': return <DeBroglieScene scene={scene} />;
      case 'energy_level': return <EnergyLevelScene scene={scene} />;
      case 'decay': return <DecayScene scene={scene} />;
      default: return <text x="80" y="120" className={styles.label}>暂无可视化场景</text>;
    }
  })();
  return <div className={styles.root}>
    <svg className={styles.stage} viewBox="0 0 900 420" role="img" aria-label={`${modeLabel}交互实验`}>
      {Array.from({ length: 17 }, (_, index) => <line key={`v${index}`} x1={24 + index * 52} y1="18" x2={24 + index * 52} y2="402" className={styles.grid} />)}
      {Array.from({ length: 9 }, (_, index) => <line key={`h${index}`} x1="24" y1={24 + index * 46} x2="876" y2={24 + index * 46} className={styles.grid} />)}
      <text x="70" y="26" className={styles.muted}>PHYSICS / INTERACTIVE MODEL</text>
      {sceneBody}
      {chartFor(scene, current)}
    </svg>
    <div className={styles.readout} aria-label="物理结果">
      {result.metrics.map(item => <div key={item.id} className={`${styles.metric} ${item.tone === 'accent' ? styles.metricAccent : ''}`}>
        <span>{item.label}</span><b>{item.value}</b>
      </div>)}
    </div>
    <div className={styles.checks} aria-label="结果核对">
      {result.checks.map(item => <div key={item.id} className={`${styles.check} ${item.status === 'pass' ? '' : styles.checkWarn}`}>
        <span className={styles.checkIcon}>{item.status === 'pass' ? '✓' : '!'}</span>
        <span><b>{item.label}</b>{item.detail}</span>
      </div>)}
    </div>
    <p className={styles.hint}>{result.notes[0] ?? '参数由模型控制；每次调整都会重新计算并核对公式。'}</p>
  </div>;
}
