import { MathText } from './ProblemText';
import { useEffect, useState, type ReactNode } from 'react';
import {
  SUBJECT_LABELS,
  PROVENANCE_LABELS,
  type LabProblem,
  type LabSubject,
} from '@/labs/types';
import styles from './labs.module.css';
import { MathExpressionInput } from './MathExpressionInput';
import { inspectMath } from '@/labs/mathKeyboard';
import { CURVE_SURFACE_ORIENTATIONS, type CurveSurfaceIntegralKind } from '@/labs/manualInput';

export interface ReviewPayload {
  text: string;
  subject: LabSubject;
  conditionValues: Record<string, unknown>;
  ambiguityAnswers: Record<string, string>;
}

interface Props {
  open: boolean;
  problem: LabProblem;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: ReviewPayload) => void;
  previewUrl?: (key: string) => string;
}

const EDITABLE_SPECIAL = new Set(['expression', 'implicit_expression', 'lower', 'upper', 'start', 'x0', 'y0', 'learning_rate', 'iterations', 'point', 'point_y', 'side', 'h', 'n', 'epochs', 'initial_heap', 'heap_type', 'deletion_count', 'scalar', 'capacity', 'expr', 'base', 'size', 's', 't', 'window', 'initial_frames', 'processes', 'quantum', 'reference', 'frames', 'requests', 'head', 'max_track', 'allocation', 'max', 'available', 'request']);

const TEXT_CONDITION_KEYS = ['point_x', 'point_value', 'value_mode', 'side', 'expression', 'implicit_expression', 'lower', 'upper', 'point_y', 'heap_type', 'graph_edges', 'layers', 'matrix_a', 'matrix_b', 'vector_b', 'expr', 's', 't', 'initial_frames', 'processes', 'reference', 'requests', 'allocation', 'max', 'available', 'request'];

function readableConditionLabel(problem: LabProblem, condition: LabProblem['recognition']['conditions'][number]): string {
  const rawLabel = String(condition.label ?? '');
  const task = String(problem.manual_input?.task ?? problem.model.modeling_task ?? problem.model.task ?? problem.model.kind ?? '');
  if (task === 'limit' || task === 'parameter_limit') {
    if (condition.id === 'point' && rawLabel === '求导点') return '极限点（趋近点）';
    if (condition.id === 'variable' && rawLabel === '积分或求导变量') return '自变量';
  }
  if (task === 'taylor') {
    if (condition.id === 'point' && rawLabel === '求导点') return '展开点';
    if (condition.id === 'variable' && rawLabel === '积分或求导变量') return '自变量';
  }
  if (task === 'continuity') {
    if (condition.id === 'point' && rawLabel === '求导点') return '研究点';
    if (condition.id === 'variable' && rawLabel === '积分或求导变量') return '自变量';
  }
  return rawLabel;
}

function inlineExcerpt(problemText: string, excerpt?: string | null): string | null {
  if (!excerpt || !excerpt.trim()) return null;
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const cleanExcerpt = normalize(excerpt);
  const cleanProblem = normalize(problemText);
  if (!cleanExcerpt || cleanExcerpt === cleanProblem || (cleanProblem && cleanProblem.startsWith(cleanExcerpt))) {
    return null;
  }
  return excerpt
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => `$${inner.trim()}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner: string) => `$${inner.trim()}$`)
    .replace(/\s*\n+\s*/g, ' ');
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function ReviewDialog({ open, problem, busy, onClose, onSubmit, previewUrl }: Props): ReactNode {
  const [text, setText] = useState(problem.text);
  const [subject, setSubject] = useState<LabSubject>(problem.subject);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setText(problem.text);
    setSubject(problem.subject);
    const initial: Record<string, string> = {};
    for (const condition of problem.recognition.conditions) {
      if (problem.manual_input?.task === 'implicit_normal' && condition.id === 'point') continue;
      if (problem.ai_solution?.agent_understanding || EDITABLE_SPECIAL.has(condition.id) || (problem.manual_input && condition.id in problem.manual_input.conditions)) {
        initial[condition.id] = problem.ai_solution?.agent_understanding && condition.value !== null && typeof condition.value === 'object' ? JSON.stringify(condition.value) : asText(condition.id === 'expression' && !problem.ai_solution?.agent_understanding ? problem.model.expression : condition.value);
        if (condition.id === 'initial_conditions' && Array.isArray(condition.value)) initial[condition.id] = condition.value.join('\n');
      }
    }
    if (problem.subject === 'algorithm' && problem.model.engine !== 'heap_v1' && !String(problem.model.engine ?? '').startsWith('ds_')) {
      initial.graph_edges = (problem.model.edges ?? []).map((edge) => `${edge.from}-${edge.to}`).join('\n');
    }
    if (problem.subject === 'deep_learning') {
      initial.layers = (problem.model.layers ?? []).map((layer) => layer.size).join('-');
    }
    if (problem.subject === 'linear_algebra') {
      const asMatrixText = (matrix?: (number | string)[][] | null) =>
        (matrix ?? []).map((row) => `[${row.join(', ')}]`).join(', ');
      if (problem.model.matrix_a) initial.matrix_a = `[${asMatrixText(problem.model.matrix_a_exact ?? problem.model.matrix_a)}]`;
      if (problem.model.matrix_b) initial.matrix_b = `[${asMatrixText(problem.model.matrix_b)}]`;
      if (problem.model.vector_b) initial.vector_b = problem.model.vector_b.join(', ');
    }
    setValues(initial);
    setInitialValues(initial);
    setAnswers({});
  }, [open, problem]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const aiConditions = (problem.ai_solution?.proposed_model.conditions ?? {}) as Record<string, unknown>;
  const declaredVariables = aiConditions.variables;
  const aiVariables = typeof declaredVariables === 'string' ? declaredVariables.split(',').map(v => v.trim()).filter(Boolean)
    : Array.isArray(declaredVariables) && declaredVariables.every(v => typeof v === 'string') ? declaredVariables as string[] : undefined;
  const variables = aiVariables ?? problem.model.variables ?? (problem.manual_input?.task === 'curve_surface_integral' || problem.model.task === 'space_geometry'
    ? ['x', 'y', 'z'] : problem.model.task === 'implicit_normal' ? ['x', 'y'] : [problem.model.variable ?? 'x']);
  const invalidExpression = ['expression', 'implicit_expression', 'integrand', 'surface'].some((key) => {
    if (!(key in values) || !(text.trim() === problem.text.trim() || values[key] !== initialValues[key])) return false;
    const raw = values[key] ?? '';
    if ((problem.model.task === 'space_geometry' && (key === 'expression' || key === 'surface'))
      || (problem.manual_input?.task === 'implicit_normal' && key === 'implicit_expression')) {
      const parts = raw.split('=');
      if (parts.length > 2 || parts.some(part => !part.trim())) return true;
      return parts.some(part => !!inspectMath(part, variables).error);
    }
    return !!inspectMath(raw, variables).error;
  });
  const missingPointValue = problem.manual_input?.task === 'continuity' && values.value_mode === 'value' && !values.point_value?.trim();
  const missingManualCondition = missingPointValue || !!problem.manual_input &&
    Object.keys(problem.manual_input.conditions).some(key => key !== 'initial_conditions' && !(key === 'point' && problem.manual_input?.task === 'multivariable' && problem.manual_input.conditions.operation !== 'directional') && !(key === 'point_value' && values.value_mode !== 'value') && key in values && !values[key]?.trim());

  const submit = (): void => {
    if (invalidExpression || missingManualCondition) return;
    const conditionValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (problem.manual_input?.task === 'multivariable' && key === 'point') {conditionValues[key]=value.trim();continue;}
      if (problem.manual_input?.task === 'ode' && key === 'initial_conditions') {conditionValues[key]=value.trim();continue;}
      if (!value.trim()) continue;
      if (problem.ai_solution?.agent_understanding) {
        if (value !== initialValues[key]) conditionValues[key] = value;
        continue;
      }
      if (problem.manual_input?.task === 'continuity' && key === 'point_value' && values.value_mode !== 'value') continue;
      if (problem.manual_input && key in problem.manual_input.conditions) { conditionValues[key] = value.trim(); continue; }
      if (problem.ai_solution?.agent_understanding && value === initialValues[key]) continue;
      // A corrected question must not be overwritten by old, unchanged fields.
      if (text.trim() !== problem.text.trim() && value === initialValues[key]) continue;
      if (key === 'initial_heap') {
        const tokens = value.replace(/[\[\]]/g, '').split(/[,，、\s]+/).filter(Boolean);
        conditionValues[key] = tokens.every((token) => Number.isFinite(Number(token))) ? tokens.map(Number) : value;
      } else if (TEXT_CONDITION_KEYS.includes(key)) {
        conditionValues[key] = value.trim();
      } else if (key === 'start') {
        conditionValues[key] = value.trim();
      } else {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) conditionValues[key] = parsed;
      }
    }
    const ambiguityAnswers: Record<string, string> = {};
    for (const item of problem.recognition.ambiguities) {
      const typed = answers[`custom:${item.id}`];
      const selected = answers[item.id];
      const final = typed?.trim() || selected?.trim();
      if (final) ambiguityAnswers[item.id] = final;
    }
    onSubmit({ text, subject, conditionValues, ambiguityAnswers });
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles.reviewDialog} role="dialog" aria-modal="true" aria-labelledby="lab-review-title">
        <header className={styles.modalHead}>
          <div>
            <span className={styles.eyebrow}>CONDITION REVIEW</span>
            <h2 id="lab-review-title">核对与修正条件</h2>
            <p>识别结果不是黑箱：关键符号、区间、初始点与数据都在这里确认；重新编译后才用于求解。</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </header>

        <div className={styles.reviewBody}>
          <section className={styles.reviewSection}>
            <h3>题目与类型</h3>
            {previewUrl && problem.source_pages.some((page) => page.image_key) ? (
              <details open={problem.recognition.ambiguities.some((item) => item.id === 'source_formula_confirmation' && !item.resolved)}>
                <summary>对照原稿核对公式</summary>
                {problem.source_pages.filter((page) => page.image_key).map((page) => (
                  <img key={`${page.file_id}-${page.page}`} src={previewUrl(page.image_key!)}
                    alt={`第 ${page.page} 页题目原稿`} style={{ width: '100%', height: 'auto', marginTop: 12 }} />
                ))}
              </details>
            ) : null}
            <label className={styles.formField}>
              <span>题目文字</span>
              <textarea value={text} rows={7} readOnly={!!problem.manual_input} onChange={(event) => setText(event.target.value)} />
              {problem.manual_input ? <small>题目由已确认的字段生成；请修改下方公式与计算条件，再确认并重新求解。</small> : null}
            </label>
            <label className={styles.formField}>
              <span>题目类型</span>
              <select value={subject} disabled={!!problem.manual_input} onChange={(event) => setSubject(event.target.value as LabSubject)}>
                <option value="unknown">自动判断（待确认）</option>
                {(Object.keys(SUBJECT_LABELS) as LabSubject[])
                  .filter((item) => item !== 'unknown')
                  .map((item) => (
                    <option key={item} value={item}>
                      {SUBJECT_LABELS[item]}
                    </option>
                  ))}
              </select>
            </label>
          </section>

          <section className={styles.reviewSection}>
            <h3>条件与数据</h3>
            <div className={styles.reviewGrid}>
              {problem.recognition.conditions
                .filter((condition) => (!!problem.ai_solution?.agent_understanding || EDITABLE_SPECIAL.has(condition.id) || (problem.subject === 'physics' && condition.id.startsWith('phy_')) || !!problem.manual_input && condition.id in problem.manual_input.conditions) && condition.editable !== false && !(condition.id === 'point_value' && values.value_mode !== 'value'))
                .map((condition) => condition.id === 'direction_limit' && problem.manual_input?.task === 'multivariable' ? (<label key={condition.id} className={styles.formField}>方向导数约定<select aria-label="方向导数约定" value={values.direction_limit ?? 'forward'} onChange={e=>setValues(current=>({...current,direction_limit:e.target.value}))}><option value="forward">正向单侧 h→0+</option><option value="two_sided">双侧 h→0</option></select></label>) : condition.id === 'independent_variable' && problem.manual_input?.task === 'ode' ? (<label key={condition.id} className={styles.formField}>自变量<select aria-label="自变量" value={values.independent_variable ?? 'x'} onChange={e=>setValues(current=>({...current,independent_variable:e.target.value}))}><option value="x">x</option><option value="t">t</option></select></label>) : condition.id === 'pieces_text' ? (<label key={condition.id} className={styles.formFieldWide}><MathText text={String(condition.label ?? '')} /><textarea aria-label={condition.label} rows={5} value={values.pieces_text ?? ''} onChange={e=>setValues(current=>({...current,pieces_text:e.target.value}))} /></label>) : condition.id === 'initial_conditions' && (problem.manual_input?.task === 'ode' || problem.model.modeling_task === 'ode') ? (<label key={condition.id} className={styles.formFieldWide}>初值条件（每行一条，留空求解族）<textarea aria-label="初值条件" rows={3} value={values.initial_conditions ?? ''} onChange={e=>setValues(current=>({...current,initial_conditions:e.target.value}))} /></label>) : condition.id === 'region_kind' ? (<label key={condition.id} className={styles.formField}>区域定义<select aria-label="区域定义" value={values.region_kind ?? ''} onChange={e=>setValues(current=>({...current,region_kind:e.target.value}))}><option value="between_axis">曲线与x轴之间（包含负函数区域）</option><option value="vertical_inequality">0≤y≤f(x)（负值处为空）</option><option value="between_curves">两条曲线之间（上下边界）</option></select></label>) : condition.id === 'rotation_axis' ? (<label key={condition.id} className={styles.formField}>旋转轴<select aria-label="旋转轴" value={values.rotation_axis ?? ''} onChange={e=>setValues(current=>({...current,rotation_axis:e.target.value}))}><option value="x">x轴（圆盘/圆环法）</option><option value="y">y轴（壳层法）</option></select></label>) : condition.id === 'interval_type' ? (<label key={condition.id} className={styles.formField}>区间端点<select aria-label="区间端点" value={values.interval_type ?? 'closed'} onChange={e => setValues(current => ({...current,interval_type:e.target.value}))}><option value="closed">闭区间 [a,b]</option><option value="open">开区间 (a,b)</option><option value="left_open">左开右闭 (a,b]</option><option value="right_open">左闭右开 [a,b)</option></select></label>) : condition.id === 'value_mode' ? (
                  <label key={condition.id} className={styles.formField}>该点函数值的定义
                    <select aria-label="该点函数值的定义" value={values.value_mode ?? 'expression'} onChange={e => setValues(current => ({ ...current, value_mode: e.target.value }))}>
                      <option value="expression">按原式取值</option><option value="undefined">该点未定义</option><option value="value">题目另给单点值</option>
                    </select>
                  </label>
                ) : condition.id === 'orientation' && problem.manual_input?.task === 'curve_surface_integral' ? (
                  <label key={condition.id} className={styles.formField}>定向
                    <select aria-label="定向" value={values.orientation ?? ''} onChange={e => setValues(current => ({ ...current, orientation: e.target.value }))}>
                      {(CURVE_SURFACE_ORIENTATIONS[problem.manual_input.conditions.integral_kind as CurveSurfaceIntegralKind] ?? []).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                ) : condition.id === 'steps' && problem.manual_input?.task === 'proof' ? (
                  <label key={condition.id} className={styles.formFieldWide}>证明步骤（每行一个等式）
                    <textarea aria-label="证明步骤" rows={5} value={values.steps ?? ''} onChange={e => setValues(current => ({ ...current, steps: e.target.value }))} />
                  </label>
                ) : condition.id === 'statement' && problem.manual_input?.task === 'proof' ? (
                  <label key={condition.id} className={styles.formFieldWide}>命题陈述（可选）
                    <textarea aria-label="命题陈述" rows={2} value={values.statement ?? ''} onChange={e => setValues(current => ({ ...current, statement: e.target.value }))} />
                  </label>
                ) : condition.id === 'relation' && problem.manual_input?.task === 'proof' ? (
                  <label key={condition.id} className={styles.formField}>关系符号
                    <select aria-label="证明关系符号" value={values.relation ?? '>='} onChange={e => setValues(current => ({ ...current, relation: e.target.value }))}>
                      <option value=">=">&gt;=</option><option value="<=">&lt;=</option>
                      {(problem.manual_input.conditions.proof_kind === 'counterexample') ? <><option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option></> : null}
                    </select>
                  </label>
                ) : condition.id === 'side' ? (
                  <label key={condition.id} className={styles.formField}>
                    <span>
                      <MathText text={readableConditionLabel(problem, condition)} />
                      <small>{PROVENANCE_LABELS[condition.provenance]}</small>
                    </span>
                    <select
                      aria-label={condition.label}
                      value={values.side ?? 'both'}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, side: event.target.value }))
                      }
                    >
                      <option value="both">双侧极限 (x → x₀)</option>
                      <option value="left">左极限 (x → x₀⁻)</option>
                      <option value="right">右极限 (x → x₀⁺)</option>
                    </select>
                  </label>
                ) : ['expression', 'lower_expression', 'implicit_expression', 'integrand', 'surface'].includes(condition.id) ? (
                  <div key={condition.id} className={styles.formFieldWide}>
                    <MathExpressionInput
                      label={readableConditionLabel(problem, condition)}
                      value={values[condition.id] ?? ''}
                      variables={variables}
                      answerMode={(problem.model.task === 'space_geometry' && (condition.id === 'expression' || condition.id === 'surface')) || (problem.manual_input?.task === 'implicit_normal' && condition.id === 'implicit_expression')}
                      disabled={busy}
                      provenance={PROVENANCE_LABELS[condition.provenance]}
                      describedBy={problem.subject === 'calculus' ? 'lab-expression-help' : undefined}
                      onChange={(value) => setValues((current) => ({ ...current, [condition.id]: value }))}
                    />
                    {inlineExcerpt(text, condition.source.excerpt) ? <em><MathText text={inlineExcerpt(text, condition.source.excerpt)!} /></em> : null}
                  </div>
                ) : (
                  <label key={condition.id} className={styles.formField}>
                    <span>
                      <MathText text={readableConditionLabel(problem, condition)} />
                      <small>{PROVENANCE_LABELS[condition.provenance]}</small>
                    </span>
                    <input
                      aria-label={condition.label}
                      value={values[condition.id] ?? ''}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [condition.id]: event.target.value }))
                      }
                      inputMode={condition.kind === 'number' ? 'decimal' : 'text'}
                      aria-describedby={
                        condition.id === 'expression' && problem.subject === 'calculus'
                          ? 'lab-expression-help'
                          : undefined
                      }
                    />
                    {inlineExcerpt(text, condition.source.excerpt) ? <em><MathText text={inlineExcerpt(text, condition.source.excerpt)!} /></em> : null}
                  </label>
                ))}
              {problem.manual_input?.task === 'multivariable' && !('point' in problem.manual_input.conditions) ? <label className={styles.formField}>求值点（可选）<input aria-label="求值点" value={values.point ?? ''} onChange={e=>setValues(current=>({...current,point:e.target.value}))} placeholder="按已确认的变量顺序，如1,2" /></label> : null}
              {problem.manual_input?.task === 'continuity' && values.value_mode === 'value' && !problem.recognition.conditions.some(c => c.id === 'point_value') ? <label className={styles.formField}>单点函数值<input aria-label="单点函数值" value={values.point_value ?? ''} onChange={e => setValues(current => ({ ...current, point_value: e.target.value }))} /></label> : null}
              {problem.subject === 'algorithm' && problem.model.engine !== 'heap_v1' && !String(problem.model.engine ?? '').startsWith('ds_') ? (
                <label className={styles.formFieldWide}>
                  <span>图的边（每行一条；有向图用 →）</span>
                  <textarea
                    rows={5}
                    value={values.graph_edges ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, graph_edges: event.target.value }))}
                    spellCheck={false}
                  />
                </label>
              ) : null}
              {problem.subject === 'deep_learning' ? (
                <label className={styles.formField}>
                  <span>网络结构（例如 2-3-1）</span>
                  <input
                    value={values.layers ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, layers: event.target.value }))}
                  />
                </label>
              ) : null}
              {problem.subject === 'linear_algebra' ? (
                <>
                  <label className={styles.formFieldWide}>
                    <span>矩阵 A（[[1,2],[3,4]] 或 [1 2; 3 4]）</span>
                    <textarea
                      rows={3}
                      value={values.matrix_a ?? ''}
                      onChange={(event) => setValues((current) => ({ ...current, matrix_a: event.target.value }))}
                      spellCheck={false}
                    />
                  </label>
                  {problem.model.la_kind === 'matmul' ? (
                    <label className={styles.formFieldWide}>
                      <span>矩阵 B</span>
                      <textarea
                        rows={3}
                        value={values.matrix_b ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, matrix_b: event.target.value }))}
                        spellCheck={false}
                      />
                    </label>
                  ) : null}
                  {problem.model.la_kind === 'linear_system' ? (
                    <label className={styles.formField}>
                      <span>右端向量 b（逗号分隔）</span>
                      <input
                        value={values.vector_b ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, vector_b: event.target.value }))}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
            {problem.subject === 'calculus' ? (
              <div className={styles.formulaGuide} id="lab-expression-help">
                <strong>用数学键盘核对函数</strong>
                <p>
                  点击分式、幂、根号或函数按钮，再输入括号内的内容，并对照公式预览核对。
                  例如输入 <code>x × arctan(x)</code>，可依次点击「x」「×」「arctan」「x」。
                </p>
                <p>
                  「被积函数」只填积分号里面的表达式，上下限分别填在下方输入框。上限写 <code>+∞</code>{' '}
                  时，图像会自动用有限区间截断展示，解析值仍按无穷积分计算。
                </p>
                {problem.model.modeling_task === 'parameter_limit' ? (
                  <p>
                    含参极限可写成 <code>lim_{'{x->0}'} ((1+a*x^2)^sin(x)-1)/x^3 = 6</code>；
                    内核会先算含参极限，再解出参数并代回原式核验。请重点核对系数、指数和极限值。
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className={styles.reviewSection}>
            <h3>需要确认的问题</h3>
            {problem.recognition.ambiguities.length ? (
              <div className={styles.ambiguityList}>
                {problem.recognition.ambiguities.map((item) => (
                  <div key={item.id} className={styles.ambiguityCard} data-severity={item.severity}>
                    <strong><MathText text={String(item.question ?? '')} /></strong>
                    <div className={styles.ambiguityOptions}>
                      {item.options.map((option, optionIndex) => (
                        <label key={`${option.value}-${optionIndex}`}>
                          <input
                            type="radio"
                            name={`ambiguity-${item.id}`}
                            value={option.value}
                            checked={answers[item.id] === option.value}
                            onChange={() => setAnswers((current) => ({ ...current, [item.id]: option.value }))}
                          />
                          <MathText text={option.label} />
                        </label>
                      ))}
                    </div>
                    <input
                      className={styles.customAnswer}
                      placeholder="或输入修正值 / 表达式"
                      value={answers[`custom:${item.id}`] ?? ''}
                      onChange={(event) =>
                        setAnswers((current) => ({ ...current, [`custom:${item.id}`]: event.target.value }))
                      }
                    />
                    {item.resolved && item.answer ? <small>当前答案：<MathText text={String(item.answer ?? '')} /></small> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.smallNote}>没有发现歧义。修改上面的条件后保存即可重新编译。</p>
            )}
          </section>
        </div>

        <footer className={styles.modalFooter}>
          <span>重新编译会按新条件重算解答与轨迹；笔记和尝试记录保留。</span>
          <div>
            <button type="button" className={styles.textButton} onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="button" className={styles.primaryButton} onClick={submit} disabled={busy || invalidExpression || missingManualCondition}>
              {busy ? '正在重新求解…' : '确认并重新求解'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default ReviewDialog;
