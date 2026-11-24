/**
 * PhysicsNodes.tsx —— 力学实验台节点体
 *
 * 所有节点体都是纯展示/编辑组件：状态来自 `self`（内核 physics.bodyAt 求值）与
 * `node.params`，任何改动经 `onParams` 上抛，组件自身不持有实验状态。
 */
import { useEffect, useRef } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import type { CanvasNode, PortValue } from './types.ts';
import {
  bodyAt, forcedSpringAt, inclineBodyAt, pendulumPeriod, physCycle, resonanceCurve, waveSamples,
  type PhysNodeType,
} from './physics.ts';
import { fmt } from './math.ts';
import styles from './physics.module.css';

type BodyState = Extract<PortValue, { kind: 'body' }>;
type Params = Record<string, number>;

const DEG = Math.PI / 180;
const ORANGE = '#ff7a59';
const BLUE = '#4f46e5';
const SKY = '#8ecae6';
const GREEN = '#2f9a72';
const INK = '#2f3a49';

const asBody = (v: PortValue | null | undefined): BodyState | null => (v && v.kind === 'body' ? v : null);

const P = (node: CanvasNode, key: string, fallback: number): number => {
  const raw = node.params[key];
  return raw === undefined || !Number.isFinite(raw) ? fallback : raw;
};

const onOff = (b: boolean): number => (b ? 1 : 0);

function Unwired({ label }: { label: string }): JSX.Element {
  return (
    <p className={styles.unwired} role="status">
      <span aria-hidden="true">◇</span> 未连线：把「时间源」或力学源的 body 输出拖到左侧输入，{label}就活了
    </p>
  );
}

function Row({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const commit = (el: HTMLInputElement): void => {
    const v = el.valueAsNumber;
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    else el.value = fmt(value);
  };
  return (
    <label className={styles.row}>
      <span>{label}</span>
      <input
        type="range" className={styles.slider}
        min={min} max={max} step={step} value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        key={fmt(value)} type="number" className={styles.num}
        min={min} max={max} step={step} defaultValue={fmt(value)}
        aria-label={`${label}数值`} inputMode="decimal"
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget); }
          if (e.key === 'Escape') { e.currentTarget.value = fmt(value); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={on ? styles.toggleOn : styles.toggle} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

function Arrow({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }): JSX.Element {
  const an = Math.atan2(y2 - y1, x2 - x1);
  const h = 6;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <path
        d={`M${fmt(x2, 1)},${fmt(y2, 1)}L${fmt(x2 - h * Math.cos(an - 0.45), 1)},${fmt(y2 - h * Math.sin(an - 0.45), 1)}L${fmt(x2 - h * Math.cos(an + 0.45), 1)},${fmt(y2 - h * Math.sin(an + 0.45), 1)}Z`}
        fill={color}
      />
    </g>
  );
}

/** 矢量 → 屏幕位移（世界 y 向上，svg y 向下），长度封顶。 */
function screenVec(vx: number, vy: number, k: number, cap: number): [number, number] {
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return [0, 0];
  const s = Math.min(cap, len * k) / len;
  return [vx * s, -vy * s];
}

function samplePoints(type: PhysNodeType, params: Params, tEnd: number, n = 60): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = bodyAt(type, params, (i / n) * Math.max(0, tEnd));
    if (s.kind === 'body') pts.push([s.x, s.y]);
  }
  return pts;
}

/* ============================== 抛体 ============================== */

export function ProjectileBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const v0 = Math.max(0.5, P(node, 'v0', 8));
  const ang = P(node, 'angle', 55);
  const g = Math.max(0.1, P(node, 'g', 9.8));
  const running = P(node, 'running', 1) !== 0;
  const compare = P(node, 'compare', 0) !== 0;
  const fan = P(node, 'fan', 0) !== 0;
  const showV = P(node, 'showVelocity', 0) !== 0;
  const showF = P(node, 'showForce', 0) !== 0;
  const strobe = P(node, 'showStrobe', 0) !== 0;

  const rad = ang * DEG;
  const rangeOf = (deg: number): number => Math.max(0.1, (v0 * v0 * Math.sin(2 * deg * DEG)) / g);
  const fanAngles = [30, 45, 60] as const;
  const fanColors = [SKY, '#d9b26f', '#b58ed6'] as const;
  const range = fan ? Math.max(rangeOf(ang), ...fanAngles.map(rangeOf)) : rangeOf(ang);
  const hMax = Math.max(0.05, (v0 * Math.sin(rad)) ** 2 / (2 * g));
  const cycle = physCycle('projectile', node.params);

  const W = 210, H = 122, base = 86;
  const px = (x: number): number => 8 + (x / Math.max(range, 1e-6)) * (W - 16);
  const py = (y: number): number => base - (y / Math.max(hMax, 1e-6)) * (base - 22);
  const line = (pts: [number, number][]): string => pts.map(([x, y]) => `${fmt(px(x), 1)},${fmt(py(y), 1)}`).join(' ');
  const trace = samplePoints('projectile', node.params, cycle, 72);
  const bx = b ? px(b.x) : px(0);
  const by = b ? py(b.y) : py(0);
  const [vdx, vdy] = b ? screenVec(b.vx, b.vy, 5, 26) : [0, 0];
  const [fdx, fdy] = b && b.fx !== undefined && b.fy !== undefined ? screenVec(b.fx, b.fy, 3, 22) : [0, 0];
  const t = b && Math.cos(rad) > 1e-6 ? b.x / (v0 * Math.cos(rad)) : 0;
  const fallY = -0.5 * g * t * t;
  const fallPy = Math.max(py(fallY), H - 8);

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="抛体运动">
        <line x1="0" y1={base} x2={W} y2={base} stroke={INK} strokeWidth="1.2" />
        <line x1="8" y1="10" x2="8" y2={base} stroke="#d5ccb9" strokeDasharray="3 3" />
        {fan ? fanAngles.map((deg, i) => {
          const params = { ...node.params, angle: deg };
          return (
            <polyline
              key={deg}
              points={line(samplePoints('projectile', params, physCycle('projectile', params), 48))}
              fill="none" stroke={fanColors[i] ?? SKY} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.9"
            />
          );
        }) : null}
        <polyline points={line(trace)} fill="none" stroke="#ede7da" strokeWidth="1.4" strokeDasharray="3 3" />
        {strobe ? trace.filter((_, i) => i % 7 === 0).map(([x, y], i) => (
          <circle key={`s${i}`} cx={px(x)} cy={py(y)} r={1.8} fill="#c7bfae" />
        )) : null}
        {compare ? (
          <g>
            <line x1={bx} y1={base} x2={bx} y2={fallPy} stroke={SKY} strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={bx} cy={fallPy} r={4} fill={SKY} stroke="#fff" strokeWidth="1.2" />
          </g>
        ) : null}
        {b && showV ? <Arrow x1={bx} y1={by} x2={bx + vdx} y2={by + vdy} color={BLUE} /> : null}
        {b && showF ? <Arrow x1={bx} y1={by} x2={bx + fdx} y2={by + fdy} color={ORANGE} /> : null}
        {b ? <circle cx={bx} cy={by} r={4.5} fill={ORANGE} stroke="#fff" strokeWidth="1.2" /> : null}
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="速度矢量" on={showV} onClick={() => onParams?.({ showVelocity: onOff(!showV) })} />
        <Toggle label="受力矢量" on={showF} onClick={() => onParams?.({ showForce: onOff(!showF) })} />
        <Toggle label="频闪" on={strobe} onClick={() => onParams?.({ showStrobe: onOff(!strobe) })} />
        <Toggle label="自由落体对照" on={compare} onClick={() => onParams?.({ compare: onOff(!compare) })} />
        <Toggle label="多角度叠图" on={fan} onClick={() => onParams?.({ fan: onOff(!fan) })} />
      </div>
      {b ? (
        <div className={styles.readout}>
          <span>x <b>{fmt(b.x)}</b>m</span>
          <span>y <b>{fmt(b.y)}</b>m</span>
          <span>|v| <b>{fmt(Math.hypot(b.vx, b.vy))}</b>m/s</span>
          <span><i>射程</i> {fmt(range)}m</span>
        </div>
      ) : null}
      {!inCard && <>
        <Row label="v0 m/s" value={v0} min={0.5} max={80} step={0.5} onChange={(v) => onParams?.({ v0: v })} />
        <Row label="角度°" value={ang} min={0} max={90} step={0.5} onChange={(v) => onParams?.({ angle: v })} />
        <Row label="g m/s²" value={g} min={0.1} max={50} step={0.1} onChange={(v) => onParams?.({ g: v })} />
      </>}
    </div>
  );
}

/* ============================== 弹簧振子 ============================== */

export function SpringBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const k = Math.max(0.1, P(node, 'k', 6));
  const m = Math.max(0.05, P(node, 'm', 1));
  const A = Math.max(0.1, Math.abs(P(node, 'x0', 1)));
  const running = P(node, 'running', 1) !== 0;
  const showV = P(node, 'showVelocity', 0) !== 0;
  const showF = P(node, 'showForce', 0) !== 0;
  const strobe = P(node, 'showStrobe', 0) !== 0;
  const w = Math.sqrt(k / m);
  const x = b ? b.x : A;
  const vx = b ? b.vx : 0;

  const W = 200, H = 88, wall = 14, track = 70, cx = 104, maxPx = 58;
  const sx = maxPx / A;
  const bx = cx + x * sx;
  const seg = 7;
  const sx0 = wall + 2, sx1 = Math.max(sx0 + 8, bx - 11);
  const coil = Array.from({ length: seg + 1 }, (_, i) => {
    const cxp = sx0 + ((sx1 - sx0) * i) / seg;
    const cyp = i === 0 || i === seg ? 40 : i % 2 ? 28 : 52;
    return `${fmt(cxp, 1)},${cyp}`;
  }).join(' ');
  const [vdx] = screenVec(vx, 0, 8, 26);
  const force = b && b.fx !== undefined ? b.fx : -k * x;
  const [fdx] = screenVec(force, 0, 4, 24);
  const ke = b && b.ke !== undefined ? b.ke : 0.5 * m * vx * vx;
  const pe = b && b.pe !== undefined ? b.pe : 0.5 * k * x * x;
  const total = Math.max(ke + pe, 1e-9);

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="弹簧振子">
        <line x1={wall} y1="10" x2={wall} y2={track} stroke={INK} strokeWidth="2.4" />
        <line x1="0" y1={track} x2={W} y2={track} stroke={INK} strokeWidth="1.2" />
        <line x1={cx - A * sx} y1={track + 4} x2={cx + A * sx} y2={track + 4} stroke="#d5ccb9" strokeWidth="2" strokeLinecap="round" />
        {strobe ? Array.from({ length: 13 }, (_, i) => {
          const sxp = cx + A * Math.cos((i / 12) * Math.PI) * sx;
          return <circle key={`s${i}`} cx={sxp} cy={track + 4} r={1.6} fill="#c7bfae" />;
        }) : null}
        <polyline points={coil} fill="none" stroke={INK} strokeWidth="1.6" />
        {showV ? <Arrow x1={bx} y1={roadY(track)} x2={bx + vdx} y2={roadY(track)} color={BLUE} /> : null}
        {showF ? <Arrow x1={bx} y1={52} x2={bx + fdx} y2={52} color={ORANGE} /> : null}
        <rect x={bx - 10} y={28} width={20} height={24} rx={3} fill={ORANGE} stroke="#fff" strokeWidth="1.2" />
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="速度矢量" on={showV} onClick={() => onParams?.({ showVelocity: onOff(!showV) })} />
        <Toggle label="受力矢量" on={showF} onClick={() => onParams?.({ showForce: onOff(!showF) })} />
        <Toggle label="频闪" on={strobe} onClick={() => onParams?.({ showStrobe: onOff(!strobe) })} />
      </div>
      <div className={styles.readout}>
        <span>x <b>{fmt(x)}</b>m</span>
        <span>v <b>{fmt(vx)}</b>m/s</span>
        <span><i>ω</i> {fmt(w)}</span>
        <span><i>T</i> {fmt((2 * Math.PI) / w)}s</span>
        <span>E <b>{fmt(total)}</b>J</span>
      </div>
      {!inCard && <>
        <Row label="k N/m" value={k} min={0.5} max={40} step={0.5} onChange={(v) => onParams?.({ k: v })} />
        <Row label="m kg" value={m} min={0.1} max={10} step={0.1} onChange={(v) => onParams?.({ m: v })} />
        <Row label="振幅 m" value={A} min={0.2} max={2} step={0.1} onChange={(v) => onParams?.({ x0: v })} />
      </>}
    </div>
  );
}

function roadY(track: number): number {
  return track - 22;
}

/* ============================== 单摆 ============================== */

export function PendulumBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const L = Math.max(0.2, P(node, 'L', 1.5));
  const th0 = P(node, 'theta0', 25);
  const g = Math.max(0.1, P(node, 'g', 9.8));
  const m = Math.max(0.05, P(node, 'm', 1));
  const running = P(node, 'running', 1) !== 0;
  const alt = P(node, 'alt', 1) !== 0;
  const showV = P(node, 'showVelocity', 0) !== 0;
  const showF = P(node, 'showForce', 0) !== 0;
  const strobe = P(node, 'showStrobe', 0) !== 0;

  const T = pendulumPeriod(L, th0, g);
  const s = 44 / L;
  const px = 100, py = 12;
  const fallTheta = th0 * DEG;
  const bx = px + (b ? b.x : L * Math.sin(fallTheta)) * s;
  const by = py - (b ? b.y : -L * Math.cos(fallTheta)) * s;
  const arc = samplePoints('pendulum', node.params, T / 2, 48)
    .map(([x, y]) => `${fmt(px + x * s, 1)},${fmt(py - y * s, 1)}`).join(' ');
  const small = b && b.altX !== undefined && b.altY !== undefined
    ? [px + b.altX * s, py - b.altY * s] as const
    : null;
  const theta = b && b.theta !== undefined ? b.theta : fallTheta;
  const [vdx, vdy] = b ? screenVec(b.vx, b.vy, 5, 24) : [0, 0];
  const [fdx, fdy] = b && b.fx !== undefined && b.fy !== undefined ? screenVec(b.fx, b.fy, 3, 22) : [0, 0];

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox="0 0 200 100" role="img" aria-label="单摆">
        <circle cx={px} cy={py} r={2.6} fill={INK} />
        <line x1={px} y1={py} x2={px} y2={py + 80} stroke="#ede7da" strokeWidth="1" strokeDasharray="2 4" />
        <polyline points={arc} fill="none" stroke="#ede7da" strokeWidth="1.4" strokeDasharray="3 3" />
        {strobe ? samplePoints('pendulum', node.params, T / 2, 24).map(([x, y], i) => (
          <circle key={`s${i}`} cx={px + x * s} cy={py - y * s} r={1.4} fill="#c7bfae" />
        )) : null}
        {b ? <line x1={px} y1={py} x2={bx} y2={by} stroke={INK} strokeWidth="1.6" /> : null}
        {alt && small ? (
          <g>
            <line x1={px} y1={py} x2={small[0]} y2={small[1]} stroke="#a8afba" strokeWidth="1.2" strokeDasharray="4 3" />
            <circle cx={small[0]} cy={small[1]} r={3.4} fill="none" stroke="#a8afba" strokeWidth="1.2" />
          </g>
        ) : null}
        {b && showV ? <Arrow x1={bx} y1={by} x2={bx + vdx} y2={by + vdy} color={BLUE} /> : null}
        {b && showF ? <Arrow x1={bx} y1={by} x2={bx + fdx} y2={by + fdy} color={ORANGE} /> : null}
        {b ? <circle cx={bx} cy={by} r={5} fill={ORANGE} stroke="#fff" strokeWidth="1.2" /> : null}
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="小角对照" on={alt} onClick={() => onParams?.({ alt: onOff(!alt) })} />
        <Toggle label="速度矢量" on={showV} onClick={() => onParams?.({ showVelocity: onOff(!showV) })} />
        <Toggle label="受力矢量" on={showF} onClick={() => onParams?.({ showForce: onOff(!showF) })} />
        <Toggle label="频闪" on={strobe} onClick={() => onParams?.({ showStrobe: onOff(!strobe) })} />
      </div>
      <div className={styles.readout}>
        <span>θ <b>{fmt(theta / DEG, 1)}</b>°</span>
        <span><i>T</i> <b>{fmt(T)}</b>s</span>
        <span><i>T小角</i> {fmt((2 * Math.PI) * Math.sqrt(L / g))}s</span>
        <span>E <b>{fmt((b?.ke ?? 0) + (b?.pe ?? 0))}</b>J</span>
      </div>
      {!inCard && <>
        <Row label="摆长 m" value={L} min={0.3} max={3} step={0.1} onChange={(v) => onParams?.({ L: v })} />
        <Row label="θ0°" value={th0} min={2} max={90} step={1} onChange={(v) => onParams?.({ theta0: v })} />
        <Row label="g m/s²" value={g} min={1} max={25} step={0.1} onChange={(v) => onParams?.({ g: v })} />
      </>}
    </div>
  );
}

/* ============================== 轨迹仪 ============================== */

export function TrailBody({ values, node, onParams }: NodeBodyProps): JSX.Element {
  const b = asBody(values.in);
  const mode = P(node, 'mode', 0);
  const hist = useRef<[number, number][]>([]);
  useEffect(() => { hist.current = []; }, [node.id, mode]);
  useEffect(() => {
    if (!b) return;
    const cur: [number, number] = mode === 1 ? [b.x, b.vx] : [b.x, b.y];
    const last = hist.current[hist.current.length - 1];
    if (!last || Math.hypot(last[0] - cur[0], last[1] - cur[1]) > 1e-4) {
      hist.current = [...hist.current.slice(-199), cur];
    }
  }, [b, mode]);
  if (!b) return <Unwired label="轨迹仪" />;

  const h = hist.current;
  const cur: [number, number] = mode === 1 ? [b.x, b.vx] : [b.x, b.y];
  const xs = h.map((p) => p[0]).concat(cur[0]);
  const ys = h.map((p) => p[1]).concat(cur[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spanX = Math.max(x1 - x0, 1e-6), spanY = Math.max(y1 - y0, 1e-6);
  const toPt = ([x, y]: [number, number]): string =>
    `${fmt(((x - x0) / spanX) * 178 + 8, 1)},${fmt(76 - ((y - y0) / spanY) * 62, 1)}`;
  const [cxp, cyp] = toPt(cur).split(',');

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox="0 0 194 82" role="img" aria-label={mode === 1 ? '相空间轨迹' : '运动轨迹'}>
        <polyline points={h.map(toPt).join(' ')} fill="none" stroke={ORANGE} strokeWidth={1.8} strokeLinejoin="round" />
        <circle cx={cxp} cy={cyp} r={3.4} fill={INK} />
      </svg>
      <div className={styles.toggles}>
        <Toggle label="空间 (x,y)" on={mode === 0} onClick={() => onParams?.({ mode: 0 })} />
        <Toggle label="相空间 (x,vₓ)" on={mode === 1} onClick={() => onParams?.({ mode: 1 })} />
      </div>
      <div className={styles.readout}>
        <span>(<b>{fmt(cur[0])}</b>, <b>{fmt(cur[1])}</b>)</span>
        <span><i>{h.length}</i> 点</span>
      </div>
    </div>
  );
}

/* ============================== 能量表 ============================== */

export function EnergyBody({ values }: NodeBodyProps): JSX.Element {
  const b = asBody(values.in);
  if (!b) return <Unwired label="能量表" />;
  const ke = b.ke ?? 0;
  const pe = b.pe ?? 0;
  const total = Math.max(ke + pe, 1e-9);
  const keW = (ke / total) * 100;
  const ax = b.ax ?? 0, ay = b.ay ?? 0;
  return (
    <div className={styles.body}>
      <div className={styles.barTrack} role="img" aria-label="动能与势能比例">
        <div className={styles.barKe} style={{ width: `${keW}%` }} />
        <div className={styles.barPe} style={{ width: `${100 - keW}%` }} />
      </div>
      <div className={styles.readout}>
        <span><b>{fmt(ke)}</b>J 动能</span>
        <span><b>{fmt(pe)}</b>J 势能</span>
        <span>总 <b>{fmt(ke + pe)}</b>J</span>
        <span><i>a</i> ({fmt(ax)}, {fmt(ay)})m/s²</span>
      </div>
      <div className={styles.legend}>
        <span><i style={{ background: ORANGE }} /> 动能</span>
        <span><i style={{ background: SKY }} /> 势能</span>
      </div>
    </div>
  );
}

/* ============================== 斜面 ============================== */

export function InclineBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const alpha = P(node, 'alpha', 30);
  const mu = P(node, 'mu', 0.3);
  const g = Math.max(0.1, P(node, 'g', 9.8));
  const m = Math.max(0.05, P(node, 'm', 1));
  const L = Math.max(0.2, P(node, 'L', 2));
  const running = P(node, 'running', 1) !== 0;
  const showForce = P(node, 'showForce', 1) !== 0;

  const rad = alpha * DEG;
  const s = b ? Math.max(0, Math.min(L, b.x)) : 0;
  const aNow = b?.ax ?? 0;
  const t = aNow > 1e-9 ? Math.sqrt((2 * s) / aNow) : 0;
  const st = inclineBodyAt(alpha, mu, g, m, L, t);
  const v = b ? b.vx : st.v;

  const W = 290, H = 140, topX = 18, topY = 10;
  const lenPx = Math.min(210, 115 / Math.max(Math.sin(rad), 0.25));
  const botX = topX + Math.cos(rad) * lenPx;
  const botY = topY + Math.sin(rad) * lenPx;
  const frac = Math.min(1, s / L);
  const bx = topX + (botX - topX) * frac;
  const by = topY + (botY - topY) * frac;
  const kF = 10 / Math.max(m * g, 1e-6);

  const along: [number, number] = [Math.cos(rad) * st.gravityAlong * kF, Math.sin(rad) * st.gravityAlong * kF];
  const upSlope: [number, number] = [-Math.cos(rad), -Math.sin(rad)];
  const normal: [number, number] = [Math.sin(rad), -Math.cos(rad)];

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="斜面与受力分解">
        <line x1="0" y1={Math.min(H - 6, botY)} x2={W} y2={Math.min(H - 6, botY)} stroke={INK} strokeWidth="1.2" />
        <polygon points={`${topX},${topY} ${botX},${botY} ${topX},${botY}`} fill="#ff7a590f" stroke="#d5ccb9" strokeWidth="1" />
        <text x={topX + 6} y={topY + 14}>α = {fmt(alpha, 0)}°</text>
        {showForce ? (
          <g>
            <Arrow x1={bx} y1={by} x2={bx + along[0]} y2={by + along[1]} color={ORANGE} />
            <Arrow x1={bx} y1={by} x2={bx + normal[0] * st.normal * kF} y2={by + normal[1] * st.normal * kF} color={BLUE} />
            <Arrow x1={bx} y1={by} x2={bx + upSlope[0] * st.friction * kF} y2={by + upSlope[1] * st.friction * kF} color={GREEN} />
          </g>
        ) : null}
        <rect
          transform={`translate(${fmt(bx, 1)},${fmt(by, 1)}) rotate(${fmt(alpha, 1)})`}
          x={-11} y={-15} width={22} height={15} rx={3}
          fill={ORANGE} stroke="#fff" strokeWidth="1.2"
        />
      </svg>
      {showForce ? (
        <div className={styles.legend}>
          <span><i style={{ background: ORANGE }} /> 重力沿斜面</span>
          <span><i style={{ background: BLUE }} /> 支持力</span>
          <span><i style={{ background: GREEN }} /> 摩擦</span>
        </div>
      ) : null}
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="受力分解" on={showForce} onClick={() => onParams?.({ showForce: onOff(!showForce) })} />
      </div>
      <div className={styles.readout}>
        <span><b>{st.sliding ? '滑动' : '静止'}</b></span>
        <span>s <b>{fmt(s)}</b>m</span>
        <span>v <b>{fmt(v)}</b>m/s</span>
        <span>a <b>{fmt(st.a)}</b>m/s²</span>
        <span><i>G∥</i> {fmt(st.gravityAlong)}N</span>
        <span><i>N</i> {fmt(st.normal)}N</span>
        <span><i>f</i> {fmt(st.friction)}N</span>
      </div>
      <p className={styles.caption}>tan α {st.sliding ? '>' : '≤'} μ：{st.sliding ? '重力分量超过最大静摩擦，开始下滑' : '静摩擦足以平衡，滑块保持不动'}</p>
      {!inCard && <>
        <Row label="α°" value={alpha} min={5} max={75} step={1} onChange={(v) => onParams?.({ alpha: v })} />
        <Row label="μ" value={mu} min={0} max={1} step={0.02} onChange={(v) => onParams?.({ mu: v })} />
        <Row label="L m" value={L} min={0.5} max={5} step={0.1} onChange={(v) => onParams?.({ L: v })} />
        <Row label="m kg" value={m} min={0.1} max={10} step={0.1} onChange={(v) => onParams?.({ m: v })} />
        <Row label="g m/s²" value={g} min={1} max={25} step={0.1} onChange={(v) => onParams?.({ g: v })} />
      </>}
    </div>
  );
}

/* ============================== 一维碰撞 ============================== */

export function CollisionBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const m1 = Math.max(0.1, P(node, 'm1', 1));
  const v1 = P(node, 'v1', 2);
  const m2 = Math.max(0.1, P(node, 'm2', 2));
  const v2 = P(node, 'v2', -1);
  const e = Math.min(1, Math.max(0, P(node, 'e', 1)));
  const running = P(node, 'running', 1) !== 0;
  const showForce = P(node, 'showForce', 1) !== 0;

  const v1p = ((m1 - e * m2) * v1 + (1 + e) * m2 * v2) / (m1 + m2);
  const v2p = ((m2 - e * m1) * v2 + (1 + e) * m1 * v1) / (m1 + m2);
  const impulse = b?.fx ?? 0;
  const collided = impulse > 1e-9;
  const x1 = b ? b.x : -1;
  const x2 = b?.altX ?? 1;
  const cv1 = b ? b.vx : v1;
  const cv2 = collided ? v2p : v2;
  const momentum = m1 * v1 + m2 * v2;
  const kinetic = b?.ke ?? 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;

  const W = 310, H = 96, track = 64, lo = -1.6, hi = 1.9;
  const px = (x: number): number => 22 + ((x - lo) / (hi - lo)) * (W - 44);
  const cx1 = px(Math.min(hi, Math.max(lo, x1)));
  const cx2 = px(Math.min(hi, Math.max(lo, x2)));
  const r1 = 6 + 2.4 * Math.sqrt(m1);
  const r2 = 6 + 2.4 * Math.sqrt(m2);
  const [d1] = screenVec(cv1, 0, 9, 30);
  const [d2] = screenVec(cv2, 0, 9, 30);

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="气垫导轨一维碰撞">
        <line x1="6" y1={track} x2={W - 6} y2={track} stroke={INK} strokeWidth="1.4" />
        <line x1={px(0)} y1={track - 26} x2={px(0)} y2={track + 6} stroke="#d5ccb9" strokeWidth="1" strokeDasharray="3 3" />
        {showForce && collided ? <Arrow x1={cx1} y1={track - 3} x2={cx2} y2={track - 3} color={ORANGE} /> : null}
        <Arrow x1={cx1} y1={track - r1} x2={cx1 + d1} y2={track - r1} color={BLUE} />
        <Arrow x1={cx2} y1={track - r2} x2={cx2 + d2} y2={track - r2} color={BLUE} />
        <circle cx={cx1} cy={track - r1} r={r1} fill={ORANGE} stroke="#fff" strokeWidth="1.2" />
        <circle cx={cx2} cy={track - r2} r={r2} fill="#4f46e5" stroke="#fff" strokeWidth="1.2" />
        <text x={cx1 - 3} y={track - r1 - 12}>{fmt(m1, 1)}kg</text>
        <text x={cx2 - 3} y={track - r2 - 12}>{fmt(m2, 1)}kg</text>
        {collided ? <text x={W / 2} y={track + 18} textAnchor="middle">已碰撞 · J = {fmt(impulse)}N·s</text> : null}
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="冲量矢量" on={showForce} onClick={() => onParams?.({ showForce: onOff(!showForce) })} />
      </div>
      <div className={styles.readout}>
        <span>v₁ <b>{fmt(cv1)}</b></span>
        <span>v₂ <b>{fmt(cv2)}</b></span>
        <span>p <b>{fmt(momentum)}</b>kg·m/s</span>
        <span>Eₖ <b>{fmt(kinetic)}</b>J</span>
        <span>J <b>{fmt(impulse)}</b>N·s</span>
      </div>
      {!inCard && <>
        <Row label="m1 kg" value={m1} min={0.2} max={8} step={0.1} onChange={(v) => onParams?.({ m1: v })} />
        <Row label="v1 m/s" value={v1} min={-5} max={5} step={0.2} onChange={(v) => onParams?.({ v1: v })} />
        <Row label="m2 kg" value={m2} min={0.2} max={8} step={0.1} onChange={(v) => onParams?.({ m2: v })} />
        <Row label="v2 m/s" value={v2} min={-5} max={5} step={0.2} onChange={(v) => onParams?.({ v2: v })} />
        <Row label="e" value={e} min={0} max={1} step={0.05} onChange={(v) => onParams?.({ e: v })} />
      </>}
    </div>
  );
}

/* ============================== 受迫共振 ============================== */

export function ResonanceBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const k = Math.max(0.1, P(node, 'k', 10));
  const m = Math.max(0.05, P(node, 'm', 1));
  const c = Math.max(0, P(node, 'c', 0.5));
  const f0 = Math.max(0, P(node, 'f0', 1));
  const wd = Math.max(0.1, P(node, 'wd', 3.16));
  const running = P(node, 'running', 1) !== 0;

  const curve = resonanceCurve(k, m, c, f0);
  const maxA = Math.max(curve.reduce((mx, p) => Math.max(mx, p.amplitude), 0), 1e-9);
  const A = forcedSpringAt(k, m, c, f0, wd, 0).amplitude;
  const w0 = Math.sqrt(k / m);
  const wdMin = curve.reduce((min, p) => Math.min(min, p.wd), Number.POSITIVE_INFINITY);
  const wdMax = curve.reduce((max, p) => Math.max(max, p.wd), Number.NEGATIVE_INFINITY);
  const W = 320, H = 118, L = 26, R = W - 12, T = 10, B = H - 26;
  const X = (w: number): number => L + ((w - wdMin) / Math.max(wdMax - wdMin, 1e-9)) * (R - L);
  const Y = (amp: number): number => B - (amp / maxA) * (B - T);
  const pts = curve.map((p) => `${fmt(X(p.wd), 1)},${fmt(Y(p.amplitude), 1)}`).join(' ');
  const mx = X(Math.min(wdMax, Math.max(wdMin, wd)));
  const my = Y(A);
  const offset = b ? Math.max(-1, Math.min(1, b.x / Math.max(A, 1e-6))) : 0;

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="受迫振动共振曲线">
        <line x1={L} y1={B} x2={R} y2={B} stroke="#d5ccb9" />
        <line x1={L} y1={T} x2={L} y2={B} stroke="#d5ccb9" />
        <line x1={X(w0)} y1={T} x2={X(w0)} y2={B} stroke="#ede7da" strokeDasharray="3 3" />
        <polyline points={pts} fill="none" stroke={BLUE} strokeWidth={1.8} strokeLinejoin="round" />
        <circle cx={mx} cy={my} r={3.6} fill={ORANGE} stroke="#fff" strokeWidth="1.2" />
        <text x={X(w0) + 4} y={T + 10}>ω₀ = {fmt(w0)}</text>
        <text x={L + 4} y={T + 10}>A/…</text>
        <line x1={L} y1={B + 8} x2={R} y2={B + 8} stroke="#d7d2c6" />
        <rect x={W / 2 - 14 + offset * 62} y={B + 3} width={28} height={10} rx={2} fill={ORANGE} stroke="#fff" strokeWidth="1" />
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
      </div>
      <div className={styles.readout}>
        <span>ω_d <b>{fmt(wd)}</b></span>
        <span>A <b>{fmt(A)}</b></span>
        <span>峰值 <b>{fmt(maxA)}</b></span>
        <span>放大 <b>{fmt(A / Math.max(f0 / k, 1e-9), 1)}</b>×</span>
      </div>
      {!inCard && <>
        <Row label="k N/m" value={k} min={1} max={40} step={0.5} onChange={(v) => onParams?.({ k: v })} />
        <Row label="m kg" value={m} min={0.1} max={8} step={0.1} onChange={(v) => onParams?.({ m: v })} />
        <Row label="c" value={c} min={0} max={3} step={0.05} onChange={(v) => onParams?.({ c: v })} />
        <Row label="F0 N" value={f0} min={0} max={4} step={0.1} onChange={(v) => onParams?.({ f0: v })} />
        <Row label="ω_d" value={wd} min={0.1} max={Math.max(0.5, 3 * Math.sqrt(k / m))} step={0.05} onChange={(v) => onParams?.({ wd: v })} />
      </>}
    </div>
  );
}

/* ============================== 波场 ============================== */

export function WaveBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const amp = Math.max(0, P(node, 'amp', 0.6));
  const freq = Math.max(0.1, P(node, 'freq', 1));
  const lambda = Math.max(0.2, P(node, 'lambda', 2));
  const mode = P(node, 'mode', 0);
  const running = P(node, 'running', 1) !== 0;
  const t = b && b.theta !== undefined ? b.theta : 0;
  const samples = waveSamples(amp, freq, lambda, mode === 1 ? 'standing' : 'travel', t, 64);

  const W = 320, H = 100;
  const ampMax = Math.max(mode === 1 ? 2 * amp : amp, 1e-6);
  const X = (i: number): number => 8 + (i / Math.max(samples.length - 1, 1)) * (W - 16);
  const Y = (v: number): number => H / 2 - (v / ampMax) * (H / 2 - 12);
  const pts = samples.map((v, i) => `${fmt(X(i), 1)},${fmt(Y(v), 1)}`).join(' ');
  const envelope = mode === 1
    ? samples.map((_, i) => {
      const x = (i / Math.max(samples.length - 1, 1)) * (2 * lambda);
      return `${fmt(X(i), 1)},${fmt(Y(2 * amp * Math.sin((2 * Math.PI * x) / lambda)), 1)}`;
    }).join(' ')
    : '';

  return (
    <div className={styles.body}>
      <svg className={styles.stage} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={mode === 1 ? '驻波' : '行波'}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#d5ccb9" />
        {mode === 1 ? <polyline points={envelope} fill="none" stroke="#d7d2c6" strokeWidth="1" strokeDasharray="3 3" /> : null}
        <polyline points={pts} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" />
        <text x={8} y={12}>λ = {fmt(lambda)}m · f = {fmt(freq)}Hz</text>
        <text x={W - 8} y={H - 6} textAnchor="end">t = {fmt(t)}s</text>
      </svg>
      <div className={styles.toggles}>
        <Toggle label={running ? '⏸ 暂停' : '▶ 运行'} on={running} onClick={() => onParams?.({ running: onOff(!running) })} />
        <Toggle label="行波" on={mode === 0} onClick={() => onParams?.({ mode: 0 })} />
        <Toggle label="驻波" on={mode === 1} onClick={() => onParams?.({ mode: 1 })} />
      </div>
      <div className={styles.readout}>
        <span>v <b>{fmt(lambda * freq)}</b>m/s</span>
        <span><i>T</i> <b>{fmt(1 / freq)}</b>s</span>
        <span>{mode === 1 ? '波节恒为 0（x = 0、λ/2、λ）' : '波形整体沿 +x 传播'}</span>
      </div>
      {!inCard && <>
        <Row label="振幅 A" value={amp} min={0.1} max={1.5} step={0.05} onChange={(v) => onParams?.({ amp: v })} />
        <Row label="频率 f" value={freq} min={0.1} max={4} step={0.05} onChange={(v) => onParams?.({ freq: v })} />
        <Row label="波长 λ" value={lambda} min={0.5} max={6} step={0.1} onChange={(v) => onParams?.({ lambda: v })} />
      </>}
    </div>
  );
}