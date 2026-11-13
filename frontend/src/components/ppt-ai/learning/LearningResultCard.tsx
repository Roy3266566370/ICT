import type { LearningResultCard as LearningCard } from '@/ppt-ai/learning/types';
import styles from './LearningPanel.module.css';

interface Props {
  card: LearningCard;
  stale?: boolean;
}

export function LearningResultCard({ card, stale }: Props) {
  return (
    <article className={styles.card} data-stale={stale || card.stale ? 'true' : 'false'}>
      {stale || card.stale ? (
        <p className={styles.staleNote} role="status">这是上一组条件的结果；当前条件已变化，请重新求解。</p>
      ) : null}
      <header className={styles.cardHead}>
        <h3>{card.title}</h3>
        <span className={styles.cardKind}>{
          card.result_kind === 'target' ? '求解答案' : card.result_kind === 'experiment' ? '实验结果' : '讲解'
        }</span>
      </header>
      <p className={styles.conclusion}>{card.conclusion}</p>
      {card.solution ? (
        <div className={styles.solution}>
          <strong>
            {card.solution.unknowns.map((name, index) => `${name} = ${formatNumber(card.solution!.values[index] ?? 0)}`).join('，')}
          </strong>
          {card.solution.exact_values.length ? (
            <span>精确值：{card.solution.exact_values.join('，')}</span>
          ) : null}
          {card.solution.free_variables.length ? (
            <span>多解：自由变量 {card.solution.free_variables.join('，')}；这里展示一个可验证特解。</span>
          ) : null}
          {card.solution.equations.map((equation) => <code key={equation}>{equation}</code>)}
        </div>
      ) : null}
      {card.steps.length ? (
        <details className={styles.steps} open>
          <summary>关键过程（{card.steps.length} 步）</summary>
          <ol>{card.steps.slice(0, 8).map((step, index) => <li key={index}>{step}</li>)}</ol>
        </details>
      ) : null}
      {card.verification.length ? (
        <ul className={styles.verification} aria-label="验证">
          {card.verification.map((item) => (
            <li key={item.label} data-status={item.status}>
              <b>{item.label}</b>
              <span>{item.expected ? `期望 ${item.expected} · ` : ''}{item.actual}</span>
              {item.residual !== null ? <small>残差 {formatNumber(item.residual, 10)}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {card.limitations.length ? (
        <div className={styles.limitations}>
          <b>适用范围</b>
          <ul>{card.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      {card.next_actions.length ? (
        <p className={styles.nextActions}>下一步：{card.next_actions.join(' · ')}</p>
      ) : null}
    </article>
  );
}

function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value - Math.round(value)) < 1e-10) return String(Math.round(value));
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

export default LearningResultCard;
