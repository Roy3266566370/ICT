import type { LabProblem } from './types.ts';

/** 未识别为原题的可执行模型时，自动复用现有 AI 建模与内核核验链路。 */
export function needsAutomaticAISolve(problem: LabProblem): boolean {
  return !problem.manual_input && !problem.ai_solution && problem.text.trim().length >= 3 && (
    problem.status === 'unsupported' || problem.subject === 'unknown' ||
    problem.source_pages?.some(p => !!p.image_key) || problem.model.engine === 'unsupported_v1' || problem.model.teaching === true ||
    (problem.status === 'needs_review' && problem.recognition?.ambiguities?.some((a) =>
      a.severity === 'blocking' && !a.resolved && a.id !== 'source_formula_confirmation') === true)
  );
}
