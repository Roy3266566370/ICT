/**
 * MathLiveFloatingKeypad.tsx —— 一体化暖纸面 MathLive 悬浮公式键盘
 *
 * 将所见即所得 <math-field> 同步条与 MathLive 官方虚拟键盘（window.mathVirtualKeyboard）
 * 合并挂载在同一个居中圆角悬浮卡片中，并通过 CSS 变量统一为定象坊暖纸面 + 陶土珊瑚红风格。
 */
import { useEffect, useRef, useState } from 'react';
import { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import { latexToPlain, plainToLatex } from '@/labs/mathLiveBridge.ts';
import styles from './floatingMathKeypad.module.css';

interface MathLiveFloatingKeypadProps {
  open: boolean;
  onClose: () => void;
}

type OutputMode = 'expr' | 'latex';
type WriteMode = 'sync' | 'insert';
type TextControl = HTMLInputElement | HTMLTextAreaElement;

const SUPPORTED_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email']);

function isExternalTextControl(el: Element | null): el is TextControl {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-mathlive-keypad="true"]')) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && SUPPORTED_INPUT_TYPES.has((el.type || '').toLowerCase());
  }
  return false;
}

function isExternalMathField(el: Element | null): el is MathfieldElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-mathlive-keypad="true"]')) return false;
  return el.tagName.toLowerCase() === 'math-field';
}

function describeControl(el: Element | null): string {
  if (!(el instanceof HTMLElement) || !el.isConnected) return '';
  if (el.tagName.toLowerCase() === 'math-field') return '公式卡片';
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, 18);
  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder.slice(0, 18);
  return el instanceof HTMLTextAreaElement ? '文本输入区' : '当前输入框';
}

function inferOutputMode(el: TextControl): OutputMode {
  const hint = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`.toLowerCase();
  if (hint.includes('latex') || hint.includes('公式卡')) return 'latex';
  return 'expr';
}

function inferWriteMode(el: TextControl): WriteMode {
  return el instanceof HTMLTextAreaElement ? 'insert' : 'sync';
}

function writeControlledValue(el: TextControl, nextValue: string, caretStart?: number, caretEnd?: number): void {
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
  if (caretStart !== undefined && caretEnd !== undefined) {
    try {
      el.setSelectionRange(caretStart, caretEnd);
    } catch {
      /* 忽略不支持选区的输入类型 */
    }
  }
}

export default function MathLiveFloatingKeypad({ open, onClose }: MathLiveFloatingKeypadProps): JSX.Element | null {
  const fieldHostRef = useRef<HTMLDivElement>(null);
  const kbdHostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const targetRef = useRef<TextControl | MathfieldElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const suppressSyncRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const [targetLabel, setTargetLabel] = useState('');
  const [nativeMathTarget, setNativeMathTarget] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>('expr');
  const [writeMode, setWriteMode] = useState<WriteMode>('sync');
  const [latexValue, setLatexValue] = useState('');
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const outputModeRef = useRef(outputMode);
  outputModeRef.current = outputMode;
  const writeModeRef = useRef(writeMode);
  writeModeRef.current = writeMode;

  const convertForTarget = (latex: string, mode: OutputMode): string => {
    const trimmed = latex.trim();
    if (!trimmed) return '';
    return mode === 'latex' ? trimmed : latexToPlain(trimmed);
  };

  const pullFromTarget = (el: TextControl, mode: OutputMode, nextWriteMode: WriteMode): void => {
    const mf = fieldRef.current;
    if (!mf) return;
    suppressSyncRef.current = true;
    try {
      if (nextWriteMode === 'insert') {
        mf.value = '';
        setLatexValue('');
      } else {
        const nextTex = mode === 'latex'
          ? el.value
          : plainToLatex(el.value, ['x', 'y', 't', 'n', 'a', 'b', 'c'], true);
        mf.value = nextTex;
        setLatexValue(nextTex);
      }
    } finally {
      suppressSyncRef.current = false;
    }
  };

  // 持续捕获用户在画布上点击的任意输入框
  useEffect(() => {
    const capture = (el: Element | null): void => {
      if (isExternalMathField(el)) {
        targetRef.current = el;
        setTargetLabel(describeControl(el));
        setNativeMathTarget(true);
        setNotice('');
        if (open) window.mathVirtualKeyboard?.show();
        return;
      }
      if (!isExternalTextControl(el)) return;
      targetRef.current = el;
      selectionRef.current = {
        start: el.selectionStart ?? el.value.length,
        end: el.selectionEnd ?? el.value.length,
      };
      const nextOut = inferOutputMode(el);
      const nextWrite = inferWriteMode(el);
      outputModeRef.current = nextOut;
      writeModeRef.current = nextWrite;
      setNativeMathTarget(false);
      setTargetLabel(describeControl(el));
      setOutputMode(nextOut);
      setWriteMode(nextWrite);
      setNotice('');
      if (open) {
        pullFromTarget(el, nextOut, nextWrite);
      }
    };

    capture(document.activeElement);
    const onFocusIn = (event: FocusEvent): void => {
      capture(event.target instanceof Element ? event.target : null);
    };
    const onSelectionChange = (): void => {
      const active = document.activeElement;
      if (isExternalTextControl(active) && active === targetRef.current) {
        selectionRef.current = {
          start: active.selectionStart ?? active.value.length,
          end: active.selectionEnd ?? active.value.length,
        };
      }
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [open]);

  // 挂载内置 <math-field> 并把 MathLive 官方虚拟键盘嵌入同一张圆角卡片内部
  useEffect(() => {
    if (!open) {
      const kbd = window.mathVirtualKeyboard;
      if (kbd?.visible) kbd.hide();
      return;
    }

    const fieldHost = fieldHostRef.current;
    const kbdHost = kbdHostRef.current;
    if (!fieldHost || !kbdHost) return;

    MathfieldElement.fontsDirectory = null;
    const mf = new MathfieldElement();
    mf.setAttribute('aria-label', '公式键盘输入条');
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.className = styles.mathFieldEl ?? '';
    fieldRef.current = mf;
    fieldHost.append(mf);

    const onInput = (): void => {
      const currentTex = mf.value;
      setLatexValue(currentTex);
      if (suppressSyncRef.current) return;
      const target = targetRef.current;
      if (!target || !target.isConnected) {
        setNotice('请先点击画布上任意输入框，再通过键盘输入公式');
        return;
      }
      if (isExternalMathField(target)) return;
      if (writeModeRef.current === 'sync') {
        writeControlledValue(target, convertForTarget(currentTex, outputModeRef.current));
        setNotice('');
      }
    };
    mf.addEventListener('input', onInput);

    if (targetRef.current && targetRef.current.isConnected && !isExternalMathField(targetRef.current)) {
      pullFromTarget(targetRef.current, outputModeRef.current, writeModeRef.current);
    }

    const kbd = window.mathVirtualKeyboard;
    const prevContainer = kbd?.container ?? document.body;
    if (kbd) {
      kbd.container = kbdHost;
    }

    const timer = window.setTimeout(() => {
      if (targetRef.current && isExternalMathField(targetRef.current)) {
        targetRef.current.focus();
      } else {
        mf.focus();
      }
      kbd?.show();
    }, 30);

    return () => {
      window.clearTimeout(timer);
      mf.removeEventListener('input', onInput);
      if (kbd) {
        if (kbd.visible) kbd.hide();
        kbd.container = prevContainer;
      }
      mf.remove();
      fieldRef.current = null;
    };
  }, [open]);

  // Esc 收起
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleInsertIntoTarget = (): void => {
    const target = targetRef.current;
    if (!target || !target.isConnected || isExternalMathField(target)) {
      setNotice('请先点击画布上要插入公式的输入框');
      return;
    }
    const text = convertForTarget(latexValue, outputMode);
    if (!text) {
      setNotice('请先通过下方键盘输入公式');
      return;
    }
    const start = Math.max(0, Math.min(selectionRef.current.start, target.value.length));
    const end = Math.max(start, Math.min(selectionRef.current.end, target.value.length));
    const nextValue = target.value.slice(0, start) + text + target.value.slice(end);
    const caret = start + text.length;
    writeControlledValue(target, nextValue, caret, caret);
    selectionRef.current = { start: caret, end: caret };
    setNotice(`已插入「${text}」`);
  };

  const handleClear = (): void => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.value = '';
    setLatexValue('');
    const target = targetRef.current;
    if (writeMode === 'sync' && target && target.isConnected && !isExternalMathField(target)) {
      writeControlledValue(target, '');
    }
    mf.focus();
  };

  const handleModeChange = (nextMode: OutputMode): void => {
    setOutputMode(nextMode);
    const target = targetRef.current;
    if (writeMode === 'sync' && target && target.isConnected && !isExternalMathField(target) && latexValue) {
      writeControlledValue(target, convertForTarget(latexValue, nextMode));
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

  return (
    <section
      className={styles.unifiedDock}
      data-mathlive-keypad="true"
      aria-label="公式软键盘"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
    >
      <div className={styles.topSection}>
        <header
          className={styles.dockHeader}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          title="按住可拖动键盘位置"
        >
          <div className={styles.titleGroup}>
            <span className={styles.dragDots} aria-hidden="true">⋮⋮</span>
            <strong className={styles.title}>公式键盘</strong>
            <span className={styles.targetBadge} title={targetLabel || '未锁定输入框'}>
              {targetLabel ? `→ ${targetLabel}` : '请先点击画布上任意输入框'}
            </span>
          </div>

          <div className={styles.headerActions}>
            {!nativeMathTarget ? (
              <div className={styles.modeSwitch} role="group" aria-label="输出格式">
                <button
                  type="button"
                  className={styles.modeBtn}
                  aria-pressed={outputMode === 'expr'}
                  onClick={() => handleModeChange('expr')}
                  title="转为函数表达式，如 sqrt(x^2+1)"
                >
                  表达式
                </button>
                <button
                  type="button"
                  className={styles.modeBtn}
                  aria-pressed={outputMode === 'latex'}
                  onClick={() => handleModeChange('latex')}
                  title="输出标准 LaTeX 公式源码"
                >
                  LaTeX
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={styles.closeBtn}
              aria-label="收起公式键盘"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {!nativeMathTarget ? (
          <div className={styles.inputRow}>
            <div ref={fieldHostRef} className={styles.singleFieldHost} />
            {writeMode === 'insert' ? (
              <button
                type="button"
                className={styles.insertBtn}
                onClick={handleInsertIntoTarget}
              >
                插入
              </button>
            ) : null}
            <button type="button" className={styles.clearBtn} onClick={handleClear}>
              清空
            </button>
          </div>
        ) : (
          <>
            <div ref={fieldHostRef} style={{ display: 'none' }} />
            <p className={styles.nativeHint}>正在编辑公式卡片，直接点下方键盘输入即可。</p>
          </>
        )}

        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      </div>

      {/* MathLive 官方虚拟键盘无缝嵌入到同一张暖纸面圆角卡片下半部 */}
      <div ref={kbdHostRef} className={styles.kbdHost} />
    </section>
  );
}
