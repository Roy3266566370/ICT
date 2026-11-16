import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTextLab } from '@/api/labs';
import { errorMessage } from '@/api/client';
import { manualTextTypeCount, type ManualTextSubject, type ManualTextType } from '@/labs/manualText';
import styles from './ManualLabComposer.module.css';

interface Props {
  definition: ManualTextSubject;
}

export function ManualTextComposer({ definition }: Props): JSX.Element {
  const navigate = useNavigate();
  const [activeGroup, setActiveGroup] = useState(definition.groups[0]?.label ?? '');
  const [selectedId, setSelectedId] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = definition.groups
    .flatMap(group => group.types)
    .find(type => type.id === selectedId) ?? null;
  const activeGroupDefinition = definition.groups.find(group => group.label === activeGroup) ?? definition.groups[0] ?? null;

  const choose = (type: ManualTextType, group: string): void => {
    setActiveGroup(group);
    setSelectedId(type.id);
    setText(type.template);
    setTitle(type.title);
    setPreviewOpen(false);
    setConfirmed(false);
    setError('');
  };

  const editText = (value: string): void => {
    setText(value);
    setPreviewOpen(false);
    setConfirmed(false);
  };

  const submit = async (): Promise<void> => {
    if (!selected || !text.trim() || !confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const lab = await createTextLab({
        title: title.trim() || selected.title,
        text: text.trim(),
        subject: definition.id,
      });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return <fieldset className={styles.fields} disabled={busy}>
    <div className={styles.classification}>
      <span>题型<strong>{selected ? selected.label : '请选择题型'}</strong></span>
      <p>共 {manualTextTypeCount(definition)} 种题型；选中后填写完整题目原文。</p>
    </div>
    <div className={styles.moduleBar} role="group" aria-label={`${definition.label}知识模块`}>
      {definition.groups.map(group => <button key={group.label} type="button" aria-pressed={activeGroupDefinition?.label === group.label} onClick={() => setActiveGroup(group.label)}>
        <strong>{group.label}</strong><span>{group.types.length} 个题型</span>
      </button>)}
    </div>
    {activeGroupDefinition ? <>
      <p className={styles.moduleHint}>{definition.label} · {activeGroupDefinition.label}：共 {activeGroupDefinition.types.length} 个题型。</p>
      <div className={styles.tasks} role="group" aria-label={`${definition.label} · ${activeGroupDefinition.label}`}>
        {activeGroupDefinition.types.map(type => <button key={type.id} type="button" aria-pressed={selectedId === type.id} onClick={() => choose(type, activeGroupDefinition.label)}>
          <strong>{type.label}</strong><span>{type.hint}</span>
        </button>)}
      </div>
    </> : null}
    {selected ? <>
      <label className={styles.modeField}>题目原文
        <textarea aria-label="题目原文" rows={8} value={text} onChange={event => editText(event.target.value)} placeholder="按所选题型填写完整题目原文，保留全部数据与限制条件" />
      </label>
      <label className={styles.modeField}>实验标题（可选）
        <input className={styles.textField} aria-label="实验标题" value={title} onChange={event => setTitle(event.target.value)} placeholder={selected.title} />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={() => editText(selected.template)}>恢复题型示例</button>
        <button type="button" className={styles.primary} disabled={!text.trim() || busy} onClick={() => { setPreviewOpen(true); setConfirmed(false); setError(''); }}>核对题目</button>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {busy ? <p className={styles.busy} role="status">正在建立实验室…</p> : null}
      </div>
      <p className={styles.note}>示例只用于说明该题型的完整表述，请按原题替换数据；内核按原文识别题型与条件，缺少条件时会明确阻塞，不会自动补全。</p>
      {previewOpen ? <section className={styles.confirmation} aria-label="确认题目">
        <h3>确认这是你要计算的题目</h3>
        <p>{definition.label} / {selected.label}</p>
        <p className={styles.plainText}>{text}</p>
        <p>下一步由本地内核按原文识别题型与条件；如有遗漏，结果会保留未完成原因。</p>
        <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对科目、题型、题目原文和全部条件</label>
        <button type="button" className={styles.primary} disabled={!confirmed || busy} onClick={() => void submit()}>{busy ? '内核正在计算…' : '确认并计算'}</button>
      </section> : null}
    </> : <p className={styles.note}>先选择一个题型，再填写题目原文。每个题型都对应已有的本地执行内核。</p>}
  </fieldset>;
}
