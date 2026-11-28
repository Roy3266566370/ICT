import type { NodeBodyProps } from './nodes';
import { isDeepPanoramaKind, type DeepPanoramaKind } from './deepPanoramaTypes';
import { MlpBackpropPanorama } from './deepPanoramas/MlpBackpropPanorama';
import { CnnResnetPanorama } from './deepPanoramas/CnnResnetPanorama';
import { TransformerAttentionPanorama } from './deepPanoramas/TransformerAttentionPanorama';
import { LlmInferenceLoraPanorama } from './deepPanoramas/LlmInferenceLoraPanorama';
import { DiffusionLatentPanorama } from './deepPanoramas/DiffusionLatentPanorama';
import { RlAgentPanorama } from './deepPanoramas/RlAgentPanorama';

const PANORAMA_BODIES: Record<DeepPanoramaKind, (props: NodeBodyProps) => JSX.Element> = {
  'dl-mlp-backprop': MlpBackpropPanorama,
  'dl-cnn-resnet': CnnResnetPanorama,
  'dl-transformer-attention': TransformerAttentionPanorama,
  'dl-llm-inference-lora': LlmInferenceLoraPanorama,
  'dl-diffusion-latent': DiffusionLatentPanorama,
  'dl-rl-agent': RlAgentPanorama,
};

export function DeepPanoramaNodeBody(props: NodeBodyProps): JSX.Element {
  const kind = isDeepPanoramaKind(props.node.payload) ? props.node.payload : 'dl-mlp-backprop';
  const Body = PANORAMA_BODIES[kind];
  return <Body {...props} />;
}
