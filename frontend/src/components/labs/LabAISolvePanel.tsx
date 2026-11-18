import { useEffect, useRef, useState } from 'react';
import type { LabProblem } from '@/labs/types';
import { errorMessage } from '@/api/client';
import { MathText } from './ProblemText';
import { LabFormula as Formula } from './ProblemText';
import { needsAutomaticAISolve } from '@/labs/autoAI';
import styles from './LabAISolvePanel.module.css';

const STAGE_LABELS: Record<string, string> = {
  ocr: '读取原稿',
  quality: '文字质量检查',
  classify: '学科判断',
  local_build: '本地建模',
  ai_read: 'AI 读题',
  ai_model: 'AI 建模',
  validate: '条件校验',
  kernel: '内核计算',
  attach: '应用到题目',
};

const NEXT_STEPS: Record<string, string> = {
  OCR_GARBLED: '请对照原图核对或修正转写文字，再重试。',
  LOCAL_LOW_COVERAGE: '本地方案不完整，请确认题目条件后让 AI 重新建模。',
  AI_TIMEOUT: '稍后重试，或把题目拆成更小的问。',
  AI_CONNECT_ERROR: '请检查后端配置的模型服务地址、网络或本机代理设置后重试。',
  AI_BAD_JSON: '重试一次；如果仍失败，请手动核对条件。',
  AI_CHOSE_NONE: '可以直接使用参考解答，或补充可计算的表达式后重试。',
  NO_TASK_MATCH: '使用通用建模或参考解答；也可以把题目拆成可计算的小问。',
  MISSING_CONDITIONS: '在“条件”里补齐缺失项后重新计算。',
  UNMAPPED_CONDITIONS: '检查原题中是否有未进入模型的条件，确认后再计算。',
  KERNEL_ERROR: '检查表达式与条件是否符合目录约束，或改用参考解答。',
  KERNEL_TIMEOUT: '简化表达式或拆题后重试。',
  KERNEL_AI_MISMATCH: '对照两个结果核对表达式与条件；确认前不自动判分。',
};

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
  const hasReference = Boolean(
    solution?.reference_answer?.trim() ||
    (solution?.verification === 'ai_reference' && solution.answer?.trim() && solution.answer.trim() !== '尚无内核计算结果')
  );
  const needsHelp = !hasKernel && !action;
  const failureTitle = solution?.failure_stage === 'task_support' ? '当前题型尚不支持'
    : solution?.failure_stage === 'source_coverage' ? '原题条件尚未完整对应到模型'
    : solution?.failure_stage === 'model_mapping' ? '题目条件转换为模型时失败'
    : solution?.missing_conditions.length ? '请补充题目条件' : '当前未能完成题目计算';
  const trace = solution?.trace ?? [];
  // Prefer the entry that actually explains the failure (code/reason) over the
  // trailing "kept the reference answer" note, which has no reason code.
  const failedTrace = [...trace].reverse().find((item) => item.status !== 'ok' && (item.reason || item.code))
    ?? [...trace].reverse().find((item) => item.status !== 'ok') ?? null;
  return <section className={hasKernel ? undefined : styles.panel} aria-label="实验准备与计算结果">
    {action ? <p role="status">{action === 'check' ? '正在检验…' : problem.source_pages.some(page => !!page.image_key) ? '正在对照原图识别公式并准备实验…' : '正在准备可视化实验…'}</p> : null}
    {solution?.source_recovery?.attempted ? <p role="status">{solution.source_recovery.status === 'recovered'
      ? '已结合原图及放大局部重新识别，正在使用新的题干与公式。'
      : '已尝试对照原图及放大局部重新识别；仍不清晰的符号需要补充清晰原图或手动修正。'}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {needsHelp ? <>
      <h3>{solution?.verification === 'ai_reference' ? 'AI 参考解答' : solution ? failureTitle : '准备实验'}</h3>
      {failedTrace ? <div className={styles.traceCard} role="status">
        <strong>为什么没跑通</strong>
        <p>停在：{STAGE_LABELS[failedTrace.stage] ?? failedTrace.stage}</p>
        <p>{failedTrace.reason ?? failedTrace.code ?? '未给出原因码'}{failedTrace.detail ? `：${failedTrace.detail}` : ''}</p>
        <p>下一步：{NEXT_STEPS[failedTrace.code ?? ''] ?? '请对照原题核对条件后重试。'}</p>
      </div> : null}
      {solution?.model_comparison ? <div className={styles.traceCard}>
        <strong>本地识别与 AI 模型不一致</strong>
        <p>本地：{solution.model_comparison.local.answer || '—'}</p>
        <p>AI：{solution.model_comparison.ai.answer || '—'}</p>
        <p>{solution.model_comparison.note}</p>
      </div> : null}
      {solution?.missing_conditions.length ? <ul>{solution.missing_conditions.map((c,i) => <li key={i}><MathText text={c} /></li>)}</ul> : null}
      {!configured ? <p>模型服务尚未配置或不可用，请检查后端模型服务配置后重试。</p> : null}
      {onSolve ? <button type="button" disabled={!!action || !configured || !autoReady} onClick={() => void solve('auto')}>重新准备实验</button> : null}
    </> : null}
    {hasKernel ? <h3>计算结果与步骤{solution?.verification_level === 'kernel_numeric' ? '（数值解核验）' : ''}</h3> : null}
      {solution?.verification_level === 'kernel_numeric' ? <p className={styles.notice}>符号求解失败，已用数值解并通过代回；判分按数值容差比较。</p> : null}
      {solution ? <details className={styles.panel} open={!hasKernel}>
      <summary>{hasKernel ? '查看计算结果与步骤' : hasReference ? '查看已识别题意与参考解答' : '查看已识别题意与条件'}</summary>
      {!hasKernel ? <>
        <p className={styles.notice}>{hasReference ? '以下为 AI 参考解答，未经内核核验，不用于自动判分。' : '当前仅完成题目转写与条件提取；本地模型未生成参考解答。'}</p>
        {solution.question ? <p><MathText text={solution.question} /></p> : null}
        {solution.interpretation && solution.interpretation !== solution.question ? <p><MathText text={solution.interpretation} /></p> : null}
        {solution.conditions.length ? <ul>{solution.conditions.map((condition, i) => <li key={i}><MathText text={condition} /></li>)}</ul> : null}
      </> : null}
      {solution.source_review_required ? <p className={styles.notice}>{hasKernel ? '原图尚待核对，以下为当前模型的试算结果。' : '原图尚待核对，请检查识别出的题干与条件。'}</p> : null}
      {hasKernel && onSolve && problem.source_pages.some(page => !!page.image_key) ? <button type="button" disabled={!!action || !configured || !autoReady}
        onClick={() => void solve('auto')}>重新识别原图</button> : null}
      {solution.answer && (hasKernel || hasReference) ? <p className={styles.answerText}><MathText text={solution.answer} /></p> : null}
      {solution.ai_reference_answer ? <div className={styles.traceCard}>
        <strong>AI 参考答案（与内核结果不一致）</strong>
        <p><MathText text={solution.ai_reference_answer} /></p>
      </div> : null}
      <ol>{solution.steps.map((s,i) => <li key={i}><strong><MathText text={s.title} /></strong><p><MathText text={s.detail} /></p>{s.latex ? <Formula tex={s.latex} block /> : null}</li>)}</ol>
      {solution.computation?.checks.map(c => <p key={c.id}><MathText text={c.label} />：<MathText text={c.detail} /></p>)}
      {solution.limitations.map((item, i) => <p key={`limit-${i}`} role="status"><MathText text={item} /></p>)}
      <p className={styles.meta}>{hasKernel ? '计算与复核针对当前模型；请对照原题确认条件。' : hasReference ? '参考解答由 AI 生成；请对照原题核对条件和推导。' : '如需直接解析超纲多问或复合推导题，可配置云端大模型或切换手动单问输入。'}</p>
      {hasKernel && onCheck && solution.checkable ? <details>
        <summary>检验我的答案</summary>
        <label>我的答案<input aria-label="AI 题目答案" value={answer} onChange={e => setAnswer(e.target.value)} /></label>
        <button type="button" disabled={!!action || !answer.trim()} onClick={() => void check()}>检验答案</button>
        {feedback ? <p role="status"><MathText text={feedback.feedback} /></p> : null}
      </details> : null}
    </details> : null}
  </section>;
}
