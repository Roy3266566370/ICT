import type { ManualIntegralDraft } from './manualInput.ts';

export const doubleIntegralExamples: {id:string;label:string;draft:ManualIntegralDraft}[] = [
  {id:'triangle',label:'三角形：两种次序核对',draft:{task:'double_integral',expression:'x+2*y',variable:'x',doubleMode:'strip',doubleOuter:'x',lower:'0',upper:'1',innerLower:'0',innerUpper:'x',swapOrder:true}},
  {id:'arch',label:'抛物线弓形：非单调边界换序',draft:{task:'double_integral',expression:'1',variable:'x',doubleMode:'strip',doubleOuter:'x',lower:'0',upper:'1',innerLower:'0',innerUpper:'x*(1-x)',swapOrder:true}},
  {id:'shifted',label:'平移直线：换序后分成两段',draft:{task:'double_integral',expression:'1',variable:'x',doubleMode:'strip',doubleOuter:'x',lower:'0',upper:'1',innerLower:'0',innerUpper:'x+1',swapOrder:true}},
  {id:'disconnected',label:'抛物线下方：同一高度有两个区间',draft:{task:'double_integral',expression:'1',variable:'x',doubleMode:'strip',doubleOuter:'x',lower:'-1',upper:'1',innerLower:'0',innerUpper:'x^2',swapOrder:true}},
  {id:'sine',label:'正弦弓形：按临界点分片换序',draft:{task:'double_integral',expression:'1',variable:'x',doubleMode:'strip',doubleOuter:'x',lower:'0',upper:'pi',innerLower:'0',innerUpper:'sin(x)',swapOrder:true}},
];

export function doubleIntegralExample(draft:ManualIntegralDraft):Partial<ManualIntegralDraft>{
 const square={doubleOuter:'x' as const,lower:'0',upper:'1',innerLower:'0',innerUpper:'1',swapOrder:false};
 if(draft.doubleApplication==='probability')return {...square,doubleMode:'strip',expression:'2',innerUpper:'x',eventOuterLower:'0',eventOuterUpper:'1/2',eventInnerLower:'0',eventInnerUpper:'x'};
 if(draft.doubleApplication && draft.doubleApplication!=='integral')return {...square,doubleMode:'strip',expression:'1',inertiaAxis:'origin'};
 switch(draft.doubleMode){
  case 'polar_improper':return {expression:'exp(-x^2-y^2)',lower:'0',upper:'2*pi',innerLower:'0',innerUpper:'oo'};
  case 'strip_improper':return {...square,expression:'1/(x+y)',innerUpper:'x'};
  case 'affine':return {...square,expression:'1',xMap:'2*u+v',yMap:'u-v'};
  case 'change_variables':return {...square,expression:'1',xMap:'u^2',yMap:'v'};
  case 'improper':return {...square,expression:'exp(-x-y)',upper:'oo',innerUpper:'oo'};
  case 'pieces':return {expression:'x+y',piecesText:'0;1;0;x\n1;2;0;2-x'};
  case 'polar':return {expression:'x^2+y^2',lower:'0',upper:'2*pi',innerLower:'0',innerUpper:'1'};
  default:return {...square,expression:'x+y',innerUpper:'x'};
 }
}
