import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortSpec } from './types.ts';
import {
  electricFieldAt,
  emFieldFromParams,
  formatPhysics,
  magneticStrength,
  opticsField,
  opticsFringes,
  potentialAt,
  rlcWaveform,
  thermoCycle,
  traceParticle,
  type Field2D,
} from './physicsBlocks.ts';
import {
  BLOCK_COLORS,
  KpiRow,
  LineChart,
  Notice,
  RangeControl,
  SelectControl,
} from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

const fieldOut: PortSpec = { id: 'out', label: '二维场', kind: 'field2d' };
const fieldIn: PortSpec = { id: 'in', label: '二维场', kind: 'field2d' };
const scalarIn = (id: string, label: string): PortSpec => ({ id, label, kind: 'scalar' });
const seriesOut: PortSpec = { id: 'out', label: '数据序列', kind: 'series' };

function fieldFrom(props: NodeBodyProps): Field2D | null {
  const value = props.values.in;
  return value?.kind === 'field2d' ? value : null;
}

function wavelengthColor(wavelength: number): string {
  const value = Math.max(380, Math.min(750, wavelength));
  const hue = value >= 620 ? 0 : value >= 570 ? 35 : value >= 490 ? 120 : value >= 450 ? 220 : 275;
  return `hsl(${hue} 78% 52%)`;
}

function Arrow({ x, y, dx, dy, color = '#4f46e5', scale = 1 }: {
  x: number; y: number; dx: number; dy: number; color?: string; scale?: number;
}): JSX.Element {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const ex = x + ux * 9 * scale;
  const ey = y + uy * 9 * scale;
  return <g>
    <line x1={x} y1={y} x2={ex} y2={ey} stroke={color} strokeWidth="0.9" strokeLinecap="round" />
    <path d={`M${ex} ${ey} L${ex - ux * 3.4 - uy * 1.8} ${ey - uy * 3.4 + ux * 1.8} L${ex - ux * 3.4 + uy * 1.8} ${ey - uy * 3.4 - ux * 1.8} Z`} fill={color} />
  </g>;
}

function FieldSourceSvg({ field }: { field: Field2D }): JSX.Element {
  return <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="场源示意">
    <rect x="0" y="0" width="220" height="130" fill="#fbfaf7" />
    {Array.from({ length: 6 }, (_, index) => <line key={`v${index}`} x1={20 + index * 36} x2={20 + index * 36} y1="10" y2="120" stroke="#eee9df" strokeWidth="0.7" />)}
    {Array.from({ length: 4 }, (_, index) => <line key={`h${index}`} x1="10" x2="210" y1={22 + index * 30} y2={22 + index * 30} stroke="#eee9df" strokeWidth="0.7" />)}
    {field.mode === 'optics' ? field.sources.map((item, index) => {
      if (item.kind === 'source') return <circle key={index} cx={item.x} cy={item.y} r="4" fill={wavelengthColor(item.strength)} />;
      if (item.kind === 'lens') return <ellipse key={index} cx={item.x} cy={item.y} rx="6" ry="34" fill="#4f46e522" stroke="#4f46e5" strokeWidth="1.2" />;
      if (item.kind === 'slit') return <g key={index}><line x1={item.x} x2={item.x} y1="26" y2="104" stroke="#5e6878" strokeWidth="3" /><line x1={item.x} x2={item.x} y1="52" y2="78" stroke="#fbfaf7" strokeWidth="4" /></g>;
      return <line key={index} x1={item.x} x2={item.x} y1="18" y2="112" stroke="#0f766e" strokeWidth="1.4" strokeDasharray="5 3" />;
    }) : field.sources[0]?.kind === 'uniform' ? <>
      {Array.from({ length: 5 }).flatMap((_, row) => Array.from({ length: 4 }, (_, col) => (
        <Arrow key={`${row}-${col}`} x={34 + col * 44} y={28 + row * 22}
          dx={field.sources[0]!.x} dy={field.sources[0]!.y} color={field.mode === 'electric' ? '#b15236' : '#4f46e5'} />
      )))}
      <text x="10" y="124">{field.mode === 'electric' ? 'E' : 'B'} = {formatPhysics(Math.hypot(field.sources[0]!.x, field.sources[0]!.y) * field.sources[0]!.strength)}</text>
    </> : field.sources.map((item, index) => <g key={index}>
      <circle cx={item.x} cy={item.y} r={Math.max(5, item.radius ?? 9)} fill={item.strength >= 0 ? '#b15236' : '#4f46e5'} fillOpacity="0.16" stroke={item.strength >= 0 ? '#b15236' : '#4f46e5'} strokeWidth="1.3" />
      <text x={item.x} y={item.y + 3} textAnchor="middle" fontSize="10" fill={item.strength >= 0 ? '#b15236' : '#4f46e5'}>{item.strength >= 0 ? '+' : '−'}</text>
      <text x={item.x} y={item.y + (item.radius ?? 9) + 10} textAnchor="middle">{formatPhysics(item.strength)}</text>
    </g>)}
  </svg>;
}

export function EmFieldSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const mode = Math.round(node.params.mode ?? 0) === 1 ? 1 : 0;
  const uniform = !!node.params.uniform;
  const count = Math.round(Math.max(1, Math.min(3, node.params.count ?? 2)));
  const field = emFieldFromParams({ ...node.params, mode });
  return <div className={styles.root}>
    <FieldSourceSvg field={field} />
    <div className={styles.tagRow}>
      <span className={styles.tag}>{mode === 0 ? '静电场' : '恒磁场'}</span>
      <span className={styles.tag}>{uniform ? '匀强场' : `${count} 个点源`}</span>
      <span className={styles.tag}>{field.mode === 'magnetic' ? `B ≈ ${formatPhysics(magneticStrength(field))}` : 'E 由源叠加'}</span>
    </div>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="场类型" value={mode} options={['静电场', '恒磁场']} onChange={(value) => onParams?.({ mode: value })} />
      <SelectControl label="场源模式" value={uniform ? 1 : 0} options={['点源叠加', '匀强场']} onChange={(value) => onParams?.({ uniform: value })} />
      {uniform ? <>
        <RangeControl label="方向 x" value={node.params.ux ?? 0.6} min={-1} max={1} step={0.05} onChange={(value) => onParams?.({ ux: value })} />
        <RangeControl label="方向 y" value={node.params.uy ?? 0} min={-1} max={1} step={0.05} onChange={(value) => onParams?.({ uy: value })} />
        <RangeControl label="场强" value={node.params.uStrength ?? 1.2} min={0} max={5} step={0.1} onChange={(value) => onParams?.({ uStrength: value })} />
      </> : <>
        <SelectControl label="点源数量" value={count - 1} options={['1 个', '2 个', '3 个']} onChange={(value) => onParams?.({ count: value + 1 })} />
        {Array.from({ length: count }, (_, index) => {
          const suffix = index + 1;
          return <div key={suffix} className={styles.fields}>
            <RangeControl label={`源 ${suffix} x`} value={node.params[`x${suffix}`] ?? 55 + index * 45} min={0} max={220} step={5} onChange={(value) => onParams?.({ [`x${suffix}`]: value })} />
            <RangeControl label={`源 ${suffix} y`} value={node.params[`y${suffix}`] ?? 65} min={0} max={130} step={5} onChange={(value) => onParams?.({ [`y${suffix}`]: value })} />
            <RangeControl label={`源 ${suffix} 电荷`} value={node.params[`s${suffix}`] ?? (index % 2 === 0 ? 1.5 : -1.2)} min={-3} max={3} step={0.1} onChange={(value) => onParams?.({ [`s${suffix}`]: value })} />
          </div>;
        })}
      </>}
    </div>}
  </div>;
}

function PotentialHeatmap({ field }: { field: Field2D }): JSX.Element {
  const cols = 26;
  const rows = 15;
  const values: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      values.push(potentialAt(field, 8 + col * 204 / (cols - 1), 8 + row * 114 / (rows - 1)));
    }
  }
  const maxAbs = Math.max(1e-6, ...values.map(Math.abs));
  return <>{values.map((value, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const ratio = Math.abs(value) / maxAbs;
    return <rect key={`${row}-${col}`} x={8 + col * 204 / (cols - 1) - 4.1} y={8 + row * 114 / (rows - 1) - 3.9}
      width={204 / (cols - 1) + 0.4} height={114 / (rows - 1) + 0.4}
      fill={value >= 0 ? `rgba(177,82,54,${ratio * 0.3})` : `rgba(79,70,229,${ratio * 0.3})`} />;
  })}</>;
}

export function EmFieldViewBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, inCard } = props;
  const field = fieldFrom(props);
  if (!field) return <Notice>把「电荷 / 磁场源」的 field2d 输出接到场视图。</Notice>;
  if (field.mode === 'optics') return <div className={styles.root}>
    <FieldSourceSvg field={field} />
    {!inCard ? <p className={styles.tip}>光学场端口直接复用二维场协议；光学台负责产生光源、透镜、双缝或折射界面。</p> : null}
  </div>;
  const t = values.t?.kind === 'scalar' ? Math.max(0, Math.min(1, values.t.v)) : Math.max(0, Math.min(1, node.params.t ?? 0.65));
  const particle = {
    px: node.params.px ?? 45, py: node.params.py ?? 65,
    vx: node.params.vx ?? 0.8, vy: node.params.vy ?? 0.2,
    charge: node.params.charge ?? 1, mass: node.params.mass ?? 1,
  };
  const path = traceParticle(field, particle, 48);
  const point = path[Math.min(path.length - 1, Math.round(t * (path.length - 1)))] ?? path[0]!;
  const arrows = Array.from({ length: 5 }, (_, row) => Array.from({ length: 7 }, (_, col) => {
    const x = 20 + col * 30;
    const y = 20 + row * 22;
    const vector = electricFieldAt(field, x, y);
    const magnitude = Math.hypot(vector.ex, vector.ey);
    const scale = Math.min(1.2, magnitude / 10);
    return magnitude > 1e-6
      ? <Arrow key={`${row}-${col}`} x={x} y={y} dx={vector.ex} dy={vector.ey} scale={scale} color={field.mode === 'electric' ? '#b15236' : '#4f46e5'} />
      : null;
  })).flat();
  return <div className={styles.root}>
    <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="电场线、等势面与粒子轨迹">
      <rect x="0" y="0" width="220" height="130" fill="#fbfaf7" />
      {field.mode === 'electric' ? <PotentialHeatmap field={field} /> : null}
      {arrows}
      {field.sources.filter((item) => item.kind === 'charge').map((item, index) => <g key={index}>
        <circle cx={item.x} cy={item.y} r={Math.max(5, item.radius ?? 9)} fill={item.strength >= 0 ? '#b15236' : '#4f46e5'} fillOpacity="0.18"
          stroke={item.strength >= 0 ? '#b15236' : '#4f46e5'} strokeWidth="1.2" />
        <text x={item.x} y={item.y + 3} textAnchor="middle" fontSize="10" fill={item.strength >= 0 ? '#b15236' : '#4f46e5'}>{item.strength >= 0 ? '+' : '−'}</text>
      </g>)}
      <path d={path.map((item, index) => `${index ? 'L' : 'M'}${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(' ')}
        fill="none" stroke="#0d9488" strokeWidth="1.3" strokeDasharray="4 3" />
      <circle cx={point.x} cy={point.y} r="4" fill="#0d9488" stroke="#fff" strokeWidth="1.3" />
      <text x="8" y="124">{field.mode === 'electric' ? 'E' : 'B'} · 粒子相位 t = {t.toFixed(2)}</text>
    </svg>
    <KpiRow items={[
      { label: '粒子位置', value: `${point.x.toFixed(1)}, ${point.y.toFixed(1)}` },
      { label: '轨迹点', value: String(path.length) },
      { label: field.mode === 'electric' ? '场源' : '磁感应强度', value: field.mode === 'electric' ? `${field.sources.filter((item) => item.kind === 'charge').length} 个` : formatPhysics(magneticStrength(field)) },
    ]} />
    {!inCard && <div className={styles.controls}>
      <RangeControl label="粒子相位 t" value={node.params.t ?? 0.65} min={0} max={1} step={0.01} disabled={values.t?.kind === 'scalar'}
        onChange={(value) => onParams?.({ t: value })} />
      <RangeControl label="起点 x" value={particle.px} min={0} max={220} step={5} onChange={(value) => onParams?.({ px: value })} />
      <RangeControl label="起点 y" value={particle.py} min={0} max={130} step={5} onChange={(value) => onParams?.({ py: value })} />
      <RangeControl label="初速 vx" value={particle.vx} min={-4} max={4} step={0.1} onChange={(value) => onParams?.({ vx: value })} />
      <RangeControl label="初速 vy" value={particle.vy} min={-4} max={4} step={0.1} onChange={(value) => onParams?.({ vy: value })} />
      <RangeControl label="电荷 q" value={particle.charge} min={-3} max={3} step={0.1} onChange={(value) => onParams?.({ charge: value })} />
      <RangeControl label="质量 m" value={particle.mass} min={0.1} max={5} step={0.1} onChange={(value) => onParams?.({ mass: value })} />
      <p className={styles.tip}>把 ticker 的时间输出接到 t 端口可让粒子连续偏转；ticker 的 0–1 会映射到轨迹相位。</p>
    </div>}
  </div>;
}

export function RlcCircuitLabBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, inCard } = props;
  const frequency = values.freq?.kind === 'scalar' ? values.freq.v : undefined;
  const result = rlcWaveform(node.params, frequency);
  const isRc = (node.params.l ?? 0.08) <= 1e-6;
  return <div className={styles.root}>
    <LineChart labels={result.series.labels} compact={inCard} ariaLabel="RLC 电压与电流波形"
      series={[
        { name: '电容电压', values: result.series.values, color: BLOCK_COLORS[0] },
        { name: '电流 ×10', values: result.series.secondary?.[0]?.values ?? [], color: BLOCK_COLORS[1], dashed: true },
      ]} />
    <KpiRow items={[
      { label: '谐振频率', value: isRc ? 'RC 无谐振' : `${formatPhysics(result.resonance, 'Hz')}` },
      { label: '阻尼比', value: formatPhysics(result.damping) },
      { label: '峰值电流', value: formatPhysics(result.peakCurrent, 'A') },
    ]} />
    {!inCard && <div className={styles.controls}>
      <SelectControl label="激励源" value={node.params.drive ?? 0} options={['正弦', '阶跃']} onChange={(value) => onParams?.({ drive: value })} />
      <RangeControl label="电阻 R" value={node.params.r ?? 20} min={0.1} max={120} step={0.5} onChange={(value) => onParams?.({ r: value })} format={(value) => formatPhysics(value, 'Ω')} />
      <RangeControl label="电感 L" value={node.params.l ?? 0.08} min={0} max={1} step={0.01} onChange={(value) => onParams?.({ l: value })} format={(value) => formatPhysics(value, 'H')} />
      <RangeControl label="电容 C" value={node.params.c ?? 0.002} min={0.0001} max={0.02} step={0.0001} onChange={(value) => onParams?.({ c: value })} format={(value) => formatPhysics(value, 'F')} />
      <RangeControl label="激励频率" value={frequency ?? node.params.freq ?? 3} min={0.05} max={20} step={0.05}
        disabled={frequency !== undefined} onChange={(value) => onParams?.({ freq: value })} format={(value) => formatPhysics(value, 'Hz')} />
      <RangeControl label="激励幅值" value={node.params.amplitude ?? 12} min={0.1} max={60} step={0.5} onChange={(value) => onParams?.({ amplitude: value })} />
      <RangeControl label="观察时长" value={node.params.seconds ?? 2.4} min={0.2} max={6} step={0.1} onChange={(value) => onParams?.({ seconds: value })} format={(value) => formatPhysics(value, 's')} />
      <p className={styles.tip}>L = 0 时切换为 RC 充放电；正弦激励下改变频率可观察谐振峰与阻尼展宽。</p>
    </div>}
  </div>;
}

function OpticsSvg({ params }: { params: Record<string, number> }): JSX.Element {
  const mode = Math.round(params.mode ?? 0);
  const wavelength = params.wavelength ?? 550;
  const color = wavelengthColor(wavelength);
  if (mode === 1) {
    const fringes = opticsFringes(params, 28);
    return <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="双缝干涉条纹">
      <rect width="220" height="130" fill="#0b1020" />
      <circle cx="24" cy="65" r="4" fill={color} />
      <line x1="70" x2="70" y1="16" y2="52" stroke="#8c95a4" strokeWidth="4" />
      <line x1="70" x2="70" y1="60" y2="70" stroke="#0b1020" strokeWidth="5" />
      <line x1="70" x2="70" y1="78" y2="114" stroke="#8c95a4" strokeWidth="4" />
      <line x1="160" x2="160" y1="10" y2="120" stroke="#8c95a4" strokeWidth="1.2" />
      {fringes.map((value, index) => <rect key={index} x="166" y={12 + index * (106 / fringes.length)} width="46" height={106 / fringes.length}
        fill={color} opacity={0.08 + value * 0.85} />)}
      <text x="8" y="124" fill="#cbd5e1">λ = {Math.round(wavelength)} nm · d sinθ = mλ</text>
    </svg>;
  }
  if (mode === 2) {
    const n1 = params.n1 ?? 1;
    const n2 = params.n2 ?? 1.5;
    const incidence = 38 * Math.PI / 180;
    const critical = n2 > n1 ? Math.PI / 2 : Math.asin(Math.min(1, n2 / n1));
    const totalInternal = n1 > n2 && incidence > critical;
    const refraction = Math.asin(Math.min(1, n1 * Math.sin(incidence) / n2));
    const endX = 110 + Math.sin(refraction) * 58 * (totalInternal ? -1 : 1);
    const endY = 65 + Math.cos(refraction) * 58;
    return <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="折射与全反射光路">
      <rect x="110" y="0" width="110" height="130" fill="#4f46e50d" />
      <line x1="110" x2="110" y1="0" y2="130" stroke="#8c95a4" strokeWidth="1.2" strokeDasharray="5 4" />
      <line x1="52" y1="28" x2="110" y2="65" stroke={color} strokeWidth="2" />
      <Arrow x={110} y={65} dx={endX - 110} dy={endY - 65} color={totalInternal ? '#b15236' : color} scale={2.2} />
      <text x="8" y="16">n₁ = {n1.toFixed(2)}</text>
      <text x="150" y="16">n₂ = {n2.toFixed(2)}</text>
      <text x="8" y="124">{totalInternal ? '全反射：没有折射光' : 'n₁ sinθ₁ = n₂ sinθ₂'}</text>
    </svg>;
  }
  const focal = params.focal ?? 45;
  const objectDistance = params.objectDistance ?? 70;
  const imageDistance = Math.abs(objectDistance - focal) < 1e-6 ? Infinity : 1 / (1 / focal - 1 / objectDistance);
  const magnification = Number.isFinite(imageDistance) ? -imageDistance / objectDistance : Infinity;
  const lensX = 125;
  const objectX = Math.max(24, lensX - objectDistance);
  const imageX = Number.isFinite(imageDistance) ? lensX + imageDistance : 220;
  return <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="薄透镜三条特殊光线">
    <rect width="220" height="130" fill="#fbfaf7" />
    <line x1="8" x2="212" y1="65" y2="65" stroke="#cbd5e1" strokeWidth="1" />
    <ellipse cx={lensX} cy="65" rx="6" ry="40" fill="#4f46e522" stroke="#4f46e5" strokeWidth="1.3" />
    <line x1={objectX} x2={objectX} y1="65" y2="37" stroke="#b15236" strokeWidth="2" />
    <Arrow x={objectX} y={37} dx={0} dy={-6} color="#b15236" scale={1.4} />
    <path d={`M${objectX} 37 L${lensX} 37 L${Math.min(208, imageX)} ${65 + (65 - 37) * (Number.isFinite(magnification) ? magnification : 1)}`} fill="none" stroke={color} strokeWidth="1.1" />
    <path d={`M${objectX} 37 L${lensX} 65 L${Math.min(208, imageX)} ${65 + (65 - 37) * (Number.isFinite(magnification) ? magnification : 1)}`} fill="none" stroke={color} strokeWidth="1.1" strokeDasharray="4 3" />
    <path d={`M${objectX} 37 L${lensX} 52 L${Math.min(208, imageX)} ${65 + (65 - 37) * (Number.isFinite(magnification) ? magnification : 1)}`} fill="none" stroke={color} strokeWidth="0.9" opacity="0.6" />
    <text x="8" y="16">f = {focal} · u = {objectDistance}</text>
    <text x="8" y="124">{Number.isFinite(imageDistance) ? `v = ${imageDistance.toFixed(1)} · m = ${Math.abs(magnification).toFixed(2)}` : '物在焦点：像距发散'}</text>
  </svg>;
}

export function OpticsBenchBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const model = opticsField(node.params);
  const mode = Math.round(node.params.mode ?? 0);
  return <div className={styles.root}>
    <OpticsSvg params={node.params} />
    <div className={styles.tagRow}>
      <span className={styles.tag}>{['薄透镜', '双缝干涉', '折射界面'][mode] ?? '光学台'}</span>
      <span className={styles.tag}>λ = {Math.round(node.params.wavelength ?? 550)} nm</span>
      <span className={styles.tag}>{model.sources.length} 个光学元件</span>
    </div>
    {!inCard && <div className={styles.controls}>
      <SelectControl label="光学模式" value={mode} options={['薄透镜', '双缝', '折射']} onChange={(value) => onParams?.({ mode: value })} />
      <RangeControl label="波长 λ" value={node.params.wavelength ?? 550} min={380} max={750} step={5} onChange={(value) => onParams?.({ wavelength: value })} format={(value) => `${Math.round(value)} nm`} />
      {mode === 0 ? <>
        <RangeControl label="焦距 f" value={node.params.focal ?? 45} min={10} max={100} step={1} onChange={(value) => onParams?.({ focal: value })} />
        <RangeControl label="物距 u" value={node.params.objectDistance ?? 70} min={10} max={180} step={2} onChange={(value) => onParams?.({ objectDistance: value })} />
      </> : mode === 1 ? <>
        <RangeControl label="缝距 d" value={node.params.slitSpacing ?? 0.35} min={0.05} max={2} step={0.01} onChange={(value) => onParams?.({ slitSpacing: value })} format={(value) => `${value.toFixed(2)} mm`} />
        <RangeControl label="屏距 L" value={node.params.screenDistance ?? 120} min={20} max={240} step={5} onChange={(value) => onParams?.({ screenDistance: value })} format={(value) => `${Math.round(value)} cm`} />
      </> : <>
        <RangeControl label="入射侧 n₁" value={node.params.n1 ?? 1} min={1} max={3} step={0.05} onChange={(value) => onParams?.({ n1: value })} />
        <RangeControl label="折射侧 n₂" value={node.params.n2 ?? 1.5} min={1} max={3} step={0.05} onChange={(value) => onParams?.({ n2: value })} />
      </>}
      <p className={styles.tip}>输出的 field2d 可接到「场线与等势面视图」；当前本体直接显示几何光路或干涉条纹。</p>
    </div>}
  </div>;
}

export function ThermoCycleBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const model = thermoCycle(node.params);
  const allPoints = model.curve.flatMap((segment) => segment.points);
  const maxV = Math.max(1e-6, ...allPoints.map((point) => point.v)) * 1.06;
  const maxP = Math.max(1e-6, ...allPoints.map((point) => point.p)) * 1.06;
  const px = (v: number) => 32 + (v / maxV) * 176;
  const py = (p: number) => 112 - (p / maxP) * 96;
  return <div className={styles.root}>
    <svg className={styles.chart} viewBox="0 0 220 130" role="img" aria-label="理想气体 P-V 卡诺循环">
      <rect width="220" height="130" fill="#fbfaf7" />
      <line x1="32" x2="212" y1="112" y2="112" stroke="#cbd5e1" />
      <line x1="32" x2="32" y1="12" y2="112" stroke="#cbd5e1" />
      {model.curve.map((segment, index) => <path key={segment.label}
        d={segment.points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${px(point.v).toFixed(1)},${py(point.p).toFixed(1)}`).join(' ')}
        fill="none" stroke={BLOCK_COLORS[index % BLOCK_COLORS.length]} strokeWidth="1.8" />)}
      {model.states.map((state, index) => <g key={index}>
        <circle cx={px(state.v)} cy={py(state.p)} r="2.6" fill={BLOCK_COLORS[index % BLOCK_COLORS.length]} />
        <text x={px(state.v) + 4} y={py(state.p) - 4}>{index + 1}</text>
      </g>)}
      <text x="8" y="16">P</text><text x="206" y="124">V</text>
    </svg>
    <KpiRow items={[
      { label: '热机效率', value: `${(model.efficiency * 100).toFixed(1)}%`, tone: 'good' },
      { label: '净功', value: formatPhysics(model.netWork, 'J') },
      { label: '吸热', value: formatPhysics(model.heatIn, 'J') },
    ]} />
    {!inCard && <div className={styles.controls}>
      <RangeControl label="高温 T₁" value={node.params.hot ?? 600} min={250} max={900} step={10} onChange={(value) => onParams?.({ hot: value })} format={(value) => `${value} K`} />
      <RangeControl label="低温 T₂" value={node.params.cold ?? 300} min={150} max={Math.max(160, (node.params.hot ?? 600) - 1)} step={5} onChange={(value) => onParams?.({ cold: value })} format={(value) => `${value} K`} />
      <RangeControl label="压缩比" value={node.params.compression ?? 3} min={1.2} max={6} step={0.1} onChange={(value) => onParams?.({ compression: value })} />
      <RangeControl label="绝热指数 γ" value={node.params.gamma ?? 1.4} min={1.1} max={1.8} step={0.01} onChange={(value) => onParams?.({ gamma: value })} />
      <p className={styles.tip}>输出 series 的四段净功可接到办公瀑布图，比较各过程对循环净功的贡献。</p>
    </div>}
  </div>;
}

export const PHYSICS_BLOCK_DEFS: Partial<Record<NodeType, NodeDef>> = {
  emFieldSource: { title: '电荷 / 磁场源', badge: '源', width: 330, outputs: [fieldOut], Body: EmFieldSourceBody },
  emFieldView: { title: '场线与粒子轨迹', badge: '视图', width: 340, inputs: [fieldIn, scalarIn('t', '粒子相位')], Body: EmFieldViewBody },
  rlcCircuitLab: { title: 'RC / RLC 示波器', badge: '实验', width: 340, inputs: [scalarIn('freq', '激励频率')], outputs: [seriesOut], Body: RlcCircuitLabBody },
  opticsBench: { title: '光学元件与光路台', badge: '实验', width: 340, outputs: [fieldOut], Body: OpticsBenchBody },
  thermoCycle: { title: '理想气体 P-V 循环', badge: '实验', width: 340, outputs: [seriesOut], Body: ThermoCycleBody },
};

export const PHYSICS_BLOCK_DEFAULTS: Partial<Record<NodeType, Record<string, number>>> = {
  emFieldSource: { mode: 0, uniform: 0, count: 2, x1: 55, y1: 65, s1: 1.5, x2: 100, y2: 65, s2: -1.2, ux: 0.6, uy: 0, uStrength: 1.2 },
  emFieldView: { t: 0.65, px: 45, py: 65, vx: 0.8, vy: 0.2, charge: 1, mass: 1 },
  rlcCircuitLab: { r: 20, l: 0.08, c: 0.002, freq: 3, amplitude: 12, seconds: 2.4, drive: 0 },
  opticsBench: { mode: 0, wavelength: 550, focal: 45, objectDistance: 70, slitSpacing: 0.35, screenDistance: 120, n1: 1, n2: 1.5 },
  thermoCycle: { hot: 600, cold: 300, compression: 3, gamma: 1.4 },
};
