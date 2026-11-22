import type {NodePatch, SceneNode} from '@/document/types';

export function DynamicStyleControls({node, onPatch, author = false}: {
  node: SceneNode; onPatch: (patch: NodePatch, key?: string) => void; author?: boolean;
}) {
  return <>
    {(author||node.type!=='vector'||!node.viewer_parameters||node.viewer_parameters.includes('style'))&&<>
    <label>线条颜色<input type="color" aria-label="线条颜色" value={node.style.stroke ?? '#167abc'}
      onChange={e=>onPatch({style:{stroke:e.target.value}},'dynamic.color')}/></label>
    <label>线型<select aria-label="线型" value={node.style.line_style ?? 'solid'}
      onChange={e=>onPatch({style:{line_style:e.target.value as 'solid'|'dashed'|'dotted'}},'dynamic.line')}>
      <option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option>
    </select></label></>}
    {(author||node.type!=='vector'||!node.viewer_parameters||node.viewer_parameters.includes('flow'))&&<>
    <label><input type="checkbox" checked={node.flow?.enabled ?? false}
      onChange={e=>onPatch({flow:{enabled:e.target.checked,speed:node.flow?.speed??1}})}/>流动动画</label>
    <label>流速<input type="number" aria-label="流速" min="0.1" max="10" step="0.1" value={node.flow?.speed??1}
      onChange={e=>{const speed=e.target.valueAsNumber;if(Number.isFinite(speed)&&speed>=.1&&speed<=10)onPatch({flow:{enabled:node.flow?.enabled??false,speed}},'dynamic.speed');}}/></label></>}
    {author&&<label><input type="checkbox" checked={node.viewer_editable!==false}
      onChange={e=>onPatch({viewer_editable:e.target.checked})}/>允许观众编辑</label>}
    {author&&node.type==='vector'&&(['geometry','style','flow'] as const).map((key,i)=><label key={key}>
      <input type="checkbox" checked={!node.viewer_parameters||node.viewer_parameters.includes(key)} onChange={e=>{
        const current=node.viewer_parameters??['geometry','style','flow'];
        onPatch({viewer_parameters:e.target.checked?[...current,key]:current.filter(k=>k!==key)});
      }}/>{['开放拖动、线长与角度','开放颜色与线型','开放流动设置'][i]}</label>)}
  </>;
}
