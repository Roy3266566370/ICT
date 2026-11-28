/**
 * FloatingMathKeypad.tsx —— 悬浮数学公式软键盘
 *
 * 设计目标：
 *  - 不抢焦点：按键使用 onMouseDown preventDefault，用户点击任意输入框后即可直接按键盘输入公式；
 *  - 兼容全部输入控件：原生 React 受控 input / textarea（通过原生 value setter + input 事件派发）
 *    以及 MathLive 的 <math-field> 公式编辑器；
 *  - 支持「表达式 / LaTeX」双模式切换，并可按住顶栏自由拖动避免遮挡画布积木。
 */
import { useEffect, useRef, useState } from 'react';
import {
  applyKeypadKey,
  KEYPAD_KEYS,
  KEYPAD_TABS,
  type KeypadKeySpec,
  type KeypadMode,
  type KeypadTab,
} from './mathKeypadActions.ts';
import styles from './floatingMathKeypad.module.css';

interface FloatingMathKeypadProps {
  open: boolean;
  onClose: () => void;
}

type MathFieldElement = HTMLElement & {
  executeCommand: (command: string | [string, ...unknown[]]) => boolean;
};

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | MathFieldElement;

function isMathField(el: EditableTarget): el is MathFieldElement {
  return el.tagName.toLowerCase() === 'math-field' && 'executeCommand' in el && typeof el.executeCommand === 'function';
}

const SUPPORTED_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email']);

function isSupportedTarget(el: Element | null): el is EditableTarget {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-math-keypad="true"]')) return false;
  if (el.tagName.toLowerCase() === 'math-field') return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && SUPPORTED_INPUT_TYPES.has((el.type || '').toLowerCase());
  }
  return false;
}

function describeTarget(el: EditableTarget | null): string {
  if (!el || !el.isConnected) return '';
  if (el.tagName.toLowerCase() === 'math-field') return '公式卡片（LaTeX）';
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, 20);
  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder.slice(0, 20);
  return el instanceof HTMLTextAreaElement ? '文本输入区' : '当前输入框';
}

function shouldPreferLatex(el: EditableTarget): boolean {
  if (el.tagName.toLowerCase() === 'math-field') return true;
  const hint = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`.toLowerCase();
  return hint.includes('latex') || hint.includes('公式');
}

function writeControlledInput(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string, start: number, end: number): void {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, nextValue);
  } else {
    el.value = nextValue;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  try {
    el.setSelectionRange(start, end);
  } catch {
    /* 部分输入类型不支持 setSelectionRange 时静默忽略 */
  }
}

export function FloatingMathKeypad({ open, onClose }: FloatingMathKeypadProps): JSX.Element | null {
  const [tab, setTab] = useState<KeypadTab>('common');
  const [mode, setMode] = useState<KeypadMode>('expr');
  const [targetLabel, setTargetLabel] = useState('');
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const targetRef = useRef<EditableTarget | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 持续追踪用户最近聚焦的输入框（即使在键盘打开前已经聚焦也能捕获）
  useEffect(() => {
    const capture = (el: Element | null): void => {
      if (!isSupportedTarget(el)) return;
      targetRef.current = el;
      setTargetLabel(describeTarget(el));
      setNotice('');
      if (shouldPreferLatex(el)) setMode('latex');
      else if (el.tagName.toLowerCase() !== 'math-field') setMode('expr');
    };
    capture(document.activeElement);
    const onFocusIn = (event: FocusEvent): void => {
      capture(event.target instanceof Element ? event.target : null);
    };
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, []);

  // 打开键盘时同步检测当前焦点
  useEffect(() => {
    if (!open) return;
    if (isSupportedTarget(document.activeElement)) {
      targetRef.current = document.activeElement;
      setTargetLabel(describeTarget(document.activeElement));
      setNotice('');
    } else if (targetRef.current && !targetRef.current.isConnected) {
      targetRef.current = null;
      setTargetLabel('');
    }
  }, [open]);

  // Esc 快捷键关闭键盘
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handlePress = (spec: KeypadKeySpec): void => {
    const active = isSupportedTarget(document.activeElement)
      ? document.activeElement
      : (targetRef.current && targetRef.current.isConnected ? targetRef.current : null);
    if (!active) {
      setNotice('请先点击画布上任意输入框，再按键盘输入公式');
      return;
    }
    targetRef.current = active;
    setTargetLabel(describeTarget(active));
    setNotice('');

    if (isMathField(active)) {
      active.focus();
      if (spec.action === 'backspace') active.executeCommand('deleteBackward');
      else if (spec.action === 'left') active.executeCommand('moveToPreviousChar');
      else if (spec.action === 'right') active.executeCommand('moveToNextChar');
      else if (spec.action === 'clear') active.executeCommand(['insert', '', { selectionMode: 'placeholder' }]);
      else {
        const raw = (spec.latex ?? spec.expr ?? '').replace('|', '#0');
        if (raw) active.executeCommand(['insert', raw]);
      }
      return;
    }

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? active.value.length;
      const next = applyKeypadKey({ value: active.value, start, end }, spec, mode);
      writeControlledInput(active, next.value, next.start, next.end);
    }
  };

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const onHeaderPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.origX + (event.clientX - drag.startX),
      y: drag.origY + (event.clientY - drag.startY),
    });
  };

  const onHeaderPointerUp = (): void => {
    dragRef.current = null;
  };

  const keys = KEYPAD_KEYS[tab];

  return (
    <section
      className={styles.panel}
      data-math-keypad="true"
      aria-label="数学公式软键盘"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
    >
      <header
        className={styles.header}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className={styles.titleGroup}>
          <strong className={styles.title}>⌨ 公式键盘</strong>
          <span className={styles.targetBadge} title={targetLabel || '未锁定输入框'}>
            {targetLabel ? `输入到：${targetLabel}` : '点击任意输入框即可输入'}
          </span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.modeSwitch} role="group" aria-label="输出格式">
            <button
              type="button"
              className={styles.modeBtn}
              aria-pressed={mode === 'expr'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('expr')}
              title="输出函数表达式格式，如 sqrt()、pi"
            >
              表达式
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              aria-pressed={mode === 'latex'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('latex')}
              title="输出 LaTeX 公式格式，如 \\frac{}{}、\\sqrt{}"
            >
              LaTeX
            </button>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="收起公式键盘"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="符号分类">
        {KEYPAD_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.tabBtn}
            aria-pressed={tab === item.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <div className={styles.grid} role="group" aria-label="公式按键">
        {keys.map((spec) => (
          <button
            key={spec.id}
            type="button"
            className={`${styles.key} ${spec.tone === 'fn' ? styles.keyFn : spec.tone === 'op' ? styles.keyOp : spec.tone === 'ctrl' ? styles.keyCtrl : ''}`}
            title={spec.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handlePress(spec)}
          >
            {spec.label}
          </button>
        ))}
      </div>
    </section>
  );
}
