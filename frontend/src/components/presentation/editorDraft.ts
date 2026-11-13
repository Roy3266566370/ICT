import type {EditableElement,InteractionConfig} from '../../api/editorTypes';
import type {ISpec} from '../../ispec/types';

export type EditorMode=InteractionConfig['kind']|'keep';
export function inferMatrix(spec?:ISpec):number[][]|undefined {
  if(!spec?.views.some(v=>v.type==='figure')) return undefined;
  const numbers='abcd'.split('').map(id=>spec.parameters.find(p=>p.id===id)?.default);
  if(!numbers.every(n=>typeof n==='number' && Number.isFinite(n))) return undefined;
  return [[numbers[0] as number,numbers[1] as number],[numbers[2] as number,numbers[3] as number]];
}
export function initialEditorMode(element:Pick<EditableElement,'kind'|'override'|'recognition'>,spec?:ISpec):EditorMode {
  if(element.override?.interaction) return element.override.interaction.kind;
  if(spec) return 'keep';
  return element.recognition?.matrix?'matrix':'none';
}
export function elementText(element:Pick<EditableElement,'text'|'math_text'|'override'|'recognition'>):string {
  return element.override?.text ?? (element.text || element.math_text || element.recognition?.text || '');
}
