/**
 * MatrixControls.tsx —— 六个标量参数控件（R6-AC4 / R6-AC5 / T5 验收 1）
 *
 * C-MX@1 里的矩阵与向量是**整体**参数（`type="matrix2"` / `type="vector2"`），
 * 但交互上是六个独立的标量。这里为每个元素派生一个标量视图（`type="decimal"`，
 * 沿用原参数的 range / unit / provenance），交给共享的 `ParamControl` 渲染——
 * 这样滑块与数字输入的双向同步、范围提示、焦点样式都与其它模板完全一致。
 *
 * 越界处理（R6-AC4 / §2.2.3 规则 7）：
 *  - 数字输入越界时**不写入**全局参数，只保留本地草稿并给出中文原因；
 *  - 草稿在外部参数变化（提交成功、重置）时清空，避免显示过期值。
 */
import { useEffect, useState } from 'react';
import { ParamControl } from '@/components/ui';
import type { Matrix2, Parameter, Vector2 } from '@/api/types';
import { formatValue } from './MatrixNumericTable';
import styles from './matrix.module.css';

/** 与 C-MX@1 规则 7 一致：−3 ~ 3，步长 0.1 */
const PARAM_MIN = -3;
const PARAM_MAX = 3;
const PARAM_STEP = 0.1;
const EPSILON = 1e-9;

interface FieldSpec {
  /** 本地唯一键（只用于草稿/错误记录，不进入任何契约） */
  key: string;
  /** 交给 ParamControl 显示的中文名 */
  label: string;
  /** 错误文案里的短名 */
  short: string;
  value: number;
  /** 用新值重建整体参数值 */
  build: (nextValue: number) => unknown;
}

function parseNumericInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    // 用户正在输入中间态（空、单独负号、单独小数点）时不判定为错误
    if (text === '' || text === '-' || text === '.' || text === '-.') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rangeError(value: number): string | null {
  if (!Number.isFinite(value)) return '不是有限数（NaN / Infinity 不被接受）';
  if (value < PARAM_MIN - EPSILON || value > PARAM_MAX + EPSILON) {
    return `超出允许范围 ${formatValue(PARAM_MIN)} ~ ${formatValue(PARAM_MAX)}（步长 ${formatValue(
      PARAM_STEP,
    )}），未写入`;
  }
  return null;
}

/** 标量视图参数：沿用原参数的范围与来源，只把 id/name/type 换成元素级。 */
function scalarParameter(base: Parameter, key: string, label: string, value: number): Parameter {
  return {
    id: `${base.id}__${key}`,
    name: label,
    type: 'decimal',
    value,
    unit: base.unit,
    range: base.range,
    source_ref_ids: base.source_ref_ids,
    provenance: base.provenance,
    editable: base.editable,
  };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
}

export interface MatrixControlsProps {
  matrixParameter: Parameter;
  vectorParameter: Parameter;
  matrix: Matrix2;
  vector: Vector2;
  /** 统一提交路径：`TemplateProps.onParameterChange` */
  onChange: (parameterId: string, value: unknown) => void;
}

export default function MatrixControls({
  matrixParameter,
  vectorParameter,
  matrix,
  vector,
  onChange,
}: MatrixControlsProps) {
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 外部值变化（提交成功、宿主重置、切换对象）时丢弃草稿与错误
  const signature = `${matrix[0][0]}|${matrix[0][1]}|${matrix[1][0]}|${matrix[1][1]}|${vector[0]}|${vector[1]}`;
  useEffect(() => {
    setDrafts({});
    setErrors({});
  }, [signature]);

  const matrixFields: FieldSpec[] = [
    {
      key: 'a11',
      label: 'A 第 1 行第 1 列（a11）',
      short: 'a11',
      value: matrix[0][0],
      build: (nextValue: number): Matrix2 => [
        [nextValue, matrix[0][1]],
        [matrix[1][0], matrix[1][1]],
      ],
    },
    {
      key: 'a12',
      label: 'A 第 1 行第 2 列（a12）',
      short: 'a12',
      value: matrix[0][1],
      build: (nextValue: number): Matrix2 => [
        [matrix[0][0], nextValue],
        [matrix[1][0], matrix[1][1]],
      ],
    },
    {
      key: 'a21',
      label: 'A 第 2 行第 1 列（a21）',
      short: 'a21',
      value: matrix[1][0],
      build: (nextValue: number): Matrix2 => [
        [matrix[0][0], matrix[0][1]],
        [nextValue, matrix[1][1]],
      ],
    },
    {
      key: 'a22',
      label: 'A 第 2 行第 2 列（a22）',
      short: 'a22',
      value: matrix[1][1],
      build: (nextValue: number): Matrix2 => [
        [matrix[0][0], matrix[0][1]],
        [matrix[1][0], nextValue],
      ],
    },
  ];

  const vectorFields: FieldSpec[] = [
    {
      key: 'x1',
      label: '输入向量 x 第 1 分量（x1）',
      short: 'x1',
      value: vector[0],
      build: (nextValue: number): Vector2 => [nextValue, vector[1]],
    },
    {
      key: 'x2',
      label: '输入向量 x 第 2 分量（x2）',
      short: 'x2',
      value: vector[1],
      build: (nextValue: number): Vector2 => [vector[0], nextValue],
    },
  ];

  const handleFieldChange = (parameterId: string, field: FieldSpec, raw: unknown): void => {
    if (typeof raw === 'string' && raw.trim() === '') {
      // 清空输入框的中间态：既不写入也不报错
      return;
    }
    const parsed = parseNumericInput(raw);
    if (parsed === null) {
      setErrors((previous) => ({
        ...previous,
        [field.key]: `${field.short} 请输入数字（例如 1.5），未写入`,
      }));
      return;
    }
    const reason = rangeError(parsed);
    if (reason !== null) {
      setErrors((previous) => ({
        ...previous,
        [field.key]: `${field.short} = ${formatValue(parsed)} ${reason}`,
      }));
      setDrafts((previous) => ({ ...previous, [field.key]: parsed }));
      return;
    }
    setErrors((previous) => withoutKey(previous, field.key));
    setDrafts((previous) => withoutKey(previous, field.key));
    onChange(parameterId, field.build(parsed));
  };

  const renderFields = (fields: FieldSpec[], base: Parameter) =>
    fields.map((field) => (
      <ParamControl
        key={field.key}
        parameter={scalarParameter(base, field.key, field.label, field.value)}
        value={drafts[field.key] ?? field.value}
        error={errors[field.key] ?? null}
        disabled={!base.editable}
        onChange={(next: unknown) => handleFieldChange(base.id, field, next)}
      />
    ));

  return (
    <section className={styles.card} aria-label="参数控件">
      <div className={styles.controlsGroup}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legendTitle}>{matrixParameter.name}</legend>
          <p className={styles.fieldsetHint}>
            四个元素共用范围 −3 ~ 3、步长 0.1；滑块与数字输入双向同步，越界不写入并显示原因。
          </p>
          {renderFields(matrixFields, matrixParameter)}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legendTitle}>{vectorParameter.name}</legend>
          <p className={styles.fieldsetHint}>
            两个分量同样 −3 ~ 3、步长 0.1；也可以直接拖动画布上的端点。
          </p>
          {renderFields(vectorFields, vectorParameter)}
        </fieldset>
      </div>
    </section>
  );
}