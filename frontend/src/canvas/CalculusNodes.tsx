import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Formula } from '@/components/showcase/Formula';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import type { NodeType, PortSpec } from './types.ts';
import type { RealFunction } from './calculus.ts';
import { compileFunction, functionValue, functionExpressionLatex, finiteAt, derivativeAt, integrate, approachLimit, taylorPolynomial, epsilonDeltaBand } from './calculus.ts';
import { combineFunctions, probabilitySeries, solveLinear2x2, svd2x2 } from './calculusBlocks.ts';
import { KpiRow, LineChart, MatrixBox } from './BlockPrimitives.tsx';
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
export function Graph({ curves, min, max, rectangles = [], point, band }: {
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

const defaultExpression = 'a*x^2+b*x+c';
const FormulaCardEditor = lazy(() => import('./FormulaCardEditor'));

export function FunctionSourceBody({ node, self }: NodeBodyProps) {
  try {
    const value = self?.kind === 'function' ? self : functionValue(node.text ?? defaultExpression, node.params);
    return <Graph curves={[{ name: 'f(x)', f: compileFunction(value), color: blue }]} min={-3} max={3} />;
  } catch (error) {
    return <Notice>{errorText(error)}</Notice>;
  }
}

export function FunctionSourceControls({ node, onParams, onText, exposedKeys = [] }: NodeBodyProps & {
  exposedKeys?: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const expression = node.text ?? defaultExpression;
  let latex = '';
  let error = '';
  try { latex = functionExpressionLatex(expression); } catch (e) { error = errorText(e); }
  return <div className={styles.body}>
    {editing && onText ? <Suspense fallback={<Notice>正在打开函数编辑器…</Notice>}>
      <FormulaCardEditor initialValue={latex} functionMode
        onComplete={(next) => { if (next !== expression) onText(next); setEditing(false); }}
        onCancel={() => setEditing(false)} />
    </Suspense> : <>
      {latex && <div className={styles.expression}><Formula tex={'f(x) = ' + latex} block /></div>}
      {onText && <div className={styles.presets}>
        <button type="button" className={styles.editExpression} onClick={() => setEditing(true)}>编辑函数</button>
        {PRESETS.map(([name, preset]) => <button type="button" key={name} onClick={() => onText(preset)}>{name}</button>)}
      </div>}
    </>}
    {onParams && <div className={styles.fields}>{(['a', 'b', 'c'] as const).filter((key) => !exposedKeys.includes(key))
      .map((key) => <Field key={key} label={`参数 ${key}`} value={node.params[key] ?? (key === 'a' ? 1 : 0)} onChange={(v) => onParams({ [key]: v })} />)}</div>}
    {error && !editing && <Notice>{error}</Notice>}
    {onText && <details className={styles.help}><summary>表达式与连线说明</summary>可用变量 x 和参数 a、b、c。三角函数按弧度计算。把卡片的 f(x) 输出端口连接到导数、积分或其他高数积木，修改后它们会一起更新。</details>}
  </div>;
}

export function FunctionPlotBody(props: NodeBodyProps) {
  const { node, onParams, inCard } = props;
  try {
    const f = inputFunction(props.values), x = position(props);
    const y = f(x);
    return <div className={styles.body}>
      <Graph curves={[{ name: 'f(x)', f, color: blue }]} min={node.params.min ?? -3} max={node.params.max ?? 3} point={y === null ? undefined : { x, y }} />
      {!inCard && <>
        <div className={styles.fields}><Field label="横轴下限" value={node.params.min ?? -3} onChange={(min) => onParams?.({ min })} /><Field label="横轴上限" value={node.params.max ?? 3} onChange={(max) => onParams?.({ max })} /></div>
        <ObservationPoint {...props} />
        <p className={styles.readout}>f({num(x)}) = <strong>{num(y)}</strong></p>
      </>}
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
  const { inCard } = props;
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
      {!inCard && <>{controls}<p className={styles.readout}>差商 ≈ {num(secant)}<br />导数 f′(x₀) ≈ <strong>{num(slope)}</strong></p>
      <p className={styles.tip}>切线：y ≈ {num(y)} + ({num(slope)})(x − {num(x)})。逐渐减小 h，比较割线与切线。</p>
      <p className={styles.tip}>导数由表达式自动微分，左右分支的导数不一致时停止输出。割线仍按所选 h 计算差商。</p>
      {showDerivative && <p className={styles.tip}>叠加的 f′(x) 虚线是各点导数连成的曲线：切点处切线的斜率应等于该曲线在同一点的纵坐标。</p>}</>}
    </div>;
  } catch (e) { return <div className={styles.body}>{!inCard && controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function LimitBody(props: NodeBodyProps) {
  const { inCard } = props;
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
      {!inCard && <>
        {controls}
        <table className={styles.table}><caption>逐步靠近 x₀（不取 x₀ 本身）</caption><thead><tr><th>距离 h</th><th>f(x₀−h)</th><th>f(x₀+h)</th></tr></thead><tbody>{result.rows.map((r) => <tr key={r.h}><td>{r.h.toExponential(0)}</td><td>{num(r.left)}</td><td>{num(r.right)}</td></tr>)}</tbody></table>
        <p className={styles.readout}>数值候选 ≈ <strong>{num(result.candidate)}</strong><br />L ≈ {num(band.level)}<br />可选 δ = <b data-readout="delta">{num(band.delta)}</b></p>
        <Notice>{result.message}</Notice>
        {band.message ? <p className={styles.tip}>{band.message}</p> : <p className={styles.tip}>在 x₀±δ 内采集 {band.samples.length} 个点，其中 {insideCount} 个落入 L±ε 带。</p>}
        <p className={styles.tip}>f(x₀) = {num(f(x))}；函数值与极限要分别观察。横带 L±ε 与竖带 x₀±δ 的交集加深：竖带内的曲线都落在横带里，ε 就达标。</p>
      </>}
    </div>;
  } catch (e) { return <div className={styles.body}>{!inCard && controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function IntegralBody(props: NodeBodyProps) {
  const { node, onParams, inCard } = props;
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
      {!inCard && <>
        {controls}
        <p className={styles.readout}>黎曼和 Sₙ ≈ <strong>{num(result.sum)}</strong><br />数值参考 ≈ {num(result.reference)}<br />与参考差值 ≈ {num(result.error)}</p>
        <p className={styles.tip}>输出端口传递数值参考（复合 Simpson，1024 段），不是解析真值。{area ? '面积取非负值，与区间方向无关。' : 'x 轴下方贡献为负，交换上下限会变号。'} 不处理反常积分；采样不能证明区间内处处连续。</p>
      </>}
    </div>;
  } catch (e) { return <div className={styles.body}>{!inCard && controls}<Notice>{errorText(e)}</Notice></div>; }
}

export function TaylorBody(props: NodeBodyProps) {
  const { node, values, onParams, inCard } = props;
  const center = node.params.center ?? 0, degree = node.params.degree ?? 3, x = position(props), span = node.params.span ?? 2;
  const calculation = useMemo(() => {
    try {
      const f = inputFunction(values);
      const result = taylorPolynomial(f, center, degree);
      return { f, ...result, error: '' };
    } catch (e) { return { error: errorText(e) }; }
  }, [values.in?.kind === 'function' ? JSON.stringify(values.in) : null, center, degree]);
  const controls = <><div className={styles.fields}><Field label="展开中心 a₀" value={center} onChange={(v) => onParams?.({ center: v })} /><Field label="展开阶数" value={degree} min={1} max={5} step={1} onChange={(v) => onParams?.({ degree: Math.round(v) })} /></div><ObservationPoint {...props} /><Field label="观察半径" value={span} min={0.2} max={8} onChange={(v) => onParams?.({ span: v })} /></>;
  if (!('value' in calculation)) return <div className={styles.body}>{!inCard && controls}<Notice>{calculation.error}</Notice></div>;
  const polynomial = compileFunction(calculation.value), original = calculation.f(x), approximation = polynomial(x);
  return <div className={styles.body}>
    <Graph curves={[{ name: '原函数', f: calculation.f, color: blue }, { name: `P${degree}(x)`, f: polynomial, color: orange, dashed: true }]} min={center - span} max={center + span} />
    {!inCard && <>{controls}<p className={styles.readout}>f(x₀) = {num(original)}<br />Pₙ(x₀) ≈ <strong>{num(approximation)}</strong><br />点上误差 ≈ {num(original === null || approximation === null ? null : Math.abs(original - approximation))}</p>
    <details className={styles.help}><summary>查看多项式系数 cₖ</summary><p>Pₙ(x) = Σ cₖ(x − a₀)ᵏ</p><table className={styles.table}><thead><tr><th>k</th><th>cₖ ≈ f⁽ᵏ⁾(a₀)/k!</th></tr></thead><tbody>{calculation.coefficients.map((v, k) => <tr key={k}><td>{k}</td><td>{num(v)}</td></tr>)}</tbody></table></details>
    <p className={styles.tip}>自动微分计算系数，最高五阶，保留浮点误差；仅在中心附近比较。提高阶数不保证远处更准确，图像不证明级数收敛。右侧输出多项式，可接图像或导数积木。</p></>}
  </div>;
}

/* ---------- 自由组合扩展：函数运算、SVD、线性方程组与概率分布 ---------- */

function matrix2Value(props: NodeBodyProps) {
  const value = props.values.in;
  if (value?.kind !== 'matrix2') return null;
  return { a: value.a, b: value.b, c: value.c, d: value.d };
}

export function FuncCombineBody(props: NodeBodyProps): JSX.Element {
  const { node, values, onParams, onText, inCard } = props;
  const fValue = values.f?.kind === 'function' ? values.f : null;
  if (!fValue) return <Notice>把第一个函数源的 f(x) 接到 f 输入；第二个函数可接线，也可在下方直接写 g(x)。</Notice>;
  let gValue;
  try {
    gValue = values.g?.kind === 'function' ? values.g : functionValue(node.text ?? 'sin(x)', node.params);
  } catch (cause) {
    return <Notice>{errorText(cause)}</Notice>;
  }
  let result;
  try {
    result = combineFunctions(fValue, gValue, node.params.op ?? 0);
  } catch (cause) {
    return <Notice>{errorText(cause)}</Notice>;
  }
  try {
    const f = compileFunction(fValue);
    const g = compileFunction(gValue);
    const combined = compileFunction(result);
    return <div className={styles.body}>
      <Graph min={-3} max={3} curves={[
        { name: 'f(x)', f, color: blue, dashed: true },
        { name: 'g(x)', f: g, color: orange, dashed: true },
        { name: '运算结果', f: combined, color: '#0d9488' },
      ]} />
      {!inCard && <>
        <label className={styles.field}>组合方式
          <select aria-label="函数组合方式" value={Math.round(node.params.op ?? 0)} onChange={(event) => onParams?.({ op: Number(event.currentTarget.value) })}>
            {['f + g', 'f − g', 'f · g', 'f / g', 'f(g(x))'].map((label, index) => <option key={label} value={index}>{label}</option>)}
          </select>
        </label>
        {values.g?.kind === 'function'
          ? <p className={styles.tip}>g(x) 由上游函数源接线；f(g(x)) 会把 g 的表达式代入 f。</p>
          : <>
            <label className={styles.field}>g(x) 表达式
              <input aria-label="g(x) 表达式" value={node.text ?? 'sin(x)'} spellCheck={false}
                onChange={(event) => onText?.(event.currentTarget.value)} />
            </label>
            <div className={styles.presets}>
              {['sin(x)', 'cos(x)', 'x^2', 'exp(x)', '1/x'].map((preset) => <button key={preset} type="button" onClick={() => onText?.(preset)}>{preset}</button>)}
            </div>
          </>}
        <p className={styles.readout}>结果表达式：<strong>{result.expression}</strong></p>
        <p className={styles.tip}>支持加减乘除和复合；g 的参数 a/b/c 会替换为当前数值，输出保留 f 的参数。组合结果可继续接导数、积分或另一个函数运算。</p>
      </>}
    </div>;
  } catch (cause) {
    return <Notice>{errorText(cause)}</Notice>;
  }
}

export function SvdDecomposeBody(props: NodeBodyProps): JSX.Element {
  const { inCard } = props;
  const matrix = matrix2Value(props);
  if (!matrix) return <Notice>把矩阵源的 matrix2 输出接到 SVD 分解算子。</Notice>;
  const result = svd2x2(matrix);
  return <div className={styles.body}>
    <div className={styles.calcGrid}>
      <MatrixBox name="U" data={[[result.u.a, result.u.b], [result.u.c, result.u.d]]} />
      <MatrixBox name="Σ" data={[[result.sigma.a, 0], [0, result.sigma.d]]} />
      <MatrixBox name="Vᵀ" data={[[result.vt.a, result.vt.b], [result.vt.c, result.vt.d]]} />
      <MatrixBox name="输入 A" data={[[matrix.a, matrix.b], [matrix.c, matrix.d]]} />
    </div>
    <p className={styles.readout}>A = U Σ Vᵀ<br />σ₁ = <strong>{num(result.s1)}</strong>，σ₂ = {num(result.s2)}<br />rank = {result.rank} · cond = {Number.isFinite(result.condition) ? num(result.condition) : '∞'}</p>
    {!inCard && <p className={styles.tip}>U 与 Vᵀ 为正交方向，Σ 只在对角线上拉伸。把 U / Σ / Vᵀ 分别接到变换视图，可逐级观察“旋转 → 拉伸 → 再旋转”。</p>}
  </div>;
}

function LinearSolveSvg({ matrix, bx, by, onParams }: {
  matrix: { a: number; b: number; c: number; d: number };
  bx: number; by: number;
  onParams?: (patch: Record<string, number>) => void;
}): JSX.Element {
  const drag = useRef(false);
  const scale = 34;
  const cx = 110;
  const cy = 78;
  const px = (x: number) => cx + Math.max(-3.2, Math.min(3.2, x)) * scale;
  const py = (y: number) => cy - Math.max(-2.7, Math.min(2.7, y)) * scale;
  const solution = solveLinear2x2(matrix, bx, by);
  const update = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!onParams) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width * 220 - cx) / scale;
    const y = -((event.clientY - rect.top) / rect.height * 156 - cy) / scale;
    onParams({ bx: Math.max(-4, Math.min(4, x)), by: Math.max(-4, Math.min(4, y)) });
  };
  return <svg className={styles.graph} viewBox="0 0 220 156" role="img" aria-label="线性方程组列空间与最小二乘投影"
    data-node-drag-ignore onPointerDown={(event) => { if (!onParams) return; event.stopPropagation(); drag.current = true; event.currentTarget.setPointerCapture(event.pointerId); update(event); }}
    onPointerMove={(event) => { if (drag.current) update(event); }} onPointerUp={() => { drag.current = false; }} style={{ cursor: onParams ? 'crosshair' : 'default' }}>
    {Array.from({ length: 9 }, (_, index) => <line key={`v${index}`} x1={cx + (index - 4) * scale} x2={cx + (index - 4) * scale} y1="8" y2="148" stroke="#eee9df" strokeWidth="0.7" />)}
    {Array.from({ length: 7 }, (_, index) => <line key={`h${index}`} x1="10" x2="210" y1={cy + (index - 3) * scale} y2={cy + (index - 3) * scale} stroke="#eee9df" strokeWidth="0.7" />)}
    <line x1="10" x2="210" y1={cy} y2={cy} stroke="#aaa496" strokeWidth="1" />
    <line x1={cx} x2={cx} y1="8" y2="148" stroke="#aaa496" strokeWidth="1" />
    <line x1={cx} y1={cy} x2={px(matrix.a)} y2={py(matrix.c)} stroke="#4f46e5" strokeWidth="2" />
    <text x={px(matrix.a) + 3} y={py(matrix.c) - 3} fill="#4f46e5">a₁</text>
    <line x1={cx} y1={cy} x2={px(matrix.b)} y2={py(matrix.d)} stroke="#b15236" strokeWidth="2" />
    <text x={px(matrix.b) + 3} y={py(matrix.d) - 3} fill="#b15236">a₂</text>
    <line x1={cx} y1={cy} x2={px(bx)} y2={py(by)} stroke="#0d9488" strokeWidth="2.2" />
    <text x={px(bx) + 3} y={py(by) + 10} fill="#0d9488">b</text>
    {solution.kind === 'unique' ? <>
      <circle cx={px(solution.x)} cy={py(solution.y)} r="3.5" fill="#0d9488" />
      <text x={px(solution.x) + 4} y={py(solution.y) - 4}>x</text>
    </> : null}
    <text x="8" y="12" fill="#5e6878">{solution.kind === 'unique' ? '唯一解' : solution.kind === 'infinite' ? '无穷多解' : solution.kind === 'none' ? '无解' : '最小二乘投影'}</text>
    {onParams ? <text x="8" y="150" fill="#8c95a4">拖动 b 向量</text> : null}
  </svg>;
}

export function LinearSolveViewBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const matrix = matrix2Value(props);
  if (!matrix) return <Notice>把矩阵源的 matrix2 输出接到方程组视图。</Notice>;
  const bx = node.params.bx ?? 2;
  const by = node.params.by ?? 1;
  const solution = solveLinear2x2(matrix, bx, by);
  return <div className={styles.body}>
    <LinearSolveSvg matrix={matrix} bx={bx} by={by} onParams={onParams} />
    {!inCard && <>
      <div className={styles.fields}>
        <Field label="b₁" value={bx} min={-4} max={4} step={0.1} onChange={(value) => onParams?.({ bx: value })} />
        <Field label="b₂" value={by} min={-4} max={4} step={0.1} onChange={(value) => onParams?.({ by: value })} />
      </div>
      <p className={styles.readout}>det = {num(matrix.a * matrix.d - matrix.b * matrix.c)} · rank = {solution.rank}<br />x = {num(solution.x)}，y = {num(solution.y)}<br />残差 ‖Ax−b‖ = <strong>{num(solution.residual)}</strong></p>
      <p className={styles.tip}>{solution.message} 拖动图中 b 向量可直接观察唯一解、无穷多解或无解/投影的分界。</p>
    </>}
  </div>;
}

export function ProbDistSourceBody(props: NodeBodyProps): JSX.Element {
  const { node, onParams, inCard } = props;
  const distribution = Math.round(node.params.distribution ?? 0);
  const result = probabilitySeries({
    distribution,
    samples: node.params.samples ?? 400,
    bins: node.params.bins ?? 24,
    seed: node.params.seed ?? 7,
  });
  return <div className={styles.body}>
    <LineChart labels={result.series.labels} compact={inCard} ariaLabel="概率分布采样直方图与理论曲线"
      series={[
        { name: '采样密度', values: result.series.values },
        { name: '理论密度', values: result.series.secondary?.[0]?.values ?? [], color: '#b15236', dashed: true },
      ]} />
    <KpiRow items={[
      { label: '样本数', value: String(Math.round(node.params.samples ?? 400)) },
      { label: '样本均值', value: num(result.mean) },
      { label: '标准差', value: num(result.spread) },
    ]} />
    {!inCard && <>
      <label className={styles.field}>分布类型
        <select aria-label="概率分布类型" value={distribution} onChange={(event) => onParams?.({ distribution: Number(event.currentTarget.value) })}>
          <option value="0">正态 N(0,1)</option><option value="1">二项 B(10,0.5)</option><option value="2">泊松 λ=4</option><option value="3">指数 λ=1</option>
        </select>
      </label>
      <div className={styles.fields}>
        <Field label="采样量 N" value={node.params.samples ?? 400} min={20} max={2000} step={20} onChange={(value) => onParams?.({ samples: Math.round(value) })} />
        <Field label="分箱数" value={node.params.bins ?? 24} min={6} max={40} step={1} onChange={(value) => onParams?.({ bins: Math.round(value) })} />
        <Field label="随机种子" value={node.params.seed ?? 7} min={1} max={9999} step={1} onChange={(value) => onParams?.({ seed: Math.round(value) })} />
      </div>
      <p className={styles.tip}>采样使用固定种子的本地伪随机数；同一参数每次得到同一组样本。输出 series 可接办公瀑布图或任何序列视图。</p>
    </>}
  </div>;
}

const fnLeft: PortSpec = { id: 'f', label: 'f(x)', kind: 'function' };
const fnRight: PortSpec = { id: 'g', label: 'g(x)', kind: 'function' };
const m2In: PortSpec = { id: 'in', label: 'A', kind: 'matrix2' };
const m2Out = (id: string, label: string): PortSpec => ({ id, label, kind: 'matrix2' });

export const CALCULUS_BLOCK_DEFS: Partial<Record<NodeType, NodeDef>> = {
  funcCombineOp: { title: '函数运算 / 复合', badge: '变换', width: 360, inputs: [fnLeft, fnRight], outputs: [{ id: 'out', label: 'f∘g', kind: 'function' }], Body: FuncCombineBody },
  svdDecomposeOp: { title: 'SVD 分解', badge: '变换', width: 360, inputs: [m2In], outputs: [m2Out('u', 'U'), m2Out('sigma', 'Σ'), m2Out('vt', 'Vᵀ')], Body: SvdDecomposeBody },
  linearSolveView: { title: '线性方程组 Ax=b', badge: '视图', width: 340, inputs: [m2In], Body: LinearSolveViewBody },
  probDistSource: { title: '概率分布与采样', badge: '源', width: 340, outputs: [{ id: 'out', label: '采样序列', kind: 'series' }], Body: ProbDistSourceBody },
};

export const CALCULUS_BLOCK_DEFAULTS: Partial<Record<NodeType, Record<string, number>>> = {
  funcCombineOp: { op: 0, a: 1, b: 0, c: 0 },
  svdDecomposeOp: {},
  linearSolveView: { bx: 2, by: 1 },
  probDistSource: { distribution: 0, samples: 400, bins: 24, seed: 7 },
};
