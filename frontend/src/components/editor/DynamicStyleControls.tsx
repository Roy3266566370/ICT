import {allowsViewerParameter} from '@/document/relations';
import type {NodePatch, SceneNode, ViewerParameter} from '@/document/types';

const FINE_VECTOR_PARAMS: ReadonlyArray<{key: ViewerParameter; label: string}> = [
  {key: 'end', label: '拖动终点'},
  {key: 'start', label: '拖动起点'},
  {key: 'length', label: '调节线长'},
  {key: 'angle', label: '调节角度'},
  {key: 'color', label: '修改颜色'},
  {key: 'line_style', label: '修改线型'},
  {key: 'stroke_width', label: '修改线宽'},
  {key: 'flow', label: '流动设置'},
];

export function DynamicStyleControls({node, onPatch, author = false}: {
  node: SceneNode; onPatch: (patch: NodePatch, key?: string) => void; author?: boolean;
}) {
  const canColor = node.type !== 'vector' ? true : allowsViewerParameter(node, 'color', author);
  const canLineStyle = node.type !== 'vector' ? true : allowsViewerParameter(node, 'line_style', author);
  const canFlow = node.type !== 'vector' ? true : allowsViewerParameter(node, 'flow', author);

  const expandFineParams = (current: ViewerParameter[] | undefined): ViewerParameter[] => {
    if (!current) return FINE_VECTOR_PARAMS.map(item => item.key);
    const set = new Set<ViewerParameter>();
    const hasFineGeom = current.some(k => k === 'start' || k === 'end' || k === 'length' || k === 'angle');
    const hasFineStyle = current.some(k => k === 'color' || k === 'line_style' || k === 'stroke_width');
    for (const k of current) {
      if (k === 'geometry' && !hasFineGeom) {
        set.add('start'); set.add('end'); set.add('length'); set.add('angle');
      } else if (k === 'style' && !hasFineStyle) {
        set.add('color'); set.add('line_style'); set.add('stroke_width');
      } else if (k !== 'geometry' && k !== 'style') {
        set.add(k);
      }
    }
    return [...set];
  };

  return <>
    {canColor&&<label>线条颜色<input type="color" aria-label="线条颜色" value={node.style.stroke ?? '#167abc'}
      onChange={e=>onPatch({style:{stroke:e.target.value}},'dynamic.color')}/></label>}
    {canLineStyle&&<label>线型<select aria-label="线型" value={node.style.line_style ?? 'solid'}
      onChange={e=>onPatch({style:{line_style:e.target.value as 'solid'|'dashed'|'dotted'}},'dynamic.line')}>
      <option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option>
    </select></label>}
    {canFlow&&<>
    <label><input type="checkbox" checked={node.flow?.enabled ?? false}
      onChange={e=>onPatch({flow:{enabled:e.target.checked,speed:node.flow?.speed??1}})}/>流动动画</label>
    <label>流速<input type="number" aria-label="流速" min="0.1" max="10" step="0.1" value={node.flow?.speed??1}
      onChange={e=>{const speed=e.target.valueAsNumber;if(Number.isFinite(speed)&&speed>=.1&&speed<=10)onPatch({flow:{enabled:node.flow?.enabled??false,speed}},'dynamic.speed');}}/></label></>}
    {author&&<label><input type="checkbox" checked={node.viewer_editable!==false}
      onChange={e=>onPatch({viewer_editable:e.target.checked})}/>允许观众编辑</label>}
    {author&&node.type==='vector'&&node.viewer_editable!==false&&FINE_VECTOR_PARAMS.map(({key,label})=>{
      const checked = allowsViewerParameter(node, key, false);
      return <label key={key}>
        <input type="checkbox" aria-label={`观众可调：${label}`} checked={checked} onChange={e=>{
          const expanded = expandFineParams(node.viewer_parameters);
          const next = e.target.checked
            ? [...new Set([...expanded, key])]
            : expanded.filter(k => k !== key);
          onPatch({viewer_parameters: next}, 'vector.viewer_parameters');
        }}/>{label}
      </label>;
    })}
  </>;
}
