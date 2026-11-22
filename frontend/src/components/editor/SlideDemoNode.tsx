import {useEffect,useState} from 'react';
import type {PageLab} from '@/api/pptAI';
import {PageLabPlayer,labDefaults} from '@/components/ppt-ai/PageLabPlayer';
import {richNodeStyle,type SlideRichNodeProps} from './SlideDiagramNode';
import './slideRichNodes.css';
function DemoContent({lab,node,editing,onPatch}:{lab:PageLab}&Pick<SlideRichNodeProps,'node'|'editing'|'onPatch'>) {
 const [values,setValues]=useState(()=>labDefaults(lab));
 const defaultsKey=JSON.stringify(labDefaults(lab));
 useEffect(()=>{setValues(JSON.parse(defaultsKey) as Record<string,number>);},[defaultsKey]);
 return <PageLabPlayer lab={lab} identity={`slide-demo-${node.id}`} values={values} editable={!node.locked&&(editing||node.viewer_editable!==false)} onValues={next=>{setValues(next);if(editing&&!node.locked)onPatch({demo:{...lab,params:lab.params.map(p=>({...p,default:next[p.id]!==values[p.id]?next[p.id]??p.default:p.default}))}},'demo-params');}}/>;
}
export function SlideDemoNode({node,editing,interactive,onPatch,onGenerate,generating}:SlideRichNodeProps&{onGenerate?:()=>void;generating?:boolean}) {
 const lab=node.demo;
 return <div className="slideRichNode slideDemoNode" data-no-pan data-scene-demo={node.id} style={richNodeStyle(node,interactive||editing)}>
 {editing&&interactive&&!node.locked&&<div className="slideRichGrip" title="拖动整个演示框">⠿ 演示</div>}
 <div className="slideRichContent" onPointerDown={e=>{if(interactive)e.stopPropagation();}} onKeyDown={e=>{if(interactive)e.stopPropagation();}}>
 {lab?interactive?<DemoContent key={`${node.id}-${lab.content_hash}`} lab={lab} node={node} editing={editing} onPatch={onPatch}/>:<div className="slideDemoPreview"><strong>{lab.title}</strong><p>{lab.summary}</p><span>▶ 交互演示</span></div>:<div className="slideDemoPreview"><strong>本页交互演示</strong><p>根据页面内容生成可播放、可调节的演示。</p></div>}
 {editing&&interactive&&!node.locked&&onGenerate&&<button className="slideDemoGenerate" type="button" disabled={generating} onClick={onGenerate}>{generating?'正在生成演示…':lab?'重新生成演示':'AI 根据本页生成演示'}</button>}
 </div></div>;
}
export default SlideDemoNode;
