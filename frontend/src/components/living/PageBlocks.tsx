/** 活页块渲染器：编辑器与发布播放器共用的展示层。
 *
 * - 保真层块（page/text/figure/formula/section）永远能渲染，识别失败不丢内容；
 * - 激活层块（lab/quiz/checkpoint/embed）就地可交互；
 * - `onProgress` 只由播放器传入：上报学生端进度（访问/竞猜/判分）。
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LabCanvas } from '@/components/labs/LabCanvas';
import { Formula } from '@/components/showcase/Formula';
import { computeLab } from '@/labs/compute';
import type { LabProblem, LabResult, LabState } from '@/labs/types';
import type { ActivationSuggestion, PageBlock } from '@/living/types';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import { errorMessage } from '@/api/client';
import styles from './LivingBlocks.module.css';
import { AttentionDemo } from './AttentionDemo';
import { LivingAIModel } from './LivingAIModel';

export interface ProgressPatch {
  quiz_guess?: number;
  checkpoint_attempts?: { answer: string; correct: boolean }[];
}

export interface BlockViewProps {
  block: PageBlock;
  /** 把 asset key 解析成可 <img> 的 URL（编辑器与分享页各自带前缀） */
  assetUrl: (key: string) => string;
  readOnly?: boolean;
  onProgress?: (patch: ProgressPatch) => void;
  /** 编辑器注入的块级操作条（移动/编辑/删除） */
  controls?: ReactNode;
}

const EMPTY_STATE: LabState = {
  params: {},
  step: 0,
  mode: 'solution',
  notes: '',
  observations: [],
  events: [],
  scenarios: [],
  active_scenario_id: '',
  attempts: [],
  evaluated: null,
};

/* ------------------------------------------------------------------ */
/* 保真层                                                              */
/* ------------------------------------------------------------------ */

function PageImageBlock({ block, assetUrl }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'page' }>['data'];
  const [open, setOpen] = useState(!data.collapsed);
  if (!data.image_key) return null;
  return (
    <figure className={styles.pageBlock}>
      <button
        type="button"
        className={styles.pageToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{data.alt || '原始页面'}</span>
        <span className={styles.pageToggleHint}>{open ? '收起原页' : '对照原页'}</span>
      </button>
      {open ? (
        <img className={styles.pageImage} src={assetUrl(data.image_key)} alt={data.alt || '原始页面'} width={data.width} height={data.height} loading="lazy" />
      ) : null}
    </figure>
  );
}

function TextBlock({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'text' }>['data'];
  const body = <div className={styles.textBlock}>{data.md}</div>;
  return data.collapsed ? <details><summary>查看本页文字层（公式与图示以原页为准）</summary>{body}</details> : body;
}

function FigureBlock({ block, assetUrl }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'figure' }>['data'];
  return (
    <figure className={styles.figureBlock}>
      <img src={assetUrl(data.asset_id)} alt={data.caption || '插图'} loading="lazy" />
      {data.caption ? <figcaption>{data.caption}</figcaption> : null}
    </figure>
  );
}

function FormulaBlock({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'formula' }>['data'];
  return (
    <div className={styles.formulaBlock}>
      <Formula tex={data.latex} block />
    </div>
  );
}

function SectionBlock({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'section' }>['data'];
  const Tag = data.level === 1 ? 'h2' : data.level === 2 ? 'h3' : 'h4';
  return <Tag className={`${styles.sectionBlock} ${styles[`level${data.level}`]}`}>{data.heading}</Tag>;
}

/* ------------------------------------------------------------------ */
/* 激活层                                                              */
/* ------------------------------------------------------------------ */

/** 嵌入实验块：冻结 problem + 前端确定性引擎 = 学生端可交互的解题过程。 */
function LabBlockView({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'lab' }>['data'];
  const problem = useMemo<LabProblem>(
    () => ({ ...data.problem, states: EMPTY_STATE }),
    [data.problem],
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const result = useMemo<LabResult | null>(() => {
    if (!open) return null;
    const params = { ...(problem.model?.defaults ?? {}), ...data.engine_params };
    try {
      return computeLab(problem, params);
    } catch {
      return null;
    }
  }, [open, problem, data.engine_params]);

  const frameCount = result?.trace?.length ?? 0;
  const clamped = Math.min(step, Math.max(0, frameCount - 1));

  return (
    <section className={styles.labBlock}>
      <header className={styles.labHead}>
        <span className={styles.labBadge}>实验</span>
        <span className={styles.labTitle}>{problem.title || problem.text?.slice(0, 60)}</span>
        <button type="button" className={styles.labToggle} onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '开始探究'}
        </button>
      </header>
      {open ? (
        <div className={styles.labBody}>
          {result && frameCount > 0 ? (
            <>
              <div className={styles.labCanvas}>
                <LabCanvas
                  problem={problem}
                  result={result}
                  step={clamped}
                  mode="solution"
                  selected={null}
                  onSelect={() => undefined}
                  onStepChange={setStep}
                  readOnly
                />
              </div>
              <div className={styles.labScrub}>
                <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={clamped <= 0}>
                  上一步
                </button>
                <input
                  type="range"
                  min={0}
                  max={frameCount - 1}
                  value={clamped}
                  onChange={(e) => setStep(Number(e.target.value))}
                  aria-label="步骤进度"
                />
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(frameCount - 1, s + 1))}
                  disabled={clamped >= frameCount - 1}
                >
                  下一步
                </button>
                <span className={styles.labStepLabel}>
                  {clamped + 1} / {frameCount}
                </span>
              </div>
            </>
          ) : (
            <p className={styles.labEmpty}>这道题的动态演示暂不可用。</p>
          )}
          {problem.solution?.answer ? (
            <div className={styles.labAnswer}>
              <button type="button" onClick={() => setShowAnswer((v) => !v)}>
                {showAnswer ? '隐藏答案' : '查看答案'}
              </button>
              {showAnswer ? <strong>{problem.solution.answer}</strong> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** 先猜再看：预测闸门块。 */
function QuizBlockView({ block, readOnly, onProgress }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'quiz' }>['data'];
  const [guess, setGuess] = useState<number>((data.min + data.max) / 2);
  const [submitted, setSubmitted] = useState<number | null>(null);

  const ratio = submitted === null ? null : data.value === 0 ? null : submitted / data.value;
  const verdict =
    ratio === null
      ? null
      : ratio > 0.9 && ratio < 1.1
        ? '很接近！'
        : submitted === data.value
          ? '完全正确'
          : data.value !== 0 && submitted !== null
            ? submitted > data.value
              ? '猜高了'
              : '猜低了'
            : null;

  return (
    <section className={styles.quizBlock}>
      <p className={styles.quizQuestion}>{data.question}</p>
      <div className={styles.quizRow}>
        <input
          type="range"
          min={data.min}
          max={data.max}
          step={(data.max - data.min) / 100 || 0.01}
          value={guess}
          disabled={submitted !== null}
          onChange={(e) => setGuess(Number(e.target.value))}
          aria-label="你的猜测"
        />
        <span className={styles.quizGuess}>{guess.toFixed(2)}</span>
        {submitted === null ? (
          <button
            type="button"
            onClick={() => {
              setSubmitted(guess);
              onProgress?.({ quiz_guess: guess });
            }}
          >
            锁定答案
          </button>
        ) : null}
      </div>
      {submitted !== null ? (
        <div className={styles.quizReveal} role="status">
          <strong>
            {verdict ? `${verdict} ` : ''}实际值 {data.value}
            {data.answer ? `（${data.answer}）` : ''}
          </strong>
          {data.explain ? <p>{data.explain}</p> : null}
        </div>
      ) : readOnly ? null : (
        <p className={styles.quizHint}>先猜一个数，再看真实答案。</p>
      )}
    </section>
  );
}

/** 判分作答点：提交后与参考答案比对（宽松字符串匹配）。 */
function CheckpointBlockView({ block, onProgress }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'checkpoint' }>['data'];
  const [answer, setAnswer] = useState('');
  const [attempts, setAttempts] = useState<{ answer: string; correct: boolean }[]>([]);
  const last = attempts[attempts.length - 1];

  const submit = (): void => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    const norm = (s: string): string => s.replace(/[\s，。,.;；]/g, '').toLowerCase();
    const correct = data.expected ? norm(trimmed) === norm(data.expected) : false;
    const next = [...attempts, { answer: trimmed, correct }];
    setAttempts(next);
    onProgress?.({ checkpoint_attempts: [{ answer: trimmed, correct }] });
    setAnswer('');
  };

  return (
    <section className={styles.checkpointBlock}>
      <p className={styles.checkpointPrompt}>{data.prompt}</p>
      <div className={styles.checkpointRow}>
        <input
          type="text"
          value={answer}
          placeholder={data.placeholder || '写下你的答案'}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" onClick={submit} disabled={!answer.trim()}>
          提交
        </button>
      </div>
      {last ? (
        <p className={last.correct ? styles.checkpointGood : styles.checkpointBad} role="status">
          {last.correct ? '回答正确' : data.expected ? `再想想（参考：${data.expected}）` : '已记录'}
        </p>
      ) : null}
    </section>
  );
}

function EmbedBlockView({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'embed' }>['data'];
  if (!data.url) return null;
  return (
    <div className={styles.embedBlock}>
      <iframe src={data.url} height={data.height} title="嵌入内容" loading="lazy" sandbox="allow-scripts allow-same-origin" />
    </div>
  );
}

function parseCanvasDoc(value: Record<string, unknown>): CanvasDoc | null {
  const candidate = value as Partial<CanvasDoc>;
  if (candidate.version !== 1 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.wires) || !Array.isArray(candidate.strokes)) {
    return null;
  }
  return candidate as CanvasDoc;
}

/** 活页内嵌工坊画布：读者可在讲义里直接操作，改动只存在本地沙盒中。 */
function EmbeddedCanvasBlock({ doc, readOnly }: { doc: Record<string, unknown>; readOnly?: boolean }): ReactNode {
  const navigate = useNavigate();
  const initial = useMemo(() => parseCanvasDoc(doc), [doc]);
  const [sandbox, setSandboxState] = useState<CanvasDoc | null>(() => initial ? JSON.parse(JSON.stringify(initial)) as CanvasDoc : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSandbox = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setSandboxState((previous) => {
      if (!previous) return previous;
      return typeof update === 'function' ? (update as (doc: CanvasDoc) => CanvasDoc)(previous) : update;
    });
  }, []);

  if (!sandbox) return <p className={styles.unsupported}>暂不支持此画布内容。</p>;
  const clone = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await worksApi.create(sandbox, `${sandbox.title || '工坊画布'} · 克隆`);
      navigate(`/canvas?work=${encodeURIComponent(created.work_id)}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.canvasEmbed} aria-label="内嵌工坊画布">
      <header className={styles.canvasEmbedHead}>
        <span><b>工坊积木</b> · {sandbox.title || '未命名画布'}</span>
        <button type="button" className={styles.canvasEmbedBtn} disabled={busy} onClick={() => void clone()}>
          {busy ? '克隆中…' : '克隆到我的工坊编辑 ↗'}
        </button>
      </header>
      <div className={styles.canvasEmbedViewport}>
        <CanvasBoard doc={sandbox} setDoc={setSandbox} tool="select" inkColor="#2F3A49" embedded focusContent readOnly={readOnly} />
      </div>
      <p className={styles.canvasEmbedHint}>讲义内操作的是本地沙盒，不会改动原作者文档；需要保存请克隆到自己的工坊。</p>
      {error ? <p className={styles.canvasEmbedError} role="alert">{error}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 分发                                                                */
/* ------------------------------------------------------------------ */

export function BlockView(props: BlockViewProps): ReactNode {
  const { block, controls } = props;
  let body: ReactNode = null;
  switch (block.type) {
    case 'page':
      body = <PageImageBlock {...props} />;
      break;
    case 'text':
      body = <TextBlock {...props} />;
      break;
    case 'figure':
      body = <FigureBlock {...props} />;
      break;
    case 'formula':
      body = <FormulaBlock {...props} />;
      break;
    case 'section':
      body = <SectionBlock {...props} />;
      break;
    case 'lab':
      body = <LabBlockView {...props} />;
      break;
    case 'quiz':
      body = <QuizBlockView {...props} />;
      break;
    case 'checkpoint':
      body = <CheckpointBlockView {...props} />;
      break;
    case 'embed':
      body = <EmbedBlockView {...props} />;
      break;
    case 'canvas':
      body = block.data.doc.version === 1 ? <EmbeddedCanvasBlock doc={block.data.doc} readOnly={props.readOnly} />
        : block.data.doc.template === 'ai_model' ? <LivingAIModel key={String(block.data.doc.model && (block.data.doc.model as { content_hash?: string }).content_hash)} doc={block.data.doc} />
          : block.data.doc.template === 'attention' ? <AttentionDemo /> : <p className={styles.unsupported}>暂不支持此画布内容。</p>;
      break;
    default:
      body = null;
  }
  if (body === null && !controls) return null;
  return (
    <div className={styles.blockShell} data-block-type={block.type}>
      {body}
      {controls}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 建议卡                                                              */
/* ------------------------------------------------------------------ */

const KIND_LABELS: Record<ActivationSuggestion['kind'], string> = {
  formula: '激活为公式',
  lab: '生成解题实验',
  canvas_object: '生成活对象',
  quiz: '变成先猜再看',
  section: '设为小节',
};

export function SuggestionCard(props: {
  suggestion: ActivationSuggestion;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}): ReactNode {
  const { suggestion, busy, onAccept, onDismiss } = props;
  return (
    <aside className={styles.suggestionCard}>
      <div className={styles.suggestionMeta}>
        <span className={styles.suggestionKind}>{KIND_LABELS[suggestion.kind]}</span>
        <span className={styles.suggestionReason}>{suggestion.reason}</span>
      </div>
      <div className={styles.suggestionActions}>
        <button type="button" className={styles.acceptBtn} disabled={busy} onClick={onAccept}>
          激活
        </button>
        <button type="button" className={styles.dismissBtn} disabled={busy} onClick={onDismiss}>
          忽略
        </button>
      </div>
    </aside>
  );
}
