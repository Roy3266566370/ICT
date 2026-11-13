/** React 绑定：值变化时只重算受影响节点，保持调参路径同步且增量。 */

import { useEffect, useRef, useState } from 'react';
import type { CanonicalValues, InteractionBundle } from '@/ppt-ai/types';
import {
  evaluateBundle,
  evaluateBundleIncremental,
  type BundleEvaluation,
  type OverrideValues,
} from './evaluate.ts';

interface EvaluationState {
  evaluation: BundleEvaluation | null;
  values: CanonicalValues;
  overrides: OverrideValues;
}

function changedKeys(previous: CanonicalValues, next: CanonicalValues): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => previous[key] !== next[key]);
}

export function useBundleEvaluation(
  bundle: InteractionBundle | null,
  values: CanonicalValues,
  overrides: OverrideValues = {},
): BundleEvaluation | null {
  const [state, setState] = useState<EvaluationState>({ evaluation: null, values: {}, overrides: {} });
  const current = useRef(state);

  useEffect(() => {
    if (!bundle) {
      const next: EvaluationState = { evaluation: null, values: {}, overrides: {} };
      current.current = next;
      setState(next);
      return;
    }
    const next: EvaluationState = {
      evaluation: evaluateBundle(bundle, values, overrides),
      values: { ...values },
      overrides: { ...overrides },
    };
    current.current = next;
    setState(next);
    // bundle 不可变；只在身份变化时重建基线，值变化走下面的增量路径。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.bundle_id]);

  useEffect(() => {
    if (!bundle) return;
    const previous = current.current;
    if (!previous.evaluation) return;
    const concepts = changedKeys(previous.values, values);
    const overrideNodes = [...new Set([...Object.keys(previous.overrides), ...Object.keys(overrides)])]
      .filter((nodeId) => previous.overrides[nodeId] !== overrides[nodeId]);
    if (!concepts.length && !overrideNodes.length) return;
    const incremental = evaluateBundleIncremental(
      bundle, values, previous.evaluation, concepts, overrides, overrideNodes,
    );
    const next: EvaluationState = {
      evaluation: incremental.evaluation,
      values: { ...values },
      overrides: { ...overrides },
    };
    current.current = next;
    setState(next);
  }, [bundle, values, overrides]);

  return state.evaluation;
}

export default useBundleEvaluation;
