import { useEffect, useRef, useState } from 'react';
import type { PageLab } from '@/api/pptAI';
import { LabCanvas } from '@/components/ppt-ai/PageLabPanel';
import styles from './LivingBlocks.module.css';

export function LivingAIModel({ doc }: { doc: Record<string, unknown> }) {
  const lab = doc.model as PageLab;
  const host = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) { setActive(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setActive(true); observer.disconnect(); }
    }, { rootMargin: '250px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <section ref={host} className={styles.aiModel} aria-label="AI 生成的交互模型">
    <header><span className={styles.aiBadge}>AI 设计</span><h3>{lab.title}</h3></header>
    <p>{lab.summary}</p>
    {active ? <LabCanvas lab={lab} values={{ ...Object.fromEntries(lab.params.map((p) => [p.id, p.default])), ...values }} />
      : <div className={styles.aiPlaceholder}>进入视野后启动交互模型</div>}
    <fieldset className={styles.aiSliders}><legend>调整参数，观察变化</legend>
      {lab.params.map((p) => <label key={p.id}><span>{p.label}</span>
        <output>{Number((values[p.id] ?? p.default).toFixed(4))}{p.unit}</output>
        <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step}
          value={values[p.id] ?? p.default} onChange={(e) => setValues((v) => ({ ...v, [p.id]: Number(e.target.value) }))} />
      </label>)}
    </fieldset>
    {lab.explain.length ? <ul>{lab.explain.map((line, i) => <li key={i}>{line}</li>)}</ul> : null}
    <button type="button" onClick={() => setValues({})}>重置参数</button>
    <p className={styles.aiMeta}>根据本页知识点自主设计 · 教学示例数据 · {lab.generator.model}</p>
  </section>;
}
