/** 自包含仿真节点体（SimNodes.tsx）
 *
 * ``attentionSim``：注意力教学实验——Q/温度/因果掩码落在 ``node.params``，
 *   可被 ``node_id.param_key`` 页面绑定驱动，随连线/绑定实时重算。
 * ``pageLabSim``：AI 设计的 page_lab 程序——载荷在 ``node.payload``，
 *   滑块值同样落在 ``node.params``，因此 AI 交互能接入页面活变量。
 *
 * 两者都是确定性自包含对象：无端口、不参与求值图，行为只由 params 决定。
 */
import { useMemo } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { LabCanvas } from '@/components/ppt-ai/PageLabPanel';
import type { PageLab } from '@/api/pptAI';
import { attention } from '@/living/attention';
import { parsePageLabSim } from '@/living/sim';
import { fmt } from './math.ts';
import type { NodeBodyProps } from './nodes.tsx';
import styles from './canvas.module.css';

function simSlider(label: string, value: number, min: number, max: number, step: number,
                   onChange: (value: number) => void): JSX.Element {
  return <label className={styles.inlineField}>{label}
    <input className={styles.slider} type="range" aria-label={label}
      min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))} />
    <span className={styles.live}>{fmt(value, 2)}</span>
  </label>;
}

export function AttentionSimBody({ node, onParams, inCard }: NodeBodyProps): JSX.Element {
  const query = node.params.query ?? 1;
  const temperature = node.params.temperature ?? 1;
  const causal = (node.params.causal ?? 0) >= 0.5;
  const { scores, weights, output } = attention(query, temperature, causal);
  return <div>
    <Formula tex={'\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^T/(\\sqrt{d_k}\\,T)+M)V'} block />
    {!inCard && <>
      {simSlider('Query 第一维', query, -4, 4, 0.1, (v) => onParams?.({ query: v }))}
      {simSlider('温度 T', temperature, 0.1, 3, 0.1, (v) => onParams?.({ temperature: v }))}
      <label className={styles.inlineField}>
        <input type="checkbox" checked={causal} onChange={(e) => onParams?.({ causal: e.target.checked ? 1 : 0 })} />
        因果掩码<span className={styles.dim}>：第二个位置不能关注第三个</span>
      </label>
    </>}
    <table className={styles.simTable}>
      <thead><tr><th>Key</th><th>分数 / T</th><th>权重</th></tr></thead>
      <tbody>{weights.map((w, i) => <tr key={i}>
        <td>位置 {i + 1}</td>
        <td>{causal && i === 2 ? '−∞' : scores[i]!.toFixed(3)}</td>
        <td><meter min={0} max={1} value={w} /> {(w * 100).toFixed(1)}%</td>
      </tr>)}</tbody>
    </table>
    <div className={styles.miniRead}>
      加权输出 <b className={styles.live}>[{output.map((v) => v.toFixed(3)).join(', ')}]</b>
      <span className={styles.dim}> · K=V=[(1,0),(0,1),(1,1)] 教学示例数据</span>
    </div>
  </div>;
}

export function PageLabSimBody({ node, onParams, inCard }: NodeBodyProps): JSX.Element {
  const sim = useMemo(() => parsePageLabSim(node.payload), [node.payload]);
  const lab = useMemo<PageLab | null>(() => {
    if (!sim) return null;
    return {
      version: 'page_lab', page_no: 0, title: sim.title, summary: sim.summary,
      explain: sim.explain, params: sim.params, program: sim.program,
      content_hash: sim.input_hash || `sim-${node.id}`,
      generator: { model: 'wanxiang-ai', attempts: 0 }, created_at: '',
    };
  }, [sim, node.id]);
  if (!sim || !lab) {
    return <div className={styles.unwired} role="status">
      <span aria-hidden="true">◇</span> AI 交互缺少载荷：由活页「AI 设计交互」建议激活生成，不能手工添加
    </div>;
  }
  const values = Object.fromEntries(sim.params.map((p) => [p.id, node.params[p.id] ?? p.default]));
  return <div>
    {sim.summary ? <p className={styles.simSummary}>{sim.summary}</p> : null}
    <LabCanvas lab={lab} values={values} />
    {!inCard && <div className={styles.fieldGrid}>
      {sim.params.map((p) => {
        const value = node.params[p.id] ?? p.default;
        return <label key={p.id} className={styles.inlineField}>{p.label}
          <input className={styles.slider} type="range" aria-label={p.label}
            min={p.min} max={p.max} step={p.step} value={value}
            onChange={(e) => onParams?.({ [p.id]: Number(e.target.value) })} />
          <span className={styles.live}>{fmt(value, 3)}{p.unit || ''}</span>
        </label>;
      })}
    </div>}
    {!inCard && sim.explain.length ? <ul className={styles.simExplain}>{sim.explain.map((line, i) => <li key={i}>{line}</li>)}</ul> : null}
    <div className={styles.miniRead}><span className={styles.dim}>AI 设计 · 教学示例数据 · 参数可绑定页面变量</span></div>
  </div>;
}
