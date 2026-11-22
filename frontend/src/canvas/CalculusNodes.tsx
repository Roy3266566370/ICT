import { useEffect, useId, useMemo, useState } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import type { RealFunction } from './calculus.ts';
import { compileFunction, functionValue, finiteAt, derivativeAt, integrate, approachLimit, taylorPolynomial, epsilonDeltaBand } from './calculus.ts';
import { formatNumber } from '../labs/expr.ts';
import styles from './calculus.module.css';

const num = (v: number | null | undefined) => formatNumber(v, 6);
const orange = '#b65a3c', blue = '#6265be';

function Field({ label, value, onChange, min = -100, max = 100, step = 0.1 }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className={styles.field}><span>{label}</span><input type="number" aria-label={label} value={draft} min={min} max={max} step={step}
    onChange={(e) => {
      setDraft(e.target.value);
      const next = e.target.valueAsNumber;
      if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
    }}
    onBlur={(e) => {
      const next = Number.isFinite(e.target.valueAsNumber) ? Math.max(min, Math.min(max, e.target.valueAsNumber)) : value;
      setDraft(String(next)); if (next !== value) onChange(next);
    }} /></label>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className={styles.notice} role="status">{children}</p>;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : '请检查函数与参数'; }

function inputFunction(values: NodeBodyProps['values']): RealFunction {
  if (values.in?.kind !== 'function') throw new Error('把「函数源」的输出红点连到左侧 f(x) 输入；泰勒近似的函数输出也可以接入。');
  return compileFunction(values.in);
}

function position(props: NodeBodyProps): number {
  return props.values.x?.kind === 'scalar' ? props.values.x.v : props.node.params.x ?? 0;
}

/** 同一图中的曲线共享尺度；定义域空洞断线，极端值裁剪，避免跨奇点画假连线。 */
function Graph({ curves, min, max, rectangles = [], point, band }: {
  curves: { name: string; f: RealFunction; color: string; dashed?: boolean }[];
  min: number; max: number;
  rectangles?: { x: number; y: number; width: number }[];
  point?: { x: number; y: number };
  /** ε-δ 带：L±ε 横带与 x₀±δ 竖带，交集加深（内联样式，不新增 CSS 类） */
  band?: { x0: number; level: number; eps: number; delta: number };
}) {
  const id = useId();
  if (!(max > min)) return <Notice>横轴上限必须大于下限。</Notice>;
  const samples = curves.map((curve) => Array.from({ length: 241 }, (_, i) => {
    const x = min + (max - min) * i / 240;
    return { x, y: curve.f(x) };
  }));
  const ys = samples.flat().map((p) => p.y).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (ys.length === 0) return <Notice>当前绘图区间内没有有限实数值，请调整定义域。</Notice>;
  const low = Math.min(0, ys[Math.floor((ys.length - 1) * 0.04)]!);
  const high = Math.max(0, ys[Math.floor((ys.length - 1) * 0.96)]!);
  const pad = Math.max((high - low) * 0.16, 0.5), bottom = low - pad, top = high + pad;
  const px = (x: number) => 34 + (x - min) / (max - min) * 310;
  const py = (y: number) => 185 - (y - bottom) / (top - bottom) * 165;
  const bandTop = band ? Math.min(py(band.level + band.eps), py(band.level - band.eps)) : 0;
  const bandHeight = band ? Math.abs(py(band.level + band.eps) - py(band.level - band.eps)) : 0;
  const bandLeft = band ? px(band.x0 - band.delta) : 0;
  const bandWidth = band ? Math.max(0, px(band.x0 + band.delta) - px(band.x0 - band.delta)) : 0;
  const paths = samples.map((points) => {
    let drawing = false, previous = 0;
    return points.map(({ x, y }) => {
      if (y === null || !Number.isFinite(y) || y < bottom || y > top) { drawing = false; return ''; }
      const screenY = py(y);
      const command = drawing && Math.abs(screenY - previous) < 110 ? 'L' : 'M';
      drawing = true; previous = screenY;
      return `${command}${px(x).toFixed(2)},${screenY.toFixed(2)}`;
    }).join(' ');
  });
  return <>
    <svg className={styles.graph} viewBox="0 0 360 215" role="img" aria-label={curves.map((c) => c.name).join('与') + '，横轴 ' + num(min) + ' 到 ' + num(max)}>
      <defs><clipPath id={id}><rect x="34" y="20" width="310" height="165" /></clipPath></defs>
      {[0, 1, 2, 3, 4].map((i) => <g key={i}>
        <line x1="34" x2="344" y1={20 + i * 41.25} y2={20 + i * 41.25} stroke="#e8e2d5" />
        <text x="30" y={24 + i * 41.25} textAnchor="end">{num(top - i * (top - bottom) / 4).slice(0, 7)}</text>
      </g>)}
      <g clipPath={`url(#${id})`}>
        <line x1="34" x2="344" y1={py(0)} y2={py(0)} stroke="#aaa496" />
        <line x1={px(0)} x2={px(0)} y1="20" y2="185" stroke="#aaa496" />
        {band ? <g>
          <rect x="34" y={bandTop} width="310" height={bandHeight} fill="#b65a3c1f" stroke="#b65a3c66" strokeWidth="0.8" strokeDasharray="5 4" />
          <rect x={bandLeft} y="20" width={bandWidth} height="165" fill="#6265be1f" stroke="#6265be66" strokeWidth="0.8" strokeDasharray="5 4" />
          <rect x={bandLeft} y={bandTop} width={bandWidth} height={bandHeight} fill="#95866b3d" />
        </g> : null}
        {rectangles.map((rect, i) => <rect key={i} x={px(rect.x)} y={Math.min(py(0), py(rect.y))} width={Math.max(0, px(rect.x + rect.width) - px(rect.x))}
          height={Math.abs(py(rect.y) - py(0))} fill={rect.y < 0 ? '#6265be24' : '#b65a3c24'} stroke={rect.y < 0 ? '#6265be88' : '#b65a3c88'} strokeWidth="0.6" />)}
        {curves.map((curve, i) => <path key={curve.name} d={paths[i]} fill="none" stroke={curve.color} strokeWidth="2" strokeDasharray={curve.dashed ? '5 4' : undefined} />)}
        {point && <circle cx={px(point.x)} cy={py(point.y)} r="4" fill={orange} stroke="white" strokeWidth="1.5" />}
      </g>
      {[0, 1, 2, 3, 4].map((i) => <text key={i} x={34 + i * 77.5} y="201" textAnchor="middle">{num(min + i * (max - min) / 4).slice(0, 8)}</text>)}
    </svg>
    <div className={styles.legend}>{curves.map((c) => <span key={c.name}><i style={{ background: c.color }} />{c.name}</span>)}</div>
  </>;
}

const PRESETS = [
  ['二次函数', 'a*x^2+b*x+c'], ['三次函数', 'x^3-3*x'], ['正弦', 'a*sin(x+b)+c'],
  ['指数', 'exp(a*x)'], ['对数', 'ln(x)'], ['重要极限', 'sin(x)/x'], ['绝对值', 'abs(x)'],
] as const;

export function FunctionSourceBody({ node, onParams, onText }: NodeBodyProps) {
  let error = '';
  try { functionValue(node.text ?? 'a*x^2+b*x+c', node.params); } catch (e) { error = errorText(e); }
  return <div className={styles.body}>
    <label className={styles.expression}>f(x) =<input aria-label="函数表达式" maxLength={500} spellCheck={false} value={node.text ?? 'a*x^2+b*x+c'} onChange={(e) => onText?.(e.target.value)} /></label>
    <div className={styles.presets}>{PRESETS.map(([name, expression]) => <button type="button" key={name} onClick={() => onText?.(expression)}>{name}</button>)}</div>
    <div className={styles.fields}>{(['a', 'b', 'c'] as const).map((key) => <Field key={key} label={`参数 ${key}`} value={node.params[key] ?? (key === 'a' ? 1 : 0)} onChange={(v) => onParams?.({ [key]: v })} />)}</div>
    {error ? <Notice>{error}</Notice> : <p className={styles.tip}>输出整条函数，修改后所有连线对象同步更新。</p>}
    <details className={styles.help}><summary>表达式与连线说明</summary>使用 x、a、b、c；乘法写 *，幂写 ^；支持 sin、cos、tan、exp、ln、sqrt、abs、pi、e，三角函数按弧度。将右侧红点连到高数积木的 f(x) 端口。</details>
  </div>;
}

export function FunctionPlotBody(props: NodeBodyProps) {
  const { node, onParams } = props;
  try {
    const f = inputFunction(props.values), x = position(props);
    const y = f(x);
    return <div className={styles.body}>
      <Graph curves={[{ name: 'f(x)', f, color: blue }]} min={node.params.min ?? -3} max={node.params.max ?? 3} point={y === null ? undefined : { x, y }} />
      <div className={styles.fields}><Field label="横轴下限" value={node.params.min ?? -3} onChange={(min) => onParams?.({ min })} /><Field label="横轴上限" value={node.params.max ?? 3} onChange={(max) => onParams?.({ max })} /></div>
      <ObservationPoint {...props} />
      <p className={styles.readout}>f({num(x)}) = <strong>{num(y)}</strong></p>
      {y === null && <Notice>观察点超出定义域；曲线在无定义样本处断开。</Notice>}
    </div>;
  } catch (e) { return <Notice>{errorText(e)}</Notice>; }
}

function ObservationPoint(props: NodeBodyProps) {
  return props.values.x?.kind === 'scalar'
    ? <p className={styles.tip}>观察点由滑杆接线驱动：x₀ = {num(position(props))}</p>
    : <Field label="观察点 x₀" value={position(props)} onChange={(x) => props.onParams?.({ x })} />;
}

export function DerivativeBody(props: NodeBodyProps) {
  const x = position(props), h = props.node.params.h ?? 0.5;
  const showDerivative = !!props.node.params.showDerivative;
  const controls = <>
    <ObservationPoint {...props} />
    <Field label="割线步长 h" value={h} min={0.000001} max={2} step={0.01} onChange={(v) => props.onParams?.({ h: v })} />
    <label className={styles.check}><input type="checkbox" checked={showDerivative} onChange={(e) => props.onParams?.({ showDerivative: Number(e.target.checked) })} />叠加 f′(x)</label>
  </>;
  try {
    const f = inputFunction(props.values), y = finiteAt(f, x), slope = derivativeAt(f, x);
    const secant = (finiteAt(f, x + h) - y) / h;
    // 导数曲线只在自动微分可用的点取值，不可导处断线而不是让整幅图报错。
    const derivativeCurve: RealFunction = (t) => { try { return derivativeAt(f, t); } catch { return null; } };
    const curveOfDerivative = showDerivative ? [{ name: 'f′(x)', f: derivativeCurve, color: '#c08a2e', dashed: true }] : [];
    return <div className={styles.body}>
      <Graph curves={[{ name: 'f(x)', f, color: blue }, { name: '切线', f: (t) => y + slope * (t - x), color: orange }, { name: '割线', f: (t) => y + secant * (t - x), color: '#629184', dashed: true }, ...curveOfDerivative]} min={x - 2} max={x + 2} point={{ x, y }} />
      {controls}<p className={styles.readout}>差商 ≈ {num(secant)}<br />导数 f′(x₀) ≈ <strong>{num(slope)}</strong></p>
      <p className={styles.tip}>切线：y ≈ {num(y)} + ({num(slope)})(x − {num(x)})。逐渐减小 h，比较割线与切线。</p>
      <p className={styles.tip}>导数由表达式自动微分，左右分支的导数不一致时停止输出。割线仍按所选 h 计算差商。</p>
      {showDerivative && <p className={styles.tip}>叠加的 f′(x) 虚线是各点导数连成的曲线：切点处切线的斜率应等于该曲线在同一点的纵坐标。</p>}
    </div>;
  } catch (e) { return <div className={styles.body}>{controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function LimitBody(props: NodeBodyProps) {
  const x = position(props), side = props.node.params.side ?? 0, eps = props.node.params.eps ?? 0.1;
  const controls = <>
    <ObservationPoint {...props} />
    <label className={styles.field}>趋近方向<select aria-label="趋近方向" value={side} onChange={(e) => props.onParams?.({ side: Number(e.target.value) })}><option value="0">双侧</option><option value="-1">左极限</option><option value="1">右极限</option></select></label>
    <Field label="容差 ε" value={eps} min={0.000001} max={10} step={0.01} onChange={(v) => props.onParams?.({ eps: v })} />
  </>;
  try {
    const f = inputFunction(props.values), result = approachLimit(f, x, side);
    const band = epsilonDeltaBand(f, x, eps);
    const hasBand = band.level !== null && band.delta !== null;
    const span = Math.max((band.delta ?? 0) * 6, eps * 4, 0.5);
    const insideCount = band.samples.filter((sample) => sample.inside).length;
    return <div className={styles.body}>
      <Graph curves={[{ name: 'f(x)', f, color: blue }]} min={x - span} max={x + span}
        band={hasBand ? { x0: x, level: band.level!, eps, delta: band.delta! } : undefined} />
      {controls}
      <table className={styles.table}><caption>逐步靠近 x₀（不取 x₀ 本身）</caption><thead><tr><th>距离 h</th><th>f(x₀−h)</th><th>f(x₀+h)</th></tr></thead><tbody>{result.rows.map((r) => <tr key={r.h}><td>{r.h.toExponential(0)}</td><td>{num(r.left)}</td><td>{num(r.right)}</td></tr>)}</tbody></table>
      <p className={styles.readout}>数值候选 ≈ <strong>{num(result.candidate)}</strong><br />L ≈ {num(band.level)}<br />可选 δ = <b data-readout="delta">{num(band.delta)}</b></p>
      <Notice>{result.message}</Notice>
      {band.message ? <p className={styles.tip}>{band.message}</p> : <p className={styles.tip}>在 x₀±δ 内采集 {band.samples.length} 个点，其中 {insideCount} 个落入 L±ε 带。</p>}
      <p className={styles.tip}>f(x₀) = {num(f(x))}；函数值与极限要分别观察。横带 L±ε 与竖带 x₀±δ 的交集加深：竖带内的曲线都落在横带里，ε 就达标。</p>
    </div>;
  } catch (e) { return <div className={styles.body}>{controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function IntegralBody(props: NodeBodyProps) {
  const { node, onParams } = props;
  const lower = node.params.lower ?? 0, upper = node.params.upper ?? 1, n = node.params.n ?? 12, method = node.params.method ?? 1, area = !!node.params.area;
  const controls = <>
    <div className={styles.fields}><Field label="积分下限" value={lower} onChange={(v) => onParams?.({ lower: v })} /><Field label="积分上限" value={upper} onChange={(v) => onParams?.({ upper: v })} /></div>
    <Field label="分割数 n" value={n} min={1} max={200} step={1} onChange={(v) => onParams?.({ n: Math.round(v) })} />
    <label className={styles.field}>取样方式<select aria-label="黎曼和取样方式" value={method} onChange={(e) => onParams?.({ method: Number(e.target.value) })}><option value="0">左端点</option><option value="1">中点</option><option value="2">右端点</option></select></label>
    <label className={styles.check}><input type="checkbox" checked={area} onChange={(e) => onParams?.({ area: Number(e.target.checked) })} />计算几何面积 ∫|f(x)| dx</label>
  </>;
  try {
    const f = inputFunction(props.values), result = integrate(f, lower, upper, n, method, area);
    const lo = Math.min(lower, upper), hi = Math.max(lower, upper), pad = Math.max((hi - lo) * 0.12, 0.2);
    return <div className={styles.body}>
      <Graph curves={[{ name: area ? '|f(x)|' : 'f(x)', f: area ? (x) => { const y = f(x); return y === null ? null : Math.abs(y); } : f, color: blue }]} min={lo - pad} max={hi + pad} rectangles={result.rectangles} />
      {controls}
      <p className={styles.readout}>黎曼和 Sₙ ≈ <strong>{num(result.sum)}</strong><br />数值参考 ≈ {num(result.reference)}<br />与参考差值 ≈ {num(result.error)}</p>
      <p className={styles.tip}>输出端口传递数值参考（复合 Simpson，1024 段），不是解析真值。{area ? '面积取非负值，与区间方向无关。' : 'x 轴下方贡献为负，交换上下限会变号。'} 不处理反常积分；采样不能证明区间内处处连续。</p>
    </div>;
  } catch (e) { return <div className={styles.body}>{controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function TaylorBody(props: NodeBodyProps) {
  const { node, values, onParams } = props;
  const center = node.params.center ?? 0, degree = node.params.degree ?? 3, x = position(props), span = node.params.span ?? 2;
  const calculation = useMemo(() => {
    try {
      const f = inputFunction(values);
      const result = taylorPolynomial(f, center, degree);
      return { f, ...result, error: '' };
    } catch (e) { return { error: errorText(e) }; }
  }, [values.in?.kind === 'function' ? JSON.stringify(values.in) : null, center, degree]);
  const controls = <><div className={styles.fields}><Field label="展开中心 a₀" value={center} onChange={(v) => onParams?.({ center: v })} /><Field label="展开阶数" value={degree} min={1} max={5} step={1} onChange={(v) => onParams?.({ degree: Math.round(v) })} /></div><ObservationPoint {...props} /><Field label="观察半径" value={span} min={0.2} max={8} onChange={(v) => onParams?.({ span: v })} /></>;
  if (!('value' in calculation)) return <div className={styles.body}>{controls}<Notice>{calculation.error}</Notice></div>;
  const polynomial = compileFunction(calculation.value), original = calculation.f(x), approximation = polynomial(x);
  return <div className={styles.body}>
    <Graph curves={[{ name: '原函数', f: calculation.f, color: blue }, { name: `P${degree}(x)`, f: polynomial, color: orange, dashed: true }]} min={center - span} max={center + span} />
    {controls}<p className={styles.readout}>f(x₀) = {num(original)}<br />Pₙ(x₀) ≈ <strong>{num(approximation)}</strong><br />点上误差 ≈ {num(original === null || approximation === null ? null : Math.abs(original - approximation))}</p>
    <details className={styles.help}><summary>查看多项式系数 cₖ</summary><p>Pₙ(x) = Σ cₖ(x − a₀)ᵏ</p><table className={styles.table}><thead><tr><th>k</th><th>cₖ ≈ f⁽ᵏ⁾(a₀)/k!</th></tr></thead><tbody>{calculation.coefficients.map((v, k) => <tr key={k}><td>{k}</td><td>{num(v)}</td></tr>)}</tbody></table></details>
    <p className={styles.tip}>自动微分计算系数，最高五阶，保留浮点误差；仅在中心附近比较。提高阶数不保证远处更准确，图像不证明级数收敛。右侧输出多项式，可接图像或导数积木。</p>
  </div>;
}
