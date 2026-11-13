import type { PredictionQuestion } from './predictions';
import styles from './PredictionPanel.module.css';

interface Props {
  question: PredictionQuestion;
  phase: 'ask' | 'locked' | 'revealed';
  response: string;
  correct: boolean | null;
  onChange: (value: string) => void;
  onLock: () => void;
  onReveal: () => void;
  onReset: () => void;
}

export function PredictionPanel({ question, phase, response, correct, onChange, onLock, onReveal, onReset }: Props) {
  const locked = phase !== 'ask';
  return (
    <section className={styles.panel} data-phase={phase} aria-live="polite">
      <header>
        <p className={styles.kicker}>先猜后验 · PREDICT</p>
        <h3>{question.prompt}</h3>
        <p>答案由确定性内核算出；锁定前不显示结果视图。改动参数会重新出题。</p>
      </header>
      {question.kind === 'numeric' ? (
        <label className={styles.numeric}>
          <span>你的预测{question.unit ? `（${question.unit}）` : ''}</span>
          <input
            type="number"
            value={response}
            disabled={locked}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !locked) onLock(); }}
            aria-label="预测数值"
          />
        </label>
      ) : (
        <div className={styles.options} role="group" aria-label="选择预测">
          {(question.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              disabled={locked}
              aria-pressed={response === option}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {phase === 'ask' ? (
        <button type="button" className={styles.lock} disabled={!response.trim()} onClick={onLock}>锁定预测</button>
      ) : null}
      {phase === 'locked' ? (
        <div className={styles.revealBox}>
          <p>已锁定：<b>{response}{question.kind === 'numeric' && question.unit ? ` ${question.unit}` : ''}</b></p>
          <button type="button" className={styles.lock} onClick={onReveal}>揭晓结果</button>
        </div>
      ) : null}
      {phase === 'revealed' ? (
        <div className={styles.result} data-correct={correct ? 'true' : 'false'}>
          <b>{correct ? '预测正确' : '与结果不同'}</b>
          <p>你的预测：{response}{question.unit ? ` ${question.unit}` : ''} · 实际：{question.answer}{question.unit ? ` ${question.unit}` : ''}</p>
          <p>{question.explanation}</p>
          <button type="button" className={styles.ghost} onClick={onReset}>重新预测</button>
        </div>
      ) : null}
    </section>
  );
}

export default PredictionPanel;
