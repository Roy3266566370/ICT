import type { LabProblem } from './types.ts';

const INVERSE_NAMES: Record<string,string> = {
  arctan:'atan', arcsin:'asin', arccos:'acos', arccot:'acot', arcsec:'asec', arccsc:'acsc',
};

function spelling(source: string): string {
  let text=source.toLowerCase().replace(/\*\*/g,'^').replace(/\s+|[()*·]/g,'');
  for(const [alias,name] of Object.entries(INVERSE_NAMES)) text=text.replaceAll(alias,name);
  return text;
}

/** Recover a formula-only OCR heading from its matching, recognized integral.
 * Keep ordinary titles and mismatched/teaching models untouched.
 */
export function integralTitleFormula(problem: LabProblem): {prefix:string;tex:string} | null {
  const model=problem.model;
  if(model.subject!=='calculus'||model.teaching||!model.expression||
    !['integral','antiderivative'].includes(model.kind ?? '')) return null;
  const [,prefix='',body='']=problem.title.match(/^(第\s*\d+\s*题\s*[·.、:：]?\s*)?([\s\S]*)$/) ?? [];
  const compact=body.replace(/\s+/g,'').replace(/^∫/,'');
  const differential=`d${model.variable ?? 'x'}`;
  if(!compact.endsWith(differential)||
    spelling(compact.slice(0,-differential.length))!==spelling(model.expression)) return null;
  const tex=(problem.recognition.formulas.find(formula=>/\\int\b|∫/.test(formula.tex))?.tex
    ?? model.formula_tex ?? '').split('=')[0]!.trim();
  if(!/\\int\b|∫/.test(tex)) return null;
  const names: Record<string,string>={atan:'\\arctan',asin:'\\arcsin',acos:'\\arccos',
    acot:'\\operatorname{arccot}',asec:'\\operatorname{arcsec}',acsc:'\\operatorname{arccsc}'};
  return {prefix,tex:tex.replace(/\\operatorname\{(atan|asin|acos|acot|asec|acsc)\}/g,(_,name:string)=>names[name]!)};
}
