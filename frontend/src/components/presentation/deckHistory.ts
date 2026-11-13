import {initialValues,type ISpec} from '../../ispec/types';
import type {SpecCell} from '../../ispec/format';

export type DeckValues=Record<string,Record<string,SpecCell>>;
export interface DeckHistory {past:DeckValues[];present:DeckValues;future:DeckValues[];key:string;at:number;}
export const createHistory=(present:DeckValues):DeckHistory=>({past:[],present,future:[],key:'',at:0});
export const sameDeckValues=(a:DeckValues,b:DeckValues)=>JSON.stringify(a)===JSON.stringify(b);
export function commitHistory(h:DeckHistory,next:DeckValues,key='',at=Date.now()):DeckHistory {
  if(sameDeckValues(h.present,next)) return h;
  const coalesce=!!key && h.key===key && at-h.at>=0 && at-h.at<450 && h.future.length===0;
  return {present:next,past:coalesce?h.past:[...h.past,h.present].slice(-60),future:[],key,at};
}
export function undoHistory(h:DeckHistory):DeckHistory {
  const previous=h.past.at(-1);
  return previous?{present:previous,past:h.past.slice(0,-1),future:[h.present,...h.future],key:'',at:0}:h;
}
export function redoHistory(h:DeckHistory):DeckHistory {
  const next=h.future[0];
  return next?{present:next,past:[...h.past,h.present],future:h.future.slice(1),key:'',at:0}:h;
}
export function changeDeckParameter(specs:ISpec[],values:DeckValues,objectId:string,id:string,value:SpecCell):DeckValues {
  const parameter=specs.find(s=>s.object_id===objectId)?.parameters.find(p=>p.id===id);
  if(!parameter) return values;
  const next={...values};
  for(const candidate of specs) for(const p of candidate.parameters) {
    if((candidate.object_id===objectId && p.id===id) || (parameter.shared_key && p.shared_key===parameter.shared_key &&
      parameter.default===p.default && parameter.source.excerpt===p.source.excerpt)) {
      next[candidate.object_id]={...(next[candidate.object_id]??initialValues(candidate)),[p.id]:value};
    }
  }
  return next;
}
