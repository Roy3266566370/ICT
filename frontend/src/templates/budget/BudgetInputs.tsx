/**
 * BudgetInputs.tsx —— budget_compare 的参数区（R9-AC1 / R9-AC6 / T6 验收 7）
 *
 *  - 人数 n：`ParamControl` 同时给出滑块与数字输入（单位「人」）；
 *  - 方案 A / B 的固定成本与人均成本：`ParamControl` 数字输入（单位「元」），
 *    值以**十进制字符串**回传（ParamControl 见到字符串原值即按字符串 emit）；
 *  - 预算上限：可勾选「不设上限」（R9-AC5）；勾选后控件禁用，视图不画预算线、不显示余量。
 *    `budget_limit=null` 无法经 `parameters[]` 表达（校验要求整数），因此该开关是
 *    **视图级**的，并在界面上明确说明不会改写对象参数。
 *  - 越界输入在这里先做中文原因拦截（不写入），避免用户看到"拖了但没反应"。
 */
import { useEffect, useState } from 'react';
import { ParamControl } from '@/components/ui';
import type { BudgetCompareResult, Parameter } from '@/api/types';
import { decCompare, decFromString } from '@/domain/budget';
import { formatMoney, trimDecimalString } from '@/domain/format';
import styles from './budget.module.css';

export interface Coefficient {
  /** 十进制字符串（元） */
  fixed: string;
  /** 十进制字符串（元 / 人） */
  perUnit: string;
}

export interface BudgetParameterSet {
  people: Parameter | null;
  limit: Parameter | null;
  /** config.budget_limit_parameter_id；null 表示对象本身未设上限 */
  configuredLimitId: string | null;
  fixedA: Parameter | null;
  perPersonA: Parameter | null;
  fixedB: Parameter | null;
  perPersonB: Parameter | null;
  nameA: Parameter | null;
  nameB: Parameter | null;
  coefficientA: Coefficient | null;
  coefficientB: Coefficient | null;
}

export interface BudgetInputsProps {
  parameters: BudgetParameterSet;
  result: BudgetCompareResult;
  limitDisabled: boolean;
  onLimitDisabledChange: (disabled: boolean) => void;
  onChange: (parameterId: string, value: unknown) => void;
}

/** 金额输入统一保留 2 位小数并去掉尾零（"3000.50" → "3000.5"），避免科学计数法。 */
function decimalText(value: number): string {
  return trimDecimalString(value.toFixed(2));
}

/** 输入校验：只做范围判断，不参与任何金额运算（金额真值仍取内核输出的字符串）。 */
function validateValue(parameter: Parameter, value: number): string | null {
  if (!Number.isFinite(value)) return '不是有限数';
  if (parameter.type === 'integer') {
    if (!Number.isInteger(value)) return '需要整数';
    if (parameter.range.min !== null && value < parameter.range.min) {
      return `小于允许下限 ${parameter.range.min}${unitSuffix(parameter.unit)}`;
    }
    if (parameter.range.max !== null && value > parameter.range.max) {
      return `大于允许上限 ${parameter.range.max}${unitSuffix(parameter.unit)}`;
    }
    return null;
  }
  const parsed = decFromString(decimalText(value));
  if (parsed === null) return '不是合法的十进制数';
  if (parameter.range.min_decimal !== undefined) {
    const min = decFromString(parameter.range.min_decimal);
    if (min !== null && decCompare(parsed, min) < 0) {
      return `小于允许下限 ${parameter.range.min_decimal}${unitSuffix(parameter.unit)}`;
    }
  }
  if (parameter.range.max_decimal !== undefined) {
    const max = decFromString(parameter.range.max_decimal);
    if (max !== null && decCompare(parsed, max) > 0) {
      return `大于允许上限 ${parameter.range.max_decimal}${unitSuffix(parameter.unit)}`;
    }
  }
  return null;
}

function unitSuffix(unit: string): string {
  return unit === '' || unit === '1' ? '' : unit;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
}

export default function BudgetInputs(props: BudgetInputsProps) {
  const { parameters, result, limitDisabled, onLimitDisabledChange, onChange } = props;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<{ a: string | null; b: string | null }>({
    a: null,
    b: null,
  });

  // 外部值变化（提交成功、重置、切换对象）时丢弃错误与名称草稿
  const signature = JSON.stringify({
    n: parameters.people?.value ?? null,
    limit: parameters.limit?.value ?? null,
    fa: parameters.fixedA?.value ?? null,
    pa: parameters.perPersonA?.value ?? null,
    fb: parameters.fixedB?.value ?? null,
    pb: parameters.perPersonB?.value ?? null,
    na: parameters.nameA?.value ?? null,
    nb: parameters.nameB?.value ?? null,
  });
  useEffect(() => {
    setErrors({});
    setNameDrafts({ a: null, b: null });
  }, [signature]);

  const handleNumberChange = (parameter: Parameter, key: string, raw: unknown): void => {
    const text = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (typeof text !== 'number' || !Number.isFinite(text)) {
      setErrors((previous) => ({ ...previous, [key]: `${parameter.name} 请输入数字，未写入` }));
      return;
    }
    const reason = validateValue(parameter, text);
    if (reason !== null) {
      setErrors((previous) => ({
        ...previous,
        [key]: `${parameter.name} = ${decimalText(text)} ${reason}，未写入`,
      }));
      return;
    }
    setErrors((previous) => withoutKey(previous, key));
    onChange(parameter.id, parameter.type === 'decimal' ? decimalText(text) : text);
  };

  const commitName = (parameter: Parameter | null, key: 'a' | 'b'): void => {
    if (parameter === null) return;
    const draft = nameDrafts[key];
    if (draft === null) return;
    onChange(parameter.id, draft.trim());
    setNameDrafts((previous) => ({ ...previous, [key]: null }));
  };

  /** 统一的标量控件渲染：decimal 传字符串原值，integer 传数字原值。 */
  const renderParameter = (parameter: Parameter | null, key: string, disabled = false) => {
    if (parameter === null) return null;
    const rawValue = parameter.value;
    const value =
      parameter.type === 'decimal' && typeof rawValue !== 'string' ? String(rawValue) : rawValue;
    return (
      <ParamControl
        key={key}
        parameter={parameter}
        value={value}
        error={errors[key] ?? null}
        disabled={disabled || !parameter.editable}
        onChange={(next: unknown) => handleNumberChange(parameter, key, next)}
      />
    );
  };

  const renderScenario = (
    scenarioId: 'a' | 'b',
    label: string,
    nameParameter: Parameter | null,
    fixedParameter: Parameter | null,
    perPersonParameter: Parameter | null,
    coefficient: Coefficient | null,
  ) => {
    const scenario = result.scenarios[scenarioId === 'a' ? 0 : 1];
    const displayName = nameDrafts[scenarioId] ?? scenario?.name ?? label;
    return (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legendTitle}>
          <span
            className={`${styles.colorChip} ${scenarioId === 'a' ? styles.colorChipA : styles.colorChipB}`}
            aria-hidden="true"
          />
          {label}
          <span className={styles.legendValue}>
            总额 {formatMoney(scenario?.total ?? '0.00')} 元
          </span>
        </legend>

        {nameParameter === null ? (
          <p className={styles.fieldHint}>
            方案名：{displayName}（对象没有方案名参数，名称只读）
          </p>
        ) : (
          <div className={styles.nameRow}>
            <label className={styles.fieldLabel} htmlFor={`${scenarioId}-name`}>
              方案名（仅作展示，不参与计算）
            </label>
            <input
              id={`${scenarioId}-name`}
              className={styles.input}
              type="text"
              maxLength={20}
              value={displayName}
              disabled={!nameParameter.editable}
              onChange={(event) =>
                setNameDrafts((previous) => ({ ...previous, [scenarioId]: event.target.value }))
              }
              onBlur={() => commitName(nameParameter, scenarioId)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitName(nameParameter, scenarioId);
              }}
            />
          </div>
        )}

        {fixedParameter === null && perPersonParameter === null && coefficient !== null ? (
          <p className={styles.coefficientNote}>
            当前对象用 <code>config.coefficients</code> 定义本方案：
            <strong>{formatMoney(coefficient.fixed)}</strong> 元固定成本 +
            <strong>{formatMoney(coefficient.perUnit)}</strong> 元/人 × n（只读，需改 config 才能编辑）。
          </p>
        ) : null}

        {renderParameter(fixedParameter, `${scenarioId}-fixed`)}
        {renderParameter(perPersonParameter, `${scenarioId}-per`)}
        {fixedParameter === null && perPersonParameter === null && coefficient === null ? (
          <p className={styles.missingNote} role="alert">
            ⚠ 缺少本方案的成本参数（{`plan_${scenarioId}_fixed`} / {`plan_${scenarioId}_per_person`}），
            且 config.coefficients 未提供该方案。
          </p>
        ) : null}
      </fieldset>
    );
  };

  return (
    <section className={styles.card} aria-label="预算参数">
      <h3 className={styles.cardTitle}>
        参数
        <span className={styles.cardTitleMeta}>改一次参数，曲线与表格同步更新</span>
      </h3>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legendTitle}>参与人数</legend>
        {renderParameter(parameters.people, 'people')}
        <p className={styles.fieldHint}>
          人数 n 允许 0 ~ 2000 的整数；滑块与数字输入共用同一个写入出口。
        </p>
      </fieldset>

      {renderScenario(
        'a',
        '方案 A',
        parameters.nameA,
        parameters.fixedA,
        parameters.perPersonA,
        parameters.coefficientA,
      )}
      {renderScenario(
        'b',
        '方案 B',
        parameters.nameB,
        parameters.fixedB,
        parameters.perPersonB,
        parameters.coefficientB,
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legendTitle}>预算上限（可选）</legend>
        <label className={styles.checkboxRow} htmlFor="budget-limit-disabled">
          <input
            id="budget-limit-disabled"
            className={styles.checkbox}
            type="checkbox"
            checked={limitDisabled}
            disabled={parameters.limit === null || !parameters.limit.editable}
            onChange={(event) => onLimitDisabledChange(event.target.checked)}
          />
          <span>不设上限（隐藏预算水平线与余量）</span>
        </label>

        {parameters.limit === null ? (
          <p className={styles.fieldHint}>
            当前对象没有预算上限参数（config.budget_limit_parameter_id 为 null）：不渲染预算线与余量。
          </p>
        ) : (
          <>
            {renderParameter(parameters.limit, 'limit', limitDisabled)}
            <p className={styles.fieldHint}>
              {limitDisabled
                ? '当前视图按「未设上限」计算：不画预算线、不显示余量；对象参数中的上限值保持不变。'
                : '上限允许 0 ~ 1000000 的整数；余量 = 上限 − 总额，余量为负时标「超预算」。'}
            </p>
          </>
        )}
      </fieldset>

      <p className={styles.decimalNote}>
        <strong>金额精度：</strong>
        采用十进制计算，避免二进制浮点误差——金额全程以十进制字符串传输，
        差值、余量与相等判定都取十进制结果（本视图不做任何 {'`number`'} 金额运算）；
        曲线上的坐标换算只用于几何定位，不参与金额真值。
      </p>
    </section>
  );
}