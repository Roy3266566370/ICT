import type { LabProblem } from './types.ts';
import { segmentProblemText } from './mathText.ts';

export function needsModelAfterReview(problem: LabProblem): boolean {
  return problem.status !== 'reference' && !problem.manual_input && problem.status !== 'ready' &&
    (problem.model.engine === 'unsupported_v1' || problem.subject === 'unknown' ||
      problem.ai_solution?.proposed_model?.kind === 'none');
}

/** 未识别为原题的可执行模型时，自动复用现有 AI 建模与内核核验链路。 */
export function needsAutomaticAISolve(problem: LabProblem): boolean {
  if (problem.status === 'reference') return false;
  const hasImages = problem.source_pages?.some(p => !!p.image_key) === true;
  const needsSourceRecovery = hasImages && !problem.manual_input && !!problem.ai_solution && !problem.ai_solution.source_recovery
    && (problem.recognition?.ambiguities?.some(a => a.id === 'source_formula_confirmation' && !a.resolved)
      || segmentProblemText(problem.text).some(part => part.kind === 'text' && /\\[A-Za-z([]|\$(?=\\|[A-Za-z_{])/.test(part.value)));
  if (needsSourceRecovery) return true;
  if (problem.manual_input || problem.ai_solution) return false;
  const engine = problem.model?.engine;
  const executable = !!engine && engine !== 'unsupported_v1' && problem.model?.teaching !== true;
  const blocking = (problem.recognition?.ambiguities ?? []).filter(a => a.severity === 'blocking' && !a.resolved);
  const onlySourceConfirmation = blocking.length > 0 && blocking.every(a => a.id === 'source_formula_confirmation');
  // A ready local model (including an image question after confirmation) is
  // never overwritten automatically; explicit re-read stays available.
  if (executable && (!blocking.length || onlySourceConfirmation)) return false;
  if (problem.text.trim().length < 3 && !hasImages) return false;
  return (problem.status === 'unsupported' || problem.subject === 'unknown' ||
    hasImages || engine === 'unsupported_v1' || problem.model?.teaching === true || blocking.length > 0);
}
