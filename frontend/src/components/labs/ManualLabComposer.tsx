import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createManualLab, previewManualLab } from '@/api/labs';
import { errorMessage } from '@/api/client';
import { manualConditions, manualInputError, manualInputKey,
  type ManualIntegralDraft, type ManualIntegralPreview } from '@/labs/manualInput';
import { MathExpressionInput, MathKeyboard, type MathKeyboardHandle } from './MathExpressionInput';
import { Formula } from '@/components/showcase/Formula';
import styles from './ManualLabComposer.module.css';

const EMPTY: ManualIntegralDraft = { task: 'integral', expression: '', variable: 'x', lower: '', upper: '' };
type FieldKey = 'expression' | 'lower' | 'upper';
const FIELD_LABELS: Record<FieldKey, string> = { expression: '被积函数', lower: '积分下限', upper: '积分上限' };

export function ManualLabComposer(): JSX.Element {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ManualIntegralDraft>(EMPTY);
  const [preview, setPreview] = useState<{ inputKey: string; data: ManualIntegralPreview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'compute' | null>(null);
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState<FieldKey>('expression');
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const requestId = useRef(0);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const confirmationSection = useRef<HTMLElement>(null);
  const expressionHandle = useRef<MathKeyboardHandle | null>(null);
  const lowerHandle = useRef<MathKeyboardHandle | null>(null);
  const upperHandle = useRef<MathKeyboardHandle | null>(null);
  const activeHandle = activeField === 'lower' ? lowerHandle
    : activeField === 'upper' ? upperHandle : expressionHandle;
  const update = (patch: Partial<ManualIntegralDraft>): void => {
    requestId.current += 1;
    setDraft(current => ({ ...current, ...patch }));
    if (patch.task) setActiveField('expression');
    setPreview(null); setConfirmed(false); setError('');
  };
  const prepare = async (): Promise<void> => {
    const invalid = manualInputError(draft);
    if (invalid) { setError(invalid); return; }
    const id = ++requestId.current;
    setBusy('preview'); setError(''); setPreview(null); setConfirmed(false);
    try {
      const data = await previewManualLab({ task: draft.task, conditions: manualConditions(draft) });
      if (id !== requestId.current) return;
      setPreview({ inputKey: manualInputKey(draft), data });
      requestAnimationFrame(() => {
        confirmationSection.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        confirmation.current?.focus({ preventScroll: true });
      });
    } catch (cause) { if (id === requestId.current) setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  const compute = async (): Promise<void> => {
    if (!preview || !confirmed || preview.inputKey !== manualInputKey(draft) || busy) return;
    setBusy('compute'); setError('');
    try {
      const lab = await createManualLab({ task: preview.data.task, conditions: preview.data.conditions, confirmed: true });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  return <section className={styles.panel} aria-labelledby="manual-lab-title">
    <header className={styles.header}>
      <span className={styles.kicker}>SOLVE YOUR PROBLEM</span>
      <h2 id="manual-lab-title">输入我的题目</h2>
      <p>选择题型，填写公式与条件。核对完整题目后，由本地内核计算并展示过程。</p>
    </header>
    <ol className={styles.steps} aria-label="解题流程">
      {['选择题型', '填写条件', '确认题目', '计算与展示'].map((step, i) => <li key={step} data-active={preview ? i === 2 : i < 2}>{i + 1} · {step}</li>)}
    </ol>
    <fieldset className={styles.fields} disabled={busy !== null}>
      <div className={styles.classification}>
        <label>科目<select aria-label="科目" defaultValue="calculus"><option value="calculus">高等数学</option></select></label>
        <span>知识模块<strong>积分</strong></span>
        <p>本阶段开放定积分与不定积分；文件识别和其他科目示例仍可在下方使用。</p>
      </div>
      <div className={styles.tasks} role="group" aria-label="选择积分题型">
        <button type="button" aria-pressed={draft.task === 'integral'} onClick={() => update({ task: 'integral' })}>
          <strong>定积分</strong><span>给出函数与上下限，求积分值并观察黎曼和。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'antiderivative'} onClick={() => update({ task: 'antiderivative' })}>
          <strong>不定积分</strong><span>求原函数族 F(x) + C，并通过求导核对。</span>
        </button>
      </div>
      <div className={styles.inputHeading}>
        <label>积分变量<select aria-label="积分变量" value={draft.variable} onChange={e => update({ variable: e.target.value })}>
          {['x', 't', 'y', 'z'].map(v => <option key={v} value={v}>{v}</option>)}
        </select></label>
        <button type="button" onClick={() => update(draft.task === 'integral'
          ? { expression: 'x^2', variable: 'x', lower: '0', upper: '2' }
          : { expression: 'x*cos(x)', variable: 'x', lower: '', upper: '' })}>填入可修改示例</button>
      </div>
      <MathExpressionInput label="被积函数" value={draft.expression} variables={[draft.variable]}
        onChange={expression => update({ expression })} placeholder={`例如 ${draft.variable}^2；只填函数，不含积分符号`}
        keyboard={false} apiRef={expressionHandle} onActivate={() => setActiveField('expression')} />
      {draft.task === 'integral' ? <div className={styles.bounds}>
        <MathExpressionInput label="积分下限" value={draft.lower} variables={[]} onChange={lower => update({ lower })}
          placeholder="例如 0、1/3" keyboard={false} apiRef={lowerHandle} onActivate={() => setActiveField('lower')} />
        <MathExpressionInput label="积分上限" value={draft.upper} variables={[]} onChange={upper => update({ upper })}
          placeholder="例如 2、pi" keyboard={false} apiRef={upperHandle} onActivate={() => setActiveField('upper')} />
      </div> : <p className={styles.note}>不定积分不需要上下限；任意常数 C 会保留在答案中。</p>}
      <p className={styles.note}>{draft.task === 'integral' ? '当前支持有限实数上下限。公式结构、定义域与计算能力会分别检查；不会自动补条件。' : '当前输入单变量实函数；图形用于观察原函数族，符号求导用于核对。'}</p>
      <p className={styles.note}>{draft.task === 'integral'
        ? '三个输入框共用一个数学键盘：点到哪个框，键盘就作用于哪个框。'
        : '输入框与下方数学键盘联动：点进输入框后，键盘即作用于该字段。'}</p>
    </fieldset>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => void prepare()}>{busy === 'preview' ? '正在检查条件…' : '预览并确认题目'}</button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {busy ? <p className={styles.busy} role="status">{busy === 'compute' ? '正在调用本地计算内核，完成后进入过程展示。' : '正在校验公式与条件，尚未开始计算。'}</p> : null}
    </div>
    {preview ? <section className={styles.confirmation} aria-label="确认题目" ref={confirmationSection}>
      <h3 ref={confirmation} tabIndex={-1}>确认这是你要计算的题目</h3>
      <p>高等数学 / 积分 / {preview.data.label} · 积分变量 {preview.data.conditions.variable}</p>
      <div className={styles.formula}><Formula tex={preview.data.latex} block /></div>
      <p>如有遗漏或错误，请修改上方字段；修改后需要重新预览与确认。</p>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={e => setConfirmed(e.target.checked)} />我已核对公式、积分变量和全部条件</label>
      <button type="button" className={styles.primary} disabled={!confirmed || busy !== null} onClick={() => void compute()}>{busy === 'compute' ? '内核正在计算…' : '确认并计算'}</button>
    </section> : null}
    <section className={styles.keyboardPanel} aria-label="共用数学键盘">
      <div className={styles.keyboardHeading}>
        <p>数学键盘 · 正在编辑<strong>{FIELD_LABELS[activeField]}</strong></p>
        <button type="button" aria-expanded={keyboardOpen} onClick={() => setKeyboardOpen(open => !open)}>
          {keyboardOpen ? '收起键盘' : '展开键盘'}
        </button>
      </div>
      {keyboardOpen ? <MathKeyboard label={FIELD_LABELS[activeField]}
        variables={activeField === 'expression' ? [draft.variable] : []}
        disabled={busy !== null} onPress={key => activeHandle.current?.press(key)} /> : null}
    </section>
  </section>;
}
