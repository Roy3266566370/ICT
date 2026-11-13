import { useEffect, useState } from 'react';
import type { CanonicalValue, InteractionOption, InteractionPlan, PlanParameter } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

export type ParameterOverride =
  | CanonicalValue
  | { value: CanonicalValue; min?: number | null; max?: number | null; step?: number | null };

function isOverrideObject(raw: ParameterOverride | undefined): raw is { value: CanonicalValue; min?: number | null; max?: number | null; step?: number | null } {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'value' in raw;
}

function parseList(raw: string): number[] | null {
  const parts = raw.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return null;
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function parseMatrix(raw: string): number[][] | null {
  const rows = raw.split(/[;；\n]+/).map((item) => item.trim()).filter(Boolean);
  if (!rows.length) return null;
  const matrix: number[][] = [];
  for (const row of rows) {
    const values = row.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean).map(Number);
    if (!values.length || !values.every(Number.isFinite)) return null;
    matrix.push(values);
  }
  return matrix.every((row) => row.length === matrix[0]!.length) ? matrix : null;
}

function ArrayEditor({ option, parameter, overrides, onOverride }: {
  option: InteractionOption;
  parameter: PlanParameter;
  overrides: Props['overrides'];
  onOverride: Props['onOverride'];
}) {
  const value = currentValue(option, parameter, overrides);
  const isMatrix = parameter.type === 'number_matrix' || parameter.type === 'matrix2';
  const display = isMatrix
    ? (value as number[][]).map((row) => row.join(', ')).join('; ')
    : (value as number[]).join(', ');
  const [text, setText] = useState(display);
  const [invalid, setInvalid] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  return (
    <div className={styles.param} data-invalid={invalid ? 'true' : 'false'}>
      <span>{parameter.label}<em>{isMatrix ? '矩阵' : '数组'}</em></span>
      <textarea
        className={styles.arrayInput}
        rows={isMatrix ? 3 : 2}
        value={editing ? text : display}
        spellCheck={false}
        aria-invalid={invalid ? true : undefined}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          setEditing(false);
          const parsed = isMatrix ? parseMatrix(text) : parseList(text);
          if (parsed === null) {
            setInvalid(isMatrix ? '请输入分号分行、逗号分列的数字矩阵' : '请输入逗号分隔的有限数值');
            return;
          }
          setInvalid('');
          onOverride(option.option_id, parameter, parsed);
        }}
      />
      {invalid ? <span className={styles.fieldError} role="alert">{invalid}</span> : null}
    </div>
  );
}

interface Props {
  plan: InteractionPlan;
  selected: Set<string>;
  confirmed: Set<string>;
  overrides: Record<string, Record<string, ParameterOverride>>;
  onToggle: (optionId: string, checked: boolean) => void;
  onConfirm: (optionId: string, checked: boolean) => void;
  onOverride: (optionId: string, parameter: PlanParameter, override: ParameterOverride) => void;
  onRetryRegion: (option: InteractionOption) => void;
  onApply: () => void;
  busy: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  supported: '可执行',
  needs_review: '待核对',
  explanation_only: '仅说明',
  unsupported: '不支持',
};

function currentValue(option: InteractionOption, parameter: PlanParameter, overrides: Props['overrides']): CanonicalValue {
  const raw = overrides[option.option_id]?.[parameter.id];
  if (isOverrideObject(raw)) return raw.value;
  return raw ?? parameter.default;
}

function currentRange(option: InteractionOption, parameter: PlanParameter, overrides: Props['overrides']) {
  const raw = overrides[option.option_id]?.[parameter.id];
  if (isOverrideObject(raw)) {
    return {
      min: raw.min !== undefined ? raw.min : parameter.min,
      max: raw.max !== undefined ? raw.max : parameter.max,
    };
  }
  return { min: parameter.min, max: parameter.max };
}

function ParameterEditor({ option, parameter, overrides, onOverride }: {
  option: InteractionOption;
  parameter: PlanParameter;
  overrides: Props['overrides'];
  onOverride: Props['onOverride'];
}) {
  const value = currentValue(option, parameter, overrides);
  const range = currentRange(option, parameter, overrides);
  const numeric = parameter.type === 'number' || parameter.type === 'integer';
  if (parameter.type === 'boolean') {
    return (
      <label className={styles.param}>
        <span>{parameter.label}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onOverride(option.option_id, parameter, event.target.checked)} />
      </label>
    );
  }
  if (parameter.type === 'enum') {
    return (
      <label className={styles.param}>
        <span>{parameter.label}<em>枚举</em></span>
        <select value={String(value)} onChange={(event) => onOverride(option.option_id, parameter, event.target.value)}>
          {parameter.options.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    );
  }
  if (parameter.type === 'number_list' || parameter.type === 'number_matrix' || parameter.type === 'matrix2' || parameter.type === 'vector2') {
    return <ArrayEditor option={option} parameter={parameter} overrides={overrides} onOverride={onOverride} />;
  }
  if (!numeric) {
    return (
      <label className={styles.param}>
        <span>{parameter.label}</span>
        <input type="text" value={String(value)}
          onChange={(event) => onOverride(option.option_id, parameter, event.target.value)} />
      </label>
    );
  }
  return (
    <div className={styles.param}>
      <span>{parameter.label}<em>{parameter.unit || parameter.type}</em></span>
      <input type="number" value={Number(value)} step={parameter.step ?? 1}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          const keepRange = range.min !== parameter.min || range.max !== parameter.max;
          onOverride(option.option_id, parameter, keepRange
            ? { value: next, min: range.min, max: range.max }
            : next);
        }} />
      <span>
        <input type="number" aria-label={`${parameter.label} 最小值`} value={range.min ?? ''} placeholder="min"
          onChange={(event) => {
            const min = event.target.value === '' ? null : Number(event.target.value);
            onOverride(option.option_id, parameter, { value: Number(value), min, max: range.max });
          }} />
        <input type="number" aria-label={`${parameter.label} 最大值`} value={range.max ?? ''} placeholder="max"
          onChange={(event) => {
            const max = event.target.value === '' ? null : Number(event.target.value);
            onOverride(option.option_id, parameter, { value: Number(value), min: range.min, max });
          }} />
      </span>
    </div>
  );
}

export function InteractionPlanPanel({
  plan, selected, confirmed, overrides, onToggle, onConfirm, onOverride, onRetryRegion, onApply, busy,
}: Props) {
  const selectable = plan.options.filter((option) => option.support_status !== 'unsupported');
  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-plan-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-plan-title">1 · 交互规划</h2>
          <p>每页按区域给出学习问题、可调参数、将生成的视图与待核对项。采用后编译为可执行规格；不确定内容不会被自动挂载。</p>
        </div>
        <span className={styles.badge}>{plan.options.length} 个方案</span>
      </header>
      <div className={styles.panelBody}>
        {plan.coverage.length > 0 ? (
          <p className={styles.source}>
            <b>覆盖表</b>
            {plan.coverage.map((entry) => (
              <span key={entry.page_no}>
                第 {entry.page_no} 页：原生 {entry.native.length} · OCR {entry.ocr.length} · 待视觉 {entry.visual.length} · 跳过 {entry.skipped.length}
              </span>
            ))}
          </p>
        ) : null}
        {plan.options.length === 0 ? <p className={styles.empty}>未发现可规划区域。原页仍可阅读与编辑。</p> : null}
        {plan.options.map((option) => {
          const editable = option.support_status === 'needs_review';
          const isSelected = selected.has(option.option_id);
          return (
            <article key={option.option_id} className={styles.option} data-selected={isSelected ? 'true' : 'false'}>
              <div className={styles.optionHead}>
                <label>
                  <input type="checkbox" checked={isSelected} disabled={option.support_status === 'unsupported' || busy}
                    onChange={(event) => onToggle(option.option_id, event.target.checked)} />
                  <span className={styles.optionTitle}>
                    <b>{option.title}</b>
                    <span>
                      {(() => {
                        const raw = option.provider.template_ref;
                        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return option.operator_id;
                        const ref = raw as Record<string, unknown>;
                        return typeof ref.id === 'string'
                          ? `${ref.id}@${String(ref.version ?? '')}`
                          : option.operator_id;
                      })()} · 第 {option.source.page} 页 · {option.parameters.length} 个参数
                    </span>
                  </span>
                </label>
                <span className={styles.badge} data-status={option.support_status}>{STATUS_LABEL[option.support_status] ?? option.support_status}</span>
              </div>
              <p className={styles.optionQuestion}>{option.question}</p>
              {option.support_reason ? <p className={styles.source}>{option.support_reason}</p> : null}
              <p className={styles.source}>
                <b>原文依据</b>
                <span>{option.source.excerpt || '（无摘录，需人工核对）'}</span>
                <span>bbox {option.source.bbox.x.toFixed(3)}, {option.source.bbox.y.toFixed(3)} · {option.source.bbox.w.toFixed(3)}×{option.source.bbox.h.toFixed(3)}</span>
              </p>
              {option.parameters.length > 0 ? (
                <div className={styles.params}>
                  {option.parameters.map((parameter) => (
                    <ParameterEditor key={parameter.id} option={option} parameter={parameter}
                      overrides={overrides} onOverride={onOverride} />
                  ))}
                </div>
              ) : null}
              {option.review_items.length > 0 ? (
                <>
                  {option.review_items.some((item) => item.blocking && item.required) ? (
                    <p className={styles.source}>
                      <b>阻塞条件</b>
                      <span>请先在参数中补齐或修正对应值；仅勾选“已核对”不能绕过缺失必需值或未解决冲突。</span>
                    </p>
                  ) : null}
                  <ul className={styles.reviews}>
                    {option.review_items.map((item) => (
                      <li key={item.item_id} data-required={item.required ? 'true' : 'false'}>
                        <span>⚠</span><span>{item.prompt}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {editable ? (
                <label className={styles.confirmLine}>
                  <input type="checkbox" checked={confirmed.has(option.option_id)}
                    onChange={(event) => onConfirm(option.option_id, event.target.checked)} />
                  我已核对来源、参数与范围，可以采用该方案
                </label>
              ) : null}
              <div className={styles.row}>
                <button type="button" className={styles.button} disabled={busy}
                  onClick={() => onRetryRegion(option)}>仅重试此区域</button>
                <span className={styles.source}>{"视图：" + option.views.map((view) => view.title).join(' / ')}</span>
              </div>
            </article>
          );
        })}
      </div>
      <footer className={styles.footer}>
        <span className={styles.badge}>已选 {selected.size} / {selectable.length}</span>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || selected.size === 0} onClick={onApply}>
          {busy ? '编译中…' : '采用选中方案并编译'}
        </button>
      </footer>
    </section>
  );
}

export default InteractionPlanPanel;
