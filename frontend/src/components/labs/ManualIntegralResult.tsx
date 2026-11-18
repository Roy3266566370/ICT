import type { LabProblem } from '@/labs/types';
import { LabFormula as Formula } from './ProblemText';
import { MathText } from './ProblemText';
import {DoubleIntegralExtensionResult} from './DoubleIntegralExtensionResult';
import styles from './ManualLabComposer.module.css';

export function ManualIntegralResult({ problem, params }: { problem: LabProblem; params: Record<string, unknown> }): JSX.Element | null {
  const input = problem.manual_input;
  if (!input) return null;
  const status = input.result_status ?? 'complete';
  const swapped=problem.model.swapped ? (Array.isArray(problem.model.swapped) ? problem.model.swapped : [problem.model.swapped]) : [];
  const changed = status === 'complete' && (input.task === 'taylor' ? ['order','point'] : input.task === 'integral' ? ['lower', 'upper'] : input.task === 'higher_derivative' ? ['order', 'point'] : input.task === 'limit' ? ['point', 'side'] : input.task === 'derivative' ? ['point'] : ['c'])
    .some(key => params[key] !== problem.model.defaults[key]);
  const formula = status === 'complete' && !input.double_extension && !['limit', 'continuity', 'implicit_normal', 'implicit_derivative', 'parametric_derivative', 'parametric_arc_length', 'curvature', 'asymptote', 'sequence_limit', 'arc_length', 'surface_of_revolution', 'polar_area', 'polar_arc_length', 'function_study', 'taylor', 'geometric_area', 'rotation_volume', 'integral_function', 'ode', 'multivariable', 'multivariable_extrema', 'series_convergence', 'power_series', 'fourier_series', 'space_geometry', 'curve_surface_integral', 'proof'].includes(input.task) && input.result_latex
    ? `${input.latex}=${input.result_latex}` : input.latex;
  const approx = input.result_approx && input.result_approx !== '—' ? input.result_approx : '';
  const verification = input.verification ?? problem.solution.verification ?? null;
  const verificationClass = verification ? {
    symbolic: styles.verificationSymbolic,
    numeric: styles.verificationNumeric,
    unconfirmed: styles.verificationUnconfirmed,
  }[verification.level] : '';
  return <section className={styles.confirmation} aria-label="原题计算结果与过程">
    <h3>原题计算结果与过程</h3>
    <p>用户已确认原题条件 · 本地内核计算</p>
    <div className={styles.formula}><Formula tex={formula} block /></div>
    {input.double_extension ? <DoubleIntegralExtensionResult data={input.double_extension} complete={status==='complete'} /> : null}
    {input.double_details ? <>
      <h4>二重积分区域与次序核查</h4>
      <p>先对<MathText text={String(input.double_details.inner_variable ?? '')} />积分，再对<MathText text={String(input.double_details.outer_variable ?? '')} />积分。</p>
      {input.double_details.region_description ? <p><MathText text={String(input.double_details.region_description ?? '')} /></p> : <p>完整区域：<MathText text={String(input.double_details.outer_bounds[0] ?? '')} /> ≤ <MathText text={String(input.double_details.outer_variable ?? '')} /> ≤ <MathText text={String(input.double_details.outer_bounds[1] ?? '')} />；<MathText text={String(input.double_details.inner_bounds[0] ?? '')} /> ≤ <MathText text={String(input.double_details.inner_variable ?? '')} /> ≤ <MathText text={String(input.double_details.inner_bounds[1] ?? '')} />。</p>}
      {input.double_details.region_kind==='improper' ? <p>矩形边界已核对；各方向的实定义域与绝对收敛分别检查，详见下方过程。不使用有限截断黎曼和。</p> : <p>全区间边界关系：{input.double_details.region_verified ? '已核验' : '未确认'}；原被积函数连续实定义：{input.double_details.continuous_verified ? '已确认的充分条件通过' : '尚未确认，不能由抽样通过推定'}。</p>}
      {input.double_details.zero_area ? <p>内层上下边界处处相等，区域为零面积；保留全部边界条件。</p> : null}
      {status === 'complete' && input.double_details.inner_integral_latex ? <><p>完成内层积分后，以下表达式再按外层区间积分：</p><Formula tex={input.double_details.inner_integral_latex} block /></> : null}
      <p><MathText text={String(input.double_details.note ?? '')} /></p>
      {swapped.length ? <section aria-label="换序后的全部分段">
        <h4>换序结果 · {swapped.length} 段</h4>
        {swapped.every(part=>part.region_verified) ? <>
          <p>以下全部分段相加才是原积分。同一外层区间出现多段时，分别表示不同的内层区间；区域覆盖、总面积及积分值已核验。</p>
          <ol>{swapped.map((part,index)=><li key={index}>
            <p>第 {index+1} 段：<MathText text={String(part.outer_bounds[0] ?? '')} /> ≤ <MathText text={String(part.outer_variable ?? '')} /> ≤ <MathText text={String(part.outer_bounds[1] ?? '')} />；<MathText text={String(part.inner_bounds[0] ?? '')} /> ≤ <MathText text={String(part.inner_variable ?? '')} /> ≤ <MathText text={String(part.inner_bounds[1] ?? '')} />。</p>
            <div className={styles.formula}><Formula tex={part.formula_tex} block /></div>
            <p>本段积分值：<MathText text={String(part.exact ?? '')} /></p>
          </li>)}</ol>
        </> : <p>此存档缺少区域等价核验记录，请通过“核对识别条件”重新计算换序结果。</p>}
      </section> : null}
      <p>阴影与切片使用内核确认的同一组边界；分割数只影响中点和近似，不改变原题积分限和精确值。</p>
    </> : null}
    {input.triple_details ? <>
      <h4>三重积分区域、坐标变换与次序核查</h4>
      <p>固定次序：先对<MathText text={String(input.triple_details.inner_variable ?? '')} />积分，再对<MathText text={String(input.triple_details.middle_variable ?? '')} />积分，最后对<MathText text={String(input.triple_details.outer_variable ?? '')} />积分。</p>
      <p>完整区域：<MathText text={String(input.triple_details.outer_bounds[0] ?? '')} /> ≤ <MathText text={String(input.triple_details.outer_variable ?? '')} /> ≤ <MathText text={String(input.triple_details.outer_bounds[1] ?? '')} />；<MathText text={String(input.triple_details.middle_bounds[0] ?? '')} /> ≤ <MathText text={String(input.triple_details.middle_variable ?? '')} /> ≤ <MathText text={String(input.triple_details.middle_bounds[1] ?? '')} />；<MathText text={String(input.triple_details.inner_bounds[0] ?? '')} /> ≤ <MathText text={String(input.triple_details.inner_variable ?? '')} /> ≤ <MathText text={String(input.triple_details.inner_bounds[1] ?? '')} />。</p>
      <p>区域类型：{{box:'长方体',z_simple:'z型区域',cylindrical:'柱坐标区域',spherical:'球坐标区域'}[input.triple_details.region_mode]}；坐标变换雅可比：<Formula tex={input.triple_details.jacobian_latex} /></p>
      <p>全区域边界关系：{input.triple_details.region_verified ? '已核验' : '未确认'}；原被积函数连续实定义：{input.triple_details.continuous_verified ? '已确认的充分条件通过' : '尚未确认，不能由抽样通过推定'}。</p>
      {status === 'complete' && typeof input.triple_details.numeric_value === 'number' ? <p>独立数值复核：≈ {input.triple_details.numeric_value.toPrecision(10)}</p> : null}
      {input.triple_details.region_description ? <p><MathText text={String(input.triple_details.region_description ?? '')} /></p> : null}
      <p><MathText text={String(input.triple_details.note ?? '')} /></p>
      <p>空间网格、曲面与边界曲线使用内核确认的同一区域；它们只辅助观察，不改变原题积分限和精确值。</p>
    </> : null}
    {input.extrema_details ? <>
      <h4>驻点、极值判定与约束核查</h4>
      <p>变量顺序：x、y；{input.extrema_details.constraint ? `完整等式约束：${input.extrema_details.constraint}` : '无额外约束，研究整个实平面上的局部极值'}</p>
      <p>候选全集：{input.extrema_details.stationary_complete ? '已确认' : '尚未确认，不能排除其他候选'}；分类：{input.extrema_details.classification_complete ? '全部完成' : '尚未全部完成'}</p>
      {input.extrema_details.singular_complete !== null ? <p>奇异约束点检查：{input.extrema_details.singular_complete ? '集合已核对' : '尚未确认完整，不能只依赖乘数方程'}</p> : null}
      {input.extrema_details.candidates.length ? <table><caption>已核验的驻点与候选</caption><thead><tr><th>点与函数值</th><th>类型与判定</th><th>核验依据</th></tr></thead><tbody>{input.extrema_details.candidates.map((p,i)=><tr key={i}>
        <td>(<MathText text={String(p.point.join(', ') ?? '')} />)；f=<MathText text={String(p.value ?? '')} />{p.multiplier !== null ? `；λ=${p.multiplier}` : ''}</td>
        <td>{p.kind === 'singular' ? '奇异约束点：' : ''}{{minimum:'局部极小值',maximum:'局部极大值',saddle:'鞍点',undetermined:'尚未判定'}[p.classification]}</td>
        <td><MathText text={String(p.evidence ?? '')} />；方程代回{p.residual_verified ? '通过' : '尚未确认'}{p.constraint_verified !== null ? `；约束代回${p.constraint_verified ? '通过' : '尚未确认'}` : ''}</td>
      </tr>)}</tbody></table> : <p>{status === 'complete' ? '已确认无驻点，光滑可行域中不存在局部极值。' : '无已列出的有限候选，不能据此认定无极值。'}</p>}
      {status === 'complete' && input.extrema_details.result_latex ? <Formula tex={input.extrema_details.result_latex} block /> : null}
      {status !== 'complete' ? <p>尚未完成判定不等于极值不存在；保留已验证的候选和原题条件。</p> : null}
      <p><MathText text={String(input.extrema_details.scope_note ?? '')} /></p>
    </> : null}
    {['limit', 'higher_derivative', 'continuity', 'function_study'].includes(input.task) ? <p role="status"><MathText text={input.result_answer ?? input.result_note ?? ''} /></p> : null}
    {input.multi_details ? <>
      <h4>多元微分结果与适用条件</h4>
      <p>变量顺序：<MathText text={String(input.multi_details.variables.join('、') ?? '')} />；{input.multi_details.point ? `求值点：(${input.multi_details.point.join(', ')})` : '未指定点，给出条件适用的符号公式'}</p>
      {status === 'complete' && input.multi_details.result_latex ? <Formula tex={input.multi_details.result_latex} block /> : null}
      <p>可微性核对：{input.multi_details.differentiability === 'sufficient_c1' ? '该点光滑充分条件已确认' : input.multi_details.differentiability === 'conditional' ? '符号公式在所列光滑充分条件内成立' : '当前未确认可微；不能仅由偏导存在推断全微分成立'}</p>
      {input.multi_details.partials.length ? <table><caption>偏导核对</caption><thead><tr><th>变量</th><th>{input.multi_details.point ? '定义核对的偏导值' : '偏导表达式'}</th></tr></thead><tbody>{input.multi_details.partials.map(p=><tr key={p.variable}><td><MathText text={String(p.variable ?? '')} /></td><td><Formula tex={input.multi_details!.point ? p.value ?? '' : p.latex} /></td></tr>)}</tbody></table> : null}
      {input.multi_details.smooth_conditions.length ? <><p>以下为光滑充分条件，不表示条件以外必不可微：</p>{input.multi_details.smooth_conditions.map((c,i)=><Formula key={i} tex={c} block />)}</> : null}
      {input.multi_details.direction ? <>
        <p>原方向向量：(<MathText text={String(input.multi_details.direction.raw.join(', ') ?? '')} />)；长度：<MathText text={String(input.multi_details.direction.norm ?? '')} />；单位方向：(<MathText text={String(input.multi_details.direction.unit.join(', ') ?? '')} />)</p>
        <p>约定：{input.multi_details.direction.convention === 'forward' ? '正向单侧 h→0+' : '双侧 h→0'}；计算依据：{input.multi_details.method === 'gradient' ? '可微充分条件通过，定义极限与梯度内积核对一致' : '沿已确认单位方向直接按定义求极限，不套用梯度内积'}</p>
      </> : null}
      <p><MathText text={String(input.multi_details.note ?? '')} /></p>
    </> : null}
    {input.space_details ? <>
      <h4><MathText text={String(input.space_details.label ?? '')} /> · 结果与依据</h4>
      {input.space_details.classification ? <p>曲面类型：<MathText text={String(input.space_details.classification ?? '')} /></p> : input.space_details.relation ? <p>位置关系：<MathText text={String(input.space_details.relation ?? '')} /></p> : null}
      {input.space_details.angle ? <p>夹角：<MathText text={String(input.space_details.angle ?? '')} /></p> : null}
      {input.space_details.distance !== null && input.space_details.distance !== undefined ? <p>距离：<MathText text={String(input.space_details.distance ?? '')} /></p> : null}
      {input.space_details.intersection ? <p>交点/交线：<MathText text={String(input.space_details.intersection ?? '')} /></p> : null}
      {input.space_details.center ? <p>配方中心：<MathText text={String(input.space_details.center ?? '')} /></p> : null}
      <table><caption>符号计算结果</caption><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>
        {input.space_details.facts.map((fact, index) => <tr key={`${fact.label}-${index}`}><th><MathText text={String(fact.label ?? '')} /></th><td>{fact.text ?? <Formula tex={fact.latex ?? ''} />}</td></tr>)}
      </tbody></table>
      {input.space_details.equations?.length ? <>{input.space_details.equations.map((equation, index) => <div key={`${equation.label}-${index}`}><p>{equation.label}</p><Formula tex={equation.latex} block /></div>)}</> : null}
      {input.space_details.notes?.length ? <p><MathText text={String(input.space_details.notes.join('；') ?? '')} /></p> : null}
      <p>空间图形为有限范围采样，仅辅助观察；距离、夹角、方程与关系由符号计算给出。</p>
    </> : null}
    {input.proof_details ? <>
      <h4><MathText text={String(input.proof_details.label ?? '')} /> · 证明核对</h4>
      <p>证明状态：{{verified:'已认证',disproved:'已反例否定',local_steps_verified:'局部步骤通过（整体未认证）',invalid:'证明无效',unverified:'未认证'}[input.proof_details.proof_status] ?? input.proof_details.proof_status}；认证级别：<MathText text={String(input.proof_details.verification_level ?? '')} /></p>
      {input.result_answer ? <p role="status"><MathText text={input.result_answer} /></p> : null}
      {input.proof_details.statement ? <p>命题陈述：<MathText text={String(input.proof_details.statement ?? '')} /></p> : null}
      <table><caption>证明义务逐项核对</caption><thead><tr><th>义务</th><th>结果</th><th>说明</th></tr></thead><tbody>
        {input.proof_details.obligations.map((item, index) => <tr key={`${item.id}-${index}`}><td><MathText text={String(item.label ?? '')} /></td><td>{item.status === 'pass' ? '通过' : item.status === 'warn' ? '待确认' : '未通过'}</td><td><MathText text={String(item.detail ?? '')} /></td></tr>)}
      </tbody></table>
      {input.proof_details.certificate_facts?.length ? <table><caption>证明证书与关键依据</caption><thead><tr><th>项目</th><th>内容</th></tr></thead><tbody>
        {input.proof_details.certificate_facts.map((fact, index) => <tr key={`${fact.label}-${index}`}><th><MathText text={String(fact.label ?? '')} /></th><td><MathText text={String(fact.text ?? '')} /></td></tr>)}
      </tbody></table> : null}
      {input.proof_details.reason ? <p><MathText text={String(input.proof_details.reason ?? '')} /></p> : null}
      <p>证明题不以数值抽样代替证明；局部等式通过不等于整段证明成立，未认证结果不自动判分。</p>
    </> : null}
    {input.space_integral_details ? <>
      <h4><MathText text={String(input.space_integral_details.label ?? '')} /> · 结果与依据</h4>
      {input.space_integral_details.orientation ? <p>定向：<MathText text={String(input.space_integral_details.orientation ?? '')} /></p> : null}
      <table><caption>符号计算结果</caption><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>
        {input.space_integral_details.facts.map((fact, index) => <tr key={`${fact.label}-${index}`}><th><MathText text={String(fact.label ?? '')} /></th><td>{fact.text ?? <Formula tex={fact.latex ?? ''} />}</td></tr>)}
      </tbody></table>
      {input.space_integral_details.equations?.length ? <>{input.space_integral_details.equations.map((equation, index) => <div key={`${equation.label}-${index}`}><p>{equation.label}</p><Formula tex={equation.latex} block /></div>)}</> : null}
      {input.space_integral_details.notes?.length ? <p><MathText text={String(input.space_integral_details.notes.join('；') ?? '')} /></p> : null}
      <p>积分值由符号积分与独立数值复核给出；空间曲线、曲面与边界仅为采样观察，不代替原题条件。</p>
    </> : null}
    {input.ode_details ? <>
      <h4>微分方程解与核验</h4>
      <p>方程阶数：{input.ode_details.ode_order ?? '未确认'}；识别类型：{input.ode_details.ode_hints?.join('、') || '尚未确认'}</p>
      {status === 'complete' && input.ode_details.solution_latex ? <Formula tex={input.ode_details.solution_latex} block /> : null}
      <p>原题条件：{input.ode_details.initial_conditions?.join('；') || '未给条件，不补初值'}</p>
      <p>{status !== 'complete' ? '解尚未完成核验，不能据此判断唯一性。' : input.ode_details.free_constants ? '结果仍含任意常数，是解族；未指定常数时不绘制任意示例轨迹。' : '结果不含任意常数；这本身不构成唯一性证明。'}</p>
      <p>方程残差核验：{input.ode_details.residual_verified === true ? '通过' : '未确认'}；条件核验：{!input.ode_details.initial_conditions?.length ? '未给条件，不适用' : input.ode_details.initial_conditions_verified === true ? '通过' : '未确认'}</p>
      <p>已核对的实解区间：{input.ode_details.solution_domain || '未统一确定，任意常数需满足原式定义条件'}</p>
      <p><MathText text={String(input.ode_details.scope_note ?? '')} /></p>
    </> : null}
    {input.geometry_details ? <>
      <h4>已确认区域与计算结果</h4>
      <p>{input.geometry_details.region_kind === 'between_axis' ? '区域包含曲线与x轴之间的正、负函数部分；面积逐段取绝对值，不做正负抵消。' : input.geometry_details.region_kind === 'between_curves' ? '区域为两条曲线之间；按全部交点分段，每段取上、下边界之差，不做正负抵消。' : '区域严格为0≤y≤f(x)；f(x)<0处没有区域，不将其补成曲线与x轴之间的部分。'}</p>
      {input.geometry_details.region_kind === 'between_curves' && input.geometry_details.lower_expression ? <p>下边界：<Formula tex={`y=${input.geometry_details.lower_expression}`} /></p> : null}
      {input.task === 'rotation_volume' ? <p>旋转轴（对称轴）：<MathText text={String(input.geometry_details.rotation_axis ?? 'x')} />轴；{input.geometry_details.rotation_axis === 'y' ? '半径为到y轴的距离|x|，采用壳层法，体积元为2π|x|·高度·dx。' : input.geometry_details.region_kind === 'between_curves' ? '半径为到x轴的距离，采用圆环法，截面积为π(f(x)²-g(x)²)。' : '半径为到x轴的距离，圆盘截面积为πf(x)²。'}</p> : null}
      {input.geometry_details.quantities.map(q => <div key={q.id}><p>{q.label}精确值</p><Formula tex={`${q.id === 'area' ? 'S' : 'V'}=${q.latex}`} block /></div>)}
      <p>{input.geometry_details.region_kind === 'between_curves' ? '两曲线交点' : '区间内部零点'}：{input.geometry_details.zero_points.join('、') || '无已列出的孤立零点'}</p>
      {input.geometry_details.effective_intervals ? <p>非空分段：{input.geometry_details.effective_intervals.map(p => `[${p.join(', ')}]`).join(' ∪ ') || '无正宽度分段（可能只剩零点），面积与体积为0'}</p> : null}
      <p>画布中的矩形或圆盘数值为近似观察，原题结果由解析积分给出。</p>
    </> : null}
    {input.integral_function_details ? <>
      <h4>变限积分求导与核验</h4>
      <p>F(x)=∫<sub>{input.integral_function_details.lower}</sub><sup>{input.integral_function_details.upper}</sup> f(t) dt；f(t)=<MathText text={input.integral_function_details.integrand} />，a(x)=<MathText text={input.integral_function_details.lower} />，b(x)=<MathText text={input.integral_function_details.upper} />。</p>
      <p>F′(x)</p><Formula tex={input.integral_function_details.derivative_latex} block />
      {input.integral_function_details.point ? <p>在 x={input.integral_function_details.point} 处：F′= <MathText text={String(input.integral_function_details.value ?? '')} />{input.integral_function_details.numeric_check !== null ? `；独立数值复核 ≈ ${input.integral_function_details.numeric_check.toPrecision(10)}` : '；独立数值复核未完成'}</p> : <p>未指定求值点，只给出符号导数；不做单点数值冒充。</p>}
      <p>核验级别：{input.integral_function_details.verification_level === 'numeric' ? '符号求导 + 单点数值复核' : input.integral_function_details.verification_level === 'symbolic' ? '符号求导' : '符号求导（数值复核未完成）'}；要求被积函数在上下限处连续、上下限可导。</p>
    </> : null}
    {input.parametric_details ? <>
      <h4>参数方程求导与核验</h4>
      <p>x(t)=<MathText text={input.parametric_details.x_expression} />，y(t)=<MathText text={input.parametric_details.y_expression} />；t0={input.parametric_details.t0}。</p>
      <p>x′= <MathText text={input.parametric_details.dxdt} />，y′= <MathText text={input.parametric_details.dydt} />；dy/dx=<MathText text={input.parametric_details.slope} />。</p>
      {input.parametric_details.second ? <p>d²y/dx²=<MathText text={input.parametric_details.second} />；在 t0 处一阶导 {input.parametric_details.slope_value}、二阶导 {input.parametric_details.second_value}。</p> : <p>在 t0 处 dy/dx={input.parametric_details.slope_value}。</p>}
      {input.parametric_details.tangent ? <><p>切线</p><Formula tex={input.parametric_details.tangent} block /></> : null}
      <p>核验：{input.parametric_details.verification_level === 'numeric' ? '符号链式法则 + 高精度参数导数复核' : '符号链式法则（数值复核未通过或未完成）'}；要求 x′(t0)≠0。</p>
    </> : null}
    {input.implicit_derivative_details ? <>
      <h4>隐函数求导与核验</h4>
      <p>F(x,y)=<MathText text={input.implicit_derivative_details.implicit_expression} />；P=({input.implicit_derivative_details.point_x}, {input.implicit_derivative_details.point_y})。</p>
      <p>F_x=<MathText text={input.implicit_derivative_details.partial_x} />，F_y=<MathText text={input.implicit_derivative_details.partial_y} />；dy/dx=<MathText text={input.implicit_derivative_details.slope} />{input.implicit_derivative_details.second ? `，d²y/dx²=${input.implicit_derivative_details.second}` : ''}。</p>
      <p>核验：{input.implicit_derivative_details.verification_level === 'numeric' ? '隐函数定理 + 已确认分支上的高精度数值复核' : '符号推导（数值复核未通过或未完成）'}；要求 F_y≠0。</p>
    </> : null}
    {input.curvature_details ? <>
      <h4>曲率与曲率圆</h4>
      <p>y=<MathText text={input.curvature_details.expression} /> 在 x={input.curvature_details.point} 处：y′=<MathText text={input.curvature_details.first} />，y″=<MathText text={input.curvature_details.second} />。</p>
      <p>κ=<MathText text={input.curvature_details.curvature} />{input.curvature_details.radius ? `；曲率半径 R=${input.curvature_details.radius}` : '；κ=0，曲率半径不存在（局部近似直线）'}。</p>
      {input.curvature_details.center ? <p>曲率中心：({input.curvature_details.center[0]}, {input.curvature_details.center[1]})。</p> : null}
      <p>核验：{input.curvature_details.verification_level === 'numeric' ? '符号曲率公式 + 高精度一、二阶导数复核' : '符号推导（数值复核未通过或未完成）'}。</p>
    </> : null}
    {input.application_details ? <>
      <h4>积分应用结果与核验</h4>
      <p>{input.application_details.kind === 'surface_of_revolution' ? `绕${input.application_details.axis ?? 'x'}轴旋转曲面` : input.application_details.kind === 'polar_area' ? '极坐标面积' : '弧长'}；区间 [{input.application_details.lower}, {input.application_details.upper}]。</p>
      <p>精确值：<Formula tex={`=${input.application_details.exact_latex}`} /></p>
      {input.application_details.numeric !== null ? <p>独立数值复核：≈ {input.application_details.numeric.toPrecision(10)}</p> : <p>独立数值复核未完成；结果仅为符号积分。</p>}
      <p>核验级别：{input.application_details.verification_level === 'numeric' ? '符号积分 + 高精度数值积分复核' : '符号积分（数值复核未通过或未完成）'}。</p>
    </> : null}
    {input.taylor_details ? <>
      <h4>精确展开式与余项</h4><Formula tex={input.taylor_details.relation_latex} block />
      <p>在 {problem.model.variable ?? 'x'}=<MathText text={String(input.taylor_details.point ?? '')} /> 处展开到 <MathText text={String(input.taylor_details.order ?? '')} /> 阶；余项类型：{input.taylor_details.remainder_kind === 'exact' ? '余项为零' : input.taylor_details.remainder_kind === 'little_o' ? 'Peano 小 o 余项' : '经核验的大 O 余项'}。</p>
      <table><caption>精确展开系数</caption><thead><tr><th>阶数 k</th><th>系数 c_k</th></tr></thead><tbody>{input.taylor_details.coefficients.map(c => <tr key={c.order}><td><MathText text={String(c.order ?? '')} /></td><td><Formula tex={c.latex} /></td></tr>)}</tbody></table>
      <p>局部观察区间：[<MathText text={String(input.taylor_details.window_lower ?? '')} />, <MathText text={String(input.taylor_details.window_upper ?? '')} />]</p>
      <p><MathText text={String(input.taylor_details.range_note ?? '')} /></p>
      <p>{input.taylor_details.error_bound !== null ? `该观察区间的误差上界：${input.taylor_details.error_bound}` : '当前没有整个观察区间的误差保证。'}</p>
    </> : null}
    {input.series_details ? <>
      <h4>数项级数敛散性判定</h4>
      <p>通项：<code><MathText text={String(input.series_details.term ?? '')} /></code>；起始项 n=<MathText text={String(input.series_details.index_start ?? '')} />。</p>
      <p role="status">判定：<MathText text={String(input.series_details.status_label ?? '')} />{input.series_details.method ? `；依据：${input.series_details.method}` : ''}</p>
      {input.series_details.sum_value ? <p>收敛时级数和：<code><MathText text={String(input.series_details.sum_value ?? '')} /></code></p> : null}
      <p><MathText text={String(input.series_details.note ?? '')} /></p>
    </> : null}
    {input.power_details ? <>
      <h4>幂级数收敛域与端点核查</h4>
      <p>目标：{input.power_details.goal === 'sum' ? '和函数（同时核验收敛域）' : '收敛半径与收敛域'}；中心 c=<MathText text={String(input.power_details.center ?? '')} />；起始项 n=<MathText text={String(input.power_details.index_start ?? '')} />；系数 a_n=<code><MathText text={String(input.power_details.coefficient ?? '')} /></code>。</p>
      {input.power_details.radius ? <p>收敛半径：R=<code><MathText text={String(input.power_details.radius ?? '')} /></code>{input.power_details.radius_method ? `；判别依据：${input.power_details.radius_method}` : ''}</p> : <p role="status">收敛半径尚未确认，不补默认半径。</p>}
      {input.power_details.interval ? <p>收敛区间：<code><MathText text={String(input.power_details.interval ?? '')} /></code></p> : <p>当前未能完整写出收敛区间（例如半径为零或待核验）。</p>}
      {input.power_details.endpoints.length ? <table><caption>端点逐点代入原级数</caption><thead><tr><th>端点</th><th>代入点</th><th>判定</th><th>是否计入收敛域</th></tr></thead><tbody>{input.power_details.endpoints.map((endpoint, index) => <tr key={index}><td><MathText text={String(endpoint.label ?? '')} /></td><td><code><MathText text={String(endpoint.point ?? '')} /></code></td><td>{endpoint.status === 'absolutely_convergent' ? '绝对收敛' : endpoint.status === 'conditionally_convergent' ? '条件收敛' : endpoint.status === 'divergent' ? '发散' : '尚未判定'}</td><td>{endpoint.included ? '计入' : '不计入'}</td></tr>)}</tbody></table> : <p>当前没有可逐点判断的有限端点；端点结论不自动并入收敛域。</p>}
      {input.power_details.sum_function ? <><p>和函数（收敛域内）：</p><p><code><MathText text={String(input.power_details.sum_function ?? '')} /></code></p></> : input.power_details.goal === 'sum' ? <p role="status">当前未能核验闭式和函数，不输出数值近似冒充答案。</p> : null}
      <p><MathText text={String(input.power_details.note ?? '')} /></p>
    </> : null}
    {input.fourier_details ? <>
      <h4>傅里叶系数与前n阶部分和</h4>
      <p>区间：[<MathText text={String(input.fourier_details.lower ?? '')} />, <MathText text={String(input.fourier_details.upper ?? '')} />]；周期 T=<MathText text={String(input.fourier_details.period ?? '')} />；展开到 n=<MathText text={String(input.fourier_details.order ?? '')} />。</p>
      <table><caption>按给定区间计算的傅里叶系数</caption><thead><tr><th>n</th><th>a_n</th><th>b_n</th></tr></thead><tbody>
        <tr><td>0</td><td><code><MathText text={String(input.fourier_details.a0 ?? '')} /></code></td><td>—</td></tr>
        {input.fourier_details.coefficients.map(c => <tr key={c.n}><td><MathText text={String(c.n ?? '')} /></td><td><code><MathText text={String(c.an ?? '')} /></code></td><td><code><MathText text={String(c.bn ?? '')} /></code></td></tr>)}
      </tbody></table>
      <p>前 <MathText text={String(input.fourier_details.order ?? '')} /> 阶部分和：<code><MathText text={String(input.fourier_details.partial ?? '')} /></code></p>
      <p>区间内间断点：{input.fourier_details.discontinuities.join('、') || '未列出'}{input.fourier_details.endpoint_jump ? '；端点在周期延拓下存在跳跃' : '；端点无跳跃'}。</p>
      <p><MathText text={String(input.fourier_details.convergence_note ?? '')} /></p>
      <p><MathText text={String(input.fourier_details.note ?? '')} /></p>
    </> : null}
    {input.study ? <>
      <h4>区间研究结果</h4>
      <p>实际定义域：{input.study.domain?.map(d => `${d.left_open ? '(' : '['}${d.from}, ${d.to}${d.right_open ? ')' : ']'}`).join(' ∪ ') || '尚未完整确认'}</p>
      <p>单调性：{input.study.monotonic?.map(i => `${i.interval} ${i.label}`).join('；') || '尚未确认'}</p>
      <p>凹凸性：{input.study.concavity?.map(i => `${i.interval} ${i.label}`).join('；') || '尚未确认'}</p>
      <p>内部极值：{input.study.extrema?.map(i => `${i.label} (${i.point}, ${i.value})`).join('；') || (status === 'complete' ? '无孤立极值点（常值区间不逐点枚举）' : '尚未确认')}</p>
      <p>拐点：{input.study.inflections?.map(i => `(${i.point}, ${i.value})`).join('；') || (status === 'complete' ? '无' : '尚未确认')}</p>
      {input.study.absolute ? <ul>{(['minimum','maximum'] as const).map(key => { const b = input.study!.absolute![key]; const title=key === 'minimum' ? '最小值' : '最大值'; const value=b.value === 'oo' ? '+∞' : b.value === '-oo' ? '-∞' : b.value; return <li key={key}>{b.attained ? `${title}：${value}，取到点（候选或代表点）：${b.points.join('、')}` : `无${title}；${key === 'minimum' ? '下确界' : '上确界'}：${value}（未取到）`}</li>; })}</ul> : null}
      <p>原区间端点核对：{input.study.endpoints?.map(e => `${e.point}：${e.included ? `计入，值为 ${e.value}` : '不计入（开端点或不在原式定义域）'}`).join('；') || '尚未确认'}</p>
      <p>内部候选点：{input.study.critical_points?.map(p => `${p.point}（值 ${p.value}）`).join('；') || '无已列出的孤立候选点'}</p>
      <p>单调、凹凸区间用开区间表示符号分段；端点是否参与最值另行核对。</p>
    </> : null}
    {input.line_geometry ? <>
      <p>已确认研究点 P(<MathText text={String(input.line_geometry.point_x ?? '')} />, <MathText text={String(input.line_geometry.point_y ?? '')} />)</p>
      <p>切线</p><Formula tex={input.line_geometry.tangent} block />
      <p>法线</p><Formula tex={input.line_geometry.normal} block />
      <p>水平或竖直方向由梯度判断；竖直直线不填写有限斜率。</p>
    </> : null}
    {input.continuity ? <>
      <table><caption>连续性核对</caption><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>
        <tr><th>函数值</th><td><MathText text={String(input.continuity.value.text ?? '')} /></td></tr><tr><th>左极限</th><td><MathText text={String(input.continuity.left.text ?? '')} /></td></tr>
        <tr><th>右极限</th><td><MathText text={String(input.continuity.right.text ?? '')} /></td></tr><tr><th>结论</th><td><MathText text={String(input.continuity.label ?? '')} /></td></tr>
      </tbody></table>
      <p>图形展示去心邻域表达式，研究点的单独定义以此表为准；当前检查双侧连续性，不将定义域边界套用为普通间断点。</p>
    </> : null}
    {verification ? <p className={`${styles.verification} ${verificationClass}`} data-verification={verification.level} aria-label={verification.label}>
      <strong><MathText text={String(verification.label ?? '')} /></strong>
      {verification.level !== 'unconfirmed' ? <span><MathText text={String(verification.detail ?? '')} /></span> : null}
    </p> : null}
    {status === 'divergent' ? <p role="status">该定积分发散，不存在有限实数结果；不把柯西主值或原函数端点差当作积分值。</p> : null}
    {status === 'unsupported' ? <>
      <p role="status">{input.task === 'proof' ? '当前证明未获得整体认证；保留已通过的义务、反例或局部步骤，不自动判分。' : input.task === 'triple_integral' ? '当前三重积分尚未完成全域核验或解析计算；保留完整区域与坐标变换，不输出数值替代答案。' : input.task === 'double_integral' ? '当前二重积分尚未完成全域核验或解析计算；保留完整区域，不输出数值替代答案。' : input.task === 'multivariable_extrema' ? '当前内核尚未完成候选全集或极值分类，不把候选表当作最终答案。' : input.task === 'continuity' ? '当前内核无法确认连续性分类，请核对实定义域与原题定义。' : input.task === 'higher_derivative' ? '当前内核未能完成该普通导数计算，请核对函数及可导范围。' : input.task === 'limit' ? '当前内核无法判定该极限；请保留原题条件并核对适用范围。' : input.task === 'derivative' ? '当前内核未能完成该点的导数计算，请核对定义域和求导点。' : input.task === 'series_convergence'
        ? '当前内核尚未判定该数项级数的敛散性；保留通项、起始项与判别记录，不猜测结论。'
        : input.task === 'power_series'
        ? '当前幂级数的收敛半径、端点或和函数尚未全部核验；保留已知部分，不补默认收敛域。'
        : input.task === 'fourier_series'
        ? '当前傅里叶系数或部分和尚未得到可核验的闭式结果；保留完整区间与已计算系数。'
        : input.task === 'antiderivative'
        ? '当前内核未能给出可核验的闭式原函数，不把符号积分形式当作原题答案。'
        : '当前内核未能给出可信的闭式结果，不把数值参考当作原题答案。'}</p>
      {approx ? <p>数值参考：≈ {approx}</p> : null}
      {input.result_note ? <p><MathText text={String(input.result_note ?? '')} /></p> : null}
    </> : null}
    {status === 'complete' ? <p role="status">{input.double_extension ? '当前展示已确认原题的专用计算结果；修改映射、密度、区域或事件后，请通过核对条件重新计算。' : input.task === 'space_geometry' ? '当前展示已确认空间对象与符号结果；空间图形为有限范围采样，用于辅助观察。' : input.task === 'curve_surface_integral' ? '当前展示已确认的曲线/曲面积分结果；曲线、曲面与边界图形为有限采样，用于辅助观察。' : input.task === 'proof' ? '当前展示已确认命题的证明证书或未认证义务；图形与抽样仅辅助观察。' : input.task === 'multivariable_extrema' ? '当前展示已确认原题的驻点与局部判定；修改目标或约束后需要重新核验。' : input.task === 'ode' && input.ode_details?.free_constants ? '当前展示解族及核验依据；未选择任意常数，不绘制单条示例轨迹。' : changed ? '当前图形为修改后的实验，以下保留原题结果。点击“恢复原题”可返回已确认条件。'
      : '当前图形对应已确认的原题；演示参数可调，数值近似与原题结果分开显示。'}</p> : null}
    <details open><summary>查看内核计算步骤</summary>
      <ol>{problem.solution.steps.map(step => <li key={step.id}>
        <strong><MathText text={String(step.title ?? '')} /></strong><p><MathText text={step.detail} /></p>
        {step.latex ? <div className={styles.formula}><Formula tex={step.latex} block /></div> : null}
      </li>)}</ol>
    </details>
    <p>步骤展示内核提供的计算摘要与核对依据；图形和数值近似用于辅助观察。</p>
  </section>;
}
