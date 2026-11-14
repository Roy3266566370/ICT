import type { LabProblem } from '@/labs/types';
import { Formula } from '@/components/showcase/Formula';
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
  const formula = status === 'complete' && !input.double_extension && !['limit', 'continuity', 'implicit_normal', 'function_study', 'taylor', 'geometric_area', 'rotation_volume', 'ode', 'multivariable', 'multivariable_extrema'].includes(input.task) && input.result_latex
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
      <p>先对{input.double_details.inner_variable}积分，再对{input.double_details.outer_variable}积分。</p>
      {input.double_details.region_description ? <p>{input.double_details.region_description}</p> : <p>完整区域：{input.double_details.outer_bounds[0]} ≤ {input.double_details.outer_variable} ≤ {input.double_details.outer_bounds[1]}；{input.double_details.inner_bounds[0]} ≤ {input.double_details.inner_variable} ≤ {input.double_details.inner_bounds[1]}。</p>}
      {input.double_details.region_kind==='improper' ? <p>矩形边界已核对；各方向的实定义域与绝对收敛分别检查，详见下方过程。不使用有限截断黎曼和。</p> : <p>全区间边界关系：{input.double_details.region_verified ? '已核验' : '未确认'}；原被积函数连续实定义：{input.double_details.continuous_verified ? '已确认的充分条件通过' : '尚未确认，不能由抽样通过推定'}。</p>}
      {input.double_details.zero_area ? <p>内层上下边界处处相等，区域为零面积；保留全部边界条件。</p> : null}
      {status === 'complete' && input.double_details.inner_integral_latex ? <><p>完成内层积分后，以下表达式再按外层区间积分：</p><Formula tex={input.double_details.inner_integral_latex} block /></> : null}
      <p>{input.double_details.note}</p>
      {swapped.length ? <section aria-label="换序后的全部分段">
        <h4>换序结果 · {swapped.length} 段</h4>
        {swapped.every(part=>part.region_verified) ? <>
          <p>以下全部分段相加才是原积分。同一外层区间出现多段时，分别表示不同的内层区间；区域覆盖、总面积及积分值已核验。</p>
          <ol>{swapped.map((part,index)=><li key={index}>
            <p>第 {index+1} 段：{part.outer_bounds[0]} ≤ {part.outer_variable} ≤ {part.outer_bounds[1]}；{part.inner_bounds[0]} ≤ {part.inner_variable} ≤ {part.inner_bounds[1]}。</p>
            <div className={styles.formula}><Formula tex={part.formula_tex} block /></div>
            <p>本段积分值：{part.exact}</p>
          </li>)}</ol>
        </> : <p>此存档缺少区域等价核验记录，请通过“核对识别条件”重新计算换序结果。</p>}
      </section> : null}
      <p>阴影与切片使用内核确认的同一组边界；分割数只影响中点和近似，不改变原题积分限和精确值。</p>
    </> : null}
    {input.extrema_details ? <>
      <h4>驻点、极值判定与约束核查</h4>
      <p>变量顺序：x、y；{input.extrema_details.constraint ? `完整等式约束：${input.extrema_details.constraint}` : '无额外约束，研究整个实平面上的局部极值'}</p>
      <p>候选全集：{input.extrema_details.stationary_complete ? '已确认' : '尚未确认，不能排除其他候选'}；分类：{input.extrema_details.classification_complete ? '全部完成' : '尚未全部完成'}</p>
      {input.extrema_details.singular_complete !== null ? <p>奇异约束点检查：{input.extrema_details.singular_complete ? '集合已核对' : '尚未确认完整，不能只依赖乘数方程'}</p> : null}
      {input.extrema_details.candidates.length ? <table><caption>已核验的驻点与候选</caption><thead><tr><th>点与函数值</th><th>类型与判定</th><th>核验依据</th></tr></thead><tbody>{input.extrema_details.candidates.map((p,i)=><tr key={i}>
        <td>({p.point.join(', ')})；f={p.value}{p.multiplier !== null ? `；λ=${p.multiplier}` : ''}</td>
        <td>{p.kind === 'singular' ? '奇异约束点：' : ''}{{minimum:'局部极小值',maximum:'局部极大值',saddle:'鞍点',undetermined:'尚未判定'}[p.classification]}</td>
        <td>{p.evidence}；方程代回{p.residual_verified ? '通过' : '尚未确认'}{p.constraint_verified !== null ? `；约束代回${p.constraint_verified ? '通过' : '尚未确认'}` : ''}</td>
      </tr>)}</tbody></table> : <p>{status === 'complete' ? '已确认无驻点，光滑可行域中不存在局部极值。' : '无已列出的有限候选，不能据此认定无极值。'}</p>}
      {status === 'complete' && input.extrema_details.result_latex ? <Formula tex={input.extrema_details.result_latex} block /> : null}
      {status !== 'complete' ? <p>尚未完成判定不等于极值不存在；保留已验证的候选和原题条件。</p> : null}
      <p>{input.extrema_details.scope_note}</p>
    </> : null}
    {['limit', 'higher_derivative', 'continuity', 'function_study'].includes(input.task) ? <p role="status"><MathText text={input.result_answer ?? input.result_note ?? ''} /></p> : null}
    {input.multi_details ? <>
      <h4>多元微分结果与适用条件</h4>
      <p>变量顺序：{input.multi_details.variables.join('、')}；{input.multi_details.point ? `求值点：(${input.multi_details.point.join(', ')})` : '未指定点，给出条件适用的符号公式'}</p>
      {status === 'complete' && input.multi_details.result_latex ? <Formula tex={input.multi_details.result_latex} block /> : null}
      <p>可微性核对：{input.multi_details.differentiability === 'sufficient_c1' ? '该点光滑充分条件已确认' : input.multi_details.differentiability === 'conditional' ? '符号公式在所列光滑充分条件内成立' : '当前未确认可微；不能仅由偏导存在推断全微分成立'}</p>
      {input.multi_details.partials.length ? <table><caption>偏导核对</caption><thead><tr><th>变量</th><th>{input.multi_details.point ? '定义核对的偏导值' : '偏导表达式'}</th></tr></thead><tbody>{input.multi_details.partials.map(p=><tr key={p.variable}><td>{p.variable}</td><td><Formula tex={input.multi_details!.point ? p.value ?? '' : p.latex} /></td></tr>)}</tbody></table> : null}
      {input.multi_details.smooth_conditions.length ? <><p>以下为光滑充分条件，不表示条件以外必不可微：</p>{input.multi_details.smooth_conditions.map((c,i)=><Formula key={i} tex={c} block />)}</> : null}
      {input.multi_details.direction ? <>
        <p>原方向向量：({input.multi_details.direction.raw.join(', ')})；长度：{input.multi_details.direction.norm}；单位方向：({input.multi_details.direction.unit.join(', ')})</p>
        <p>约定：{input.multi_details.direction.convention === 'forward' ? '正向单侧 h→0+' : '双侧 h→0'}；计算依据：{input.multi_details.method === 'gradient' ? '可微充分条件通过，定义极限与梯度内积核对一致' : '沿已确认单位方向直接按定义求极限，不套用梯度内积'}</p>
      </> : null}
      <p>{input.multi_details.note}</p>
    </> : null}
    {input.ode_details ? <>
      <h4>微分方程解与核验</h4>
      <p>方程阶数：{input.ode_details.ode_order ?? '未确认'}；识别类型：{input.ode_details.ode_hints?.join('、') || '尚未确认'}</p>
      {status === 'complete' && input.ode_details.solution_latex ? <Formula tex={input.ode_details.solution_latex} block /> : null}
      <p>原题条件：{input.ode_details.initial_conditions?.join('；') || '未给条件，不补初值'}</p>
      <p>{status !== 'complete' ? '解尚未完成核验，不能据此判断唯一性。' : input.ode_details.free_constants ? '结果仍含任意常数，是解族；未指定常数时不绘制任意示例轨迹。' : '结果不含任意常数；这本身不构成唯一性证明。'}</p>
      <p>方程残差核验：{input.ode_details.residual_verified === true ? '通过' : '未确认'}；条件核验：{!input.ode_details.initial_conditions?.length ? '未给条件，不适用' : input.ode_details.initial_conditions_verified === true ? '通过' : '未确认'}</p>
      <p>已核对的实解区间：{input.ode_details.solution_domain || '未统一确定，任意常数需满足原式定义条件'}</p>
      <p>{input.ode_details.scope_note}</p>
    </> : null}
    {input.geometry_details ? <>
      <h4>已确认区域与计算结果</h4>
      <p>{input.geometry_details.region_kind === 'between_axis' ? '区域包含曲线与x轴之间的正、负函数部分；面积逐段取绝对值，不做正负抵消。' : '区域严格为0≤y≤f(x)；f(x)<0处没有区域，不将其补成曲线与x轴之间的部分。'}</p>
      {input.task === 'rotation_volume' ? <p>旋转轴：{input.geometry_details.rotation_axis}轴；半径为到x轴的距离，圆盘截面积为πf(x)²。</p> : null}
      {input.geometry_details.quantities.map(q => <div key={q.id}><p>{q.label}精确值</p><Formula tex={`${q.id === 'area' ? 'S' : 'V'}=${q.latex}`} block /></div>)}
      <p>区间内部零点：{input.geometry_details.zero_points.join('、') || '无已列出的孤立零点'}</p>
      {input.geometry_details.effective_intervals ? <p>非空分段：{input.geometry_details.effective_intervals.map(p => `[${p.join(', ')}]`).join(' ∪ ') || '无正宽度分段（可能只剩零点），面积与体积为0'}</p> : null}
      <p>画布中的矩形或圆盘数值为近似观察，原题结果由解析积分给出。</p>
    </> : null}
    {input.taylor_details ? <>
      <h4>精确展开式与余项</h4><Formula tex={input.taylor_details.relation_latex} block />
      <p>在 {problem.model.variable ?? 'x'}={input.taylor_details.point} 处展开到 {input.taylor_details.order} 阶；余项类型：{input.taylor_details.remainder_kind === 'exact' ? '余项为零' : input.taylor_details.remainder_kind === 'little_o' ? 'Peano 小 o 余项' : '经核验的大 O 余项'}。</p>
      <table><caption>精确展开系数</caption><thead><tr><th>阶数 k</th><th>系数 c_k</th></tr></thead><tbody>{input.taylor_details.coefficients.map(c => <tr key={c.order}><td>{c.order}</td><td><Formula tex={c.latex} /></td></tr>)}</tbody></table>
      <p>局部观察区间：[{input.taylor_details.window_lower}, {input.taylor_details.window_upper}]</p>
      <p>{input.taylor_details.range_note}</p>
      <p>{input.taylor_details.error_bound !== null ? `该观察区间的误差上界：${input.taylor_details.error_bound}` : '当前没有整个观察区间的误差保证。'}</p>
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
      <p>已确认研究点 P({input.line_geometry.point_x}, {input.line_geometry.point_y})</p>
      <p>切线</p><Formula tex={input.line_geometry.tangent} block />
      <p>法线</p><Formula tex={input.line_geometry.normal} block />
      <p>水平或竖直方向由梯度判断；竖直直线不填写有限斜率。</p>
    </> : null}
    {input.continuity ? <>
      <table><caption>连续性核对</caption><thead><tr><th>项目</th><th>结果</th></tr></thead><tbody>
        <tr><th>函数值</th><td>{input.continuity.value.text}</td></tr><tr><th>左极限</th><td>{input.continuity.left.text}</td></tr>
        <tr><th>右极限</th><td>{input.continuity.right.text}</td></tr><tr><th>结论</th><td>{input.continuity.label}</td></tr>
      </tbody></table>
      <p>图形展示去心邻域表达式，研究点的单独定义以此表为准；当前检查双侧连续性，不将定义域边界套用为普通间断点。</p>
    </> : null}
    {verification ? <p className={`${styles.verification} ${verificationClass}`} data-verification={verification.level} aria-label={verification.label}>
      <strong>{verification.label}</strong>
      {verification.level !== 'unconfirmed' ? <span>{verification.detail}</span> : null}
    </p> : null}
    {status === 'divergent' ? <p role="status">该定积分发散，不存在有限实数结果；不把柯西主值或原函数端点差当作积分值。</p> : null}
    {status === 'unsupported' ? <>
      <p role="status">{input.task === 'double_integral' ? '当前二重积分尚未完成全域核验或解析计算；保留完整区域，不输出数值替代答案。' : input.task === 'multivariable_extrema' ? '当前内核尚未完成候选全集或极值分类，不把候选表当作最终答案。' : input.task === 'continuity' ? '当前内核无法确认连续性分类，请核对实定义域与原题定义。' : input.task === 'higher_derivative' ? '当前内核未能完成该普通导数计算，请核对函数及可导范围。' : input.task === 'limit' ? '当前内核无法判定该极限；请保留原题条件并核对适用范围。' : input.task === 'derivative' ? '当前内核未能完成该点的导数计算，请核对定义域和求导点。' : input.task === 'antiderivative'
        ? '当前内核未能给出可核验的闭式原函数，不把符号积分形式当作原题答案。'
        : '当前内核未能给出可信的闭式结果，不把数值参考当作原题答案。'}</p>
      {approx ? <p>数值参考：≈ {approx}</p> : null}
      {input.result_note ? <p>{input.result_note}</p> : null}
    </> : null}
    {status === 'complete' ? <p role="status">{input.double_extension ? '当前展示已确认原题的专用计算结果；修改映射、密度、区域或事件后，请通过核对条件重新计算。' : input.task === 'multivariable_extrema' ? '当前展示已确认原题的驻点与局部判定；修改目标或约束后需要重新核验。' : input.task === 'ode' && input.ode_details?.free_constants ? '当前展示解族及核验依据；未选择任意常数，不绘制单条示例轨迹。' : changed ? '当前图形为修改后的实验，以下保留原题结果。点击“恢复原题”可返回已确认条件。'
      : '当前图形对应已确认的原题；演示参数可调，数值近似与原题结果分开显示。'}</p> : null}
    <details open><summary>查看内核计算步骤</summary>
      <ol>{problem.solution.steps.map(step => <li key={step.id}>
        <strong>{step.title}</strong><p><MathText text={step.detail} /></p>
        {step.latex ? <div className={styles.formula}><Formula tex={step.latex} block /></div> : null}
      </li>)}</ol>
    </details>
    <p>步骤展示内核提供的计算摘要与核对依据；图形和数值近似用于辅助观察。</p>
  </section>;
}
