import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MathExpressionInput } from './MathExpressionInput';
import styles from './AttemptMathInput.module.css';

interface Props {
  label: string;
  placeholder: string;
  value: string;
  variables: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** Keep the attempt row small; the shared keypad opens only while entering an answer. */
export function AttemptMathInput({ label, placeholder, value, variables, disabled, onChange, onSubmit }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const restoringFocus = useRef(false);
  const id = useId();
  const close = (restoreFocus = false): void => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => {
      restoringFocus.current = true;
      input.current?.focus({ preventScroll: true });
      restoringFocus.current = false;
    });
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event): void => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && event.target !== input.current) close();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <>
    <input ref={input} value={value} placeholder={placeholder} aria-label={label}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      inputMode="none" autoComplete="off" spellCheck={false} disabled={disabled}
      onFocus={() => { if (!restoringFocus.current) setOpen(true); }}
      onClick={() => setOpen(true)} onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSubmit();
      }} />
    {open && !disabled ? createPortal(
      <div ref={panel} id={id} className={`${styles.panel} studio-scope`} role="dialog"
        aria-modal="false" aria-label="答案数学键盘">
        <header className={styles.header}>
          <strong>答案数学键盘</strong>
          <button type="button" onClick={() => close(true)} aria-label="收起数学键盘">×</button>
        </header>
        <MathExpressionInput label={label} value={value} onChange={onChange} variables={variables}
          placeholder={placeholder} autoFocus answerMode onSubmit={() => { close(); onSubmit(); }} />
        <footer className={styles.footer}>
          <button type="button" onClick={() => close(true)}>完成输入</button>
          <button type="button" disabled={!value.trim()} onClick={() => { close(); onSubmit(); }}>检查答案</button>
        </footer>
      </div>, document.body,
    ) : null}
  </>;
}
