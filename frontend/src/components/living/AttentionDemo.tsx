import { useState } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { attention } from '@/living/attention';
import styles from './LivingBlocks.module.css';

export function AttentionDemo() {
  const [query, setQuery] = useState(1);
  const [temperature, setTemperature] = useState(1);
  const [causal, setCausal] = useState(false);
  const { scores, weights, output } = attention(query, temperature, causal);
  return <section className={styles.attentionDemo} aria-label="注意力教学实验">
    <h3>注意力 · 从匹配分数到加权输出</h3>
    <p>教学示例数据，非原稿数值。固定 K = V = [(1,0), (0,1), (1,1)]，观察第二个位置的 Query。</p>
    <Formula tex={'\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^T/(\\sqrt{d_k}\\,T)+M)V'} block />
    <label>Query 第一维：{query.toFixed(1)}（Q = [{query.toFixed(1)}, 1]）
      <input aria-label="Query 第一维" type="range" min="-4" max="4" step="0.1" value={query} onChange={(e) => setQuery(Number(e.target.value))} />
    </label>
    <label>温度 T：{temperature.toFixed(1)}
      <input aria-label="温度" type="range" min="0.1" max="3" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
    </label>
    <label><input type="checkbox" checked={causal} onChange={(e) => setCausal(e.target.checked)} />因果掩码：第二个位置不能关注第三个位置</label>
    <table><thead><tr><th>Key</th><th>缩放分数 / T</th><th>注意力权重</th></tr></thead>
      <tbody>{weights.map((w, i) => <tr key={i}><td>位置 {i + 1}</td><td>{causal && i === 2 ? '−∞（掩码）' : scores[i]!.toFixed(3)}</td>
        <td><meter min="0" max="1" value={w} aria-label={`位置 ${i + 1} 权重`} /> {(w * 100).toFixed(1)}%</td></tr>)}</tbody>
    </table>
    <p role="status">加权输出 = [{output.map((v) => v.toFixed(3)).join(', ')}] · 权重总和 = {weights.reduce((a, b) => a + b, 0).toFixed(3)}</p>
    <p>降低温度会让权重更集中；改变 Query 会改变匹配对象；掩码使未来位置的权重为零。</p>
    <button type="button" onClick={() => { setQuery(1); setTemperature(1); setCausal(false); }}>重置实验</button>
  </section>;
}
