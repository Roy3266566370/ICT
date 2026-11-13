import type { ISpec, SpecParameter } from '@/ispec/types';
import { formatNumberSmart } from '@/ispec/format';
import { validateParameterInput } from '@/components/ispec/ISpecView';
import styles from './ExperimentStage.module.css';

interface Props {
  spec: ISpec;
  values: Record<string, number | boolean | string>;
  ids: string[];
  disabled?: boolean;
  onChange: (id: string, value: number | boolean | string) => void;
}

function bounds(parameter: SpecParameter): { min: number; max: number; step: number } {
  const angle = parameter.id.toLowerCase().includes('angle');
  const min = angle ? -180 : (parameter.min ?? -10);
  const max = angle ? 180 : (parameter.max ?? 10);
  const step = parameter.step ?? (parameter.type === 'integer' ? 1 : angle ? 1 : 0.1);
  return { min, max, step };
}

function displayValue(parameter: SpecParameter, value: number | boolean | string | undefined): string {
  if (typeof value === 'number') return formatNumberSmart(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  return String(parameter.default);
}

export function KeyControls({ spec, values, ids, disabled, onChange }: Props) {
  const parameters = ids.map(id => spec.parameters.find(parameter => parameter.id === id)).filter((item): item is SpecParameter => item !== undefined);
  if (!parameters.length) return null;
  return <div className={styles.keyControls} aria-label="关键控制">
    <div className={styles.railHeading}><span>关键控制</span><small>拖动或输入即重算</small></div>
    {parameters.map(parameter => {
      const value = values[parameter.id] ?? parameter.default;
      if (parameter.type === 'enum' || parameter.type === 'string') {
        const options = parameter.options ?? [];
        return <div className={styles.control} key={parameter.id}>
          <label>{parameter.label}</label>
          <div className={styles.segmented} role="group" aria-label={parameter.label}>
            {options.length > 0 && options.length <= 4 ? options.map(option => <button key={option} type="button"
              aria-pressed={String(value) === option} disabled={disabled}
              onClick={() => onChange(parameter.id, option)}>{optionLabel(parameter.id, option)}</button>) :
              <select aria-label={parameter.label} value={String(value)} disabled={disabled}
                onChange={event => onChange(parameter.id, event.target.value)}>
                {options.map(option => <option key={option} value={option}>{option}</option>)}
              </select>}
          </div>
          <small>{parameter.id === 'steps_order' || parameter.id === 'steps_shape' ? '补充实验条件' : parameter.source.status === 'inferred' ? '系统推断，请核对' : parameter.source.status === 'confirmed' ? '用户确认' : '原页条件'}</small>
        </div>;
      }
      const { min, max, step } = bounds(parameter);
      const numeric = typeof value === 'number' ? value : Number(value);
      return <div className={styles.control} key={parameter.id}>
        <label htmlFor={`key-${parameter.id}`}>{parameter.label}<b>{displayValue(parameter, value)}{parameter.unit ? ` ${parameter.unit}` : ''}</b></label>
        <input id={`key-${parameter.id}`} type="range" min={min} max={max} step={step} value={Number.isFinite(numeric) ? numeric : 0}
          aria-label={`${parameter.label} 滑块`} disabled={disabled}
          onChange={event => {
            const next = Number(event.target.value);
            if (validateParameterInput(parameter, next).ok) onChange(parameter.id, next);
          }}/>
        <input type="number" min={min} max={max} step={step} value={Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : 0}
          aria-label={`${parameter.label} 数值`} disabled={disabled}
          onChange={event => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && validateParameterInput(parameter, next).ok) onChange(parameter.id, next);
          }}/>
      </div>;
    })}
  </div>;
}

function optionLabel(parameterId: string, option: string): string {
  const labels: Record<string, Record<string, string>> = {
    steps_order: {A: '先转后拉', B: '先拉后转'},
    steps_shape: {rectangle: '矩形', basis: '基向量'},
    rank_case: {embed_3x2: '3×2 嵌入三维', project_2x3: '2×3 压成平面', plane_to_line: '压成直线'},
    det_case: {unit: '单位方格', scale: '横向纵向伸缩', shear: '剪切', projection: '压到横轴'},
    relation_case: {equivalent: '等价', similar: '相似', congruent: '合同'},
  };
  return labels[parameterId]?.[option] ?? option;
}
