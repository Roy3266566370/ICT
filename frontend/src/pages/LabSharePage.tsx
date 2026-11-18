import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { LabAISolvePanel } from '@/components/labs/LabAISolvePanel';
import { MathText, ProblemText, ProblemTitle } from '@/components/labs/ProblemText';
import { conditionValueText } from '@/labs/mathText';
import { getSharedLab, labSharePreviewUrl } from '@/api/labs';
import { errorMessage } from '@/api/client';
import { LabFormula as Formula } from '@/components/labs/ProblemText';
import { LabCanvas, type LabSelection } from '@/components/labs/LabCanvas';
import { LabTimeline } from '@/components/labs/LabTimeline';
import { computeLab, currentMetrics, defaultParams } from '@/labs/compute';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import {
  MODE_LABELS,
  PROVENANCE_LABELS,
  SUBJECT_LABELS,
  isBlocking,
  type LabDocument,
  type LabProblem,
  type LabScenario,
  type LabState,
} from '@/labs/types';
import styles from './LabSharePage.module.css';

function stateOf(problem: LabProblem): LabState {
  const raw = (problem.states ?? {}) as Partial<LabState>;
  const params: Record<string, unknown> = { ...defaultParams(problem) };
  if (raw.params) {
    for (const key of Object.keys(params)) {
      if (key in raw.params) params[key] = raw.params[key];
    }
  }
  return {
    params,
    step: Number(raw.step) || 0,
    mode: raw.mode ?? 'explore',
    notes: raw.notes ?? '',
    observations: raw.observations ?? [],
    events: raw.events ?? [],
    scenarios: raw.scenarios?.length ? raw.scenarios : [
      { id: 'baseline', name: '原题条件', params: defaultParams(problem), created_at: null, kind: 'baseline', summary: '原题条件' },
    ],
    active_scenario_id: raw.active_scenario_id ?? 'baseline',
    attempts: raw.attempts ?? [],
    evaluated: raw.evaluated ?? null,
  };
}

export function LabSharePage(): JSX.Element {
  const { shareId = '' } = useParams();
  const reducedMotion = useReducedMotion();
  const [lab, setLab] = useState<LabDocument | null>(null);
  const [problemId, setProblemId] = useState('');
  const [displayParams, setDisplayParams] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<LabSelection | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    let alive = true;
    setLoading(true);
    void getSharedLab(shareId)
      .then((document) => {
        if (!alive) return;
        setLab(document);
        setProblemId(document.selected_problem_id || document.problems[0]?.problem_id || '');
        const target = document.problems.find((item) => item.problem_id === document.selected_problem_id) ?? document.problems[0];
        if (target) {
          const initial = stateOf(target);
          setStep(initial.step);
          setDisplayParams(initial.params);
        }
        setError(null);
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [shareId]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [shareId]);

  const problem = useMemo(
    () => lab?.problems.find((item) => item.problem_id === problemId) ?? lab?.problems[0] ?? null,
    [lab, problemId],
  );
  const state = useMemo(() => (problem ? stateOf(problem) : null), [problem]);
  const result = useMemo(() => {
    if (!problem) return null;
    try {
      return computeLab(problem, displayParams);
    } catch {
      return null;
    }
  }, [displayParams, problem]);
  const compareScenario = state?.scenarios.find((item) => item.id === 'baseline') ?? state?.scenarios[0];
  const compareResult = useMemo(() => {
    if (!problem || !state || !compareScenario) return null;
    if (JSON.stringify(compareScenario.params) === JSON.stringify(state.params)) return null;
    try {
      return computeLab(problem, compareScenario.params);
    } catch {
      return null;
    }
  }, [compareScenario, problem, state]);
  const timelineIndex = useMemo(() => {
    if (!result) return 0;
    if (result.subject === 'calculus') {
      const key = result.task === 'double_integral' ? 'slice' : result.kind === 'integral' ? 'n' : result.kind === 'antiderivative' ? 'c' : 'h';
      const currentValue = Number(displayParams[key]);
      const found = result.trace.findIndex((frame) => Math.abs(Number(frame.values?.[key]) - currentValue) < 1e-9);
      if (found >= 0) return found;
    }
    return Math.max(0, Math.min(step, result.trace.length - 1));
  }, [displayParams, result, step]);

  const goToStep = useCallback((next: number) => {
    setStep(next);
    if (result?.subject === 'calculus') {
      const key = result.task === 'double_integral' ? 'slice' : result.kind === 'integral' ? 'n' : result.kind === 'antiderivative' ? 'c' : 'h';
      const value = Number(result.trace[next]?.values?.[key]);
      if (Number.isFinite(value)) setDisplayParams(current => ({...current, [key]:value}));
    }
  }, [result]);

  useEffect(() => {
    if (!playing || !result) return undefined;
    const total = result.trace.length - 1;
    if (timelineIndex >= total) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => goToStep(timelineIndex + 1), 1100 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, result, speed, timelineIndex, goToStep]);

  if (loading) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="labs" appearance="studio" />
        <div className={styles.loading} role="status">正在读取只读学习成果…</div>
      </div>
    );
  }

  if (error || !lab || !problem || !state) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="labs" appearance="studio" />
        <div className={styles.errorPage} role="alert">
          <span className={styles.eyebrow}>SHARE UNAVAILABLE</span>
          <h1>这份分享暂时打不开</h1>
          <p>{error ?? '快照不完整，或链接已被撤销。'}</p>
          <Link to="/labs">前往题目实验室</Link>
        </div>
      </div>
    );
  }

  const pages = lab.source.pages.filter((page) =>
    problem.source_pages.some((item) => item.file_id === page.file_id && item.page === page.page),
  );
  const metrics = result ? currentMetrics(result, timelineIndex) : [];
  const supplemental = problem.recognition.conditions.filter(
    (item) => item.provenance === 'supplement' || item.provenance === 'teaching',
  );

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="labs" appearance="studio" />
      <main id="main" className={styles.main}>
        <header className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>SHARED LEARNING RECORD</span>
            <h1><ProblemTitle problem={problem} /></h1>
            <p>
              {SUBJECT_LABELS[problem.subject]} · {problem.source.label} · 发布于{' '}
              {lab.published_at ? new Date(lab.published_at).toLocaleString('zh-CN', { hour12: false }) : '—'} ·
              只读快照
            </p>
            <div className={styles.heroChips}>
              <span>{problem.source.page_from === problem.source.page_to ? `第 ${problem.source.page_from} 页` : `第 ${problem.source.page_from}–${problem.source.page_to} 页`}</span>
              <span>{MODE_LABELS[state.mode].title}记录</span>
              <span>{problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? '含内核计算结果' : '含 AI 参考解答' : problem.solution.answer ? '含原题解答' : '结构讲解'}</span>
              {problem.model.teaching ? <span className={styles.teaching}>含明确标注的教学示例</span> : null}
            </div>
          </div>
          <div className={styles.heroActions}>
            <button type="button" onClick={() => setShowSource((current) => !current)}>
              {showSource ? '收起原稿' : '查看原稿'}
            </button>
            <Link to="/labs">打开题目实验室 →</Link>
          </div>
        </header>

        {showSource ? (
          <section className={styles.sourceStrip} aria-label="原稿页">
            {pages.map((page) => (
              <article key={`${page.file_id}-${page.page}`}>
                <span>第 {page.page} 页 · {page.method}</span>
                {page.image_key ? (
                  <img src={labSharePreviewUrl(shareId, page.image_key)} alt={`第 ${page.page} 页原稿`} />
                ) : (
                  <ProblemText text={page.text || '无文字层'} className={styles.problemText} />
                )}
              </article>
            ))}
          </section>
        ) : null}

        <div className={styles.layout}>
          <section className={styles.modelColumn} aria-label="学习成果模型">
            <LabAISolvePanel key={problem.problem_id} problem={problem} />
            <div className={styles.modelHead}>
              <div>
                <span className={styles.eyebrow}>OPERABLE MODEL · READ ONLY</span>
                <h2>当时的条件与执行轨迹</h2>
              </div>
              <span className={styles.revision}>revision {lab.revision}</span>
            </div>
            {result && !(problem.ai_solution && (isBlocking(problem.recognition.ambiguities) || (problem.model.teaching && problem.status !== 'ready'))) ? (
              <>
                <div className={styles.canvasCard}>
                  <LabCanvas
                    problem={problem}
                    result={result}
                    step={timelineIndex}
                    mode={state.mode}
                    compare={compareResult}
                    selected={selected}
                    onSelect={setSelected}
                    readOnly
                  />
                </div>
                <LabTimeline
                  result={result}
                  step={timelineIndex}
                  playing={playing}
                  speed={speed}
                  reducedMotion={reducedMotion}
                  onStep={goToStep}
                  onTogglePlay={() => setPlaying((current) => !current)}
                  onSpeed={setSpeed}
                  onReset={() => {
                    setPlaying(false);
                    goToStep(0);
                  }}
                  detail="分享页保留当时的轨迹；播放只回放，不修改条件。"
                />
                <div className={styles.metricStrip}>
                  {metrics.map((item) => (
                    <div key={item.id}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              problem.ai_solution ? null : <p className={styles.emptyText}>这份快照中的模型无法在当前环境计算。</p>
            )}
            <div className={styles.conditionStrip}>
              <span>识别条件</span>
              <div>
                {problem.recognition.conditions.map((condition) => (
                  <span key={condition.id} className={styles.conditionChip} data-provenance={condition.provenance}>
                    <b><MathText text={condition.label} /></b>
                    <code><MathText text={conditionValueText(condition.value)} /></code>
                    <small>{PROVENANCE_LABELS[condition.provenance]}</small>
                  </span>
                ))}
              </div>
            </div>
            {supplemental.length ? (
              <p className={styles.supplementNote}>
                其中 {supplemental.length} 项是补充或教学条件，已在快照中标注；原题文字没有因此改变。
              </p>
            ) : null}
            {state.scenarios.length > 1 ? (
              <div className={styles.scenarioStrip}>
                <span>探索情景</span>
                {state.scenarios.map((scenario: LabScenario) => (
                  <div key={scenario.id} data-baseline={scenario.kind === 'baseline' || undefined}>
                    <strong>{scenario.name}</strong>
                    <small><MathText text={scenario.summary} /></small>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <aside className={styles.sideColumn}>
            <section className={styles.solutionCard}>
              <span className={styles.eyebrow}>SOLUTION</span>
              <h2>{problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? '内核计算结果' : 'AI 参考解答' : '原题解答'}</h2>
              <p className={styles.solutionSummary}><MathText text={problem.solution.summary} /></p>
              <div className={styles.answer}>
                <span>结论</span>
                <strong><MathText text={problem.ai_solution?.answer || problem.solution.answer || '—'} /></strong>
              </div>
              <div className={styles.solutionSteps}>
                {(problem.ai_solution?.steps ?? problem.solution.steps).map((item, index) => (
                  <div key={item.id} className={styles.solutionStep}>
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    <div>
                      <strong><MathText text={item.title} /></strong>
                      {item.latex ? <Formula tex={item.latex} block /> : null}
                      <p><MathText text={item.detail} /></p>
                    </div>
                  </div>
                ))}
              </div>
              {problem.solution.global_note ? <p className={styles.smallNote}><MathText text={problem.solution.global_note} /></p> : null}
            </section>

            <section className={styles.recordCard}>
              <span className={styles.eyebrow}>STUDENT RECORD</span>
              <h2>学生记录</h2>
              {state.notes ? (
                <div className={styles.noteBlock}>
                  <span>笔记</span>
                  <p><MathText text={state.notes} /></p>
                </div>
              ) : null}
              {state.observations.length ? (
                <div className={styles.observationBlock}>
                  <span>观察</span>
                  {state.observations.slice(-6).map((item) => (
                    <p key={item.id}><MathText text={item.text} /></p>
                  ))}
                </div>
              ) : null}
              {state.attempts.length ? (
                <div className={styles.attemptBlock}>
                  <span>尝试与反馈</span>
                  {state.attempts.slice(-5).map((attempt) => (
                    <div key={attempt.id} data-correct={attempt.correct}>
                      <strong>{attempt.correct ? '正确' : '待核对'} · <MathText text={attempt.answer} /></strong>
                      <p><MathText text={attempt.feedback} /></p>
                    </div>
                  ))}
                </div>
              ) : null}
              {!state.notes && !state.observations.length && !state.attempts.length ? (
                <p className={styles.smallNote}>分享者没有留下文字笔记或尝试记录；计算轨迹与情景仍然保留。</p>
              ) : null}
            </section>

            <section className={styles.sourceCard}>
              <span className={styles.eyebrow}>SOURCE</span>
              <h2>原题与来源</h2>
              <ProblemText text={problem.text} className={styles.problemText} />
              <div className={styles.formulaList}>
                {(!(problem.ai_solution && (problem.model.teaching || problem.status !== 'ready')) ? problem.recognition.formulas : []).map((formula) => (
                  <div key={formula.id}>
                    <Formula tex={formula.tex} block />
                    <span>{formula.role}</span>
                  </div>
                ))}
              </div>
              <p className={styles.smallNote}>{lab.source.citation}</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default LabSharePage;
