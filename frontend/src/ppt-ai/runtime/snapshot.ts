/** 冻结/在线快照 → 演示运行时数据。公开投影不含 material_id，运行时只读教学字段。 */

import type { CanonicalValues, GeneratedViewArtifact, InteractionBundle, PptAiActive } from '@/ppt-ai/types';
import type { LearningCapabilities, LearningDescriptor } from '@/ppt-ai/learning/types';

export interface RuntimeBranch {
  branch_id: string;
  revision: number;
  kind?: string;
  title?: string;
  canonical_values: CanonicalValues;
  overrides?: Record<string, CanonicalValues>;
  evaluation?: {
    evaluation_hash?: string;
    derived?: Record<string, Record<string, unknown>>;
    derived_values?: CanonicalValues;
    checks?: Record<string, unknown>[];
    violations?: Record<string, unknown>[];
  } | null;
}

export interface PptAiRuntimeSnapshot {
  bundle: InteractionBundle | null;
  branch: RuntimeBranch | null;
  artifacts: GeneratedViewArtifact[];
  frozen?: boolean;
  learning?: LearningDescriptor[];
  capabilities?: Partial<LearningCapabilities>;
  learningEnabled?: boolean;
}

export function fromActive(active: PptAiActive | null | undefined): PptAiRuntimeSnapshot {
  if (!active?.bundle) return { bundle: null, branch: null, artifacts: [] };
  return {
    bundle: active.bundle,
    branch: active.branch
      ? {
          branch_id: active.branch.branch_id,
          revision: active.branch.revision,
          kind: active.branch.kind,
          title: active.branch.title,
          canonical_values: active.branch.canonical_values,
          overrides: active.branch.overrides,
          evaluation: active.branch.evaluation,
        }
      : null,
    artifacts: active.artifacts ?? [],
    learningEnabled: active.learning_enabled !== false,
  };
}

export function fromFrozen(value: unknown): PptAiRuntimeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { bundle: null, branch: null, artifacts: [] };
  const frozen = value as Record<string, unknown>;
  const bundle = frozen.bundle as InteractionBundle | undefined;
  const branch = frozen.branch as RuntimeBranch | undefined;
  const artifacts = Array.isArray(frozen.artifacts)
    ? (frozen.artifacts as GeneratedViewArtifact[]).filter((artifact) => artifact.offline_supported !== false)
    : [];
  const learning = Array.isArray(frozen.learning)
    ? (frozen.learning as unknown[]).filter(
        (item): item is LearningDescriptor =>
          typeof item === 'object' && item !== null && typeof (item as { template_id?: unknown }).template_id === 'string',
      )
    : [];
  const capabilities = typeof frozen.capabilities === 'object' && frozen.capabilities !== null
    ? (frozen.capabilities as Partial<LearningCapabilities>)
    : {};
  return {
    bundle: bundle ?? null,
    branch: branch
      ? {
          branch_id: String(branch.branch_id ?? ''),
          revision: Number(branch.revision ?? 1),
          kind: typeof branch.kind === 'string' ? branch.kind : undefined,
          title: typeof branch.title === 'string' ? branch.title : undefined,
          canonical_values: branch.canonical_values ?? {},
          overrides: branch.overrides ?? {},
          evaluation: branch.evaluation ?? null,
        }
      : null,
    artifacts,
    frozen: true,
    learning,
    capabilities,
  };
}

export function valuesForNode(
  bundle: InteractionBundle | null,
  branch: RuntimeBranch | null,
  nodeId: string,
): CanonicalValues {
  const node = bundle?.compiled.nodes.find((item) => item.node_id === nodeId);
  if (!node) return {};
  const result: CanonicalValues = {};
  node.parameters.forEach((parameter) => {
    const value = branch?.canonical_values?.[parameter.concept_id];
    result[parameter.concept_id] = value ?? parameter.default;
  });
  return result;
}

export function nodesForPage(bundle: InteractionBundle | null, pageNo: number) {
  if (!bundle) return [];
  return bundle.compiled.nodes.filter((node) => node.source.page === pageNo);
}
