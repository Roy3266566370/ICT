import { useEffect, useId, useMemo, useState } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import type { Function2dValue, RealFunction2d, Waveform } from './calculus.ts';
import {
  antiderivativeSamples, compileFunction, compileFunction2d, directionDerivative, fourierPartialSum,
  fourierSamples, fourierSpectrum, function2dValue, gradient2d, integrate, integrateOdeRK4,
  polarSandbox, rectSandbox, slopeFieldGrid,
} from './calculus.ts';
import { formatNumber } from '../labs/expr.ts';
import { sampleDiskDensity } from './calculusDisk.ts';
import { VECTOR_FIELDS, vectorFieldParts, vectorFieldValue } from './calculusField.ts';
import styles from './calculus.module.css';

const num = (v: number | null | undefined) => formatNumber(v, 6);

const INDIGO = 'var(--color-indigo)';
const CORAL = 'var(--color-coral)';
const PASS = 'var(--color-pass)';
const HAIRLINE = 'var(--hairline)';
const HAIRLINE_STRONG = 'var(--hairline-strong)';
const INK_MUTED = 'var(--ink-400)';
const CORAL_SOFT = 'var(--color-coral-soft)';
const INDIGO_SOFT = 'var(--color-indigo-soft)';

const WAVEFORMS = ['square', 'triangle', 'sawtooth'] as const;

interface Sample { x: number; y: number | null }
interface PlotSeries { name: string; color: string; dashed?: boolean; samples: Sample[] }
interface PlotScale { px: (x: number) => number; py: (y: number) => number }

const PLOT_W = 360, PLOT_H = 200, PLOT_L = 34, PLOT_R = 12, PLOT_T = 14, PLOT_B = 24;
const PLOT_BOTTOM = PLOT_H - PLOT_B;
const INNER_W = PLOT_W - PLOT_L - PLOT_R;
const INNER_H = PLOT_BOTTOM - PLOT_T;

function Field({ label, value, onChange, min = -100, max = 100, step = 0.1 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number" aria-label={label} value={draft} min={min} max={max} step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = e.target.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
        }}
        onBlur={(e) => {
          const next = Number.isFinite(e.target.valueAsNumber) ? Math.max(min, Math.min(max, e.target.valueAsNumber)) : value;
          setDraft(String(next));
          if (next !== value) onChange(next);
        }}
      />
    </label>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className={styles.notice} role="status">{children}</p>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '请检查表达式与参数';
}

function inputFunction1d(values: NodeBodyProps['values']) {
  if (values.in?.kind !== 'function') throw new Error('把「函数源」的 f(x) 输出连到左侧输入端口。');
  return compileFunction(values.in);
}

function inputFunction2d(values: NodeBodyProps['values']): RealFunction2d {
  if (values.in?.kind !== 'function2d') throw new Error('把「二元函数源」的 f(x,y) 输出连到左侧输入端口。');
  return compileFunction2d(values.in as Function2dValue);
}

function idealWaveform(waveform: Waveform, x: number): number {
  if (waveform === 'square') return Math.sin(x) >= 0 ? 1 : -1;
  if (waveform === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(x));
  const wrapped = ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return wrapped / Math.PI - 1;
}

function areaPath(samples: Sample[], from: number, to: number, scale: PlotScale): string {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const inside = samples.filter((p) => p.x >= lo && p.x <= hi && p.y !== null && Number.isFinite(p.y));
  if (inside.length < 2) return '';
  const base = scale.py(0).toFixed(1);
  const head = scale.px(inside[0]!.x).toFixed(1);
  const tail = scale.px(inside[inside.length - 1]!.x).toFixed(1);
  const top = inside.map((p) => `${scale.px(p.x).toFixed(1)},${scale.py(p.y!).toFixed(1)}`).join(' L');
  return `M${head},${base} L${top} L${tail},${base} Z`;
}

/** 曲线在无定义/越界样本处断开，避免跨奇点画假连线。 */
function Plot({ series, xMin, xMax, yMin, yMax, aria, onPick, children }: {
  series: PlotSeries[]; xMin: number; xMax: number; yMin?: number; yMax?: number; aria: string;
  onPick?: (x: number, y: number) => void;
  children?: (scale: PlotScale) => React.ReactNode;
}) {
  const id = useId();
  if (!(xMax > xMin)) return <Notice>横轴上限必须大于下限。</Notice>;
  const finite = series.flatMap((s) => s.samples.map((p) => p.y))
    .filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return <Notice>当前区间内没有有限实数值，请调整表达式或范围。</Notice>;
  const low = yMin ?? Math.min(0, finite[Math.floor((finite.length - 1) * 0.04)]!);
  const high = yMax ?? Math.max(0, finite[Math.floor((finite.length - 1) * 0.96)]!);
  const pad = Math.max((high - low) * 0.16, 0.5);
  const bottom = yMin ?? low - pad, top = yMax ?? high + pad;
  if (!(top > bottom)) return <Notice>纵轴范围退化，请调整参数。</Notice>;
  const px = (x: number) => PLOT_L + (x - xMin) / (xMax - xMin) * INNER_W;
  const py = (y: number) => PLOT_BOTTOM - (y - bottom) / (top - bottom) * INNER_H;
  const paths = series.map((s) => {
    let drawing = false, previous = 0;
    return s.samples.map(({ x, y }) => {
      if (y === null || !Number.isFinite(y) || y < bottom || y > top) { drawing = false; return ''; }
      const screenY = py(y);
      const command = drawing && Math.abs(screenY - previous) < 110 ? 'L' : 'M';
      drawing = true; previous = screenY;
      return `${command}${px(x).toFixed(2)},${screenY.toFixed(2)}`;
    }).join(' ');
  });
  const scale: PlotScale = { px, py };
  const pick = onPick
    ? (event: React.MouseEvent<SVGSVGElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const vx = (event.clientX - box.left) / box.width * PLOT_W;
        const vy = (event.clientY - box.top) / box.height * PLOT_H;
        const x = xMin + (vx - PLOT_L) / INNER_W * (xMax - xMin);
        const y = bottom + (PLOT_BOTTOM - vy) / INNER_H * (top - bottom);
        if (Number.isFinite(x) && Number.isFinite(y)) onPick(x, y);
      }
    : undefined;
  return <>
    <svg className={styles.plot} viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} role="img" aria-label={aria} onClick={pick}
      style={onPick ? { cursor: 'crosshair' } : undefined}>
      <defs><clipPath id={id}><rect x={PLOT_L} y={PLOT_T} width={INNER_W} height={INNER_H} /></clipPath></defs>
      {[0, 1, 2, 3, 4].map((i) => <g key={i}>
        <line x1={PLOT_L} x2={PLOT_L + INNER_W} y1={PLOT_T + i * INNER_H / 4} y2={PLOT_T + i * INNER_H / 4} stroke={HAIRLINE} />
        <text x={PLOT_L - 4} y={PLOT_T + 3 + i * INNER_H / 4} textAnchor="end">{num(top - i * (top - bottom) / 4).slice(0, 7)}</text>
      </g>)}
      <g clipPath={`url(#${id})`}>
        <line x1={PLOT_L} x2={PLOT_L + INNER_W} y1={py(0)} y2={py(0)} stroke={HAIRLINE_STRONG} />
        <line x1={px(0)} x2={px(0)} y1={PLOT_T} y2={PLOT_BOTTOM} stroke={HAIRLINE_STRONG} />
        {children?.(scale)}
        {series.map((s, i) => <path key={s.name} d={paths[i]} fill="none" stroke={s.color} strokeWidth="2"
          strokeDasharray={s.dashed ? '5 4' : undefined} />)}
      </g>
      {[0, 1, 2, 3, 4].map((i) => <text key={i} x={PLOT_L + i * INNER_W / 4} y={PLOT_H - 6} textAnchor="middle">
        {num(xMin + i * (xMax - xMin) / 4).slice(0, 8)}
      </text>)}
    </svg>
    <div className={styles.legend}>{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
  </>;
}

export function FtcViewBody({ node, values, onParams, inCard }: NodeBodyProps): JSX.Element {
  const connectedN = values.n?.kind === 'scalar' ? Math.max(2, Math.min(600, Math.round(values.n.v))) : undefined;
  const a = node.params.a ?? 0, x = node.params.x ?? 1, n = connectedN ?? node.params.n ?? 122;
  const constant = node.params.constant;
  const controls = <>
    <div className={styles.fields}>
      <Field label="下限 a" value={a} onChange={(v) => onParams?.({ a: v })} />
      <Field label="上限 x" value={x} onChange={(v) => onParams?.({ x: v })} />
    </div>
    {connectedN === undefined && <Field label="采样段数 n" value={n} min={2} max={600} step={1} onChange={(v) => onParams?.({ n: Math.round(v) })} />}
    {constant !== undefined && <Field label="积分常数 C" value={constant} min={-3} max={3} step={0.1} onChange={(v) => onParams?.({ constant: v })} />}
  </>;
  try {
    const f = inputFunction1d(values);
    const lo = Math.min(a, x), hi = Math.max(a, x);
    const pad = Math.max((hi - lo) * 0.25, 0.5);
    const samples = antiderivativeSamples(f, a, lo - pad, hi + pad, Math.round(n));
    const area = integrate(f, a, x, 128);
    const graphSamples = samples.map((p) => ({ x: p.x, y: p.f }));
    const areaSamples = [{ x: lo, y: f(lo) }, ...graphSamples.filter(p => p.x > lo && p.x < hi), { x: hi, y: f(hi) }];
    const slopeError = samples.map((p) => p.slopeError).filter((v): v is number => v !== null && Number.isFinite(v));
    return <div data-calculus="ftcView" className={styles.body}>
      <div className={styles.calcGrid}>
        <Plot aria={`f(x) 在 ${num(a)} 到 ${num(x)} 下方的面积`} xMin={lo - pad} xMax={hi + pad}
          series={[{ name: 'f(x)', color: INDIGO, samples: graphSamples }]}>
          {(scale) => <path d={areaPath(areaSamples, a, x, scale)} fill={CORAL_SOFT} stroke={CORAL} strokeWidth="1" />}
        </Plot>
        <Plot aria={`变上限积分 F(x)=∫ f 在 ${num(lo - pad)} 到 ${num(hi + pad)}`} xMin={lo - pad} xMax={hi + pad}
          series={[
            { name: 'F(x)', color: CORAL, samples: samples.map((p) => ({ x: p.x, y: p.integral })) },
            ...(constant !== undefined && constant !== 0 ? [{
              name: 'F(x)+C', color: INDIGO, dashed: true,
              samples: samples.map((p) => ({ x: p.x, y: p.integral === null ? null : p.integral + constant })),
            }] : []),
          ]} />
      </div>
      {connectedN !== undefined && <p className={styles.readout}>接线 n = {n} · F(x) ≈ {num(area.sum)}
        {constant !== undefined && ` · F(x)+C ≈ ${num(area.sum + constant)}`}</p>}
      {!inCard && <>
        {controls}
        <p className={styles.readout}>左：面积 f 下方（{num(lo)} → {num(hi)}）<br />F(x) = ∫ₐˣ f ≈ <b data-readout="ftc-integral">{num(area.sum)}</b><br />
          f(x) = <b data-readout="ftc-function">{num(f(x))}</b></p>
        <p className={styles.tip}>右图为同一 f 的变上限积分曲线；曲线斜率与 f 的最大偏差 ≈ {num(slopeError.length ? Math.max(...slopeError) : null)}（样本差分估计）。数值积分只作观察，不是解析原函数。</p>
        {constant !== undefined && <p className={styles.tip}>积分常数 C 让原函数图像整体平移，导数保持为 f(x)。</p>}
      </>}
    </div>;
  } catch (error) {
    return <div data-calculus="ftcView" className={styles.body}>{!inCard && controls}<Notice>{errorText(error)}</Notice></div>;
  }
}

export function FourierLabBody({ node, values, onParams, inCard }: NodeBodyProps): JSX.Element {
  const index = Math.max(0, Math.min(2, Math.round(node.params.waveform ?? 0)));
  const waveform: Waveform = WAVEFORMS[index] ?? 'square';
  const connectedN = values.n?.kind === 'scalar' ? values.n.v : undefined;
  const n = Math.max(1, Math.min(199, Math.round(connectedN ?? node.params.n ?? 5)));
  const span = Math.max(2, Math.min(20, node.params.span ?? Math.PI * 2));
  const half = span / 2;
  const curve = useMemo(() => {
    try {
      const ideal = Array.from({ length: 241 }, (_, i) => {
        const x = -half + span * i / 240;
        return { x, y: idealWaveform(waveform, x) };
      });
      const partial = fourierSamples(waveform, n, -half, half, 241);
      const spectrum = fourierSpectrum(waveform, n);
      return { ok: true as const, ideal, partial, spectrum };
    } catch (error) { return { ok: false as const, error: errorText(error) }; }
  }, [waveform, n, half, span]);
  const controls = <>
    <label className={styles.field}>波形<select aria-label="傅里叶波形" value={index}
      onChange={(e) => onParams?.({ waveform: Number(e.target.value) })}>
      <option value="0">方波</option><option value="1">三角波</option><option value="2">锯齿波</option>
    </select></label>
    <div className={styles.fields}>
      {connectedN === undefined
        ? <Field label="谐波上限 n" value={n} min={1} max={199} step={2} onChange={(v) => onParams?.({ n: Math.round(v) })} />
        : <p className={styles.tip}>接线谐波上限 N = {n}</p>}
      <Field label="显示跨度" value={span} min={2} max={20} step={0.1} onChange={(v) => onParams?.({ span: v })} />
    </div>
  </>;
  if (!curve.ok) return <div data-calculus="fourierLab" className={styles.body}>{inCard ? null : controls}<Notice>{curve.error}</Notice></div>;
  const peak = Math.max(...curve.spectrum.map((b) => b.amplitude), 1e-6);
  const barW = Math.max(2, Math.min(18, 300 / Math.max(curve.spectrum.length, 1) - 2));
  const partialAtHalfPi = fourierPartialSum(waveform, n, Math.PI / 2);
  return <div data-calculus="fourierLab" className={styles.body}>
    <Plot aria={`${waveform} 波形与 ${n} 项部分和`} xMin={-half} xMax={half}
      series={[
        { name: '理想波形', color: INDIGO, samples: curve.ideal },
        { name: `前 ${n} 项部分和`, color: CORAL, dashed: true, samples: curve.partial },
      ]} />
    {inCard ? null : <>
      {controls}
      <p className={styles.readout}>方波/三角/锯齿在 π/2 的部分和 = <b data-readout="fourier-partial">{num(partialAtHalfPi)}</b><br />
        谐波项数 {curve.spectrum.length}，最大振幅 {num(peak)}</p>
      <svg className={styles.spectrum} viewBox="0 0 340 90" role="img" aria-label={`${waveform} 频谱柱`}>
        <line x1="20" x2="330" y1="78" y2="78" stroke={HAIRLINE_STRONG} />
        {curve.spectrum.map((bar, i) => {
          const height = bar.amplitude / peak * 62;
          return <g key={bar.harmonic}>
            <rect x={22 + i * (barW + 3)} y={78 - height} width={barW} height={Math.max(height, 1)} fill={CORAL_SOFT} stroke={CORAL} strokeWidth="0.8" />
            <text x={22 + i * (barW + 3) + barW / 2} y="88" textAnchor="middle" fill={INK_MUTED}>{bar.harmonic}</text>
          </g>;
        })}
        <line x1="20" x2="20" y1="10" y2="78" stroke={HAIRLINE} />
      </svg>
      <p className={styles.tip}>蓝色为理想波形，虚线为截断正弦级数的部分和；阶数越高越贴近跳变处，但吉布斯振荡不会消失。频谱柱给出各次谐波振幅（奇次或全部，视波形而定）。</p>
    </>}
  </div>;
}

export function OdeSlopeFieldBody({ node, values, onParams, onText, inCard }: NodeBodyProps): JSX.Element {
  const expression = node.text ?? '-y';
  const x0 = node.params.x0 ?? 0, y0 = node.params.y0 ?? 1;
  const min = node.params.min ?? -3, max = node.params.max ?? 3;
  const connectedStep = values.step?.kind === 'scalar' ? values.step.v : undefined;
  const step = connectedStep === undefined ? node.params.step ?? 0.02 : Math.max(0.005, Math.min(0.8, connectedStep));
  const steps = connectedStep === undefined ? Math.round(node.params.steps ?? 150)
    : Math.min(600, Math.ceil(Math.max(x0 - min, max - x0) / step));
  let error = '';
  let grid: ReturnType<typeof slopeFieldGrid> | null = null;
  let forward: { x: number; y: number }[] = [], backward: { x: number; y: number }[] = [];
  try {
    grid = slopeFieldGrid(expression, min, max, 15);
    forward = integrateOdeRK4(expression, x0, y0, step, steps);
    backward = integrateOdeRK4(expression, x0, y0, -step, steps);
  } catch (e) { error = errorText(e); }
  const last = forward[forward.length - 1] ?? null;
  return <div data-calculus="odeSlopeField" className={inCard ? styles.body : styles.splitBody}>
    <div className={styles.stageVisual}>
      {grid ? <>
        <Plot aria="斜率场与双向积分曲线，点击平面可设初值" xMin={min} xMax={max} yMin={min} yMax={max}
          onPick={(x, y) => onParams?.({ x0: x, y0: y })}
          series={[
            { name: '正向解曲线', color: CORAL, samples: forward.map((p) => ({ x: p.x, y: p.y })) },
            { name: '反向解曲线', color: INDIGO, dashed: true, samples: backward.map((p) => ({ x: p.x, y: p.y })) },
          ]}>
          {(scale) => {
            const field = grid!;
            return <>
              {field.xs.flatMap((gx, i) => field.ys.map((gy, j) => {
                const slope = field.slopes[j]?.[i] ?? null;
                if (slope === null || !Number.isFinite(slope)) return null;
                const unit = Math.hypot(1, slope), half = (max - min) / 15 * 0.34;
                const dx = half / unit, dy = half * slope / unit;
                return <line key={`${i}-${j}`} x1={scale.px(gx - dx)} y1={scale.py(gy - dy)} x2={scale.px(gx + dx)} y2={scale.py(gy + dy)}
                  stroke={HAIRLINE_STRONG} strokeWidth="1.1" />;
              }))}
              <circle cx={scale.px(x0)} cy={scale.py(y0)} r="4" fill={PASS} stroke="var(--paper-0)" strokeWidth="1.5" />
            </>;
          }}
        </Plot>
      </> : <Notice>{error}</Notice>}
    </div>
    <div className={styles.stageControls}>
      <label className={styles.expression}>y′ =<input aria-label="微分方程表达式" maxLength={500} spellCheck={false}
        value={expression} readOnly={!onText} onChange={(e) => onText?.(e.target.value)} /></label>
      {!inCard && <>
        <div className={styles.fields}>
          <Field label="初值 x₀" value={x0} min={min} max={max} onChange={(v) => onParams?.({ x0: v })} />
          <Field label="初值 y₀" value={y0} min={min} max={max} onChange={(v) => onParams?.({ y0: v })} />
        </div>
        <div className={styles.fields}>
          <Field label="场范围" value={max} min={0.5} max={10} onChange={(v) => onParams?.({ min: -v, max: v })} />
          {connectedStep === undefined &&
            <Field label="步长 h" value={step} min={0.001} max={0.5} step={0.005} onChange={(v) => onParams?.({ step: v })} />}
        </div>
        {connectedStep === undefined
          ? <Field label="积分步数" value={steps} min={1} max={2000} step={1} onChange={(v) => onParams?.({ steps: Math.round(v) })} />
          : <p className={styles.tip}>接线步长 h = {num(step)}，积分步数 = {steps}</p>}
        <p className={styles.readout}>末点 (x, y) ≈ (<b data-readout="ode-x">{num(last?.x ?? null)}</b>, <b data-readout="ode-y">{num(last?.y ?? null)}</b>)</p>
        <p className={styles.tip}>短线段为斜率场（灰色），朱砂为正向 RK4 解曲线，蓝色虚线为从初值反向积分。点击平面任意位置把 (x₀, y₀) 设为新初值；解只在有限区间内有效。</p>
      </>}
    </div>
  </div>;
}

export function Func2dSourceBody({ node, values, onParams, onText, inCard }: NodeBodyProps): JSX.Element {
  const connectedA = values.a?.kind === 'scalar' ? values.a.v : undefined;
  const a = connectedA ?? node.params.a ?? 1, b = node.params.b ?? 1;
  const expression = node.text ?? 'a*x^2+b*y^2';
  const preview = useMemo(() => {
    try {
      const fn = compileFunction2d(function2dValue(expression, { a, b }));
      const slice = (y: number): Sample[] => Array.from({ length: 121 }, (_, i) => {
        const x = -3 + 6 * i / 120;
        const value = fn(x, y);
        return { x, y: value === null || !Number.isFinite(value) ? null : value };
      });
      return { ok: true as const, fn, middle: slice(0), offset: slice(1) };
    } catch (error) { return { ok: false as const, error: errorText(error) }; }
  }, [expression, a, b]);
  const controls = <>
    <div className={styles.fields}>
      {connectedA === undefined && <Field label="参数 a" value={a} onChange={(v) => onParams?.({ a: v })} />}
      <Field label="参数 b" value={b} onChange={(v) => onParams?.({ b: v })} />
    </div>
    <p className={styles.tip}>x、y 为自变量，a、b 为系数；乘号写 *，幂写 ^。输出端口把整条 f(x,y) 传给「梯度等高线」等多元积木。</p>
  </>;
  if (!preview.ok) return <div data-calculus="func2dSource" className={styles.body}>
    <label className={styles.expression}>f(x,y) =<input aria-label="二元函数表达式" maxLength={500} spellCheck={false}
      value={expression} onChange={(e) => onText?.(e.target.value)} /></label>
    {!inCard && controls}<Notice>{preview.error}</Notice>
  </div>;
  const middle = preview.fn(1, 1);
  return <div data-calculus="func2dSource" className={styles.body}>
    <label className={styles.expression}>f(x,y) =<input aria-label="二元函数表达式" maxLength={500} spellCheck={false}
      value={expression} onChange={(e) => onText?.(e.target.value)} /></label>
    <Plot aria="沿 y=0 与 y=1 的截线预览" xMin={-3} xMax={3}
      series={[
        { name: 'f(x, 0)', color: INDIGO, samples: preview.middle },
        { name: 'f(x, 1)', color: CORAL, dashed: true, samples: preview.offset },
      ]} />
    {connectedA !== undefined && <p className={styles.readout}>接线参数 a = {num(a)}</p>}
    {!inCard && <>
      {controls}
      <p className={styles.readout}>f(1, 1) = <b data-readout="func2d-value">{num(middle)}</b></p>
    </>}
  </div>;
}

interface Segment { x1: number; y1: number; x2: number; y2: number }

/** 简化 marching squares：只在格子四边找一次符号变化，够画观察用等高线。 */
function levelSegments(at: (x: number, y: number) => number | null, xMin: number, xMax: number,
  yMin: number, yMax: number, n: number, level: number): Segment[] {
  const dx = (xMax - xMin) / n, dy = (yMax - yMin) / n;
  const crossing = (xa: number, ya: number, va: number | null, xb: number, yb: number, vb: number | null) => {
    if (va === null || vb === null) return null;
    if (va === 0 && vb === 0) return null;
    if (va === vb) return null;
    if ((va < 0) === (vb < 0)) return null;
    const t = va / (va - vb);
    return { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t };
  };
  const segments: Segment[] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const xa = xMin + dx * i, xb = xa + dx, ya = yMin + dy * j, yb = ya + dy;
      const value = (x: number, y: number) => {
        const v = at(x, y);
        return v === null || !Number.isFinite(v) ? null : v - level;
      };
      const v00 = value(xa, ya), v10 = value(xb, ya), v11 = value(xb, yb), v01 = value(xa, yb);
      const points = [
        crossing(xa, ya, v00, xb, ya, v10),
        crossing(xb, ya, v10, xb, yb, v11),
        crossing(xb, yb, v11, xa, yb, v01),
        crossing(xa, yb, v01, xa, ya, v00),
      ].filter((p): p is { x: number; y: number } => p !== null);
      if (points.length >= 2) {
        segments.push({ x1: points[0]!.x, y1: points[0]!.y, x2: points[1]!.x, y2: points[1]!.y });
        if (points.length >= 4) segments.push({ x1: points[2]!.x, y1: points[2]!.y, x2: points[3]!.x, y2: points[3]!.y });
      }
    }
  }
  return segments;
}

export function GradientContourBody({ node, values, onParams, onText, inCard }: NodeBodyProps): JSX.Element {
  const x = node.params.x ?? 1, y = node.params.y ?? 1;
  const theta = node.params.theta ?? Math.PI / 4, span = node.params.span ?? 2.5;
  const constraint = node.text ?? 'x+y-2';
  const controls = <>
    <div className={styles.fields}>
      <Field label="点 x" value={x} min={-10} max={10} onChange={(v) => onParams?.({ x: v })} />
      <Field label="点 y" value={y} min={-10} max={10} onChange={(v) => onParams?.({ y: v })} />
    </div>
    <div className={styles.fields}>
      <Field label="方向角 θ" value={theta} min={-3.1416} max={3.1416} step={0.01} onChange={(v) => onParams?.({ theta: v })} />
      <Field label="视野半宽" value={span} min={0.5} max={6} onChange={(v) => onParams?.({ span: v })} />
    </div>
  </>;
  const constraintInput = <label className={styles.expression}>约束 g(x,y) =<input aria-label="约束线表达式" maxLength={500} spellCheck={false}
    value={constraint} onChange={(e) => onText?.(e.target.value)} /></label>;
  try {
    const f = inputFunction2d(values);
    const g = gradient2d(f, x, y);
    const directional = directionDerivative(g, theta);
    const min = x - span, max = x + span, yMin = y - span, yMax = y + span;
    const GRID = 21, W = 300, CELL = W / GRID, PAD = 18;
    const px = (v: number) => PAD + (v - min) / (max - min) * W;
    const py = (v: number) => PAD + (yMax - v) / (yMax - yMin) * W;
    const valuesGrid: (number | null)[] = [];
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        const v = f(min + (max - min) * (i + 0.5) / GRID, yMin + (yMax - yMin) * (j + 0.5) / GRID);
        valuesGrid.push(v === null || !Number.isFinite(v) ? null : v);
      }
    }
    const finite = valuesGrid.filter((v): v is number => v !== null).sort((a, b) => a - b);
    const low = finite.length ? finite[Math.floor((finite.length - 1) * 0.05)]! : 0;
    const high = finite.length ? finite[Math.floor((finite.length - 1) * 0.95)]! : 1;
    const range = Math.max(high - low, 1e-6);
    const contour = levelSegments((sx, sy) => f(sx, sy), min, max, yMin, yMax, 41, g.value ?? 0);
    const constraintCompiled = constraint.trim() ? compileFunction2d(function2dValue(constraint, {})) : null;
    const constraintSegments = constraintCompiled
      ? levelSegments((sx, sy) => constraintCompiled(sx, sy), min, max, yMin, yMax, 41, 0)
      : [];
    const norm = Math.hypot(g.fx, g.fy);
    const arrowLength = span * 0.55;
    const arrow = norm > 0
      ? { x: x + g.fx / norm * arrowLength, y: y + g.fy / norm * arrowLength }
      : null;
    const heading = { x: x + Math.cos(theta) * span * 0.4, y: y + Math.sin(theta) * span * 0.4 };
    return <div data-calculus="gradientContour" className={styles.body}>
      <svg className={styles.plot} style={inCard ? { maxHeight: 270 } : undefined}
        viewBox={`0 0 ${W + PAD * 2} ${W + PAD * 2}`} role="img" aria-label="等高线热图、梯度箭头与约束线">
        <rect x={PAD} y={PAD} width={W} height={W} fill="var(--paper-1)" stroke={HAIRLINE} />
        {valuesGrid.map((v, k) => {
          if (v === null) return null;
          const i = k % GRID, j = Math.floor(k / GRID);
          const weight = Math.max(0, Math.min(1, (v - low) / range));
          return <rect key={k} x={PAD + i * CELL} y={PAD + j * CELL} width={CELL} height={CELL}
            fill={v >= 0 ? CORAL_SOFT : INDIGO_SOFT} fillOpacity={0.2 + 0.65 * weight} />;
        })}
        {contour.map((s, k) => <line key={`c${k}`} x1={px(s.x1)} y1={py(s.y1)} x2={px(s.x2)} y2={py(s.y2)}
          stroke={CORAL} strokeWidth="1.4" />)}
        {constraintSegments.map((s, k) => <line key={`g${k}`} x1={px(s.x1)} y1={py(s.y1)} x2={px(s.x2)} y2={py(s.y2)}
          stroke="var(--color-warn)" strokeWidth="1.2" strokeDasharray="4 3" />)}
        {arrow && <>
          <line x1={px(x)} y1={py(y)} x2={px(arrow.x)} y2={py(arrow.y)} stroke="var(--color-warn)" strokeWidth="2.2" />
          <circle cx={px(arrow.x)} cy={py(arrow.y)} r="3" fill="var(--color-warn)" />
        </>}
        <line x1={px(x)} y1={py(y)} x2={px(heading.x)} y2={py(heading.y)} stroke={PASS} strokeWidth="1.6" strokeDasharray="5 3" />
        <circle cx={px(x)} cy={py(y)} r="4" fill={INDIGO} stroke="var(--paper-0)" strokeWidth="1.5" />
        <text x={PAD + 4} y={W + PAD - 4} fill={INK_MUTED} fontSize="9">x ∈ [{num(x - span)}, {num(x + span)}]</text>
      </svg>
      {constraintInput}
      {!inCard && <>
        {controls}
        <p className={styles.readout}>f(x, y) = <b data-readout="value">{num(g.value)}</b><br />
          ∇f = (<b data-readout="gradient-x">{num(g.fx)}</b>, <b data-readout="gradient-y">{num(g.fy)}</b>)<br />
          D_θ f = <b data-readout="direction-derivative">{num(directional)}</b></p>
        <p className={styles.tip}>底色为 f 的热图（朱砂为正、靛蓝为负），朱砂实线是过当前点的等高线，褐色箭头为梯度（垂直于等高线），绿色虚线为方向 θ。约束线按 g=0 画虚线段，留空则不画。</p>
      </>}
    </div>;
  } catch (error) {
    return <div data-calculus="gradientContour" className={styles.body}>
      {constraintInput}
      {!inCard && controls}<Notice>{errorText(error)}</Notice>
    </div>;
  }
}

export function VectorFieldSourceBody({ node, onText, inCard }: NodeBodyProps): JSX.Element {
  const { p, q } = vectorFieldParts(node.text);
  let error = '';
  try { vectorFieldValue(node.text); } catch (cause) { error = errorText(cause); }
  return <div data-calculus="vectorFieldSource" className={styles.body}>
    <label className={styles.expression}>P(x,y) =
      <input aria-label="向量场分量 P" maxLength={240} spellCheck={false} value={p} readOnly={!onText}
        onChange={event => onText?.(event.currentTarget.value + '\n' + q)} />
    </label>
    <label className={styles.expression}>Q(x,y) =
      <input aria-label="向量场分量 Q" maxLength={240} spellCheck={false} value={q} readOnly={!onText}
        onChange={event => onText?.(p + '\n' + event.currentTarget.value)} />
    </label>
    {onText && <label className={styles.field}>场预设
      <select aria-label="向量场预设" value={VECTOR_FIELDS.find(field => field.text === p + '\n' + q)?.text ?? ''}
        onChange={event => onText(event.currentTarget.value)}>
        <option value="" disabled>自定义向量场</option>
        {VECTOR_FIELDS.map(field => <option key={field.label} value={field.text}>{field.label}</option>)}
      </select>
    </label>}
    {error && <Notice>{error}</Notice>}
    {!inCard && <p className={styles.tip}>填写 P 和 Q 后，把 (P,Q) 输出接到可以读取二维向量场的积木。</p>}
  </div>;
}

function ConnectedDiskIntegral({ field, inCard }: { field: Function2dValue; inCard?: boolean }) {
  const sample = sampleDiskDensity(field);
  return <div data-calculus="doubleIntegralView" className={styles.body}>
    <svg className={styles.plot} viewBox="0 0 340 188" role="img" aria-label="单位圆盘的同心积分环带">
      <circle cx="170" cy="91" r="76" fill={INDIGO_SOFT} stroke={INDIGO} />
      {[19, 38, 57].map(r => <circle key={r} cx="170" cy="91" r={r} fill="none" stroke={HAIRLINE_STRONG} strokeDasharray="3 3" />)}
      <path d="M110 91a60 60 0 1 0 120 0a60 60 0 1 0 -120 0M126 91a44 44 0 1 0 88 0a44 44 0 1 0 -88 0"
        fill={CORAL_SOFT} fillRule="evenodd" stroke={CORAL} />
      <path d="M80 91h180M170 9v164" stroke={HAIRLINE_STRONG} opacity=".7" />
      <text x="21" y="171" fill={INK_MUTED} fontSize="11">区域 x²+y²≤1</text>
    </svg>
    {sample.mass === undefined ? <Notice>{sample.error}</Notice>
      : <p className={styles.readout}>{sample.negative ? '带符号积分' : '质量'} ∬ρ dA ≈ <b data-readout="disk-mass">{num(sample.mass)}</b></p>}
    {!inCard && <p className={styles.tip}>接线提供密度 ρ(x,y)。按同心环带与等角微元做中点和，面积权重为 r·Δr·Δθ。</p>}
  </div>;
}

export function DoubleIntegralBody({ node, values, onParams, onText, inCard }: NodeBodyProps): JSX.Element {
  if (values.in?.kind === 'function2d') return <ConnectedDiskIntegral field={values.in} inCard={inCard} />;
  if (Object.hasOwn(values, 'in')) return <Notice>接线暂未提供可计算的圆盘密度，请检查二元函数表达式。</Notice>;
  const mode = Math.round(node.params.mode ?? 0) === 1 ? 1 : 0;
  const n = Math.max(4, Math.min(80, Math.round(node.params.n ?? 20)));
  const rMax = Math.max(0.2, Math.min(3, node.params.rMax ?? 1));
  const theta1 = node.params.theta1 ?? 0, theta2 = node.params.theta2 ?? Math.PI * 2;
  const fallback = mode === 1 ? 'r' : 'x+y';
  const integrand = node.text && node.text.trim() ? node.text : fallback;
  const controls = <>
    <label className={styles.field}>微元类型<select aria-label="二重积分微元类型" value={mode}
      onChange={(e) => onParams?.({ mode: Number(e.target.value) })}>
      <option value="0">直角网格</option><option value="1">极坐标扇形</option>
    </select></label>
    <label className={styles.expression}>{mode === 1 ? '被积函数 f(θ,r)·r =' : '被积函数 f(x,y) ='}
      <input aria-label="被积函数表达式" maxLength={500} spellCheck={false} value={integrand}
        onChange={(e) => onText?.(e.target.value)} /></label>
    {!inCard && <>
      <div className={styles.fields}>
        <Field label="分割数 n" value={n} min={4} max={80} step={1} onChange={(v) => onParams?.({ n: Math.round(v) })} />
        {mode === 1 && <Field label="半径上限" value={rMax} min={0.2} max={3} step={0.1} onChange={(v) => onParams?.({ rMax: v })} />}
      </div>
      {mode === 1 && <div className={styles.fields}>
        <Field label="θ 下限" value={theta1} min={-6.3} max={6.3} step={0.01} onChange={(v) => onParams?.({ theta1: v })} />
        <Field label="θ 上限" value={theta2} min={-6.3} max={6.3} step={0.01} onChange={(v) => onParams?.({ theta2: v })} />
      </div>}
    </>}
  </>;
  try {
    if (mode === 1) {
      const thetaLo = Math.min(theta1, theta2), thetaHi = Math.max(theta1, theta2);
      const result = polarSandbox(integrand, n, (thetaLo + thetaHi) / 2, { theta0: thetaLo, theta1: thetaHi, rMax });
      const W = 280, PAD = 22, span = rMax * 1.1;
      const px = (v: number) => PAD + (v + span) / (2 * span) * W;
      const py = (v: number) => PAD + (span - v) / (2 * span) * W;
      const polygon = (points: { x: number; y: number }[]) =>
        points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)},${py(p.y)}`).join(' ') + ' Z';
      const rays = Array.from({ length: Math.min(n, 28) + 1 }, (_, i) => thetaLo + (thetaHi - thetaLo) * i / Math.min(n, 28));
      return <div data-calculus="doubleIntegralView" className={styles.body}>
        <svg className={styles.plot} viewBox={`0 0 ${W + PAD * 2} ${W + PAD * 2}`} role="img" aria-label="极坐标扇形微元与单位圆区域">
          <rect x={PAD} y={PAD} width={W} height={W} fill="var(--paper-1)" stroke={HAIRLINE} />
          <path d={polygon(result.outerPoints)} fill={CORAL_SOFT} stroke={CORAL} strokeWidth="1.2" />
          <path d={polygon(result.innerPoints)} fill={INDIGO_SOFT} stroke={INDIGO} strokeWidth="1" strokeDasharray="4 3" />
          {rays.map((angle, i) => <line key={i} x1={px(0)} y1={py(0)} x2={px(Math.cos(angle) * rMax)} y2={py(Math.sin(angle) * rMax)}
            stroke={HAIRLINE_STRONG} strokeWidth="0.8" />)}
          {[0.25, 0.5, 0.75, 1].map((ratio) => <circle key={ratio} cx={px(0)} cy={py(0)} r={ratio * rMax / span * W / 2}
            fill="none" stroke={HAIRLINE} strokeDasharray="2 4" />)}
        </svg>
        {controls}
        {!inCard && <>
          <p className={styles.readout}>θ 切片 = {num(result.slice.theta)} rad，r ∈ [{num(result.slice.r_lower)}, {num(result.slice.r_upper)})<br />
            中点和近似 ≈ <b data-readout="approx">{num(result.approx)}</b></p>
          <p className={styles.tip}>极坐标微元 dA = r·dr·dθ，被积函数需自行乘上 Jacobian r。扇形按 n 等分 θ 与 r；近似只作观察，不回写原题条件。</p>
        </>}
      </div>;
    }
    const result = rectSandbox(integrand, n);
    const W = 280, PAD = 22;
    const px = (v: number) => PAD + v * W;
    const py = (v: number) => PAD + (1 - v) * W;
    const lines = Array.from({ length: Math.min(n, 40) + 1 }, (_, i) => i / Math.min(n, 40));
    return <div data-calculus="doubleIntegralView" className={styles.body}>
      <svg className={styles.plot} viewBox={`0 0 ${W + PAD * 2} ${W + PAD * 2}`} role="img" aria-label="直角网格微元与切片">
        <rect x={PAD} y={PAD} width={W} height={W} fill="var(--paper-1)" stroke={HAIRLINE} />
        {lines.map((t, i) => <g key={i}>
          <line x1={px(t)} y1={py(0)} x2={px(t)} y2={py(1)} stroke={HAIRLINE} strokeWidth="0.8" />
          <line x1={px(0)} y1={py(t)} x2={px(1)} y2={py(t)} stroke={HAIRLINE} strokeWidth="0.8" />
        </g>)}
        <rect x={px(result.slice.lower)} y={py(result.slice.position)} width={Math.max(0, px(result.slice.upper) - px(result.slice.lower))} height={W / Math.min(n, 40)}
          fill={CORAL_SOFT} stroke={CORAL} strokeWidth="1" />
        <line x1={px(0)} y1={py(result.slice.position)} x2={px(1)} y2={py(result.slice.position)} stroke={CORAL} strokeWidth="1.2" />
        <text x={PAD + 4} y={W + PAD - 4} fill={INK_MUTED} fontSize="9">区域 [0,1] × [0,1]</text>
      </svg>
      {controls}
      {!inCard && <>
        <p className={styles.readout}>切片 y = {num(result.slice.position)}，x ∈ [{num(result.slice.lower)}, {num(result.slice.upper)}]<br />
          中点和近似 ≈ <b data-readout="approx">{num(result.approx)}</b></p>
        <p className={styles.tip}>直角微元 dA = dy·dx，网格为 n × n 等分；高亮条是当前外层切片。近似值只用于观察，不改变原题的区域条件。</p>
      </>}
    </div>;
  } catch (error) {
    return <div data-calculus="doubleIntegralView" className={styles.body}>{controls}<Notice>{errorText(error)}</Notice></div>;
  }
}
