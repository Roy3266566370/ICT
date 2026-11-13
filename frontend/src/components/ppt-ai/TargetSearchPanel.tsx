import { useMemo, useState } from 'react';
import { evaluateNode, formatValue } from '@/ppt-ai/runtime/evaluate';
import type { BranchState, CanonicalValue, InteractionBundle, TargetResult } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

interface Props {
  bundle: InteractionBundle | null;
  branch: BranchState | null;
  result: TargetResult | null;
  busy: boolean;
  status: string;
  onSolve: (input: {
    nodeId: string; output: string; targetValue: number; targetVector: number[] | null;
    variables: string[]; ranges: Record<string, [number, number]>; tolerance: number;
  }) => void;
  onOpenBranch: (branchId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  found: '找到解',
  multiple: '存在多个候选',
  none_in_scope: '范围内未找到',
  unknown: '未知',
  timeout: '超时',
  infeasible_proven: '已证无解',
};

export function TargetSearchPanel({ bundle, branch, result, busy, status, onSolve, onOpenBranch }: Props) {
  const nodes = bundle?.compiled.nodes ?? [];
  const [nodeId, setNodeId] = useState('');
  const node = nodes.find((item) => item.node_id === nodeId) ?? nodes[0] ?? null;
  const numeric = node?.parameters.filter((parameter) => ['number', 'integer', 'enum', 'boolean'].includes(parameter.type)) ?? [];
  const numericOnly = node?.parameters.filter((parameter) => parameter.type === 'number' || parameter.type === 'integer') ?? [];
  const [variables, setVariables] = useState<string[]>([]);
  const activeVariables = variables.length ? variables : numeric.slice(0, 1).map((parameter) => parameter.concept_id);
  const [output, setOutput] = useState('');
  const [target, setTarget] = useState('0');
  const [vector, setVector] = useState('4,3');
  const [tolerance, setTolerance] = useState('0.000001');
  const [low, setLow] = useState<number | ''>('');
  const [high, setHigh] = useState<number | ''>('');
  const values = useMemo(() => {
    const map: Record<string, CanonicalValue> = {};
    node?.parameters.forEach((parameter) => {
      map[parameter.concept_id] = branch?.canonical_values?.[parameter.concept_id] ?? parameter.default;
    });
    return map;
  }, [node, branch]);
  const evaluation = useMemo(() => (node ? evaluateNode(node, values) : null), [node, values]);
  const first = numericOnly.find((parameter) => activeVariables.includes(parameter.concept_id)) ?? numericOnly[0];
  const activeParameter = numeric.find((parameter) => activeVariables.includes(parameter.concept_id)) ?? numeric[0];
  const isDiscrete = activeParameter?.type === 'enum' || activeParameter?.type === 'boolean';
  const effectiveLow = low === '' ? first?.min ?? -5 : low;
  const effectiveHigh = high === '' ? first?.max ?? 5 : high;
  const isVectorProduct = output === 'product' || output === 'Av' || output === 'Ax';

  if (!bundle || !branch) {
    return (
      <section className={styles.panel}>
        <header className={styles.panelHead}><div><h2>5 · 目标反求</h2><p>先采用交互规划并创建分支，再使用结构化目标表单。</p></div></header>
        <div className={styles.panelBody}><p className={styles.empty}>当前没有可用分支。</p></div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-target-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-target-title">5 · 目标反求</h2>
          <p>线性映射区分唯一解、多解与无解；标量搜索只在声明范围内找候选，未收敛/超时不会被表述为数学无解。</p>
        </div>
        <span className={styles.badge}>branch rev {branch.revision}</span>
      </header>
      <div className={styles.panelBody}>
        <div className={styles.row}>
          <label className={styles.field}>
            交互对象
            <select value={node?.node_id ?? ''} onChange={(event) => { setNodeId(event.target.value); setVariables([]); }}>
              {nodes.map((item) => <option key={item.node_id} value={item.node_id}>{item.title}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            目标输出
            <select value={output} onChange={(event) => setOutput(event.target.value)}>
              <option value="">自动（首个数值指标）</option>
              {evaluation?.metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.label}</option>)}
              <option value="product">矩阵乘向量 Av</option>
            </select>
          </label>
          {!isVectorProduct ? (
            <label className={styles.field}>
              目标值
              <input type="number" value={target} onChange={(event) => setTarget(event.target.value)} />
            </label>
          ) : null}
        </div>
        {isVectorProduct ? (
          <label className={styles.field}>
            目标向量 y（逗号分隔，2 个）
            <input value={vector} onChange={(event) => setVector(event.target.value)} />
            <small>线性逆映射会返回唯一解、多解（含特解）或已证无解，并给出残差。</small>
          </label>
        ) : null}
        {isVectorProduct ? (
          <p className={styles.empty}>
            求输入向量 v=(v1,v2)：即使节点没有 v1/v2 参数，也会独立返回显式向量解与代回验证。
          </p>
        ) : (
        <div>
          <span className={styles.groupTitle}>可改变量</span>
          <div className={styles.row}>
            {numeric.map((parameter) => (
              <label key={parameter.concept_id} className={styles.confirmLine}>
                <input type="checkbox" checked={activeVariables.includes(parameter.concept_id)}
                  onChange={(event) => {
                    setVariables((current) => {
                      const base = current.length ? current : numeric.slice(0, 1).map((item) => item.concept_id);
                      return event.target.checked ? [...new Set([...base, parameter.concept_id])] : base.filter((id) => id !== parameter.concept_id);
                    });
                  }} />
                {parameter.label}
              </label>
            ))}
          </div>
        </div>
        )}
        <div className={styles.row}>
          {!isVectorProduct ? (
            !isDiscrete ? (
              <>
                <label className={styles.field}>
                  搜索下界
                  <input type="number" value={effectiveLow} onChange={(event) => setLow(Number(event.target.value))} />
                </label>
                <label className={styles.field}>
                  搜索上界
                  <input type="number" value={effectiveHigh} onChange={(event) => setHigh(Number(event.target.value))} />
                </label>
              </>
            ) : (
              <p className={styles.empty} style={{ flex: 1 }}>
                离散变量：{activeParameter?.options.join(' / ') || '布尔值'}；对每个选项有限枚举。
              </p>
            )
          ) : null}
          <label className={styles.field}>
            容差
            <input type="number" step="0.000001" value={tolerance} onChange={(event) => setTolerance(event.target.value)} />
          </label>
        </div>
        <div className={styles.row}>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || !node || (!isVectorProduct && activeVariables.length === 0)}
            onClick={() => {
              if (!node) return;
              const range: Record<string, [number, number]> = {};
              if (!isVectorProduct && !isDiscrete) activeVariables.forEach((id) => { range[id] = [Number(effectiveLow), Number(effectiveHigh)]; });
              const parsedVector = isVectorProduct
                ? vector.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
                : null;
              onSolve({
                nodeId: node.node_id,
                output,
                targetValue: isVectorProduct ? 0 : Number(target),
                targetVector: parsedVector && parsedVector.length === 2 ? parsedVector : null,
                variables: isVectorProduct ? ['v1', 'v2'] : activeVariables,
                ranges: range,
                tolerance: Number(tolerance),
              });
            }}>
            {busy ? '求解中…' : '运行目标反求'}
          </button>
          {status ? <span className={styles.badge} data-status="needs_review">{status}</span> : null}
        </div>
        {result ? (
          <div>
            <h3 className={styles.groupTitle}>
              求解结果
              <span className={styles.badge} data-status={result.status} style={{ marginLeft: 8 }}>
                {STATUS_LABEL[result.status] ?? result.status}
              </span>
            </h3>
            <p className={styles.source}>
              <b>方法：{result.method} · 迭代 {result.iterations} · 残差 {result.residual ?? '—'}</b>
              <span>停止原因：{result.stop_reason}</span>
              <span>容差：{result.tolerance}（atol {result.atol}, rtol {result.rtol}）</span>
            </p>
            <div className={styles.paths}>
              {result.candidates.map((candidate, index) => (
                <div key={index} className={styles.path}>
                  <b>候选 {index + 1}</b>
                  <span>输出 {candidate.output_value ?? '—'} · 残差 {candidate.residual ?? '—'}</span>
                  {candidate.solution ? (
                    <div className={styles.answerCard}>
                      <strong>
                        {candidate.solution.unknowns.map((name, position) => (
                          `${name} = ${formatValue(candidate.solution!.values[position] ?? 0)}`
                        )).join('，')}
                      </strong>
                      {candidate.solution.exact_values.length ? (
                        <small>精确值：{candidate.solution.exact_values.join('，')}</small>
                      ) : null}
                      {candidate.solution.classification === 'particular' ? (
                        <small>多解：展示一个可验证特解；自由变量 {candidate.solution.free_variables.join('，') || '—'}</small>
                      ) : null}
                      {candidate.solution.equations.map((equation) => (
                        <code key={equation}>{equation}</code>
                      ))}
                      <ul>
                        {candidate.solution.verification.map((item) => (
                          <li key={item.label} data-status={item.status}>
                            {item.label}：期望 {item.expected} · 实际 {item.actual}
                            {item.residual !== null ? ` · 残差 ${item.residual}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <small>旧结果缺少显式解；请重新求解以核对答案。</small>
                  )}
                </div>
              ))}
              {result.candidates.length === 0 ? <p className={styles.empty}>没有候选；请检查搜索范围、方法条件与残差，不要把未找到当数学无解。</p> : null}
            </div>
            <ul className={styles.checks}>
              {result.checks.map((check, index) => (
                <li key={index} data-status={String(check.status ?? 'pass')}>
                  <b>{String(check.id ?? 'check')}</b>
                  <span>{String(check.message ?? '')}</span>
                </li>
              ))}
            </ul>
            {result.candidate_branch_id ? (
              <button type="button" className={styles.button} onClick={() => onOpenBranch(result.candidate_branch_id!)}>
                打开候选分支（显式采用）
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default TargetSearchPanel;
