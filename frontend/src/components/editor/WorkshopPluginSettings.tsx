import { useMemo, useState } from 'react';
import { buildTemplateDoc } from '@/canvas/templateCatalog';
import {
  defaultPresetsForTemplate, extractSourceParams, workshopParamRefs,
  WORKSHOP_MAX_PRESETS, WORKSHOP_MAX_PRESET_PARAMS, WORKSHOP_PRESET_PREVIEW_EVENT, WORKSHOP_PRESET_SNAPSHOT_EVENT,
} from '@/canvas/pluginPresets';
import type { CanvasDoc } from '@/canvas/types';
import type { NodePatch, WorkshopPluginConfig, WorkshopPluginPreset } from '@/document/types';
import styles from './FreeDeckEditor.module.css';

export function WorkshopPluginSettings({ nodeId, plugin, onPatch }: {
  nodeId: string;
  plugin: WorkshopPluginConfig;
  onPatch: (patch: NodePatch, key?: string) => void;
}) {
  const kind = plugin.template_kind;
  const [presetName, setPresetName] = useState('');
  const fallbackDoc = useMemo(() => {
    if (kind === 'custom-work') return undefined;
    try { return buildTemplateDoc(kind); } catch { return undefined; }
  }, [kind]);
  const defaults = useMemo(() => defaultPresetsForTemplate(kind), [kind]);
  const doc = plugin.doc ?? fallbackDoc;
  const params = useMemo(() => doc ? workshopParamRefs(doc) : [], [doc]);
  const presets = plugin.presets ?? defaults;
  const visible = plugin.visible_params;
  const allKeys = params.map(param => param.key);
  const availableSlots = WORKSHOP_MAX_PRESET_PARAMS - (visible?.length ?? 0);
  const largeCollection = params.length > WORKSHOP_MAX_PRESET_PARAMS;
  const update = (patch: Partial<WorkshopPluginConfig>, key: string) => {
    onPatch({ workshop_plugin: { ...plugin, ...patch } }, key);
  };
  const savePreset = () => {
    const label = [...presetName.trim()].slice(0, 24).join('');
    if (!doc || !label || presets.length >= WORKSHOP_MAX_PRESETS) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let currentDoc = doc;
    window.dispatchEvent(new CustomEvent(WORKSHOP_PRESET_SNAPSHOT_EVENT, {
      detail: { nodeId, receive: (live: CanvasDoc) => { currentDoc = live; } },
    }));
    const preset: WorkshopPluginPreset = { id, label, params: extractSourceParams(currentDoc) };
    update({ presets: [...presets, preset] }, 'workshop-presets');
    setPresetName('');
  };
  return <>
    <section><h3>呈现样式</h3>
      <div className={styles.numberGrid}>
        <label>展示模式<select aria-label="展示模式" value={plugin.display_mode ?? 'compact'}
          onChange={event => update({ display_mode: event.currentTarget.value as WorkshopPluginConfig['display_mode'] }, 'workshop-display')}>
          <option value="full">完整仪器</option><option value="compact">精简滑杆</option><option value="stage_only">纯主图</option>
        </select></label>
        <label>配色主题<select aria-label="配色主题" value={plugin.theme ?? 'auto'}
          onChange={event => update({ theme: event.currentTarget.value as WorkshopPluginConfig['theme'] }, 'workshop-theme')}>
          <option value="auto">自动</option><option value="light">浅色</option><option value="dark">深色</option>
        </select></label>
      </div>
      <label><input type="checkbox" checked={plugin.transparent_bg ?? false}
        onChange={event => update({ transparent_bg: event.currentTarget.checked }, 'workshop-background')} />透明背景</label>
      <label><input type="checkbox" checked={plugin.hide_border ?? false}
        onChange={event => update({ hide_border: event.currentTarget.checked }, 'workshop-border')} />隐藏边框</label>
    </section>
    <section><h3>情景预设</h3>
      {presets.map(preset => <div className={styles.objectButtons} key={preset.id}>
        <button type="button" aria-label={`预览 ${preset.label}`}
          onClick={() => window.dispatchEvent(new CustomEvent(WORKSHOP_PRESET_PREVIEW_EVENT, { detail: { nodeId, preset } }))}>{preset.label}</button>
        <button type="button" aria-label={`删除预设 ${preset.label}`}
          onClick={() => update({ presets: presets.filter(item => item.id !== preset.id) }, 'workshop-presets')}>删除</button>
      </div>)}
      <label>预设名称<input value={presetName} maxLength={24} onChange={event => setPresetName(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); savePreset(); } }} /></label>
      <button type="button" disabled={!presetName.trim() || !doc || presets.length >= WORKSHOP_MAX_PRESETS}
        onClick={savePreset}>＋ 将当前参数存为预设</button>
    </section>
    <section><h3>公开给观众的参数</h3>
      {params.length === 0 && <p className={styles.hint}>当前作品未外露任何参数。</p>}
      {largeCollection && <p className={styles.hint}>限制公开时，最多可勾选 {WORKSHOP_MAX_PRESET_PARAMS} 项。</p>}
      {params.length > 0 && <div className={styles.objectButtons}>
        <button type="button" disabled={visible === undefined} onClick={() => update({ visible_params: undefined }, 'workshop-visibility')}>全部公开</button>
        <button type="button" disabled={visible?.length === 0} onClick={() => update({ visible_params: [] }, 'workshop-visibility')}>清空公开参数</button>
      </div>}
      {params.map(({ key, displayLabel }) => {
        const checked = visible === undefined || visible.includes(key);
        return <label className={styles.fullField} key={key}><input type="checkbox" aria-label={`公开 ${displayLabel}`} checked={checked}
          disabled={(visible === undefined && largeCollection) || (!checked && availableSlots <= 0)}
          onChange={event => {
            const selected = visible ?? allKeys;
            update({ visible_params: event.currentTarget.checked ? [...selected, key] : selected.filter(item => item !== key) }, 'workshop-visibility');
          }} />{displayLabel}</label>;
      })}
    </section>
  </>;
}
