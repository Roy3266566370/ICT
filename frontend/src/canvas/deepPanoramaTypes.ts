export type DeepPanoramaKind =
  | 'dl-mlp-backprop'
  | 'dl-cnn-resnet'
  | 'dl-transformer-attention'
  | 'dl-llm-inference-lora'
  | 'dl-diffusion-latent'
  | 'dl-rl-agent';

export const DEEP_PANORAMA_KINDS: readonly DeepPanoramaKind[] = [
  'dl-mlp-backprop',
  'dl-cnn-resnet',
  'dl-transformer-attention',
  'dl-llm-inference-lora',
  'dl-diffusion-latent',
  'dl-rl-agent',
];

export function isDeepPanoramaKind(value: string | undefined): value is DeepPanoramaKind {
  return DEEP_PANORAMA_KINDS.includes(value as DeepPanoramaKind);
}

export interface DeepScenarioPreset {
  id: string;
  label: string;
  patch: Record<string, number>;
  note: string;
}

export interface DeepPanoramaControl {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: number; label: string }[];
  format?: (value: number) => string;
}

export interface DeepKpi {
  label: string;
  value: string;
  tone?: 'blue' | 'red' | 'green' | 'ochre' | 'ink';
}

export interface DeepPanoramaRenderState {
  frame: number;
  stage: number;
  params: Record<string, number>;
  setParam: (key: string, value: number) => void;
  applyParams: (patch: Record<string, number>) => void;
}

export interface DeepStageRenderState extends DeepPanoramaRenderState {
  /** 沿 deepData 连线累计传递的上游与本阶段计算产物 */
  data: Record<string, unknown>;
  /** 节点内的非持久交互状态（如 CNN 手绘矩阵），只参与实时广播 */
  localState: Record<string, unknown>;
  setLocalState: (patch: Record<string, unknown>) => void;
}
