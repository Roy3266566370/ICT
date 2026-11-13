import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { validateParameterInput } from '@/components/ispec/ISpecView';
import { formatNumberSmart } from '@/ispec/format';
import type { SpecParameter } from '@/ispec/types';
import { baselineValue, dragValue, isOffBaseline } from './liveRegions';
import styles from './Live.module.css';

interface Props {
  parameter: SpecParameter;
  value: number | boolean | string | undefined;
  disabled?: boolean;
  /** 标签显示参数 id（默认）或完整中文名（多参数面板里用）。 */
  caption?: 'id' | 'label';
  /** 提交新值；返回 false 表示被宿主拒绝（例如正在保存）。 */
  onCommit: (id: string, value: number) => void;
}

/** 原位数字：拖动 / 键盘 / 聚焦后滚轮 / 点击输入，写入走同一套参数校验。 */
export function LiveNumber({ parameter, value, disabled, caption = 'id', onCommit }: Props) {
  const current = typeof value === 'number' ? value : Number(parameter.default);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const valueRef = useRef(current);
  valueRef.current = current;

  const commit = (raw: number) => {
    const check = validateParameterInput(parameter, raw);
    if (!check.ok) { setProblem(check.reason); return false; }
    setProblem('');
    if (typeof check.value === 'number' && check.value !== valueRef.current) onCommit(parameter.id, check.value);
    return true;
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || event.button !== 0) return;
    event.stopPropagation();
    drag.current = { x: event.clientX, start: current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 3) return;
    state.moved = true;
    commit(dragValue(state.start, dx, parameter.step, event.shiftKey));
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (state && !state.moved) { setDraft(String(current)); setEditing(true); }
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || editing) return;
    const step = parameter.step && parameter.step > 0 ? parameter.step : 0.1;
    const factor = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') commit(current + step * factor);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') commit(current - step * factor);
    else if (event.key === 'Enter') { setDraft(String(current)); setEditing(true); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (disabled || editing || document.activeElement !== node || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const step = parameter.step && parameter.step > 0 ? parameter.step : 0.1;
      commit(valueRef.current + (event.deltaY < 0 ? step : -step) * (event.shiftKey ? 10 : 1));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  });

  const off = isOffBaseline(parameter, current);
  const base = baselineValue(parameter);
  const text = formatNumberSmart(current);
  return <div className={styles.numWrap} data-off={off} data-dragging={dragging}>
    {editing ? <input className={styles.numInput} autoFocus value={draft} inputMode="decimal"
      aria-label={`${parameter.label}，输入数值`} onChange={event => setDraft(event.target.value)}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') { if (commit(Number(draft))) setEditing(false); }
        else if (event.key === 'Escape') { setProblem(''); setEditing(false); }
      }}
      onBlur={() => { if (!problem) setEditing(false); else { setProblem(''); setEditing(false); } }}/>
      : <div ref={ref} className={styles.num} role="spinbutton" tabIndex={disabled ? -1 : 0}
        aria-label={parameter.label} aria-valuenow={current} aria-valuetext={text}
        aria-valuemin={parameter.min} aria-valuemax={parameter.max} aria-disabled={disabled}
        data-live-param={parameter.id} data-no-pan title={`${parameter.label}：左右拖动调节，Shift 粗调，点击输入`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <span className={styles.numText}>{text}</span>
        <span className={styles.numLabel}>{caption === 'label' ? parameter.label : parameter.id}</span>
      </div>}
    {off && !editing && <span className={styles.numBase} title="原稿取值">原稿 {formatNumberSmart(Number(base))}</span>}
    {problem && <span className={styles.numProblem} role="alert">{problem}</span>}
  </div>;
}
