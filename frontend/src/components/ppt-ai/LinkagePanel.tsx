/** 全表变量面板：按概念分组展示所有出现位置，输入概念可统一改值。 */

import { useEffect, useState } from 'react';
import type { CanonicalValue, CanonicalValues, InteractionBundle } from '@/ppt-ai/types';
import { formatValue, type BundleEvaluation, type OverrideValues } from '@/ppt-ai/runtime/evaluate';
import { conceptCatalog, type ConceptEntry } from '@/ppt-ai/runtime/linking';
import styles from './LinkagePanel.module.css';

interface Props {
  bundle: InteractionBundle;
  evaluation: BundleEvaluation;
  values: CanonicalValues;
  overrides: OverrideValues;
  onJump: (page: number) => void;
  onValueChange: (conceptId: string, value: CanonicalValue) => void;
  onOverride: (nodeId: string, conceptId: string, enabled: boolean) => void;
  /** 解除一条已确认的派生引用；缺省时（如播放器内）不显示解除按钮。 */
  onUnlink?: (relationId: string) => void;
  onClose: () => void;
}

function ConceptValue({ entry, onChange }: { entry: ConceptEntry; onChange?: (value: CanonicalValue) => void }) {
  const numeric = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
  const [text, setText] = useState(String(entry.value ?? ''));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!editing) setText(String(entry.value ?? ''));
  }, [entry.value, editing]);
  if (!entry.editable || !onChange || typeof entry.value !== 'number') {
    return <span className={styles.value}>{formatValue(entry.value)}{entry.unit ? <small>{entry.unit}</small> : null}</span>;
  }
  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) { setError('请输入有限数值'); return; }
    if (entry.min !== null && parsed < entry.min) { setError(`不小于 ${entry.min}`); return; }
    if (entry.max !== null && parsed > entry.max) { setError(`不大于 ${entry.max}`); return; }
    setError('');
    onChange(parsed);
  };
  const bounded = entry.min !== null && entry.max !== null && entry.max > entry.min;
  return (
    <span className={styles.valueEdit} data-error={error ? 'true' : 'false'}>
      {bounded ? (
        <input type="range" min={entry.min ?? 0} max={entry.max ?? 0}
          step={Number.isInteger(numeric) ? 1 : 0.01} value={Math.min(entry.max!, Math.max(entry.min!, numeric))}
          aria-label={`${entry.name}滑块`} onChange={(event) => onChange(Number(event.target.value))} />
      ) : null}
      <input type="number" value={editing ? text : numeric} step="any" data-concept={entry.concept_id}
        aria-label={`${entry.name}精确数值`} aria-invalid={error ? true : undefined}
        onFocus={() => setEditing(true)}
        onChange={(event) => { setText(event.target.value); setError(''); }}
        onBlur={() => { setEditing(false); commit(text); }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      {entry.unit ? <small>{entry.unit}</small> : null}
      {error ? <em role="alert">{error}</em> : null}
    </span>
  );
}

function EntryRow({ entry, bundle, overrides, onJump, onValueChange, onOverride, onUnlink }: {
  entry: ConceptEntry;
  bundle: InteractionBundle;
  overrides: OverrideValues;
  onJump: (page: number) => void;
  onValueChange: (conceptId: string, value: CanonicalValue) => void;
  onOverride: (nodeId: string, conceptId: string, enabled: boolean) => void;
  onUnlink?: (relationId: string) => void;
}) {
  const nodes = entry.nodes
    .map((nodeId) => bundle.compiled.nodes.find((node) => node.node_id === nodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  // 派生概念可能来自一条已确认的派生引用；提供单条解除入口（可逆）。
  const linkedRelation = onUnlink && entry.role !== 'declaration'
    ? bundle.graph.relations.find((relation) =>
        relation.type === 'derived_from'
        && ((relation.outputs ?? []).includes(entry.concept_id)
          || (relation.inputs ?? []).includes(entry.concept_id)))
    : null;
  return (
    <div className={styles.concept} data-role={entry.role} data-concept={entry.concept_id}>
      <div className={styles.conceptHead}>
        <div>
          <b>{entry.name}</b>
          <small>{entry.role === 'derived' ? '派生输出' : entry.role === 'declaration' ? '页面声明' : '可调输入'}
            {entry.type !== 'number' ? ` · ${entry.type}` : ''}{entry.unit ? ` · ${entry.unit}` : ''}</small>
        </div>
        <ConceptValue entry={entry} onChange={entry.editable ? (value) => onValueChange(entry.concept_id, value) : undefined} />
      </div>
      <div className={styles.occurrences}>
        {entry.occurrences.map((occurrence, index) => (
          <button type="button" key={`${occurrence.page}-${index}`} className={styles.pageChip}
            onClick={() => onJump(occurrence.page)} title={occurrence.excerpt}>
            第 {occurrence.page} 页 <span>{occurrence.excerpt.slice(0, 18)}</span>
          </button>
        ))}
      </div>
      {entry.role === 'input' && nodes.length > 1 ? (
        <details className={styles.nodeList}>
          <summary>{nodes.length} 个节点使用此概念 · 例外设置</summary>
          {nodes.map((node) => {
            const local = overrides[node.node_id] ?? {};
            const independent = node.parameters.some((parameter) =>
              parameter.concept_id === entry.concept_id && parameter.concept_id in local);
            return (
              <div key={node.node_id} className={styles.nodeRow}>
                <span>第 {node.source.page} 页 · {node.title}</span>
                <button type="button" aria-pressed={independent}
                  onClick={() => onOverride(node.node_id, entry.concept_id, !independent)}>
                  {independent ? '恢复联动' : '本页保持独立'}
                </button>
              </div>
            );
          })}
        </details>
      ) : null}
      {linkedRelation ? (
        <div className={styles.nodeRow}>
          <small>来自已确认的派生引用。</small>
          <button type="button" onClick={() => onUnlink?.(linkedRelation.relation_id)}>解除引用</button>
        </div>
      ) : null}
    </div>
  );
}

export function LinkagePanel({ bundle, evaluation, values, overrides, onJump, onValueChange, onOverride, onUnlink, onClose }: Props) {
  const catalog = conceptCatalog(bundle, evaluation, values);
  const inputs = catalog.filter((entry) => entry.role === 'input');
  const derived = catalog.filter((entry) => entry.role !== 'input');
  return (
    <aside className={styles.panel} aria-label="全表变量">
      <header className={styles.head}>
        <div><b>全表变量</b><small>{inputs.length} 个输入 · {derived.length} 个派生/声明</small></div>
        <button type="button" onClick={onClose} aria-label="关闭全表变量">×</button>
      </header>
      <div className={styles.body}>
        <section>
          <h3>可调输入</h3>
          {inputs.length ? inputs.map((entry) => <EntryRow key={entry.concept_id} entry={entry} bundle={bundle}
            overrides={overrides} onJump={onJump} onValueChange={onValueChange} onOverride={onOverride} onUnlink={onUnlink} />)
            : <p className={styles.empty}>当前 bundle 没有可调输入。</p>}
        </section>
        {derived.length ? (
          <section>
            <h3>派生与声明</h3>
            {derived.map((entry) => <EntryRow key={entry.concept_id} entry={entry} bundle={bundle}
              overrides={overrides} onJump={onJump} onValueChange={onValueChange} onOverride={onOverride} onUnlink={onUnlink} />)}
          </section>
        ) : null}
        {evaluation.declarationChecks.length ? (
          <section>
            <h3>页面声明对照</h3>
            {evaluation.declarationChecks.map((check) => (
              <p key={check.id} className={styles.declarationCheck} data-status={check.status}
                title={check.detail}>
                {check.status === 'pass' ? '✓' : '✗'} {check.label}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

export default LinkagePanel;
