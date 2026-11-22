import {initialValues,type ISpec} from '../../ispec/types.ts';
import type {SpecCell} from '../../ispec/format.ts';

export type DeckValues=Record<string,Record<string,SpecCell>>;
export interface DeckParameterPatch {objectId:string;id:string;value:SpecCell;}
export interface DeckHistory {past:DeckValues[];present:DeckValues;future:DeckValues[];key:string;at:number;}
export const createHistory=(present:DeckValues):DeckHistory=>({past:[],present,future:[],key:'',at:0});

/** 浅层比对单个对象的参数表，避免拖动热路径上的 JSON.stringify 开销。 */
export function sameObjectValues(a:Record<string,SpecCell>|undefined,b:Record<string,SpecCell>|undefined):boolean {
  if(a===b) return true;
  if(!a || !b) return false;
  const keysA=Object.keys(a);
  const keysB=Object.keys(b);
  if(keysA.length!==keysB.length) return false;
  for(const k of keysA) if(!Object.is(a[k],b[k])) return false;
  return true;
}

export function sameDeckValues(a:DeckValues,b:DeckValues):boolean {
  if(a===b) return true;
  const keysA=Object.keys(a);
  const keysB=Object.keys(b);
  if(keysA.length!==keysB.length) return false;
  for(const k of keysA) if(!sameObjectValues(a[k],b[k])) return false;
  return true;
}

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

/** 一次批量应用多条参数改动（如二维拖动的 x/y），仅复制受影响的对象表。 */
export function changeDeckParameters(
  specs:ISpec[],
  values:DeckValues,
  patches:readonly DeckParameterPatch[],
):DeckValues {
  if(!patches.length) return values;
  let next:DeckValues|null=null;
  const ensureNext=()=>{
    if(!next) next={...values};
    return next;
  };
  for(const {objectId,id,value} of patches) {
    const parameter=specs.find(s=>s.object_id===objectId)?.parameters.find(p=>p.id===id);
    if(!parameter) continue;
    for(const candidate of specs) {
      for(const p of candidate.parameters) {
        if((candidate.object_id===objectId && p.id===id) || (parameter.shared_key && p.shared_key===parameter.shared_key &&
          parameter.default===p.default && parameter.source.excerpt===p.source.excerpt)) {
          const currentMap=(next??values)[candidate.object_id]??initialValues(candidate);
          if(Object.is(currentMap[p.id],value)) continue;
          const target=ensureNext();
          target[candidate.object_id]={...currentMap,[p.id]:value};
        }
      }
    }
  }
  return next??values;
}

export function changeDeckParameter(specs:ISpec[],values:DeckValues,objectId:string,id:string,value:SpecCell):DeckValues {
  return changeDeckParameters(specs,values,[{objectId,id,value}]);
}
