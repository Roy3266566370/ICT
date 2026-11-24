import { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import { latexToPlain } from '../labs/mathLiveBridge.ts';
import { functionValue } from './calculus.ts';
import styles from './canvas.module.css';

const symbols = [
  ['分数', '□⁄□', '\\frac{#?}{#?}'],
  ['根号', '√', '\\sqrt{#?}'],
  ['上标', 'x²', '^{#?}'],
  ['下标', 'x₁', '_{#?}'],
  ['括号', '( )', '\\left(#?\\right)'],
  ['绝对值', '|x|', '\\left|#?\\right|'],
  ['积分', '∫', '\\int'],
  ['求和', '∑', '\\sum'],
  ['圆周率', 'π', '\\pi'],
  ['无穷大', '∞', '\\infty'],
  ['加号', '+', '+'],
  ['减号', '−', '-'],
  ['乘号', '×', '\\times'],
  ['等号', '=', '='],
  ['小数点', '.', '.'],
  ...['x', 'y', 'e', 'i'].map((letter) => ['字母 ' + letter, letter, letter]),
  ...Array.from('0123456789').map((digit) => ['数字 ' + digit, digit, digit]),
] as const;

const formulaOnly = new Set(['下标', '积分', '求和', '无穷大', '等号', '字母 y', '字母 i']);
const functionSymbols = [
  ['正弦', 'sin', '\\sin\\left(#?\\right)'],
  ['余弦', 'cos', '\\cos\\left(#?\\right)'],
  ['正切', 'tan', '\\tan\\left(#?\\right)'],
  ['指数', 'exp', '\\exp\\left(#?\\right)'],
  ['对数', 'ln', '\\ln\\left(#?\\right)'],
  ...['a', 'b', 'c'].map((letter) => ['字母 ' + letter, letter, letter]),
  ...symbols.filter(([label]) => !formulaOnly.has(label)),
] as const;

export default function FormulaCardEditor({ initialValue, onComplete, onCancel, functionMode = false }: {
  initialValue: string;
  onComplete: (tex: string) => void;
  onCancel: () => void;
  functionMode?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const startingValue = useRef(initialValue);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!host.current) return;
    MathfieldElement.fontsDirectory = null;
    const input = new MathfieldElement();
    input.setAttribute('aria-label', '可视化公式输入');
    input.mathVirtualKeyboardPolicy = 'manual';
    input.value = startingValue.current;
    field.current = input;
    host.current.append(input);
    input.focus();
    return () => {
      if (window.mathVirtualKeyboard?.visible) window.mathVirtualKeyboard.hide();
      input.remove();
      field.current = null;
    };
  }, []);

  const edit = (action: (input: MathfieldElement) => void) => {
    const input = field.current;
    if (!input) return;
    input.focus();
    action(input);
    setError('');
  };
  const complete = () => {
    const tex = field.current?.value.trim() ?? '';
    try {
      if (tex) katex.renderToString(tex, { throwOnError: true, strict: 'ignore' });
    } catch {
      setError('请补齐公式中的空位，或检查所用符号。');
      return;
    }
    if (!functionMode) { onComplete(tex); return; }
    try {
      if (!tex) throw new Error('请先输入函数。');
      const expression = latexToPlain(tex, true);
      functionValue(expression, {});
      onComplete(expression);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : '请检查函数表达式。');
    }
  };

  return <div className={styles.formulaEditor} aria-label="公式编辑器"
    onInput={() => setError('')} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
    }}>
    <div ref={host} className={styles.formulaField} />
    <div role="group" aria-label="公式符号" className={styles.formulaKeys}>
      {(functionMode ? functionSymbols : symbols).map(([label, glyph, latex]) => <button type="button" key={label}
        aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()}
        onClick={() => edit((input) => input.insert(latex, { format: 'latex', selectionMode: 'placeholder' }))}>{glyph}</button>)}
    </div>
    <div className={styles.formulaActions}>
      <button type="button" title="上一个位置" aria-label="上一个位置"
        onClick={() => edit((input) => input.executeCommand('moveToPreviousChar'))}>←</button>
      <button type="button" title="下一个位置" aria-label="下一个位置"
        onClick={() => edit((input) => {
          if (!input.executeCommand('moveToNextPlaceholder')) input.executeCommand('moveToNextChar');
        })}>→</button>
      <button type="button" title="删除前一项" aria-label="删除前一项"
        onClick={() => edit((input) => input.executeCommand('deleteBackward'))}>⌫</button>
      <button type="button" onClick={() => edit((input) => { input.value = ''; })}>清空</button>
      <button type="button" onClick={() => edit(() => window.mathVirtualKeyboard?.show())}>更多符号</button>
      <button type="button" onClick={onCancel}>取消</button>
      <button type="button" className={styles.finishFormula} onClick={complete}>{functionMode ? '应用函数' : '完成公式'}</button>
    </div>
    {error && <p role="alert" className={styles.formulaError}>{error}</p>}
  </div>;
}
