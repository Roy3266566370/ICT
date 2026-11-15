import { useState } from 'react';
import type { LabOrchestration } from '@/labs/types';
import { errorMessage } from '@/api/client';

export function CompositeSolvePanel({ result, onSolve }: {
  result: LabOrchestration;
  onSolve: (text: string) => Promise<unknown>;
}): JSX.Element {
  const [text, setText] = useState(result.problem.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const solve = async (): Promise<void> => {
    if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try { await onSolve(text.trim()); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const plannerNode = result.planner;
  const plannerLabel = plannerNode?.mode === 'ai' ? 'AI 计划'
    : plannerNode?.error ? '规则兜底' : '确定性规则计划';
  const errors = result.plan_check?.errors ?? [];
  const warnings = [...new Set([
    ...(result.plan_check?.warnings ?? []),
    ...(result.understanding?.ai_warnings ?? []),
  ])];
  const adjustments = result.solve.adjustments ?? [];
  const provenance = result.solve.provenance ?? [];
  const planSteps = result.plan?.steps ?? [];
  return <section aria-label="完整题目与分问解答" style={{ padding: '16px 0' }}>
    <div aria-label="规划诊断" style={{ marginBottom: 10 }}>
      <p aria-label="规划来源" style={{ margin: '0 0 4px' }}>
        规划：<strong>{plannerLabel}</strong>
        {plannerNode?.error ? ' · AI 规划失败，已回退' : ''}
      </p>
      {plannerNode?.error ? <p role="status" style={{ margin: '0 0 4px' }}>AI 规划失败原因：{plannerNode.error}</p> : null}
      {result.understanding?.ai_error ? <p role="status" style={{ margin: '0 0 4px' }}>AI 理解失败：{result.understanding.ai_error}</p> : null}
      {errors.map((note, index) => <p key={`error-${index}`} role="alert" style={{ margin: '0 0 4px' }}>{note}</p>)}
      {warnings.length ? <div aria-label="规划校验警告">
        <strong>校验警告</strong>
        <ul style={{ margin: '4px 0 0' }}>{warnings.map((note, index) => <li key={`warning-${index}`}>{note}</li>)}</ul>
      </div> : null}
    </div>
    <details open={result.stale || result.status !== '完成' || errors.length > 0 || warnings.length > 0}>
      <summary>完整题目与分问解答 · {result.stale ? '条件已修改，请重新求解' : result.status}</summary>
      <label style={{ display: 'block', marginTop: 12 }}>完整题目
        <textarea aria-label="修改完整题目" value={text} onChange={(event) => setText(event.target.value)}
          rows={4} disabled={busy} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} />
      </label>
      <button type="button" disabled={busy || !text.trim()} onClick={() => void solve()}>
        {busy ? '正在理解与计算…' : '重新理解并求解'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {result.stale ? <p>分问条件已有修改，原汇总已失效。修改上方完整题目后重新求解。</p> : <>
        {result.note ? <p>{result.note}</p> : null}
        <ol>{result.answers.map((answer, index) => <li key={`${answer.subquestion}-${index}`}>
          <strong>{answer.goal || answer.subquestion}</strong>：{answer.answer || answer.state || '尚未完成'}
        </li>)}</ol>
        <details><summary>计算步骤</summary><ol>{result.solve.steps.map((step) => <li key={step.id}>
          {step.goal} · {step.state}{step.capability ? ` · ${step.capability}` : ''}{step.detail ? <p>{step.detail}</p> : null}
        </li>)}</ol></details>
        {planSteps.length ? <details><summary>实际执行计划（{planSteps.length} 步）</summary>
          <ol>{planSteps.map((step) => <li key={step.id}>
            {step.id} · {step.goal || '未命名步骤'} · {step.capability || '未知能力'}
            {step.subquestion ? ` · 小问 ${step.subquestion}` : ''}
          </li>)}</ol>
        </details> : null}
        {adjustments.length ? <details><summary>计划调整（{adjustments.length} 次）</summary>
          <ol>{adjustments.map((item, index) => <li key={`adjustment-${index}`}>
            {item.step}：{item.from || item.result || '调整'}{item.to ? ` → ${item.to}` : ''}
            {item.reason ? `（${item.reason}）` : ''}
            {item.error ? `（${item.error}）` : ''}
            {item.rejected?.length ? <ul>{item.rejected.map((note, rejectedIndex) =>
              <li key={`rejected-${rejectedIndex}`}>已拒绝：{note}</li>)}</ul> : null}
            {item.from_inputs || item.to_inputs ? <details><summary>替换前后输入</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify({
                from: item.from_inputs, to: item.to_inputs,
              }, null, 2)}</pre>
            </details> : null}
          </li>)}</ol>
        </details> : null}
        {provenance.length ? <details><summary>来源记录</summary>
          <ul>{provenance.map((row, index) => <li key={`provenance-${index}`}>
            {row.step} · {row.item} · {row.source}{row.detail ? `：${row.detail}` : ''}
          </li>)}</ul>
        </details> : null}
        <p>在题目列表中选择分问，可查看对应内核生成的模型与计算过程。</p>
      </>}
      {result.previous_summary ? <details><summary>上一次题目结果</summary><ul>
        {result.previous_summary.answers.map((answer, index) => <li key={index}>{answer.goal}：{answer.answer || '尚未完成'}</li>)}
      </ul></details> : null}
    </details>
  </section>;
}
