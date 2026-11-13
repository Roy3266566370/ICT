import {evaluateSpec} from './evaluate';
import type {ISpec} from './types';
import type {SpecCell} from './format';

export type FunctionPoint = {x:number;y:number} | null;

/** Sample the same restricted expressions as the live result; never connect undefined points. */
export function sampleFunction(spec:ISpec, values:Record<string,SpecCell>, input:string, output:string,
  minimum:number, maximum:number, count=161):FunctionPoint[] {
  const parameter=spec.parameters.find(p=>p.id===input);
  if(!parameter || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum>=maximum ||
    (parameter.min!==undefined && minimum<parameter.min) || (parameter.max!==undefined && maximum>parameter.max)) return [];
  const size=Math.max(3,Math.min(401,Math.floor(count)));
  if(!Number.isFinite(size)) return [];
  return Array.from({length:size},(_,i)=>{
    const x=minimum+(maximum-minimum)*i/(size-1);
    const result=evaluateSpec(spec,{...values,[input]:x});
    const y=result.derived[output];
    return typeof y==='number' && Number.isFinite(y)?{x,y}:null;
  });
}
