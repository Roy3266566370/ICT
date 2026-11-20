/** 页面变量条：编辑态/阅读态共用的参数胶囊与滑杆。
 *
 * 每个变量渲染为一个胶囊：数值型是 ``label + 滑杆 + 当前值``，选择型是下拉。
 * 变量值是运行时状态（``useLiveVars``），不写回文档——文档里存的是定义与默认值。
 */

import type { ReactNode } from 'react';
import { formatNumber } from '@/labs/expr';
import { useLiveVars } from '@/living/liveVars';
import type { PageVariable } from '@/living/types';
import styles from './LivingBlocks.module.css';

export function VariablesBar(props: { hint?: string }): ReactNode {
  const { defs, values, setValue } = useLiveVars();
  const entries = Object.entries(defs);
  if (!entries.length) return null;
  return (
    <div className={styles.varsBar} role="group" aria-label="页面变量">
      {entries.map(([name, spec]) => (
        <VariableCapsule key={name} name={name} spec={spec}
          value={values[name] ?? spec.value} onChange={(v) => setValue(name, v)} />
      ))}
      {props.hint ? <span className={styles.varsHint}>{props.hint}</span> : null}
    </div>
  );
}

function VariableCapsule(props: { name: string; spec: PageVariable; value: number | string; onChange: (v: number | string) => void }): ReactNode {
  const { spec, value, onChange } = props;
  if (spec.type === 'select') {
    return (
      <label className={styles.varCapsule}>
        <span className={styles.varLabel}>{spec.label || props.name}</span>
        <select className={styles.varSelect} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {spec.unit ? <span className={styles.varUnit}>{spec.unit}</span> : null}
      </label>
    );
  }
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const step = spec.step ?? ((max - min) / 100 || 0.01);
  const numeric = typeof value === 'number' ? value : spec.value;
  return (
    <label className={styles.varCapsule}>
      <span className={styles.varLabel}>{spec.label || props.name}</span>
      <input
        className={styles.varSlider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={numeric}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={spec.label || props.name}
      />
      <span className={styles.varValue}>{formatNumber(numeric)}{spec.unit ?? ''}</span>
    </label>
  );
}
