import type {ISpec, SpecEvaluation} from '@/ispec/types';
export interface SceneComponentProps {
  spec: ISpec;
  values: Record<string, number | boolean | string>;
  evaluation: SpecEvaluation;
  progress: number;
  reducedMotion?: boolean;
  onChange: (id: string, value: number | boolean | string) => void;
}
