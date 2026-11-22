import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { MathfieldElement } from 'mathlive';
import { editMath, inspectMath } from '@/labs/mathKeyboard';
import { latexToPlain, plainToLatex } from '@/labs/mathLiveBridge';
import { LabFormula as Formula } from './ProblemText';
import { MathText } from './ProblemText';
import styles from './MathExpressionInput.module.css';

let mathliveRegistered = false;
async function ensureMathLive(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return false;
  if (mathliveRegistered || customElements.get('math-field')) {
    mathliveRegistered = true;
    return true;
  }
  try {
    await import('mathlive');
    mathliveRegistered = true;
    return true;
  } catch {
    return false;
  }
}

interface MathLiveBoxProps {
  label: string;
  value: string;
  variables: readonly string[];
  allowInfinity: boolean;
  disabled?: boolean;
  onChange: (plain: string) => void;
  onActivate?: () => void;
  onSubmit?: () => void;
  fallback: ReactNode;
}

/** 所见即所得 MathLive `<math-field>`，与纯文本输入框通过 ComputeEngine 双向实时同步。 */
function MathLiveBox({
  label,
  value,
  variables,
  allowInfinity,
  disabled,
  onChange,
  onActivate,
  onSubmit,
  fallback,
}: MathLiveBoxProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const focusedRef = useRef(false);
  const lastEmittedRef = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const onActivateRef = useRef(onActivate);
  const onSubmitRef = useRef(onSubmit);
  const [ready, setReady] = useState(false);

  onChangeRef.current = onChange;
  onActivateRef.current = onActivate;
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;

    void ensureMathLive().then((ok) => {
      if (cancelled || !ok || !host) return;
      const mf = document.createElement('math-field') as MathfieldElement;
      mf.className = styles.mathField ?? '';
      mf.setAttribute('aria-label', `${label}可视化公式编辑`);
      mf.mathVirtualKeyboardPolicy = 'manual';
      mf.smartFence = true;
      mf.smartSuperscript = true;
      mf.readOnly = Boolean(disabled);
      mf.value = plainToLatex(value, variables, allowInfinity);

      const handleFocus = (): void => {
        focusedRef.current = true;
        onActivateRef.current?.();
      };
      const handleBlur = (): void => {
        focusedRef.current = false;
      };
      const handleInput = (): void => {
        const plain = latexToPlain(mf.value);
        lastEmittedRef.current = plain;
        onChangeRef.current(plain);
      };
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' && !event.isComposing && onSubmitRef.current) {
          event.preventDefault();
          onSubmitRef.current();
        }
      };

      mf.addEventListener('focus', handleFocus);
      mf.addEventListener('blur', handleBlur);
      mf.addEventListener('input', handleInput);
      mf.addEventListener('keydown', handleKeyDown);
      host.innerHTML = '';
      host.appendChild(mf);
      fieldRef.current = mf;
      setReady(true);

      return () => {
        mf.removeEventListener('focus', handleFocus);
        mf.removeEventListener('blur', handleBlur);
        mf.removeEventListener('input', handleInput);
        mf.removeEventListener('keydown', handleKeyDown);
      };
    });

    return () => {
      cancelled = true;
      if (fieldRef.current) {
        fieldRef.current.remove();
        fieldRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  useEffect(() => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.readOnly = Boolean(disabled);
  }, [disabled]);

  // 当外部修改 value（例如点击示例、虚拟键盘按钮或在左侧文本框键入）时同步到 MathLive
  useEffect(() => {
    const mf = fieldRef.current;
    if (!mf) return;
    if (focusedRef.current && value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const nextLatex = plainToLatex(value, variables, allowInfinity);
    if (mf.value !== nextLatex) {
      mf.value = nextLatex;
    }
  }, [value, variables, allowInfinity]);

  return (
    <div className={styles.preview} aria-label={`${label}公式预览`}>
      <small>{ready ? '可视化公式' : '公式预览'}</small>
      <div ref={hostRef} className={styles.mathFieldHost} />
      {!ready ? fallback : null}
    </div>
  );
}

export interface MathKeyboardHandle {
  press: (key: string) => void;
  focus: () => void;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  variables: readonly string[];
  disabled?: boolean;
  provenance?: ReactNode;
  describedBy?: string;
  placeholder?: string;
  autoFocus?: boolean;
  answerMode?: boolean;
  allowInfinity?: boolean;
  onSubmit?: () => void;
  keyboard?: boolean;
  apiRef?: MutableRefObject<MathKeyboardHandle | null>;
  onActivate?: () => void;
}

const STRUCTURES = [
  ['group', '(\\,)', '括号'], ['power', 'a^{b}', '幂'],
  ['fraction', '\\frac{a}{b}', '分式'], ['sqrt', '\\sqrt{a}', '平方根'],
  ['abs', '|a|', '绝对值'], ['pi', '\\pi', '圆周率'], ['e', 'e', '自然常数'],
];
const COMMON = ['sin', 'cos', 'tan', 'ln', 'exp', 'arctan'];
const MORE = ['arcsin', 'arccos', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh'];
const NUMBERS = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', ')', '+'];
const SYMBOLS: Record<string, string> = { '/': '÷', '*': '×', '-': '−' };

interface KeyboardProps {
  label: string;
  variables: readonly string[];
  onPress: (key: string) => void;
  disabled?: boolean;
  answerMode?: boolean;
  allowInfinity?: boolean;
}

export function MathKeyboard({ label, variables, onPress, disabled, answerMode = false, allowInfinity = false }: KeyboardProps): ReactNode {
  const button = (key: string, content: ReactNode, name = key): ReactNode => (
    <button type="button" key={key} aria-label={name} title={name} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={() => onPress(key)}>{content}</button>
  );
  const fn = (name: string): ReactNode => button(name,
    <Formula tex={name === 'exp' ? 'e^{a}' : `\\${name}`} />, `${name}函数`);
  return <div className={styles.keyboard} role="group" aria-label={`${label}数学键盘`}>
    <div className={styles.symbols}>
      {[...new Set(variables)].map((name) => button(name, <Formula tex={name} />, `变量${name}`))}
      {STRUCTURES.map(([key, tex, name]) => button(key!, <Formula tex={tex!} />, name!))}
      {COMMON.map(fn)}
      {allowInfinity ? button('∞', '∞', '正无穷') : null}
      {allowInfinity ? button('-∞', '−∞', '负无穷') : null}
      {answerMode ? button(',', ',', '分隔符逗号') : null}
    </div>
    <div className={styles.digits}>
      {NUMBERS.map((key) => button(key, SYMBOLS[key] ?? key, key === ')' ? '右括号' : SYMBOLS[key] ?? key))}
    </div>
    <div className={styles.controls}>
      {button('left', '←', '光标左移')}{button('right', '→', '光标右移')}
      {button('next', '下一项', '移到下一项')}{button('backspace', '⌫', '退格')}
      {button('clear', '清空', '清空公式')}
    </div>
    <details className={styles.more}>
      <summary>更多函数</summary>
      <div className={styles.functions}>{MORE.map(fn)}</div>
    </details>
  </div>;
}

export function MathExpressionInput({ label, value, onChange, variables, disabled, provenance, describedBy,
  placeholder, autoFocus, answerMode = false, allowInfinity = false, onSubmit, keyboard = true, apiRef, onActivate }: Props): ReactNode {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef({ start: value.length, end: value.length });
  const inspection = useMemo(() => allowInfinity && /^(?:[+-]?(?:oo|inf|∞))$/.test(value.trim())
    ? {error:null,tex:value.trim().startsWith('-') ? '-\\infty' : '\\infty'} : inspectMath(value, variables), [value, variables, allowInfinity]);
  const remember = (): void => {
    if (input.current) selection.current = {
      start: input.current.selectionStart ?? value.length, end: input.current.selectionEnd ?? value.length,
    };
  };
  const press = (key: string): void => {
    if (disabled) return;
    const next = editMath({ value, ...selection.current }, key);
    selection.current = { start: next.start, end: next.end };
    onChange(next.value);
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(next.start, next.end);
    });
  };
  useImperativeHandle(apiRef, () => ({
    press,
    focus: () => input.current?.focus({ preventScroll: true }),
  }));

  return <div className={styles.editor}>
    <label className={styles.label} htmlFor={id}><MathText text={label} /><small>{provenance}</small></label>
    <input ref={input} id={id} aria-label={label} className={styles.input} value={value} disabled={disabled}
      placeholder={placeholder} autoFocus={autoFocus}
      aria-describedby={`${id}-status${describedBy ? ` ${describedBy}` : ''}`}
      aria-invalid={answerMode ? undefined : !!inspection.error} inputMode="none" autoComplete="off" autoCapitalize="off" spellCheck={false}
      onSelect={remember} onClick={remember} onKeyUp={remember} onFocus={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && onSubmit) {
          event.preventDefault();
          onSubmit();
        }
      }}
      onChange={(event) => { onChange(event.target.value); remember(); }} />
    <MathLiveBox
      label={label}
      value={value}
      variables={variables}
      allowInfinity={allowInfinity}
      disabled={disabled}
      onChange={(plain) => {
        onChange(plain);
        selection.current = { start: plain.length, end: plain.length };
      }}
      onActivate={onActivate}
      onSubmit={onSubmit}
      fallback={
        inspection.tex ? (
          <Formula tex={inspection.tex} />
        ) : (
          <span>{value || (answerMode ? '点击下方按钮输入答案' : '点击下方按钮输入函数')}</span>
        )
      }
    />
    <p className={styles.status} id={`${id}-status`} data-invalid={!answerMode && !!inspection.error}>
      {answerMode ? '输入完成后点击“检查”核对你的答案。'
        : inspection.error ? `请补全公式：${inspection.error}` : '公式结构完整，可对照原题确认。'}
    </p>
    {keyboard ? <MathKeyboard label={label} variables={variables} onPress={press}
      disabled={disabled} answerMode={answerMode} allowInfinity={allowInfinity} /> : null}
    {keyboard ? <p className={styles.hint}>点击按钮输入；分式、根号和函数会自动配好括号。「下一项」可跳到分母或移出括号，也可直接键入、粘贴和选中替换。</p> : null}
  </div>;
}
