import { useEffect, useId, useState, type CSSProperties } from 'react';
import { businessExactRange } from './businessModels.ts';
import { BUSINESS_PASTE_MAX_LENGTH, parseBusinessPaste } from './businessPaste.ts';
import type { BusinessTemplateKind } from './businessPipelineTypes.ts';
import {
  BUSINESS_LABEL_MAX_LENGTH, BUSINESS_UNIT_MAX_LENGTH, CPM_MAX_DURATION, CPM_TASKS,
  businessControlLabel, businessLabelFields, businessUnitFields, readBusinessSettings, writeBusinessSettings,
} from './businessUnits.ts';
import styles from './instrumentStage.module.css';
import settingsStyles from './businessSettingsEditor.module.css';

interface BusinessParameterProps {
  kind: BusinessTemplateKind;
  paramKey: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  units: Record<string, string>;
  onChange?: (value: number) => void;
}

export function BusinessParameterEditor({
  kind, paramKey, label, value, min, max, step, units, onChange,
}: BusinessParameterProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => { setDraft(null); setInvalid(false); }, [value]);

  const range = businessExactRange(kind, paramKey);
  if (!range) return null;
  const name = businessControlLabel(kind, paramKey, label, units);
  const percentage = label.endsWith('（%）');
  const scale = percentage ? 100 : 1;
  const displayed = (number: number) => Number((number * scale).toPrecision(15));
  const lower = displayed(range.min);
  const upper = displayed(range.max);
  const shown = displayed(value);
  const sliderMin = value < min ? range.min : min;
  const sliderMax = value > max ? Math.min(range.max, Math.ceil(value / max) * max) : max;
  const gridPosition = (value - sliderMin) / step;
  const sliderStep = Math.abs(gridPosition - Math.round(gridPosition)) > 1e-7 ? 'any' : step;

  const commit = () => {
    if (draft === null) return;
    const entered = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(entered) || entered < lower || entered > upper || range.integer && !Number.isInteger(entered)) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
    if (entered !== shown) onChange?.(entered / scale);
  };
  return <div className={`${styles.parameter} ${styles.businessParameter}`}>
    <span>{name}</span>
    <input className={styles.businessNumber} type="number" aria-label={name + '数值'}
      value={draft ?? String(shown)} min={lower} max={upper} step={range.integer ? 1 : 'any'} disabled={!onChange}
      aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
      onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
      onBlur={commit} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape' && (draft !== null || invalid)) {
          event.stopPropagation(); setDraft(null); setInvalid(false);
        }
      }} />
    <input type="range" className={styles.range} aria-label={name} min={sliderMin} max={sliderMax}
      step={sliderStep} value={value} aria-valuetext={percentage ? shown + '%' : undefined} disabled={!onChange}
      style={{ '--fill': (value - sliderMin) / (sliderMax - sliderMin) * 100 + '%' } as CSSProperties}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber;
        onChange?.(range.integer ? Math.round(next) : next);
      }} />
    {invalid && <span id={errorId} className={styles.businessInputError} role="status">
      请输入 {lower} 至 {upper} 之间的{range.integer ? '整数' : '数值'}。
    </span>}
  </div>;
}

export function BusinessUnitEditor({
  kind, units, sourceText, onChange, onParams, visibleParamKeys, authoring = true,
}: {
  kind: BusinessTemplateKind;
  units: Record<string, string>;
  sourceText?: string;
  onChange?: (text: string) => void;
  onParams?: (params: Record<string, number>) => void;
  visibleParamKeys?: readonly string[];
  authoring?: boolean;
}) {
  const [clipboard, setClipboard] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  if (!authoring) return null;
  const settings = readBusinessSettings(kind, sourceText);
  const nameFields = businessLabelFields(kind);
  const save = (patch: Partial<typeof settings>) => onChange?.(writeBusinessSettings(kind, { ...settings, units, ...patch }));
  const applyPaste = () => {
    try {
      const parsed = parseBusinessPaste(kind, clipboard, { ...settings, units }, visibleParamKeys);
      const changesNames = Object.keys(parsed.labels).length || Object.keys(parsed.durations).length;
      const count = Object.keys(parsed.params).length;
      if (changesNames && !onChange || count && !onParams) throw new Error('当前设置不可编辑。');
      if (changesNames) save({
        labels: { ...settings.labels, ...parsed.labels },
        durations: { ...settings.durations, ...parsed.durations },
      });
      if (count) onParams?.(parsed.params);
      setClipboard('');
      setFeedback({ text: '已应用表格数据。' });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : '无法读取表格数据。', error: true });
    }
  };
  return <>
    <details className={styles.businessUnits}>
      <summary>自定义单位</summary>
      {businessUnitFields(kind).map(({ key, label, defaultUnit }) => <BusinessTextInput
        key={key} label={label} defaultValue={defaultUnit} value={units[key] ?? defaultUnit} maxLength={BUSINESS_UNIT_MAX_LENGTH}
        onChange={onChange && ((value) => save({ units: { ...units, [key]: value } }))} />)}
      <p>改单位只改显示标签。清空可恢复默认单位。</p>
    </details>
    {(nameFields.length > 0 || onParams) && <details className={settingsStyles.settings}>
      <summary>{nameFields.length ? '自定义名称 / 粘贴 Excel 数据' : '粘贴 Excel 数据'}</summary>
      {nameFields.map(({ id, name }, index) => <BusinessTextInput key={id}
        label={kind === 'biz-cpm' ? id + ' 任务名称' : '第 ' + (index + 1) + ' 层名称'}
        defaultValue={name} value={settings.labels[id] ?? name} maxLength={BUSINESS_LABEL_MAX_LENGTH}
        onChange={onChange && ((value) => save({ labels: { ...settings.labels, [id]: value } }))} />)}
      {kind === 'biz-cpm' && <details>
        <summary>任务计划工期（{units.time ?? '天'}）</summary>
        {CPM_TASKS.map(({ id, duration }) => <BusinessDurationInput key={id}
          label={id + ' 计划工期'} value={settings.durations[id] ?? duration}
          onChange={onChange && ((value) => save({ durations: { ...settings.durations, [id]: value } }))} />)}
      </details>}
      {(onParams || onChange) && <div className={settingsStyles.paste}>
        <label>两列 CSV 或 TSV
          <textarea rows={3} value={clipboard} maxLength={BUSINESS_PASTE_MAX_LENGTH} spellCheck={false}
            placeholder={kind === 'biz-cpm' ? '需求评审,3\n支付网关,6' : '参数名,数值'} onChange={(event) => {
              setClipboard(event.currentTarget.value);
              setFeedback(undefined);
            }} />
        </label>
        <p>{kind === 'biz-cpm' ? '任务名和工期按 T1 至 T6 导入。也可用 T1 等固定键修改名称或工期。'
          : kind === 'biz-funnel' ? '参数使用参数名。自定义层名可先填写当前层名称，再填写新名称。'
            : '第一列填写参数名，第二列填写数值。百分比可填 35 或 35%。'}</p>
        <button type="button" disabled={!clipboard.trim()} onClick={applyPaste}>应用粘贴数据</button>
        {feedback && <p data-error={feedback.error || undefined} role="status">{feedback.text}</p>}
      </div>}
    </details>}
  </>;
}

function BusinessTextInput({ label, value, defaultValue, maxLength, onChange }: {
  label: string; value: string; defaultValue: string; maxLength: number; onChange?: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null) return;
    const entered = draft.trim() || defaultValue;
    setDraft(null);
    if (entered !== value) onChange?.(entered);
  };
  return <label>{label}
    <input type="text" value={draft ?? value} maxLength={maxLength} placeholder={defaultValue}
      disabled={!onChange} onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape' && draft !== null) { event.stopPropagation(); setDraft(null); }
      }} />
  </label>;
}

function BusinessDurationInput({ label, value, onChange }: {
  label: string; value: number; onChange?: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && (!Number.isInteger(Number(draft)) || Number(draft) < 1 || Number(draft) > CPM_MAX_DURATION);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null || invalid) return;
    setDraft(null);
    if (Number(draft) !== value) onChange?.(Number(draft));
  };
  return <label>{label}
    <input type="number" min={1} max={CPM_MAX_DURATION} step={1} value={draft ?? value} disabled={!onChange}
      aria-invalid={invalid || undefined} onBlur={commit} onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape' && draft !== null) { event.stopPropagation(); setDraft(null); }
      }} />
  </label>;
}
