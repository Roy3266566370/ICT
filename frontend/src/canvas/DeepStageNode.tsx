import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import { computeDeepStageValue, findDeepStage } from './deepPipeline.ts';
import type { DeepPanoramaKind, DeepScenarioPreset, DeepStageRenderState } from './deepPanoramaTypes.ts';
import { round, type Matrix } from './deepPanoramaEngine.ts';
import styles from './deepPanorama.module.css';
import { MLP_PRESETS, MlpFoldStage, MlpGradientStage, MlpOptimizerStage, MlpSourceStage } from './deepPanoramas/MlpBackpropPanorama.tsx';
import { CNN_PRESETS, CnnConvStage, CnnReceptiveStage, CnnResidualStage, CnnSourceStage } from './deepPanoramas/CnnResnetPanorama.tsx';
import { TRANSFORMER_PRESETS, TransformerArcStage, TransformerMultiheadStage, TransformerProjectionStage, TransformerSourceStage } from './deepPanoramas/TransformerAttentionPanorama.tsx';
import { LLM_PRESETS, LlmCacheStage, LlmLoraStage, LlmSamplingStage, LlmSourceStage } from './deepPanoramas/LlmInferenceLoraPanorama.tsx';
import { DIFFUSION_PRESETS, DiffusionCoreStage, DiffusionLatentStage, DiffusionScoreStage, DiffusionSourceStage } from './deepPanoramas/DiffusionLatentPanorama.tsx';
import { RL_PRESETS, RlBellmanStage, RlEnvironmentStage, RlExploreStage, RlPolicyStage } from './deepPanoramas/RlAgentPanorama.tsx';

type StageComponent = ComponentType<DeepStageRenderState>;

const STAGE_COMPONENTS: Record<DeepPanoramaKind, Record<string, StageComponent>> = {
  'dl-mlp-backprop': { source: MlpSourceStage, core: MlpFoldStage, viewA: MlpGradientStage, viewB: MlpOptimizerStage },
  'dl-cnn-resnet': { source: CnnSourceStage, core: CnnConvStage, viewA: CnnReceptiveStage, viewB: CnnResidualStage },
  'dl-transformer-attention': { source: TransformerSourceStage, core: TransformerProjectionStage, viewA: TransformerArcStage, viewB: TransformerMultiheadStage },
  'dl-llm-inference-lora': { source: LlmSourceStage, core: LlmCacheStage, viewA: LlmSamplingStage, viewB: LlmLoraStage },
  'dl-diffusion-latent': { source: DiffusionSourceStage, core: DiffusionCoreStage, viewA: DiffusionScoreStage, viewB: DiffusionLatentStage },
  'dl-rl-agent': { source: RlEnvironmentStage, core: RlExploreStage, viewA: RlPolicyStage, viewB: RlBellmanStage },
};

const PRESETS: Record<DeepPanoramaKind, readonly DeepScenarioPreset[]> = {
  'dl-mlp-backprop': MLP_PRESETS,
  'dl-cnn-resnet': CNN_PRESETS,
  'dl-transformer-attention': TRANSFORMER_PRESETS,
  'dl-llm-inference-lora': LLM_PRESETS,
  'dl-diffusion-latent': DIFFUSION_PRESETS,
  'dl-rl-agent': RL_PRESETS,
};

function matrixSignature(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return JSON.stringify(value).slice(0, 1200);
}

export function DeepStageNodeBody(props: NodeBodyProps): JSX.Element {
  const { node, values, self, onParams, onLive, inCard, displayContext } = props;
  const definition = findDeepStage(node);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [localState, setLocalStateRaw] = useState<Record<string, unknown>>({});
  const lastPublished = useRef('');
  const setLocalState = useCallback((patch: Record<string, unknown>) => {
    setLocalStateRaw((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    setFrame(0);
    setPlaying(false);
    setLocalStateRaw({});
    lastPublished.current = '';
  }, [node.payload]);

  const isSource = definition?.stage.id === 'source';
  const computed = definition
    ? computeDeepStageValue(node, values, { ...(isSource ? { frameOverride: frame, playing } : {}), localState })
    : null;
  const data = computed ?? (self?.kind === 'deepData' ? self : null);
  const total = Math.max(1, definition && data ? definition.pipeline.totalSteps(data.params) : 1);

  useEffect(() => {
    if (!isSource || !playing) return undefined;
    const timer = window.setInterval(() => setFrame((current) => (current + 0.8) % total), 76);
    return () => window.clearInterval(timer);
  }, [isSource, playing, total]);

  useEffect(() => {
    setFrame((current) => Math.min(current, total - 0.01));
  }, [total]);

  const publishSignature = data && isSource
    ? JSON.stringify([data.pipeline, data.stage, data.params, round(data.frame, 3), matrixSignature(localState.inputMatrix as Matrix | undefined)])
    : '';
  useEffect(() => {
    if (!isSource || !data || !onLive || !publishSignature) return;
    if (lastPublished.current === publishSignature) return;
    lastPublished.current = publishSignature;
    onLive({ out: data });
  }, [data, isSource, onLive, publishSignature]);

  if (!definition || !data) {
    return <p role="status" className={styles.stageFallback}>这个深度学习模块的配置无法读取。</p>;
  }

  const { pipeline, stage } = definition;
  const Stage = STAGE_COMPONENTS[pipeline.kind][stage.id];
  if (!Stage) return <p role="status" className={styles.stageFallback}>这个环节暂时没有可视化渲染器。</p>;
  const upstreamConnected = values.in?.kind === 'deepData';
  const setParam = (key: string, value: number) => onParams?.({ [key]: value });
  const applyParams = (patch: Record<string, number>) => onParams?.(patch);
  const renderState: DeepStageRenderState = {
    frame: data.frame,
    stage: pipeline.stages.findIndex((item) => item.id === stage.id),
    params: data.params,
    setParam,
    applyParams,
    data: data.state,
    localState,
    setLocalState,
  };
  const choosePreset = (preset: DeepScenarioPreset) => {
    setFrame(0);
    setPlaying(false);
    applyParams(preset.patch);
  };
  const activePreset = (preset: DeepScenarioPreset) => Object.entries(preset.patch).every(([key, value]) => Math.abs((data.params[key] ?? 0) - value) < 1e-7);

  return (
    <div className={styles.stageCard} data-stage={stage.id} data-context={displayContext ?? (inCard ? 'canvas' : 'panel')}>
      <div className={styles.stageHeader}>
        <span className={styles.stageNo}>{String(pipeline.stages.indexOf(stage) + 1).padStart(2, '0')}</span>
        <div className={styles.stageTitleBox}>
          <strong>{stage.title}</strong>
          <small>{pipeline.title}</small>
        </div>
      </div>
      {isSource ? (
        <div className={styles.sourceConsole}>
          <div className={styles.stagePresets} aria-label="情景预设">
            {PRESETS[pipeline.kind].map((preset) => (
              <button key={preset.id} type="button" title={preset.note} className={activePreset(preset) ? styles.active : ''} onClick={() => choosePreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className={styles.stageTransport}>
            <button type="button" aria-label={playing ? '暂停' : '播放'} className={styles.playButton} onClick={() => setPlaying((value) => !value)}>{playing ? 'Ⅱ' : '▶'}</button>
            <button type="button" aria-label="单步" onClick={() => { setPlaying(false); setFrame((value) => Math.min(total - 0.01, value + 1)); }}>⇥</button>
            <input type="range" min={0} max={total - 0.01} step={0.1} value={Math.min(frame, total - 0.01)} aria-label="播放进度" onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} />
            <output>{round(Math.min(frame, total - 0.01), 1)}/{total}</output>
            <button type="button" aria-label="重置" onClick={() => { setFrame(0); setPlaying(false); }}>↺</button>
          </div>
        </div>
      ) : null}
      {!isSource && !upstreamConnected ? <div className={styles.stageOffline}>未接上游 · 使用默认输入</div> : null}
      <div className={styles.stageVisualFrame}>
        <Stage {...renderState} />
      </div>
      <div className={styles.stageFormula}>
        <span>{stage.outputLabel}</span>
        <code>frame {round(data.frame, 1)}</code>
      </div>
    </div>
  );
}
