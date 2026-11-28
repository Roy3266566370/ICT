import { useEffect, useId, useRef, useState } from 'react';
import katex from 'katex';
import { Formula } from '@/components/showcase/Formula';
import styles from './KeyboardFormulaDialog.module.css';

export function KeyboardFormulaDialog({ onClose, onInsert }: {
  onClose: () => void;
  onInsert: (tex: string) => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const tex = draft.trim();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const insert = (): void => {
    if (!tex) { setError('请先输入公式。'); return; }
    try {
      katex.renderToString(tex, { throwOnError: true, strict: 'ignore' });
    } catch {
      setError('公式格式有误，请检查命令和括号。');
      return;
    }
    onInsert(tex);
  };

  return <dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id={titleId}>输入公式</h2>
    <form onSubmit={event => { event.preventDefault(); insert(); }}>
      <label>数学公式
        <input autoFocus value={draft} maxLength={2000} aria-describedby={helpId} aria-invalid={!!error}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={event => { setDraft(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}/>
      </label>
      <p id={helpId}>可键入 <code>x^2+1</code> 或 <code>{'\\frac{1}{x}'}</code>。按 Enter 插入，按 Esc 取消。</p>
      {tex && <div className={styles.preview}><Formula tex={tex} block label="公式预览"/></div>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit">插入画布</button>
      </div>
    </form>
  </dialog>;
}
