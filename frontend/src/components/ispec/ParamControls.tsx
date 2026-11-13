/**
 * ParamControls.tsx —— 由 iSpec `parameters` 自动生成的参数控件。
 *
 * 为什么不直接复用 `@/components/ui/ParamControl`：
 *  - 那个控件的入参是宿主契约里的 `Parameter`（`name` / `range` / `editable` /
 *    `provenance` / `source_ref_ids`），而 iSpec 参数是 `SpecParameter`
 *    （`label` / `min` / `max` / `step` / `options` / 5 种 `type`），字段完全不同；
 *  - 它只覆盖数值参数，没有 `boolean` 开关、`enum` 下拉、`string` 输入；
 *  - 强行适配需要伪造 `editable` / `provenance` / `source_ref_ids`，等于把宿主契约
 *    塞进运行时，违背"只认参数驱动"的目标。
 * 因此这里自建控件，但严格沿用共享原子组件的交互与视觉约定：
 *  - 数值参数 **range + number 双通道**，共用同一 `onChange` 出口；
 *  - `:focus-visible` 可见焦点；
 *  - 越界不写入，原因由 `ISpecView` 校验后以中文回传（`role="alert"`）。
 */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import type { FigureView, SpecParameter } from '../../ispec/types';
import { formatNumberSmart } from '../../ispec/format';
import {
  determinant,
  inverseMatrix,
  matrixRank,
  singularValues,
  swapMatrixColumns,
  transposeMatrix,
  type Matrix2,
} from '../../ispec/geometry';
import styles from './ParamControls.module.css';

export interface ParamControlsProps {
  parameters: SpecParameter[];
  values: Record<string, number | boolean | string>;
  /** 参数 id → 越界/类型原因（由 ISpecView 校验后回传） */
  errors: Record<string, string>;
  onChange: (id: string, value: number | boolean | string) => void;
  disabled?: boolean;
  /** 当前可视图形模板；只有矩阵类模板才把 a/b/c/d 编成矩阵实验台。 */
  figureRef?: FigureView['spec_ref'];
}

const DEFAULT_STEP = 0.1;
/** 数字输入的编辑中间态：允许 ""、"-"、"1." 等，提交交给上层校验 */
const NUMERIC_DRAFT = /^-?\d*(?:\.\d*)?$/;

function describeRange(parameter: SpecParameter): string {
  const { min, max, step } = parameter;
  const hasMin = typeof min === 'number';
  const hasMax = typeof max === 'number';
  const stepText = typeof step === 'number' ? `，步长 ${formatNumberSmart(step, 4)}` : '';
  if (hasMin && hasMax) return `${formatNumberSmart(min)} ~ ${formatNumberSmart(max)}${stepText}`;
  if (hasMin) return `≥ ${formatNumberSmart(min)}${stepText}`;
  if (hasMax) return `≤ ${formatNumberSmart(max)}${stepText}`;
  return '无区间限制';
}

function numericValue(
  raw: number | boolean | string,
  parameter: SpecParameter,
): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const parsed = Number(String(raw));
  if (Number.isFinite(parsed)) return parsed;
  return typeof parameter.default === 'number' ? parameter.default : 0;
}

type MatrixIds = readonly [string, string, string, string];

const MATRIX_ID_SETS: readonly MatrixIds[] = [
  ['a', 'b', 'c', 'd'],
  ['a11', 'a12', 'a21', 'a22'],
];

/** 识别 2×2 矩阵参数组；命名只作为兼容别名，不改变 iSpec 契约。 */
function findMatrixIds(parameters: SpecParameter[]): MatrixIds | null {
  const existing = new Set(parameters.map((parameter) => parameter.id));
  for (const ids of MATRIX_ID_SETS) {
    if (ids.every((id) => existing.has(id))) return ids;
  }
  return null;
}

function cellNumber(values: Record<string, number | boolean | string>, id: string): number {
  const raw = values[id];
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matrixFromValues(
  values: Record<string, number | boolean | string>,
  ids: MatrixIds,
): Matrix2 {
  return {
    a: cellNumber(values, ids[0]),
    b: cellNumber(values, ids[1]),
    c: cellNumber(values, ids[2]),
    d: cellNumber(values, ids[3]),
  };
}

interface DetCellIds {
  index: number;
  matrix: MatrixIds;
  label: string | null;
}

function findDetCells(parameters: SpecParameter[]): DetCellIds[] {
  const existing = new Set(parameters.map((parameter) => parameter.id));
  const cells: DetCellIds[] = [];
  for (let index = 0; index < 4; index += 1) {
    const matrix: MatrixIds = [
      `cells_${index}_matrix_0_0`,
      `cells_${index}_matrix_0_1`,
      `cells_${index}_matrix_1_0`,
      `cells_${index}_matrix_1_1`,
    ];
    if (!matrix.every((id) => existing.has(id))) continue;
    const label = `cells_${index}_label`;
    cells.push({ index, matrix, label: existing.has(label) ? label : null });
  }
  return cells;
}

const MATRIX_PRESETS: ReadonlyArray<{ label: string; matrix: Matrix2 }> = [
  { label: '单位', matrix: { a: 1, b: 0, c: 0, d: 1 } },
  { label: '旋转 90°', matrix: { a: 0, b: -1, c: 1, d: 0 } },
  { label: '剪切', matrix: { a: 1, b: 1, c: 0, d: 1 } },
  { label: '投影', matrix: { a: 1, b: 0, c: 0, d: 0 } },
  { label: '伸缩', matrix: { a: 2, b: 0, c: 0, d: 0.5 } },
];

function MatrixGroup(props: {
  ids: MatrixIds;
  values: Record<string, number | boolean | string>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (id: string, value: number | boolean | string) => void;
}): ReactElement {
  const { ids, values, errors, disabled, onChange } = props;
  const matrix = matrixFromValues(values, ids);
  const det = determinant(matrix);
  const trace = matrix.a + matrix.d;
  const rank = matrixRank(matrix);
  const singular = singularValues(matrix);
  const discriminant = trace * trace - 4 * det;
  const root = Math.sqrt(Math.max(0, discriminant));
  const lambdaText =
    discriminant < -1e-9
      ? '复特征值（旋转型）'
      : discriminant <= 1e-9
        ? `λ = ${formatNumberSmart(trace / 2, 4)}（重根）`
        : `λ = ${formatNumberSmart((trace + root) / 2, 4)} / ${formatNumberSmart((trace - root) / 2, 4)}`;
  const groupErrors = ids
    .map((id) => errors[id])
    .filter((message): message is string => Boolean(message));

  const write = (next: Matrix2): void => {
    onChange(ids[0], next.a);
    onChange(ids[1], next.b);
    onChange(ids[2], next.c);
    onChange(ids[3], next.d);
  };
  const inverse = inverseMatrix(matrix);

  const cell = (index: number, label: string): ReactElement => {
    const id = ids[index] ?? 'a';
    return (
      <MatrixCell
        key={id}
        value={cellNumber(values, id)}
        label={`矩阵 ${label}`}
        disabled={disabled}
        invalid={Boolean(errors[id])}
        onChange={(next) => onChange(id, next)}
      />
    );
  };

  return (
    <div className={styles.matrixGroup} data-matrix-ids={ids.join(',')}>
      <div className={styles.matrixHead}>
        <span className={styles.matrixTitle}>矩阵 A</span>
        <span className={styles.matrixMetrics}>
          det {formatNumberSmart(det, 4)} · 迹 {formatNumberSmart(trace, 4)} · 秩 {rank}
        </span>
      </div>
      <div className={styles.matrixBody}>
        <div className={styles.matrixPad} role="group" aria-label="2×2 矩阵输入">
          {cell(0, '第 1 行第 1 列')}
          {cell(1, '第 1 行第 2 列')}
          {cell(2, '第 2 行第 1 列')}
          {cell(3, '第 2 行第 2 列')}
        </div>
        <div className={styles.matrixStats}>
          <span>{lambdaText}</span>
          <span>σ = {formatNumberSmart(singular[0], 4)} / {formatNumberSmart(singular[1], 4)}</span>
        </div>
      </div>
      <div className={styles.presetRow} role="group" aria-label="常用变换">
        {MATRIX_PRESETS.map((preset) => (
          <button key={preset.label} type="button" disabled={disabled}
            onClick={() => write(preset.matrix)}>{preset.label}</button>
        ))}
      </div>
      <div className={styles.opsRow} role="group" aria-label="矩阵操作">
        <button type="button" disabled={disabled} onClick={() => write(transposeMatrix(matrix))}>转置</button>
        <button type="button" disabled={disabled} onClick={() => write(swapMatrixColumns(matrix))}>交换列</button>
        <button type="button" disabled={disabled || inverse === null}
          title={inverse === null ? '不可逆：行列式为 0' : '求逆矩阵'}
          onClick={() => { if (inverse) write(inverse); }}>求逆</button>
      </div>
      <p className={styles.matrixHint}>拖动图形上的列端点也可改矩阵；预设为常用线性变换，不替代原文数据。</p>
      {groupErrors.length > 0 && (
        <p className={styles.matrixError} role="alert">⚠ {groupErrors[0]}</p>
      )}
    </div>
  );
}

function DetCellsGroup(props: {
  cells: DetCellIds[];
  values: Record<string, number | boolean | string>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (id: string, value: number | boolean | string) => void;
}): ReactElement {
  const { cells, values, errors, disabled, onChange } = props;
  return (
    <div className={styles.detGroup} data-det-cells={cells.length}>
      <div className={styles.detHead}>
        <span className={styles.matrixTitle}>四格面积对比</span>
        <span className={styles.matrixMetrics}>拖动/修改任一矩阵，比较 |det| 与定向</span>
      </div>
      <div className={styles.detGrid}>
        {cells.map((cell) => {
          const matrix = matrixFromValues(values, cell.matrix);
          const det = determinant(matrix);
          const cellErrors = cell.matrix.map((id) => errors[id]).filter(Boolean);
          return (
            <div className={styles.detCell} key={cell.index}>
              <div className={styles.detCellHead}>
                {cell.label === null ? (
                  <span>格 {cell.index + 1}</span>
                ) : (
                  <input
                    className={styles.detLabelInput}
                    aria-label={`格 ${cell.index + 1} 标题`}
                    value={String(values[cell.label] ?? '')}
                    disabled={disabled}
                    onChange={(event) => onChange(cell.label!, event.target.value)}
                  />
                )}
                <span>{formatNumberSmart(Math.abs(det), 4)}</span>
              </div>
              <div className={styles.detMatrix}>
                {cell.matrix.map((id, index) => (
                  <MatrixCell
                    key={id}
                    value={cellNumber(values, id)}
                    label={`格 ${cell.index + 1} 第 ${Math.floor(index / 2) + 1} 行第 ${(index % 2) + 1} 列`}
                    disabled={disabled}
                    invalid={Boolean(errors[id])}
                    onChange={(value) => onChange(id, value)}
                  />
                ))}
              </div>
              <span className={styles.detMetrics}>
                {Math.abs(det) < 1e-9 ? '面积 0 · 退化' : `面积 ${formatNumberSmart(Math.abs(det), 4)} · ${det > 0 ? '正定向' : '负定向'}`}
              </span>
              {cellErrors.length > 0 && <span className={styles.matrixError}>⚠ {cellErrors[0]}</span>}
            </div>
          );
        })}
      </div>
      <p className={styles.matrixHint}>四格共用一套视域；剪切与投影格可改为自己的示例矩阵。</p>
    </div>
  );
}

function MatrixCell(props: {
  value: number;
  label: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: number) => void;
}): ReactElement {
  const { value, label, disabled, invalid, onChange } = props;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={styles.matrixCell}
      type="number"
      inputMode="decimal"
      step="any"
      value={draft ?? formatNumberSmart(value, 6)}
      aria-label={label}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const trimmed = text.trim();
        if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return;
        if (!NUMERIC_DRAFT.test(trimmed)) return;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

const MATRIX_FIGURES: ReadonlyArray<FigureView['spec_ref']> = [
  'vectors',
  'circle_ellipse',
  'grid_transform',
  'eigen_probe',
  'inverse_map',
];

export function ParamControls(props: ParamControlsProps): ReactElement {
  const { parameters, values, errors, onChange, disabled = false, figureRef } = props;

  if (parameters.length === 0) {
    return <p className={styles.empty}>该规格没有可调参数。</p>;
  }

  const matrixIds = figureRef !== undefined && MATRIX_FIGURES.includes(figureRef)
    ? findMatrixIds(parameters)
    : null;
  const matrixSet = new Set<string>(matrixIds ?? []);
  const detCells = figureRef === 'det_area' ? findDetCells(parameters) : [];
  const detSet = new Set<string>(
    detCells.flatMap((cell) => [...cell.matrix, ...(cell.label === null ? [] : [cell.label])]),
  );
  const rest = parameters.filter(
    (parameter) => !matrixSet.has(parameter.id) && !detSet.has(parameter.id),
  );

  return (
    <div className={styles.root} data-param-controls={parameters.length}>
      <h4 className={styles.heading}>参数</h4>
      <div className={styles.grid}>
        {matrixIds !== null && (
          <MatrixGroup
            ids={matrixIds}
            values={values}
            errors={errors}
            disabled={disabled}
            onChange={onChange}
          />
        )}
        {detCells.length >= 2 && (
          <DetCellsGroup
            cells={detCells}
            values={values}
            errors={errors}
            disabled={disabled}
            onChange={onChange}
          />
        )}
        {rest.map((parameter) => (
          <ParamRow
            key={parameter.id}
            parameter={parameter}
            value={values[parameter.id] ?? parameter.default}
            error={errors[parameter.id] ?? null}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

interface ParamRowProps {
  parameter: SpecParameter;
  value: number | boolean | string;
  error: string | null;
  disabled: boolean;
  onChange: (id: string, value: number | boolean | string) => void;
}

function ParamRow(props: ParamRowProps): ReactElement {
  const { parameter, value, error, disabled, onChange } = props;
  const inputId = useId();
  const errorId = useId();
  const type = parameter.type ?? 'number';
  const unit = parameter.unit ?? '';
  const describedBy = error === null ? undefined : errorId;

  const emit = (next: number | boolean | string): void => onChange(parameter.id, next);

  return (
    <div
      className={styles.row}
      data-param-id={parameter.id}
      data-param-type={type}
      data-invalid={error === null ? undefined : 'true'}
    >
      <div className={styles.header}>
        <label className={styles.label} htmlFor={inputId}>
          {parameter.label}
          {unit === '' ? null : <span className={styles.unit}>（{unit}）</span>}
        </label>
        <span className={styles.meta}>{describeRange(parameter)}</span>
      </div>

      {type === 'boolean' ? (
        <BooleanField
          id={inputId}
          checked={Boolean(value)}
          disabled={disabled}
          invalid={error !== null}
          describedBy={describedBy}
          onChange={emit}
        />
      ) : type === 'enum' ? (
        <EnumField
          id={inputId}
          value={String(value)}
          options={parameter.options ?? []}
          disabled={disabled}
          invalid={error !== null}
          describedBy={describedBy}
          onChange={emit}
        />
      ) : type === 'string' ? (
        <StringField
          id={inputId}
          value={String(value)}
          disabled={disabled}
          invalid={error !== null}
          describedBy={describedBy}
          onChange={emit}
        />
      ) : (
        <NumberField
          id={inputId}
          parameter={parameter}
          value={numericValue(value, parameter)}
          disabled={disabled}
          invalid={error !== null}
          describedBy={describedBy}
          onChange={emit}
        />
      )}

      {error === null ? null : (
        <p className={styles.error} id={errorId} role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  parameter: SpecParameter;
  value: number;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: number) => void;
}

function NumberField(props: NumberFieldProps): ReactElement {
  const { id, parameter, value, disabled, invalid, describedBy, onChange } = props;
  const [draft, setDraft] = useState<string | null>(null);

  const min = parameter.min;
  const max = parameter.max;
  const step = parameter.step ?? (parameter.type === 'integer' ? 1 : DEFAULT_STEP);
  const hasSlider = typeof min === 'number' && typeof max === 'number' && max > min;

  const display = draft ?? formatNumberSmart(value, 6);

  const handleSlider = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(null);
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(next);
  };

  const handleNumber = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setDraft(text);
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return;
    if (!NUMERIC_DRAFT.test(trimmed)) return;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <div className={styles.numberRow}>
      {hasSlider ? (
        <input
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          disabled={disabled}
          aria-label={`${parameter.label} 滑块`}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          onChange={handleSlider}
        />
      ) : (
        <span className={styles.noRange}>无区间限制，请直接输入</span>
      )}
      <input
        id={id}
        className={styles.number}
        type="number"
        inputMode="decimal"
        min={min ?? undefined}
        max={max ?? undefined}
        step={step}
        value={display}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        onChange={handleNumber}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

interface BooleanFieldProps {
  id: string;
  checked: boolean;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: boolean) => void;
}

function BooleanField(props: BooleanFieldProps): ReactElement {
  const { id, checked, disabled, invalid, describedBy, onChange } = props;
  return (
    <label className={styles.switch} htmlFor={id}>
      <input
        id={id}
        className={styles.switchInput}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchText}>{checked ? '开' : '关'}</span>
    </label>
  );
}

interface EnumFieldProps {
  id: string;
  value: string;
  options: string[];
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string) => void;
}

function EnumField(props: EnumFieldProps): ReactElement {
  const { id, value, options, disabled, invalid, describedBy, onChange } = props;
  if (options.length === 0) {
    return <p className={styles.noRange}>该枚举参数没有 options，无法生成下拉选项。</p>;
  }
  const selected = options.includes(value) ? value : (options[0] ?? value);
  return (
    <select
      id={id}
      className={styles.select}
      value={selected}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

interface StringFieldProps {
  id: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string) => void;
}

function StringField(props: StringFieldProps): ReactElement {
  const { id, value, disabled, invalid, describedBy, onChange } = props;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };

  return (
    <input
      id={id}
      className={styles.text}
      type="text"
      value={draft ?? value}
      disabled={disabled}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

export default ParamControls;