import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ISpec, SpecEvaluation } from '@/ispec/types';
import type { FigureView, SpecView } from '@/ispec/types';
import { FigureSpecView } from '@/components/ispec/views/FigureSpecView';
import { VegaSpecView } from '@/components/ispec/views/VegaSpecView';
import { TextSpecView } from '@/components/ispec/views/TextSpecView';
import { FormulaExplorer } from '@/components/presentation/FormulaExplorer';
import { formatNumberSmart } from '@/ispec/format';
import { KeyControls } from './KeyControls';
import { ExperimentTimeline } from './ExperimentTimeline';
import { OriginalComparison } from './OriginalComparison';
import { DualPathExperiment } from './DualPathExperiment';
import { SceneRouter, SPECIALIZED_SCENES } from './SceneRouter';
import { TrustBadge } from '@/components/trust/TrustBadge';
import { TrustPanel } from '@/components/trust/TrustPanel';
import type { TrustReport } from '@/ispec/types';
import { PredictionPanel } from './PredictionPanel';
import { buildPrediction, checkPrediction } from './predictions';
import { usePredictionStore } from '@/state/predictionStore';
import styles from './ExperimentStage.module.css';

interface Props {
  spec: ISpec;
  evaluation: SpecEvaluation;
  /** 控件读即时值，保证滑块不滞后。 */
  values: Record<string, number | boolean | string>;
  /** 图形与结论读延后值，拖动时跳过中间帧。 */
  renderValues: Record<string, number | boolean | string>;
  stale?: boolean;
  visual?: SpecView;
  pageNo: number;
  pageTitle?: string;
  originalImageUrl?: string;
  pageWidth?: number;
  pageHeight?: number;
  materialId?: string;
  onTrustUpdated?: (trust: TrustReport, parameterId: string) => void;
  reducedMotion: boolean;
  presenting?: boolean;
  advancedOpen?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onChange: (id: string, value: number | boolean | string) => void;
  onClose: () => void;
  onReset: () => void;
  onAdvanced: () => void;
}

const DEFAULT_STAGES = [{ id: 'input', label: '输入' }, { id: 'middle', label: '中间态' }, { id: 'final', label: '最终' }];
const ANIMATED_FIGURES = new Set(['step_diagram', 'grid_transform', 'circle_ellipse']);

function valueText(value: number | boolean | string | undefined, parameterId?: string): string {
  if (typeof value === 'number') return formatNumberSmart(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === undefined) return '—';
  if (parameterId === 'steps_order') return value === 'A' ? '先转后拉' : value === 'B' ? '先拉后转' : String(value);
  if (parameterId === 'steps_shape') return value === 'rectangle' ? '矩形' : value === 'basis' ? '基向量' : String(value);
  const labels: Record<string, Record<string, string>> = {
    rank_case: {embed_3x2: '3×2 嵌入三维', project_2x3: '2×3 压成平面', plane_to_line: '压成直线'},
    det_case: {unit: '单位方格', scale: '横向纵向伸缩', shear: '剪切', projection: '压到横轴'},
    relation_case: {equivalent: '等价', similar: '相似', congruent: '合同'},
  };
  return labels[parameterId ?? '']?.[String(value)] ?? String(value);
}

export const ExperimentStage = memo(function ExperimentStage({ spec, evaluation, values, renderValues, stale, visual, pageNo, pageTitle, originalImageUrl, pageWidth, pageHeight, materialId, onTrustUpdated, reducedMotion, presenting, advancedOpen, canUndo, canRedo, onUndo, onRedo, onChange, onClose, onReset, onAdvanced }: Props) {
  const scene = spec.scene;
  const isDualPath = scene?.scene_type === 'dual_path_order';
  const specialized = !!scene?.scene_type && SPECIALIZED_SCENES.has(scene.scene_type);
  const stages = (scene?.stages && scene.stages.length === 3 ? scene.stages : DEFAULT_STAGES) as Array<{ id: string; label: string }>;
  const figure = visual?.type === 'figure' ? visual as FigureView : undefined;
  const animated = !!figure && ANIMATED_FIGURES.has(figure.spec_ref);
  const hasTimeline = isDualPath || (specialized ? scene?.scene_type === 'svd_process' : animated);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [comparison, setComparison] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [predictMode, setPredictMode] = useState(false);
  const [predictPhase, setPredictPhase] = useState<'ask' | 'locked' | 'revealed'>('ask');
  const [prediction, setPrediction] = useState('');
  const [predictionCorrect, setPredictionCorrect] = useState<boolean | null>(null);
  const predictionQuestion = useMemo(() => buildPrediction(spec, evaluation, renderValues), [spec, evaluation, renderValues]);
  const savePrediction = usePredictionStore((state) => state.save);

  useEffect(() => {
    if (!predictMode) return;
    setPredictPhase('ask');
    setPrediction('');
    setPredictionCorrect(null);
  }, [predictMode, predictionQuestion?.signature]);

  const frame = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stop = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    stop();
    setPlaying(false);
    setProgress(1);
    setComparison(false);
  }, [spec.object_id, stop]);
  const togglePlay = useCallback(() => {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    stop();
    setProgress(0);
    setPlaying(true);
    const started = performance.now();
    const duration = 1700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
        setPlaying(false);
      }
    };
    frame.current = requestAnimationFrame(tick);
  }, [playing, reducedMotion, stop]);
  const seek = useCallback((value: number) => {
    stop();
    setPlaying(false);
    setProgress(Math.max(0, Math.min(1, value)));
  }, [stop]);
  const step = useCallback((direction: -1 | 1) => {
    const current = Math.round(progress * 2) / 2;
    seek(Math.max(0, Math.min(1, current + direction * 0.5)));
  }, [progress, seek]);

  const lockPrediction = useCallback(() => {
    if (!predictionQuestion || !prediction.trim()) return;
    const correct = checkPrediction(predictionQuestion, prediction);
    setPredictionCorrect(correct);
    setPredictPhase('locked');
    savePrediction({
      objectId: spec.object_id,
      questionId: predictionQuestion.id,
      prompt: predictionQuestion.prompt,
      prediction,
      answer: predictionQuestion.answer,
      correct,
      createdAt: new Date().toISOString(),
    });
  }, [prediction, predictionQuestion, savePrediction, spec.object_id]);

  const revealPrediction = useCallback(() => {
    setPredictPhase('revealed');
    if (reducedMotion) setProgress(1);
    else if (!playing) togglePlay();
  }, [playing, reducedMotion, togglePlay]);

  const resetPrediction = useCallback(() => {
    stop();
    setPlaying(false);
    setProgress(1);
    setPredictPhase('ask');
    setPrediction('');
    setPredictionCorrect(null);
  }, [stop]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ' && (event.target as Element | null)?.closest('button, a, [role="button"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        togglePlay();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, togglePlay]);
  const controlIds = useMemo(() => {
    const declared = (scene?.controls ?? []).filter(id => spec.parameters.some(parameter => parameter.id === id));
    if (declared.length) return declared;
    return spec.parameters.filter(parameter => parameter.type === undefined || parameter.type === 'number' || parameter.type === 'integer')
      .slice(0, 6).map(parameter => parameter.id);
  }, [scene?.controls, spec.parameters]);
  const textViews = spec.views.filter(view => view.type === 'text');
  const sourceStatus = scene?.source_status ?? (spec.parameters.some(parameter => parameter.source.status === 'inferred') ? 'inferred' : 'original');
  const stageIndex = progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2;
  const unsupportedVersion = !!scene && scene.version !== '1.0';
  const det = evaluation.derived.det;
  const singular = typeof det === 'number' && Math.abs(det) < 1e-9 && !!spec.expressions?.some(expression => expression.id === 'det');

  return <section className={styles.stage} ref={stageRef} data-presenting={presenting} aria-label={`实验：${scene?.title ?? spec.title ?? '交互对象'}`}>
    <header className={styles.stageHeader}>
      <div className={styles.stageHeading}>
        <span className={styles.kicker}>实验 · 第 {pageNo} 页</span>
        <h2>{scene?.title ?? spec.title ?? '交互实验'}</h2>
        <div className={styles.stageMeta}>
          <span data-status={sourceStatus}>{sourceStatus === 'inferred' ? '含推断条件，请核对' : sourceStatus === 'confirmed' ? '用户确认条件' : '原页条件'}</span>
          <TrustBadge trust={spec.trust} onClick={() => setTrustOpen(true)} />
          {hasTimeline && <span>{stages.map(item => item.label).join(' → ')}</span>}
        </div>
      </div>
      <div className={styles.stageActions}>
        <button type="button" className={styles.authorAction} aria-pressed={predictMode}
          disabled={!predictionQuestion}
          title={predictionQuestion ? '先提交预测，再显示结果' : '当前对象没有可预测的数值结果'}
          onClick={() => setPredictMode((current) => !current)}>先猜后验</button>
        {!presenting && <button type="button" className={styles.authorAction} onClick={() => setComparison(true)}>原稿对照</button>}
        {!presenting && <button type="button" className={styles.authorAction} aria-pressed={advancedOpen} onClick={onAdvanced}>{advancedOpen ? '收起参数' : '完整参数'}</button>}
        <button type="button" onClick={() => { void stageRef.current?.requestFullscreen?.().catch(() => undefined); }} aria-label="放大实验">放大</button>
        {!presenting && <button type="button" className={styles.backButton} onClick={onClose}>返回原页</button>}
      </div>
    </header>
    <div className={styles.stageBody}>
      <div className={styles.canvasColumn} data-stale={stale ? 'true' : undefined}>
        <div className={styles.canvasFrame}>
          {predictMode && predictPhase !== 'revealed' && predictionQuestion ? (
            <PredictionPanel question={predictionQuestion} phase={predictPhase} response={prediction}
              correct={predictionCorrect} onChange={setPrediction} onLock={lockPrediction}
              onReveal={revealPrediction} onReset={resetPrediction}/>
          ) : isDualPath ? <DualPathExperiment spec={spec} values={renderValues} progress={progress} reducedMotion={reducedMotion}/> :
            specialized ? <SceneRouter sceneType={scene!.scene_type} spec={spec} evaluation={evaluation} values={renderValues}
              progress={progress} reducedMotion={reducedMotion} onChange={onChange}/> :
            visual?.type === 'figure' ? <FigureSpecView view={visual} spec={spec} evaluation={evaluation}
              stage={stageIndex as 0 | 1 | 2} progress={progress} reducedMotion={reducedMotion} draggable onParamChange={onChange}/> :
            visual?.type === 'vega' ? <VegaSpecView view={visual} spec={spec} evaluation={evaluation} reducedMotion={reducedMotion}/> :
            spec.expressions?.length ? <FormulaExplorer key={spec.object_id} spec={spec} evaluation={evaluation} onChange={onChange} onPage/> :
            <div className={styles.emptyCanvas}>这个交互没有图形视图，请使用右侧参数与结论。</div>}
        </div>
        {predictMode && predictPhase === 'revealed' && predictionQuestion ? (
          <PredictionPanel question={predictionQuestion} phase={predictPhase} response={prediction}
            correct={predictionCorrect} onChange={setPrediction} onLock={lockPrediction}
            onReveal={revealPrediction} onReset={resetPrediction}/>
        ) : null}
        {hasTimeline && (predictPhase === 'revealed' || !predictMode) && <ExperimentTimeline stages={stages} progress={progress} playing={playing}
          onProgress={seek} onToggle={togglePlay} onStep={step}/>}
        {!isDualPath && !specialized && textViews.length > 0 && (predictPhase === 'revealed' || !predictMode) && <div className={styles.stageConclusion} aria-label="当前解释">
          {textViews.map((view, index) => view.type === 'text' ? <TextSpecView key={index} view={view} evaluation={evaluation} changed={false}/> : null)}
        </div>}
        {unsupportedVersion && <div className={styles.stageError} role="alert">场景版本 {scene?.version} 暂不支持，已按通用实验显示；请更新前端或重新提取交互。</div>}
        {singular && (predictPhase === 'revealed' || !predictMode) && <div className={styles.stageStatus} role="status">det = 0：当前矩阵奇异，逆不唯一；存在无解或整条原像线，结论按当前条件重算。</div>}
        {evaluation.violations.length > 0 && (predictPhase === 'revealed' || !predictMode) && <div className={styles.stageError} role="alert">
          {evaluation.violations.map((violation, index) => <p key={index}>{violation.message}</p>)}
        </div>}
      </div>
      <aside className={styles.controlRail} aria-label="实验控制">
        <KeyControls spec={spec} values={values} ids={controlIds} onChange={onChange}/>
        <div className={styles.railSection}>
          <div className={styles.railHeading}><span>当前条件</span><small>与图形、结论同一份输入</small></div>
          <dl className={styles.valueList}>{controlIds.map(id => {
            const parameter = spec.parameters.find(item => item.id === id);
            return parameter ? <div key={id}><dt>{parameter.label}</dt><dd>{valueText(values[id] ?? parameter.default, parameter.id)}{parameter.unit ? ` ${parameter.unit}` : ''}</dd></div> : null;
          })}</dl>
        </div>
        {!isDualPath && !specialized && (predictPhase === 'revealed' || !predictMode) && <div className={styles.railSection}>
          <div className={styles.railHeading}><span>计算结果</span><small>随输入即时更新</small></div>
          <dl className={styles.valueList}>{Object.entries(evaluation.derived).slice(0, 8).map(([key, value]) =>
            <div key={key}><dt>{spec.expressions?.find(expression => expression.id === key)?.label ?? key}</dt><dd>{valueText(value)}</dd></div>)}
          </dl>
        </div>}
        <div className={styles.railSection}>
          <div className={styles.railHeading}><span>条件说明</span></div>
          <p className={styles.railHint}>{scene?.condition_note || spec.notes || '参数与来源来自识别结果，当前结果按此条件实时计算。'}</p>
        </div>
        <div className={styles.railActions}>
          {!presenting && <div className={styles.historyActions}>
            <button type="button" onClick={onUndo} disabled={!canUndo}>撤销上一步参数</button>
            <button type="button" onClick={onRedo} disabled={!canRedo}>重做</button>
          </div>}
          <button type="button" onClick={onReset}>恢复本实验基准</button>
          {!presenting && <button type="button" onClick={onClose}>返回原稿阅读</button>}
        </div>
      </aside>
    </div>
    {comparison && <OriginalComparison spec={spec} values={renderValues} evaluation={evaluation} pageNo={pageNo}
      pageTitle={pageTitle} originalImageUrl={originalImageUrl} onClose={() => setComparison(false)}/>}
    {trustOpen && <TrustPanel spec={spec} materialId={materialId} pageNo={pageNo} pageTitle={pageTitle}
      imageUrl={originalImageUrl} pageWidth={pageWidth} pageHeight={pageHeight}
      onClose={() => setTrustOpen(false)} onUpdated={onTrustUpdated}/>}
  </section>;
});
