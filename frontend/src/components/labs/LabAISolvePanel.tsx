import { useEffect, useRef, useState } from 'react';
import type { LabProblem } from '@/labs/types';
import { errorMessage } from '@/api/client';
import { MathText } from './ProblemText';
import { Formula } from '@/components/showcase/Formula';
import { needsAutomaticAISolve } from '@/labs/autoAI';
import styles from './LabAISolvePanel.module.css';

interface Props {
  problem: LabProblem;
  configured?: boolean;
  autoReady?: boolean;
  onSolve?: (mode: 'auto' | 'direct') => Promise<void>;
  onCheck?: (answer: string) => Promise<{ correct: boolean; feedback: string }>;
}

export function LabAISolvePanel({ problem, configured, autoReady = true, onSolve, onCheck }: Props) {
  const solution = problem.ai_solution;
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean; feedback: string } | null>(null);
  const attemptedInputs = useRef(new Set<string>());
  const automatic = needsAutomaticAISolve(problem);
  const solve = async (mode: 'auto' | 'direct') => {
    if (!onSolve) return;
    setAction(mode); setError(''); setFeedback(null);
    try { await onSolve(mode); }
    catch (e) { setError(errorMessage(e)); }
    finally { setAction(''); }
  };
  const check = async () => {
    if (!onCheck) return;
    setAction('check'); setError('');
    try { setFeedback(await onCheck(answer)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setAction(''); }
  };
  useEffect(() => {
    if (!automatic || !configured || !autoReady || !onSolve || action) return;
    const input = JSON.stringify([problem.problem_id, problem.text, problem.recognition.ambiguities]);
    if (attemptedInputs.current.has(input)) return;
    // 先记录再调用，避免 StrictMode、保存回写或失败后的重渲染重复请求。
    attemptedInputs.current.add(input);
    void solve('auto');
  }, [automatic, configured, autoReady, onSolve, action, problem]);
  if (!onSolve && !solution) return null;
  const hasKernel = solution?.verification === 'kernel' && !!solution.computation;
  const needsHelp = !hasKernel && !action;
  const failureTitle = solution?.failure_stage === 'task_support' ? '当前题型尚不支持'
    : solution?.failure_stage === 'source_coverage' ? '原题条件尚未完整对应到模型'
    : solution?.failure_stage === 'model_mapping' ? '题目条件转换为模型时失败'
    : solution?.missing_conditions.length ? '请补充题目条件' : '当前未能完成题目计算';
  return <section className={hasKernel ? undefined : styles.panel} aria-label="实验准备与计算结果">
    {action ? <p role="status">{action === 'check' ? '正在检验…' : '正在准备可视化实验…'}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {needsHelp ? <>
      <h3>{solution ? failureTitle : '准备实验'}</h3>
      {solution?.missing_conditions.length ? <ul>{solution.missing_conditions.map((c,i) => <li key={i}>{c}</li>)}</ul> : null}
      {solution?.limitations.length ? <ul>{solution.limitations.map((c,i) => <li key={i}>{c}</li>)}</ul> : null}
      {!configured ? <p>本地模型服务尚未就绪，请启动 Ollama 后重试。</p> : null}
      {onSolve ? <button type="button" disabled={!!action || !configured || !autoReady} onClick={() => void solve('auto')}>重新准备实验</button> : null}
    </> : null}
    {hasKernel && solution ? <details className={styles.panel}>
      <summary>查看计算结果与步骤</summary>
      {solution.source_review_required ? <p className={styles.notice}>原图尚待核对，以下为当前模型的试算结果。</p> : null}
      <p className={styles.answerText}><MathText text={solution.answer} /></p>
      <ol>{solution.steps.map((s,i) => <li key={i}><strong>{s.title}</strong><p><MathText text={s.detail} /></p>{s.latex ? <Formula tex={s.latex} block /> : null}</li>)}</ol>
      {solution.computation?.checks.map(c => <p key={c.id}>{c.label}：{c.detail}</p>)}
      {solution.limitations.map((item, i) => <p key={`limit-${i}`} role="status">{item}</p>)}
      <p className={styles.meta}>计算与复核针对当前模型；请对照原题确认条件。</p>
      {onCheck && solution.checkable ? <details>
        <summary>检验我的答案</summary>
        <label>我的答案<input aria-label="AI 题目答案" value={answer} onChange={e => setAnswer(e.target.value)} /></label>
        <button type="button" disabled={!!action || !answer.trim()} onClick={() => void check()}>检验答案</button>
        {feedback ? <p role="status">{feedback.feedback}</p> : null}
      </details> : null}
    </details> : null}
  </section>;
}
