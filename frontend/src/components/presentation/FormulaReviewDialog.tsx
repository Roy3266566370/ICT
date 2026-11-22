import {useEffect, useRef, useState} from 'react';
import type {MathfieldElement} from 'mathlive';
import styles from './DeckPlayer.module.css';

interface Props {
  imageUrl: string;
  draft: string;
  reason: string;
  busy: boolean;
  message: string;
  onClose: () => void;
  onConfirm: (latex: string) => void;
}

/** 清洗 OCR 产出的残缺矩阵（重复 \begin{matrix}、空占位列、不匹配的 \left[ / \right]），转为标准 bmatrix，保留真实列对齐。 */
function normalizeDraftLatex(raw: string): string {
  let text = raw.trim();
  // 1. 压缩 Pix2Text 常见的重复嵌套 \begin{matrix} {\begin{matrix}
  text = text.replace(/\\begin\{(matrix|array)\}\s*\{\s*\\begin\{\1\}/g, '\\begin{$1}');
  // 2. 清理无意义的空装饰项（如 {\overline{{}}} / {\underline{{}}}）
  text = text.replace(/\{\s*\\(?:overline|underline)\s*\{\s*\{\s*\}\s*\}\s*\}/g, '');
  // 3. 统一把 \left[ \begin{array|matrix} ... \end{array|matrix} \right] 转为标准 bmatrix
  const matRe = /\\left\s*\[\s*\\begin\{(array|matrix)\}(?:\s*\{[^}]*\})?([\s\S]*?)\\end\{\1\}\s*(?:\\right\s*\])?/g;
  text = text.replace(matRe, (_, _env: string, inner: string) => {
    const rawRows = inner
      .split(/\\\\/)
      .map(row =>
        row
          .split('&')
          .map(cell => cell.replace(/^\s*\{\s*([^{}]*)\s*\}\s*$/, '$1').trim()),
      )
      .filter(cells => cells.some(cell => cell.length > 0));
    if (!rawRows.length) return '';
    const maxCols = Math.max(...rawRows.map(r => r.length));
    const paddedRows = rawRows.map(r => {
      const copy = [...r];
      while (copy.length < maxCols) copy.push('');
      return copy;
    });
    // 只剔除在所有非空行中都为空的“纯间距占位列”，保持缺字单元格原本所在的列位置（如右下角 0 不再被左移到左下角）。
    const activeCols: number[] = [];
    for (let c = 0; c < maxCols; c += 1) {
      if (paddedRows.some(row => (row[c] ?? '').length > 0)) {
        activeCols.push(c);
      }
    }
    const colsToKeep = activeCols.length ? activeCols : [0];
    const body = paddedRows
      .map(row => colsToKeep.map(c => row[c] ?? '').join(' & '))
      .join(' \\\\ ');
    return `\\begin{bmatrix} ${body} \\end{bmatrix}`;
  });
  return text;
}

export function FormulaReviewDialog({imageUrl, draft, reason, busy, message, onClose, onConfirm}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const cleanedDraft = normalizeDraftLatex(draft);
  const [latex, setLatex] = useState(cleanedDraft);
  const [rawMode, setRawMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.max(1, Math.floor((Date.now() - started) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    setLatex(cleanedDraft);
    let live = true;
    function sync() {
      if (field.current) setLatex(field.current.value);
    }
    void import('mathlive').then(() => {
      if (!live || !host.current) return;
      // 确保 MathLive 虚拟键盘挂载在 body 且层级高于公式核对遮罩层。
      const vk = (window as unknown as { mathVirtualKeyboard?: { container?: HTMLElement | null } }).mathVirtualKeyboard;
      if (vk) vk.container = document.body;
      const input = document.createElement('math-field') as MathfieldElement;
      input.setAttribute('aria-label', 'MathLive 公式编辑');
      input.value = cleanedDraft;
      input.addEventListener('input', sync);
      host.current.append(input);
      field.current = input;
      setReady(true);
    }).catch(() => { if (live) setLoadError(true); });
    return () => {
      live = false;
      const vk = (window as unknown as { mathVirtualKeyboard?: { hide?: () => void } }).mathVirtualKeyboard;
      vk?.hide?.();
      field.current?.removeEventListener('input', sync);
      field.current?.remove();
      field.current = null;
    };
  }, [cleanedDraft]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);
  useEffect(() => {
    if (field.current) field.current.readOnly = busy;
  }, [busy, ready]);
  const updateLatex = (next: string) => {
    setLatex(next);
    if (field.current && field.current.value !== next) {
      field.current.value = next;
    }
  };
  const integralDraft = latex.replace(
    /^\s*(?:\\(?:mathrm|mathbf|mathit)\s*\{[dlf1]\}|[dlf1])(?=\s*[_^])/,
    '\\int',
  );
  const applyMatrixTemplate = () => {
    const prefixMatch = latex.match(/^(\s*(?:\\(?:mathrm|mathbf|mathit)\s*\{[A-Za-z]+\}|[A-Za-z])\s*=)/);
    const prefix = prefixMatch ? `${prefixMatch[1]} ` : '';
    updateLatex(`${prefix}\\begin{bmatrix} 0 & -1 \\\\ 1 & 0 \\end{bmatrix}`);
  };
  return <div className={styles.formulaReviewBackdrop}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.formulaReviewDialog} role="dialog" aria-modal="true" aria-labelledby="formula-review-title">
      <h2 id="formula-review-title">核对公式</h2>
      <p>{reason}</p>
      <img src={imageUrl} alt="待核对公式原图裁切"/>
      <div ref={host} hidden={rawMode}/>
      {(loadError || rawMode) && <label style={{display: 'block', marginTop: 8}}>
        <span style={{display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4}}>LaTeX 源码（可直接删改）：</span>
        <textarea rows={3} value={latex} disabled={busy} onChange={event => updateLatex(event.target.value)}/>
      </label>}
      {!ready && !loadError && <p role="status">正在加载公式编辑器…</p>}
      {message && <p role="status">{busy && elapsedSec > 0 ? `${message}（已耗时 ${elapsedSec}s）` : message}</p>}
      <div className={styles.formulaReviewActions}>
        {!loadError && <button type="button" disabled={busy} onClick={() => setRawMode(v => !v)}>
          {rawMode ? '切回可视化公式' : '编辑 LaTeX 源码'}
        </button>}
        <button type="button" disabled={busy} onClick={applyMatrixTemplate}>
          2×2 矩阵模板
        </button>
        {integralDraft !== latex && <button disabled={busy || !ready} onClick={() => updateLatex(integralDraft)}>
          将开头符号改为 ∫
        </button>}
        <button disabled={busy} onClick={onClose}>取消</button>
        <button disabled={busy || (!ready && !loadError) || !latex.trim()}
          onClick={() => onConfirm(latex.trim())}>{busy ? '正在重算…' : '确认并重算'}</button>
      </div>
    </div>
  </div>;
}
