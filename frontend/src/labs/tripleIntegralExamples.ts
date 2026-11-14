import type { ManualIntegralDraft, TripleMode } from './manualInput.ts';

export const tripleIntegralExamples: {id:string;label:string;draft:ManualIntegralDraft}[] = [
  {id:'cube',label:'单位立方体：x*y*z',draft:{task:'triple_integral',expression:'x*y*z',variable:'x',tripleMode:'box',lower:'0',upper:'1',innerLower:'0',innerUpper:'1',tripleInnerLower:'0',tripleInnerUpper:'1'}},
  {id:'tetra',label:'四面体：z型区域与斜顶面',draft:{task:'triple_integral',expression:'z',variable:'x',tripleMode:'z_simple',lower:'0',upper:'1',innerLower:'0',innerUpper:'1-x',tripleInnerLower:'0',tripleInnerUpper:'1-x-y'}},
  {id:'paraboloid',label:'圆柱坐标：抛物面 z=1-r²',draft:{task:'triple_integral',expression:'x^2+y^2',variable:'x',tripleMode:'cylindrical',lower:'0',upper:'2*pi',innerLower:'0',innerUpper:'1',tripleInnerLower:'0',tripleInnerUpper:'1-r^2'}},
  {id:'sphere',label:'球坐标：单位球内 x²+y²+z²',draft:{task:'triple_integral',expression:'x^2+y^2+z^2',variable:'x',tripleMode:'spherical',lower:'0',upper:'2*pi',innerLower:'0',innerUpper:'pi',tripleInnerLower:'0',tripleInnerUpper:'1'}},
  {id:'cosball',label:'球坐标：变上界 rho=2cos(phi)',draft:{task:'triple_integral',expression:'1',variable:'x',tripleMode:'spherical',lower:'0',upper:'2*pi',innerLower:'0',innerUpper:'pi/2',tripleInnerLower:'0',tripleInnerUpper:'2*cos(phi)'}},
];

const defaults: Record<TripleMode,string[]> = {
  box: ['0','1','0','1','0','1'],
  z_simple: ['0','1','0','1-x','0','1-x-y'],
  cylindrical: ['0','2*pi','0','1','0','1-r^2'],
  spherical: ['0','2*pi','0','pi','0','1'],
};

export function tripleIntegralExample(draft:ManualIntegralDraft):Partial<ManualIntegralDraft>{
  const mode = draft.tripleMode ?? 'box';
  const [lower,upper,innerLower,innerUpper,tripleInnerLower,tripleInnerUpper] = defaults[mode];
  const expression = mode === 'box' ? 'x*y*z' : mode === 'z_simple' ? 'z' : mode === 'cylindrical' ? 'x^2+y^2' : 'x^2+y^2+z^2';
  return {expression,lower,upper,innerLower,innerUpper,tripleInnerLower,tripleInnerUpper};
}
