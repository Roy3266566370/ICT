import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { TrustBadge } from '@/components/trust/TrustBadge';
import { getAdversarialDemo, type AdversarialDemo, type AdversarialScenario } from '@/api/trust';
import styles from './TrustDemoPage.module.css';

function MatrixMini({ matrix }: { matrix: number[][] }) {
  return (
    <span className={styles.matrix}>
      {matrix.map((row, index) => (
        <span key={index}>{row.join('  ')}</span>
      ))}
    </span>
  );
}

function ScenarioCard({ scenario }: { scenario: AdversarialScenario }) {
  return (
    <article className={styles.card} data-intercepted={scenario.intercepted ? 'true' : 'false'}>
      <header>
        <div>
          <p className={styles.kicker}>{scenario.scenario.toUpperCase()}</p>
          <h3>{scenario.label}</h3>
        </div>
        <span className={styles.count}>{scenario.intercepted ? '已拦截' : '通过'}</span>
      </header>
      <div className={styles.compare}>
        <section className={styles.without}>
          <b>没有防线</b>
          {scenario.result ? (
            <>
              <MatrixMini matrix={scenario.result.matrix} />
              <p>det = {scenario.result.det ?? '—'} · trace = {scenario.result.trace ?? '—'}</p>
              <small>{scenario.result.render_note}</small>
            </>
          ) : <p>模型提议会被直接显示，无法核验。</p>}
        </section>
        <section className={styles.with}>
          <b>有防线</b>
          {scenario.trust ? <TrustBadge trust={scenario.trust}/> : <span className={styles.rejected}>提议已拒收</span>}
          {scenario.logs.length ? scenario.logs.map((log) => (
            <p key={log.id}><strong>{log.defense_label}</strong>：{log.reason}</p>
          )) : <p>未触发拦截。</p>}
        </section>
      </div>
    </article>
  );
}

export default function TrustDemoPage(): JSX.Element {
  const [demo, setDemo] = useState<AdversarialDemo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getAdversarialDemo().then(setDemo).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : '演示数据暂不可用');
    });
  }, []);

  return <div className={`${styles.page} studio-scope`}>
    <SiteNav current={null} appearance="studio" />
    <main className={styles.main}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>TRUST · ADVERSARIAL DEMO</p>
        <h1>AI 说错了，系统怎么拦？</h1>
        <p>故障由合成注入 provider 生成，依次经过原文锚点、类型/形状、独立参考实现和原文声明四道防线。它不是“调个 API 做网页”，而是把模型的每个提议都当作不可信输入。</p>
        <div className={styles.actions}>
          <Link className={styles.primary} to="/">返回首页</Link>
          <Link className={styles.ghost} to="/trust-demo">刷新演示</Link>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!demo && !error ? <p className={styles.loading}>正在运行确定性防线演示…</p> : null}
      {demo ? <>
        <section className={styles.summary} aria-label="拦截统计">
          <div><b>{demo.summary.injected}</b><span>类合成故障</span></div>
          <div><b>{demo.summary.intercepted}</b><span>次拦截</span></div>
          <div><b>{demo.summary.clean_false_positive}</b><span>次干净输入误拦</span></div>
          <p>{demo.summary.note}</p>
        </section>

        <section className={styles.cleanCard} aria-label="干净输入基线">
          <div>
            <p className={styles.kicker}>CLEAN INPUT</p>
            <h2>干净输入不会被误伤</h2>
            <p>原文声明与计算结果一致；独立校验通过。</p>
          </div>
          <TrustBadge trust={demo.clean.trust ?? undefined}/>
        </section>

        <section className={styles.grid} aria-label="故障场景">
          {demo.scenarios.map((scenario) => <ScenarioCard key={scenario.scenario} scenario={scenario}/>)}
        </section>

        <section className={styles.logPanel} aria-labelledby="log-title">
          <header>
            <div>
              <p className={styles.kicker}>INTERCEPTION LOG</p>
              <h2 id="log-title">拦截日志</h2>
              <p>每条记录：模型提议 → 哪道防线 → 中文原因 → 系统最终处理。</p>
            </div>
            <span>{demo.scenarios.reduce((sum, item) => sum + item.logs.length, 0)} 条</span>
          </header>
          <div className={styles.logTable}>
            <div className={styles.logHead}><span>防线</span><span>模型提议</span><span>原因</span><span>处理</span></div>
            {demo.scenarios.flatMap((scenario) => scenario.logs.map((log) => (
              <div key={log.id} className={styles.logRow}>
                <span><b>{log.defense_label}</b></span>
                <span>{log.proposed}</span>
                <span>{log.reason}</span>
                <span>{log.action}</span>
              </div>
            )))}
          </div>
          <p className={styles.footnote}>真实 MaaS 调用记录与真实模型错误率要另行统计；本页只证明防线存在且可执行。</p>
        </section>
      </> : null}
    </main>
  </div>;
}
