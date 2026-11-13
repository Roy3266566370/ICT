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

const EDITABLE_SPECIAL = new Set(['expression', 'implicit_expression', 'lower', 'upper', 'start', 'x0', 'y0', 'learning_rate', 'iterations', 'point', 'point_y', 'h', 'n', 'epochs', 'initial_heap', 'heap_type', 'deletion_count', 'scalar', 'processes', 'quantum', 'reference', 'frames', 'requests', 'head', 'max_track', 'allocation', 'max', 'available', 'request']);

const TEXT_CONDITION_KEYS = ['expression', 'implicit_expression', 'lower', 'upper', 'point_y', 'heap_type', 'graph_edges', 'layers', 'matrix_a', 'matrix_b', 'vector_b', 'processes', 'reference', 'requests', 'allocation', 'max', 'available', 'request'];

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
      if (EDITABLE_SPECIAL.has(condition.id)) {
        initial[condition.id] = asText(condition.id === 'expression' ? problem.model.expression : condition.value);
      }
    }
    if (problem.subject === 'algorithm' && problem.model.engine !== 'heap_v1') {
      initial.graph_edges = (problem.model.edges ?? []).map((edge) => `${edge.from}-${edge.to}`).join('\n');
    }
    if (problem.subject === 'deep_learning') {
      initial.layers = (problem.model.layers ?? []).map((layer) => layer.size).join('-');
    }
    if (problem.subject === 'linear_algebra') {
      const asMatrixText = (matrix?: number[][] | null) =>
        (matrix ?? []).map((row) => `[${row.join(', ')}]`).join(', ');
      if (problem.model.matrix_a) initial.matrix_a = `[${asMatrixText(problem.model.matrix_a)}]`;
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

  const variables = problem.model.variables ?? (problem.model.task === 'implicit_normal'
    ? ['x', 'y'] : [problem.model.variable ?? 'x']);
  const invalidExpression = ['expression', 'implicit_expression'].some((key) =>
    key in values && (text.trim() === problem.text.trim() || values[key] !== initialValues[key])
    && !!inspectMath(values[key] ?? '', variables).error);
  const missingManualCondition = !!problem.manual_input &&
    Object.keys(problem.manual_input.conditions).some(key => key in values && !values[key]?.trim());

  const submit = (): void => {
    if (invalidExpression || missingManualCondition) return;
    const conditionValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!value.trim()) continue;
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
              {problem.manual_input ? <small>题目由已确认的字段生成；请修改下方公式与积分条件，再确认并重新求解。</small> : null}
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
                .filter((condition) => EDITABLE_SPECIAL.has(condition.id) && condition.editable !== false)
                .map((condition) => ['expression', 'implicit_expression'].includes(condition.id) ? (
                  <div key={condition.id} className={styles.formFieldWide}>
                    <MathExpressionInput
                      label={condition.label}
                      value={values[condition.id] ?? ''}
                      variables={variables}
                      disabled={busy}
                      provenance={PROVENANCE_LABELS[condition.provenance]}
                      describedBy={problem.subject === 'calculus' ? 'lab-expression-help' : undefined}
                      onChange={(value) => setValues((current) => ({ ...current, [condition.id]: value }))}
                    />
                    {condition.source.excerpt ? <em>{condition.source.excerpt.slice(0, 80)}</em> : null}
                  </div>
                ) : (
                  <label key={condition.id} className={styles.formField}>
                    <span>
                      {condition.label}
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
                    {condition.source.excerpt ? <em>{condition.source.excerpt.slice(0, 80)}</em> : null}
                  </label>
                ))}
              {problem.subject === 'algorithm' && problem.model.engine !== 'heap_v1' ? (
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
              </div>
            ) : null}
          </section>

          <section className={styles.reviewSection}>
            <h3>需要确认的问题</h3>
            {problem.recognition.ambiguities.length ? (
              <div className={styles.ambiguityList}>
                {problem.recognition.ambiguities.map((item) => (
                  <div key={item.id} className={styles.ambiguityCard} data-severity={item.severity}>
                    <strong>{item.question}</strong>
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
                          {option.label}
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
                    {item.resolved && item.answer ? <small>当前答案：{item.answer}</small> : null}
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
