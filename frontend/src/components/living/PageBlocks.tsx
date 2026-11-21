/** 活页块渲染器：编辑器与发布播放器共用的展示层。
 *
 * - 保真层块（page/text/figure/formula/section）永远能渲染，识别失败不丢内容；
 * - 激活层块（lab/quiz/checkpoint/embed）就地可交互；
 * - `onProgress` 只由播放器传入：上报学生端进度（访问/竞猜/判分）。
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LabCanvas } from '@/components/labs/LabCanvas';
import { Formula } from '@/components/showcase/Formula';
import { computeLab } from '@/labs/compute';
import { formatNumber } from '@/labs/expr';
import type { LabProblem, LabResult, LabState } from '@/labs/types';
import type { ActivationSuggestion, CalloutKind, PageBlock, PageRegion } from '@/living/types';
import { REGION_LABELS } from '@/living/types';
import { canInsertRegion, functionDocForRegion, regionAriaLabel, regionStyle } from '@/living/regions';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import type { CanvasDoc } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import { errorMessage } from '@/api/client';
import { gradeLivingAnswer } from '@/api/living';
import { interpolate, useBlockState, useLiveVars } from '@/living/liveVars';
import { panelParamRange } from '@/living/sim';
import styles from './LivingBlocks.module.css';
import { AttentionDemo } from './AttentionDemo';
import { LivingAIModel } from './LivingAIModel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { prepareLivingMarkdown } from '@/living/markdown';

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
  /** 页面全部块 id（门控目标悬挂检测：缺失→解锁+警告） */
  peerIds?: ReadonlySet<string>;
  /** 编辑器注入：把页内区域物化到正文（插入块并回写 block_id）。 */
  onInsertRegion?: (pageBlock: PageBlock, region: PageRegion) => void;
  /** 编辑器注入：对该公式区域跑一次本地公式 OCR（结果缓存回文档）。 */
  onRecognizeFormula?: (pageBlock: PageBlock, region: PageRegion) => Promise<void> | void;
  /** 编辑器注入：为该锚块打开 AI 交互面板。 */
  onAI?: (blockId: string) => void;
}

/** 块完成度（门控用）：submitted < correct；写入时取更高一级。 */
function useCompletionMark(blockId: string): (level: 'submitted' | 'correct') => void {
  const [, setDone] = useBlockState<'submitted' | 'correct' | null>(blockId, 'completed', null);
  return useCallback(
    (level: 'submitted' | 'correct') => {
      setDone((prev) => (prev === 'correct' || level === 'correct' ? 'correct' : 'submitted'));
    },
    [setDone],
  );
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return current;
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

/** 区域聚焦面板内的函数图预览：本地沙盒，不写回文档。 */
function RegionCanvasPreview({ doc }: { doc: CanvasDoc }): ReactNode {
  const [sandbox, setSandboxState] = useState<CanvasDoc>(() => JSON.parse(JSON.stringify(doc)) as CanvasDoc);
  useEffect(() => {
    setSandboxState(JSON.parse(JSON.stringify(doc)) as CanvasDoc);
  }, [doc]);
  const setSandbox = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setSandboxState((previous) => (typeof update === 'function' ? (update as (d: CanvasDoc) => CanvasDoc)(previous) : update));
  }, []);
  return (
    <div className={styles.regionCanvas}>
      <CanvasBoard doc={sandbox} setDoc={setSandbox} tool="select" inkColor="#2F3A49" embedded focusContent />
    </div>
  );
}

/** 示意图标签遮挡自测：标签盖层 → 点开核对，支持全遮/全显。
 *  揭示进度存进块状态，切走再回来不丢。 */
function LabelSelfTest({ pageBlock, region, assetUrl }: {
  pageBlock: PageBlock;
  region: PageRegion;
  assetUrl: (key: string) => string;
}): ReactNode {
  const labels = region.labels ?? [];
  const [revealed, setRevealed] = useBlockState<number[]>(`${pageBlock.id}:${region.id}`, 'reveal', []);
  const [picked, setPicked] = useState<number | null>(null);
  const revealedSet = new Set(revealed);
  const allShown = labels.length > 0 && revealed.length >= labels.length;
  return (
    <div className={styles.labelTest}>
      <div className={styles.labelTestWrap}>
        <img src={assetUrl(region.asset_id)} alt={region.label} loading="lazy" />
        {labels.map((label, index) => (
          <button
            key={index}
            type="button"
            className={revealedSet.has(index) ? styles.labelTag : styles.labelCover}
            style={regionStyle(label)}
            aria-label={revealedSet.has(index) ? `标签：${label.text}` : `第 ${index + 1} 个标签，点击显示`}
            onClick={() => {
              if (!revealedSet.has(index)) setRevealed([...revealed, index]);
              setPicked(index);
            }}
          >
            {revealedSet.has(index) ? label.text : '?'}
          </button>
        ))}
      </div>
      <div className={styles.labelTestBar}>
        <button type="button" onClick={() => setRevealed(allShown ? [] : labels.map((_, i) => i))}>
          {allShown ? '全部遮挡' : '全部显示'}
        </button>
        <span>{revealed.length}/{labels.length} 已显示</span>
      </div>
      {picked !== null && labels[picked] ? (
        <p className={styles.labelDetail}>标签「{labels[picked].text}」{region.caption ? ` — ${region.caption}` : ''}</p>
      ) : (
        <p className={styles.regionHint}>先回忆每个遮挡处的名称，再点开核对。</p>
      )}
    </div>
  );
}

/** 区域聚焦面板：原图 ⇄ 交互图 + 物化动作。编辑器与分享页共用；
 *  分享页只读时隐藏「插入到正文 / AI 交互」。 */
function RegionPanel({ pageBlock, region, assetUrl, readOnly, onInsertRegion, onRecognizeFormula, onAI, onClose }: {
  pageBlock: PageBlock;
  region: PageRegion;
  assetUrl: (key: string) => string;
  readOnly?: boolean;
  onInsertRegion?: (pageBlock: PageBlock, region: PageRegion) => void;
  onRecognizeFormula?: (pageBlock: PageBlock, region: PageRegion) => Promise<void> | void;
  onAI?: (blockId: string) => void;
  onClose: () => void;
}): ReactNode {
  const labels = region.labels ?? [];
  const doc = useMemo(() => functionDocForRegion(region), [region]);
  const interactive = doc !== null || labels.length > 0;
  const [view, setView] = useState<'original' | 'interactive'>('original');
  const [copied, setCopied] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const copyLatex = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(region.latex ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时静默 */ }
  };
  const recognize = async (): Promise<void> => {
    if (!onRecognizeFormula || recognizing) return;
    setRecognizing(true);
    try {
      await onRecognizeFormula(pageBlock, region);
    } finally {
      setRecognizing(false);
    }
  };
  return (
    <div className={styles.regionPanel} role="region" aria-label={regionAriaLabel(region)}>
      <header className={styles.regionPanelHead}>
        <span className={styles.regionKind}>{REGION_LABELS[region.kind] ?? '区域'}</span>
        <strong>{region.label}</strong>
        <button type="button" onClick={onClose}>收起</button>
      </header>
      {interactive ? (
        <div className={styles.regionViews} role="group" aria-label="查看方式">
          <button type="button" className={styles.regionViewBtn} aria-pressed={view === 'original'} onClick={() => setView('original')}>原图</button>
          <button type="button" className={styles.regionViewBtn} aria-pressed={view === 'interactive'} onClick={() => setView('interactive')}>交互图</button>
        </div>
      ) : null}
      {view === 'interactive' && doc ? (
        <RegionCanvasPreview doc={doc} />
      ) : view === 'interactive' && labels.length ? (
        <LabelSelfTest pageBlock={pageBlock} region={region} assetUrl={assetUrl} />
      ) : (
        <>
          <img src={assetUrl(region.asset_id)} alt={region.label} loading="lazy" />
          {region.caption ? <p className={styles.regionCaption}>{region.caption}</p> : null}
          {region.latex ? (
            <div className={styles.regionLatexRow}>
              <Formula tex={region.latex} block />
              <button type="button" className={styles.regionMiniBtn} onClick={() => void copyLatex()}>
                {copied ? '已复制' : '复制 LaTeX'}
              </button>
            </div>
          ) : null}
          {region.expression ? (
            <p className={styles.regionHint}>可求值表达式 f(x) = {region.expression}，切到「交互图」查看函数图。</p>
          ) : null}
          {region.text && region.text !== region.caption ? (
            <details>
              <summary>区域文字</summary>
              <p>{region.text}</p>
            </details>
          ) : null}
        </>
      )}
      <footer className={styles.regionActions}>
        {region.block_id ? (
          <button
            type="button"
            className={styles.regionJump}
            onClick={() => document.getElementById(region.block_id!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            定位到正文
          </button>
        ) : null}
        {region.canvas_block_id ? (
          <button
            type="button"
            className={styles.regionJump}
            onClick={() => document.getElementById(region.canvas_block_id!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            定位函数图
          </button>
        ) : null}
        {!region.block_id && !readOnly && onInsertRegion && canInsertRegion(region) ? (
          <button type="button" className={styles.regionJump} onClick={() => onInsertRegion(pageBlock, region)}>
            插入到正文
          </button>
        ) : null}
        {region.block_id && !region.canvas_block_id && doc && !readOnly && onInsertRegion ? (
          <button type="button" className={styles.regionJump} onClick={() => onInsertRegion(pageBlock, region)}>
            插入函数图
          </button>
        ) : null}
        {!readOnly && onRecognizeFormula && region.kind === 'formula' && !region.latex ? (
          <button type="button" className={styles.regionMiniBtn} disabled={recognizing} onClick={() => void recognize()}>
            {recognizing ? '识别中…（最长约 15 秒）' : '识别公式'}
          </button>
        ) : null}
        {!readOnly && onAI && region.kind === 'formula' && region.block_id ? (
          <button type="button" className={styles.regionMiniBtn} onClick={() => onAI(region.block_id!)}>
            AI 交互
          </button>
        ) : null}
        {region.kind === 'formula' && !doc && region.latex ? (
          <span className={styles.regionHint}>暂不能转成函数图，可试 AI 交互。</span>
        ) : null}
      </footer>
    </div>
  );
}

function PageImageBlock({ block, assetUrl, readOnly, onInsertRegion, onRecognizeFormula, onAI }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'page' }>['data'];
  const [open, setOpen] = useState(!data.collapsed);
  const [showRegions, setShowRegions] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const regions = data.regions ?? [];
  const selected = regions.find((region) => region.id === selectedRegion) ?? null;
  if (!data.image_key) return null;

  // P1.1：热区始终打开聚焦面板；正文锚块/函数图的跳转放进面板按钮。
  const activate = (region: PageRegion): void => {
    setSelectedRegion((current) => current === region.id ? null : region.id);
  };

  return (
    <figure className={styles.pageBlock}>
      <div className={styles.pageHeading}>
        <button
          type="button"
          className={styles.pageToggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{data.alt || '原始页面'}</span>
          <span className={styles.pageToggleHint}>
            {open ? (regions.length ? `${regions.length} 个区域 · 收起原页` : '收起原页') : '对照原页'}
          </span>
        </button>
        {regions.length ? (
          <button
            type="button"
            className={styles.regionToggle}
            aria-pressed={showRegions}
            onClick={() => {
              setShowRegions((value) => !value);
              setSelectedRegion(null);
            }}
          >
            {showRegions ? '隐藏区域' : '显示区域'}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className={styles.pageImageWrap}>
          <img className={styles.pageImage} src={assetUrl(data.image_key)} alt={data.alt || '原始页面'} width={data.width} height={data.height} loading="lazy" />
          {showRegions ? regions.map((region) => (
            <button
              key={region.id}
              type="button"
              className={styles.pageRegion}
              data-kind={region.kind}
              data-active={selectedRegion === region.id ? 'true' : undefined}
              style={regionStyle(region)}
              aria-label={regionAriaLabel(region)}
              aria-expanded={selectedRegion === region.id}
              title={region.label}
              onClick={() => activate(region)}
            >
              <span className={styles.pageRegionChip}>
                {REGION_LABELS[region.kind] ?? '区域'}
                {region.label ? ` · ${region.label.slice(0, 18)}` : ''}
              </span>
            </button>
          )) : null}
        </div>
      ) : null}
      {open && selected ? (
        <RegionPanel
          key={selected.id}
          pageBlock={block}
          region={selected}
          assetUrl={assetUrl}
          readOnly={readOnly}
          onInsertRegion={onInsertRegion}
          onRecognizeFormula={onRecognizeFormula}
          onAI={onAI}
          onClose={() => setSelectedRegion(null)}
        />
      ) : null}
    </figure>
  );
}

const INLINE_VAR = /\[v:([A-Za-z][A-Za-z0-9_]*)\]/g;

/** ``[v:名字]`` 行内参数胶囊：数字变量是迷你滑杆，select 变量是下拉，未定义变量原样显示。 */
function InlineVar({ name }: { name: string }): ReactNode {
  const { defs, values, setValue } = useLiveVars();
  const spec = defs[name];
  if (!spec) return <code className={styles.inlineVarMissing}>[{name}?]</code>;
  const value = values[name] ?? spec.value;
  if (spec.type === 'select') {
    return (
      <select className={styles.inlineVarSelect} value={String(value)} onChange={(e) => setValue(name, e.target.value)} aria-label={spec.label || name}>
        {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const step = spec.step ?? ((max - min) / 100 || 0.01);
  const numeric = typeof value === 'number' ? value : spec.value;
  return (
    <span className={styles.inlineVar} title={`${spec.label || name} = ${formatNumber(numeric)}${spec.unit ?? ''}`}>
      <input type="range" min={min} max={max} step={step} value={numeric} onChange={(e) => setValue(name, Number(e.target.value))} aria-label={spec.label || name} />
      <span className={styles.inlineVarValue}>{formatNumber(numeric)}{spec.unit ?? ''}</span>
    </span>
  );
}

function transformInlineVars(child: ReactNode): ReactNode {
  if (typeof child === 'string') {
    if (!child.includes('[v:')) return child;
    const parts = child.split(INLINE_VAR);
    if (parts.length === 1) return child;
    return parts.map((part, index) => (index % 2 === 1 ? <InlineVar key={index} name={part} /> : part));
  }
  if (React.isValidElement<{ children?: ReactNode; className?: string }>(child)) {
    const className = String(child.props.className ?? '');
    if (className.includes('math')) return child;
    const kids = child.props.children;
    if (kids !== undefined && kids !== null) {
      return React.cloneElement(child, undefined, React.Children.map(kids, transformInlineVars));
    }
  }
  return child;
}

const withInlineVars = (Tag: 'p' | 'li' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'td' | 'th') =>
  function InlineVarsContainer(props: { children?: ReactNode }): ReactNode {
    return <Tag>{React.Children.map(props.children, transformInlineVars)}</Tag>;
  };

const MD_COMPONENTS = {
  p: withInlineVars('p'),
  li: withInlineVars('li'),
  h1: withInlineVars('h1'),
  h2: withInlineVars('h2'),
  h3: withInlineVars('h3'),
  h4: withInlineVars('h4'),
  h5: withInlineVars('h5'),
  h6: withInlineVars('h6'),
  td: withInlineVars('td'),
  th: withInlineVars('th'),
};

function LivingMarkdown({ markdown }: { markdown: string }): ReactNode {
  return (
    <ReactMarkdown skipHtml components={MD_COMPONENTS} remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }]]}>
      {markdown}
    </ReactMarkdown>
  );
}

function TextBlock({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'text' }>['data'];
  const { values } = useLiveVars();
  const markdown = useMemo(() => prepareLivingMarkdown(interpolate(data.md, values)), [data.md, values]);
  const body = <div className={styles.textBlock}><LivingMarkdown markdown={markdown} /></div>;
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
  const { values } = useLiveVars();
  const tex = useMemo(() => interpolate(data.latex, values), [data.latex, values]);
  return (
    <div className={styles.formulaBlock}>
      <Formula tex={tex} block />
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

/** 嵌入实验块：冻结 problem + 前端确定性引擎 = 学生端可交互的解题过程。
 *  支持 ``bindings``（块内 engine_params 键 ← 页面变量），滑杆拖拽经 150ms
 *  防抖后才整题重算；折叠/步进/答案状态提升到页级 Map，收起再展开不丢。 */
function LabBlockView({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'lab' }>['data'];
  const { defs, values } = useLiveVars();
  const problem = useMemo<LabProblem>(
    () => ({ ...data.problem, states: EMPTY_STATE }),
    [data.problem],
  );
  const [open, setOpen] = useBlockState(block.id, 'open', false);
  const [step, setStep] = useBlockState(block.id, 'step', 0);
  const [showAnswer, setShowAnswer] = useBlockState(block.id, 'answer', false);
  const [cache, setCache] = useBlockState<{ key: string; result: LabResult | null } | null>(block.id, 'result', null);

  const boundParams = useMemo<Record<string, number | string>>(() => {
    const out: Record<string, number | string> = {};
    for (const [paramKey, varName] of Object.entries(block.bindings ?? {})) {
      const value = values[varName];
      if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string') {
        out[paramKey] = value;
      }
    }
    return out;
  }, [block.bindings, values]);
  const debounced = useDebouncedValue(boundParams, 150);
  const missingVars = useMemo(
    () => [...new Set(Object.values(block.bindings ?? {}).filter((name) => !defs[name]))],
    [block.bindings, defs],
  );

  const params = useMemo(
    () => ({ ...(problem.model?.defaults ?? {}), ...data.engine_params, ...debounced }),
    [problem, data.engine_params, debounced],
  );
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);

  const result = useMemo<LabResult | null>(() => {
    if (!open) return null;
    if (cache && cache.key === paramsKey) return cache.result;
    try {
      return computeLab(problem, params);
    } catch {
      return null;
    }
  }, [open, cache, paramsKey, problem, params]);

  useEffect(() => {
    if (open && (!cache || cache.key !== paramsKey)) setCache({ key: paramsKey, result });
  }, [open, cache, paramsKey, result, setCache]);

  const frameCount = result?.trace?.length ?? 0;
  const clamped = Math.min(step, Math.max(0, frameCount - 1));

  return (
    <section className={styles.labBlock}>
      <header className={styles.labHead}>
        <span className={styles.labBadge}>实验</span>
        <span className={styles.labTitle}>{problem.title || problem.text?.slice(0, 60)}</span>
        {missingVars.length ? (
          <span className={styles.bindWarn} title="以下页面变量已不存在，绑定降级为静态参数">
            变量失效：{missingVars.join('、')}
          </span>
        ) : null}
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
  const markDone = useCompletionMark(block.id);

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
              // 门控打点：猜值落在实际值 ±2% 量程内算 correct，否则 submitted
              const tolerance = (data.max - data.min) * 0.02;
              markDone(Math.abs(guess - data.value) <= tolerance ? 'correct' : 'submitted');
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

/** 判分作答点：提交后调 ``/living/grade`` 判分。
 *  ``grading`` 模式：``exact`` 宽松文本比对（默认，兼容旧文档）、``expr``
 *  数学等价（``1/2``≡``0.5``、``x^2+C``≡``C+x^2``）、``numeric`` 纯数值。 */
function CheckpointBlockView({ block, onProgress }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'checkpoint' }>['data'];
  const mode = data.grading ?? 'exact';
  const [answer, setAnswer] = useBlockState(block.id, 'draft', '');
  const [busy, setBusy] = useState(false);
  const markDone = useCompletionMark(block.id);
  const [attempts, setAttempts] = useBlockState<{ answer: string; correct: boolean; reason?: string }[]>(
    block.id, 'attempts', [],
  );
  const last = attempts[attempts.length - 1];

  const submit = async (): Promise<void> => {
    const trimmed = answer.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    let record: { answer: string; correct: boolean; reason?: string };
    try {
      const graded = await gradeLivingAnswer({ answer: trimmed, expected: data.expected, mode });
      record = { answer: trimmed, correct: graded.correct, reason: graded.reason ?? undefined };
    } catch (cause) {
      if (mode === 'exact') {
        const norm = (s: string): string => s.replace(/[\s，。,.;；]/g, '').toLowerCase();
        record = { answer: trimmed, correct: !!data.expected && norm(trimmed) === norm(data.expected) };
      } else {
        record = { answer: trimmed, correct: false, reason: `判分服务暂不可用：${errorMessage(cause)}` };
      }
    }
    setBusy(false);
    setAttempts([...attempts, record]);
    markDone(record.correct ? 'correct' : 'submitted');
    onProgress?.({ checkpoint_attempts: [{ answer: trimmed, correct: record.correct }] });
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
            if (e.key === 'Enter') void submit();
          }}
        />
        <button type="button" onClick={() => void submit()} disabled={!answer.trim() || busy}>
          {busy ? '判分中…' : '提交'}
        </button>
      </div>
      {last ? (
        <p className={last.correct ? styles.checkpointGood : styles.checkpointBad} role="status">
          {last.correct
            ? '回答正确'
            : last.reason ?? (data.expected ? `再想想（参考：${data.expected}）` : '已记录')}
        </p>
      ) : null}
    </section>
  );
}

function EmbedBlockView({ block, readOnly }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'embed' }>['data'];
  if (!data.url) return readOnly ? null : <div className={styles.placeholder}>尚未配置嵌入网页，请点击“编辑”填写地址和高度。</div>;
  let safe = false;
  try {
    const url = new URL(data.url);
    safe = ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { /* 旧文档中的非法地址不加载到 iframe。 */ }
  if (!safe) return <div className={styles.placeholder}>嵌入地址无效，请使用 http/https 网页地址。</div>;
  return (
    <div className={styles.embedBlock}>
      <iframe src={data.url} height={data.height} title="嵌入内容" loading="lazy" sandbox="allow-scripts" referrerPolicy="no-referrer" />
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

interface PanelView {
  title?: string;
  viewIds: ReadonlySet<string>;
  exposed: { node_id: string; param_key: string; label: string; min?: number; max?: number; step?: number }[];
}

/** 解析 ``doc.panel`` 仪器面板契约；无有效内容返回 null。 */
function parsePanel(raw: unknown): PanelView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as { view_node_ids?: unknown; exposed_params?: unknown; title?: unknown };
  const viewIds = new Set(
    (Array.isArray(p.view_node_ids) ? p.view_node_ids : []).filter((v): v is string => typeof v === 'string' && !!v),
  );
  const exposed = (Array.isArray(p.exposed_params) ? p.exposed_params : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      node_id: String(e.node_id ?? ''),
      param_key: String(e.param_key ?? ''),
      label: String(e.label ?? ''),
      ...(typeof e.min === 'number' ? { min: e.min } : {}),
      ...(typeof e.max === 'number' ? { max: e.max } : {}),
      ...(typeof e.step === 'number' ? { step: e.step } : {}),
    }))
    .filter((e) => e.node_id && e.param_key);
  if (!viewIds.size && !exposed.length) return null;
  return { title: typeof p.title === 'string' ? p.title : undefined, viewIds, exposed };
}

/** 活页内嵌工坊画布：读者可在讲义里直接操作，改动只存在本地沙盒中。
 *  ``bindings`` 的键是精确坐标 ``node_id.param_key``，值是页面变量名；
 *  变量更新经 150ms 防抖后写入沙盒对应节点 params，由画布引擎自动重算。
 *  目标变量或节点缺失 → 该绑定降级为静态值并给出警告，不静默丢弃。 */
function EmbeddedCanvasBlock({ block, readOnly }: { block: Extract<PageBlock, { type: 'canvas' }>; readOnly?: boolean }): ReactNode {
  const navigate = useNavigate();
  const { defs, values } = useLiveVars();
  const doc = block.data.doc;
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

  const boundEntries = useMemo(() => {
    const out: { nodeId: string; paramKey: string; value: number }[] = [];
    for (const [key, varName] of Object.entries(block.bindings ?? {})) {
      const dot = key.indexOf('.');
      if (dot <= 0) continue;
      const value = values[varName];
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.push({ nodeId: key.slice(0, dot), paramKey: key.slice(dot + 1), value });
      }
    }
    return out;
  }, [block.bindings, values]);
  const debounced = useDebouncedValue(boundEntries, 150);
  const panel = useMemo(() => parsePanel(block.data.doc.panel), [block.data.doc]);
  const [instrument, setInstrument] = useState(() => panel !== null);
  const boundSig = JSON.stringify(debounced);

  useEffect(() => {
    if (!debounced.length) return;
    setSandboxState((previous) => {
      if (!previous) return previous;
      let changed = false;
      const nodes = previous.nodes.map((node) => {
        const patches = debounced.filter((entry) => entry.nodeId === node.id);
        if (!patches.length) return node;
        const params = { ...node.params };
        let dirty = false;
        for (const patch of patches) {
          if (params[patch.paramKey] !== patch.value) {
            params[patch.paramKey] = patch.value;
            dirty = true;
          }
        }
        if (dirty) changed = true;
        return dirty ? { ...node, params } : node;
      });
      return changed ? { ...previous, nodes } : previous;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundSig 携带全部信息
  }, [boundSig]);

  const bindWarnings = useMemo(() => {
    const warnings: string[] = [];
    const missingVars = [...new Set(Object.values(block.bindings ?? {}).filter((name) => !defs[name]))];
    if (missingVars.length) warnings.push(`变量失效：${missingVars.join('、')}`);
    const nonNumericVars = [...new Set(
      Object.values(block.bindings ?? {}).filter((name) => defs[name] && defs[name]!.type !== 'number'),
    )];
    if (nonNumericVars.length) warnings.push(`画布节点仅支持数值变量：${nonNumericVars.join('、')}`);
    if (sandbox) {
      const nodeIds = new Set(sandbox.nodes.map((node) => node.id));
      const missingNodes = [...new Set(
        Object.keys(block.bindings ?? {})
          .map((key) => key.split('.')[0])
          .filter((id) => id && !nodeIds.has(id)),
      )];
      if (missingNodes.length) warnings.push(`画布节点不存在：${missingNodes.join('、')}`);
      if (panel) {
        const missingViews = [...panel.viewIds].filter((id) => !nodeIds.has(id));
        if (missingViews.length) warnings.push(`面板视图节点不存在：${missingViews.join('、')}`);
        const missingExposed = panel.exposed
          .filter((entry) => !nodeIds.has(entry.node_id))
          .map((entry) => `${entry.node_id}.${entry.param_key}`);
        if (missingExposed.length) warnings.push(`面板外露参数目标不存在：${missingExposed.join('、')}`);
      }
    }
    return warnings;
  }, [block.bindings, defs, sandbox, panel]);

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
  const panelActive = instrument && panel !== null;
  const patchExposed = (nodeId: string, paramKey: string, value: number): void => {
    setSandboxState((previous) => previous ? {
      ...previous,
      nodes: previous.nodes.map((node) =>
        node.id === nodeId ? { ...node, params: { ...node.params, [paramKey]: value } } : node,
      ),
    } : previous);
  };
  return (
    <section className={styles.canvasEmbed} aria-label="内嵌工坊画布">
      <header className={styles.canvasEmbedHead}>
        <span><b>{panelActive ? '仪器面板' : '工坊积木'}</b> · {(panelActive && panel.title) || sandbox.title || '未命名画布'}</span>
        {panel ? (
          <button type="button" className={styles.canvasEmbedBtn} onClick={() => setInstrument((v) => !v)}>
            {panelActive ? '全图浏览' : '仪器面板'}
          </button>
        ) : null}
        <button type="button" className={styles.canvasEmbedBtn} disabled={busy} onClick={() => void clone()}>
          {busy ? '克隆中…' : '克隆到我的工坊编辑 ↗'}
        </button>
      </header>
      {panelActive && panel.exposed.length ? (
        <div className={styles.panelStrip} role="group" aria-label="面板外露参数">
          {panel.exposed.map((entry) => {
            const target = sandbox.nodes.find((node) => node.id === entry.node_id);
            const raw = target?.params[entry.param_key];
            const fallbackRange = panelParamRange(entry, typeof raw === 'number' ? raw : 0);
            const value = typeof raw === 'number' ? raw : fallbackRange.min;
            const range = panelParamRange(entry, value);
            return (
              <label key={`${entry.node_id}.${entry.param_key}`} className={styles.panelControl}>
                <span>{entry.label || `${entry.node_id}.${entry.param_key}`}</span>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={value}
                  disabled={!target}
                  onChange={(e) => patchExposed(entry.node_id, entry.param_key, Number(e.target.value))}
                />
                <output>{formatNumber(value)}</output>
              </label>
            );
          })}
        </div>
      ) : null}
      <div className={styles.canvasEmbedViewport}>
        <CanvasBoard
          doc={sandbox}
          setDoc={setSandbox}
          tool="select"
          inkColor="#2F3A49"
          embedded
          focusContent
          readOnly={panelActive ? true : readOnly}
          visibleNodeIds={panelActive && panel.viewIds.size ? panel.viewIds : undefined}
        />
      </div>
      <p className={styles.canvasEmbedHint}>讲义内操作的是本地沙盒，不会改动原作者文档；需要保存请克隆到自己的工坊。</p>
      {bindWarnings.length ? (
        <p className={styles.bindWarn} role="status">{bindWarnings.join('；')}（相关绑定降级为静态值）</p>
      ) : null}
      {error ? <p className={styles.canvasEmbedError} role="alert">{error}</p> : null}
    </section>
  );
}

const CALLOUT_META: Record<CalloutKind, { label: string; icon: string }> = {
  theorem: { label: '定理', icon: '∴' },
  proof: { label: '证明', icon: '□' },
  example: { label: '例题', icon: '✎' },
  warning: { label: '易错提示', icon: '⚠' },
};

/** 语义化知识卡片：定理/证明/例题/易错提示，支持折叠，正文走同一套 md+KaTeX。 */
function CalloutBlockView({ block }: BlockViewProps): ReactNode {
  const data = block.data as Extract<PageBlock, { type: 'callout' }>['data'];
  const { values } = useLiveVars();
  const markdown = useMemo(() => prepareLivingMarkdown(interpolate(data.md, values)), [data.md, values]);
  const meta = CALLOUT_META[data.kind] ?? CALLOUT_META.example;
  const head = (
    <span className={styles.calloutHead}>
      <span className={styles.calloutKind}>{meta.icon} {meta.label}</span>
      {data.title ? <span className={styles.calloutTitle}>{data.title}</span> : null}
    </span>
  );
  if (data.collapsible) {
    return (
      <details className={`${styles.callout} ${styles[`callout_${data.kind}`]}`}>
        <summary>{head}</summary>
        <div className={styles.calloutBody}><LivingMarkdown markdown={markdown} /></div>
      </details>
    );
  }
  return (
    <section className={`${styles.callout} ${styles[`callout_${data.kind}`]}`}>
      {head}
      <div className={styles.calloutBody}><LivingMarkdown markdown={markdown} /></div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 分发                                                                */
/* ------------------------------------------------------------------ */

export function BlockView(props: BlockViewProps): ReactNode {
  const { block, controls } = props;
  const { states } = useLiveVars();
  // 门控：locked_until 指向的兄弟块需先完成（submitted/correct）；
  // 目标悬挂（块已删）按统一规则降级为解锁+编辑器警告。
  const gate = block.locked_until;
  const gateTargetMissing = !!(gate && props.peerIds && !props.peerIds.has(gate.block_id));
  const gateLevel = gate ? states[gate.block_id]?.completed : undefined;
  const gateSatisfied = !gate || gateTargetMissing
    || gateLevel === 'correct' || (gate.rule !== 'correct' && gateLevel === 'submitted');
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
      body = <QuizBlockView key={JSON.stringify(block.data)} {...props} />;
      break;
    case 'checkpoint':
      body = <CheckpointBlockView key={JSON.stringify(block.data)} {...props} />;
      break;
    case 'embed':
      body = <EmbedBlockView {...props} />;
      break;
    case 'callout':
      body = <CalloutBlockView {...props} />;
      break;
    case 'canvas':
      body = block.data.doc.version === 1 ? <EmbeddedCanvasBlock block={block} readOnly={props.readOnly} />
        : block.data.doc.template === 'ai_model' ? <LivingAIModel key={String(block.data.doc.model && (block.data.doc.model as { content_hash?: string }).content_hash)} doc={block.data.doc} />
          : block.data.doc.template === 'attention' ? <AttentionDemo /> : <p className={styles.unsupported}>暂不支持此画布内容。</p>;
      break;
    default: {
      const unknown = block as { type: string; data: Record<string, unknown> };
      body = <section className={styles.placeholder} aria-label="不支持的块">
        <strong>暂不支持的块类型：{unknown.type}</strong>
        <p>{props.readOnly ? '当前版本无法展示此内容，原始数据仍保留在文档中。' : '原始数据已保留，可移动或删除；更新到支持此类型的版本后可继续使用。'}</p>
        {!props.readOnly ? <details><summary>查看原始数据</summary><pre>{JSON.stringify(unknown.data, null, 2)}</pre></details> : null}
      </section>;
    }
  }
  if (body === null && !controls) return null;
  if (gate && props.readOnly && !gateSatisfied) {
    return (
      <div className={styles.blockShell} data-block-type={block.type}>
        <div className={styles.gated}>
          <div className={styles.gatedBody} aria-hidden="true">{body}</div>
          <div className={styles.gateMask} role="status">
            <span className={styles.gateIcon} aria-hidden="true">🔒</span>
            {gate.rule === 'correct' ? '先答对上面的题目再解锁' : '完成上面的探索后解锁'}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.blockShell} data-block-type={block.type}>
      {gate && !props.readOnly ? (
        <p className={styles.gateBadge} role="status">
          🔒 门控{gate.rule === 'correct' ? '（答对解锁）' : '（完成解锁）'}：目标块 {gate.block_id}
          {gateTargetMissing ? ' —— 目标已删除，自动解锁' : ''}
        </p>
      ) : null}
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
  const label = suggestion.kind === 'canvas_object' && suggestion.proposal?.template === 'page_lab'
    ? 'AI 交互模型' : KIND_LABELS[suggestion.kind];
  return (
    <aside className={styles.suggestionCard}>
      <div className={styles.suggestionMeta}>
        <span className={styles.suggestionKind}>{label}</span>
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
