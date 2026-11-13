import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { ProblemText } from './ProblemText';
import type { LabDocument, LabProblem, LabResult } from '@/labs/types';
import { currentMetrics } from '@/labs/compute';
import styles from './labs.module.css';

interface Props {
  open: boolean;
  lab: LabDocument;
  problem: LabProblem;
  result: LabResult;
  step: number;
  previewUrl: (key: string) => string;
  onClose: () => void;
}

export function OriginalCompare({
  open,
  lab,
  problem,
  result,
  step,
  previewUrl,
  onClose,
}: Props): ReactNode {
  const pages = useMemo(
    () =>
      lab.source.pages.filter((page) =>
        problem.source_pages.some((item) => item.file_id === page.file_id && item.page === page.page),
      ),
    [lab.source.pages, problem.source_pages],
  );
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open, problem.problem_id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const metrics = currentMetrics(result, step);

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`${styles.compareDialog} ${styles.wideDialog}`} role="dialog" aria-modal="true" aria-labelledby="lab-compare-title">
        <header className={styles.modalHead}>
          <div>
            <span className={styles.eyebrow}>SOURCE ↔ MODEL</span>
            <h2 id="lab-compare-title">原稿对照</h2>
            <p>左侧是识别所用的原页，右侧是当前条件与计算结果；原稿不会因为调参而改变。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className={styles.compareBody}>
          <section className={styles.originalColumn} aria-label="原稿">
            <div className={styles.compareColumnHead}>
              <span>原稿</span>
              {pages.length > 1 ? (
                <div className={styles.pageSwitcher}>
                  {pages.map((item, index) => (
                    <button
                      key={`${item.file_id}-${item.page}`}
                      type="button"
                      aria-pressed={index === pageIndex}
                      onClick={() => setPageIndex(index)}
                    >
                      {item.page}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className={styles.originalPage}>
              {page?.image_key ? (
                <img src={previewUrl(page.image_key)} alt={`第 ${page.page} 页原稿`} />
              ) : page?.text ? (
                <pre className={styles.originalText}>{page.text}</pre>
              ) : (
                <p className={styles.emptyText}>这份来源没有可显示的原页预览；请查看右侧识别条件与题目原文。</p>
              )}
            </div>
            <p className={styles.citationLine}>
              {lab.source.citation} · {page?.method ?? problem.recognition.method}
            </p>
          </section>

          <section className={styles.modelColumn} aria-label="当前模型">
            <div className={styles.compareColumnHead}>
              <span>当前模型</span>
              <strong>{problem.title}</strong>
            </div>
            <div className={styles.modelSummary}>
              <ProblemText text={problem.text} />
              <div className={styles.formulaList}>
                {problem.recognition.formulas.map((formula) => (
                  <div key={formula.id} className={styles.formulaBlock}>
                    <Formula tex={formula.tex} block />
                    <span>{formula.role}</span>
                  </div>
                ))}
              </div>
              <dl className={styles.compareMetrics}>
                {metrics.map((item) => (
                  <div key={item.id}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
              <div className={styles.compareAnswer}>
                <span>当前解答</span>
                <strong>{problem.solution.answer || result.headline}</strong>
              </div>
              <div className={styles.compareConditions}>
                <span>识别条件</span>
                {problem.recognition.conditions.map((condition) => (
                  <p key={condition.id}>
                    <b>{condition.label}</b>
                    <code>{String(condition.value)}</code>
                    <em>{condition.provenance === 'original' ? '原题' : condition.provenance === 'supplement' ? '补充' : '推断'}</em>
                  </p>
                ))}
              </div>
            </div>
          </section>
        </div>
        <footer className={styles.modalFooter}>
          <span>原稿页来自上传文件；模型结果来自确定性求解器。</span>
          <button type="button" className={styles.primaryButton} onClick={onClose}>
            回到实验
          </button>
        </footer>
      </div>
    </div>
  );
}

export default OriginalCompare;
