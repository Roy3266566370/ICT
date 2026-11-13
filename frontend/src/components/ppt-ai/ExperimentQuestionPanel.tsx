import { useMemo, useState } from 'react';
import { evaluateNode } from '@/ppt-ai/runtime/evaluate';
import type { BranchState, CanonicalValue, CompiledNode, Experiment, InteractionBundle } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

interface CreateInput {
  nodeId: string;
  question: string;
  recipe: 'compare' | 'counterexample' | 'boundary' | 'sensitivity';
  variable: string;
  output: string;
  ranges: Record<string, [number, number]>;
}

interface Props {
  bundle: InteractionBundle | null;
  branch: BranchState | null;
  experiment: Experiment | null;
  busy: boolean;
  status: string;
  onCreate: (input: CreateInput) => void;
  onOpenBranch: (branchId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  found: '找到结果',
  not_found_in_scope: '范围内未发现',
  unknown: '结论未知',
  timeout: '超时',
  infeasible_proven: '已证无解',
};

function experimentalParameters(node: CompiledNode) {
  return node.parameters.filter((parameter) => ['number', 'integer', 'enum', 'boolean'].includes(parameter.type));
}

export function ExperimentQuestionPanel({ bundle, branch, experiment, busy, status, onCreate, onOpenBranch }: Props) {
  const nodes = bundle?.compiled.nodes ?? [];
  const [nodeId, setNodeId] = useState('');
  const selectedNode = nodes.find((node) => node.node_id === nodeId) ?? nodes[0] ?? null;
  const params = selectedNode ? experimentalParameters(selectedNode) : [];
  const [variable, setVariable] = useState('');
  const activeVariable = params.find((parameter) => parameter.concept_id === variable) ?? params[0] ?? null;
  const [question, setQuestion] = useState('');
  const [recipe, setRecipe] = useState<CreateInput['recipe']>('compare');
  const [output, setOutput] = useState('');
  const [low, setLow] = useState<number | ''>('');
  const [high, setHigh] = useState<number | ''>('');
  const values = useMemo(() => {
    const result: Record<string, CanonicalValue> = {};
    selectedNode?.parameters.forEach((parameter) => {
      result[parameter.concept_id] = branch?.canonical_values?.[parameter.concept_id] ?? parameter.default;
    });
    return result;
  }, [selectedNode, branch]);
  const evaluation = useMemo(() => (selectedNode ? evaluateNode(selectedNode, values) : null), [selectedNode, values]);
  const isDiscrete = activeVariable?.type === 'enum' || activeVariable?.type === 'boolean';
  const effectiveLow = low === '' ? activeVariable?.min ?? -5 : low;
  const effectiveHigh = high === '' ? activeVariable?.max ?? 5 : high;

  if (!bundle || !branch) {
    return (
      <section className={styles.panel}>
        <header className={styles.panelHead}><div><h2>2 · 补充实验</h2><p>先采用一个可执行规划，创建 bundle 与分支后再生成补充实验。</p></div></header>
        <div className={styles.panelBody}><p className={styles.empty}>当前还没有可用的交互 bundle。</p></div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-experiment-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-experiment-title">2 · 根据追问生成补充实验</h2>
          <p>问题会转成登记 recipe、目标谓词与有限搜索计划，不会让模型反复猜答案。新实验只创建独立候选分支，不改动原分支。</p>
        </div>
        <span className={styles.badge}>revision {branch.revision}</span>
      </header>
      <div className={styles.panelBody}>
        {nodes.length === 0 ? <p className={styles.empty}>bundle 没有可实验节点。</p> : (
          <>
            <div className={styles.row}>
              <label className={styles.field}>
                交互对象
                <select value={selectedNode?.node_id ?? ''} onChange={(event) => { setNodeId(event.target.value); setVariable(''); }}>
                  {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.title}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                变化变量
                <select value={activeVariable?.concept_id ?? ''} onChange={(event) => setVariable(event.target.value)}>
                  {params.map((parameter) => <option key={parameter.concept_id} value={parameter.concept_id}>{parameter.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                输出口径
                <select value={output} onChange={(event) => setOutput(event.target.value)}>
                  <option value="">自动（首个数值指标）</option>
                  {evaluation?.metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.label}</option>)}
                </select>
              </label>
            </div>
            <div className={styles.row}>
              {!isDiscrete ? (
                <>
                  <label className={styles.field}>
                    范围下界
                    <input type="number" value={effectiveLow} onChange={(event) => setLow(Number(event.target.value))} />
                  </label>
                  <label className={styles.field}>
                    范围上界
                    <input type="number" value={effectiveHigh} onChange={(event) => setHigh(Number(event.target.value))} />
                  </label>
                </>
              ) : (
                <p className={styles.empty} style={{ flex: 1 }}>
                  离散变量：{activeVariable?.options.join(' / ') || '布尔值'}；不会做连续二分。
                </p>
              )}
              <label className={styles.field}>
                recipe
                <select value={recipe} onChange={(event) => setRecipe(event.target.value as CreateInput['recipe'])}>
                  <option value="compare">compare · 多条件对照</option>
                  <option value="counterexample">counterexample · 搜索反例</option>
                  <option value="boundary">boundary · 定位边界</option>
                  <option value="sensitivity">sensitivity · 敏感性</option>
                </select>
              </label>
            </div>
            <label className={styles.field}>
              想验证的问题
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)}
                placeholder="例如：把参数从下界调到上界时，结果差异是否显著？反例搜索请写明“结果等于 4 / 输出 > 0”这样的数值命题。" />
              <small>反例搜索只覆盖声明范围；范围内没找到反例不等同于命题已证明。</small>
            </label>
            <div className={styles.row}>
              <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || question.trim().length < 3 || !activeVariable}
                onClick={() => activeVariable && onCreate({
                  nodeId: selectedNode!.node_id,
                  question: question.trim(),
                  recipe,
                  variable: activeVariable.concept_id,
                  output,
                  ranges: isDiscrete ? {} : { [activeVariable.concept_id]: [Number(effectiveLow), Number(effectiveHigh)] },
                })}>
                {busy ? '生成中…' : '生成实验草案并运行'}
              </button>
              {status ? <span className={styles.badge} data-status="needs_review">{status}</span> : null}
            </div>
            {evaluation?.metrics.length ? (
              <div className={styles.metrics}>
                {evaluation.metrics.slice(0, 6).map((metric) => <div key={metric.id}>{metric.label}<b>{metric.value}</b></div>)}
              </div>
            ) : null}
          </>
        )}

        {experiment?.result ? (
          <div>
            <h3 className={styles.groupTitle}>
              实验结果
              <span className={styles.badge} data-status={experiment.result.status} style={{ marginLeft: 8 }}>
                {STATUS_LABEL[experiment.result.status] ?? experiment.result.status}
              </span>
            </h3>
            <p className={styles.source}>
              <b>{experiment.question}</b>
              <span>recipe: {experiment.result.recipe_id} · 候选点 {experiment.result.candidate_count} · 停止原因 {experiment.result.stop_reason}</span>
            </p>
            <div className={styles.paths}>
              {experiment.result.paths.map((path) => (
                <div key={path.path_id} className={styles.path}>
                  <b>{path.label}</b>
                  <span>输出 {path.output_value === null ? '—' : path.output_value}</span>
                  {path.witness ? <small>见证：{JSON.stringify(path.witness)}</small> : null}
                </div>
              ))}
              {experiment.result.paths.length === 0 ? <p className={styles.empty}>没有路径；请查看检查与停止原因，不要把“未找到”当作证明。</p> : null}
            </div>
            <ul className={styles.checks}>
              {experiment.result.checks.map((check, index) => (
                <li key={index} data-status={String(check.status ?? 'pass')}>
                  <b>{String(check.id ?? check.message ?? '检查')}</b>
                  <span>{String(check.message ?? '')}</span>
                </li>
              ))}
            </ul>
            {experiment.result.explanation.length > 0 ? (
              <ul className={styles.reviews}>
                {experiment.result.explanation.map((line, index) => <li key={index} data-required="false">{line}</li>)}
              </ul>
            ) : null}
            {experiment.result.branch_id ? (
              <button type="button" className={styles.button} onClick={() => onOpenBranch(experiment.result!.branch_id!)}>
                打开独立候选分支
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ExperimentQuestionPanel;
